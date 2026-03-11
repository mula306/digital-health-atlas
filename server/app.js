import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import jwksRsa from 'jwks-rsa';
import { getPool, sql } from './db.js';
import { seedPermissions } from './utils/seedPermissions.js';
import { normalizeRoleList } from './utils/rbacCatalog.js';
import { getMockTestPersona } from './utils/testAuthPersonas.js';

import dashboardRouter from './routes/dashboard.js';
import goalsRouter from './routes/goals.js';
import kpisRouter from './routes/kpis.js';
import projectsRouter from './routes/projects.js';
import tasksRouter from './routes/tasks.js';
import tagsRouter from './routes/tags.js';
import intakeRouter from './routes/intake.js';
import governanceRouter from './routes/governance.js';
import usersRouter from './routes/users.js';
import adminRouter from './routes/admin.js';
import reportsRouter, { startExecutivePackScheduler } from './routes/reports.js';

const DUPLICATE_KEY_ERROR_CODES = new Set([2601, 2627]);

const parsePositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const resolveCorsOrigins = ({ isDevelopment, corsAllowedOrigins }) => {
    const configuredCorsOrigins = (corsAllowedOrigins || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    const defaultDevCorsOrigins = [
        'http://localhost:5173',
        'https://localhost:5173',
        'http://127.0.0.1:5173',
        'https://127.0.0.1:5173'
    ];
    return configuredCorsOrigins.length > 0
        ? configuredCorsOrigins
        : (isDevelopment ? defaultDevCorsOrigins : []);
};

export const TEST_AUTH_MODE = Object.freeze({
    MOCK: 'mock'
});

const configureJwtPassport = ({
    app,
    azureTenantId,
    azureClientId,
    authFallbackRoles,
    isDevelopment,
    lastLoginUpdateIntervalMs
}) => {
    const jwtOptions = {
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        secretOrKeyProvider: jwksRsa.passportJwtSecret({
            cache: true,
            rateLimit: true,
            jwksRequestsPerMinute: 5,
            jwksUri: `https://login.microsoftonline.com/${azureTenantId}/discovery/v2.0/keys`
        }),
        issuer: [
            `https://login.microsoftonline.com/${azureTenantId}/v2.0`,
            `https://sts.windows.net/${azureTenantId}/`
        ],
        audience: [azureClientId, `api://${azureClientId}`],
        algorithms: ['RS256']
    };

    passport.use(new JwtStrategy(jwtOptions, async (jwtPayload, done) => {
        try {
            const pool = await getPool();
            const result = await pool.request()
                .input('oid', sql.NVarChar, jwtPayload.oid)
                .query('SELECT * FROM Users WHERE oid = @oid');

            let user = result.recordset[0];

            if (!user) {
                const name = jwtPayload.name || jwtPayload.preferred_username || 'Unknown User';
                const email = jwtPayload.preferred_username || jwtPayload.email || 'unknown@example.com';
                const tid = jwtPayload.tid || azureTenantId;

                try {
                    const insertResult = await pool.request()
                        .input('oid', sql.NVarChar, jwtPayload.oid)
                        .input('tid', sql.NVarChar, tid)
                        .input('name', sql.NVarChar, name)
                        .input('email', sql.NVarChar, email)
                        .input('roles', sql.NVarChar, JSON.stringify(authFallbackRoles))
                        .query(`
                            INSERT INTO Users (oid, tid, name, email, roles)
                            OUTPUT INSERTED.*
                            VALUES (@oid, @tid, @name, @email, @roles)
                        `);
                    user = insertResult.recordset[0];
                } catch (insertErr) {
                    if (!DUPLICATE_KEY_ERROR_CODES.has(insertErr?.number)) {
                        throw insertErr;
                    }
                    const existing = await pool.request()
                        .input('oid', sql.NVarChar, jwtPayload.oid)
                        .query('SELECT * FROM Users WHERE oid = @oid');
                    user = existing.recordset[0];
                }
            }

            if (!user) {
                return done(new Error('Unable to provision authenticated user record.'), false);
            }

            let dbRoles = [];
            try {
                dbRoles = normalizeRoleList(JSON.parse(user.roles || '[]'));
            } catch {
                dbRoles = [];
            }

            const tokenRolesClaim = jwtPayload.roles;
            const normalizedTokenRoles = Array.isArray(tokenRolesClaim)
                ? normalizeRoleList(tokenRolesClaim)
                : null;
            const effectiveTokenRoles = normalizedTokenRoles === null
                ? normalizeRoleList(authFallbackRoles)
                : (normalizedTokenRoles.length > 0 ? normalizedTokenRoles : normalizeRoleList(authFallbackRoles));

            const dbRolesSorted = [...dbRoles].sort().join(',');
            const tokenRolesSorted = [...effectiveTokenRoles].sort().join(',');
            if (dbRolesSorted !== tokenRolesSorted) {
                if (isDevelopment) {
                    console.log(`Syncing roles for ${user.email}: ${dbRolesSorted} -> ${tokenRolesSorted}`);
                }
                await pool.request()
                    .input('oid', sql.NVarChar, jwtPayload.oid)
                    .input('roles', sql.NVarChar, JSON.stringify(effectiveTokenRoles))
                    .query('UPDATE Users SET roles = @roles WHERE oid = @oid');
            }
            user.roles = effectiveTokenRoles;

            const now = new Date();
            const previousLogin = user.lastLogin ? new Date(user.lastLogin) : null;
            const shouldUpdateLastLogin = !previousLogin
                || Number.isNaN(previousLogin.getTime())
                || (now.getTime() - previousLogin.getTime()) >= lastLoginUpdateIntervalMs;
            if (shouldUpdateLastLogin) {
                await pool.request()
                    .input('oid', sql.NVarChar, jwtPayload.oid)
                    .input('lastLogin', sql.DateTime2, now)
                    .query('UPDATE Users SET lastLogin = @lastLogin WHERE oid = @oid');
                user.lastLogin = now;
            }

            user.orgId = user.orgId || null;
            return done(null, user);
        } catch (err) {
            return done(err, false);
        }
    }));

    app.use(passport.initialize());

    app.use('/api/', (req, res, next) => {
        passport.authenticate('jwt', { session: false }, (err, user, info) => {
            if (err) return next(err);
            if (!user) {
                if (info) console.log('Auth Failure:', info.message || info);
                return res.status(401).json({ error: 'Unauthorized' });
            }
            req.user = user;
            req.orgId = user.orgId || null;
            return next();
        })(req, res, next);
    });
};

const configureMockAuth = (app) => {
    app.use('/api/', (req, res, next) => {
        const personaHeader = req.get('x-test-user');
        const persona = getMockTestPersona(personaHeader);
        if (!persona) {
            return res.status(401).json({ error: 'Unauthorized: provide valid x-test-user persona in mock auth mode.' });
        }
        req.user = {
            ...persona,
            roles: [...persona.roles]
        };
        req.orgId = req.user.orgId || null;
        return next();
    });
};

export const createApp = (options = {}) => {
    const env = options.env || process.env;
    const nodeEnv = String(env.NODE_ENV || 'development').toLowerCase();
    const isProduction = nodeEnv === 'production';
    const isDevelopment = !isProduction;
    const configuredTestAuthMode = String(options.testAuthMode || env.TEST_AUTH_MODE || '').trim().toLowerCase();
    const mockAuthEnabled = configuredTestAuthMode === TEST_AUTH_MODE.MOCK;

    if (isProduction && mockAuthEnabled) {
        throw new Error('TEST_AUTH_MODE=mock is not allowed in production.');
    }

    const azureTenantId = env.AZURE_TENANT_ID;
    const azureClientId = env.AZURE_CLIENT_ID;
    const authFallbackRoles = (env.AUTH_FALLBACK_ROLES || '')
        .split(',')
        .map((role) => role.trim())
        .filter(Boolean);
    const authLastLoginUpdateMs = Number.parseInt(env.AUTH_LAST_LOGIN_UPDATE_MS || '300000', 10);
    const lastLoginUpdateIntervalMs = Number.isFinite(authLastLoginUpdateMs) && authLastLoginUpdateMs >= 0
        ? authLastLoginUpdateMs
        : 300000;
    const apiRateLimitWindowMs = parsePositiveInt(env.API_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
    const apiRateLimitMax = parsePositiveInt(
        env.API_RATE_LIMIT_MAX,
        isDevelopment ? 5000 : 1500
    );
    const execPackSchedulerIntervalMs = Number.parseInt(env.EXEC_PACK_SCHEDULER_INTERVAL_MS || '60000', 10);
    const allowedCorsOrigins = resolveCorsOrigins({
        isDevelopment,
        corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS
    });
    const port = Number.parseInt(env.PORT || '3001', 10);

    if (!mockAuthEnabled) {
        if (!azureTenantId || azureTenantId === 'common') {
            throw new Error("AZURE_TENANT_ID must be set to a specific tenant id and cannot be 'common'.");
        }
        if (!azureClientId) {
            throw new Error('AZURE_CLIENT_ID must be set.');
        }
        if (!isDevelopment && authFallbackRoles.length > 0) {
            throw new Error('AUTH_FALLBACK_ROLES must be empty in production.');
        }
    }

    const app = express();

    app.use(cors({
        origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            if (allowedCorsOrigins.includes(origin)) return callback(null, true);
            return callback(new Error('CORS origin denied'));
        },
        credentials: true,
        methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Authorization', 'Content-Type', 'x-test-user']
    }));
    app.use(helmet());
    app.use(compression());
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    const limiter = rateLimit({
        windowMs: apiRateLimitWindowMs,
        max: apiRateLimitMax,
        standardHeaders: true,
        legacyHeaders: false
    });
    app.use('/api/', limiter);

    if (mockAuthEnabled) {
        configureMockAuth(app);
    } else {
        configureJwtPassport({
            app,
            azureTenantId,
            azureClientId,
            authFallbackRoles,
            isDevelopment,
            lastLoginUpdateIntervalMs
        });
    }

    app.use('/api/dashboard', dashboardRouter);
    app.use('/api/goals', goalsRouter);
    app.use('/api/kpis', kpisRouter);
    app.use('/api/projects', projectsRouter);
    app.use('/api/tasks', tasksRouter);
    app.use('/api/tags', tagsRouter);
    app.use('/api/intake', intakeRouter);
    app.use('/api/governance', governanceRouter);
    app.use('/api/reports', reportsRouter);
    app.use('/api/users', usersRouter);
    app.use('/api/admin', adminRouter);

    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', timestamp: new Date() });
    });

    return {
        app,
        config: {
            port,
            isDevelopment,
            mockAuthEnabled,
            execPackSchedulerIntervalMs: Number.isFinite(execPackSchedulerIntervalMs) ? execPackSchedulerIntervalMs : 60000
        }
    };
};

export const startServer = async (options = {}) => {
    const { app, config } = createApp(options);
    const host = options.host || '0.0.0.0';

    return new Promise((resolve, reject) => {
        const server = app.listen(config.port, host, async () => {
            try {
                await getPool();
                await seedPermissions();
                const schedulerStart = startExecutivePackScheduler({
                    intervalMs: config.execPackSchedulerIntervalMs
                });
                if (schedulerStart.started) {
                    console.log(`Executive pack scheduler started (interval ${schedulerStart.intervalMs}ms)`);
                }
                console.log(`API server running on:`);
                console.log(`  Local:   http://localhost:${config.port}`);
                console.log(`  Network: http://${host}:${config.port}`);
                resolve({ app, server, config, schedulerStart });
            } catch (err) {
                console.error('Failed to connect to database:', err);
                resolve({ app, server, config });
            }
        });

        server.on('error', (err) => {
            reject(err);
        });
    });
};

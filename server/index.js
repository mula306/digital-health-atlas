import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit'; // morgan removed
import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import jwksRsa from 'jwks-rsa'; // Added for Azure AD
import 'dotenv/config';
import { getPool, sql } from './db.js';
import { seedPermissions } from './utils/seedPermissions.js';
import { normalizeRoleList } from './utils/rbacCatalog.js';

// Import Routers
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

const app = express();
const PORT = process.env.PORT || 3001;
const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';

const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID;
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID;
const AUTH_FALLBACK_ROLES = (process.env.AUTH_FALLBACK_ROLES || '')
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean);
const AUTH_LAST_LOGIN_UPDATE_MS = Number.parseInt(process.env.AUTH_LAST_LOGIN_UPDATE_MS || '300000', 10);
const LAST_LOGIN_UPDATE_INTERVAL_MS = Number.isFinite(AUTH_LAST_LOGIN_UPDATE_MS) && AUTH_LAST_LOGIN_UPDATE_MS >= 0
    ? AUTH_LAST_LOGIN_UPDATE_MS
    : 300000;
const DUPLICATE_KEY_ERROR_CODES = new Set([2601, 2627]);
const EXEC_PACK_SCHEDULER_INTERVAL_MS = Number.parseInt(process.env.EXEC_PACK_SCHEDULER_INTERVAL_MS || '60000', 10);
const configuredCorsOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
const defaultDevCorsOrigins = [
    'http://localhost:5173',
    'https://localhost:5173',
    'http://127.0.0.1:5173',
    'https://127.0.0.1:5173'
];
const allowedCorsOrigins = configuredCorsOrigins.length > 0
    ? configuredCorsOrigins
    : (IS_DEVELOPMENT ? defaultDevCorsOrigins : []);

if (!AZURE_TENANT_ID || AZURE_TENANT_ID === 'common') {
    throw new Error("AZURE_TENANT_ID must be set to a specific tenant id and cannot be 'common'.");
}
if (!AZURE_CLIENT_ID) {
    throw new Error('AZURE_CLIENT_ID must be set.');
}
if (!IS_DEVELOPMENT && AUTH_FALLBACK_ROLES.length > 0) {
    throw new Error('AUTH_FALLBACK_ROLES must be empty in production.');
}

// ==================== MIDDLEWARE ====================

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true); // non-browser clients
        if (allowedCorsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('CORS origin denied'));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type']
}));
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// app.use(morgan('combined')); // Removed missing dependency

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // Limit each IP to 500 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// ==================== AUTHENTICATION ====================

// passport-azure-ad config removed as it was unused (using passport-jwt instead)

// Passport Config (using passport-jwt with Azure AD token structure)
// We use jwks-rsa to retrieve public keys for signature validation

const jwtOptions = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKeyProvider: jwksRsa.passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `https://login.microsoftonline.com/${AZURE_TENANT_ID}/discovery/v2.0/keys`
    }),
    issuer: [
        `https://login.microsoftonline.com/${AZURE_TENANT_ID}/v2.0`, // v2.0 endpoint
        `https://sts.windows.net/${AZURE_TENANT_ID}/`              // v1.0 endpoint
    ],
    audience: [AZURE_CLIENT_ID, `api://${AZURE_CLIENT_ID}`],
    algorithms: ['RS256']
};

passport.use(new JwtStrategy(jwtOptions, async (jwt_payload, done) => {
    try {
        // Find user by OID (Object ID from Azure AD)
        const pool = await getPool();
        const result = await pool.request()
            .input('oid', sql.NVarChar, jwt_payload.oid)
            .query('SELECT * FROM Users WHERE oid = @oid');


        let user = result.recordset[0];

        if (!user) {
            // Auto-provision user if they don't exist
            // Extract info from token claims
            const name = jwt_payload.name || jwt_payload.preferred_username || 'Unknown User';
            const email = jwt_payload.preferred_username || jwt_payload.email || 'unknown@example.com';
            const tid = jwt_payload.tid || AZURE_TENANT_ID;

            try {
                const insertResult = await pool.request()
                    .input('oid', sql.NVarChar, jwt_payload.oid)
                    .input('tid', sql.NVarChar, tid)
                    .input('name', sql.NVarChar, name)
                    .input('email', sql.NVarChar, email)
                    .input('roles', sql.NVarChar, JSON.stringify(AUTH_FALLBACK_ROLES))
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
                    .input('oid', sql.NVarChar, jwt_payload.oid)
                    .query('SELECT * FROM Users WHERE oid = @oid');
                user = existing.recordset[0];
            }
        }

        if (!user) {
            return done(new Error('Unable to provision authenticated user record.'), false);
        }

        // Parse DB roles
        let dbRoles = [];
        try {
            dbRoles = normalizeRoleList(JSON.parse(user.roles || '[]'));
        } catch {
            dbRoles = [];
        }

        const tokenRolesClaim = jwt_payload.roles;
        const normalizedTokenRoles = Array.isArray(tokenRolesClaim)
            ? normalizeRoleList(tokenRolesClaim)
            : null;
        // If token role claims are missing/empty, use explicit env fallback roles (default: none).
        const effectiveTokenRoles = normalizedTokenRoles === null
            ? normalizeRoleList(AUTH_FALLBACK_ROLES)
            : (normalizedTokenRoles.length > 0 ? normalizedTokenRoles : normalizeRoleList(AUTH_FALLBACK_ROLES));

        const dbRolesSorted = [...dbRoles].sort().join(',');
        const tokenRolesSorted = [...effectiveTokenRoles].sort().join(',');
        if (dbRolesSorted !== tokenRolesSorted) {
            if (IS_DEVELOPMENT) {
                console.log(`Syncing roles for ${user.email}: ${dbRolesSorted} -> ${tokenRolesSorted}`);
            }
            await pool.request()
                .input('oid', sql.NVarChar, jwt_payload.oid)
                .input('roles', sql.NVarChar, JSON.stringify(effectiveTokenRoles))
                .query('UPDATE Users SET roles = @roles WHERE oid = @oid');
        }
        user.roles = effectiveTokenRoles;

        const now = new Date();
        const previousLogin = user.lastLogin ? new Date(user.lastLogin) : null;
        const shouldUpdateLastLogin = !previousLogin
            || Number.isNaN(previousLogin.getTime())
            || (now.getTime() - previousLogin.getTime()) >= LAST_LOGIN_UPDATE_INTERVAL_MS;
        if (shouldUpdateLastLogin) {
            await pool.request()
                .input('oid', sql.NVarChar, jwt_payload.oid)
                .input('lastLogin', sql.DateTime2, now)
                .query('UPDATE Users SET lastLogin = @lastLogin WHERE oid = @oid');
            user.lastLogin = now;
        }

        // Attach orgId for multi-org scoping
        user.orgId = user.orgId || null;

        return done(null, user);
    } catch (err) {
        return done(err, false);
    }
}));

app.use(passport.initialize());

// Enforce Global Authentication for /api/
app.use('/api/', (req, res, next) => {
    passport.authenticate('jwt', { session: false }, (err, user, info) => {
        if (err) {
            console.error('Passport Error:', err);
            return next(err);
        }
        if (!user) {
            // Strict Mode: Reject invalid/missing tokens
            if (info) console.log('Auth Failure:', info.message || info);
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Success
        req.user = user;
        req.orgId = user.orgId || null; // Convenient org scope shorthand
        return next();
    })(req, res, next);
});

// ==================== ROUTES ====================

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

// Health Check (Public)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

// ==================== START SERVER ====================

const HOST = '0.0.0.0'; // Listen on all interfaces

app.listen(PORT, HOST, async () => {
    try {
        await getPool();
        // Seed permissions on startup
        await seedPermissions();
        const schedulerStart = startExecutivePackScheduler({
            intervalMs: Number.isFinite(EXEC_PACK_SCHEDULER_INTERVAL_MS) ? EXEC_PACK_SCHEDULER_INTERVAL_MS : 60000
        });
        if (schedulerStart.started) {
            console.log(`Executive pack scheduler started (interval ${schedulerStart.intervalMs}ms)`);
        }

        console.log(`API server running on:`);
        console.log(`  Local:   http://localhost:${PORT}`);
        console.log(`  Network: http://0.0.0.0:${PORT}`);
    } catch (err) {
        console.error('Failed to connect to database:', err);
    }
});

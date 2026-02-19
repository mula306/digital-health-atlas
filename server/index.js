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

// Import Routers
import dashboardRouter from './routes/dashboard.js';
import goalsRouter from './routes/goals.js';
import kpisRouter from './routes/kpis.js';
import projectsRouter from './routes/projects.js';
import tasksRouter from './routes/tasks.js';
import tagsRouter from './routes/tags.js';
import intakeRouter from './routes/intake.js';
import usersRouter from './routes/users.js';
import adminRouter from './routes/admin.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ==================== MIDDLEWARE ====================

app.use(cors());
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
        jwksUri: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/discovery/v2.0/keys`
    }),
    issuer: [
        `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/v2.0`, // v2.0 endpoint
        `https://sts.windows.net/${process.env.AZURE_TENANT_ID}/`              // v1.0 endpoint
    ],
    audience: [process.env.AZURE_CLIENT_ID, `api://${process.env.AZURE_CLIENT_ID}`],
    algorithms: ['RS256']
};

passport.use(new JwtStrategy(jwtOptions, async (jwt_payload, done) => {
    try {
        // Find user by OID (Object ID from Azure AD)
        const pool = await getPool();
        const result = await pool.request()
            .input('oid', sql.NVarChar, jwt_payload.oid)
            .query('SELECT * FROM Users WHERE oid = @oid');


        // DEBUG: Log sanitized payload
        const sanitizedPayload = {
            oid: jwt_payload.oid,
            name: jwt_payload.name || 'Unknown',
            roles: jwt_payload.roles || []
        };
        console.log(`[AuthDebug] JWT Payload for ${sanitizedPayload.name}:`, JSON.stringify(sanitizedPayload, null, 2));

        let user = result.recordset[0];

        if (!user) {
            // Auto-provision user if they don't exist
            // Extract info from token claims
            const name = jwt_payload.name || jwt_payload.preferred_username || 'Unknown User';
            const email = jwt_payload.preferred_username || jwt_payload.email || 'unknown@example.com';
            const tid = jwt_payload.tid || process.env.AZURE_TENANT_ID;

            const insertResult = await pool.request()
                .input('oid', sql.NVarChar, jwt_payload.oid)
                .input('tid', sql.NVarChar, tid)
                .input('name', sql.NVarChar, name)
                .input('email', sql.NVarChar, email)
                .query(`
                    INSERT INTO Users (oid, tid, name, email, roles) 
                    OUTPUT INSERTED.* 
                    VALUES (@oid, @tid, @name, @email, '["User"]')
                `);
            user = insertResult.recordset[0];
        }

        // Parse DB roles
        let dbRoles = [];
        try {
            dbRoles = JSON.parse(user.roles || '[]');
        } catch {
            dbRoles = ['User'];
        }

        // Sync roles from Token (Source of Truth) if present
        const tokenRoles = jwt_payload.roles;
        if (tokenRoles && Array.isArray(tokenRoles) && tokenRoles.length > 0) {
            // Check if we need to update DB
            const dbRolesSorted = [...dbRoles].sort().join(',');
            const tokenRolesSorted = [...tokenRoles].sort().join(',');

            if (dbRolesSorted !== tokenRolesSorted) {
                console.log(`Syncing roles for ${user.email}: ${dbRolesSorted} -> ${tokenRolesSorted}`);
                await pool.request()
                    .input('oid', sql.NVarChar, jwt_payload.oid)
                    .input('roles', sql.NVarChar, JSON.stringify(tokenRoles))
                    .query('UPDATE Users SET roles = @roles WHERE oid = @oid');

                user.roles = tokenRoles;
            } else {
                user.roles = dbRoles;
            }
        } else {
            // No roles in token, use DB roles
            user.roles = dbRoles;
        }

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

        console.log(`API server running on:`);
        console.log(`  Local:   http://localhost:${PORT}`);
        console.log(`  Network: http://0.0.0.0:${PORT}`);
    } catch (err) {
        console.error('Failed to connect to database:', err);
    }
});

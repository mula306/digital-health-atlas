import sql from 'mssql';
import 'dotenv/config';

const isProduction = process.env.NODE_ENV === 'production';
const dbEncrypt = process.env.DB_ENCRYPT
    ? process.env.DB_ENCRYPT === 'true'
    : isProduction;
const dbTrustServerCertificate = process.env.DB_TRUST_SERVER_CERT
    ? process.env.DB_TRUST_SERVER_CERT === 'true'
    : !isProduction;

const parsePort = (portValue) => {
    if (portValue === undefined || portValue === null || portValue === '') return undefined;
    const parsed = Number.parseInt(portValue, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
};

export const getSqlConfig = (overrides = {}) => {
    const configuredPort = parsePort(overrides.port ?? process.env.DB_PORT);
    return {
        user: overrides.user ?? process.env.DB_USER,
        password: overrides.password ?? process.env.DB_PASSWORD,
        server: overrides.server ?? process.env.DB_SERVER ?? '127.0.0.1',
        database: overrides.database ?? process.env.DB_NAME ?? 'DHAtlas',
        ...(configuredPort ? { port: configuredPort } : {}),
        options: {
            encrypt: dbEncrypt,
            trustServerCertificate: dbTrustServerCertificate
        },
        pool: {
            max: 10,
            min: 0,
            idleTimeoutMillis: 30000
        }
    };
};

let pool = null;

export async function getPool() {
    if (!pool || !pool.connected) {
        const config = getSqlConfig();
        pool = await sql.connect(config);
        pool.on('error', (err) => {
            console.error('SQL Pool error, will reconnect on next request:', err.message);
            pool = null;
        });
        console.log('Connected to SQL Server');
    }
    return pool;
}

export { sql };

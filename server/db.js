import sql from 'mssql';
import 'dotenv/config';

const isProduction = process.env.NODE_ENV === 'production';
const dbEncrypt = process.env.DB_ENCRYPT
    ? process.env.DB_ENCRYPT === 'true'
    : isProduction;
const dbTrustServerCertificate = process.env.DB_TRUST_SERVER_CERT
    ? process.env.DB_TRUST_SERVER_CERT === 'true'
    : !isProduction;

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || '127.0.0.1',
    database: process.env.DB_NAME || 'DHAtlas',
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

let pool = null;

export async function getPool() {
    if (!pool || !pool.connected) {
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

import sql from 'mssql';
import 'dotenv/config';

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || '127.0.0.1',
    database: process.env.DB_NAME || 'ProjectKanban',
    options: {
        encrypt: process.env.NODE_ENV === 'production',
        trustServerCertificate: true
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

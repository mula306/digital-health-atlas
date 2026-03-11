import { createServer } from 'vite';

const port = Number.parseInt(process.env.PLAYWRIGHT_WEB_PORT || '5174', 10);

let viteServer = null;

const shutdown = async () => {
    if (viteServer) {
        await viteServer.close();
    }
    process.exit(0);
};

process.on('SIGINT', () => {
    shutdown().catch((err) => {
        console.error('Failed to close Vite server on SIGINT:', err);
        process.exit(1);
    });
});

process.on('SIGTERM', () => {
    shutdown().catch((err) => {
        console.error('Failed to close Vite server on SIGTERM:', err);
        process.exit(1);
    });
});

try {
    viteServer = await createServer({
        configFile: 'vite.config.js',
        server: {
            host: true,
            port,
            https: true
        }
    });
    await viteServer.listen();
} catch (err) {
    console.error('Failed to start frontend test server:', err);
    process.exit(1);
}

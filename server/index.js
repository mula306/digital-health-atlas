import 'dotenv/config';
import { startServer } from './app.js';

startServer().catch((err) => {
    console.error('Server failed to start:', err);
    process.exit(1);
});
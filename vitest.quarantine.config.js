import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
    plugins: [react(), basicSsl()],
    esbuild: {
        jsx: 'automatic'
    },
    test: {
        environment: 'jsdom',
        setupFiles: ['./src/tests/setup/vitest.setup.js'],
        include: [
            'src/tests/**/*.quarantined.{test,spec}.{js,jsx}',
            'src/**/*.quarantined.{test,spec}.{js,jsx}'
        ],
        css: true,
        coverage: {
            enabled: false
        }
    }
});

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
    plugins: [react(), basicSsl()],
    test: {
        environment: 'jsdom',
        setupFiles: ['./src/tests/setup/vitest.setup.js'],
        include: [
            'src/tests/**/*.{test,spec}.{js,jsx}',
            'src/**/*.{test,spec}.{js,jsx}'
        ],
        exclude: [
            'src/tests/**/*.quarantined.{test,spec}.{js,jsx}',
            'src/**/*.quarantined.{test,spec}.{js,jsx}'
        ],
        css: true,
        coverage: {
            enabled: false,
            provider: 'v8',
            reporter: ['text', 'lcov'],
            reportsDirectory: './coverage/ui',
            thresholds: {
                lines: 40,
                functions: 25,
                statements: 35,
                branches: 30
            }
        }
    }
});

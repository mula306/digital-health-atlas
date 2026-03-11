import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
const testWebPort = Number.parseInt(process.env.PLAYWRIGHT_WEB_PORT || '5174', 10);
const testApiPort = Number.parseInt(process.env.PLAYWRIGHT_API_PORT || '3101', 10);
const outputRunId = process.env.PLAYWRIGHT_RUN_ID || `${Date.now()}-${process.pid}`;

export default defineConfig({
    testDir: './e2e',
    outputDir: `playwright-results/${outputRunId}`,
    timeout: 120000,
    grepInvert: process.env.PLAYWRIGHT_INCLUDE_QUARANTINED === 'true' ? undefined : /@quarantined/,
    expect: {
        timeout: 10000
    },
    fullyParallel: false,
    retries: isCI ? 1 : 0,
    workers: isCI ? 1 : undefined,
    reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
    use: {
        baseURL: `https://localhost:${testWebPort}`,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        ignoreHTTPSErrors: true
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] }
        }
    ],
    webServer: [
        {
            command: 'node e2e/scripts/start-backend-server.js',
            url: `http://localhost:${testApiPort}/health`,
            timeout: 180000,
            reuseExistingServer: !isCI,
            env: {
                ...process.env,
                NODE_ENV: 'test',
                TEST_AUTH_MODE: 'mock',
                TEST_DB_NAME: process.env.TEST_DB_NAME || 'DHAtlas_test',
                PLAYWRIGHT_API_PORT: String(testApiPort),
                PORT: String(testApiPort)
            }
        },
        {
            command: 'node e2e/scripts/start-frontend-server.js',
            url: `https://localhost:${testWebPort}`,
            timeout: 180000,
            reuseExistingServer: !isCI,
            ignoreHTTPSErrors: true,
            env: {
                ...process.env,
                VITE_TEST_AUTH_MODE: 'mock',
                VITE_TEST_USER: process.env.VITE_TEST_USER || 'admin',
                PLAYWRIGHT_WEB_PORT: String(testWebPort),
                VITE_API_PROXY_TARGET: `http://localhost:${testApiPort}`
            }
        }
    ]
});

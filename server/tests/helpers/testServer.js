import supertest from 'supertest';
import { createApp } from '../../app.js';
import { TEST_PERSONAS } from '../../utils/testAuthPersonas.js';

export const createTestRequest = (options = {}) => {
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.TEST_AUTH_MODE = 'mock';
    const { app } = createApp({
        ...options,
        testAuthMode: 'mock',
        env: {
            ...process.env,
            NODE_ENV: 'test',
            TEST_AUTH_MODE: 'mock',
            API_RATE_LIMIT_WINDOW_MS: process.env.API_RATE_LIMIT_WINDOW_MS || '60000',
            API_RATE_LIMIT_MAX: process.env.API_RATE_LIMIT_MAX || '250'
        }
    });
    return supertest(app);
};

export const asPersona = (request, personaKey) => {
    if (!TEST_PERSONAS[personaKey]) {
        throw new Error(`Unknown test persona key: ${personaKey}`);
    }
    return {
        get: (url) => request.get(url).set('x-test-user', personaKey),
        post: (url) => request.post(url).set('x-test-user', personaKey),
        put: (url) => request.put(url).set('x-test-user', personaKey),
        patch: (url) => request.patch(url).set('x-test-user', personaKey),
        delete: (url) => request.delete(url).set('x-test-user', personaKey)
    };
};


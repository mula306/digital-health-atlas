import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithAuth, ApiError } from '../../apiClient.js';

describe('fetchWithAuth', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('adds bearer token and content type header', async () => {
        const mockedResponse = new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockedResponse);

        const response = await fetchWithAuth('/api/test', 'token-123', {
            method: 'POST',
            body: JSON.stringify({ hello: 'world' })
        });

        expect(response.status).toBe(200);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const call = fetchSpy.mock.calls[0];
        const headers = call[1].headers;
        expect(headers.get('Authorization')).toBe('Bearer token-123');
        expect(headers.get('Content-Type')).toBe('application/json');
    });

    it('prefers runtime mock persona overrides when test auth mode is enabled', async () => {
        vi.stubEnv('VITE_TEST_AUTH_MODE', 'mock');
        vi.stubEnv('VITE_TEST_USER', 'admin');
        localStorage.setItem('dha_test_user', 'org2_editor');

        const mockedResponse = new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockedResponse);

        await fetchWithAuth('/api/test', null);

        const headers = fetchSpy.mock.calls[0][1].headers;
        expect(headers.get('x-test-user')).toBe('org2_editor');
    });

    it('throws ApiError with server-provided message payload', async () => {
        const mockedResponse = new Response(JSON.stringify({ error: 'Detailed backend error' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
        });
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockedResponse);

        await expect(fetchWithAuth('/api/test', null)).rejects.toMatchObject({
            name: 'ApiError',
            status: 400,
            message: 'Detailed backend error'
        });
    });

    it('wraps network failure in ApiError with status 0', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network down'));

        await expect(fetchWithAuth('/api/test', null)).rejects.toBeInstanceOf(ApiError);
        await expect(fetchWithAuth('/api/test', null)).rejects.toMatchObject({
            status: 0,
            message: 'Network down'
        });
    });
});

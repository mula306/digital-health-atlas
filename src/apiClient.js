/**
 * Shared API client configuration.
 * Single source of truth for the API base URL and common fetch helpers.
 */

// Protocol-safe: uses relative path to let Vite dev server proxy handle it,
// avoiding Mixed Content (HTTPS -> HTTP) blockers.
export const API_BASE = import.meta.env.VITE_API_URL || '/api';

const readMockAuthUserOverride = () => {
    if (typeof window === 'undefined') return null;

    const candidates = [];
    if (typeof window.__DHA_TEST_USER__ === 'string') {
        candidates.push(window.__DHA_TEST_USER__);
    }

    try {
        candidates.push(window.localStorage?.getItem('dha_test_user'));
    } catch {
        // Ignore storage access errors in locked-down environments.
    }

    try {
        candidates.push(window.sessionStorage?.getItem('dha_test_user'));
    } catch {
        // Ignore storage access errors in locked-down environments.
    }

    const resolved = candidates
        .map((value) => String(value || '').trim())
        .find(Boolean);

    return resolved || null;
};

export class ApiError extends Error {
    constructor(status, message, data) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.data = data;
    }
}

/**
 * Standardized fetch wrapper that handles auth headers and error parsing.
 * @param {string} url - Full URL
 * @param {string|null} token - Bearer token
 * @param {object} options - Fetch options
 */
export async function fetchWithAuth(url, token, options = {}) {
    const headers = new Headers(options.headers || {});
    const mockAuthMode = String(import.meta.env.VITE_TEST_AUTH_MODE || '').toLowerCase() === 'mock';
    const mockAuthUser = readMockAuthUserOverride()
        || (String(import.meta.env.VITE_TEST_USER || 'admin').trim() || 'admin');

    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    if (mockAuthMode) {
        headers.set('x-test-user', mockAuthUser);
    }

    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
    }

    const config = {
        ...options,
        headers
    };

    try {
        const response = await fetch(url, config);

        if (!response.ok) {
            let errorData;
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                try { errorData = await response.json(); } catch { /* ignore */ }
            } else {
                try { errorData = { message: await response.text() }; } catch { /* ignore */ }
            }

            const message = (errorData && errorData.error) || (errorData && errorData.message) || `Request failed with status ${response.status}`;
            throw new ApiError(response.status, message, errorData);
        }

        return response;
    } catch (error) {
        // If it's already an ApiError, rethrow
        if (error instanceof ApiError) throw error;
        // Network errors
        throw new ApiError(0, error.message || 'Network Error', null);
    }
}

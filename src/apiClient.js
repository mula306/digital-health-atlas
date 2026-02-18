/**
 * Shared API client configuration.
 * Single source of truth for the API base URL and common fetch helpers.
 */

// Protocol-safe: respects https in production, falls back to current host on port 3001
export const API_BASE = import.meta.env.VITE_API_URL
    || `${window.location.protocol}//${window.location.hostname}:3001/api`;

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

    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
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

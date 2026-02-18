const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';

/**
 * Safe error handler - logs details server-side, returns generic message to client
 * @param {Response} res - Express response object
 * @param {string} context - Context description (e.g. "fetching projects")
 * @param {Error} err - The error object
 */
export const handleError = (res, context, err) => {
    console.error(`Error ${context}:`, err);
    // Only show detailed errors in development
    const message = IS_DEVELOPMENT ? err.message : 'An internal error occurred';

    if (!res.headersSent) {
        res.status(500).json({ error: message });
    }
};

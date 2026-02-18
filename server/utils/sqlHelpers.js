

/**
 * Safely builds an IN clause for SQL queries with named parameters.
 * 
 * @param {string} paramPrefix - Prefix for parameter names (e.g. 'id', 'status')
 * @param {Array<string|number>} values - Array of values to include in the IN clause
 * @returns {object} - { text: string, params: object }
 * 
 * Example usage:
 * const { text, params } = buildInClause('projId', projectIds);
 * // text: "@projId0, @projId1, @projId2"
 * // params: { projId0: 1, projId1: 2, projId2: 3 }
 * 
 * // In query:
 * // const request = pool.request();
 * // Object.entries(params).forEach(([key, val]) => request.input(key, val));
 * // request.query(`SELECT * FROM Projects WHERE id IN (${text})`);
 */
export const buildInClause = (paramPrefix, values) => {
    if (!values || values.length === 0) {
        return { text: 'NULL', params: {} }; // parsing 'IN (NULL)' is valid but matches nothing usually, or handled by caller
    }

    const params = {};
    const paramNames = values.map((val, index) => {
        const paramName = `${paramPrefix}${index}`;
        params[paramName] = val;
        return `@${paramName}`;
    });

    return {
        text: paramNames.join(', '),
        params
    };
};

/**
 * Helper to add parameters to a MSSQL request object
 * @param {sql.Request} request - The MSSQL request object
 * @param {object} params - Key-value pairs of parameters
 */
export const addParams = (request, params) => {
    Object.entries(params).forEach(([key, val]) => {
        // Auto-detect type or use default input
        // For strict typing, caller should handle manual input, 
        // but for simple IDs (Int/String), default works well in mssql
        request.input(key, val);
    });
};

/**
 * Shared utility functions for formatting dates, status colors, and KPI values.
 * Centralizes logic previously duplicated across multiple components.
 */

/**
 * Format a date string to a long format: "January 1, 2025"
 */
export function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });
}

/**
 * Format a date string to short numeric: "01/01/2025"
 */
export function formatShortDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric'
    });
}

/**
 * Format a date string to a compact format: "Jan 1, 2025"
 */
export function formatCompactDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
    });
}

/**
 * Map a status string (green/yellow/red) to a hex color.
 * Used by StatusReportView and ExecDashboard.
 */
export function getStatusColor(status) {
    switch (status) {
        case 'green': return '#10b981';
        case 'yellow': return '#f59e0b';
        case 'red': return '#ef4444';
        default: return '#6b7280';
    }
}

/**
 * Format a KPI value with its unit (e.g. "$1,000", "50%", "100 users").
 */
export function formatKpiValue(val, unit) {
    if (!val && val !== 0) return '-';
    if (unit === '$') return `$${val.toLocaleString()}`;
    if (unit === '%') return `${val.toLocaleString()}%`;
    if (unit) return `${val.toLocaleString()} ${unit}`;
    return val.toLocaleString();
}

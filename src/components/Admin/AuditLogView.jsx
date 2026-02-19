import { useState, useEffect, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { apiRequest } from '../../authConfig';
import {
    Clock, User, Database, Plus, Pencil, Trash2,
    ChevronLeft, ChevronRight, X, Search,
    Activity, BarChart3, Globe
} from 'lucide-react';
import './AuditLogView.css';

import { API_BASE } from '../../apiClient';

// Human-readable action labels
const ACTION_LABELS = {
    'goal.create': 'Created Goal',
    'goal.update': 'Updated Goal',
    'goal.delete': 'Deleted Goal',
    'kpi.create': 'Created KPI',
    'kpi.update': 'Updated KPI',
    'kpi.delete': 'Deleted KPI',
    'tag_group.create': 'Created Tag Group',
    'tag_group.update': 'Updated Tag Group',
    'tag_group.delete': 'Deleted Tag Group',
    'tag.create': 'Created Tag',
    'tag.update': 'Updated Tag',
    'tag.delete': 'Deleted Tag',
    'project.create': 'Created Project',
    'project.update': 'Updated Project',
    'project.delete': 'Deleted Project',
    'project.tags_update': 'Updated Project Tags',
    'task.create': 'Created Task',
    'task.update': 'Updated Task',
    'task.delete': 'Deleted Task',
    'report.create': 'Created Report',
    'intake_form.create': 'Created Intake Form',
    'intake_form.update': 'Updated Intake Form',
    'intake_form.delete': 'Deleted Intake Form',
    'submission.create': 'Created Submission',
    'submission.status_update': 'Updated Submission Status',
    'submission.message': 'Sent Message',
    'permission.update': 'Updated Permission',
    'permission.bulk_update': 'Bulk Updated Permissions',
};

function getActionType(action) {
    if (action.includes('create')) return 'create';
    if (action.includes('update') || action.includes('message')) return 'update';
    if (action.includes('delete')) return 'delete';
    return 'other';
}

function getActionIcon(action) {
    const type = getActionType(action);
    switch (type) {
        case 'create': return <Plus size={16} />;
        case 'update': return <Pencil size={16} />;
        case 'delete': return <Trash2 size={16} />;
        default: return <Activity size={16} />;
    }
}

function formatTimestamp(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHrs < 24) return `${diffHrs}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function formatFullTimestamp(ts) {
    return new Date(ts).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

// Diff Viewer for before/after comparison
function DiffViewer({ before, after }) {
    if (!before && !after) return null;

    const allKeys = new Set([
        ...Object.keys(before || {}),
        ...Object.keys(after || {})
    ]);

    // Filter out uninteresting keys
    const filteredKeys = [...allKeys].filter(k =>
        k !== 'id' && k !== 'createdAt' && k !== 'updatedAt'
    );

    if (filteredKeys.length === 0) return null;

    return (
        <div className="audit-diff">
            <table>
                <thead>
                    <tr>
                        <th>Field</th>
                        {before && <th>Before</th>}
                        <th>{before ? 'After' : 'Value'}</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredKeys.map(key => {
                        const bVal = before?.[key];
                        const aVal = after?.[key];
                        const changed = before && JSON.stringify(bVal) !== JSON.stringify(aVal);

                        // Skip unchanged if both exist
                        if (before && after && !changed && bVal !== undefined) return null;

                        return (
                            <tr key={key}>
                                <td>{key}</td>
                                {before && (
                                    <td className={changed ? 'diff-removed' : 'diff-unchanged'}>
                                        {formatValue(bVal)}
                                    </td>
                                )}
                                <td className={changed ? 'diff-added' : ''}>
                                    {formatValue(aVal)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function formatValue(val) {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'boolean') return val ? 'Yes' : 'No';
    if (typeof val === 'object') return JSON.stringify(val, null, 2).substring(0, 300);
    return String(val);
}

export function AuditLogView() {
    const { instance } = useMsal();
    const [entries, setEntries] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({ page: 1, limit: 30, total: 0, totalPages: 0 });
    const [expandedId, setExpandedId] = useState(null);

    // Filters
    const [filters, setFilters] = useState({
        action: '',
        entityType: '',
        search: '',
        from: '',
        to: ''
    });

    const authFetch = useCallback(async (url, options = {}) => {
        const headers = new Headers(options.headers || {});
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

        try {
            const account = instance.getActiveAccount();
            if (account) {
                const response = await instance.acquireTokenSilent({ ...apiRequest, account });
                headers.set('Authorization', `Bearer ${response.accessToken}`);
            }
        } catch (e) {
            console.error('Token acquisition failed', e);
        }

        const res = await fetch(url, { ...options, headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }, [instance]);

    // Fetch stats
    useEffect(() => {
        authFetch(`${API_BASE}/admin/audit-log/stats`)
            .then(data => setStats(data))
            .catch(err => console.error('Failed to load audit stats', err));
    }, [authFetch]);

    // Fetch entries
    const fetchEntries = useCallback(async (page = 1) => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('page', page);
            params.set('limit', '30');
            if (filters.action) params.set('action', filters.action);
            if (filters.entityType) params.set('entityType', filters.entityType);
            if (filters.search) params.set('search', filters.search);
            if (filters.from) params.set('from', filters.from);
            if (filters.to) params.set('to', filters.to);

            const data = await authFetch(`${API_BASE}/admin/audit-log?${params.toString()}`);
            setEntries(data.entries);
            setPagination(data.pagination);
        } catch (err) {
            console.error('Failed to load audit log', err);
        } finally {
            setLoading(false);
        }
    }, [authFetch, filters]);

    useEffect(() => {
        fetchEntries(1);
    }, [fetchEntries]);

    const handleFilterChange = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const resetFilters = () => {
        setFilters({ action: '', entityType: '', search: '', from: '', to: '' });
    };

    const hasActiveFilters = Object.values(filters).some(v => v !== '');

    // Unique entity types for filter dropdown
    const entityTypes = ['goal', 'kpi', 'tag_group', 'tag', 'project', 'task', 'report', 'intake_form', 'submission', 'permission'];

    // Unique actions for filter dropdown
    const actionOptions = Object.keys(ACTION_LABELS);

    return (
        <div className="audit-log">
            {/* Stats Cards */}
            {stats && (
                <div className="audit-stats">
                    <div className="audit-stat-card">
                        <span className="stat-label">Last 24 Hours</span>
                        <span className="stat-value">{stats.counts?.last24h ?? 0}</span>
                    </div>
                    <div className="audit-stat-card">
                        <span className="stat-label">Last 7 Days</span>
                        <span className="stat-value">{stats.counts?.last7d ?? 0}</span>
                    </div>
                    <div className="audit-stat-card">
                        <span className="stat-label">Last 30 Days</span>
                        <span className="stat-value">{stats.counts?.last30d ?? 0}</span>
                    </div>
                    <div className="audit-stat-card">
                        <span className="stat-label">Total Events</span>
                        <span className="stat-value">{stats.counts?.total ?? 0}</span>
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="audit-filters">
                <Search size={16} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                <input
                    type="text"
                    placeholder="Search by name..."
                    value={filters.search}
                    onChange={e => handleFilterChange('search', e.target.value)}
                />
                <select
                    value={filters.entityType}
                    onChange={e => handleFilterChange('entityType', e.target.value)}
                >
                    <option value="">All Types</option>
                    {entityTypes.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                </select>
                <select
                    value={filters.action}
                    onChange={e => handleFilterChange('action', e.target.value)}
                >
                    <option value="">All Actions</option>
                    {actionOptions.map(a => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
                </select>
                <input
                    type="date"
                    value={filters.from}
                    onChange={e => handleFilterChange('from', e.target.value)}
                    title="From date"
                />
                <input
                    type="date"
                    value={filters.to}
                    onChange={e => handleFilterChange('to', e.target.value)}
                    title="To date"
                />
                {hasActiveFilters && (
                    <button className="audit-filter-reset" onClick={resetFilters}>
                        <X size={14} /> Clear
                    </button>
                )}
            </div>

            {/* Timeline */}
            <div className="audit-timeline" style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                {loading ? (
                    <div className="audit-timeline-loading">Loading audit events...</div>
                ) : entries.length === 0 ? (
                    <div className="audit-timeline-empty">
                        {hasActiveFilters ? 'No events matching filters' : 'No audit events recorded yet'}
                    </div>
                ) : (
                    entries.map(entry => (
                        <div
                            key={entry.id}
                            className={`audit-entry ${expandedId === entry.id ? 'expanded' : ''}`}
                            onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                        >
                            <div className={`audit-icon ${getActionType(entry.action)}`}>
                                {getActionIcon(entry.action)}
                            </div>
                            <div className="audit-content">
                                <div className="audit-content-header">
                                    <span className="audit-action-label">
                                        {ACTION_LABELS[entry.action] || entry.action}
                                    </span>
                                    <span className="audit-entity-badge">
                                        {entry.entityType}
                                    </span>
                                    {entry.entityTitle && (
                                        <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: '0.9rem' }}>
                                            — {entry.entityTitle}
                                        </span>
                                    )}
                                </div>
                                <div className="audit-meta">
                                    <span className="audit-meta-item">
                                        <User size={14} />
                                        {entry.userName || 'System'}
                                    </span>
                                    <span className="audit-meta-item" title={formatFullTimestamp(entry.createdAt)}>
                                        <Clock size={14} />
                                        {formatTimestamp(entry.createdAt)}
                                    </span>
                                    {entry.entityId && (
                                        <span className="audit-meta-item">
                                            <Database size={14} />
                                            ID: {entry.entityId}
                                        </span>
                                    )}
                                </div>

                                {/* Expanded Details */}
                                {expandedId === entry.id && (
                                    <>
                                        <DiffViewer before={entry.before} after={entry.after} />
                                        {(entry.ipAddress || entry.userAgent) && (
                                            <div className="audit-forensics">
                                                {entry.ipAddress && (
                                                    <span><Globe size={12} /> IP: <code>{entry.ipAddress}</code></span>
                                                )}
                                                {entry.userAgent && (
                                                    <span>UA: <code>{entry.userAgent.substring(0, 80)}...</code></span>
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
                <div className="audit-pagination">
                    <span className="audit-pagination-info">
                        Page {pagination.page} of {pagination.totalPages} ({pagination.total} events)
                    </span>
                    <div className="audit-pagination-btns">
                        <button
                            disabled={pagination.page <= 1}
                            onClick={() => fetchEntries(pagination.page - 1)}
                        >
                            <ChevronLeft size={16} /> Prev
                        </button>
                        <button
                            disabled={pagination.page >= pagination.totalPages}
                            onClick={() => fetchEntries(pagination.page + 1)}
                        >
                            Next <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* Stats Breakdown */}
            {stats && (stats.topUsers?.length > 0 || stats.actionBreakdown?.length > 0) && (
                <div className="audit-breakdown">
                    {stats.topUsers?.length > 0 && (
                        <div className="audit-breakdown-card">
                            <h4><User size={16} /> Most Active Users (30d)</h4>
                            <ul className="audit-breakdown-list">
                                {stats.topUsers.slice(0, 5).map((u, i) => (
                                    <li key={i}>
                                        <span>{u.userName}</span>
                                        <span className="count">{u.eventCount}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {stats.actionBreakdown?.length > 0 && (
                        <div className="audit-breakdown-card">
                            <h4><BarChart3 size={16} /> Action Breakdown (30d)</h4>
                            <ul className="audit-breakdown-list">
                                {stats.actionBreakdown.slice(0, 8).map((a, i) => (
                                    <li key={i}>
                                        <span>{ACTION_LABELS[a.action] || a.action}</span>
                                        <span className="count">{a.count}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

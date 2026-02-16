import { useState, useEffect, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { apiRequest } from '../../authConfig';
import {
    Clock, User, Plus, Pencil, Trash2, Activity,
    ChevronDown, Database
} from 'lucide-react';

const API_BASE = `http://${window.location.hostname}:3001/api`;

const ACTION_LABELS = {
    'project.create': 'Project created',
    'project.update': 'Project updated',
    'project.delete': 'Project deleted',
    'project.tags_update': 'Tags updated',
    'task.create': 'Task added',
    'task.update': 'Task updated',
    'task.delete': 'Task removed',
    'report.create': 'Status report submitted',
};

function getActionType(action) {
    if (action.includes('create')) return 'create';
    if (action.includes('update') || action.includes('tags')) return 'update';
    if (action.includes('delete')) return 'delete';
    return 'other';
}

function getActionIcon(action) {
    const type = getActionType(action);
    switch (type) {
        case 'create': return <Plus size={14} />;
        case 'update': return <Pencil size={14} />;
        case 'delete': return <Trash2 size={14} />;
        default: return <Activity size={14} />;
    }
}

function timeAgo(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const mins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);

    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hrs < 24) return `${hrs}h ago`;
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ProjectActivityFeed({ projectId }) {
    const { instance } = useMsal();
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 });

    const authFetch = useCallback(async (url) => {
        const headers = new Headers({ 'Content-Type': 'application/json' });
        try {
            const account = instance.getActiveAccount();
            if (account) {
                const response = await instance.acquireTokenSilent({ ...apiRequest, account });
                headers.set('Authorization', `Bearer ${response.accessToken}`);
            }
        } catch (e) {
            console.error('Token acquisition failed', e);
        }
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }, [instance]);

    const fetchActivity = useCallback(async (page = 1) => {
        setLoading(true);
        try {
            const data = await authFetch(
                `${API_BASE}/projects/${projectId}/activity?page=${page}&limit=20`
            );
            if (page === 1) {
                setEntries(data.entries);
            } else {
                setEntries(prev => [...prev, ...data.entries]);
            }
            setPagination(data.pagination);
        } catch (err) {
            console.error('Failed to load activity', err);
        } finally {
            setLoading(false);
        }
    }, [authFetch, projectId]);

    useEffect(() => {
        fetchActivity(1);
    }, [fetchActivity]);

    return (
        <div className="project-activity-feed">
            <div className="activity-feed-header">
                <Activity size={18} />
                <h3>Activity History</h3>
                <span className="activity-count">{pagination.total} events</span>
            </div>

            {loading && entries.length === 0 ? (
                <div className="activity-loading">Loading activity...</div>
            ) : entries.length === 0 ? (
                <div className="activity-empty">
                    <Activity size={32} strokeWidth={1.5} />
                    <p>No activity recorded yet</p>
                    <span>Changes to this project, its tasks, and reports will appear here.</span>
                </div>
            ) : (
                <div className="activity-timeline">
                    {entries.map((entry, idx) => {
                        const type = getActionType(entry.action);

                        // Group by date
                        const entryDate = new Date(entry.createdAt).toLocaleDateString();
                        const prevDate = idx > 0 ? new Date(entries[idx - 1].createdAt).toLocaleDateString() : null;
                        const showDateSep = idx === 0 || entryDate !== prevDate;

                        return (
                            <div key={entry.id}>
                                {showDateSep && (
                                    <div className="activity-date-sep">
                                        {entryDate === new Date().toLocaleDateString() ? 'Today' :
                                            entryDate === new Date(Date.now() - 86400000).toLocaleDateString() ? 'Yesterday' :
                                                new Date(entry.createdAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                    </div>
                                )}
                                <div className="activity-item">
                                    <div className={`activity-dot ${type}`}>
                                        {getActionIcon(entry.action)}
                                    </div>
                                    <div className="activity-body">
                                        <span className="activity-text">
                                            <strong>{entry.userName || 'System'}</strong>
                                            {' '}
                                            {ACTION_LABELS[entry.action] || entry.action}
                                            {entry.entityType !== 'project' && entry.entityTitle && (
                                                <> — <em>{entry.entityTitle}</em></>
                                            )}
                                        </span>
                                        <span className="activity-time" title={new Date(entry.createdAt).toLocaleString()}>
                                            {timeAgo(entry.createdAt)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {pagination.page < pagination.totalPages && (
                <button
                    className="activity-load-more"
                    onClick={() => fetchActivity(pagination.page + 1)}
                    disabled={loading}
                >
                    {loading ? 'Loading...' : (
                        <>
                            <ChevronDown size={16} />
                            Load More
                        </>
                    )}
                </button>
            )}
        </div>
    );
}

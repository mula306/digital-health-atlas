import { useState, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import { BarChart3, Target, Folder, CheckSquare, AlertTriangle, TrendingUp, Activity, Coffee } from 'lucide-react';
import { getDescendantGoalIds } from '../../utils/goalHelpers';
import { FilterBar } from '../UI/FilterBar';
import { formatKpiValue } from '../../utils';
import './Dashboard.css';

import { API_BASE } from '../../apiClient';

const STATUS_OPTIONS = [
    { id: 'red', label: 'Red', color: '#ef4444' },
    { id: 'yellow', label: 'Yellow', color: '#f59e0b' },
    { id: 'green', label: 'Green', color: '#10b981' },
    { id: 'unknown', label: 'No Report', color: '#9ca3af' }
];

export function Dashboard() {
    const { goals, authFetch } = useData();
    const [goalFilter, setGoalFilter] = useState('');
    const [selectedTags, setSelectedTags] = useState([]);
    const [selectedStatuses, setSelectedStatuses] = useState([]);
    const [watchedOnly, setWatchedOnly] = useState(false);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    // Fetch stats from server
    useEffect(() => {
        let isActive = true;

        const fetchStats = async () => {
            setLoading(true);
            try {
                // Get all descendant goal IDs
                let goalIds = '';
                if (goalFilter) {
                    const ids = [goalFilter, ...getDescendantGoalIds(goals, goalFilter)];
                    goalIds = ids.join(',');
                }

                const tagParam = selectedTags.length > 0 ? `&tagIds=${selectedTags.join(',')}` : '';
                const statusParam = selectedStatuses.length > 0 ? `&statuses=${selectedStatuses.join(',')}` : '';
                const watchedParam = watchedOnly ? '&watchedOnly=1' : '';
                const res = await authFetch(`${API_BASE}/dashboard/stats?goalIds=${goalIds}${tagParam}${statusParam}${watchedParam}`);
                if (!isActive) return;

                if (res.ok) {
                    const data = await res.json();
                    if (!isActive) return;
                    setStats(data);
                } else {
                    console.error("Failed to load dashboard stats");
                }
            } catch (err) {
                if (!isActive) return;
                console.error("Error fetching stats:", err);
            } finally {
                if (isActive) {
                    setLoading(false);
                }
            }
        };

        fetchStats();
        return () => {
            isActive = false;
        };
    }, [goalFilter, selectedTags, selectedStatuses, watchedOnly, goals, authFetch]);


    // Filter goals locally for the "Total Goals" count (since that data is fully loaded)
    const getFilterGoalIds = () => {
        if (!goalFilter) return null;
        return [goalFilter, ...getDescendantGoalIds(goals, goalFilter)];
    };
    const filterGoalIds = getFilterGoalIds();
    const filterGoalSet = filterGoalIds ? new Set(filterGoalIds.map(id => String(id))) : null;
    const filteredGoals = filterGoalSet
        ? goals.filter(g => filterGoalSet.has(String(g.id)))
        : goals;
    const totalGoals = filteredGoals.length;

    const hasProjectScopedFilters = selectedTags.length > 0 || selectedStatuses.length > 0 || watchedOnly;
    const filteredProjectGoalIds = Array.isArray(stats?.filteredGoalIds)
        ? stats.filteredGoalIds.map((id) => String(id))
        : [];

    const goalsById = new Map(goals.map((goal) => [String(goal.id), goal]));
    const expandedProjectGoalIds = new Set(filteredProjectGoalIds);
    filteredProjectGoalIds.forEach((goalId) => {
        let current = goalsById.get(String(goalId));
        while (current && current.parentId) {
            const parentId = String(current.parentId);
            expandedProjectGoalIds.add(parentId);
            current = goalsById.get(parentId);
        }
    });

    const kpiGoals = hasProjectScopedFilters
        ? filteredGoals.filter((goal) => expandedProjectGoalIds.has(String(goal.id)))
        : filteredGoals;


    // Stats from Server (or 0/empty if loading)
    const totalProjects = stats?.totalProjects || 0;
    const totalTasks = stats?.totalTasks || 0;
    const completedTasks = stats?.completedTasks || 0;
    const overdueTasks = stats?.overdueTasks || [];
    const overdueCount = stats?.overdueCount || 0;
    const inProgressTasks = stats?.inProgressTasks || [];
    const inProgressCount = stats?.inProgressCount || 0;
    const avgProjectCompletion = stats?.avgProjectCompletion || 0;

    const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Goal progress is still client-side aggregated because goals are fully loaded
    // But individual goal.progress found in 'goals' might be inaccurate if DataContext calc is based on partial projects
    // For now, let's allow "Goal Progress" to be what it is, but rely on "Task Completion" from server.
    const _avgGoalProgress = filteredGoals.length > 0
        ? Math.round(filteredGoals.reduce((sum, g) => sum + (g.progress || 0), 0) / filteredGoals.length)
        : 0;



    // All KPIs across filtered goals
    const allKpis = kpiGoals.flatMap(g =>
        (g.kpis || []).map(k => ({ ...k, goalTitle: g.title }))
    );

    // KPI stats
    const totalKpis = allKpis.length;
    const onTrackKpis = allKpis.filter(k => k.target && (k.current / k.target) >= 0.5).length;
    const behindKpis = totalKpis - onTrackKpis;

    if (loading && !stats) {
        return (
            <div className="dashboard">
                <FilterBar
                    goalFilter={goalFilter}
                    onGoalFilterChange={setGoalFilter}
                    selectedTags={selectedTags}
                    onTagsChange={setSelectedTags}
                    selectedStatuses={selectedStatuses}
                    onStatusesChange={setSelectedStatuses}
                    statusOptions={STATUS_OPTIONS}
                    watchedOnly={watchedOnly}
                    onWatchedOnlyChange={setWatchedOnly}
                />

                {/* Skeleton Metric Cards */}
                <div className="metrics-grid">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="metric-card" style={{ minHeight: '80px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <div className="animate-pulse" style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--bg-secondary)' }}></div>
                                <div style={{ flex: 1 }}>
                                    <div className="animate-pulse" style={{ height: 24, width: '40%', borderRadius: 6, background: 'var(--bg-secondary)', marginBottom: 8 }}></div>
                                    <div className="animate-pulse" style={{ height: 14, width: '60%', borderRadius: 4, background: 'var(--bg-secondary)' }}></div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Skeleton Progress Section */}
                <div className="dashboard-section">
                    <div className="animate-pulse" style={{ height: 20, width: 160, borderRadius: 4, background: 'var(--bg-secondary)', marginBottom: '1rem' }}></div>
                    <div className="progress-cards">
                        {Array.from({ length: 2 }).map((_, i) => (
                            <div key={i} className="progress-card">
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <div className="animate-pulse" style={{ height: 14, width: '30%', borderRadius: 4, background: 'var(--bg-secondary)' }}></div>
                                    <div className="animate-pulse" style={{ height: 14, width: 40, borderRadius: 4, background: 'var(--bg-secondary)' }}></div>
                                </div>
                                <div className="progress-bar-track">
                                    <div className="animate-pulse" style={{ height: '100%', width: '45%', borderRadius: 4, background: 'var(--bg-secondary)' }}></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Skeleton Lists */}
                <div className="dashboard-lists">
                    {Array.from({ length: 2 }).map((_, i) => (
                        <div key={i} className="dashboard-section">
                            <div className="animate-pulse" style={{ height: 20, width: 180, borderRadius: 4, background: 'var(--bg-secondary)', marginBottom: '1rem' }}></div>
                            {Array.from({ length: 3 }).map((_, j) => (
                                <div key={j} className="animate-pulse" style={{ height: 40, borderRadius: 6, background: 'var(--bg-secondary)', marginBottom: 8 }}></div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="dashboard">
            {/* Filters */}
            <FilterBar
                goalFilter={goalFilter}
                onGoalFilterChange={setGoalFilter}
                selectedTags={selectedTags}
                onTagsChange={setSelectedTags}
                selectedStatuses={selectedStatuses}
                onStatusesChange={setSelectedStatuses}
                statusOptions={STATUS_OPTIONS}
                watchedOnly={watchedOnly}
                onWatchedOnlyChange={setWatchedOnly}
            />

            {/* Metric Cards */}
            <div className="metrics-grid">
                <div className="metric-card">
                    <div className="metric-icon" style={{ background: 'hsla(var(--hue-indigo), 60%, 60%, 0.1)', color: 'var(--accent-primary)' }}>
                        <Target size={24} />
                    </div>
                    <div className="metric-info">
                        <span className="metric-value">{totalGoals}</span>
                        <span className="metric-label">{goalFilter ? 'Goal' : 'Goals'}</span>
                    </div>
                </div>

                <div className="metric-card">
                    <div className="metric-icon" style={{ background: 'hsla(200, 80%, 50%, 0.1)', color: '#3b82f6' }}>
                        <Folder size={24} />
                    </div>
                    <div className="metric-info">
                        <span className="metric-value">{totalProjects}</span>
                        <span className="metric-label">Projects</span>
                    </div>
                </div>

                <div className="metric-card">
                    <div className="metric-icon" style={{ background: 'hsla(142, 70%, 45%, 0.1)', color: '#10b981' }}>
                        <CheckSquare size={24} />
                    </div>
                    <div className="metric-info">
                        <span className="metric-value">{completedTasks}/{totalTasks}</span>
                        <span className="metric-label">Tasks Done</span>
                    </div>
                </div>

                <div className="metric-card">
                    <div className="metric-icon" style={{ background: overdueCount > 0 ? 'hsla(0, 84%, 60%, 0.1)' : 'hsla(142, 70%, 45%, 0.1)', color: overdueCount > 0 ? '#ef4444' : '#10b981' }}>
                        <AlertTriangle size={24} />
                    </div>
                    <div className="metric-info">
                        <span className="metric-value">{overdueCount}</span>
                        <span className="metric-label">Overdue</span>
                    </div>
                </div>
            </div>

            {/* KPI Summary */}
            {totalKpis > 0 && (
                <div className="dashboard-section">
                    <h3 className="section-title">
                        <Activity size={18} />
                        KPI Performance ({totalKpis} metrics)
                    </h3>
                    <div className="kpi-summary-grid">
                        {allKpis.slice(0, 5).map(kpi => {
                            const progress = kpi.target ? Math.round((kpi.current / kpi.target) * 100) : 0;
                            const isOnTrack = progress >= 50;
                            return (
                                <div key={kpi.id} className="kpi-summary-card">
                                    <div className="kpi-summary-header">
                                        <span className="kpi-summary-name">{kpi.name}</span>
                                        <span className="kpi-summary-goal">{kpi.goalTitle}</span>
                                    </div>
                                    <div className="kpi-summary-values">
                                        <span className="kpi-summary-current">
                                            {formatKpiValue(kpi.current, kpi.unit === '$' ? '$' : '')}
                                        </span>
                                        <span className="kpi-separator" style={{ margin: '0 0.5rem', color: 'var(--text-tertiary)' }}>/</span>
                                        <span className="kpi-summary-target">
                                            {formatKpiValue(kpi.target, kpi.unit)}
                                        </span>
                                    </div>
                                    <div className="kpi-summary-bar">
                                        <div
                                            className={`kpi-summary-fill ${isOnTrack ? 'on-track' : 'behind'}`}
                                            style={{ width: `${Math.min(progress, 100)}%` }}
                                        ></div>
                                    </div>
                                    <span className={`kpi-summary-percent ${isOnTrack ? 'on-track' : 'behind'}`}>{progress}%</span>
                                </div>
                            );
                        })}
                    </div>
                    <div className="kpi-summary-stats">
                        <span className="stat on-track">✓ {onTrackKpis} on track</span>
                        <span className="stat behind">⚠ {behindKpis} behind</span>
                    </div>
                </div>
            )}

            {/* Progress Section */}
            <div className="dashboard-section">
                <h3 className="section-title">
                    <TrendingUp size={18} />
                    Overall Progress
                </h3>
                <div className="progress-cards">
                    <div className="progress-card">
                        <div className="progress-header">
                            <span>Task Completion</span>
                            <span className="progress-percent">{taskCompletionRate}%</span>
                        </div>
                        <div className="progress-bar-track">
                            <div className="progress-bar-fill" style={{ width: `${taskCompletionRate}%` }}></div>
                        </div>
                    </div>
                    {/* Switched to avgProjectCompletion from server which is more accurate than potentially partial goal progress */}
                    <div className="progress-card">
                        <div className="progress-header">
                            <span>Project Completion (Avg)</span>
                            <span className="progress-percent">{avgProjectCompletion}%</span>
                        </div>
                        <div className="progress-bar-track">
                            <div className="progress-bar-fill" style={{ width: `${avgProjectCompletion}%` }}></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Lists Section */}
            <div className="dashboard-lists">
                {/* Overdue Tasks */}
                <div className="dashboard-section">
                    <h3 className="section-title danger">
                        <AlertTriangle size={18} />
                        Overdue Tasks ({overdueCount})
                    </h3>
                    {overdueTasks.length === 0 ? (
                        <p className="empty-message">No overdue tasks! 🎉</p>
                    ) : (
                        <ul className="task-list">
                            {overdueTasks.map(task => (
                                <li key={task.id} className="task-list-item overdue">
                                    <span className="task-title">{task.title}</span>
                                    <span className="task-due">End: {new Date(task.endDate || task.dueDate).toLocaleDateString()}</span>
                                    <span className="task-project-tag">{task.projectTitle}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* In Progress */}
                <div className="dashboard-section">
                    <h3 className="section-title">
                        <BarChart3 size={18} />
                        In Progress ({inProgressCount})
                    </h3>
                    {inProgressTasks.length === 0 ? (
                        <div className="empty-state-enhanced">
                            <Coffee size={32} className="empty-state-icon" />
                            <p className="empty-state-title">No tasks in progress</p>
                            <p className="empty-state-hint">Click a task and change its status to start working.</p>
                        </div>
                    ) : (
                        <ul className="task-list">
                            {inProgressTasks.map(task => (
                                <li key={task.id} className="task-list-item">
                                    <span className="task-title">{task.title}</span>
                                    <span className="task-project-tag">{task.projectTitle}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}

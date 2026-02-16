import { useState } from 'react';
import { useData } from '../../context/DataContext';
import { BarChart3, Target, Folder, CheckSquare, AlertTriangle, TrendingUp, Activity, PlayCircle, Coffee } from 'lucide-react';
import { CascadingGoalFilter, getDescendantGoalIds } from '../UI/CascadingGoalFilter';
import './Dashboard.css';

export function Dashboard() {
    const { goals, projects } = useData();
    const [goalFilter, setGoalFilter] = useState('');



    // Get all goal IDs to filter by (selected + descendants)
    const getFilterGoalIds = () => {
        if (!goalFilter) return null;
        const ids = [goalFilter, ...getDescendantGoalIds(goals, goalFilter)];
        return ids;
    };

    const filterGoalIds = getFilterGoalIds();

    // Filter projects by goal (including descendants)
    const filteredProjects = filterGoalIds
        ? projects.filter(p => filterGoalIds.includes(p.goalId))
        : projects;

    // Filter goals (including descendants)
    const filteredGoals = filterGoalIds
        ? goals.filter(g => filterGoalIds.includes(g.id))
        : goals;

    // Calculate metrics based on filtered data
    const totalGoals = filteredGoals.length;
    const totalProjects = filteredProjects.length;
    // Use taskCount if available (from summary), otherwise fallback to tasks array length
    // Use taskCount if available (from summary), otherwise fallback to tasks array length
    const totalTasks = filteredProjects.reduce((sum, p) => sum + (p.taskCount || (p.tasks || []).length), 0);

    // Use completedTaskCount if available (from summary), otherwise fallback to calculating from tasks array
    const completedTasks = filteredProjects.reduce((sum, p) => {
        if (p.completedTaskCount !== undefined) return sum + p.completedTaskCount;
        return sum + (p.tasks || []).filter(t => t.status === 'done').length;
    }, 0);
    const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Overdue tasks (use endDate, fallback to dueDate)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdueTasks = filteredProjects.flatMap(p =>
        (p.tasks || []).filter(t => {
            const endDate = t.endDate || t.dueDate;
            return endDate && new Date(endDate) < today && t.status !== 'done';
        })
    );

    // In-progress tasks
    const inProgressTasks = filteredProjects.flatMap(p =>
        (p.tasks || []).filter(t => t.status === 'in-progress')
    );

    // Average goal progress
    const avgGoalProgress = filteredGoals.length > 0
        ? Math.round(filteredGoals.reduce((sum, g) => sum + (g.progress || 0), 0) / filteredGoals.length)
        : 0;

    // Helper for formatting values with units
    const formatKpiValue = (val, unit) => {
        if (!val && val !== 0) return '-';
        if (unit === '$') return `$${val.toLocaleString()}`;
        if (unit === '%') return `${val.toLocaleString()}%`;
        if (unit) return `${val.toLocaleString()} ${unit}`;
        return val.toLocaleString();
    };

    // All KPIs across filtered goals
    const allKpis = filteredGoals.flatMap(g =>
        (g.kpis || []).map(k => ({ ...k, goalTitle: g.title }))
    );

    // KPI stats
    const totalKpis = allKpis.length;
    const onTrackKpis = allKpis.filter(k => k.target && (k.current / k.target) >= 0.5).length;
    const behindKpis = totalKpis - onTrackKpis;

    // Get goal name for display
    const selectedGoalName = goalFilter
        ? goals.find(g => g.id === goalFilter)?.title
        : null;

    return (
        <div className="dashboard">
            <div className="view-header">
                <div>
                    <h2>Dashboard</h2>
                    <p className="view-subtitle">
                        {selectedGoalName
                            ? `Filtered by: ${selectedGoalName}`
                            : 'Overview of your goals, projects, and tasks.'
                        }
                    </p>
                </div>
            </div>

            {/* Cascading Goal Filter */}
            <div className="filter-bar">
                <CascadingGoalFilter value={goalFilter} onChange={setGoalFilter} />
            </div>

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
                    <div className="metric-icon" style={{ background: overdueTasks.length > 0 ? 'hsla(0, 84%, 60%, 0.1)' : 'hsla(142, 70%, 45%, 0.1)', color: overdueTasks.length > 0 ? '#ef4444' : '#10b981' }}>
                        <AlertTriangle size={24} />
                    </div>
                    <div className="metric-info">
                        <span className="metric-value">{overdueTasks.length}</span>
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
                        {allKpis.slice(0, 6).map(kpi => {
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
                    <div className="progress-card">
                        <div className="progress-header">
                            <span>Goal Progress (Avg)</span>
                            <span className="progress-percent">{avgGoalProgress}%</span>
                        </div>
                        <div className="progress-bar-track">
                            <div className="progress-bar-fill" style={{ width: `${avgGoalProgress}%` }}></div>
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
                        Overdue Tasks ({overdueTasks.length})
                    </h3>
                    {overdueTasks.length === 0 ? (
                        <p className="empty-message">No overdue tasks! 🎉</p>
                    ) : (
                        <ul className="task-list">
                            {overdueTasks.slice(0, 5).map(task => (
                                <li key={task.id} className="task-list-item overdue">
                                    <span className="task-title">{task.title}</span>
                                    <span className="task-due">End: {new Date(task.endDate || task.dueDate).toLocaleDateString()}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* In Progress */}
                <div className="dashboard-section">
                    <h3 className="section-title">
                        <BarChart3 size={18} />
                        In Progress ({inProgressTasks.length})
                    </h3>
                    {inProgressTasks.length === 0 ? (
                        <div className="empty-state-enhanced">
                            <Coffee size={32} className="empty-state-icon" />
                            <p className="empty-state-title">No tasks in progress</p>
                            <p className="empty-state-hint">Click a task and change its status to start working.</p>
                        </div>
                    ) : (
                        <ul className="task-list">
                            {inProgressTasks.slice(0, 5).map(task => (
                                <li key={task.id} className="task-list-item">
                                    <span className="task-title">{task.title}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}

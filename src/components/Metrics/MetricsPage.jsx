
import { useState, useMemo, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import { CascadingGoalFilter, getDescendantGoalIds } from '../UI/CascadingGoalFilter';
import { TrendingUp, Target, BarChart2 } from 'lucide-react';
import './MetricsPage.css';

export function MetricsPage({ initialGoalFilter, onClearFilter }) {
    const { goals, hasPermission } = useData();
    const [goalFilter, setGoalFilter] = useState(initialGoalFilter || '');

    // Sync with external filter changes
    useEffect(() => {
        if (initialGoalFilter) {
            setGoalFilter(initialGoalFilter);
        }
    }, [initialGoalFilter]);

    const handleFilterChange = (newGoalId) => {
        setGoalFilter(newGoalId);
        if (!newGoalId && onClearFilter) onClearFilter();
    };

    // Flatten all KPIs from goals into a single list with context
    const allMetrics = useMemo(() => {
        return goals.flatMap(goal => {
            if (!goal.kpis) return [];
            return goal.kpis.map(kpi => ({
                ...kpi,
                goalId: goal.id,
                goalTitle: goal.title,
                goalType: goal.type
            }));
        });
    }, [goals]);

    // Filter metrics based on cascading goal selection
    const filteredMetrics = useMemo(() => {
        if (!goalFilter) return allMetrics;

        // Get filter goal + descendants
        // IDs are strings from API. cascading filter value is string.
        const descendantIds = getDescendantGoalIds(goals, goalFilter);
        const relevantGoalIds = [String(goalFilter), ...descendantIds.map(String)];

        return allMetrics.filter(m => relevantGoalIds.includes(String(m.goalId)));
    }, [allMetrics, goalFilter, goals]);

    // Calculate progress helper
    const calcProgress = (current, target) => {
        if (!target) return 0;
        return Math.min(100, Math.round((current / target) * 100));
    };

    // Helper for formatting values with units
    const formatKpiValue = (val, unit) => {
        if (!val && val !== 0) return '-';
        if (unit === '$') return `$${val.toLocaleString()}`;
        if (unit === '%') return `${val.toLocaleString()}%`;
        if (unit) return `${val.toLocaleString()} ${unit}`;
        return val.toLocaleString();
    };

    if (!hasPermission('can_view_metrics')) {
        return (
            <div className="access-denied">
                <h2>Access Denied</h2>
                <p>You do not have permission to view the Metrics Dashboard.</p>
            </div>
        );
    }

    return (
        <div className="metrics-page">
            <div className="metrics-header">
                <div>
                    <h1><BarChart2 size={24} style={{ display: 'inline', marginRight: '0.5rem' }} /> Metrics Dashboard</h1>
                    <p className="subtitle">Track Key Performance Indicators across the organization.</p>
                </div>
            </div>

            <div className="metrics-filter-bar">
                <CascadingGoalFilter value={goalFilter} onChange={handleFilterChange} />
                <span className="Metric-count" style={{ fontWeight: 600 }}>
                    {filteredMetrics.length} Metrics Found
                </span>
            </div>

            {/* Debug Info - Temporary */}
            {/* <div style={{ fontSize: '0.75rem', color: '#999', padding: '0.5rem', border: '1px dashed #ccc', marginBottom: '1rem' }}>
                DEBUG: Goals: {goals.length}, Total Metrics: {allMetrics.length}, Filtered: {filteredMetrics.length}, Filter: "{goalFilter}"
            </div> */}

            {filteredMetrics.length === 0 ? (
                <div className="empty-metrics">
                    <TrendingUp size={48} style={{ marginBottom: '1rem', opacity: 0.5 }} />
                    <p>No metrics found matching your criteria.</p>
                </div>
            ) : (
                <div className="metrics-grid">
                    {filteredMetrics.map(metric => {
                        const progress = calcProgress(metric.current, metric.target);
                        const isOnTrack = progress >= 50;
                        const goalId = String(metric.goalId); // ensure string

                        return (
                            <div key={metric.id} className="metric-card">
                                <div className="metric-card-header">
                                    <span className="metric-name">{metric.name}</span>
                                    <span className="metric-goal-badge" title={`Goal: ${metric.goalTitle}`}>
                                        {metric.goalTitle}
                                    </span>
                                </div>

                                <div className="metric-values">
                                    <div className="metric-current-container">
                                        <span className="metric-current">
                                            {formatKpiValue(metric.current, metric.unit === '$' ? '$' : '')}
                                        </span>
                                        <span className="metric-separator" style={{ margin: '0 0.5rem', color: 'var(--text-tertiary)' }}>/</span>
                                        <span className="metric-target">
                                            {formatKpiValue(metric.target, metric.unit)}
                                        </span>
                                    </div>
                                </div>

                                <div className="metric-progress">
                                    <div
                                        className={`metric-progress-fill ${isOnTrack ? 'on-track' : 'behind'}`}
                                        style={{ width: `${progress}%` }}
                                    ></div>
                                </div>

                                <div className={`metric-status ${isOnTrack ? 'on-track' : 'behind'}`}>
                                    {progress}%
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

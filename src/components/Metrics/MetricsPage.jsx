
import { useState, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { getDescendantGoalIds } from '../../utils/goalHelpers';
import { FilterBar } from '../UI/FilterBar';
import { TrendingUp, Target, BarChart2 } from 'lucide-react';
import { formatKpiValue } from '../../utils';
import './MetricsPage.css';

export function MetricsPage({ initialGoalFilter, onClearFilter }) {
    const { goals, projects, hasPermission } = useData();
    const [goalFilter, setGoalFilter] = useState(initialGoalFilter || '');
    const [selectedTags, setSelectedTags] = useState([]);

    // Sync with external filter changes (Derived State Pattern)
    const [prevInitialFilter, setPrevInitialFilter] = useState(initialGoalFilter);
    if (initialGoalFilter !== prevInitialFilter) {
        setPrevInitialFilter(initialGoalFilter);
        if (initialGoalFilter) {
            setGoalFilter(initialGoalFilter);
        }
    }

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

    // Filter metrics based on cascading goal selection and tags
    const filteredMetrics = useMemo(() => {
        let metrics = allMetrics;

        // Filter by goal
        if (goalFilter) {
            const descendantIds = getDescendantGoalIds(goals, goalFilter);
            const relevantGoalIds = [String(goalFilter), ...descendantIds.map(String)];
            metrics = metrics.filter(m => relevantGoalIds.includes(String(m.goalId)));
        }

        // Filter by tags: only show metrics from goals that have tagged projects
        if (selectedTags.length > 0) {
            // Find all goal IDs that have at least one project with a matching tag
            const goalsWithTaggedProjects = new Set();
            projects.forEach(p => {
                if (p.tags && p.tags.some(t => selectedTags.includes(String(t.id)))) {
                    if (p.goalId) goalsWithTaggedProjects.add(String(p.goalId));
                }
            });
            // Also include ancestor goals so parent-level KPIs still show
            const expandedGoalIds = new Set(goalsWithTaggedProjects);
            goalsWithTaggedProjects.forEach(gId => {
                let current = goals.find(g => String(g.id) === gId);
                while (current && current.parentId) {
                    expandedGoalIds.add(String(current.parentId));
                    current = goals.find(g => String(g.id) === String(current.parentId));
                }
            });
            metrics = metrics.filter(m => expandedGoalIds.has(String(m.goalId)));
        }

        return metrics;
    }, [allMetrics, goalFilter, selectedTags, goals, projects]);

    // Calculate progress helper
    const calcProgress = (current, target) => {
        if (!target) return 0;
        return Math.min(100, Math.round((current / target) * 100));
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

            <FilterBar
                goalFilter={goalFilter}
                onGoalFilterChange={handleFilterChange}
                selectedTags={selectedTags}
                onTagsChange={setSelectedTags}
                countLabel={`${filteredMetrics.length} Metrics Found`}
            />

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
                        const _goalId = String(metric.goalId); // ensure string

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

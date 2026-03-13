import { Plus, ChevronsDown, ChevronsUp } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import { GoalItem } from './GoalItem';
import { Modal } from '../UI/Modal';
import { AddGoalForm } from './AddGoalForm';
import { FilterBar } from '../UI/FilterBar';
import { EmptyState } from '../UI/EmptyState';
import { API_BASE } from '../../apiClient';
import './Goals.css';
import { getGoalTypeGoalLabel } from '../../../shared/goalLevels.js';

const STATUS_OPTIONS = [
    { id: 'red', label: 'Red', color: '#ef4444' },
    { id: 'yellow', label: 'Yellow', color: '#f59e0b' },
    { id: 'green', label: 'Green', color: '#10b981' },
    { id: 'unknown', label: 'No Report', color: '#9ca3af' }
];

export function GoalView({ onNavigateToProjects, onNavigateToMetrics }) {
    const { goals, projects, fetchExecSummaryProjects, authFetch, hasPermission } = useData();
    const canCreateGoal = hasPermission('can_create_goal');
    const [showAddModal, setShowAddModal] = useState(false);
    const [goalFilter, setGoalFilter] = useState('');
    const [selectedTags, setSelectedTags] = useState([]);
    const [selectedStatuses, setSelectedStatuses] = useState([]);
    const [watchedOnly, setWatchedOnly] = useState(false);
    const [allProjects, setAllProjects] = useState([]);
    const [goalRows, setGoalRows] = useState(goals);
    const [goalLifecycleFilter, setGoalLifecycleFilter] = useState('active');
    const [expandAll, setExpandAll] = useState(null); // null = individual control, true = all expanded, false = all collapsed

    useEffect(() => {
        let isMounted = true;
        fetchExecSummaryProjects({ lifecycle: goalLifecycleFilter })
            .then(data => {
                if (isMounted && Array.isArray(data)) {
                    setAllProjects(data);
                }
            })
            .catch(() => {
                // Keep fallback to context projects on fetch failure
            });

        return () => { isMounted = false; };
    }, [fetchExecSummaryProjects, goalLifecycleFilter]);

    useEffect(() => {
        let cancelled = false;

        async function loadGoalsForLifecycle() {
            if (goalLifecycleFilter === 'active') {
                if (!cancelled) setGoalRows(goals);
                return;
            }
            try {
                const res = await authFetch(`${API_BASE}/goals?lifecycle=${encodeURIComponent(goalLifecycleFilter)}`);
                if (!res.ok) return;
                const rows = await res.json();
                if (!cancelled) {
                    setGoalRows(Array.isArray(rows) ? rows : []);
                }
            } catch (error) {
                console.error('Failed to load lifecycle-filtered goals', error);
            }
        }

        loadGoalsForLifecycle();
        return () => { cancelled = true; };
    }, [authFetch, goals, goalLifecycleFilter]);

    const projectsForFilters = (allProjects.length > 0 ? allProjects : projects)
        .filter(project => !watchedOnly || !!project.isWatched);

    // Get filtered root goals based on cascading filter
    const getFilteredRootGoals = () => {
        if (!goalFilter) {
            // No filter - show all root goals
            return goalRows.filter(g => !g.parentId);
        }

        // Get the selected goal
        const selectedGoal = goalRows.find(g => g.id === goalFilter);
        if (!selectedGoal) return goalRows.filter(g => !g.parentId);

        // Return the selected goal as root (it becomes the tree root when filtered)
        return [selectedGoal];
    };

    const filteredRootGoals = getFilteredRootGoals();

    const handleExpandAll = () => {
        setExpandAll(true);
        // Reset to null after a tick so individual control resumes
        setTimeout(() => setExpandAll(null), 50);
    };

    const handleCollapseAll = () => {
        setExpandAll(false);
        setTimeout(() => setExpandAll(null), 50);
    };

    return (
        <div className="goals-view">
            <div className="view-header actions-only">
                <div className="header-actions">
                    <div className="expand-controls">
                        <button
                            className="btn-secondary btn-sm"
                            onClick={handleExpandAll}
                            title="Expand All"
                        >
                            <ChevronsDown size={16} />
                            Expand
                        </button>
                        <button
                            className="btn-secondary btn-sm"
                            onClick={handleCollapseAll}
                            title="Collapse All"
                        >
                            <ChevronsUp size={16} />
                            Collapse
                        </button>
                    </div>
                    {canCreateGoal && (
                        <button className="btn-primary" onClick={() => setShowAddModal(true)}>
                            <Plus size={18} />
                            New Goal
                        </button>
                    )}
                </div>
            </div>

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
                countLabel={`${filteredRootGoals.length} root goal(s)`}
            >
                <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                    {[
                        { id: 'active', label: 'Active' },
                        { id: 'archived', label: 'Archived' },
                        { id: 'all', label: 'All' }
                    ].map((option) => (
                        <button
                            key={option.id}
                            type="button"
                            className={`btn-secondary btn-sm ${goalLifecycleFilter === option.id ? 'active' : ''}`}
                            onClick={() => setGoalLifecycleFilter(option.id)}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </FilterBar>

            <div className="goals-tree-container">
                {filteredRootGoals.length === 0 ? (
                    <EmptyState
                        title={goalLifecycleFilter === 'archived' ? 'No archived goals found' : 'No goals found'}
                        message={goalLifecycleFilter === 'archived'
                            ? 'There are no retired or archived goals available for the current filters.'
                            : `No goals defined. Start by adding an ${getGoalTypeGoalLabel('enterprise')}.`}
                    />
                ) : (
                    filteredRootGoals.map(goal => (
                        <GoalItem
                            key={goal.id}
                            goal={goal}
                            allGoals={goalRows}
                            level={0}
                            onNavigateToProjects={onNavigateToProjects}
                            onNavigateToMetrics={onNavigateToMetrics}
                            forceExpand={expandAll}
                            selectedTags={selectedTags}
                            selectedStatuses={selectedStatuses}
                            watchedOnly={watchedOnly}
                            projectsSource={projectsForFilters}
                        />
                    ))
                )}
            </div>

            <Modal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                title="Create Goal"
            >
                <AddGoalForm onClose={() => setShowAddModal(false)} parentId={null} />
            </Modal>
        </div>
    );
}


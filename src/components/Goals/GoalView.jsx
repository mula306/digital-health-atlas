import { Plus, ChevronsDown, ChevronsUp } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import { GoalItem } from './GoalItem';
import { Modal } from '../UI/Modal';
import { AddGoalForm } from './AddGoalForm';
import { FilterBar } from '../UI/FilterBar';
import { EmptyState } from '../UI/EmptyState';
import './Goals.css';

import { useAuth } from '../../hooks/useAuth';

const STATUS_OPTIONS = [
    { id: 'red', label: 'Red', color: '#ef4444' },
    { id: 'yellow', label: 'Yellow', color: '#f59e0b' },
    { id: 'green', label: 'Green', color: '#10b981' },
    { id: 'unknown', label: 'No Report', color: '#9ca3af' }
];

export function GoalView({ onNavigateToProjects, onNavigateToMetrics }) {
    const { goals, projects, fetchExecSummaryProjects } = useData();
    const { canEdit } = useAuth();
    const [showAddModal, setShowAddModal] = useState(false);
    const [goalFilter, setGoalFilter] = useState('');
    const [selectedTags, setSelectedTags] = useState([]);
    const [selectedStatuses, setSelectedStatuses] = useState([]);
    const [allProjects, setAllProjects] = useState([]);
    const [expandAll, setExpandAll] = useState(null); // null = individual control, true = all expanded, false = all collapsed

    useEffect(() => {
        let isMounted = true;
        fetchExecSummaryProjects()
            .then(data => {
                if (isMounted && Array.isArray(data)) {
                    setAllProjects(data);
                }
            })
            .catch(() => {
                // Keep fallback to context projects on fetch failure
            });

        return () => { isMounted = false; };
    }, [fetchExecSummaryProjects]);

    const projectsForFilters = allProjects.length > 0 ? allProjects : projects;

    // Get filtered root goals based on cascading filter
    const getFilteredRootGoals = () => {
        if (!goalFilter) {
            // No filter - show all root goals
            return goals.filter(g => !g.parentId);
        }

        // Get the selected goal
        const selectedGoal = goals.find(g => g.id === goalFilter);
        if (!selectedGoal) return goals.filter(g => !g.parentId);

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
                    {canEdit && (
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
            />

            <div className="goals-tree-container">
                {filteredRootGoals.length === 0 ? (
                    <EmptyState
                        title="No goals found"
                        message="No goals defined. Start by adding an Organization Goal."
                    />
                ) : (
                    filteredRootGoals.map(goal => (
                        <GoalItem
                            key={goal.id}
                            goal={goal}
                            level={0}
                            onNavigateToProjects={onNavigateToProjects}
                            onNavigateToMetrics={onNavigateToMetrics}
                            forceExpand={expandAll}
                            selectedTags={selectedTags}
                            selectedStatuses={selectedStatuses}
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


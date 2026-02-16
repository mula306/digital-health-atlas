import { Plus, ChevronsDown, ChevronsUp } from 'lucide-react';
import { useState } from 'react';
import { useData } from '../../context/DataContext';
import { GoalItem } from './GoalItem';
import { Modal } from '../UI/Modal';
import { AddGoalForm } from './AddGoalForm';
import { CascadingGoalFilter, getDescendantGoalIds } from '../UI/CascadingGoalFilter';
import './Goals.css';

import { useAuth } from '../../hooks/useAuth';

export function GoalView({ onNavigateToProjects, onNavigateToMetrics }) {
    const { goals } = useData();
    const { canEdit } = useAuth();
    const [showAddModal, setShowAddModal] = useState(false);
    const [goalFilter, setGoalFilter] = useState('');
    const [expandAll, setExpandAll] = useState(null); // null = individual control, true = all expanded, false = all collapsed

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
            <div className="view-header">
                <div>
                    <h2>Strategic Goals</h2>
                    <p className="view-subtitle">Align organization objectives from top to bottom.</p>
                </div>
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

            {/* Cascading Filter */}
            <div className="filter-bar">
                <CascadingGoalFilter value={goalFilter} onChange={setGoalFilter} />
            </div>

            <div className="goals-tree-container">
                {filteredRootGoals.length === 0 ? (
                    <div className="empty-state glass">
                        <p>No goals defined. Start by adding an Organization Goal.</p>
                    </div>
                ) : (
                    filteredRootGoals.map(goal => (
                        <GoalItem
                            key={goal.id}
                            goal={goal}
                            level={0}
                            onNavigateToProjects={onNavigateToProjects}
                            onNavigateToMetrics={onNavigateToMetrics}
                            forceExpand={expandAll}
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


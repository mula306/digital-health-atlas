import { ChevronRight, ChevronDown, Plus, MoreHorizontal, Folder, Edit, Trash2, Activity } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { Modal } from '../UI/Modal';
import { AddGoalForm } from './AddGoalForm';
import { EditGoalForm } from './EditGoalForm';
import { KPIManager } from './KPIManager';
import './KPI.css';
import { getDescendantGoalIds } from '../../utils/goalHelpers';

import { useAuth } from '../../hooks/useAuth';

export function GoalItem({
    goal,
    level = 0,
    onNavigateToProjects,
    onNavigateToMetrics,
    forceExpand,
    selectedTags = [],
    selectedStatuses = [],
    projectsSource = []
}) {
    const { goals, deleteGoal, projects } = useData();
    const { canEdit, canDelete } = useAuth();
    const toast = useToast();
    const [isExpanded, setIsExpanded] = useState(level === 0);
    const [childrenCollapsed, setChildrenCollapsed] = useState(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const menuRef = useRef(null);

    // Respond to forceExpand prop from parent
    // Respond to forceExpand prop from parent (Derived State Pattern)
    const [prevForceExpand, setPrevForceExpand] = useState(forceExpand);
    if (forceExpand !== prevForceExpand) {
        setPrevForceExpand(forceExpand);
        if (forceExpand !== null && forceExpand !== undefined) {
            setIsExpanded(forceExpand);
            setChildrenCollapsed(forceExpand ? null : false);
        }
    }

    const childGoals = goals.filter(g => g.parentId === goal.id);
    const hasChildren = childGoals.length > 0;

    // Use pre-calculated counts from DataContext (server-backed)
    // When tags are selected, compute count client-side from loaded projects
    const projectCount = (() => {
        if (selectedTags.length === 0 && selectedStatuses.length === 0) return goal.totalProjectCount || 0;

        const sourceProjects = projectsSource.length > 0 ? projectsSource : projects;
        // Get all goal IDs in this subtree (this goal + descendants)
        const allGoalIds = new Set([String(goal.id), ...getDescendantGoalIds(goals, goal.id).map(String)]);

        return sourceProjects.filter(p => {
            const inGoalTree = allGoalIds.has(String(p.goalId));
            if (!inGoalTree) return false;

            if (selectedTags.length > 0) {
                const tagMatch = p.tags && p.tags.some(t => selectedTags.includes(String(t.tagId ?? t.id)));
                if (!tagMatch) return false;
            }

            if (selectedStatuses.length > 0) {
                const statusValue = p.report?.overallStatus || p.latestReport?.overallStatus || 'unknown';
                const normalizedStatus = String(statusValue).toLowerCase();
                if (!selectedStatuses.includes(normalizedStatus)) return false;
            }

            return true;
        }).length;
    })();

    const typeLabels = {
        org: 'Organization',
        div: 'Division',
        dept: 'Department',
        branch: 'Branch'
    };

    const typeColors = {
        org: 'var(--accent-primary)',
        div: '#10b981',
        dept: '#f59e0b',
        branch: '#ec4899',
    };

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setShowMenu(false);
                setConfirmDelete(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleProjectCountClick = (e) => {
        e.stopPropagation();
        if (onNavigateToProjects) {
            onNavigateToProjects(goal.id);
        }
    };

    const handleKpiClick = (e) => {
        e.stopPropagation();
        if (onNavigateToMetrics) {
            onNavigateToMetrics(goal.id);
        }
    };

    const handleMenuToggle = (e) => {
        e.stopPropagation();
        setShowMenu(!showMenu);
        setConfirmDelete(false);
    };

    const handleEdit = () => {
        setShowMenu(false);
        setShowEditModal(true);
    };

    const handleDelete = () => {
        if (confirmDelete) {
            deleteGoal(goal.id);
            toast.success('Goal deleted');
            setShowMenu(false);
        } else {
            setConfirmDelete(true);
        }
    };

    return (
        <div className="goal-item-container" style={{ '--level': level }} data-level={level}>
            <div className="goal-card glass">
                <div className="goal-header">
                    <button
                        className={`expand-btn ${hasChildren ? '' : 'hidden'}`}
                        onClick={() => {
                            if (isExpanded) {
                                setChildrenCollapsed(false);
                                setTimeout(() => setChildrenCollapsed(null), 50);
                            }
                            setIsExpanded(!isExpanded);
                        }}
                    >
                        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </button>

                    <div className="goal-info">
                        <div className="goal-top-row">
                            <span
                                className="goal-type-badge"
                                style={{ backgroundColor: typeColors[goal.type] || 'gray' }}
                            >
                                {typeLabels[goal.type]}
                            </span>
                            <div className="goal-actions">
                                {/* KPI indicator */}
                                {(goal.totalKpiCount > 0 || (goal.kpis && goal.kpis.length > 0)) && (
                                    <button
                                        className="kpi-indicator"
                                        title={`View ${goal.totalKpiCount} Total KPI(s) (including sub-goals)`}
                                        onClick={handleKpiClick}
                                    >
                                        <Activity size={14} />
                                        <span>{goal.totalKpiCount || goal.kpis?.length || 0}</span>
                                    </button>
                                )}
                                {/* Project count link */}
                                <button
                                    className="project-count-btn"
                                    onClick={handleProjectCountClick}
                                    title={`View ${projectCount} linked project(s)`}
                                >
                                    <Folder size={14} />
                                    <span>{projectCount}</span>
                                </button>
                                {canEdit && goal.type !== 'branch' && (
                                    <button className="icon-btn" onClick={() => setShowAddModal(true)} title="Add Sub-goal">
                                        <Plus size={16} />
                                    </button>
                                )}

                                {/* Dropdown Menu - only show if canEdit or canDelete */}
                                {(canEdit || canDelete) && (
                                    <div className="goal-menu-container" ref={menuRef}>
                                        <button className="icon-btn" onClick={handleMenuToggle}>
                                            <MoreHorizontal size={16} />
                                        </button>

                                        {showMenu && (
                                            <div className="goal-dropdown-menu">
                                                {canEdit && (
                                                    <button className="menu-item" onClick={handleEdit}>
                                                        <Edit size={14} />
                                                        Edit Goal
                                                    </button>
                                                )}
                                                {canDelete && (
                                                    <button
                                                        className={`menu-item danger ${confirmDelete ? 'confirm' : ''}`}
                                                        onClick={handleDelete}
                                                    >
                                                        <Trash2 size={14} />
                                                        {confirmDelete ? 'Click to Confirm' : 'Delete Goal'}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                        <h3 className="goal-title">{goal.title}</h3>
                        {goal.description && <p className="goal-desc">{goal.description}</p>}



                        <div className="goal-progress-bar">
                            <div
                                className="progress-fill"
                                style={{ width: `${goal.progress || 0}%`, backgroundColor: typeColors[goal.type] }}
                            ></div>
                        </div>
                        <span className="goal-progress-text">{goal.progress}% Complete</span>
                    </div>
                </div>
            </div>

            {isExpanded && hasChildren && (
                <div className="goal-children">
                    {childGoals.map(child => (
                        <GoalItem
                            key={child.id}
                            goal={child}
                            level={level + 1}
                            onNavigateToProjects={onNavigateToProjects}
                            onNavigateToMetrics={onNavigateToMetrics}
                            forceExpand={childrenCollapsed !== null ? childrenCollapsed : forceExpand}
                            selectedTags={selectedTags}
                            selectedStatuses={selectedStatuses}
                            projectsSource={projectsSource}
                        />
                    ))}

                </div>
            )}

            <Modal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                title={`Add Objective under "${goal.title}"`}
                closeOnOverlayClick={false}
            >
                <AddGoalForm onClose={() => setShowAddModal(false)} parentId={goal.id} parentType={goal.type} />
            </Modal>

            <Modal
                isOpen={showEditModal}
                onClose={() => setShowEditModal(false)}
                title="Edit Goal"
                closeOnOverlayClick={false}
            >
                <EditGoalForm goal={goal} onClose={() => setShowEditModal(false)} />
                <KPIManager goalId={goal.id} kpis={goal.kpis || []} />
            </Modal>
        </div>
    );
}

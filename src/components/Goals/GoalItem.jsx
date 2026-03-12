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
import {
    GOAL_LEAF_TYPE,
    getGoalTypeGoalLabel,
    getGoalTypeLabel,
    getNextGoalType
} from '../../../shared/goalLevels.js';

export function GoalItem({
    goal,
    level = 0,
    onNavigateToProjects,
    onNavigateToMetrics,
    forceExpand,
    selectedTags = [],
    selectedStatuses = [],
    watchedOnly = false,
    projectsSource = []
}) {
    const { goals, deleteGoal, projects, hasPermission } = useData();
    const canCreateGoal = hasPermission('can_create_goal');
    const canEditGoal = hasPermission('can_edit_goal');
    const canDeleteGoal = hasPermission('can_delete_goal');
    const canManageKpis = hasPermission('can_manage_kpis');
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

    const hasScopedFilters = watchedOnly || selectedTags.length > 0 || selectedStatuses.length > 0;
    const sourceProjects = projectsSource.length > 0 ? projectsSource : projects;
    // Get all goal IDs in this subtree (this goal + descendants)
    const allGoalIds = new Set([String(goal.id), ...getDescendantGoalIds(goals, goal.id).map(String)]);
    const scopedProjects = sourceProjects.filter((project) => {
        const projectGoalIds = (project.goalIds || (project.goalId ? [project.goalId] : [])).map(String);
        const inGoalTree = projectGoalIds.some((goalId) => allGoalIds.has(goalId));
        if (!inGoalTree) return false;

        if (watchedOnly && !project.isWatched) {
            return false;
        }

        if (selectedTags.length > 0) {
            const tagMatch = project.tags && project.tags.some((tag) => selectedTags.includes(String(tag.tagId ?? tag.id)));
            if (!tagMatch) return false;
        }

        if (selectedStatuses.length > 0) {
            const statusValue = project.report?.overallStatus || project.latestReport?.overallStatus || 'unknown';
            const normalizedStatus = String(statusValue).toLowerCase();
            if (!selectedStatuses.includes(normalizedStatus)) return false;
        }

        return true;
    });

    const projectCount = hasScopedFilters ? scopedProjects.length : (goal.totalProjectCount || 0);
    const scopedKpiCount = (() => {
        if (!hasScopedFilters) {
            return goal.totalKpiCount || goal.kpis?.length || 0;
        }

        if (scopedProjects.length === 0) return 0;

        const subtreeGoalIds = new Set([...allGoalIds]);
        const scopedProjectGoalIds = new Set();
        scopedProjects.forEach((project) => {
            const projectGoalIds = (project.goalIds || (project.goalId ? [project.goalId] : [])).map(String);
            projectGoalIds.forEach((projectGoalId) => {
                if (subtreeGoalIds.has(projectGoalId)) {
                    scopedProjectGoalIds.add(projectGoalId);
                }
            });
        });

        if (scopedProjectGoalIds.size === 0) return 0;

        // Include ancestor goals inside this subtree so parent-level KPIs still count
        const includedGoalIds = new Set();
        scopedProjectGoalIds.forEach((projectGoalId) => {
            let current = goals.find((g) => String(g.id) === String(projectGoalId));
            while (current && subtreeGoalIds.has(String(current.id))) {
                includedGoalIds.add(String(current.id));
                if (!current.parentId) break;
                current = goals.find((g) => String(g.id) === String(current.parentId));
            }
        });

        return goals.reduce((sum, currentGoal) => {
            if (!includedGoalIds.has(String(currentGoal.id))) return sum;
            return sum + (Array.isArray(currentGoal.kpis) ? currentGoal.kpis.length : 0);
        }, 0);
    })();

    const progressValue = (() => {
        if (!hasScopedFilters) return goal.progress || 0;
        if (scopedProjects.length === 0) return 0;

        const completions = scopedProjects
            .map((project) => Number(project.completion))
            .filter((value) => Number.isFinite(value));

        if (completions.length === 0) {
            return goal.progress || 0;
        }

        const total = completions.reduce((sum, value) => sum + value, 0);
        return Math.round(total / completions.length);
    })();

    const typeColors = {
        enterprise: '#1d4ed8',
        portfolio: '#047857',
        service: '#b45309',
        team: '#be185d',
    };

    const typeBadgeStyles = {
        enterprise: {
            background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)',
            color: '#eff6ff',
            borderColor: 'rgba(37, 99, 235, 0.45)'
        },
        portfolio: {
            background: 'linear-gradient(135deg, #047857 0%, #059669 100%)',
            color: '#ecfdf5',
            borderColor: 'rgba(5, 150, 105, 0.4)'
        },
        service: {
            background: 'linear-gradient(135deg, #b45309 0%, #d97706 100%)',
            color: '#fff7ed',
            borderColor: 'rgba(217, 119, 6, 0.42)'
        },
        team: {
            background: 'linear-gradient(135deg, #be185d 0%, #db2777 100%)',
            color: '#fff1f2',
            borderColor: 'rgba(219, 39, 119, 0.4)'
        }
    };

    const nextGoalType = getNextGoalType(goal.type);
    const nextGoalLabel = nextGoalType ? getGoalTypeGoalLabel(nextGoalType) : 'Sub-goal';

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
                                style={typeBadgeStyles[goal.type] || {
                                    background: 'linear-gradient(135deg, #475569 0%, #64748b 100%)',
                                    color: '#f8fafc',
                                    borderColor: 'rgba(100, 116, 139, 0.35)'
                                }}
                            >
                                {getGoalTypeLabel(goal.type)}
                            </span>
                            <div className="goal-actions">
                                {/* KPI indicator */}
                                {scopedKpiCount > 0 && (
                                    <button
                                        className="kpi-indicator"
                                        title={hasScopedFilters
                                            ? `View ${scopedKpiCount} filtered KPI(s) (including sub-goals)`
                                            : `View ${scopedKpiCount} Total KPI(s) (including sub-goals)`
                                        }
                                        onClick={handleKpiClick}
                                    >
                                        <Activity size={14} />
                                        <span>{scopedKpiCount}</span>
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
                                {canCreateGoal && goal.type !== GOAL_LEAF_TYPE && (
                                    <button className="icon-btn" onClick={() => setShowAddModal(true)} title={`Add ${nextGoalLabel}`}>
                                        <Plus size={16} />
                                    </button>
                                )}

                                {/* Dropdown Menu - only show if canEdit or canDelete */}
                                {(canEditGoal || canDeleteGoal) && (
                                    <div className="goal-menu-container" ref={menuRef}>
                                        <button className="icon-btn" onClick={handleMenuToggle}>
                                            <MoreHorizontal size={16} />
                                        </button>

                                        {showMenu && (
                                            <div className="goal-dropdown-menu">
                                                {canEditGoal && (
                                                    <button className="menu-item" onClick={handleEdit}>
                                                        <Edit size={14} />
                                                        Edit Goal
                                                    </button>
                                                )}
                                                {canDeleteGoal && (
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
                                style={{ width: `${progressValue}%`, backgroundColor: typeColors[goal.type] }}
                            ></div>
                        </div>
                        <span className="goal-progress-text">{progressValue}% Complete</span>
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
                            watchedOnly={watchedOnly}
                            projectsSource={projectsSource}
                        />
                    ))}

                </div>
            )}

            <Modal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                title={`Add ${nextGoalLabel} under "${goal.title}"`}
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
                {canManageKpis ? (
                    <KPIManager goalId={goal.id} kpis={goal.kpis || []} />
                ) : (
                    <p style={{ marginTop: '0.75rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        KPI editing is restricted for your role.
                    </p>
                )}
            </Modal>
        </div>
    );
}

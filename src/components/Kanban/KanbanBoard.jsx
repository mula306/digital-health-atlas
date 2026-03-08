import { useState, useCallback, useMemo, useEffect } from 'react';
import { Settings, LayoutGrid, Table, GanttChart, FileText, Calendar, Activity, Star, BarChart3 } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { KanbanColumn } from './KanbanColumn';
import { TaskTableView } from './TaskTableView';
import { GanttView } from './GanttView';
import { CalendarView } from './CalendarView';
import { StatusReportPage } from '../StatusReport/StatusReportPage';
import { ProjectBenefitsPanel } from './ProjectBenefitsPanel';
import { Modal } from '../UI/Modal';
import { AddTaskForm } from './AddTaskForm';
import { EditProjectForm } from './EditProjectForm';
import { TaskDetailPanel } from './TaskDetailPanel';
import { ProjectActivityFeed } from './ProjectActivityFeed';
import './Kanban.css';

const PROJECT_TASK_FOCUS_STORAGE_KEY = 'dha_project_focus_task_payload';
const PROJECT_TASK_FOCUS_TTL_MS = 2 * 60 * 1000;
const PROJECT_VIEW_PREFERENCE_STORAGE_KEY = 'dha_project_view_preference';
const PROJECT_VIEW_PREFERENCE_TTL_MS = 2 * 60 * 1000;
const PROJECT_VIEW_MODES = new Set(['table', 'calendar', 'gantt', 'kanban', 'reports', 'benefits', 'activity']);

const COLUMNS = [
    { id: 'todo', title: 'To Do', color: 'var(--text-secondary)' },
    { id: 'in-progress', title: 'In Progress', color: '#3b82f6' },
    { id: 'blocked', title: 'Blocked', color: '#ef4444' },
    { id: 'review', title: 'Review', color: '#00558c' },
    { id: 'done', title: 'Done', color: '#10b981' }
];

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

export function KanbanBoard({ project, onBack, goalTitle }) {
    const {
        watchProject,
        unwatchProject,
        fetchAssignableUsers,
        currentUser,
        hasPermission
    } = useData();
    const canEditProject = hasPermission('can_edit_project');
    const canDeleteProject = hasPermission('can_delete_project');
    const canManageProject = canEditProject || canDeleteProject;
    const [showAddModal, setShowAddModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [selectedTask, setSelectedTask] = useState(null);
    const [viewMode, setViewMode] = useState('table'); // 'table', 'gantt', 'kanban', 'reports', 'benefits', 'activity'
    const [isUpdatingWatch, setIsUpdatingWatch] = useState(false);
    const [taskQuickFilter, setTaskQuickFilter] = useState('all');
    const [assigneeOptions, setAssigneeOptions] = useState([]);

    const sortTasks = useCallback((tasks) => {
        return [...tasks].sort((a, b) => {
            const priorityDiff = (PRIORITY_ORDER[a.priority] || 2) - (PRIORITY_ORDER[b.priority] || 2);
            if (priorityDiff !== 0) return priorityDiff;
            // Use endDate, fallback to dueDate for legacy support
            const aEnd = a.endDate || a.dueDate;
            const bEnd = b.endDate || b.dueDate;
            if (aEnd && bEnd) return new Date(aEnd) - new Date(bEnd);
            if (aEnd) return -1;
            if (bEnd) return 1;
            return 0;
        });
    }, []);

    const filteredTasks = useMemo(() => {
        const tasks = project.tasks || [];
        if (taskQuickFilter === 'all') return tasks;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const isOverdue = (task) => {
            const endDate = task.endDate || task.dueDate;
            if (!endDate) return false;
            return new Date(endDate) < today && task.status !== 'done';
        };

        if (taskQuickFilter === 'mine') {
            const currentOid = String(currentUser?.oid || '');
            return tasks.filter((task) => String(task.assigneeOid || '') === currentOid);
        }

        if (taskQuickFilter === 'unassigned') {
            return tasks.filter((task) => !task.assigneeOid);
        }

        if (taskQuickFilter === 'overdue') {
            return tasks.filter((task) => isOverdue(task));
        }

        if (taskQuickFilter === 'done') {
            return tasks.filter((task) => task.status === 'done');
        }

        return tasks;
    }, [project.tasks, taskQuickFilter, currentUser?.oid]);

    const tasksByStatus = useMemo(() => {
        return COLUMNS.reduce((acc, col) => {
            const columnTasks = filteredTasks.filter(t => t.status === col.id);
            acc[col.id] = sortTasks(columnTasks);
            return acc;
        }, {});
    }, [filteredTasks, sortTasks]);

    const projectForView = useMemo(() => ({
        ...project,
        tasks: filteredTasks
    }), [project, filteredTasks]);

    const handleEditClose = useCallback((wasDeleted) => {
        setShowEditModal(false);
        if (wasDeleted) {
            onBack();
        }
    }, [onBack]);

    const handleTaskClick = useCallback((task) => {
        setSelectedTask(task);
    }, []);

    const handleToggleWatch = useCallback(async () => {
        if (isUpdatingWatch) return;
        setIsUpdatingWatch(true);
        try {
            if (project.isWatched) {
                await unwatchProject(project.id);
            } else {
                await watchProject(project.id);
            }
        } catch (error) {
            console.error('Failed to update watchlist status:', error);
        } finally {
            setIsUpdatingWatch(false);
        }
    }, [isUpdatingWatch, project.isWatched, project.id, unwatchProject, watchProject]);

    useEffect(() => {
        if (!canEditProject) return;
        let cancelled = false;
        fetchAssignableUsers()
            .then((users) => {
                if (!cancelled && Array.isArray(users)) {
                    setAssigneeOptions(users);
                }
            })
            .catch((err) => {
                console.error('Failed to load assignable users:', err);
            });
        return () => { cancelled = true; };
    }, [canEditProject, fetchAssignableUsers]);

    // Keep selectedTask in sync with project updates.
    useEffect(() => {
        if (!selectedTask) return;
        const updatedTask = (project.tasks || []).find(t => String(t.id) === String(selectedTask.id));
        if (!updatedTask) {
            setSelectedTask(null);
            return;
        }
        if (JSON.stringify(updatedTask) !== JSON.stringify(selectedTask)) {
            setSelectedTask(updatedTask);
        }
    }, [project.tasks, selectedTask]);

    useEffect(() => {
        const rawPayload = localStorage.getItem(PROJECT_TASK_FOCUS_STORAGE_KEY);
        if (!rawPayload) return;

        let payload = null;
        try {
            payload = JSON.parse(rawPayload);
        } catch {
            localStorage.removeItem(PROJECT_TASK_FOCUS_STORAGE_KEY);
            return;
        }

        const payloadProjectId = String(payload?.projectId || '').trim();
        const payloadTaskId = String(payload?.taskId || '').trim();
        const requestedAt = Number(payload?.requestedAt || 0);
        const isFresh = requestedAt > 0 && (Date.now() - requestedAt) <= PROJECT_TASK_FOCUS_TTL_MS;

        if (!isFresh) {
            localStorage.removeItem(PROJECT_TASK_FOCUS_STORAGE_KEY);
            return;
        }

        if (!payloadProjectId || payloadProjectId !== String(project.id)) {
            return;
        }

        if (!payloadTaskId) {
            localStorage.removeItem(PROJECT_TASK_FOCUS_STORAGE_KEY);
            return;
        }

        const matchedTask = (project.tasks || []).find((task) => String(task.id) === payloadTaskId);
        if (!matchedTask) return;

        setViewMode('table');
        setSelectedTask(matchedTask);
        localStorage.removeItem(PROJECT_TASK_FOCUS_STORAGE_KEY);
    }, [project.id, project.tasks]);

    useEffect(() => {
        const rawPayload = localStorage.getItem(PROJECT_VIEW_PREFERENCE_STORAGE_KEY);
        if (!rawPayload) return;

        let payload = null;
        try {
            payload = JSON.parse(rawPayload);
        } catch {
            localStorage.removeItem(PROJECT_VIEW_PREFERENCE_STORAGE_KEY);
            return;
        }

        const payloadProjectId = String(payload?.projectId || '').trim();
        const requestedMode = String(payload?.viewMode || '').trim().toLowerCase();
        const requestedAt = Number(payload?.requestedAt || 0);
        const isFresh = requestedAt > 0 && (Date.now() - requestedAt) <= PROJECT_VIEW_PREFERENCE_TTL_MS;

        if (!isFresh) {
            localStorage.removeItem(PROJECT_VIEW_PREFERENCE_STORAGE_KEY);
            return;
        }

        if (!payloadProjectId || payloadProjectId !== String(project.id)) {
            return;
        }

        if (PROJECT_VIEW_MODES.has(requestedMode)) {
            setViewMode(requestedMode);
        }

        localStorage.removeItem(PROJECT_VIEW_PREFERENCE_STORAGE_KEY);
    }, [project.id]);

    return (
        <div className="kanban-board-container">
            <div className="board-header">
                <button onClick={onBack} className="back-btn">← Projects</button>
                <div className="board-title">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <h2>{project.title}</h2>
                        <button
                            type="button"
                            onClick={handleToggleWatch}
                            className={`project-watch-btn board-project-watch-btn ${project.isWatched ? 'active' : ''}`}
                            title={project.isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
                            aria-label={project.isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
                            disabled={isUpdatingWatch}
                        >
                            <Star size={16} fill={project.isWatched ? 'currentColor' : 'none'} />
                        </button>
                        {canManageProject && (
                            <button
                                onClick={() => setShowEditModal(true)}
                                className="icon-btn"
                                title="Edit Project"
                            >
                                <Settings size={18} />
                            </button>
                        )}
                    </div>
                    <div className="board-meta">
                        <span className="meta-item">🎯 {goalTitle || 'Unlinked'}</span>
                        <span className="meta-divider">•</span>
                        <span className="meta-item">{project.completion}% Complete</span>
                    </div>
                </div>

                <div className="board-actions">
                    {/* View Toggle */}
                    <div className="view-toggle">
                        <button
                            className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
                            onClick={() => setViewMode('table')}
                            title="Table View"
                        >
                            <Table size={18} />
                        </button>
                        <button
                            className={`view-toggle-btn ${viewMode === 'calendar' ? 'active' : ''}`}
                            onClick={() => setViewMode('calendar')}
                            title="Calendar View"
                        >
                            <Calendar size={18} />
                        </button>
                        <button
                            className={`view-toggle-btn ${viewMode === 'gantt' ? 'active' : ''}`}
                            onClick={() => setViewMode('gantt')}
                            title="Gantt View"
                        >
                            <GanttChart size={18} />
                        </button>
                        <button
                            className={`view-toggle-btn ${viewMode === 'kanban' ? 'active' : ''}`}
                            onClick={() => setViewMode('kanban')}
                            title="Kanban View"
                        >
                            <LayoutGrid size={18} />
                        </button>
                        <button
                            className={`view-toggle-btn ${viewMode === 'reports' ? 'active' : ''}`}
                            onClick={() => setViewMode('reports')}
                            title="Status Reports"
                        >
                            <FileText size={18} />
                        </button>
                        <button
                            className={`view-toggle-btn ${viewMode === 'benefits' ? 'active' : ''}`}
                            onClick={() => setViewMode('benefits')}
                            title="Benefits and Risk"
                        >
                            <BarChart3 size={18} />
                        </button>
                        <button
                            className={`view-toggle-btn ${viewMode === 'activity' ? 'active' : ''}`}
                            onClick={() => setViewMode('activity')}
                            title="Activity History"
                        >
                            <Activity size={18} />
                        </button>
                    </div>

                    {viewMode !== 'reports' && viewMode !== 'activity' && viewMode !== 'benefits' && canEditProject && (
                        <button className="btn-primary" onClick={() => setShowAddModal(true)}>New Task</button>
                    )}
                </div>
            </div>

            {viewMode !== 'reports' && viewMode !== 'activity' && viewMode !== 'benefits' && (
                <div className="task-quick-filters">
                    <button
                        type="button"
                        className={`task-filter-btn ${taskQuickFilter === 'all' ? 'active' : ''}`}
                        onClick={() => setTaskQuickFilter('all')}
                    >
                        All
                    </button>
                    <button
                        type="button"
                        className={`task-filter-btn ${taskQuickFilter === 'mine' ? 'active' : ''}`}
                        onClick={() => setTaskQuickFilter('mine')}
                        disabled={!currentUser?.oid}
                    >
                        My Tasks
                    </button>
                    <button
                        type="button"
                        className={`task-filter-btn ${taskQuickFilter === 'unassigned' ? 'active' : ''}`}
                        onClick={() => setTaskQuickFilter('unassigned')}
                    >
                        Unassigned
                    </button>
                    <button
                        type="button"
                        className={`task-filter-btn ${taskQuickFilter === 'overdue' ? 'active' : ''}`}
                        onClick={() => setTaskQuickFilter('overdue')}
                    >
                        Overdue
                    </button>
                    <button
                        type="button"
                        className={`task-filter-btn ${taskQuickFilter === 'done' ? 'active' : ''}`}
                        onClick={() => setTaskQuickFilter('done')}
                    >
                        Done
                    </button>
                </div>
            )}

            {viewMode === 'kanban' && (
                <div className="kanban-columns">
                    {COLUMNS.map(col => (
                        <KanbanColumn
                            key={col.id}
                            column={col}
                            tasks={tasksByStatus[col.id] || []}
                            projectId={project.id}
                            onTaskClick={handleTaskClick}
                            canEditTask={canEditProject}
                        />
                    ))}
                </div>
            )}

            {viewMode === 'table' && (
                <TaskTableView
                    project={projectForView}
                    onTaskClick={handleTaskClick}
                />
            )}

            {viewMode === 'calendar' && (
                <CalendarView
                    project={projectForView}
                    onTaskClick={handleTaskClick}
                />
            )}

            {viewMode === 'gantt' && (
                <GanttView
                    project={projectForView}
                    onTaskClick={handleTaskClick}
                />
            )}

            {viewMode === 'reports' && (
                <StatusReportPage
                    project={project}
                    onClose={() => setViewMode('kanban')}
                />
            )}

            {viewMode === 'benefits' && (
                <ProjectBenefitsPanel
                    projectId={project.id}
                    canEditProject={canEditProject}
                />
            )}

            {viewMode === 'activity' && (
                <ProjectActivityFeed projectId={project.id} />
            )}

            <Modal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                title={`Add Task to ${project.title}`}
                closeOnOverlayClick={false}
            >
                <AddTaskForm
                    onClose={() => setShowAddModal(false)}
                    projectId={project.id}
                    assigneeOptions={assigneeOptions}
                    currentUser={currentUser}
                />
            </Modal>

            <Modal
                isOpen={showEditModal}
                onClose={handleEditClose}
                title="Edit Project"
                size="large"
                closeOnOverlayClick={false}
            >
                <EditProjectForm
                    project={project}
                    onClose={handleEditClose}
                    canEditProject={canEditProject}
                    canDeleteProject={canDeleteProject}
                />
            </Modal>

            {selectedTask && (
                <TaskDetailPanel
                    task={selectedTask}
                    projectId={project.id}
                    assigneeOptions={assigneeOptions}
                    canEditTask={canEditProject}
                    onClose={() => setSelectedTask(null)}
                />
            )}
        </div>
    );
}

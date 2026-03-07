import { useState, useCallback, useMemo, useEffect } from 'react';
import { Settings, LayoutGrid, Table, GanttChart, FileText, Calendar, Activity, Star } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { KanbanColumn } from './KanbanColumn';
import { TaskTableView } from './TaskTableView';
import { GanttView } from './GanttView';
import { CalendarView } from './CalendarView';
import { StatusReportPage } from '../StatusReport/StatusReportPage';
import { Modal } from '../UI/Modal';
import { AddTaskForm } from './AddTaskForm';
import { EditProjectForm } from './EditProjectForm';
import { TaskDetailPanel } from './TaskDetailPanel';
import { ProjectActivityFeed } from './ProjectActivityFeed';
import './Kanban.css';

const COLUMNS = [
    { id: 'todo', title: 'To Do', color: 'var(--text-secondary)' },
    { id: 'in-progress', title: 'In Progress', color: '#3b82f6' },
    { id: 'blocked', title: 'Blocked', color: '#ef4444' },
    { id: 'review', title: 'Review', color: '#8b5cf6' },
    { id: 'done', title: 'Done', color: '#10b981' }
];

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

import { useAuth } from '../../hooks/useAuth';

export function KanbanBoard({ project, onBack, goalTitle }) {
    const { watchProject, unwatchProject, fetchAssignableUsers, currentUser } = useData();
    const { canEdit } = useAuth();
    const [showAddModal, setShowAddModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [selectedTask, setSelectedTask] = useState(null);
    const [viewMode, setViewMode] = useState('table'); // 'table', 'gantt', 'kanban', 'reports'
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
        if (!canEdit) return;
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
    }, [canEdit, fetchAssignableUsers]);

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
                        {canEdit && (
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
                            className={`view-toggle-btn ${viewMode === 'activity' ? 'active' : ''}`}
                            onClick={() => setViewMode('activity')}
                            title="Activity History"
                        >
                            <Activity size={18} />
                        </button>
                    </div>

                    {viewMode !== 'reports' && viewMode !== 'activity' && canEdit && (
                        <button className="btn-primary" onClick={() => setShowAddModal(true)}>New Task</button>
                    )}
                </div>
            </div>

            {viewMode !== 'reports' && viewMode !== 'activity' && (
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
                <EditProjectForm project={project} onClose={handleEditClose} />
            </Modal>

            {selectedTask && (
                <TaskDetailPanel
                    task={selectedTask}
                    projectId={project.id}
                    assigneeOptions={assigneeOptions}
                    onClose={() => setSelectedTask(null)}
                />
            )}
        </div>
    );
}

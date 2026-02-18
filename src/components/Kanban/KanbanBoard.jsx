import { useState, useCallback, useMemo } from 'react';
import { Settings, LayoutGrid, Table, GanttChart, FileText, Calendar, Activity } from 'lucide-react';
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
    { id: 'review', title: 'Review', color: '#8b5cf6' },
    { id: 'done', title: 'Done', color: '#10b981' }
];

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

import { useAuth } from '../../hooks/useAuth';

export function KanbanBoard({ project, onBack, goalTitle }) {
    const { moveTask: _moveTask } = useData();
    const { canEdit } = useAuth();
    const [showAddModal, setShowAddModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [selectedTask, setSelectedTask] = useState(null);
    const [viewMode, setViewMode] = useState('table'); // 'table', 'gantt', 'kanban', 'reports'

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

    const tasksByStatus = useMemo(() => {
        return COLUMNS.reduce((acc, col) => {
            const columnTasks = (project.tasks || []).filter(t => t.status === col.id);
            acc[col.id] = sortTasks(columnTasks);
            return acc;
        }, {});
    }, [project.tasks, sortTasks]);

    const handleEditClose = useCallback((wasDeleted) => {
        setShowEditModal(false);
        if (wasDeleted) {
            onBack();
        }
    }, [onBack]);

    const handleTaskClick = useCallback((task) => {
        setSelectedTask(task);
    }, []);

    // Keep selectedTask in sync with project updates (e.g. after editing)
    // Keep selectedTask in sync with project updates (Derived State Pattern)
    if (selectedTask) {
        const updatedTask = project.tasks.find(t => t.id === selectedTask.id);
        // If task exists and has changed, update local state
        // Note: We use JSON.stringify for deep comparison as per original logic, though it has performance cost.
        if (updatedTask && JSON.stringify(updatedTask) !== JSON.stringify(selectedTask)) {
            setSelectedTask(updatedTask);
        }
    }

    return (
        <div className="kanban-board-container">
            <div className="board-header">
                <button onClick={onBack} className="back-btn">← Projects</button>
                <div className="board-title">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <h2>{project.title}</h2>
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
                    project={project}
                    onTaskClick={handleTaskClick}
                />
            )}

            {viewMode === 'calendar' && (
                <CalendarView
                    project={project}
                    onTaskClick={handleTaskClick}
                />
            )}

            {viewMode === 'gantt' && (
                <GanttView
                    project={project}
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
                <AddTaskForm onClose={() => setShowAddModal(false)} projectId={project.id} />
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
                    onClose={() => setSelectedTask(null)}
                />
            )}
        </div>
    );
}

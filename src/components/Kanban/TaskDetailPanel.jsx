import { useState } from 'react';
import { X, Calendar, Flag, Edit, Trash2, AlignLeft, CheckCircle2 } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import './TaskDetail.css';

import { useAuth } from '../../hooks/useAuth';

export function TaskDetailPanel({ task, projectId, onClose }) {
    const { updateTask, deleteTask } = useData();
    const { success } = useToast();
    const { canEdit, canDelete } = useAuth();
    const [isEditing, setIsEditing] = useState(false);

    // Helper to format date for input (YYYY-MM-DD)
    // - Preserves YYYY-MM-DD strings as-is
    // - Converts ISO strings using UTC components to avoid timezone shift
    const formatDateForInput = (dateStr) => {
        if (!dateStr) return '';
        try {
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                return dateStr;
            }

            const date = new Date(dateStr);
            // Use UTC methods to ensure we get the date as stored on server
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const day = String(date.getUTCDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        } catch (_e) {
            return '';
        }
    };

    const [title, setTitle] = useState(task.title);
    const [description, setDescription] = useState(task.description || '');
    const [priority, setPriority] = useState(task.priority);
    const [status, setStatus] = useState(task.status || 'todo');
    const [startDate, setStartDate] = useState(formatDateForInput(task.startDate || task.dueDate));
    const [endDate, setEndDate] = useState(formatDateForInput(task.endDate || task.dueDate));
    const [confirmDelete, setConfirmDelete] = useState(false);

    // Sync state with task props when they change (Derived State Pattern)
    const [prevTask, setPrevTask] = useState(task);
    if (task !== prevTask) {
        setPrevTask(task);
        setTitle(task.title);
        setDescription(task.description || '');
        setPriority(task.priority);
        setStatus(task.status || 'todo');
        setStartDate(formatDateForInput(task.startDate || task.dueDate));
        setEndDate(formatDateForInput(task.endDate || task.dueDate));
    }

    const handleSave = async () => {
        await updateTask(projectId, task.id, {
            title,
            description,
            priority,
            status,
            startDate: startDate || null,
            endDate: endDate || null
        });
        success('Task updated successfully');
        setIsEditing(false);
    };

    const handleDelete = () => {
        if (confirmDelete) {
            deleteTask(projectId, task.id);
            success('Task deleted');
            onClose();
        } else {
            setConfirmDelete(true);
        }
    };

    // Helper to format date for display without UTC shift
    const formatDateForDisplay = (dateStr) => {
        if (!dateStr) return 'Not set';
        try {
            // If strictly YYYY-MM-DD
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                const [year, month, day] = dateStr.split('-').map(Number);
                // Create local date at midnight
                const date = new Date(year, month - 1, day);
                return date.toLocaleDateString();
            }
            // For ISO strings, use UTC timezone to prevent shift
            return new Date(dateStr).toLocaleDateString(undefined, { timeZone: 'UTC' });
        } catch (_e) {
            return dateStr;
        }
    };


    const priorityColors = {
        high: '#ef4444',
        medium: '#f59e0b',
        low: '#10b981'
    };

    const statusColors = {
        'todo': '#64748b',
        'in-progress': '#3b82f6',
        'review': '#8b5cf6',
        'done': '#22c55e'
    };

    const statusLabels = {
        'todo': 'To Do',
        'in-progress': 'In Progress',
        'review': 'Review',
        'done': 'Done'
    };

    // Get display dates (support legacy dueDate field)
    const displayStartDate = task.startDate || task.dueDate;
    const displayEndDate = task.endDate || task.dueDate;
    const currentStatus = task.status || 'todo';

    return (
        <div className="task-detail-overlay" onClick={onClose}>
            <div className="task-detail-panel" onClick={e => e.stopPropagation()}>
                <div className="panel-header">
                    <h3>{isEditing ? 'Edit Task' : 'Task Details'}</h3>
                    <button className="close-btn" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="panel-content">
                    {isEditing ? (
                        <>
                            <div className="form-group">
                                <label>Title</label>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={e => setTitle(e.target.value)}
                                    className="form-input"
                                />
                            </div>
                            <div className="form-group">
                                <label>Description</label>
                                <textarea
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    className="form-textarea"
                                    rows={3}
                                />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Status</label>
                                    <select value={status} onChange={e => setStatus(e.target.value)} className="form-select">
                                        <option value="todo">To Do</option>
                                        <option value="in-progress">In Progress</option>
                                        <option value="review">Review</option>
                                        <option value="done">Done</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Priority</label>
                                    <select value={priority} onChange={e => setPriority(e.target.value)} className="form-select">
                                        <option value="low">Low</option>
                                        <option value="medium">Medium</option>
                                        <option value="high">High</option>
                                    </select>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Start Date</label>
                                    <input
                                        type="date"
                                        value={startDate}
                                        onChange={e => setStartDate(e.target.value)}
                                        className="form-input"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>End Date</label>
                                    <input
                                        type="date"
                                        value={endDate}
                                        onChange={e => setEndDate(e.target.value)}
                                        className="form-input"
                                        min={startDate}
                                    />
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <h2 className="task-title-display">{task.title}</h2>

                            <div className="meta-grid">
                                <div className="meta-item">
                                    <span className="meta-label">Status</span>
                                    <div className="meta-value">
                                        <span className="status-badge-lg" style={{
                                            backgroundColor: `${statusColors[currentStatus]}20`,
                                            color: statusColors[currentStatus]
                                        }}>
                                            <CheckCircle2 size={14} />
                                            {statusLabels[currentStatus]}
                                        </span>
                                    </div>
                                </div>
                                <div className="meta-item">
                                    <span className="meta-label">Priority</span>
                                    <div className="meta-value">
                                        <Flag size={16} style={{ color: priorityColors[task.priority] }} />
                                        <span style={{ color: priorityColors[task.priority], textTransform: 'capitalize' }}>
                                            {task.priority}
                                        </span>
                                    </div>
                                </div>
                                <div className="meta-item">
                                    <span className="meta-label">Start Date</span>
                                    <div className="meta-value">
                                        <Calendar size={16} className="text-muted" />
                                        {formatDateForDisplay(displayStartDate)}
                                    </div>
                                </div>
                                <div className="meta-item">
                                    <span className="meta-label">Due Date</span>
                                    <div className="meta-value">
                                        <Calendar size={16} className="text-muted" />
                                        {formatDateForDisplay(displayEndDate)}
                                    </div>
                                </div>
                            </div>

                            <div className="section-label">
                                <AlignLeft size={16} />
                                Description
                            </div>
                            <div className="task-description-display">
                                {task.description || 'No description provided for this task.'}
                            </div>
                        </>
                    )}
                </div>

                <div className="panel-actions">
                    {isEditing ? (
                        <>
                            <button className="btn-secondary" onClick={() => setIsEditing(false)}>Cancel</button>
                            <button className="btn-primary" onClick={handleSave}>Save Changes</button>
                        </>
                    ) : (
                        <>
                            {canDelete && (
                                <button
                                    className={`btn-danger ${confirmDelete ? 'confirm' : ''}`}
                                    onClick={handleDelete}
                                >
                                    <Trash2 size={16} />
                                    {confirmDelete ? 'Confirm Delete' : 'Delete'}
                                </button>
                            )}
                            {canEdit && (
                                <button className="btn-primary" onClick={() => setIsEditing(true)}>
                                    <Edit size={16} />
                                    Edit
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div >
    );
}

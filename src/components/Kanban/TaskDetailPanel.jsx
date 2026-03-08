import { useEffect, useMemo, useState } from 'react';
import { X, Calendar, Flag, Edit, Trash2, AlignLeft, CheckCircle2, User, ListChecks, Plus, Check, Square } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import './TaskDetail.css';

export function TaskDetailPanel({ task, projectId, assigneeOptions = [], canEditTask, onClose }) {
    const {
        updateTask,
        deleteTask,
        hasPermission,
        fetchTaskChecklist,
        addTaskChecklistItem,
        updateTaskChecklistItem,
        deleteTaskChecklistItem
    } = useData();
    const { success, error } = useToast();
    const canEdit = canEditTask ?? hasPermission('can_edit_project');
    const canDelete = canEdit;
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

    const [title, setTitle] = useState(task.title || '');
    const [description, setDescription] = useState(task.description || '');
    const [priority, setPriority] = useState(task.priority || 'medium');
    const [status, setStatus] = useState(task.status || 'todo');
    const [assigneeOid, setAssigneeOid] = useState(task.assigneeOid || '');
    const [blockerNote, setBlockerNote] = useState(task.blockerNote || '');
    const [startDate, setStartDate] = useState(formatDateForInput(task.startDate || task.dueDate));
    const [endDate, setEndDate] = useState(formatDateForInput(task.endDate || task.dueDate));
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [saving, setSaving] = useState(false);

    const [checklistItems, setChecklistItems] = useState([]);
    const [checklistLoading, setChecklistLoading] = useState(false);
    const [newChecklistTitle, setNewChecklistTitle] = useState('');
    const [checklistBusyId, setChecklistBusyId] = useState(null);

    useEffect(() => {
        setTitle(task.title || '');
        setDescription(task.description || '');
        setPriority(task.priority || 'medium');
        setStatus(task.status || 'todo');
        setAssigneeOid(task.assigneeOid || '');
        setBlockerNote(task.blockerNote || '');
        setStartDate(formatDateForInput(task.startDate || task.dueDate));
        setEndDate(formatDateForInput(task.endDate || task.dueDate));
        setConfirmDelete(false);
        setIsEditing(false);
    }, [task]);

    useEffect(() => {
        let cancelled = false;
        setChecklistLoading(true);
        fetchTaskChecklist(task.id)
            .then((data) => {
                if (!cancelled) {
                    setChecklistItems(Array.isArray(data?.items) ? data.items : []);
                }
            })
            .catch((err) => {
                console.error('Failed to fetch checklist:', err);
            })
            .finally(() => {
                if (!cancelled) setChecklistLoading(false);
            });
        return () => { cancelled = true; };
    }, [task.id, fetchTaskChecklist]);

    const handleSave = async () => {
        if (saving) return;
        setSaving(true);
        try {
            await updateTask(projectId, task.id, {
                title,
                description,
                priority,
                status,
                assigneeOid: assigneeOid || null,
                blockerNote: status === 'blocked' ? (blockerNote || null) : null,
                startDate: startDate || null,
                endDate: endDate || null
            });
            success('Task updated successfully');
            setIsEditing(false);
        } catch (err) {
            error(err?.message || 'Failed to update task');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (confirmDelete) {
            try {
                await deleteTask(projectId, task.id);
                success('Task deleted');
                onClose();
            } catch (err) {
                error(err?.message || 'Failed to delete task');
            }
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
        'blocked': '#ef4444',
        'review': '#8b5cf6',
        'done': '#22c55e'
    };

    const statusLabels = {
        'todo': 'To Do',
        'in-progress': 'In Progress',
        'blocked': 'Blocked',
        'review': 'Review',
        'done': 'Done'
    };

    const checklistSummary = useMemo(() => {
        const total = checklistItems.length;
        const done = checklistItems.filter((item) => item.isDone).length;
        return { total, done };
    }, [checklistItems]);

    const handleChecklistAdd = async () => {
        const titleToAdd = newChecklistTitle.trim();
        if (!titleToAdd) return;
        setChecklistBusyId('new');
        try {
            const item = await addTaskChecklistItem(task.id, { title: titleToAdd });
            setChecklistItems((prev) => [...prev, item]);
            setNewChecklistTitle('');
            success('Checklist item added');
        } catch (err) {
            error(err?.message || 'Failed to add checklist item');
        } finally {
            setChecklistBusyId(null);
        }
    };

    const handleChecklistToggle = async (item) => {
        setChecklistBusyId(item.id);
        try {
            const updated = await updateTaskChecklistItem(task.id, item.id, { isDone: !item.isDone });
            setChecklistItems((prev) => prev.map((i) => String(i.id) === String(item.id) ? updated : i));
        } catch (err) {
            error(err?.message || 'Failed to update checklist item');
        } finally {
            setChecklistBusyId(null);
        }
    };

    const handleChecklistDelete = async (item) => {
        setChecklistBusyId(item.id);
        try {
            await deleteTaskChecklistItem(task.id, item.id);
            setChecklistItems((prev) => prev.filter((i) => String(i.id) !== String(item.id)));
        } catch (err) {
            error(err?.message || 'Failed to delete checklist item');
        } finally {
            setChecklistBusyId(null);
        }
    };

    const selectedAssigneeName = assigneeOptions.find((u) => String(u.oid) === String(task.assigneeOid || ''))?.name
        || task.assigneeName
        || null;

    // Get display dates (support legacy dueDate field)
    const displayStartDate = task.startDate || task.dueDate;
    const displayEndDate = task.endDate || task.dueDate;
    const currentStatus = task.status || 'todo';
    const displayPriority = task.priority || 'medium';

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
                                        <option value="blocked">Blocked</option>
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
                            <div className="form-group">
                                <label>Assignee</label>
                                <select
                                    value={assigneeOid}
                                    onChange={e => setAssigneeOid(e.target.value)}
                                    className="form-select"
                                >
                                    <option value="">Unassigned</option>
                                    {assigneeOptions.map(user => (
                                        <option key={user.oid} value={user.oid}>
                                            {user.name}{user.email ? ` (${user.email})` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {status === 'blocked' && (
                                <div className="form-group">
                                    <label>Blocker Note</label>
                                    <textarea
                                        value={blockerNote}
                                        onChange={e => setBlockerNote(e.target.value)}
                                        className="form-textarea"
                                        rows={2}
                                        placeholder="What is blocking this task?"
                                    />
                                </div>
                            )}
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
                                        <Flag size={16} style={{ color: priorityColors[displayPriority] }} />
                                        <span style={{ color: priorityColors[displayPriority], textTransform: 'capitalize' }}>
                                            {displayPriority}
                                        </span>
                                    </div>
                                </div>
                                <div className="meta-item">
                                    <span className="meta-label">Assignee</span>
                                    <div className="meta-value">
                                        <User size={16} className="text-muted" />
                                        {selectedAssigneeName || 'Unassigned'}
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

                            {task.blockerNote && (
                                <>
                                    <div className="section-label">
                                        <Flag size={16} />
                                        Blocker
                                    </div>
                                    <div className="task-description-display">
                                        {task.blockerNote}
                                    </div>
                                </>
                            )}

                            <div className="section-label">
                                <AlignLeft size={16} />
                                Description
                            </div>
                            <div className="task-description-display">
                                {task.description || 'No description provided for this task.'}
                            </div>
                        </>
                    )}

                    <div className="section-label" style={{ marginTop: '1rem' }}>
                        <ListChecks size={16} />
                        Checklist ({checklistSummary.done}/{checklistSummary.total})
                    </div>

                    {checklistLoading ? (
                        <p className="text-muted" style={{ marginTop: '0.5rem' }}>Loading checklist...</p>
                    ) : (
                        <div className="task-checklist">
                            {checklistItems.length === 0 && (
                                <p className="text-muted" style={{ marginTop: '0.5rem' }}>No checklist items yet.</p>
                            )}
                            {checklistItems.map(item => (
                                <div key={item.id} className="task-checklist-item">
                                    <button
                                        type="button"
                                        className="task-checklist-toggle"
                                        onClick={() => canEdit && handleChecklistToggle(item)}
                                        disabled={!canEdit || checklistBusyId === item.id}
                                    >
                                        {item.isDone ? <Check size={14} /> : <Square size={14} />}
                                    </button>
                                    <span className={`task-checklist-title ${item.isDone ? 'done' : ''}`}>
                                        {item.title}
                                    </span>
                                    {canEdit && (
                                        <button
                                            type="button"
                                            className="task-checklist-delete"
                                            onClick={() => handleChecklistDelete(item)}
                                            disabled={checklistBusyId === item.id}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                            ))}

                            {canEdit && (
                                <div className="task-checklist-add">
                                    <input
                                        type="text"
                                        value={newChecklistTitle}
                                        onChange={(e) => setNewChecklistTitle(e.target.value)}
                                        className="form-input"
                                        placeholder="Add checklist item..."
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleChecklistAdd();
                                            }
                                        }}
                                    />
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        onClick={handleChecklistAdd}
                                        disabled={checklistBusyId === 'new' || !newChecklistTitle.trim()}
                                    >
                                        <Plus size={14} />
                                        Add
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="panel-actions">
                    {isEditing ? (
                        <>
                            <button className="btn-secondary" onClick={() => setIsEditing(false)}>Cancel</button>
                            <button className="btn-primary" onClick={handleSave} disabled={saving}>
                                {saving ? 'Saving...' : 'Save Changes'}
                            </button>
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

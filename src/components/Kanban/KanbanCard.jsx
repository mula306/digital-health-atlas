import { memo } from 'react';
import { Calendar, Clock, AlertCircle } from 'lucide-react';
import { useData } from '../../context/DataContext';

// Get end date (supports legacy dueDate)
function getEndDate(task) {
    return task.endDate || task.dueDate;
}

// Check if task is overdue (based on end date)
function isOverdue(task) {
    const endDate = getEndDate(task);
    if (!endDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(endDate) < today;
}

// Check if task is due soon (within 2 days of end date)
function isDueSoon(task) {
    const endDate = getEndDate(task);
    if (!endDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(endDate);
    const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 2;
}

// Format date for display
function formatEndDate(task) {
    const endDate = getEndDate(task);
    if (!endDate) return null;
    const date = new Date(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const KanbanCard = memo(function KanbanCard({ task, projectId, onClick }) {
    const { moveTask } = useData();

    const handleStatusChange = (e) => {
        e.stopPropagation();
        moveTask(projectId, task.id, e.target.value);
    };

    const priorityColors = {
        high: '#ef4444',
        medium: '#f59e0b',
        low: '#10b981'
    };

    const handleDragStart = (e) => {
        e.dataTransfer.setData('taskId', task.id);
        e.dataTransfer.setData('projectId', projectId);
        e.dataTransfer.effectAllowed = 'move';
        e.currentTarget.classList.add('dragging');
    };

    const handleDragEnd = (e) => {
        e.currentTarget.classList.remove('dragging');
    };

    const overdue = isOverdue(task);
    const dueSoon = isDueSoon(task);
    const formattedDate = formatEndDate(task);

    return (
        <div
            className={`kanban-card ${overdue ? 'overdue' : ''} ${dueSoon && !overdue ? 'due-soon' : ''}`}
            draggable="true"
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onClick={() => onClick && onClick(task)}
        >
            <div className="card-header">
                <span
                    className="priority-dot"
                    style={{ backgroundColor: priorityColors[task.priority] || 'gray' }}
                    title={`Priority: ${task.priority}`}
                ></span>
                <div className="card-actions">
                    <select
                        className="status-select"
                        value={task.status}
                        onChange={handleStatusChange}
                        onClick={e => e.stopPropagation()}
                    >
                        <option value="todo">To Do</option>
                        <option value="in-progress">In Prog</option>
                        <option value="review">Review</option>
                        <option value="done">Done</option>
                    </select>
                </div>
            </div>

            <h4 className="card-title">{task.title}</h4>

            {/* Description preview */}
            {task.description && (
                <p className="card-description">{task.description}</p>
            )}

            {/* End date badge */}
            {formattedDate && (
                <div className={`due-date-badge ${overdue ? 'overdue' : ''} ${dueSoon && !overdue ? 'due-soon' : ''}`}>
                    {overdue ? <AlertCircle size={12} /> : <Calendar size={12} />}
                    <span>{formattedDate}</span>
                </div>
            )}
        </div>
    );
});

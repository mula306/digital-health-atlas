import { useState } from 'react';
import { Calendar, Flag, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import { useData } from '../../context/DataContext';
import './TaskTable.css';

// Get end date (supports legacy dueDate)
function getEndDate(task) {
    return task.endDate || task.dueDate;
}

// Get start date (supports legacy dueDate)
function getStartDate(task) {
    return task.startDate || task.dueDate;
}

// Check if task is overdue (based on end date)
function isOverdue(task) {
    const endDate = getEndDate(task);
    if (!endDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(endDate) < today;
}

const priorityColors = {
    high: '#ef4444',
    medium: '#f59e0b',
    low: '#10b981'
};

const statusLabels = {
    'todo': 'To Do',
    'in-progress': 'In Progress',
    'review': 'Review',
    'done': 'Done'
};

export function TaskTableView({ project, onTaskClick }) {
    const { moveTask } = useData();
    const [sortField, setSortField] = useState('priority');
    const [sortDirection, setSortDirection] = useState('asc');

    const statusColors = {
        'todo': '#64748b',
        'in-progress': '#3b82f6',
        'review': '#8b5cf6',
        'done': '#22c55e'
    };

    const handleSort = (field) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const statusOrder = { 'todo': 0, 'in-progress': 1, 'review': 2, 'done': 3 };

    const sortedTasks = [...(project.tasks || [])].sort((a, b) => {
        let comparison = 0;

        switch (sortField) {
            case 'title':
                comparison = a.title.localeCompare(b.title);
                break;
            case 'priority':
                comparison = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
                break;
            case 'status':
                comparison = (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
                break;
            case 'startDate':
                const aStart = getStartDate(a);
                const bStart = getStartDate(b);
                if (!aStart && !bStart) comparison = 0;
                else if (!aStart) comparison = 1;
                else if (!bStart) comparison = -1;
                else comparison = new Date(aStart) - new Date(bStart);
                break;
            case 'endDate':
                const aEnd = getEndDate(a);
                const bEnd = getEndDate(b);
                if (!aEnd && !bEnd) comparison = 0;
                else if (!aEnd) comparison = 1;
                else if (!bEnd) comparison = -1;
                else comparison = new Date(aEnd) - new Date(bEnd);
                break;
            default:
                comparison = 0;
        }

        return sortDirection === 'asc' ? comparison : -comparison;
    });

    const SortIcon = ({ field }) => {
        if (sortField !== field) return <ArrowUpDown size={14} className="sort-icon inactive" />;
        return sortDirection === 'asc'
            ? <ChevronUp size={14} className="sort-icon active" />
            : <ChevronDown size={14} className="sort-icon active" />;
    };

    return (
        <div className="task-table-container">
            <table className="task-table">
                <thead>
                    <tr>
                        <th onClick={() => handleSort('title')} className="sortable">
                            Task <SortIcon field="title" />
                        </th>
                        <th onClick={() => handleSort('priority')} className="sortable">
                            Priority <SortIcon field="priority" />
                        </th>
                        <th onClick={() => handleSort('status')} className="sortable">
                            Status <SortIcon field="status" />
                        </th>
                        <th onClick={() => handleSort('startDate')} className="sortable">
                            Start Date <SortIcon field="startDate" />
                        </th>
                        <th onClick={() => handleSort('endDate')} className="sortable">
                            End Date <SortIcon field="endDate" />
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {sortedTasks.length === 0 ? (
                        <tr>
                            <td colSpan="5" className="empty-row">No tasks yet. Add one to get started!</td>
                        </tr>
                    ) : (
                        sortedTasks.map(task => {
                            const overdue = isOverdue(task) && task.status !== 'done';
                            const startDate = getStartDate(task);
                            const endDate = getEndDate(task);
                            const status = task.status || 'todo';
                            return (
                                <tr
                                    key={task.id}
                                    className={`task-row ${overdue ? 'overdue' : ''}`}
                                    onClick={() => onTaskClick && onTaskClick(task)}
                                >
                                    <td className="task-title-cell">
                                        {task.title}
                                    </td>
                                    <td>
                                        <span
                                            className="priority-badge"
                                            style={{
                                                backgroundColor: `${priorityColors[task.priority]}20`,
                                                color: priorityColors[task.priority]
                                            }}
                                        >
                                            <Flag size={12} />
                                            {task.priority}
                                        </span>
                                    </td>
                                    <td>
                                        <span
                                            className="status-badge"
                                            style={{
                                                backgroundColor: `${statusColors[status]}20`,
                                                color: statusColors[status],
                                                padding: '4px 8px',
                                                borderRadius: '4px',
                                                fontSize: '0.85rem',
                                                fontWeight: '500',
                                                display: 'inline-block'
                                            }}
                                        >
                                            {statusLabels[status]}
                                        </span>
                                    </td>
                                    <td>
                                        {startDate ? (
                                            <span className="due-date-cell">
                                                <Calendar size={14} />
                                                {new Date(startDate).toLocaleDateString(undefined, { timeZone: 'UTC' })}
                                            </span>
                                        ) : (
                                            <span className="no-date">—</span>
                                        )}
                                    </td>
                                    <td className={overdue ? 'overdue-date' : ''}>
                                        {endDate ? (
                                            <span className="due-date-cell">
                                                <Calendar size={14} />
                                                {new Date(endDate).toLocaleDateString(undefined, { timeZone: 'UTC' })}
                                            </span>
                                        ) : (
                                            <span className="no-date">—</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
}

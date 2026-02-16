import { useState, memo } from 'react';
import { useData } from '../../context/DataContext';
import { KanbanCard } from './KanbanCard';

export const KanbanColumn = memo(function KanbanColumn({ column, tasks, projectId, onTaskClick }) {
    const { moveTask } = useData();
    const [isDragOver, setIsDragOver] = useState(false);

    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setIsDragOver(true);
    };

    const handleDragLeave = (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
            setIsDragOver(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragOver(false);

        const taskId = e.dataTransfer.getData('taskId');
        const sourceProjectId = e.dataTransfer.getData('projectId');

        if (taskId && String(sourceProjectId) === String(projectId)) {
            moveTask(projectId, taskId, column.id);
        }
    };

    return (
        <div
            className={`kanban-column ${isDragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <div className="column-header">
                <div className="column-indicator" style={{ backgroundColor: column.color }}></div>
                <h3 className="column-title">{column.title}</h3>
                <span className="column-count">{tasks.length}</span>
            </div>

            <div className="column-body">
                {tasks.map(task => (
                    <KanbanCard
                        key={task.id}
                        task={task}
                        projectId={projectId}
                        onClick={onTaskClick}
                    />
                ))}
            </div>
        </div>
    );
});

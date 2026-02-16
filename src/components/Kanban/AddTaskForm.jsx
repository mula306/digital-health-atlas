import { useState } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';

export function AddTaskForm({ onClose, projectId }) {
    const { addTask } = useData();
    const toast = useToast();
    const [title, setTitle] = useState('');
    const [priority, setPriority] = useState('medium');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [description, setDescription] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        addTask(projectId, {
            title,
            priority,
            startDate: startDate || null,
            endDate: endDate || null,
            description,
            status: 'todo',
            createdAt: new Date().toISOString()
        });
        toast.success('Task added');
        onClose();
    };


    // Get today's date for default
    const today = new Date().toISOString().split('T')[0];

    return (
        <form onSubmit={handleSubmit}>
            <div className="form-group">
                <label>Task Title</label>
                <input
                    type="text"
                    required
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className="form-input"
                    placeholder="e.g. Design Homepage"
                    autoFocus
                />
            </div>

            <div className="form-row">
                <div className="form-group">
                    <label>Priority</label>
                    <select value={priority} onChange={e => setPriority(e.target.value)} className="form-select">
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                    </select>
                </div>

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
                        min={startDate || today}
                    />
                </div>
            </div>

            <div className="form-group">
                <label>Description (optional)</label>
                <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="form-textarea"
                    rows={2}
                    placeholder="Task details..."
                />
            </div>

            <div className="form-actions">
                <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Add Task</button>
            </div>
        </form>
    );
}

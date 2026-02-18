import { useState } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';

export function EditGoalForm({ goal, onClose }) {
    const { updateGoal } = useData();
    const { success } = useToast();
    const [title, setTitle] = useState(goal.title || '');
    const [description, setDescription] = useState(goal.description || '');
    const [type, setType] = useState(goal.type || 'org');

    // Determine available types based on parent
    const typeOptions = [
        { value: 'org', label: 'Organization' },
        { value: 'div', label: 'Division' },
        { value: 'dept', label: 'Department' },
        { value: 'branch', label: 'Branch' }
    ];

    const handleSubmit = (e) => {
        e.preventDefault();
        updateGoal(goal.id, { title, description, type });
        success('Goal updated successfully');
        onClose();
    };


    return (
        <form onSubmit={handleSubmit}>
            <div className="form-group">
                <label>Goal Title</label>
                <input
                    type="text"
                    required
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className="form-input"
                    placeholder="Goal name"
                />
            </div>

            <div className="form-group">
                <label>Type</label>
                <select
                    value={type}
                    onChange={e => setType(e.target.value)}
                    className="form-select"
                >
                    {typeOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            </div>

            <div className="form-group">
                <label>Description (optional)</label>
                <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="form-textarea"
                    rows={3}
                    placeholder="Brief description..."
                />
            </div>

            <div className="form-actions">
                <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Save Changes</button>
            </div>
        </form>
    );
}

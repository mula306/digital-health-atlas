import { useState } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';

// Map parent type to child type
const NEXT_LEVEL = {
    'org': 'div',
    'div': 'dept',
    'dept': 'branch',
    'branch': 'branch' // Can't go lower than branch
};

export function AddGoalForm({ onClose, parentId = null, parentType = null }) {
    const { addGoal } = useData();
    const toast = useToast();
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    // Auto-select next level based on parent, default to 'org' if no parent
    const [type, setType] = useState(parentType ? NEXT_LEVEL[parentType] : 'org');
    const [progress, setProgress] = useState(0);

    const handleSubmit = (e) => {
        e.preventDefault();
        addGoal({
            title,
            description,
            type,
            parentId,
            progress: parseInt(progress)
        });
        toast.success('Goal created successfully');
        onClose();
    };


    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="form-group">
                <label>Goal Title</label>
                <input
                    type="text"
                    required
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className="form-input"
                    placeholder="e.g. Increase Global Market Share"
                />
            </div>

            <div className="form-group">
                <label>Type</label>
                <select value={type} onChange={e => setType(e.target.value)} className="form-select">
                    <option value="org">Organization</option>
                    <option value="div">Division</option>
                    <option value="dept">Department</option>
                    <option value="branch">Branch</option>
                </select>
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

            <div className="form-group">
                <label>Initial Progress (%)</label>
                <input
                    type="range"
                    min="0"
                    max="100"
                    value={progress}
                    onChange={e => setProgress(e.target.value)}
                    className="form-range"
                />
                <div className="text-right text-sm text-opacity-70">{progress}%</div>
            </div>

            <div className="form-actions">
                <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Create Goal</button>
            </div>
        </form>
    );
}


import { useState } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { CascadingGoalFilter } from '../UI/CascadingGoalFilter';

export function AddProjectForm({ onClose }) {
    const { addProject } = useData();
    const toast = useToast();
    const [title, setTitle] = useState('');
    const [goalId, setGoalId] = useState('');
    const [description, setDescription] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!goalId) {
            toast.warning('Please select a goal');
            return;
        }
        addProject({ title, goalId, description, status: 'active' });
        toast.success('Project created');
        onClose();
    };


    return (
        <form onSubmit={handleSubmit}>
            <div className="form-group">
                <label>Project Title</label>
                <input
                    type="text"
                    required
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className="form-input"
                    placeholder="e.g. Q1 Marketing Campaign"
                    autoFocus
                />
            </div>

            <div className="form-group">
                <label>Linked Goal</label>
                <CascadingGoalFilter value={goalId} onChange={setGoalId} />
                {!goalId && <span className="form-hint">Select a goal from the hierarchy above</span>}
            </div>

            <div className="form-group">
                <label>Description</label>
                <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="form-textarea"
                    rows={3}
                    placeholder="Brief project description..."
                />
            </div>

            <div className="form-actions">
                <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Create Project</button>
            </div>
        </form>
    );
}


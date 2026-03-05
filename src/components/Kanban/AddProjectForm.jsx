import { useState } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { CascadingGoalFilter } from '../UI/CascadingGoalFilter';
import { X } from 'lucide-react';

export function AddProjectForm({ onClose }) {
    const { addProject, goals } = useData();
    const toast = useToast();
    const [title, setTitle] = useState('');
    const [goalIds, setGoalIds] = useState([]);
    const [pendingGoalId, setPendingGoalId] = useState('');
    const [description, setDescription] = useState('');

    const addGoal = () => {
        if (!pendingGoalId || goalIds.includes(pendingGoalId)) return;
        setGoalIds(prev => [...prev, pendingGoalId]);
        setPendingGoalId('');
    };

    const removeGoal = (id) => {
        setGoalIds(prev => prev.filter(gid => gid !== id));
    };

    const getGoalTitle = (id) => {
        const goal = goals.find(g => String(g.id) === String(id));
        return goal ? `${goal.title} (${goal.type})` : id;
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (goalIds.length === 0) {
            toast.warning('Please select at least one goal');
            return;
        }
        addProject({ title, goalIds, description, status: 'active' });
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
                <label>Linked Goals</label>
                {goalIds.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        {goalIds.map(gid => (
                            <span key={gid} style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
                                borderRadius: '6px', padding: '4px 10px', fontSize: '0.85rem'
                            }}>
                                {getGoalTitle(gid)}
                                <button type="button" onClick={() => removeGoal(gid)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-tertiary)', display: 'flex' }}>
                                    <X size={14} />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                        <CascadingGoalFilter value={pendingGoalId} onChange={setPendingGoalId} />
                    </div>
                    <button type="button" onClick={addGoal} className="btn-secondary"
                        disabled={!pendingGoalId}
                        style={{ whiteSpace: 'nowrap', marginTop: '2px' }}>
                        + Add Goal
                    </button>
                </div>
                {goalIds.length === 0 && <span className="form-hint">Select one or more goals from the hierarchy above</span>}
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

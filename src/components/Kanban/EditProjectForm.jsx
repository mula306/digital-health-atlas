import { useState } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { ProjectTagSelector } from '../UI/ProjectTagSelector';
import { CascadingGoalFilter } from '../UI/CascadingGoalFilter';
import { X } from 'lucide-react';

export function EditProjectForm({ project, onClose }) {
    const { updateProject, deleteProject, goals } = useData();
    const { success } = useToast();
    const [title, setTitle] = useState(project.title || '');
    // Initialize from goalIds array or fall back to single goalId
    const [goalIds, setGoalIds] = useState(() => {
        if (project.goalIds && project.goalIds.length > 0) return project.goalIds.map(String);
        if (project.goalId) return [String(project.goalId)];
        return [];
    });
    const [pendingGoalId, setPendingGoalId] = useState('');
    const [description, setDescription] = useState(project.description || '');
    const [status, setStatus] = useState(project.status || 'active');
    const [confirmDelete, setConfirmDelete] = useState(false);

    const addGoal = () => {
        if (!pendingGoalId || goalIds.includes(String(pendingGoalId))) return;
        setGoalIds(prev => [...prev, String(pendingGoalId)]);
        setPendingGoalId('');
    };

    const removeGoal = (id) => {
        setGoalIds(prev => prev.filter(gid => gid !== String(id)));
    };

    const getGoalTitle = (id) => {
        const goal = goals.find(g => String(g.id) === String(id));
        return goal ? `${goal.title} (${goal.type})` : id;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        await updateProject(project.id, { title, goalIds, description, status });
        success('Project updated successfully');
        onClose();
    };

    const handleDelete = () => {
        if (confirmDelete) {
            deleteProject(project.id);
            success('Project deleted');
            onClose(true);
        } else {
            setConfirmDelete(true);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
                <div className="form-group">
                    <label>Project Title</label>
                    <input
                        type="text"
                        required
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        className="form-input"
                        placeholder="Project name"
                    />
                </div>

                <div className="form-group">
                    <label>Project Status</label>
                    <select
                        value={status}
                        onChange={e => setStatus(e.target.value)}
                        className="form-select"
                    >
                        <option value="active">Active</option>
                        <option value="on-hold">On Hold</option>
                        <option value="completed">Completed</option>
                    </select>
                </div>
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
            </div>

            <div className="form-group">
                <label>Description</label>
                <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="form-textarea"
                    rows={4}
                    placeholder="Brief project description..."
                />
            </div>

            <div className="form-group">
                <label>Project Tags</label>
                <ProjectTagSelector
                    projectId={project.id}
                    currentTags={project.tags || []}
                    compact={false}
                />
            </div>

            <div className="form-actions" style={{ justifyContent: 'space-between' }}>
                <button
                    type="button"
                    onClick={handleDelete}
                    className="btn-danger"
                    style={{
                        background: confirmDelete ? '#ef4444' : 'transparent',
                        color: confirmDelete ? 'white' : '#ef4444',
                        border: '1px solid #ef4444'
                    }}
                >
                    {confirmDelete ? 'Click Again to Confirm' : 'Delete Project'}
                </button>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
                    <button type="submit" className="btn-primary">Save Changes</button>
                </div>
            </div>
        </form>
    );
}

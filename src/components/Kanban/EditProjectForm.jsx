import { useState, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { ProjectTagSelector } from '../UI/ProjectTagSelector';

export function EditProjectForm({ project, onClose }) {
    const { updateProject, deleteProject, goals } = useData();
    const { success } = useToast();
    const [title, setTitle] = useState(project.title || '');
    const [goalId, setGoalId] = useState(project.goalId || '');
    const [description, setDescription] = useState(project.description || '');
    const [status, setStatus] = useState(project.status || 'active');
    const [confirmDelete, setConfirmDelete] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        await updateProject(project.id, { title, goalId, description, status });
        success('Project updated successfully');
        onClose();
    };

    const handleDelete = () => {
        if (confirmDelete) {
            deleteProject(project.id);
            success('Project deleted');
            onClose(true); // Signal that project was deleted
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
                <label>Linked Goal</label>
                <select
                    value={goalId}
                    onChange={e => setGoalId(e.target.value)}
                    className="form-select"
                    required
                >
                    <option value="">Select a Goal...</option>
                    {goals.map(g => (
                        <option key={g.id} value={g.id}>{g.title} ({g.type})</option>
                    ))}
                </select>
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

import { useState } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { ProjectTagSelector } from '../UI/ProjectTagSelector';
import { CascadingGoalFilter } from '../UI/CascadingGoalFilter';
import { validateGoalAssignment } from '../../utils/goalAssignmentValidation';
import { X } from 'lucide-react';

export function EditProjectForm({
    project,
    onClose,
    canEditProject = true,
    canDeleteProject = false
}) {
    const { updateProject, updateProjectTags, deleteProject, goals } = useData();
    const { success, error: showError } = useToast();
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
    const [projectTags, setProjectTags] = useState(() =>
        (project.tags || []).map((tag) => ({
            tagId: String(tag.tagId ?? tag.id),
            isPrimary: !!tag.isPrimary
        }))
    );
    const [confirmDelete, setConfirmDelete] = useState(false);

    const areTagsEqual = (a, b) => {
        if (a.length !== b.length) return false;
        const normalize = (tags) => tags
            .map((t) => ({ tagId: String(t.tagId), isPrimary: !!t.isPrimary }))
            .sort((x, y) => x.tagId.localeCompare(y.tagId));
        return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
    };

    const addGoal = () => {
        if (!pendingGoalId || goalIds.includes(String(pendingGoalId))) return;
        const validation = validateGoalAssignment(goals, [...goalIds, String(pendingGoalId)]);
        if (!validation.valid) {
            showError(validation.error);
            return;
        }
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
        if (!canEditProject) {
            showError('You do not have permission to edit this project.');
            return;
        }
        const normalizedPendingGoalId = String(pendingGoalId || '').trim();
        const hasPendingGoal = normalizedPendingGoalId !== '' && !goalIds.includes(normalizedPendingGoalId);
        const effectiveGoalIds = hasPendingGoal
            ? [...goalIds, normalizedPendingGoalId]
            : goalIds;

        const goalValidation = validateGoalAssignment(goals, effectiveGoalIds);
        if (!goalValidation.valid) {
            showError(goalValidation.error);
            return;
        }
        if (projectTags.length > 8) {
            showError('Maximum 8 tags per project');
            return;
        }
        try {
            await updateProject(project.id, { title, goalIds: effectiveGoalIds, description, status });
            await updateProjectTags(project.id, projectTags);
            success('Project and tags updated successfully');
            onClose();
        } catch (err) {
            if (typeof err?.message === 'string' && err.message.toLowerCase().includes('maximum 8 tags')) {
                showError('Maximum 8 tags per project');
                return;
            }
            showError(err.message || 'Failed to update project');
        }
    };

    const handleDelete = () => {
        if (!canDeleteProject) {
            showError('You do not have permission to delete this project.');
            return;
        }
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
                        disabled={!canEditProject}
                    />
                </div>

                <div className="form-group">
                    <label>Project Status</label>
                    <select
                        value={status}
                        onChange={e => setStatus(e.target.value)}
                        className="form-select"
                        disabled={!canEditProject}
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
                                    disabled={!canEditProject}
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
                        disabled={!pendingGoalId || !canEditProject}
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
                    disabled={!canEditProject}
                />
            </div>

            <div className="form-group">
                <label>Project Tags</label>
                <div style={{ pointerEvents: canEditProject ? 'auto' : 'none', opacity: canEditProject ? 1 : 0.65 }}>
                    <ProjectTagSelector
                        projectId={project.id}
                        currentTags={projectTags}
                        onChange={(nextTags) => {
                            setProjectTags((prev) => (areTagsEqual(prev, nextTags) ? prev : nextTags));
                        }}
                        showSaveButton={false}
                        compact={false}
                    />
                </div>
            </div>

            <div className="form-actions" style={{ justifyContent: 'space-between' }}>
                <div>
                    {canDeleteProject && (
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
                    )}
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
                    {canEditProject && <button type="submit" className="btn-primary">Save Changes</button>}
                </div>
            </div>
        </form>
    );
}

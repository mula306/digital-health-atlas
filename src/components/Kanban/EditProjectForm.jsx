import { useEffect, useState } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { ProjectTagSelector } from '../UI/ProjectTagSelector';
import { CascadingGoalFilter } from '../UI/CascadingGoalFilter';
import { validateGoalAssignment } from '../../utils/goalAssignmentValidation';
import { X } from 'lucide-react';
import { formatGoalOptionLabel } from '../../utils/goalHierarchy';

export function EditProjectForm({
    project,
    onClose,
    canEditProject = true,
    canDeleteProject = false
}) {
    const { updateProject, updateProjectTags, deleteProject, goals, currentUser, fetchOrganizations, hasRole } = useData();
    const { success, error: showError } = useToast();
    const isAdmin = hasRole('Admin');
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
    const [organizations, setOrganizations] = useState([]);
    const [selectedOrgId, setSelectedOrgId] = useState(
        project.orgId || (currentUser?.orgId ? String(currentUser.orgId) : '')
    );
    const [confirmDelete, setConfirmDelete] = useState(false);

    useEffect(() => {
        let cancelled = false;

        async function loadOrganizations() {
            if (!isAdmin) return;
            try {
                const orgs = await fetchOrganizations();
                if (!cancelled) {
                    setOrganizations(Array.isArray(orgs) ? orgs : []);
                }
            } catch (err) {
                console.warn('Failed to load organizations for project editing', err);
                if (!cancelled) {
                    setOrganizations([]);
                }
            }
        }

        loadOrganizations();
        return () => {
            cancelled = true;
        };
    }, [fetchOrganizations, isAdmin]);

    const areTagsEqual = (a, b) => {
        if (a.length !== b.length) return false;
        const normalize = (tags) => tags
            .map((t) => ({ tagId: String(t.tagId), isPrimary: !!t.isPrimary }))
            .sort((x, y) => x.tagId.localeCompare(y.tagId));
        return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
    };

    const isSharedProject = !isAdmin && String(project.orgId) !== String(currentUser?.orgId);

    // Separate goals into owner-org and user-org groups
    const ownerOrgGoalIds = goalIds.filter(gid => {
        const goal = goals.find(g => String(g.id) === String(gid));
        return goal && String(goal.orgId) === String(project.orgId);
    });
    const userOrgGoalIds = goalIds.filter(gid => {
        const goal = goals.find(g => String(g.id) === String(gid));
        return !goal || String(goal.orgId) !== String(project.orgId);
    });

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
        // Shared users cannot remove owner-org goals
        if (isSharedProject) {
            const goal = goals.find(g => String(g.id) === String(id));
            if (goal && String(goal.orgId) === String(project.orgId)) return;
        }
        setGoalIds(prev => prev.filter(gid => gid !== String(id)));
    };

    const getGoalTitle = (id) => {
        const goal = goals.find(g => String(g.id) === String(id));
        return goal ? formatGoalOptionLabel(goal) : id;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canEditProject) {
            showError('You do not have permission to edit this project.');
            return;
        }
        const normalizedPendingGoalId = String(pendingGoalId || '').trim();
        const hasPendingGoal = normalizedPendingGoalId !== '' && !goalIds.includes(normalizedPendingGoalId);
        let effectiveGoalIds = hasPendingGoal
            ? [...goalIds, normalizedPendingGoalId]
            : [...goalIds];

        // Safety: for shared users, always ensure owner-org goals are preserved
        if (isSharedProject) {
            const originalOwnerGoalIds = (project.goalIds || []).filter(gid => {
                const goal = goals.find(g => String(g.id) === String(gid));
                return goal && String(goal.orgId) === String(project.orgId);
            }).map(String);
            originalOwnerGoalIds.forEach(gid => {
                if (!effectiveGoalIds.includes(gid)) effectiveGoalIds.push(gid);
            });
        }

        const goalValidation = validateGoalAssignment(goals, effectiveGoalIds);
        if (!goalValidation.valid) {
            showError(goalValidation.error);
            return;
        }
        if (projectTags.length > 8) {
            showError('Maximum 8 tags per project');
            return;
        }
        if (isAdmin && !selectedOrgId) {
            showError('Select an owning organization for this project');
            return;
        }
        try {
            await updateProject(project.id, {
                title,
                goalIds: effectiveGoalIds,
                description,
                status,
                ...(isAdmin ? { orgId: selectedOrgId } : {})
            });
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

    const renderGoalChip = (gid, canRemove) => (
        <span key={gid} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: canRemove ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
            border: `1px solid ${canRemove ? 'var(--border-primary)' : 'var(--border-secondary)'}`,
            borderRadius: '6px', padding: '4px 10px', fontSize: '0.85rem',
            opacity: canRemove ? 1 : 0.7
        }}>
            {!canRemove && <span title="Managed by owner organization" style={{ fontSize: '0.75rem' }}>🔒</span>}
            {getGoalTitle(gid)}
            {canRemove && (
                <button type="button" onClick={() => removeGoal(gid)}
                    disabled={!canEditProject}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-tertiary)', display: 'flex' }}>
                    <X size={14} />
                </button>
            )}
        </span>
    );

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

            {isAdmin && (
                <div className="form-group">
                    <label>Owning Organization</label>
                    <select
                        value={selectedOrgId}
                        onChange={(e) => setSelectedOrgId(e.target.value)}
                        className="form-select"
                        disabled={!canEditProject}
                        required
                    >
                        <option value="">Select organization</option>
                        {organizations.map((organization) => (
                            <option key={organization.id} value={organization.id}>
                                {organization.name}
                            </option>
                        ))}
                    </select>
                    <div className="form-hint form-hint-warning">
                        Changing the owning organization moves default visibility and control to that organization.
                    </div>
                </div>
            )}

            <div className="form-group">
                <label>Linked Goals</label>

                {/* Admin: show grouped goals */}
                {isAdmin && goalIds.length > 0 && (
                    <div style={{ marginBottom: '0.75rem' }}>
                        {ownerOrgGoalIds.length > 0 && (
                            <div style={{ marginBottom: '0.5rem' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Owner Organization</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                    {ownerOrgGoalIds.map(gid => renderGoalChip(gid, true))}
                                </div>
                            </div>
                        )}
                        {userOrgGoalIds.length > 0 && (
                            <div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Other Organizations</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                    {userOrgGoalIds.map(gid => renderGoalChip(gid, true))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Shared user: owner goals read-only, own goals editable */}
                {!isAdmin && isSharedProject && goalIds.length > 0 && (
                    <div style={{ marginBottom: '0.75rem' }}>
                        {ownerOrgGoalIds.length > 0 && (
                            <div style={{ marginBottom: '0.5rem' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Owner Organization</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                    {ownerOrgGoalIds.map(gid => renderGoalChip(gid, false))}
                                </div>
                            </div>
                        )}
                        {userOrgGoalIds.length > 0 && (
                            <div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Your Organization</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                    {userOrgGoalIds.map(gid => renderGoalChip(gid, true))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Owner user: flat list as before */}
                {!isAdmin && !isSharedProject && goalIds.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        {goalIds.map(gid => renderGoalChip(gid, true))}
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

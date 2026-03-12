import { useEffect, useState } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { CascadingGoalFilter } from '../UI/CascadingGoalFilter';
import { ProjectTagSelector } from '../UI/ProjectTagSelector';
import { validateGoalAssignment } from '../../utils/goalAssignmentValidation';
import { X } from 'lucide-react';
import { formatGoalOptionLabel } from '../../utils/goalHierarchy';

export function AddProjectForm({ onClose }) {
    const { addProject, updateProjectTags, goals, currentUser, fetchOrganizations, hasRole } = useData();
    const { success, warning, error: showError } = useToast();
    const isAdmin = hasRole('Admin');
    const [title, setTitle] = useState('');
    const [goalIds, setGoalIds] = useState([]);
    const [pendingGoalId, setPendingGoalId] = useState('');
    const [description, setDescription] = useState('');
    const [projectTags, setProjectTags] = useState([]);
    const [organizations, setOrganizations] = useState([]);
    const [selectedOrgId, setSelectedOrgId] = useState(currentUser?.orgId ? String(currentUser.orgId) : '');

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
                console.warn('Failed to load organizations for project creation', err);
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

    const addGoal = () => {
        if (!pendingGoalId || goalIds.includes(pendingGoalId)) return;
        const validation = validateGoalAssignment(goals, [...goalIds, pendingGoalId]);
        if (!validation.valid) {
            showError(validation.error);
            return;
        }
        setGoalIds(prev => [...prev, pendingGoalId]);
        setPendingGoalId('');
    };

    const removeGoal = (id) => {
        setGoalIds(prev => prev.filter(gid => gid !== id));
    };

    const getGoalTitle = (id) => {
        const goal = goals.find(g => String(g.id) === String(id));
        return goal ? formatGoalOptionLabel(goal) : id;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const normalizedPendingGoalId = String(pendingGoalId || '').trim();
        const hasPendingGoal = normalizedPendingGoalId !== '' && !goalIds.includes(normalizedPendingGoalId);
        const effectiveGoalIds = hasPendingGoal
            ? [...goalIds, normalizedPendingGoalId]
            : goalIds;

        if (effectiveGoalIds.length === 0) {
            warning('Please select at least one goal');
            return;
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
            const projectId = await addProject({
                title,
                goalIds: effectiveGoalIds,
                description,
                status: 'active',
                ...(isAdmin ? { orgId: selectedOrgId } : {})
            });
            if (projectTags.length > 0) {
                try {
                    await updateProjectTags(projectId, projectTags);
                } catch (tagErr) {
                    showError(`Project created, but tags were not saved: ${tagErr.message}`);
                    onClose();
                    return;
                }
            }
            success('Project created');
            onClose();
        } catch (err) {
            showError(err.message || 'Failed to create project');
        }
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

            {isAdmin && (
                <div className="form-group">
                    <label>Owning Organization</label>
                    <select
                        value={selectedOrgId}
                        onChange={(e) => setSelectedOrgId(e.target.value)}
                        className="form-select"
                        required
                    >
                        <option value="">Select organization</option>
                        {organizations.map((organization) => (
                            <option key={organization.id} value={organization.id}>
                                {organization.name}
                            </option>
                        ))}
                    </select>
                </div>
            )}

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

            <div className="form-group">
                <label>Project Tags</label>
                <ProjectTagSelector
                    currentTags={projectTags}
                    onChange={(nextTags) => {
                        setProjectTags((prev) => (areTagsEqual(prev, nextTags) ? prev : nextTags));
                    }}
                    showSaveButton={false}
                    compact={false}
                />
            </div>

            <div className="form-actions">
                <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Create Project</button>
            </div>
        </form>
    );
}

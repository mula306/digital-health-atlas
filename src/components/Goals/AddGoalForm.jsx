import { useEffect, useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { getAllowedGoalTypes, getGoalLevelDefinition, GOAL_ROOT_TYPE } from '../../../shared/goalLevels.js';

export function AddGoalForm({ onClose, parentId = null, parentType = null }) {
    const { addGoal, currentUser, fetchOrganizations, hasRole } = useData();
    const toast = useToast();
    const isAdmin = hasRole('Admin');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const allowedTypeOptions = useMemo(
        () => getAllowedGoalTypes({ parentType }),
        [parentType]
    );
    const [type, setType] = useState(() => allowedTypeOptions[0] || GOAL_ROOT_TYPE);
    const [progress, setProgress] = useState(0);
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
                console.warn('Failed to load organizations for goal creation', err);
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

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isAdmin && !selectedOrgId) {
            toast.error('Select an owning organization for this goal');
            return;
        }

        if (!type) {
            toast.error('This goal cannot accept additional sub-goals.');
            return;
        }

        try {
            await addGoal({
                title,
                description,
                type,
                parentId,
                progress: parseInt(progress),
                ...(isAdmin ? { orgId: selectedOrgId } : {})
            });
            toast.success('Goal created successfully');
            onClose();
        } catch (err) {
            toast.error(err.message || 'Failed to create goal');
        }
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
                <label>Goal Level</label>
                <select
                    value={type}
                    onChange={e => setType(e.target.value)}
                    className="form-select"
                    disabled={allowedTypeOptions.length <= 1}
                >
                    {allowedTypeOptions.map((option) => {
                        const level = getGoalLevelDefinition(option);
                        return (
                            <option key={option} value={option}>
                                {level?.label || option}
                            </option>
                        );
                    })}
                </select>
                <div className="form-hint">
                    {parentType
                        ? `Sub-goals at this point in the cascade are created as ${getGoalLevelDefinition(type)?.goalLabel || 'goals'}.`
                        : 'Root goals start at the Enterprise level.'}
                </div>
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


import { useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import {
    getAllowedGoalTypes,
    getGoalLevelDefinition,
    GOAL_ROOT_TYPE,
    isValidChildGoalType
} from '../../../shared/goalLevels.js';

export function EditGoalForm({ goal, onClose }) {
    const { goals, updateGoal } = useData();
    const { success } = useToast();
    const [title, setTitle] = useState(goal.title || '');
    const [description, setDescription] = useState(goal.description || '');
    const parentGoal = useMemo(
        () => goals.find((candidate) => String(candidate.id) === String(goal.parentId)) || null,
        [goal.parentId, goals]
    );
    const childGoals = useMemo(
        () => goals.filter((candidate) => String(candidate.parentId) === String(goal.id)),
        [goal.id, goals]
    );
    const typeOptions = useMemo(() => {
        const baseOptions = getAllowedGoalTypes({ parentType: parentGoal?.type || null });
        const constrainedOptions = baseOptions.filter((candidateType) =>
            childGoals.every((childGoal) => isValidChildGoalType(candidateType, childGoal.type))
        );
        return constrainedOptions.length > 0 ? constrainedOptions : [goal.type || GOAL_ROOT_TYPE];
    }, [childGoals, goal.type, parentGoal?.type]);
    const [type, setType] = useState(() => typeOptions[0] || goal.type || GOAL_ROOT_TYPE);

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
                <label>Goal Level</label>
                <select
                    value={type}
                    onChange={e => setType(e.target.value)}
                    className="form-select"
                    disabled={typeOptions.length <= 1}
                >
                    {typeOptions.map((option) => (
                        <option key={option} value={option}>
                            {getGoalLevelDefinition(option)?.label || option}
                        </option>
                    ))}
                </select>
                <div className="form-hint">
                    {parentGoal
                        ? `This goal sits under ${parentGoal.title} and must remain a ${getGoalLevelDefinition(type)?.goalLabel || 'goal'}.`
                        : 'Root goals remain Enterprise goals in the cascade.'}
                </div>
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

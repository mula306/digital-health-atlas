import { useMemo } from 'react';
import { Filter, X } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { GOAL_LEVELS } from '../../../shared/goalLevels.js';
import { buildGoalMap, buildGoalPath } from '../../utils/goalHierarchy';
import './CascadingGoalFilter.css';

export function CascadingGoalFilter({ value, onChange }) {
    const { goals } = useData();
    const emptySelections = useMemo(
        () => Object.fromEntries(GOAL_LEVELS.map((level) => [level.code, ''])),
        []
    );

    const goalsById = useMemo(() => {
        return buildGoalMap(goals);
    }, [goals]);

    const selections = useMemo(() => {
        if (!value) {
            return { ...emptySelections };
        }

        const ancestry = buildGoalPath(goalsById, value);
        const nextSelections = { ...emptySelections };

        ancestry.forEach((goal, index) => {
            const level = GOAL_LEVELS[index];
            if (level) {
                nextSelections[level.code] = String(goal.id);
            }
        });

        return nextSelections;
    }, [emptySelections, goalsById, value]);

    const optionsByLevel = useMemo(() => GOAL_LEVELS.reduce((accumulator, level, index) => {
        const parentCode = GOAL_LEVELS[index - 1]?.code || null;
        const parentId = parentCode ? selections[parentCode] : null;
        accumulator[level.code] = index === 0
            ? goals.filter((goal) => !goal.parentId)
            : (parentId ? goals.filter((goal) => goal.parentId === parentId) : []);
        return accumulator;
    }, {}), [goals, selections]);

    // Handle selection change at a level
    const handleChange = (level, goalIdValue) => {
        // IDs are strings from API, so keep them as strings to match
        const goalId = goalIdValue || '';
        const levelIndex = GOAL_LEVELS.findIndex((entry) => entry.code === level);
        const newSelections = { ...emptySelections };

        GOAL_LEVELS.forEach((entry, index) => {
            if (index < levelIndex) {
                newSelections[entry.code] = selections[entry.code];
            } else if (index === levelIndex) {
                newSelections[entry.code] = goalId;
            }
        });

        // Return the most specific (deepest) selection
        const selectedId = [...GOAL_LEVELS]
            .reverse()
            .map((entry) => newSelections[entry.code])
            .find(Boolean) || '';
        onChange(selectedId);
    };

    // Clear all filters
    const handleClear = () => {
        onChange('');
    };

    const hasAnySelection = GOAL_LEVELS.some((level) => selections[level.code]);

    return (
        <div className="cascading-filter">
            <div className="cascading-filter-row">
                <Filter size={16} className="filter-icon" />

                {GOAL_LEVELS.map((level, index) => {
                    const parentCode = GOAL_LEVELS[index - 1]?.code || null;
                    const shouldShow = index === 0 || (selections[parentCode] && optionsByLevel[level.code]?.length > 0);
                    if (!shouldShow) return null;

                    return (
                    <select
                        key={level.code}
                        value={selections[level.code]}
                        onChange={e => handleChange(level.code, e.target.value)}
                        className="form-select"
                        style={{ minWidth: '160px', width: 'auto' }}
                    >
                        <option value="">{`All ${level.pluralLabel}`}</option>
                        {(optionsByLevel[level.code] || []).map(g => (
                            <option key={g.id} value={g.id}>{g.title}</option>
                        ))}
                    </select>
                    );
                })}

                {/* Clear button */}
                {hasAnySelection && (
                    <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleClear}
                        title="Clear filters"
                        style={{ padding: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <X size={16} />
                    </button>
                )}
            </div>
        </div>
    );
}

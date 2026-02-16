import { useState, useEffect } from 'react';
import { Filter, X } from 'lucide-react';
import { useData } from '../../context/DataContext';
import './CascadingGoalFilter.css';

const LEVEL_NAMES = ['Organization', 'Division', 'Department', 'Branch'];

export function CascadingGoalFilter({ value, onChange }) {
    const { goals } = useData();

    // Track selections at each level
    const [selections, setSelections] = useState({
        org: '',
        division: '',
        department: '',
        branch: ''
    });

    // Get goals at each level
    const getGoalsAtLevel = (level, parentId = null) => {
        if (level === 0) {
            // Root level - no parent
            return goals.filter(g => !g.parentId);
        }
        // Child level - filter by parent
        if (!parentId) return [];
        return goals.filter(g => g.parentId === parentId);
    };

    // Get available options for each dropdown
    const orgGoals = getGoalsAtLevel(0);
    const divisionGoals = getGoalsAtLevel(1, selections.org);
    const departmentGoals = getGoalsAtLevel(2, selections.division);
    const branchGoals = getGoalsAtLevel(3, selections.department);

    // Handle selection change at a level
    const handleChange = (level, goalIdValue) => {
        // IDs are strings from API, so keep them as strings to match
        const goalId = goalIdValue || '';
        const newSelections = { ...selections };

        switch (level) {
            case 'org':
                newSelections.org = goalId;
                newSelections.division = '';
                newSelections.department = '';
                newSelections.branch = '';
                break;
            case 'division':
                newSelections.division = goalId;
                newSelections.department = '';
                newSelections.branch = '';
                break;
            case 'department':
                newSelections.department = goalId;
                newSelections.branch = '';
                break;
            case 'branch':
                newSelections.branch = goalId;
                break;
        }

        setSelections(newSelections);

        // Return the most specific (deepest) selection
        const selectedId = newSelections.branch || newSelections.department ||
            newSelections.division || newSelections.org || '';
        onChange(selectedId);
    };

    // Clear all filters
    const handleClear = () => {
        setSelections({ org: '', division: '', department: '', branch: '' });
        onChange('');
    };

    // Sync external value changes
    useEffect(() => {
        if (!value) {
            setSelections({ org: '', division: '', department: '', branch: '' });
            return;
        }

        // Find the goal and trace its ancestry
        // Use loose equality or parsing to match string/number
        const goal = goals.find(g => g.id == value);
        if (!goal) return;

        // Build ancestry chain
        const ancestry = [];
        let current = goal;
        while (current) {
            ancestry.unshift(current.id);
            // Ensure parentId lookup is robust
            current = goals.find(g => g.id === current.parentId);
        }

        // Set selections based on ancestry
        setSelections({
            org: ancestry[0] || '',
            division: ancestry[1] || '',
            department: ancestry[2] || '',
            branch: ancestry[3] || ''
        });
    }, [value, goals]);

    const hasAnySelection = selections.org || selections.division ||
        selections.department || selections.branch;

    return (
        <div className="cascading-filter">
            <div className="cascading-filter-row">
                <Filter size={16} className="filter-icon" />

                {/* Organization */}
                <select
                    value={selections.org}
                    onChange={e => handleChange('org', e.target.value)}
                    className="form-select"
                    style={{ minWidth: '160px', width: 'auto' }}
                >
                    <option value="">All Organizations</option>
                    {orgGoals.map(g => (
                        <option key={g.id} value={g.id}>{g.title}</option>
                    ))}
                </select>

                {/* Division - only show if org selected */}
                {selections.org && divisionGoals.length > 0 && (
                    <select
                        value={selections.division}
                        onChange={e => handleChange('division', e.target.value)}
                        className="form-select"
                        style={{ minWidth: '160px', width: 'auto' }}
                    >
                        <option value="">All Divisions</option>
                        {divisionGoals.map(g => (
                            <option key={g.id} value={g.id}>{g.title}</option>
                        ))}
                    </select>
                )}

                {/* Department - only show if division selected */}
                {selections.division && departmentGoals.length > 0 && (
                    <select
                        value={selections.department}
                        onChange={e => handleChange('department', e.target.value)}
                        className="form-select"
                        style={{ minWidth: '160px', width: 'auto' }}
                    >
                        <option value="">All Departments</option>
                        {departmentGoals.map(g => (
                            <option key={g.id} value={g.id}>{g.title}</option>
                        ))}
                    </select>
                )}

                {/* Branch - only show if department selected */}
                {selections.department && branchGoals.length > 0 && (
                    <select
                        value={selections.branch}
                        onChange={e => handleChange('branch', e.target.value)}
                        className="form-select"
                        style={{ minWidth: '160px', width: 'auto' }}
                    >
                        <option value="">All Branches</option>
                        {branchGoals.map(g => (
                            <option key={g.id} value={g.id}>{g.title}</option>
                        ))}
                    </select>
                )}

                {/* Clear button */}
                {hasAnySelection && (
                    <button
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

// Helper function to get all descendant goal IDs
export function getDescendantGoalIds(goals, parentId) {
    const descendants = [];
    // Use loose equality to match string IDs with number parentIds if needed
    const children = goals.filter(g => g.parentId == parentId);

    for (const child of children) {
        descendants.push(child.id);
        descendants.push(...getDescendantGoalIds(goals, child.id));
    }

    return descendants;
}

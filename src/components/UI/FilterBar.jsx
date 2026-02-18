import React, { useState, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { CascadingGoalFilter } from './CascadingGoalFilter';
import { Tag, X } from 'lucide-react';
import './FilterBar.css';

/**
 * Shared FilterBar used across Dashboard, Goals, Projects, Metrics views.
 * Matches the ExecDashboard filter style: CascadingGoalFilter + Tag toggle + Clear All + count.
 *
 * Props:
 *  - goalFilter: string (selected goal id)
 *  - onGoalFilterChange: (id) => void
 *  - selectedTags: string[] (selected tag ids)
 *  - onTagsChange: (tags: string[]) => void
 *  - countLabel: string (e.g., "42 project(s)")
 *  - children: extra buttons rendered in the filter row
 */
export function FilterBar({
    goalFilter,
    onGoalFilterChange,
    selectedTags = [],
    onTagsChange,
    countLabel,
    children
}) {
    const { tagGroups } = useData();
    const [showTagFilter, setShowTagFilter] = useState(false);

    // Get only active tags grouped for the filter UI
    const activeTags = useMemo(() => {
        if (!tagGroups || tagGroups.length === 0) return [];
        return tagGroups
            .map(group => ({
                ...group,
                tags: (group.tags || []).filter(t => t.status?.toLowerCase() === 'active')
            }))
            .filter(group => group.tags.length > 0);
    }, [tagGroups]);

    const toggleTag = (tagId) => {
        if (!onTagsChange) return;
        const next = selectedTags.includes(tagId)
            ? selectedTags.filter(id => id !== tagId)
            : [...selectedTags, tagId];
        onTagsChange(next);
    };

    const clearAll = () => {
        onGoalFilterChange('');
        if (onTagsChange) onTagsChange([]);
    };

    const hasAnyFilter = goalFilter || selectedTags.length > 0;

    return (
        <div className="shared-filter-bar glass">
            <div className="shared-filter-row">
                <CascadingGoalFilter value={goalFilter} onChange={onGoalFilterChange} />

                {activeTags.length > 0 && (
                    <button
                        className={`btn-secondary btn-sm shared-tag-toggle ${showTagFilter ? 'active' : ''} ${selectedTags.length > 0 ? 'has-selection' : ''}`}
                        onClick={() => setShowTagFilter(!showTagFilter)}
                    >
                        <Tag size={14} />
                        Tags{selectedTags.length > 0 && <span className="shared-tag-count">{selectedTags.length}</span>}
                    </button>
                )}

                {hasAnyFilter && (
                    <button className="btn-secondary btn-sm shared-clear-btn" onClick={clearAll}>
                        <X size={14} /> Clear All
                    </button>
                )}

                {children}

                {countLabel && (
                    <span className="shared-filter-count">{countLabel}</span>
                )}
            </div>

            {showTagFilter && activeTags.length > 0 && (
                <div className="shared-tag-panel">
                    {activeTags.map(group => (
                        <div key={group.id} className="exec-tag-group">
                            <span className="exec-tag-group-label">{group.name}</span>
                            <div className="exec-tag-options">
                                {group.tags.map(tag => (
                                    <button
                                        key={tag.id}
                                        className={`exec-tag-pill ${selectedTags.includes(String(tag.id)) ? 'selected' : ''}`}
                                        onClick={() => toggleTag(String(tag.id))}
                                        style={{ '--tag-color': tag.color || '#6366f1' }}
                                    >
                                        <span className="exec-tag-dot" style={{ background: tag.color || '#6366f1' }}></span>
                                        {tag.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

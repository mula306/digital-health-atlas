import { useState, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { CascadingGoalFilter } from './CascadingGoalFilter';
import { Tag, Activity, X, Filter } from 'lucide-react';
import './FilterBar.css';

/**
 * Shared FilterBar used across Dashboard, Goals, Projects, Metrics views.
 * Matches the Advanced filter style: CascadingGoalFilter + Filters accordion + Clear All + count.
 *
 * Props:
 *  - goalFilter: string (selected goal id)
 *  - onGoalFilterChange: (id) => void
 *  - selectedTags: string[] (selected tag ids)
 *  - onTagsChange: (tags: string[]) => void
 *  - selectedStatuses: string[] (selected status keys)
 *  - onStatusesChange: (statuses: string[]) => void
 *  - statusOptions: { id: string, label: string, color?: string }[]
 *  - countLabel: string (e.g., "42 project(s)")
 *  - children: extra buttons rendered in the filter row
 */
export function FilterBar({
    goalFilter,
    onGoalFilterChange,
    selectedTags = [],
    onTagsChange,
    selectedStatuses = [],
    onStatusesChange,
    statusOptions = [],
    countLabel,
    children
}) {
    const { tagGroups } = useData();
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

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

    const toggleStatus = (statusId) => {
        if (!onStatusesChange) return;
        const normalized = String(statusId).toLowerCase();
        const next = selectedStatuses.includes(normalized)
            ? selectedStatuses.filter(id => id !== normalized)
            : [...selectedStatuses, normalized];
        onStatusesChange(next);
    };

    const clearAll = () => {
        onGoalFilterChange('');
        if (onTagsChange) onTagsChange([]);
        if (onStatusesChange) onStatusesChange([]);
    };

    const hasAnyFilter = goalFilter || selectedTags.length > 0 || selectedStatuses.length > 0;

    return (
        <div className="shared-filter-bar glass">
            <div className="shared-filter-row">
                <CascadingGoalFilter value={goalFilter} onChange={onGoalFilterChange} />

                {(activeTags.length > 0 || (statusOptions && statusOptions.length > 0)) && (
                    <button
                        className={`btn-secondary btn-sm shared-tag-toggle ${showAdvancedFilters ? 'active' : ''}`}
                        onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                        title="Advanced Filters"
                    >
                        <Filter size={14} /> Filters
                        {(selectedTags.length > 0 || selectedStatuses.length > 0) && (
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-primary)', display: 'inline-block', marginLeft: '0.25rem' }} />
                        )}
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

            {/* Advanced Filters Panel */}
            {showAdvancedFilters && (
                <div className="shared-advanced-filters">

                    {activeTags.length > 0 && (
                        <div className="shared-tag-panel" style={{ borderTop: 'none', paddingTop: 0, paddingBottom: statusOptions.length > 0 ? '1rem' : 0, borderBottom: statusOptions.length > 0 ? '1px solid var(--border-color)' : 'none', marginBottom: statusOptions.length > 0 ? '1rem' : 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}><Tag size={12} style={{ marginRight: 4, display: 'inline-flex', verticalAlign: 'middle', marginBottom: '2px' }} /> Tags</span>
                                {selectedTags.length > 0 && <button className="shared-clear-link" onClick={() => onTagsChange && onTagsChange([])}>Clear Tags</button>}
                            </div>

                            {activeTags.map(group => (
                                <div key={group.id} className="exec-tag-group" style={{ marginBottom: '0.5rem' }}>
                                    <span className="exec-tag-group-label" style={{ fontSize: '0.75rem', marginBottom: '0.25rem', display: 'block' }}>{group.name}</span>
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

                    {statusOptions.length > 0 && (
                        <div className="shared-tag-panel" style={{ borderTop: 'none', paddingTop: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}><Activity size={12} style={{ marginRight: 4, display: 'inline-flex', verticalAlign: 'middle', marginBottom: '2px' }} /> Statuses</span>
                                {selectedStatuses.length > 0 && <button className="shared-clear-link" onClick={() => onStatusesChange && onStatusesChange([])}>Clear Statuses</button>}
                            </div>
                            <div className="exec-tag-options">
                                {statusOptions.map(status => (
                                    <button
                                        key={status.id}
                                        className={`exec-tag-pill ${selectedStatuses.includes(String(status.id).toLowerCase()) ? 'selected' : ''}`}
                                        onClick={() => toggleStatus(status.id)}
                                        style={{ '--tag-color': status.color || '#6366f1' }}
                                    >
                                        <span className="exec-tag-dot" style={{ background: status.color || '#6366f1' }}></span>
                                        {status.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

import { useState, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { CascadingGoalFilter } from './CascadingGoalFilter';
import { Tag, Activity, X, Filter, Star } from 'lucide-react';
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
 *  - watchedOnly: boolean
 *  - onWatchedOnlyChange: (watchedOnly: boolean) => void
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
    watchedOnly = false,
    onWatchedOnlyChange = null,
    extraOptionGroups = [],
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

    const toggleExtraOption = (group, optionId) => {
        if (!group || typeof group.onChange !== 'function') return;
        const normalized = String(optionId).toLowerCase();
        const selected = Array.isArray(group.selectedValues)
            ? group.selectedValues.map((value) => String(value).toLowerCase())
            : [];
        const next = selected.includes(normalized)
            ? selected.filter((value) => value !== normalized)
            : [...selected, normalized];
        group.onChange(next);
    };

    const visibleExtraOptionGroups = Array.isArray(extraOptionGroups)
        ? extraOptionGroups.filter((group) => Array.isArray(group?.options) && group.options.length > 0)
        : [];

    const clearAll = () => {
        onGoalFilterChange('');
        if (onTagsChange) onTagsChange([]);
        if (onStatusesChange) onStatusesChange([]);
        if (onWatchedOnlyChange) onWatchedOnlyChange(false);
        if (Array.isArray(extraOptionGroups)) {
            extraOptionGroups.forEach((group) => {
                if (typeof group?.onChange === 'function') {
                    group.onChange([]);
                }
            });
        }
    };

    const extraSelectionCount = Array.isArray(extraOptionGroups)
        ? extraOptionGroups.reduce((total, group) => total + (Array.isArray(group?.selectedValues) ? group.selectedValues.length : 0), 0)
        : 0;
    const hasAnyFilter = goalFilter || selectedTags.length > 0 || selectedStatuses.length > 0 || watchedOnly || extraSelectionCount > 0;

    return (
        <div className="shared-filter-bar glass">
            <div className="shared-filter-row">
                <CascadingGoalFilter value={goalFilter} onChange={onGoalFilterChange} />

                {(activeTags.length > 0 || (statusOptions && statusOptions.length > 0) || visibleExtraOptionGroups.length > 0) && (
                    <button
                        className={`btn-secondary btn-sm shared-tag-toggle ${showAdvancedFilters ? 'active' : ''}`}
                        onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                        title="Advanced Filters"
                    >
                        <Filter size={14} /> Filters
                        {(selectedTags.length > 0 || selectedStatuses.length > 0 || extraSelectionCount > 0) && (
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-primary)', display: 'inline-block', marginLeft: '0.25rem' }} />
                        )}
                    </button>
                )}

                {onWatchedOnlyChange && (
                    <button
                        className={`btn-secondary btn-sm shared-watch-toggle ${watchedOnly ? 'active' : ''}`}
                        onClick={() => onWatchedOnlyChange(!watchedOnly)}
                        title="Show only projects in my watchlist"
                    >
                        <Star size={14} fill={watchedOnly ? 'currentColor' : 'none'} />
                        My Watchlist
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

                    {visibleExtraOptionGroups.map((group, groupIndex) => {
                        const options = group.options;
                        const selected = Array.isArray(group?.selectedValues)
                            ? group.selectedValues.map((value) => String(value).toLowerCase())
                            : [];
                        const GroupIcon = group?.icon || Activity;
                        const sectionStyle = {
                            borderTop: 'none',
                            paddingTop: 0,
                            borderBottom: 'none',
                            marginBottom: 0
                        };
                        const hasPriorSection = activeTags.length > 0 || statusOptions.length > 0;
                        if (groupIndex === 0 && hasPriorSection) {
                            sectionStyle.paddingTop = '1rem';
                            sectionStyle.borderTop = '1px solid var(--border-color)';
                            sectionStyle.marginTop = '1rem';
                        }
                        if (groupIndex < visibleExtraOptionGroups.length - 1) {
                            sectionStyle.paddingBottom = '1rem';
                            sectionStyle.borderBottom = '1px solid var(--border-color)';
                            sectionStyle.marginBottom = '1rem';
                        }

                        return (
                            <div key={group?.key || group?.label || `extra-group-${groupIndex}`} className="shared-tag-panel" style={sectionStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                        <GroupIcon size={12} style={{ marginRight: 4, display: 'inline-flex', verticalAlign: 'middle', marginBottom: '2px' }} />
                                        {group?.label || 'Filter'}
                                    </span>
                                    {selected.length > 0 && (
                                        <button className="shared-clear-link" onClick={() => group.onChange && group.onChange([])}>
                                            {group?.clearLabel || `Clear ${group?.label || 'Filter'}`}
                                        </button>
                                    )}
                                </div>
                                <div className="exec-tag-options">
                                    {options.map((option) => {
                                        const optionId = String(option.id).toLowerCase();
                                        const isSelected = selected.includes(optionId);
                                        return (
                                            <button
                                                key={option.id}
                                                className={`exec-tag-pill ${isSelected ? 'selected' : ''}`}
                                                onClick={() => toggleExtraOption(group, option.id)}
                                                style={{ '--tag-color': option.color || '#6366f1' }}
                                            >
                                                <span className="exec-tag-dot" style={{ background: option.color || '#6366f1' }}></span>
                                                {option.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { Tag, Star, Search, X, Check, AlertTriangle } from 'lucide-react';
import './ProjectTagSelector.css';

/**
 * ProjectTagSelector — Faceted multi-select for assigning tags to a project.
 *
 * Props:
 *   projectId: string — the project to tag
 *   currentTags: array — existing tag assignments [{ tagId, isPrimary, ... }]
 *   onSave: (tags) => void — callback after save (optional override)
 *   onChange: (tags) => void — callback when selection changes (for parent-managed save)
 *   showSaveButton: boolean — show internal Save Tags button (default true)
 *   compact: boolean — compact mode for inline display
 */
export function ProjectTagSelector({
    projectId,
    currentTags = [],
    onSave,
    onChange,
    showSaveButton = true,
    compact = false
}) {
    const { tagGroups, updateProjectTags } = useData();
    const { success, error: showError } = useToast();

    // Local tag selection state: { [tagId]: { selected: bool, isPrimary: bool } }
    const toSelectionMap = useCallback((tags) => {
        const map = {};
        tags.forEach(t => {
            const id = String(t.tagId ?? t.id);
            map[id] = { selected: true, isPrimary: !!t.isPrimary };
        });
        return map;
    }, []);
    const [selections, setSelections] = useState(() => toSelectionMap(currentTags));
    const [searchQuery, setSearchQuery] = useState('');
    const [saving, setSaving] = useState(false);
    const [isOpen, setIsOpen] = useState(!compact);

    useEffect(() => {
        setSelections(toSelectionMap(currentTags));
    }, [currentTags, toSelectionMap]);

    const selectedCount = useMemo(() =>
        Object.values(selections).filter(s => s.selected).length
        , [selections]);

    const allTags = useMemo(() => tagGroups.flatMap(g => g.tags), [tagGroups]);

    const buildTagsFromSelections = useCallback((selectionState) => (
        Object.entries(selectionState)
            .filter(([, s]) => s.selected)
            .map(([tagId, s]) => ({ tagId, isPrimary: !!s.isPrimary }))
    ), []);

    // Filter tags by search (including aliases)
    const filterTag = useCallback((tag) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
            tag.name.toLowerCase().includes(q) ||
            tag.slug.toLowerCase().includes(q) ||
            (tag.aliases || []).some(a => a.alias.toLowerCase().includes(q))
        );
    }, [searchQuery]);

    const toggleTag = (tagId, groupId) => {
        const tagKey = String(tagId);
        const current = selections[tagKey];
        if (!current?.selected) {
            const currentSelectedCount = Object.values(selections).filter((s) => s.selected).length;
            if (currentSelectedCount >= 8) {
                showError('Maximum 8 tags per project');
                return;
            }
        }

        setSelections(prev => {
            if (prev[tagKey]?.selected) {
                // Deselect
                const updated = { ...prev };
                delete updated[tagKey];
                return updated;
            } else {
                // Select
                const group = tagGroups.find(g => String(g.id) === String(groupId));
                const isPrimary = group?.requirePrimary && !Object.entries(prev).some(([tid, s]) => {
                    const tag = allTags.find(t => String(t.id) === String(tid));
                    return s.selected && String(tag?.groupId) === String(groupId);
                });
                return { ...prev, [tagKey]: { selected: true, isPrimary } };
            }
        });
    };

    const setPrimaryTag = (tagId, groupId) => {
        const tagKey = String(tagId);
        setSelections(prev => {
            const updated = { ...prev };
            // Remove primary from all other tags in this group
            Object.entries(updated).forEach(([tid, s]) => {
                const tag = allTags.find(t => String(t.id) === String(tid));
                if (String(tag?.groupId) === String(groupId) && s.selected) {
                    updated[tid] = { ...s, isPrimary: tid === tagKey };
                }
            });
            return updated;
        });
    };

    const handleSave = async () => {
        const tags = buildTagsFromSelections(selections);

        if (tags.length > 8) {
            return showError('Maximum 8 tags per project');
        }

        setSaving(true);
        try {
            if (onSave) {
                await onSave(tags);
            } else {
                await updateProjectTags(projectId, tags);
            }
            success('Tags updated');
            if (compact) setIsOpen(false);
        } catch (err) {
            showError(err.message);
        } finally {
            setSaving(false);
        }
    };

    useEffect(() => {
        if (!showSaveButton && onChange) {
            onChange(buildTagsFromSelections(selections));
        }
    }, [selections, showSaveButton, onChange, buildTagsFromSelections]);

    // Get selected tags for compact badge display
    const selectedTags = useMemo(() => {
        return Object.entries(selections)
            .filter(([, s]) => s.selected)
            .map(([tagId, s]) => {
                const tag = allTags.find(t => String(t.id) === String(tagId));
                return tag ? { ...tag, isPrimary: s.isPrimary } : null;
            })
            .filter(Boolean);
    }, [selections, allTags]);

    if (compact && !isOpen) {
        return (
            <div className="project-tags-compact" onClick={() => setIsOpen(true)}>
                {selectedTags.length > 0 ? (
                    <div className="tag-badges">
                        {selectedTags.map(tag => (
                            <span
                                key={tag.id}
                                className="tag-badge"
                                style={{ background: `${tag.color}20`, color: tag.color, borderColor: `${tag.color}40` }}
                            >
                                {tag.isPrimary && <Star size={10} />}
                                {tag.name}
                            </span>
                        ))}
                    </div>
                ) : (
                    <span className="tag-placeholder"><Tag size={14} /> Add tags...</span>
                )}
            </div>
        );
    }

    return (
        <div className="project-tag-selector">
            <div className="tag-selector-header">
                <div className="tag-selector-search">
                    <Search size={14} />
                    <input
                        type="text"
                        placeholder="Search tags..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>
                <span className={`tag-count-indicator ${selectedCount > 8 ? 'over-limit' : ''}`}>
                    {selectedCount}/8
                </span>
            </div>

            <div className="tag-selector-groups">
                {tagGroups.map(group => {
                    const visibleTags = group.tags.filter(t => t.status !== 'deprecated' || selections[t.id]?.selected).filter(filterTag);
                    if (visibleTags.length === 0) return null;

                    return (
                        <div key={group.id} className="tag-selector-group">
                            <div className="tag-selector-group-label">
                                {group.name}
                            </div>
                            <div className="tag-selector-options">
                                {visibleTags.map(tag => {
                                    const isSelected = selections[tag.id]?.selected;
                                    const isPrimary = selections[tag.id]?.isPrimary;
                                    const isDeprecated = tag.status === 'deprecated';

                                    return (
                                        <div
                                            key={tag.id}
                                            className={`tag-option ${isSelected ? 'selected' : ''} ${isDeprecated ? 'deprecated' : ''}`}
                                            onClick={() => !isDeprecated && toggleTag(tag.id, group.id)}
                                        >
                                            <span className="tag-option-color" style={{ background: tag.color }} />
                                            <span className="tag-option-name">{tag.name}</span>
                                            {isSelected && (
                                                <Check size={14} className="tag-check" />
                                            )}
                                            {isSelected && group.requirePrimary && (
                                                <button
                                                    className={`primary-toggle ${isPrimary ? 'active' : ''}`}
                                                    onClick={e => { e.stopPropagation(); setPrimaryTag(tag.id, group.id); }}
                                                    title={isPrimary ? 'Primary tag' : 'Set as primary'}
                                                >
                                                    <Star size={12} />
                                                </button>
                                            )}
                                            {isDeprecated && (
                                                <AlertTriangle size={12} className="deprecated-icon" />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="tag-selector-footer">
                <div className="tag-badges-preview">
                    {selectedTags.slice(0, 5).map(tag => (
                        <span
                            key={tag.id}
                            className="tag-badge-mini"
                            style={{ background: `${tag.color}20`, color: tag.color }}
                        >
                            {tag.name}
                            <X size={10} onClick={() => toggleTag(tag.id, tag.groupId)} className="tag-remove" />
                        </span>
                    ))}
                    {selectedTags.length > 5 && <span className="tag-more">+{selectedTags.length - 5} more</span>}
                </div>
                {showSaveButton ? (
                    <div className="tag-selector-actions">
                        {compact && (
                            <button className="btn-ghost btn-sm" onClick={() => setIsOpen(false)}>Cancel</button>
                        )}
                        <button className="btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                            {saving ? 'Saving...' : 'Save Tags'}
                        </button>
                    </div>
                ) : (
                    <div className="tag-save-hint">Saved with project changes</div>
                )}
            </div>
        </div>
    );
}

/**
 * ProjectTagBadges — Display-only tag badges for a project.
 */
export function ProjectTagBadges({ tags = [], maxDisplay = 4 }) {
    if (!tags || tags.length === 0) return null;

    const shown = tags.slice(0, maxDisplay);
    const remaining = tags.length - maxDisplay;

    return (
        <div className="tag-badges">
            {shown.map(tag => (
                <span
                    key={tag.tagId || tag.id}
                    className="tag-badge"
                    style={{
                        background: `${tag.color}15`,
                        color: tag.color,
                        borderColor: `${tag.color}30`
                    }}
                >
                    {tag.isPrimary && <Star size={9} />}
                    {tag.name}
                </span>
            ))}
            {remaining > 0 && <span className="tag-badge tag-more-badge">+{remaining}</span>}
        </div>
    );
}

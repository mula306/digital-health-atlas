import { useState, useMemo, useCallback } from 'react';
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
 *   compact: boolean — compact mode for inline display
 */
export function ProjectTagSelector({ projectId, currentTags = [], onSave, compact = false }) {
    const { tagGroups, updateProjectTags } = useData();
    const { success, error: showError } = useToast();

    // Local tag selection state: { [tagId]: { selected: bool, isPrimary: bool } }
    const [selections, setSelections] = useState(() => {
        const map = {};
        currentTags.forEach(t => {
            map[t.tagId] = { selected: true, isPrimary: !!t.isPrimary };
        });
        return map;
    });
    const [searchQuery, setSearchQuery] = useState('');
    const [saving, setSaving] = useState(false);
    const [isOpen, setIsOpen] = useState(!compact);

    const selectedCount = useMemo(() =>
        Object.values(selections).filter(s => s.selected).length
        , [selections]);

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
        setSelections(prev => {
            const current = prev[tagId];
            if (current?.selected) {
                // Deselect
                const updated = { ...prev };
                delete updated[tagId];
                return updated;
            } else {
                // Select
                const group = tagGroups.find(g => g.id === groupId);
                const isPrimary = group?.requirePrimary && !Object.entries(prev).some(([tid, s]) => {
                    const tag = tagGroups.flatMap(g => g.tags).find(t => t.id === tid);
                    return s.selected && tag?.groupId === groupId;
                });
                return { ...prev, [tagId]: { selected: true, isPrimary } };
            }
        });
    };

    const setPrimaryTag = (tagId, groupId) => {
        setSelections(prev => {
            const updated = { ...prev };
            // Remove primary from all other tags in this group
            Object.entries(updated).forEach(([tid, s]) => {
                const tag = tagGroups.flatMap(g => g.tags).find(t => t.id === tid);
                if (tag?.groupId === groupId && s.selected) {
                    updated[tid] = { ...s, isPrimary: tid === tagId };
                }
            });
            return updated;
        });
    };

    const handleSave = async () => {
        const tags = Object.entries(selections)
            .filter(([, s]) => s.selected)
            .map(([tagId, s]) => ({ tagId, isPrimary: !!s.isPrimary }));

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

    // Get selected tags for compact badge display
    const selectedTags = useMemo(() => {
        const allTags = tagGroups.flatMap(g => g.tags);
        return Object.entries(selections)
            .filter(([, s]) => s.selected)
            .map(([tagId, s]) => {
                const tag = allTags.find(t => t.id === tagId);
                return tag ? { ...tag, isPrimary: s.isPrimary } : null;
            })
            .filter(Boolean);
    }, [selections, tagGroups]);

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
                                {group.requirePrimary && <Star size={10} className="primary-indicator" />}
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
                <div className="tag-selector-actions">
                    {compact && (
                        <button className="btn-ghost btn-sm" onClick={() => setIsOpen(false)}>Cancel</button>
                    )}
                    <button className="btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving...' : 'Save Tags'}
                    </button>
                </div>
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

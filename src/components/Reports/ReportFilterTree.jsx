import React, { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Folder, CheckSquare, Square, Tag, Activity, X } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { getDescendantGoalIds } from '../../utils/goalHelpers';
import '../UI/ProjectTagSelector.css';

export function ReportFilterTree({ onSelectionChange, allProjects = [] }) {
    const { goals, projects, tagGroups } = useData();
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [expandedIds, setExpandedIds] = useState(new Set());
    const [selectedTags, setSelectedTags] = useState([]);
    const [selectedStatuses, setSelectedStatuses] = useState([]);
    const [showTagFilter, setShowTagFilter] = useState(false);
    const [showStatusFilter, setShowStatusFilter] = useState(false);

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
        setSelectedTags(prev =>
            prev.includes(tagId)
                ? prev.filter(id => id !== tagId)
                : [...prev, tagId]
        );
    };

    const toggleStatus = (statusId) => {
        const normalized = String(statusId).toLowerCase();
        setSelectedStatuses(prev =>
            prev.includes(normalized)
                ? prev.filter(id => id !== normalized)
                : [...prev, normalized]
        );
    };

    const statusOptions = useMemo(() => {
        const source = allProjects.length > 0 ? allProjects : projects;
        const seen = new Set();

        source.forEach(p => {
            const statusValue = p.report?.overallStatus || p.latestReport?.overallStatus || 'unknown';
            seen.add(String(statusValue).toLowerCase());
        });

        const preferredOrder = ['red', 'yellow', 'green', 'unknown'];
        const labelFor = (status) => (status === 'unknown' ? 'No Report' : status.charAt(0).toUpperCase() + status.slice(1));
        const colorFor = (status) => {
            if (status === 'red') return '#ef4444';
            if (status === 'yellow') return '#f59e0b';
            if (status === 'green') return '#10b981';
            return '#9ca3af';
        };

        const options = [...seen].map(status => ({
            id: status,
            label: labelFor(status),
            color: colorFor(status)
        }));

        options.sort((a, b) => {
            const ai = preferredOrder.indexOf(a.id);
            const bi = preferredOrder.indexOf(b.id);
            if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
        });

        return options;
    }, [allProjects, projects]);

    // Filter projects by selected tags + statuses
    const filteredProjects = useMemo(() => {
        // Use allProjects if loaded, otherwise fallback to context projects
        const source = allProjects.length > 0 ? allProjects : projects;

        let filtered = source;

        if (selectedTags.length > 0) {
            filtered = filtered.filter(p => {
                if (!p.tags || p.tags.length === 0) return false;
                const projectTagIds = p.tags.map(t => String(t.tagId));
                return selectedTags.every(tagId => projectTagIds.includes(String(tagId)));
            });
        }

        if (selectedStatuses.length > 0) {
            filtered = filtered.filter(p => {
                const statusValue = p.report?.overallStatus || p.latestReport?.overallStatus || 'unknown';
                return selectedStatuses.includes(String(statusValue).toLowerCase());
            });
        }

        return filtered;
    }, [projects, allProjects, selectedTags, selectedStatuses]);

    const treeData = useMemo(() => {
        // Build hierarchy tree using filtered projects
        const buildTree = (parentId) => {
            return goals
                .filter(g => g.parentId === parentId)
                .map(goal => ({
                    ...goal,
                    children: buildTree(goal.id),
                    projects: filteredProjects.filter(p => p.goalId === goal.id)
                }));
        };

        // Helper: check if a tree node has any projects (direct or nested)
        const hasProjects = (node) => {
            if (node.projects.length > 0) return true;
            return node.children.some(child => hasProjects(child));
        };

        const raw = buildTree(null);
        // When filters are active, hide empty branches
        if (selectedTags.length > 0 || selectedStatuses.length > 0) {
            const prune = (nodes) => nodes
                .filter(n => hasProjects(n))
                .map(n => ({ ...n, children: prune(n.children) }));
            return prune(raw);
        }
        return raw;
    }, [goals, filteredProjects, selectedTags, selectedStatuses]);

    // Toggle expansion
    const toggleExpand = (id) => {
        const newExpanded = new Set(expandedIds);
        if (newExpanded.has(id)) newExpanded.delete(id);
        else newExpanded.add(id);
        setExpandedIds(newExpanded);
    };

    // Recursive selection
    const toggleSelection = (item, isSelected) => {
        const newSelected = new Set(selectedIds);

        const toggleRecursive = (node, select) => {
            const goalNodeId = `goal-${node.id}`;
            if (select) {
                newSelected.add(goalNodeId); // Goal ID
                node.projects.forEach(p => newSelected.add(`project-${p.id}`)); // Project IDs
            } else {
                newSelected.delete(goalNodeId);
                node.projects.forEach(p => newSelected.delete(`project-${p.id}`));
            }
            node.children.forEach(child => toggleRecursive(child, select));
        };

        toggleRecursive(item, isSelected);
        setSelectedIds(newSelected);
        onSelectionChange(Array.from(newSelected));
    };

    // Toggle individual project
    const toggleProject = (projectId, isSelected) => {
        const projectNodeId = `project-${projectId}`;
        const newSelected = new Set(selectedIds);
        if (isSelected) newSelected.add(projectNodeId);
        else newSelected.delete(projectNodeId);
        setSelectedIds(newSelected);
        onSelectionChange(Array.from(newSelected));
    };

    const TreeNode = ({ node, level = 0 }) => {
        const goalNodeId = `goal-${node.id}`;
        const isExpanded = expandedIds.has(goalNodeId);
        const isSelected = selectedIds.has(goalNodeId);

        // Calculate available reports (Own + Descendants)
        const descendantIds = getDescendantGoalIds(goals, node.id);
        const allRelatedGoalIds = [node.id, ...descendantIds];
        const linkedProjects = filteredProjects.filter(p => allRelatedGoalIds.includes(p.goalId));
        const availableReports = linkedProjects.reduce((sum, p) => sum + (p.reportCount || 0), 0);

        return (
            <div className="tree-node" style={{ marginLeft: `${level * 12}px` }}>
                <div className="tree-item-content">
                    {node.children.length > 0 ? (
                        <button
                            className="btn-icon-sm"
                            onClick={(e) => { e.stopPropagation(); toggleExpand(goalNodeId); }}
                            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
                        >
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                    ) : <span style={{ width: 14 }} />}

                    <div
                        onClick={() => toggleSelection(node, !isSelected)}
                        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}
                    >
                        {isSelected ? <CheckSquare size={16} className="text-primary" /> : <Square size={16} />}
                        <Folder size={16} className="text-secondary" />
                        <span className="tree-label">{node.title}</span>
                        {availableReports > 0 && (
                            <span className="tree-count" title={`${availableReports} projects with reports available in this hierarchy`}>
                                {availableReports} Reports
                            </span>
                        )}
                    </div>
                </div>

                {isExpanded && (
                    <div className="tree-children-nodes">
                        {/* Projects */}
                        {node.projects.map(p => {
                            const reportCount = p.reportCount || 0;
                            return (
                                <div key={p.id} className="tree-item-content" style={{ marginLeft: '24px' }}>
                                    <div
                                        onClick={() => toggleProject(p.id, !selectedIds.has(`project-${p.id}`))}
                                        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}
                                    >
                                        {selectedIds.has(`project-${p.id}`) ? <CheckSquare size={16} className="text-primary" /> : <Square size={16} />}
                                        <span className="tree-label" style={{ fontSize: '0.85rem' }}>{p.title}</span>
                                        {reportCount > 0 && (
                                            <span className="tree-count" style={{ fontSize: '0.7em', background: '#ecfdf5', color: '#059669' }}>
                                                {reportCount}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {/* Sub-goals */}
                        {node.children.map(child => (
                            <TreeNode key={child.id} node={child} level={level + 1} />
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="report-filter-tree">
            {/* Tag filter toggle */}
            <div className="report-tag-filter-header">
                <button
                    className={`btn-secondary btn-sm report-tag-toggle ${showTagFilter ? 'active' : ''} ${selectedTags.length > 0 ? 'has-selection' : ''}`}
                    onClick={() => setShowTagFilter(!showTagFilter)}
                >
                    <Tag size={14} />
                    Filter by Tags
                    {selectedTags.length > 0 && <span className="report-tag-count">{selectedTags.length}</span>}
                </button>
                {statusOptions.length > 0 && (
                    <button
                        className={`btn-secondary btn-sm report-tag-toggle ${showStatusFilter ? 'active' : ''} ${selectedStatuses.length > 0 ? 'has-selection' : ''}`}
                        onClick={() => setShowStatusFilter(!showStatusFilter)}
                    >
                        <Activity size={14} />
                        Filter by Status
                        {selectedStatuses.length > 0 && <span className="report-tag-count">{selectedStatuses.length}</span>}
                    </button>
                )}
                {selectedTags.length > 0 && (
                    <button
                        className="btn-secondary btn-sm report-clear-tags"
                        onClick={() => setSelectedTags([])}
                    >
                        <X size={12} /> Clear
                    </button>
                )}
                {selectedStatuses.length > 0 && (
                    <button
                        className="btn-secondary btn-sm report-clear-tags"
                        onClick={() => setSelectedStatuses([])}
                    >
                        <X size={12} /> Clear
                    </button>
                )}
            </div>

            {showTagFilter && activeTags.length > 0 && (
                <div className="report-tag-panel">
                    {activeTags.map(group => (
                        <div key={group.id} className="report-tag-group">
                            <span className="report-tag-group-label">{group.name}</span>
                            <div className="report-tag-options">
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

            {showStatusFilter && statusOptions.length > 0 && (
                <div className="report-tag-panel">
                    <div className="report-tag-group">
                        <span className="report-tag-group-label">Status</span>
                        <div className="report-tag-options">
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
                </div>
            )}

            {treeData.map(node => (
                <TreeNode key={node.id} node={node} />
            ))}
        </div>
    );
}

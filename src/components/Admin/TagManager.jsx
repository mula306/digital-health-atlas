import React, { useState, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import {
    Plus, ChevronDown, ChevronRight, Edit2, Trash2, Save, X,
    Tag, Layers, Star, AlertTriangle, Search
} from 'lucide-react';
import { Modal } from '../UI/Modal'; // Import Modal
import './TagManager.css';

export function TagManager() {
    const {
        tagGroups, addTagGroup, updateTagGroup, deleteTagGroup,
        addTag, updateTag, deleteTag
    } = useData();
    const { success, error: showError } = useToast();

    const [expandedGroups, setExpandedGroups] = useState({});
    const [editingGroup, setEditingGroup] = useState(null); // group id or 'new'
    const [editingTag, setEditingTag] = useState(null); // tag id or 'new-<groupId>'
    const [searchQuery, setSearchQuery] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState(null); // { type: 'group'|'tag', id, name }

    // Group form state
    const [groupForm, setGroupForm] = useState({ name: '', slug: '', requirePrimary: false });
    // Tag form state
    const [tagForm, setTagForm] = useState({ name: '', slug: '', status: 'active', color: '#6366f1', aliases: '' });

    const toggleGroup = (groupId) => {
        setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
    };

    // Filtered groups/tags based on search
    const filteredGroups = useMemo(() => {
        if (!searchQuery.trim()) return tagGroups;
        const q = searchQuery.toLowerCase();
        return tagGroups.map(g => ({
            ...g,
            tags: g.tags.filter(t =>
                t.name.toLowerCase().includes(q) ||
                t.slug.toLowerCase().includes(q) ||
                (t.aliases || []).some(a => a.alias.toLowerCase().includes(q))
            )
        })).filter(g => g.tags.length > 0 || g.name.toLowerCase().includes(q));
    }, [tagGroups, searchQuery]);

    // Auto-generate slug from name
    const generateSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // ==================== GROUP CRUD ====================

    const startAddGroup = () => {
        setEditingGroup('new');
        setGroupForm({ name: '', slug: '', requirePrimary: false });
    };

    const startEditGroup = (group) => {
        setEditingGroup(group.id);
        setGroupForm({ name: group.name, slug: group.slug, requirePrimary: group.requirePrimary });
    };

    const cancelGroupEdit = () => {
        setEditingGroup(null);
        setGroupForm({ name: '', slug: '', requirePrimary: false });
    };

    const saveGroup = async () => {
        try {
            if (!groupForm.name.trim()) return showError('Group name is required');
            const slug = groupForm.slug.trim() || generateSlug(groupForm.name);

            if (editingGroup === 'new') {
                await addTagGroup({ ...groupForm, slug, sortOrder: tagGroups.length + 1 });
                success('Tag group created');
            } else {
                await updateTagGroup(editingGroup, { ...groupForm, slug });
                success('Tag group updated');
            }
            cancelGroupEdit();
        } catch (err) {
            showError(err.message);
        }
    };

    const handleDeleteGroup = (groupId, groupName) => {
        setDeleteConfirm({ type: 'group', id: groupId, name: groupName });
    };

    // ==================== TAG CRUD ====================

    const startAddTag = (groupId) => {
        setEditingTag(`new-${groupId}`);
        setTagForm({ name: '', slug: '', status: 'active', color: '#6366f1', aliases: '' });
        // Expand the group
        setExpandedGroups(prev => ({ ...prev, [groupId]: true }));
    };

    const startEditTag = (tag) => {
        setEditingTag(tag.id);
        setTagForm({
            name: tag.name,
            slug: tag.slug,
            status: tag.status,
            color: tag.color,
            aliases: (tag.aliases || []).map(a => a.alias).join(', ')
        });
    };

    const cancelTagEdit = () => {
        setEditingTag(null);
        setTagForm({ name: '', slug: '', status: 'active', color: '#6366f1', aliases: '' });
    };

    const saveTag = async () => {
        try {
            if (!tagForm.name.trim()) return showError('Tag name is required');
            const slug = tagForm.slug.trim() || generateSlug(tagForm.name);
            const aliases = tagForm.aliases.split(',').map(a => a.trim()).filter(Boolean);

            if (editingTag.startsWith('new-')) {
                const groupId = editingTag.replace('new-', '');
                await addTag({ ...tagForm, slug, groupId, aliases });
                success('Tag created');
            } else {
                await updateTag(editingTag, { ...tagForm, slug, aliases });
                success('Tag updated');
            }
            cancelTagEdit();
        } catch (err) {
            showError(err.message);
        }
    };

    const handleDeleteTag = (tagId, tagName) => {
        setDeleteConfirm({ type: 'tag', id: tagId, name: tagName });
    };

    const confirmDelete = async () => {
        if (!deleteConfirm) return;
        try {
            if (deleteConfirm.type === 'group') {
                await deleteTagGroup(deleteConfirm.id);
                success('Tag group deleted');
            } else {
                await deleteTag(deleteConfirm.id);
                success('Tag deleted');
            }
        } catch (err) {
            showError(err.message);
        } finally {
            setDeleteConfirm(null);
        }
    };

    const handleStatusChange = async (tagId, newStatus) => {
        try {
            await updateTag(tagId, { status: newStatus });
            success(`Tag status changed to ${newStatus}`);
        } catch (err) {
            showError(err.message);
        }
    };

    // ==================== RENDER ====================

    const statusBadge = (status) => {
        const colors = { draft: '#6b7280', active: '#10b981', deprecated: '#f59e0b' };
        return (
            <span className="tag-status-badge" style={{ background: `${colors[status]}20`, color: colors[status] }}>
                {status}
            </span>
        );
    };

    return (
        <div className="tag-manager">
            <div className="tag-manager-header">
                <div className="tag-manager-search">
                    <Search size={16} />
                    <input
                        type="text"
                        placeholder="Search tags, aliases..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>
                <button className="btn-primary btn-sm" onClick={startAddGroup}>
                    <Plus size={16} /> Add Group
                </button>
            </div>

            {/* New Group Form */}
            {editingGroup === 'new' && (
                <div className="tag-form-card">
                    <h4><Layers size={16} /> New Tag Group</h4>
                    <div className="tag-form-fields">
                        <input
                            type="text"
                            placeholder="Group name (e.g. Domain / Program)"
                            value={groupForm.name}
                            onChange={e => setGroupForm(prev => ({ ...prev, name: e.target.value, slug: generateSlug(e.target.value) }))}
                            autoFocus
                        />
                        <input
                            type="text"
                            placeholder="Slug (auto-generated)"
                            value={groupForm.slug}
                            onChange={e => setGroupForm(prev => ({ ...prev, slug: e.target.value }))}
                        />
                        <label className="tag-form-checkbox">
                            <input
                                type="checkbox"
                                checked={groupForm.requirePrimary}
                                onChange={e => setGroupForm(prev => ({ ...prev, requirePrimary: e.target.checked }))}
                            />
                            <Star size={14} /> Require primary tag
                        </label>
                    </div>
                    <div className="tag-form-actions">
                        <button className="btn-primary btn-sm" onClick={saveGroup}><Save size={14} /> Save</button>
                        <button className="btn-ghost btn-sm" onClick={cancelGroupEdit}><X size={14} /> Cancel</button>
                    </div>
                </div>
            )}

            {/* Tag Groups */}
            <div className="tag-groups-list">
                {filteredGroups.map(group => (
                    <div key={group.id} className="tag-group-card">
                        {/* Group Header */}
                        {editingGroup === group.id ? (
                            <div className="tag-form-card inline">
                                <div className="tag-form-fields">
                                    <input
                                        type="text"
                                        value={groupForm.name}
                                        onChange={e => setGroupForm(prev => ({ ...prev, name: e.target.value }))}
                                        autoFocus
                                    />
                                    <input
                                        type="text"
                                        value={groupForm.slug}
                                        onChange={e => setGroupForm(prev => ({ ...prev, slug: e.target.value }))}
                                    />
                                    <label className="tag-form-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={groupForm.requirePrimary}
                                            onChange={e => setGroupForm(prev => ({ ...prev, requirePrimary: e.target.checked }))}
                                        />
                                        <Star size={14} /> Require primary
                                    </label>
                                </div>
                                <div className="tag-form-actions">
                                    <button className="btn-primary btn-sm" onClick={saveGroup}><Save size={14} /></button>
                                    <button className="btn-ghost btn-sm" onClick={cancelGroupEdit}><X size={14} /></button>
                                </div>
                            </div>
                        ) : (
                            <div className="tag-group-header" onClick={() => toggleGroup(group.id)}>
                                <div className="tag-group-title">
                                    {expandedGroups[group.id] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                    <Layers size={16} />
                                    <span className="tag-group-name">{group.name}</span>
                                    <span className="tag-count">{group.tags.length} tags</span>
                                </div>
                                <div className="tag-group-actions" onClick={e => e.stopPropagation()}>
                                    <button className="btn-icon" onClick={() => startAddTag(group.id)} title="Add tag">
                                        <Plus size={16} />
                                    </button>
                                    <button className="btn-icon" onClick={() => startEditGroup(group)} title="Edit group">
                                        <Edit2 size={16} />
                                    </button>
                                    <button className="btn-icon danger" onClick={() => handleDeleteGroup(group.id, group.name)} title="Delete group">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Expanded Tags */}
                        {expandedGroups[group.id] && (
                            <div className="tag-list">
                                {/* New Tag Form (if adding to this group) */}
                                {editingTag === `new-${group.id}` && (
                                    <div className="tag-form-card inline">
                                        <div className="tag-form-fields">
                                            <div className="tag-form-row">
                                                <input
                                                    type="color"
                                                    value={tagForm.color}
                                                    onChange={e => setTagForm(prev => ({ ...prev, color: e.target.value }))}
                                                    className="color-picker"
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Tag name"
                                                    value={tagForm.name}
                                                    onChange={e => setTagForm(prev => ({ ...prev, name: e.target.value, slug: generateSlug(e.target.value) }))}
                                                    autoFocus
                                                />
                                            </div>
                                            <input
                                                type="text"
                                                placeholder="Aliases (comma-separated, e.g. VCF9, Telehealth)"
                                                value={tagForm.aliases}
                                                onChange={e => setTagForm(prev => ({ ...prev, aliases: e.target.value }))}
                                            />
                                            <select
                                                value={tagForm.status}
                                                onChange={e => setTagForm(prev => ({ ...prev, status: e.target.value }))}
                                            >
                                                <option value="draft">Draft</option>
                                                <option value="active">Active</option>
                                                <option value="deprecated">Deprecated</option>
                                            </select>
                                        </div>
                                        <div className="tag-form-actions">
                                            <button className="btn-primary btn-sm" onClick={saveTag}><Save size={14} /></button>
                                            <button className="btn-ghost btn-sm" onClick={cancelTagEdit}><X size={14} /></button>
                                        </div>
                                    </div>
                                )}

                                {group.tags.length === 0 && editingTag !== `new-${group.id}` && (
                                    <div className="empty-tags">No tags yet. Click + to add one.</div>
                                )}

                                {group.tags.map(tag => (
                                    <div key={tag.id} className={`tag-item ${tag.status === 'deprecated' ? 'deprecated' : ''}`}>
                                        {editingTag === tag.id ? (
                                            <div className="tag-form-card inline">
                                                <div className="tag-form-fields">
                                                    <div className="tag-form-row">
                                                        <input
                                                            type="color"
                                                            value={tagForm.color}
                                                            onChange={e => setTagForm(prev => ({ ...prev, color: e.target.value }))}
                                                            className="color-picker"
                                                        />
                                                        <input
                                                            type="text"
                                                            value={tagForm.name}
                                                            onChange={e => setTagForm(prev => ({ ...prev, name: e.target.value }))}
                                                            autoFocus
                                                        />
                                                    </div>
                                                    <input
                                                        type="text"
                                                        placeholder="Aliases (comma-separated)"
                                                        value={tagForm.aliases}
                                                        onChange={e => setTagForm(prev => ({ ...prev, aliases: e.target.value }))}
                                                    />
                                                    <select
                                                        value={tagForm.status}
                                                        onChange={e => setTagForm(prev => ({ ...prev, status: e.target.value }))}
                                                    >
                                                        <option value="draft">Draft</option>
                                                        <option value="active">Active</option>
                                                        <option value="deprecated">Deprecated</option>
                                                    </select>
                                                </div>
                                                <div className="tag-form-actions">
                                                    <button className="btn-primary btn-sm" onClick={saveTag}><Save size={14} /></button>
                                                    <button className="btn-ghost btn-sm" onClick={cancelTagEdit}><X size={14} /></button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="tag-item-content">
                                                <div className="tag-item-left">
                                                    <span className="tag-color-dot" style={{ background: tag.color }}></span>
                                                    <span className="tag-name">{tag.name}</span>
                                                    {statusBadge(tag.status)}
                                                    {tag.aliases && tag.aliases.length > 0 && (
                                                        <span className="tag-aliases">
                                                            aka: {tag.aliases.map(a => a.alias).join(', ')}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="tag-item-actions">
                                                    {tag.status === 'active' && (
                                                        <button
                                                            className="btn-icon warning"
                                                            onClick={() => handleStatusChange(tag.id, 'deprecated')}
                                                            title="Deprecate"
                                                        >
                                                            <AlertTriangle size={14} />
                                                        </button>
                                                    )}
                                                    {tag.status === 'deprecated' && (
                                                        <button
                                                            className="btn-icon"
                                                            onClick={() => handleStatusChange(tag.id, 'active')}
                                                            title="Reactivate"
                                                        >
                                                            <Tag size={14} />
                                                        </button>
                                                    )}
                                                    <button className="btn-icon" onClick={() => startEditTag(tag)} title="Edit">
                                                        <Edit2 size={14} />
                                                    </button>
                                                    <button className="btn-icon danger" onClick={() => handleDeleteTag(tag.id, tag.name)} title="Delete">
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {tagGroups.length === 0 && (
                <div className="empty-state">
                    <Tag size={40} />
                    <h3>No Tag Groups</h3>
                    <p>Create your first tag group to start organizing projects with faceted metadata.</p>
                    <button className="btn-primary" onClick={startAddGroup}>
                        <Plus size={16} /> Create First Group
                    </button>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            <Modal
                isOpen={!!deleteConfirm}
                onClose={() => setDeleteConfirm(null)}
                title={`Delete ${deleteConfirm?.type === 'group' ? 'Tag Group' : 'Tag'}`}
                size="sm"
            >
                <div className="delete-modal-content">
                    <p>
                        Are you sure you want to delete <strong>{deleteConfirm?.name}</strong>?
                        {deleteConfirm?.type === 'group' && (
                            <span className="warning-text">
                                <br /><br />
                                <AlertTriangle size={16} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }} />
                                This will delete the group and <strong>ALL tags</strong> within it. This action cannot be undone.
                            </span>
                        )}
                        {deleteConfirm?.type === 'tag' && (
                            <span> It will be removed from all projects using it.</span>
                        )}
                    </p>
                    <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                        <button className="btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                        <button className="btn-primary" style={{ background: '#ef4444' }} onClick={confirmDelete}>
                            <Trash2 size={16} /> Delete
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}

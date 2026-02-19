import React, { useState, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import { Save, Shield, AlertTriangle, RefreshCw, Tag, Activity } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { TagManager } from './TagManager';
import { AuditLogView } from './AuditLogView';
import './AdminPanel.css';

export function AdminPanel() {
    const { permissions: contextPermissions, updatePermissionsBulk } = useData(); // Use context
    const { success, error: showError } = useToast();
    const [localPermissions, setLocalPermissions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState('permissions');

    // Define the structure of permissions for the UI
    const permissionGroups = [
        {
            category: 'Dashboards',
            items: [
                { key: 'can_view_exec_dashboard', label: 'View Executive Summary' },
                { key: 'can_view_dashboard', label: 'View Standard Dashboard' }
            ]
        },
        {
            category: 'Metrics',
            items: [
                { key: 'can_view_metrics', label: 'View Metrics Dashboard' }
            ]
        },
        {
            category: 'Projects',
            items: [
                { key: 'can_view_projects', label: 'View Projects' },
                { key: 'can_create_project', label: 'Create Projects' },
                { key: 'can_edit_project', label: 'Edit Projects' },
                { key: 'can_delete_project', label: 'Delete Projects' }
            ]
        },
        {
            category: 'Goals',
            items: [
                { key: 'can_view_goals', label: 'View Goals' },
                { key: 'can_create_goal', label: 'Create Goals' },
                { key: 'can_edit_goal', label: 'Edit Goals' },
                { key: 'can_delete_goal', label: 'Delete Goals' },
                { key: 'can_manage_kpis', label: 'Manage KPIs' }
            ]
        },
        {
            category: 'Reports',
            items: [
                { key: 'can_view_reports', label: 'View Status Reports' },
                { key: 'can_create_reports', label: 'Create Status Reports' }
            ]
        },
        {
            category: 'Intake',
            items: [
                { key: 'can_view_intake', label: 'View Intake Portal' },
                { key: 'can_view_incoming_requests', label: 'View Incoming Requests' },
                { key: 'can_manage_intake_forms', label: 'Manage Forms (Add/Edit/Delete)' },
                { key: 'can_manage_intake', label: 'Manage Submissions (Status/Date)' }
            ]
        },
        {
            category: 'Tags',
            items: [
                { key: 'can_manage_tags', label: 'Manage Tags & Groups' }
            ]
        }
    ];

    const targetRoles = ['Editor', 'Viewer', 'IntakeManager', 'ExecView', 'IntakeSubmit'];

    // Sync with context permissions on load
    useEffect(() => {
        if (contextPermissions.length > 0) {
            setLocalPermissions(contextPermissions);
            setLoading(false);
        } else {
            // If context is still loading or empty, we might wait or show defaults
            // Assuming context loads eventually.
            const timer = setTimeout(() => setLoading(false), 1000);
            return () => clearTimeout(timer);
        }
    }, [contextPermissions]);

    const isAllowed = (role, permissionKey) => {
        // Check local state first
        const entry = localPermissions.find(p => p.role === role && p.permission === permissionKey);
        return entry ? entry.isAllowed : false;
    };

    const handleToggle = (role, permissionKey) => {
        // Update local state
        setLocalPermissions(prev => {
            const existingIndex = prev.findIndex(p => p.role === role && p.permission === permissionKey);
            if (existingIndex >= 0) {
                const newPerms = [...prev];
                newPerms[existingIndex] = { ...newPerms[existingIndex], isAllowed: !newPerms[existingIndex].isAllowed };
                return newPerms;
            } else {
                return [...prev, { role, permission: permissionKey, isAllowed: true }];
            }
        });
    };

    const saveChanges = async () => {
        setSaving(true);
        try {
            // Prepare updates
            const updates = localPermissions.map(p => ({
                role: p.role,
                permission: p.permission,
                isAllowed: p.isAllowed
            }));

            const result = await updatePermissionsBulk(updates);

            if (result) {
                success('Permissions updated successfully');
            } else {
                throw new Error('Failed to save');
            }
        } catch (err) {
            console.error(err);
            showError('Failed to save changes');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="loading-spinner">Loading settings...</div>;
    }

    return (
        <div className="admin-panel">
            {activeTab === 'permissions' && (
                <header className="admin-header actions-only">
                    <button className="btn-primary" onClick={saveChanges} disabled={saving}>
                        {saving ? <RefreshCw className="spin" size={18} /> : <Save size={18} />}
                        Apply Changes
                    </button>
                </header>
            )}

            <div className="admin-tabs">
                <button
                    className={`admin-tab ${activeTab === 'permissions' ? 'active' : ''}`}
                    onClick={() => setActiveTab('permissions')}
                >
                    <Shield size={16} /> Role Permissions
                </button>
                <button
                    className={`admin-tab ${activeTab === 'tags' ? 'active' : ''}`}
                    onClick={() => setActiveTab('tags')}
                >
                    <Tag size={16} /> Tag Management
                </button>
                <button
                    className={`admin-tab ${activeTab === 'audit-log' ? 'active' : ''}`}
                    onClick={() => setActiveTab('audit-log')}
                >
                    <Activity size={16} /> Audit Log
                </button>
            </div>

            {activeTab === 'permissions' && (
                <div className="admin-content glass">
                    <table className="permissions-table">
                        <thead>
                            <tr>
                                <th>Permission</th>
                                <th>Editor</th>
                                <th>Viewer</th>
                                <th>Intake Manager</th>
                                <th>Exec View</th>
                                <th>Intake Submit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {permissionGroups.map(group => (
                                <React.Fragment key={group.category}>
                                    <tr className="category-row">
                                        <td colSpan={targetRoles.length + 1}>{group.category}</td>
                                    </tr>
                                    {group.items.map(item => (
                                        <tr key={item.key}>
                                            <td className="perm-label">{item.label}</td>
                                            {targetRoles.map(role => (
                                                <td key={role} className="chk-cell">
                                                    <label className="switch">
                                                        <input
                                                            type="checkbox"
                                                            checked={isAllowed(role, item.key)}
                                                            onChange={() => handleToggle(role, item.key)}
                                                        />
                                                        <span className="slider round"></span>
                                                    </label>
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>

                    <div className="admin-note">
                        <AlertTriangle size={16} />
                        <span>Note: <strong>Admins</strong> have full access to all features by default. Changes here apply to all users with the selected roles. Changes require a page reload to take effect for current users.</span>
                    </div>
                </div>
            )}

            {activeTab === 'tags' && (
                <TagManager />
            )}

            {activeTab === 'audit-log' && (
                <AuditLogView />
            )}
        </div>
    );
}

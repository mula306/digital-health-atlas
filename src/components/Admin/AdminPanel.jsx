import React, { useState, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import { Save, Shield, AlertTriangle, RefreshCw, Tag, Activity, Scale, Building2 } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { TagManager } from './TagManager';
import { AuditLogView } from './AuditLogView';
import { GovernanceConfig } from './GovernanceConfig';
import { OrganizationManager } from './OrganizationManager';
import './AdminPanel.css';

export function AdminPanel() {
    const { permissions: contextPermissions, updatePermissionsBulk, hasPermission, hasRole } = useData();
    const { success, error: showError } = useToast();
    const [localPermissions, setLocalPermissions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState('permissions');
    const isAdmin = hasRole('Admin');
    const canManageRolePermissions = isAdmin;
    const canManageTags = isAdmin || hasPermission('can_manage_tags');
    const canViewAuditLog = isAdmin;
    const canManageGovernance = isAdmin || hasPermission('can_manage_governance');
    const canManageOrganizations = isAdmin;

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
            category: 'Governance',
            items: [
                { key: 'can_view_governance_queue', label: 'View Governance Queue' },
                { key: 'can_vote_governance', label: 'Submit Governance Votes' },
                { key: 'can_decide_governance', label: 'Finalize Governance Decisions' },
                { key: 'can_manage_governance', label: 'Manage Governance Settings' }
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

    const availableTabs = [
        canManageRolePermissions ? 'permissions' : null,
        canManageTags ? 'tags' : null,
        canViewAuditLog ? 'audit-log' : null,
        canManageGovernance ? 'governance' : null,
        canManageOrganizations ? 'organizations' : null
    ].filter(Boolean);

    useEffect(() => {
        if (availableTabs.length === 0) return;
        if (!availableTabs.includes(activeTab)) {
            setActiveTab(availableTabs[0]);
        }
    }, [activeTab, availableTabs]);

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

    const toggleAllForRole = (role) => {
        // Find all unique known permission keys across all categories
        const allKeys = permissionGroups.flatMap(g => g.items.map(i => i.key));

        // Are all of them currently allowed for this role?
        const allAllowed = allKeys.every(k => isAllowed(role, k));

        // Set target state to the opposite of allAllowed
        const targetState = !allAllowed;

        setLocalPermissions(prev => {
            const newPerms = [...prev];
            allKeys.forEach(key => {
                const existingIndex = newPerms.findIndex(p => p.role === role && p.permission === key);
                if (existingIndex >= 0) {
                    newPerms[existingIndex] = { ...newPerms[existingIndex], isAllowed: targetState };
                } else if (targetState) {
                    newPerms.push({ role, permission: key, isAllowed: targetState });
                }
            });
            return newPerms;
        });
    };

    const toggleAllForCategory = (group) => {
        const keys = group.items.map(i => i.key);

        // Check if every role has every permission in this category enabled
        let allAllowed = true;
        for (const role of targetRoles) {
            for (const key of keys) {
                if (!isAllowed(role, key)) {
                    allAllowed = false;
                    break;
                }
            }
            if (!allAllowed) break;
        }

        const targetState = !allAllowed;

        setLocalPermissions(prev => {
            const newPerms = [...prev];
            for (const role of targetRoles) {
                for (const key of keys) {
                    const existingIndex = newPerms.findIndex(p => p.role === role && p.permission === key);
                    if (existingIndex >= 0) {
                        newPerms[existingIndex] = { ...newPerms[existingIndex], isAllowed: targetState };
                    } else if (targetState) {
                        newPerms.push({ role, permission: key, isAllowed: targetState });
                    }
                }
            }
            return newPerms;
        });
    };

    const saveChanges = async () => {
        if (!canManageRolePermissions) return;
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

    if (availableTabs.length === 0) {
        return (
            <div className="admin-panel">
                <div className="admin-content glass">
                    <div className="admin-note">
                        <AlertTriangle size={16} />
                        <span>No administrative tools are available for your account.</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-panel">
            <header className="admin-header">
                <div>
                    <h1>System Administration</h1>
                    <p>Manage users, organizational structure, tags, and system settings.</p>
                </div>
                {activeTab === 'permissions' && canManageRolePermissions && (
                    <button className="btn-primary" onClick={saveChanges} disabled={saving}>
                        {saving ? <RefreshCw className="spin" size={18} /> : <Save size={18} />}
                        Apply Changes
                    </button>
                )}
            </header>

            <div className="admin-layout">
                {/* Vertical Sidebar */}
                <div className="admin-sidebar">
                    {canManageRolePermissions && (
                        <button
                            className={`admin-tab ${activeTab === 'permissions' ? 'active' : ''}`}
                            onClick={() => setActiveTab('permissions')}
                        >
                            <Shield size={16} /> Role Permissions
                        </button>
                    )}
                    {canManageTags && (
                        <button
                            className={`admin-tab ${activeTab === 'tags' ? 'active' : ''}`}
                            onClick={() => setActiveTab('tags')}
                        >
                            <Tag size={16} /> Tag Management
                        </button>
                    )}
                    {canViewAuditLog && (
                        <button
                            className={`admin-tab ${activeTab === 'audit-log' ? 'active' : ''}`}
                            onClick={() => setActiveTab('audit-log')}
                        >
                            <Activity size={16} /> Audit Log
                        </button>
                    )}
                    {canManageGovernance && (
                        <button
                            className={`admin-tab ${activeTab === 'governance' ? 'active' : ''}`}
                            onClick={() => setActiveTab('governance')}
                        >
                            <Scale size={16} /> Governance
                        </button>
                    )}
                    {canManageOrganizations && (
                        <button
                            className={`admin-tab ${activeTab === 'organizations' ? 'active' : ''}`}
                            onClick={() => setActiveTab('organizations')}
                        >
                            <Building2 size={16} /> Organizations
                        </button>
                    )}
                </div>

                {/* Main Content Area */}
                <div className="admin-content-area">

                    {activeTab === 'permissions' && canManageRolePermissions && (
                        <div className="admin-content glass">
                            <table className="permissions-table">
                                <thead>
                                    <tr>
                                        <th>Permission</th>
                                        {targetRoles.map(role => (
                                            <th key={role}>
                                                <div className="role-header-cell">
                                                    <span className="role-header-label">
                                                        {role === 'ExecView' ? 'Exec View' : role === 'IntakeSubmit' ? 'Intake Submit' : role === 'IntakeManager' ? 'Intake Manager' : role}
                                                    </span>
                                                    <button
                                                        className="btn-ghost role-toggle-btn"
                                                        onClick={() => toggleAllForRole(role)}
                                                        title={`Toggle all for ${role}`}
                                                    >
                                                        Toggle All
                                                    </button>
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {permissionGroups.map(group => (
                                        <React.Fragment key={group.category}>
                                            <tr className="category-row">
                                                <td>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                        <span>{group.category}</span>
                                                        <button
                                                            className="btn-ghost"
                                                            style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', color: 'var(--text-tertiary)', textTransform: 'none', letterSpacing: 'normal' }}
                                                            onClick={() => toggleAllForCategory(group)}
                                                            title={`Toggle all for ${group.category}`}
                                                        >
                                                            Toggle All Row
                                                        </button>
                                                    </div>
                                                </td>
                                                <td colSpan={targetRoles.length}></td>
                                            </tr>
                                            {group.items.map(item => (
                                                <tr key={item.key} className="permission-item-row">
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

                    {activeTab === 'tags' && canManageTags && (
                        <TagManager />
                    )}

                    {activeTab === 'audit-log' && canViewAuditLog && (
                        <AuditLogView />
                    )}

                    {activeTab === 'governance' && canManageGovernance && (
                        <GovernanceConfig />
                    )}

                    {activeTab === 'organizations' && canManageOrganizations && (
                        <OrganizationManager />
                    )}

                </div> {/* End .admin-content-area */}
            </div> {/* End .admin-layout */}
        </div>
    );
}

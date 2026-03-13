import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { Save, Shield, AlertTriangle, RefreshCw, Tag, Activity, Scale, Building2 } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { TagManager } from './TagManager';
import { AuditLogView } from './AuditLogView';
import { GovernanceConfig } from './GovernanceConfig';
import { OrganizationManager } from './OrganizationManager';
import './AdminPanel.css';

export function AdminPanel({
    initialTab = null,
    onTabChange = null,
    governanceTab = null,
    onGovernanceTabChange = null,
    organizationSection = null,
    onOrganizationSectionChange = null,
    organizationSharingTab = null,
    onOrganizationSharingTabChange = null
}) {
    const { permissions: contextPermissions, permissionCatalog, updatePermissionsBulk, hasPermission } = useData();
    const { success, error: showError } = useToast();
    const [localPermissions, setLocalPermissions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [permissionsViewMode, setPermissionsViewMode] = useState('focused');
    const [activeRoleState, setActiveRoleState] = useState(null);
    const [activeTabState, setActiveTabState] = useState('permissions');
    const canManageRolePermissions = hasPermission('can_manage_role_permissions');
    const canManageTags = hasPermission('can_manage_tags');
    const canViewAuditLog = hasPermission('can_view_audit_log');
    const canManageGovernance = hasPermission('can_manage_governance');
    const canManageOrganizations = hasPermission('can_manage_organizations') || hasPermission('can_manage_sharing_requests');

    const fallbackPermissionGroups = useMemo(() => ([
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
            category: 'Status Reports',
            items: [
                { key: 'can_view_status_reports', label: 'View Status Reports' },
                { key: 'can_create_status_reports', label: 'Create Status Reports' }
            ]
        },
        {
            category: 'Reports',
            items: [
                { key: 'can_view_exec_packs', label: 'View Reports' },
                { key: 'can_manage_exec_packs', label: 'Manage Executive Packs' },
                { key: 'can_run_exec_pack_scheduler', label: 'Run Due Executive Packs' }
            ]
        },
        {
            category: 'Intake',
            items: [
                { key: 'can_view_intake', label: 'View Intake Portal' },
                { key: 'can_view_incoming_requests', label: 'View Incoming Requests' },
                { key: 'can_manage_intake_forms', label: 'Manage Intake Forms' },
                { key: 'can_manage_intake', label: 'Manage Intake Submissions' },
                { key: 'can_manage_workflow_sla', label: 'Manage Workflow SLA Policies' }
            ]
        },
        {
            category: 'Governance',
            items: [
                { key: 'can_view_governance_queue', label: 'View Governance Queue' },
                { key: 'can_vote_governance', label: 'Submit Governance Votes' },
                { key: 'can_decide_governance', label: 'Finalize Governance Decisions' },
                { key: 'can_manage_governance', label: 'Manage Governance Settings' },
                { key: 'can_manage_governance_sessions', label: 'Manage Governance Sessions' }
            ]
        },
        {
            category: 'Admin',
            items: [
                { key: 'can_manage_tags', label: 'Manage Tags & Groups' },
                { key: 'can_manage_sharing_requests', label: 'Manage Sharing Requests' },
                { key: 'can_manage_organizations', label: 'Manage Organizations' },
                { key: 'can_manage_role_permissions', label: 'Manage Role Permissions' },
                { key: 'can_view_audit_log', label: 'View Audit Log' }
            ]
        }
    ]), []);

    const permissionGroups = useMemo(() => {
        const groups = permissionCatalog?.permissionGroups;
        return Array.isArray(groups) && groups.length > 0
            ? groups
            : fallbackPermissionGroups;
    }, [permissionCatalog, fallbackPermissionGroups]);

    const fallbackTargetRoles = useMemo(() => ([
        'Viewer',
        'Editor',
        'IntakeManager',
        'ExecView',
        'IntakeSubmit',
        'GovernanceMember',
        'GovernanceChair',
        'GovernanceAdmin'
    ]), []);

    const targetRoles = useMemo(() => {
        const roles = permissionCatalog?.roles;
        if (Array.isArray(roles) && roles.length > 0) {
            return roles
                .map((role) => role?.key)
                .filter((key) => typeof key === 'string' && key.trim().length > 0);
        }
        return fallbackTargetRoles;
    }, [permissionCatalog, fallbackTargetRoles]);

    const roleLabelMap = useMemo(() => {
        const map = {};
        const roles = Array.isArray(permissionCatalog?.roles) ? permissionCatalog.roles : [];
        roles.forEach((role) => {
            if (typeof role?.key === 'string' && typeof role?.label === 'string' && role.label.trim()) {
                map[role.key] = role.label.trim();
            }
        });
        if (!map.IntakeManager) map.IntakeManager = 'Intake Manager';
        if (!map.IntakeSubmit) map.IntakeSubmit = 'Intake Submit';
        if (!map.ExecView) map.ExecView = 'Exec View';
        if (!map.GovernanceMember) map.GovernanceMember = 'Governance Member';
        if (!map.GovernanceChair) map.GovernanceChair = 'Governance Chair';
        if (!map.GovernanceAdmin) map.GovernanceAdmin = 'Governance Admin';
        return map;
    }, [permissionCatalog]);

    const activeRole = useMemo(() => {
        if (activeRoleState && targetRoles.includes(activeRoleState)) {
            return activeRoleState;
        }
        return targetRoles[0] || null;
    }, [activeRoleState, targetRoles]);

    const availableTabs = [
        canManageRolePermissions ? 'permissions' : null,
        canManageTags ? 'tags' : null,
        canViewAuditLog ? 'audit-log' : null,
        canManageGovernance ? 'governance' : null,
        canManageOrganizations ? 'organizations' : null
    ].filter(Boolean);
    const isActiveTabControlled = typeof onTabChange === 'function';
    const normalizedInitialTab = (
        typeof initialTab === 'string' &&
        availableTabs.includes(initialTab)
    ) ? initialTab : null;
    const activeTab = (
        isActiveTabControlled
            ? normalizedInitialTab
            : (availableTabs.includes(activeTabState) ? activeTabState : null)
    ) || availableTabs[0] || null;

    const openAdminTab = useCallback((nextTab) => {
        if (!availableTabs.includes(nextTab)) return;
        if (isActiveTabControlled) {
            onTabChange?.(nextTab);
            return;
        }
        setActiveTabState(nextTab);
    }, [availableTabs, isActiveTabControlled, onTabChange]);

    useEffect(() => {
        if (!isActiveTabControlled) return;
        if (!activeTab) return;
        if (initialTab !== activeTab) {
            onTabChange?.(activeTab);
        }
    }, [isActiveTabControlled, activeTab, initialTab, onTabChange]);

    useEffect(() => {
        if (!activeRole || activeRoleState === activeRole) return;
        setActiveRoleState(activeRole);
    }, [activeRole, activeRoleState]);

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

    const toggleAllForCategoryRole = (group, role) => {
        if (!role) return;
        const keys = group.items.map(i => i.key);
        const allAllowed = keys.every((key) => isAllowed(role, key));
        const targetState = !allAllowed;

        setLocalPermissions(prev => {
            const newPerms = [...prev];
            for (const key of keys) {
                const existingIndex = newPerms.findIndex(p => p.role === role && p.permission === key);
                if (existingIndex >= 0) {
                    newPerms[existingIndex] = { ...newPerms[existingIndex], isAllowed: targetState };
                } else if (targetState) {
                    newPerms.push({ role, permission: key, isAllowed: targetState });
                }
            }
            return newPerms;
        });
    };

    const saveChanges = async () => {
        if (!canManageRolePermissions) return;
        setSaving(true);
        try {
            const permissionKeys = [...new Set(
                permissionGroups.flatMap(group => group.items.map(item => item.key))
            )];
            const updates = [];
            for (const role of targetRoles) {
                for (const permissionKey of permissionKeys) {
                    updates.push({
                        role,
                        permission: permissionKey,
                        isAllowed: isAllowed(role, permissionKey)
                    });
                }
            }

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
                            onClick={() => openAdminTab('permissions')}
                        >
                            <Shield size={16} /> Role Permissions
                        </button>
                    )}
                    {canManageTags && (
                        <button
                            className={`admin-tab ${activeTab === 'tags' ? 'active' : ''}`}
                            onClick={() => openAdminTab('tags')}
                        >
                            <Tag size={16} /> Tag Management
                        </button>
                    )}
                    {canViewAuditLog && (
                        <button
                            className={`admin-tab ${activeTab === 'audit-log' ? 'active' : ''}`}
                            onClick={() => openAdminTab('audit-log')}
                        >
                            <Activity size={16} /> Audit Log
                        </button>
                    )}
                    {canManageGovernance && (
                        <button
                            className={`admin-tab ${activeTab === 'governance' ? 'active' : ''}`}
                            onClick={() => openAdminTab('governance')}
                        >
                            <Scale size={16} /> Governance
                        </button>
                    )}
                    {canManageOrganizations && (
                        <button
                            className={`admin-tab ${activeTab === 'organizations' ? 'active' : ''}`}
                            onClick={() => openAdminTab('organizations')}
                        >
                            <Building2 size={16} /> Organizations
                        </button>
                    )}
                </div>

                {/* Main Content Area */}
                <div className="admin-content-area">

                    {activeTab === 'permissions' && canManageRolePermissions && (
                        <div className="admin-content glass">
                            <div className="permissions-view-toolbar">
                                <div className="permissions-view-modes">
                                    <button
                                        className={`btn-ghost permissions-view-mode-btn ${permissionsViewMode === 'focused' ? 'active' : ''}`}
                                        onClick={() => setPermissionsViewMode('focused')}
                                    >
                                        Role Focus
                                    </button>
                                    <button
                                        className={`btn-ghost permissions-view-mode-btn ${permissionsViewMode === 'matrix' ? 'active' : ''}`}
                                        onClick={() => setPermissionsViewMode('matrix')}
                                    >
                                        Matrix
                                    </button>
                                </div>
                            </div>

                            {permissionsViewMode === 'focused' ? (
                                <>
                                    <div className="permissions-role-picker">
                                        {targetRoles.map((role) => (
                                            <button
                                                key={role}
                                                className={`permissions-role-pill ${activeRole === role ? 'active' : ''}`}
                                                onClick={() => setActiveRoleState(role)}
                                            >
                                                {roleLabelMap[role] || role}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="permissions-focused-header">
                                        <strong>{activeRole ? (roleLabelMap[activeRole] || activeRole) : 'Role'}</strong>
                                        {activeRole && (
                                            <button
                                                className="btn-ghost role-toggle-btn"
                                                onClick={() => toggleAllForRole(activeRole)}
                                            >
                                                Toggle All For Role
                                            </button>
                                        )}
                                    </div>

                                    <table className="permissions-table permissions-focused-table">
                                        <thead>
                                            <tr>
                                                <th>Permission</th>
                                                <th>{activeRole ? (roleLabelMap[activeRole] || activeRole) : 'Role'}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {permissionGroups.map(group => (
                                                <React.Fragment key={group.category}>
                                                    <tr className="category-row">
                                                        <td className="category-cell">
                                                            <div className="category-title-row">
                                                                <span>{group.category}</span>
                                                                <button
                                                                    className="btn-ghost category-toggle-btn"
                                                                    onClick={() => toggleAllForCategoryRole(group, activeRole)}
                                                                    title={`Toggle ${group.category} for ${activeRole ? (roleLabelMap[activeRole] || activeRole) : 'role'}`}
                                                                >
                                                                    Toggle Category
                                                                </button>
                                                            </div>
                                                        </td>
                                                        <td className="chk-cell category-action-cell"></td>
                                                    </tr>
                                                    {group.items.map(item => (
                                                        <tr key={item.key} className="permission-item-row">
                                                            <td className="perm-label">{item.label}</td>
                                                            <td className="chk-cell">
                                                                <label className="switch">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={activeRole ? isAllowed(activeRole, item.key) : false}
                                                                        onChange={() => activeRole && handleToggle(activeRole, item.key)}
                                                                    />
                                                                    <span className="slider round"></span>
                                                                </label>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </React.Fragment>
                                            ))}
                                        </tbody>
                                    </table>
                                </>
                            ) : (
                                <div className="permissions-table-wrap">
                                    <table className="permissions-table">
                                        <thead>
                                            <tr>
                                                <th>Permission</th>
                                                {targetRoles.map(role => (
                                                    <th key={role}>
                                                        <div className="role-header-cell">
                                                            <span className="role-header-label">
                                                                {roleLabelMap[role] || role}
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
                                                        <td className="category-cell">
                                                            <div className="category-title-row">
                                                                <span>{group.category}</span>
                                                                <button
                                                                    className="btn-ghost category-toggle-btn"
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
                                </div>
                            )}

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
                        <GovernanceConfig
                            initialTab={governanceTab}
                            onTabChange={onGovernanceTabChange}
                        />
                    )}

                    {activeTab === 'organizations' && canManageOrganizations && (
                        <OrganizationManager
                            initialSection={organizationSection}
                            onSectionChange={onOrganizationSectionChange}
                            initialSharingTab={organizationSharingTab}
                            onSharingTabChange={onOrganizationSharingTabChange}
                        />
                    )}

                </div> {/* End .admin-content-area */}
            </div> {/* End .admin-layout */}
        </div>
    );
}

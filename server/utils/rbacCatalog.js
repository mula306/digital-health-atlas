const ROLE_DEFINITIONS = [
    {
        key: 'Viewer',
        label: 'Viewer',
        description: 'Read-only access to dashboards, projects, goals, and reports.'
    },
    {
        key: 'Editor',
        label: 'Editor',
        description: 'Project and goal editing rights.'
    },
    {
        key: 'IntakeManager',
        label: 'Intake Manager',
        description: 'Manages intake forms, submissions, and governance routing.'
    },
    {
        key: 'ExecView',
        label: 'Exec View',
        description: 'Executive dashboard and report consumption.'
    },
    {
        key: 'IntakeSubmit',
        label: 'Intake Submit',
        description: 'Submit and track intake requests.'
    },
    {
        key: 'GovernanceMember',
        label: 'Governance Member',
        description: 'Participates in governance review votes.'
    },
    {
        key: 'GovernanceChair',
        label: 'Governance Chair',
        description: 'Can decide governance outcomes and run sessions.'
    },
    {
        key: 'GovernanceAdmin',
        label: 'Governance Admin',
        description: 'Full governance configuration and operations.'
    }
];

const PERMISSION_GROUPS = [
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
            { key: 'can_manage_governance', label: 'Manage Governance Configuration' },
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
];

const PERMISSION_KEYS = [...new Set(PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => item.key)))];
const ROLE_KEYS = ROLE_DEFINITIONS.map((role) => role.key);

const ROLE_DEFAULT_ALLOWLIST = {
    Viewer: [
        'can_view_goals',
        'can_view_projects',
        'can_view_dashboard',
        'can_view_status_reports',
        'can_view_exec_packs',
        'can_view_metrics'
    ],
    Editor: [
        'can_view_goals',
        'can_create_goal',
        'can_edit_goal',
        'can_manage_kpis',
        'can_view_projects',
        'can_create_project',
        'can_edit_project',
        'can_view_status_reports',
        'can_create_status_reports',
        'can_view_exec_packs',
        'can_manage_exec_packs',
        'can_view_dashboard',
        'can_view_metrics'
    ],
    IntakeManager: [
        'can_view_intake',
        'can_view_incoming_requests',
        'can_manage_intake_forms',
        'can_manage_intake',
        'can_manage_workflow_sla',
        'can_view_dashboard',
        'can_view_metrics',
        'can_view_governance_queue',
        'can_manage_governance'
    ],
    ExecView: [
        'can_view_dashboard',
        'can_view_exec_dashboard',
        'can_view_status_reports',
        'can_view_exec_packs',
        'can_view_metrics',
        'can_view_governance_queue'
    ],
    IntakeSubmit: [
        'can_view_intake'
    ],
    GovernanceMember: [
        'can_view_governance_queue',
        'can_vote_governance'
    ],
    GovernanceChair: [
        'can_view_governance_queue',
        'can_vote_governance',
        'can_decide_governance',
        'can_manage_governance_sessions'
    ],
    GovernanceAdmin: [
        'can_view_governance_queue',
        'can_vote_governance',
        'can_decide_governance',
        'can_manage_governance',
        'can_manage_governance_sessions'
    ]
};

const ROLE_ALIAS_MAP = new Map([
    ['viewer', 'Viewer'],
    ['editor', 'Editor'],
    ['intakemanager', 'IntakeManager'],
    ['intake manager', 'IntakeManager'],
    ['intake_manager', 'IntakeManager'],
    ['execview', 'ExecView'],
    ['exec view', 'ExecView'],
    ['executive viewer', 'ExecView'],
    ['intakesubmit', 'IntakeSubmit'],
    ['intake submit', 'IntakeSubmit'],
    ['intake_submit', 'IntakeSubmit'],
    ['governancemember', 'GovernanceMember'],
    ['governance member', 'GovernanceMember'],
    ['governance_member', 'GovernanceMember'],
    ['governancechair', 'GovernanceChair'],
    ['governance chair', 'GovernanceChair'],
    ['governance_chair', 'GovernanceChair'],
    ['governanceadmin', 'GovernanceAdmin'],
    ['governance admin', 'GovernanceAdmin'],
    ['governance_admin', 'GovernanceAdmin'],
    ['admin', 'Admin']
]);

const KNOWN_ROLE_SET = new Set(ROLE_KEYS);
const KNOWN_PERMISSION_SET = new Set(PERMISSION_KEYS);

const buildRolePermissionDefaults = () => {
    const defaults = {};
    for (const roleKey of ROLE_KEYS) {
        const allow = new Set(ROLE_DEFAULT_ALLOWLIST[roleKey] || []);
        defaults[roleKey] = {};
        for (const permissionKey of PERMISSION_KEYS) {
            defaults[roleKey][permissionKey] = allow.has(permissionKey) ? 1 : 0;
        }
    }
    return defaults;
};

const buildDefaultPermissionEntries = () => {
    const defaults = buildRolePermissionDefaults();
    const entries = [];
    for (const role of ROLE_KEYS) {
        for (const permission of PERMISSION_KEYS) {
            entries.push({
                role,
                permission,
                isAllowed: defaults[role][permission] ? 1 : 0
            });
        }
    }
    return entries;
};

const normalizeRoleName = (role) => {
    if (typeof role !== 'string') return '';
    const trimmed = role.trim();
    if (!trimmed) return '';
    if (KNOWN_ROLE_SET.has(trimmed) || trimmed === 'Admin') return trimmed;
    const canonical = ROLE_ALIAS_MAP.get(trimmed.toLowerCase());
    return canonical || trimmed;
};

const normalizeRoleList = (roles = []) => {
    if (!Array.isArray(roles)) return [];
    const normalized = roles
        .map((role) => normalizeRoleName(role))
        .filter(Boolean);
    return [...new Set(normalized)];
};

const getRbacCatalogResponse = () => ({
    roles: ROLE_DEFINITIONS,
    permissionGroups: PERMISSION_GROUPS,
    permissions: PERMISSION_KEYS
});

const isKnownRole = (role) => typeof role === 'string' && (KNOWN_ROLE_SET.has(role) || role === 'Admin');
const isKnownPermission = (permission) => typeof permission === 'string' && KNOWN_PERMISSION_SET.has(permission);

export {
    ROLE_DEFINITIONS,
    ROLE_KEYS,
    PERMISSION_GROUPS,
    PERMISSION_KEYS,
    ROLE_DEFAULT_ALLOWLIST,
    buildRolePermissionDefaults,
    buildDefaultPermissionEntries,
    normalizeRoleName,
    normalizeRoleList,
    getRbacCatalogResponse,
    isKnownRole,
    isKnownPermission
};

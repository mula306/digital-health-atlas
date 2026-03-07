import { getPool, sql } from '../db.js';

const rolePermissionDefaults = {
    Viewer: {
        can_view_goals: 1,
        can_view_projects: 1,
        can_view_dashboard: 1,
        can_view_reports: 1,
        can_view_metrics: 1
    },
    Editor: {
        can_view_goals: 1,
        can_create_goal: 1,
        can_edit_goal: 1,
        can_delete_goal: 0,
        can_manage_kpis: 1,
        can_view_projects: 1,
        can_create_project: 1,
        can_edit_project: 1,
        can_delete_project: 0,
        can_create_reports: 1,
        can_view_dashboard: 1,
        can_view_reports: 1,
        can_view_metrics: 1
    },
    IntakeManager: {
        can_view_intake: 1,
        can_view_incoming_requests: 1,
        can_manage_intake_forms: 1,
        can_manage_intake: 1,
        can_view_dashboard: 1,
        can_view_metrics: 1,
        can_view_governance_queue: 1,
        can_manage_governance: 1
    },
    ExecView: {
        can_view_dashboard: 1,
        can_view_exec_dashboard: 1,
        can_view_reports: 1,
        can_view_metrics: 1,
        can_view_governance_queue: 1
    },
    IntakeSubmit: {
        can_view_intake: 1,
        can_view_incoming_requests: 0,
        can_manage_intake_forms: 0,
        can_manage_intake: 0
    },
    GovernanceMember: {
        can_view_governance_queue: 1,
        can_vote_governance: 1,
        can_decide_governance: 0,
        can_manage_governance: 0
    },
    GovernanceChair: {
        can_view_governance_queue: 1,
        can_vote_governance: 1,
        can_decide_governance: 1,
        can_manage_governance: 0
    },
    GovernanceAdmin: {
        can_view_governance_queue: 1,
        can_vote_governance: 1,
        can_decide_governance: 1,
        can_manage_governance: 1
    }
};

const buildDefaultEntries = () => {
    const entries = [];
    for (const [role, permissions] of Object.entries(rolePermissionDefaults)) {
        for (const [permission, isAllowed] of Object.entries(permissions)) {
            entries.push({ role, permission, isAllowed });
        }
    }
    return entries;
};

export async function seedPermissions() {
    try {
        console.log('Seeding default permissions...');
        const pool = await getPool();
        const permissions = buildDefaultEntries();
        const overwriteExisting = process.env.SEED_PERMISSIONS_FORCE === 'true';

        const mergeSql = overwriteExisting
            ? `
                    MERGE RolePermissions AS target
                    USING (SELECT @role AS role, @permission AS permission, @isAllowed AS isAllowed) AS source
                    ON (target.role = source.role AND target.permission = source.permission)
                    WHEN MATCHED THEN
                        UPDATE SET isAllowed = source.isAllowed
                    WHEN NOT MATCHED THEN
                        INSERT (role, permission, isAllowed)
                        VALUES (source.role, source.permission, source.isAllowed);
                `
            : `
                    MERGE RolePermissions AS target
                    USING (SELECT @role AS role, @permission AS permission, @isAllowed AS isAllowed) AS source
                    ON (target.role = source.role AND target.permission = source.permission)
                    WHEN NOT MATCHED THEN
                        INSERT (role, permission, isAllowed)
                        VALUES (source.role, source.permission, source.isAllowed);
                `;

        for (const p of permissions) {
            await pool.request()
                .input('role', sql.NVarChar, p.role)
                .input('permission', sql.NVarChar, p.permission)
                .input('isAllowed', sql.Bit, p.isAllowed ? 1 : 0)
                .query(mergeSql);
        }

        if (process.env.PRUNE_LEGACY_USER_ROLE === 'true') {
            await pool.request().query(`DELETE FROM RolePermissions WHERE role = 'User'`);
            console.log('Pruned legacy User role permissions.');
        }

        console.log(`Default permissions seeded successfully (${overwriteExisting ? 'overwrite mode' : 'insert-only mode'}).`);
    } catch (err) {
        console.error('Error seeding permissions:', err);
    }
}

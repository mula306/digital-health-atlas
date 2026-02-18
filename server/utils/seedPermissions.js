
import { getPool, sql } from '../db.js';

export async function seedPermissions() {
    try {
        console.log('Seeding default permissions...');
        const pool = await getPool();

        // Default permissions for new roles
        const permissions = [
            // Intake Manager
            { role: 'IntakeManager', permission: 'can_view_intake', isAllowed: 1 },
            { role: 'IntakeManager', permission: 'can_view_incoming_requests', isAllowed: 1 },
            { role: 'IntakeManager', permission: 'can_manage_intake_forms', isAllowed: 1 },
            { role: 'IntakeManager', permission: 'can_view_dashboard', isAllowed: 1 }, // Optional: let them see main dashboard
            { role: 'IntakeManager', permission: 'can_view_metrics', isAllowed: 1 },

            // Exec View
            { role: 'ExecView', permission: 'can_view_exec_dashboard', isAllowed: 1 },

            // Intake Submitter
            { role: 'IntakeSubmit', permission: 'can_view_intake', isAllowed: 1 },
            { role: 'IntakeSubmit', permission: 'can_view_incoming_requests', isAllowed: 0 }, // Explicitly deny
            { role: 'IntakeSubmit', permission: 'can_manage_intake_forms', isAllowed: 0 },

            // Standard User (Default Role)
            { role: 'User', permission: 'can_view_projects', isAllowed: 1 },
            { role: 'User', permission: 'can_view_goals', isAllowed: 1 },
            { role: 'User', permission: 'can_view_tasks', isAllowed: 1 },
            { role: 'User', permission: 'can_view_dashboard', isAllowed: 1 },
            { role: 'User', permission: 'can_view_exec_dashboard', isAllowed: 1 },
            { role: 'User', permission: 'can_view_reports', isAllowed: 1 },
            { role: 'User', permission: 'can_view_intake', isAllowed: 1 },
            { role: 'User', permission: 'can_view_incoming_requests', isAllowed: 1 },
            { role: 'User', permission: 'can_view_metrics', isAllowed: 1 }
        ];

        for (const p of permissions) {
            await pool.request()
                .input('role', sql.NVarChar, p.role)
                .input('permission', sql.NVarChar, p.permission)
                .input('isAllowed', sql.Bit, p.isAllowed)
                .query(`
                    IF NOT EXISTS (SELECT 1 FROM RolePermissions WHERE role = @role AND permission = @permission)
                    BEGIN
                        INSERT INTO RolePermissions (role, permission, isAllowed)
                        VALUES (@role, @permission, @isAllowed)
                    END
                `);
        }
        console.log('Default permissions seeded successfully.');
    } catch (err) {
        console.error('Error seeding permissions:', err);
    }
}

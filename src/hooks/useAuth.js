import { useMsal } from "@azure/msal-react";
import { useCallback } from "react";

/**
 * Custom hook to access authentication state and RBAC helpers.
 */
export function useAuth() {
    const { instance, accounts, inProgress } = useMsal();
    const account = accounts[0] || null;

    /**
     * Checks if the current user has a specific role.
     * @param {string} role - The role to check (e.g. 'AppAdmin', 'AppEditor', 'AppViewer')
     * @returns {boolean}
     */
    const hasRole = useCallback((role) => {
        if (!account || !account.idTokenClaims || !account.idTokenClaims.roles) {
            // Debugging: Log why role check failed if it's expected
            // Debugging: Log why role check failed if it's expected
            if (account) {
                console.log("useAuth: No roles found in token claims");
            }
            return false;
        }
        const hasIt = account.idTokenClaims.roles.includes(role);
        // console.log(`useAuth: Checking role '${role}' -> ${hasIt}`, account.idTokenClaims.roles);
        return hasIt;
    }, [account]);

    /**
     * Checks if the user has ANY of the provided roles.
     * @param {string[]} roles - Array of roles to check
     * @returns {boolean}
     */
    const hasAnyRole = useCallback((roles) => {
        if (!account || !account.idTokenClaims || !account.idTokenClaims.roles) {
            return false;
        }
        return roles.some(r => account.idTokenClaims.roles.includes(r));
    }, [account]);

    /**
     * Helper to determine permission level.
     * Hierarchy: Admin > Editor > Viewer
     */
    /**
     * Helper to determine permission level.
     * Hierarchy: Admin > Editor > Viewer
     * Use the 'Value' from Azure App Roles (Admin, Editor, Viewer) not the Display Name.
     */
    const isAppAdmin = hasRole('Admin');
    const isAppEditor = hasRole('Editor');
    const isAppViewer = hasRole('Viewer');
    const isIntakeManager = hasRole('IntakeManager');
    const isExecView = hasRole('ExecView');
    const isIntakeSubmitter = hasRole('IntakeSubmit');

    // Admin has all permissions. Editor has editor permissions.
    // We can interpret permissions hierarchically if needed.
    const canEdit = isAppAdmin || isAppEditor;
    const canDelete = isAppAdmin;

    return {
        instance,
        account,
        inProgress,
        isAuthenticated: !!account,
        hasRole,
        hasAnyRole,
        // Role shortcuts
        isAppAdmin,
        isAppEditor,
        isAppViewer,
        isIntakeManager,
        isExecView,
        isIntakeSubmitter,
        // Permission shortcuts
        canEdit,
        canDelete,
        userRoles: account?.idTokenClaims?.roles || []
    };
}

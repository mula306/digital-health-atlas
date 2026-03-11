import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DataProvider, useData } from '../../context/DataContext.jsx';

const acquireTokenSilent = vi.fn();
const getActiveAccount = vi.fn();

vi.mock('@azure/msal-react', () => ({
    useMsal: () => ({
        instance: {
            acquireTokenSilent,
            getActiveAccount,
            acquireTokenRedirect: vi.fn()
        }
    })
}));

function PermissionProbe() {
    const { hasPermission, currentUser } = useData();
    return (
        <div>
            <span data-testid="projects">{hasPermission('can_view_projects') ? 'yes' : 'no'}</span>
            <span data-testid="tags">{hasPermission('can_manage_tags') ? 'yes' : 'no'}</span>
            <span data-testid="user">{currentUser?.oid || ''}</span>
        </div>
    );
}

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: {
        'content-type': 'application/json'
    }
});

describe('DataContext permission integration', () => {
    beforeEach(() => {
        getActiveAccount.mockReturnValue({
            idTokenClaims: {
                roles: ['Viewer']
            }
        });
        acquireTokenSilent.mockResolvedValue({ accessToken: 'token-abc' });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('hydrates user permissions and computes hasPermission from backend matrix', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
            const normalized = String(url);
            if (normalized.includes('/api/admin/permissions')) {
                return jsonResponse([
                    { role: 'Viewer', permission: 'can_view_projects', isAllowed: true },
                    { role: 'Viewer', permission: 'can_manage_tags', isAllowed: false }
                ]);
            }
            if (normalized.includes('/api/users/me')) {
                return jsonResponse({ oid: 'user-123', roles: ['Viewer'], orgId: '1' });
            }
            if (normalized.includes('/api/admin/permission-catalog')) {
                return jsonResponse({ permissions: [] });
            }
            if (normalized.includes('/api/projects?page=1&limit=50')) {
                return jsonResponse({
                    projects: [],
                    pagination: { page: 1, limit: 50, total: 0, totalPages: 0, hasMore: false }
                });
            }
            if (normalized.includes('/api/tags')) return jsonResponse([]);
            if (normalized.includes('/api/intake/my-submissions')) return jsonResponse([]);
            if (normalized.includes('/api/goals')) return jsonResponse([]);
            return jsonResponse([]);
        });

        render(
            <DataProvider>
                <PermissionProbe />
            </DataProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('user')).toHaveTextContent('user-123');
        });
        expect(screen.getByTestId('projects')).toHaveTextContent('yes');
        expect(screen.getByTestId('tags')).toHaveTextContent('no');
    });
});


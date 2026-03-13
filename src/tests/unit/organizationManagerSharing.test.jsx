import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizationManager } from '../../components/Admin/OrganizationManager.jsx';

const mockUseData = vi.fn();
const mockToast = {
    success: vi.fn(),
    error: vi.fn()
};

const createJsonResponse = (payload) => ({
    ok: true,
    json: async () => payload
});

vi.mock('../../context/DataContext', () => ({
    useData: () => mockUseData()
}));

vi.mock('../../context/ToastContext', () => ({
    useToast: () => mockToast
}));

describe('OrganizationManager sharing step', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        const organizations = [
            { id: 2, name: 'Test Org Two', slug: 'test-org-two', isActive: true, memberCount: 2 },
            { id: 1, name: 'Test Org One', slug: 'test-org-one', isActive: true, memberCount: 3 }
        ];

        const sharingPickerData = {
            projects: [
                {
                    id: 'project-available',
                    title: 'External Project',
                    ownerOrgId: 1,
                    ownerOrgName: 'Test Org One',
                    linkedGoalCount: 1,
                    externalGoalLinkCount: 0,
                    tags: []
                },
                {
                    id: 'project-shared',
                    title: 'Shared Project',
                    ownerOrgId: 1,
                    ownerOrgName: 'Test Org One',
                    linkedGoalCount: 1,
                    externalGoalLinkCount: 0,
                    tags: []
                },
                {
                    id: 'project-owned',
                    title: 'Target Owned Project',
                    ownerOrgId: 2,
                    ownerOrgName: 'Test Org Two',
                    linkedGoalCount: 1,
                    externalGoalLinkCount: 0,
                    tags: []
                }
            ],
            goals: [
                {
                    id: 'goal-shared-root',
                    title: 'Shared Goal Tree',
                    type: 'enterprise',
                    parentId: null,
                    ownerOrgId: 1,
                    ownerOrgName: 'Test Org One'
                },
                {
                    id: 'goal-shared-child',
                    title: 'Shared Goal Child',
                    type: 'portfolio',
                    parentId: 'goal-shared-root',
                    ownerOrgId: 1,
                    ownerOrgName: 'Test Org One'
                },
                {
                    id: 'goal-available-root',
                    title: 'Available Goal Tree',
                    type: 'enterprise',
                    parentId: null,
                    ownerOrgId: 1,
                    ownerOrgName: 'Test Org One'
                },
                {
                    id: 'goal-owned-root',
                    title: 'Target Owned Goal Tree',
                    type: 'enterprise',
                    parentId: null,
                    ownerOrgId: 2,
                    ownerOrgName: 'Test Org Two'
                }
            ]
        };

        const sharingSummary = {
            projects: [
                {
                    projectId: 'project-shared',
                    projectTitle: 'Shared Project',
                    ownerOrgId: 1,
                    ownerOrgName: 'Test Org One',
                    accessLevel: 'read',
                    expiresAt: null,
                    goalContextStatus: 'complete',
                    goalContextMissing: false,
                    linkedGoalCount: 1,
                    linkedGoalsSharedCount: 1
                }
            ],
            goals: [
                {
                    goalId: 'goal-shared-child',
                    goalTitle: 'Shared Goal Child',
                    goalType: 'portfolio',
                    parentId: 'goal-shared-root',
                    ownerOrgId: 1,
                    ownerOrgName: 'Test Org One',
                    accessLevel: 'read',
                    expiresAt: null
                }
            ]
        };

        mockUseData.mockReturnValue({
            fetchOrganizations: vi.fn().mockResolvedValue(organizations),
            createOrganization: vi.fn(),
            updateOrganization: vi.fn(),
            assignUserToOrg: vi.fn(),
            unshareProject: vi.fn().mockResolvedValue({ success: true }),
            fetchOrgSharingSummary: vi.fn().mockResolvedValue(sharingSummary),
            bulkShareProjects: vi.fn().mockResolvedValue({ linkedGoalCount: 0 }),
            bulkUnshareProjects: vi.fn().mockResolvedValue({ success: true }),
            bulkShareGoals: vi.fn().mockResolvedValue({ success: true }),
            bulkUnshareGoals: vi.fn().mockResolvedValue({ success: true }),
            authFetch: vi.fn().mockImplementation(async (url) => {
                if (String(url).includes('/admin/sharing-picker-data')) {
                    return createJsonResponse(sharingPickerData);
                }
                throw new Error(`Unexpected authFetch call: ${url}`);
            }),
            currentUser: { organization: { name: 'Test Org One' } },
            hasPermission: (permission) => ['can_manage_organizations', 'can_manage_sharing_requests'].includes(permission)
        });
    });

    it('shows only actionable cross-org items and separates available from shared views', async () => {
        render(<OrganizationManager initialSection="sharing" />);

        await screen.findByText('External Project');

        expect(screen.getByText('External Project')).toBeInTheDocument();
        expect(screen.queryByText('Shared Project')).not.toBeInTheDocument();
        expect(screen.queryByText('Target Owned Project')).not.toBeInTheDocument();
        expect(screen.getByText('Owned by Test Org One')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Currently Shared (1)' }));

        await waitFor(() => {
            expect(screen.getByText('Shared Project')).toBeInTheDocument();
        });
        expect(screen.queryByText('External Project')).not.toBeInTheDocument();
        expect(screen.queryByText('Target Owned Project')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Goals (2)' }));

        await waitFor(() => {
            expect(screen.getByText('Available Goal Tree')).toBeInTheDocument();
        });
        expect(screen.queryByText('Shared Goal Tree')).not.toBeInTheDocument();
        expect(screen.queryByText('Target Owned Goal Tree')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Currently Shared (1)' }));

        await waitFor(() => {
            expect(screen.getByText('Shared Goal Tree')).toBeInTheDocument();
        });
        expect(screen.getByText('descendant share')).toBeInTheDocument();
        expect(screen.queryByText('Available Goal Tree')).not.toBeInTheDocument();
    });
});

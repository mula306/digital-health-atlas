import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditProjectForm } from '../../components/Kanban/EditProjectForm.jsx';

const mockUseData = vi.fn();
const mockToast = {
    success: vi.fn(),
    error: vi.fn()
};

vi.mock('../../context/DataContext', () => ({
    useData: () => mockUseData()
}));

vi.mock('../../context/ToastContext', () => ({
    useToast: () => mockToast
}));

vi.mock('../../components/UI/ProjectTagSelector.jsx', () => ({
    ProjectTagSelector: () => <div>Project Tag Selector</div>
}));

vi.mock('../../components/UI/CascadingGoalFilter.jsx', () => ({
    CascadingGoalFilter: () => <div>Goal Filter</div>
}));

describe('EditProjectForm ownership controls', () => {
    const updateProject = vi.fn().mockResolvedValue(true);
    const updateProjectTags = vi.fn().mockResolvedValue(true);
    const deleteProject = vi.fn();
    const onClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseData.mockReturnValue({
            updateProject,
            updateProjectTags,
            deleteProject,
            goals: [{ id: '9101', title: 'Goal One', type: 'enterprise' }],
            currentUser: { orgId: '1' },
            fetchOrganizations: vi.fn().mockResolvedValue([
                { id: 1, name: 'Test Org One' },
                { id: 2, name: 'Test Org Two' }
            ]),
            hasRole: (role) => role === 'Admin'
        });
    });

    it('lets admins update the owning organization when saving a project', async () => {
        const { container } = render(
            <EditProjectForm
                project={{
                    id: 'project-1',
                    title: 'Project One',
                    description: 'Existing description',
                    status: 'active',
                    goalIds: ['9101'],
                    orgId: '1',
                    tags: []
                }}
                onClose={onClose}
                canEditProject
                canDeleteProject={false}
            />
        );

        await screen.findByText(/Changing the owning organization moves default visibility/i);

        const selects = container.querySelectorAll('select');
        const orgSelect = selects[1];
        fireEvent.change(orgSelect, { target: { value: '2' } });

        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => {
            expect(updateProject).toHaveBeenCalledWith('project-1', expect.objectContaining({
                orgId: '2',
                title: 'Project One',
                status: 'active'
            }));
        });
        expect(updateProjectTags).toHaveBeenCalledWith('project-1', []);
        expect(onClose).toHaveBeenCalled();
    });
});

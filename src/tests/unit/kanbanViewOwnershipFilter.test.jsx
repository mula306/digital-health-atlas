import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KanbanView from '../../components/Kanban/KanbanView.jsx';

const mockUseData = vi.fn();

vi.mock('../../context/DataContext', () => ({
    useData: () => mockUseData()
}));

vi.mock('../../components/Kanban/KanbanBoard.jsx', () => ({
    KanbanBoard: () => <div>Kanban Board</div>
}));

vi.mock('../../components/UI/Modal.jsx', () => ({
    Modal: ({ isOpen, children }) => (isOpen ? <div>{children}</div> : null)
}));

vi.mock('../../components/Kanban/AddProjectForm.jsx', () => ({
    AddProjectForm: () => <div>Add Project Form</div>
}));

vi.mock('../../components/UI/CascadingGoalFilter', () => ({
    CascadingGoalFilter: () => <div>Goal Filter</div>
}));

vi.mock('../../components/UI/ProjectTagSelector.jsx', () => ({
    ProjectTagBadges: () => <div />
}));

describe('KanbanView ownership filtering', () => {
    beforeEach(() => {
        localStorage.clear();
        mockUseData.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps the current project list visible while ownership filters are loading, then swaps in filtered results', async () => {
        let resolveFetch;
        const authFetch = vi.fn().mockImplementation(() => new Promise((resolve) => {
            resolveFetch = resolve;
        }));

        mockUseData.mockReturnValue({
            projects: [
                {
                    id: 'project-owned',
                    title: 'Owned Alpha',
                    description: 'Owned project baseline',
                    goalIds: [],
                    tags: [],
                    completion: 0,
                    taskCount: 0,
                    tasks: [],
                    isWatched: false
                }
            ],
            goals: [],
            loadProjectDetails: vi.fn(),
            loading: false,
            loadMoreProjects: vi.fn(),
            projectsPagination: { page: 1, limit: 50, total: 1, totalPages: 1, hasMore: false },
            projectsError: null,
            loadingMore: false,
            authFetch,
            watchProject: vi.fn(),
            unwatchProject: vi.fn(),
            hasPermission: vi.fn().mockReturnValue(false),
            currentUser: { orgId: '1' },
            hasRole: vi.fn().mockReturnValue(false),
            tagGroups: []
        });

        const user = userEvent.setup();

        render(<KanbanView />);

        expect(screen.getByText('Owned Alpha')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /filters/i }));
        await user.click(screen.getByRole('button', { name: /shared projects/i }));

        await waitFor(() => {
            expect(authFetch).toHaveBeenCalledWith(expect.stringContaining('ownership=shared'));
        });
        expect(screen.getByText('Owned Alpha')).toBeInTheDocument();

        await act(async () => {
            resolveFetch({
                ok: true,
                json: async () => ({
                    projects: [
                        {
                            id: 'project-shared',
                            title: 'Shared Bravo',
                            description: 'Shared project result',
                            goalIds: [],
                            tags: [],
                            completion: 0,
                            taskCount: 0,
                            tasks: [],
                            isWatched: false
                        }
                    ],
                    pagination: { page: 1, limit: 100, total: 1, totalPages: 1, hasMore: false }
                })
            });
        });

        await waitFor(() => {
            expect(screen.getByText('Shared Bravo')).toBeInTheDocument();
        });
        expect(screen.queryByText('Owned Alpha')).not.toBeInTheDocument();
    });

    it('falls back to the current project list when an ownership-filter request fails', async () => {
        const authFetch = vi.fn().mockRejectedValue(new Error('boom'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        mockUseData.mockReturnValue({
            projects: [
                {
                    id: 'project-owned',
                    title: 'Owned Alpha',
                    description: 'Owned project baseline',
                    goalIds: [],
                    tags: [],
                    completion: 0,
                    taskCount: 0,
                    tasks: [],
                    isWatched: false
                }
            ],
            goals: [],
            loadProjectDetails: vi.fn(),
            loading: false,
            loadMoreProjects: vi.fn(),
            projectsPagination: { page: 1, limit: 50, total: 1, totalPages: 1, hasMore: false },
            projectsError: null,
            loadingMore: false,
            authFetch,
            watchProject: vi.fn(),
            unwatchProject: vi.fn(),
            hasPermission: vi.fn().mockReturnValue(false),
            currentUser: { orgId: '1' },
            hasRole: vi.fn().mockReturnValue(false),
            tagGroups: []
        });

        const user = userEvent.setup();

        render(<KanbanView />);

        await user.click(screen.getByRole('button', { name: /filters/i }));
        await user.click(screen.getByRole('button', { name: /owned projects/i }));

        await waitFor(() => {
            expect(authFetch).toHaveBeenCalledWith(expect.stringContaining('ownership=owner'));
        });

        await waitFor(() => {
            expect(screen.getByText('Unable to load filtered projects. Showing the current list instead.')).toBeInTheDocument();
        });
        expect(screen.getByText('Owned Alpha')).toBeInTheDocument();

        errorSpy.mockRestore();
    });

    it('explains when the user is missing an organization assignment', () => {
        mockUseData.mockReturnValue({
            projects: [],
            goals: [],
            loadProjectDetails: vi.fn(),
            loading: false,
            loadMoreProjects: vi.fn(),
            projectsPagination: { page: 1, limit: 50, total: 0, totalPages: 0, hasMore: false },
            projectsError: 'No organization assigned. Contact your administrator.',
            loadingMore: false,
            authFetch: vi.fn(),
            watchProject: vi.fn(),
            unwatchProject: vi.fn(),
            hasPermission: vi.fn((permission) => permission === 'can_view_projects'),
            currentUser: { orgId: null },
            hasRole: vi.fn().mockReturnValue(false),
            tagGroups: []
        });

        render(<KanbanView />);

        expect(screen.getByText('Organization Assignment Needed')).toBeInTheDocument();
        expect(screen.getByText(/ask an admin to assign you to an organization first/i)).toBeInTheDocument();
    });
});

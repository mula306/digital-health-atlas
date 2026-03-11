import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyWorkPage } from '../../components/MyWork/MyWorkPage.jsx';

const mockUseData = vi.fn();

vi.mock('../../context/DataContext', () => ({
    useData: () => mockUseData()
}));

const createPermissionChecker = (allowedPermissions) => {
    const set = new Set(allowedPermissions);
    return (permission) => set.has(permission);
};

describe('MyWorkPage', () => {
    beforeEach(() => {
        localStorage.clear();
        mockUseData.mockReset();
        mockUseData.mockReturnValue({
            currentUser: { oid: 'user-1' },
            projects: [
                {
                    id: 'p1',
                    title: 'Watched Project',
                    isWatched: true,
                    completion: 55,
                    tasks: [
                        { id: 't1', title: 'Assigned Task', status: 'todo', assigneeOid: 'user-1' }
                    ]
                }
            ],
            mySubmissions: [
                {
                    id: 's1',
                    formName: 'Intake Form',
                    status: 'pending',
                    submittedAt: new Date().toISOString()
                }
            ],
            hasPermission: createPermissionChecker([
                'can_view_projects',
                'can_view_intake',
                'can_view_governance_queue'
            ]),
            fetchIntakeGovernanceQueue: vi.fn().mockResolvedValue({
                items: [
                    {
                        id: 's2',
                        formName: 'Governance Submission',
                        governanceStatus: 'in-review',
                        submittedAt: new Date().toISOString()
                    }
                ]
            })
        });
    });

    it('renders key cards and metrics for watched projects, tasks, and submissions', async () => {
        render(<MyWorkPage onViewChange={() => { }} />);

        expect(screen.getByText('My Work Hub')).toBeInTheDocument();
        expect(screen.getAllByText('Watched Projects').length).toBeGreaterThan(0);
        expect(screen.getByText('Assigned Tasks')).toBeInTheDocument();
        expect(screen.getByText('My Intake Requests')).toBeInTheDocument();
        expect(screen.getByText('Governance Votes')).toBeInTheDocument();

        await waitFor(() => {
            expect(screen.getByText('Governance Submission')).toBeInTheDocument();
        });
    });

    it('navigates to intake my-requests with focused submission payload', async () => {
        const onViewChange = vi.fn();
        const user = userEvent.setup();
        render(<MyWorkPage onViewChange={onViewChange} />);

        const intakeButton = await screen.findByRole('button', { name: /Intake Form/i });
        await user.click(intakeButton);

        expect(onViewChange).toHaveBeenCalledWith('intake', { stage: 'my-requests' });
        const stored = JSON.parse(localStorage.getItem('dha_intake_focus_submission_payload'));
        expect(stored.submissionId).toBe('s1');
        expect(stored.stage).toBe('my-requests');
    });

    it('navigates to project view with focused task payload', async () => {
        const onViewChange = vi.fn();
        const user = userEvent.setup();
        render(<MyWorkPage onViewChange={onViewChange} />);

        const taskButton = screen.getByRole('button', { name: /Assigned Task/i });
        await user.click(taskButton);

        expect(onViewChange).toHaveBeenCalledWith('projects', {
            preserveSelectedProject: true,
            selectedProjectId: 'p1'
        });
        const stored = JSON.parse(localStorage.getItem('dha_project_focus_task_payload'));
        expect(stored.projectId).toBe('p1');
        expect(stored.taskId).toBe('t1');
    });
});

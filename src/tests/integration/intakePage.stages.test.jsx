import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntakePage } from '../../components/Intake/IntakePage.jsx';

const mockUseData = vi.fn();

vi.mock('../../context/DataContext', () => ({
    useData: () => mockUseData()
}));

vi.mock('../../components/Intake/IntakeRequestsList', () => ({
    IntakeRequestsList: () => <div>Intake Requests List</div>
}));

vi.mock('../../components/Intake/MySubmissionsList', () => ({
    MySubmissionsList: () => <div>My Submissions List</div>
}));

vi.mock('../../components/Intake/IntakeFormBuilder', () => ({
    IntakeFormBuilder: () => <div>Intake Form Builder</div>
}));

vi.mock('../../components/UI/Modal', () => ({
    Modal: ({ isOpen, title, children }) => (
        isOpen ? (
            <div>
                {title ? <h2>{title}</h2> : null}
                {children}
            </div>
        ) : null
    )
}));

const buildPermissionChecker = (keys = []) => {
    const allowed = new Set(keys);
    return (permission) => allowed.has(permission);
};

const baseContext = {
    intakeForms: [
        {
            id: 'f1',
            name: 'Form One',
            description: 'desc',
            fields: [{ id: 'field1' }],
            createdAt: new Date().toISOString(),
            governanceMode: 'required'
        }
    ],
    intakeSubmissions: [
        { id: 's1', status: 'pending', governanceRequired: true, governanceStatus: 'in-review', governanceDecision: null },
        { id: 's2', status: 'awaiting-response', governanceRequired: false, governanceStatus: 'not-started', governanceDecision: null }
    ],
    mySubmissions: [
        { id: 'mine1', status: 'pending', formName: 'Form One', submittedAt: new Date().toISOString() }
    ],
    deleteIntakeForm: vi.fn(),
    restoreIntakeForm: vi.fn()
};

describe('IntakePage stage navigation', () => {
    beforeEach(() => {
        mockUseData.mockReset();
    });

    it('renders guided 4-stage workflow and allows stage change', async () => {
        mockUseData.mockReturnValue({
            ...baseContext,
            hasPermission: buildPermissionChecker([
                'can_view_intake',
                'can_view_incoming_requests',
                'can_view_governance_queue',
                'can_manage_intake'
            ])
        });

        const onStageChange = vi.fn();
        const user = userEvent.setup();

        render(<IntakePage initialStage="triage" onStageChange={onStageChange} />);

        expect(screen.getByText('Submission')).toBeInTheDocument();
        expect(screen.getByText('Triage')).toBeInTheDocument();
        expect(screen.getByText('Governance')).toBeInTheDocument();
        expect(screen.getByText('Resolution')).toBeInTheDocument();

        const governanceLabel = screen.getByText('Governance');
        const governanceStep = governanceLabel.closest('button');
        expect(governanceStep).not.toBeNull();
        await user.click(governanceStep);

        expect(onStageChange).toHaveBeenCalledWith('governance');
    });

    it('marks governance stage not ready when permission is missing', () => {
        mockUseData.mockReturnValue({
            ...baseContext,
            hasPermission: buildPermissionChecker(['can_view_intake'])
        });

        render(<IntakePage initialStage="submit" onStageChange={() => { }} />);

        const governanceLabel = screen.getByText('Governance');
        const governanceStep = governanceLabel.closest('button');
        expect(governanceStep).not.toBeNull();
        expect(governanceStep).toBeDisabled();
        expect(screen.getAllByText('Not Ready').length).toBeGreaterThan(0);
    });

    it('uses a modal confirmation before retiring or archiving an intake form', async () => {
        const deleteIntakeForm = vi.fn().mockResolvedValue({});
        mockUseData.mockReturnValue({
            ...baseContext,
            deleteIntakeForm,
            hasPermission: buildPermissionChecker(['can_manage_intake_forms'])
        });

        const user = userEvent.setup();

        render(<IntakePage initialStage="form-admin" onStageChange={() => { }} />);

        await user.click(screen.getByTitle('Retire or Archive Form'));

        expect(deleteIntakeForm).not.toHaveBeenCalled();
        expect(screen.getByText('Archive Intake Form')).toBeInTheDocument();
        expect(screen.getByText('Archive Form One?')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Archive Form' }));

        expect(deleteIntakeForm).toHaveBeenCalledWith('f1');
    });
});

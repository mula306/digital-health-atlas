import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportsView } from '../../components/Reports/ReportsView.jsx';

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

vi.mock('../../components/Reports/ReportFilterTree.jsx', () => ({
    ReportFilterTree: () => <div>Report Filter Tree</div>
}));

vi.mock('../../components/Reports/ReportPreview.jsx', () => ({
    ReportPreview: () => <div>Report Preview</div>
}));

describe('ReportsView scheduler permissions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const buildDataContext = (enabledPermissions = []) => ({
        fetchExecSummaryProjects: vi.fn().mockResolvedValue([]),
        fetchExecutiveReportPacks: vi.fn().mockResolvedValue([]),
        createExecutiveReportPack: vi.fn().mockResolvedValue({}),
        updateExecutiveReportPack: vi.fn().mockResolvedValue({}),
        fetchExecutiveReportPackRuns: vi.fn().mockResolvedValue([]),
        runExecutiveReportPackNow: vi.fn().mockResolvedValue({}),
        fetchExecutivePackSchedulerStatus: vi.fn().mockResolvedValue({ dueCount: 0, running: false }),
        runDueExecutivePacks: vi.fn().mockResolvedValue({ results: [] }),
        goals: [],
        tagGroups: [],
        hasPermission: (permission) => enabledPermissions.includes(permission)
    });

    it('hides the run-due scheduler action without the scheduler permission', async () => {
        mockUseData.mockReturnValue(buildDataContext(['can_view_exec_packs']));

        render(<ReportsView />);

        await screen.findByText('Executive Packs');

        expect(screen.queryByRole('button', { name: 'Run Due Executive Packs' })).not.toBeInTheDocument();
    });

    it('shows the run-due scheduler action when the scheduler permission is granted', async () => {
        mockUseData.mockReturnValue(buildDataContext(['can_view_exec_packs', 'can_run_exec_pack_scheduler']));

        render(<ReportsView />);

        expect(await screen.findByRole('button', { name: 'Run Due Executive Packs' })).toBeInTheDocument();
    });
});

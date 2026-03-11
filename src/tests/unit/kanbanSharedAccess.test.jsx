import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KanbanBoard } from '../../components/Kanban/KanbanBoard.jsx';

const mockUseData = vi.fn();

vi.mock('../../context/DataContext', () => ({
    useData: () => mockUseData()
}));

vi.mock('../../components/Kanban/TaskTableView.jsx', () => ({
    TaskTableView: () => <div>Task Table</div>
}));

vi.mock('../../components/Kanban/KanbanColumn.jsx', () => ({
    KanbanColumn: () => <div>Kanban Column</div>
}));

vi.mock('../../components/Kanban/GanttView.jsx', () => ({
    GanttView: () => <div>Gantt View</div>
}));

vi.mock('../../components/Kanban/CalendarView.jsx', () => ({
    CalendarView: () => <div>Calendar View</div>
}));

vi.mock('../../components/StatusReport/StatusReportPage.jsx', () => ({
    StatusReportPage: () => <div>Status Reports</div>
}));

vi.mock('../../components/Kanban/ProjectBenefitsPanel.jsx', () => ({
    ProjectBenefitsPanel: () => <div>Benefits Panel</div>
}));

vi.mock('../../components/Kanban/TaskDetailPanel.jsx', () => ({
    TaskDetailPanel: () => null
}));

vi.mock('../../components/Kanban/ProjectActivityFeed.jsx', () => ({
    ProjectActivityFeed: () => <div>Activity Feed</div>
}));

vi.mock('../../components/UI/Modal.jsx', () => ({
    Modal: ({ isOpen, children, title }) => (isOpen ? <div aria-label={title}>{children}</div> : null)
}));

vi.mock('../../components/Kanban/AddTaskForm.jsx', () => ({
    AddTaskForm: () => <div>Add Task Form</div>
}));

vi.mock('../../components/Kanban/EditProjectForm.jsx', () => ({
    EditProjectForm: () => <div>Edit Project Form</div>
}));

describe('KanbanBoard shared project access', () => {
    beforeEach(() => {
        mockUseData.mockReset();
        mockUseData.mockReturnValue({
            watchProject: vi.fn(),
            unwatchProject: vi.fn(),
            fetchAssignableUsers: vi.fn().mockResolvedValue([]),
            currentUser: { oid: 'user-1' },
            hasPermission: (permission) => ['can_view_projects', 'can_edit_project', 'can_delete_project'].includes(permission)
        });
    });

    it('hides mutating controls for read-only shared projects even if the role can edit owned work', () => {
        render(
            <KanbanBoard
                project={{
                    id: 'p-shared',
                    title: 'Shared Project',
                    completion: 42,
                    tasks: [],
                    isWatched: false,
                    hasWriteAccess: false,
                    accessLevel: 'read'
                }}
                onBack={() => {}}
                goalTitle="Shared Goal"
            />
        );

        expect(screen.getByText('Read-only shared access')).toBeInTheDocument();
        expect(screen.queryByTitle('Edit Project')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'New Task' })).not.toBeInTheDocument();
    });
});

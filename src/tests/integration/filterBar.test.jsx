import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterBar } from '../../components/UI/FilterBar.jsx';

const mockUseData = vi.fn();

vi.mock('../../context/DataContext', () => ({
    useData: () => mockUseData()
}));

vi.mock('../../components/UI/CascadingGoalFilter', () => ({
    CascadingGoalFilter: ({ value, onChange }) => (
        <button type="button" onClick={() => onChange(value ? '' : 'goal-1')}>
            Goal Filter
        </button>
    )
}));

describe('FilterBar', () => {
    beforeEach(() => {
        mockUseData.mockReset();
        mockUseData.mockReturnValue({
            tagGroups: [
                {
                    id: 'group-1',
                    name: 'Domain',
                    tags: [
                        { id: '1', name: 'A', status: 'active', color: '#000000' },
                        { id: '2', name: 'B', status: 'active', color: '#111111' }
                    ]
                }
            ]
        });
    });

    it('clears all selected filter states when Clear All is clicked', async () => {
        const onGoalFilterChange = vi.fn();
        const onTagsChange = vi.fn();
        const onStatusesChange = vi.fn();
        const onWatchedOnlyChange = vi.fn();
        const user = userEvent.setup();

        render(
            <FilterBar
                goalFilter="goal-1"
                onGoalFilterChange={onGoalFilterChange}
                selectedTags={['1']}
                onTagsChange={onTagsChange}
                selectedStatuses={['active']}
                onStatusesChange={onStatusesChange}
                statusOptions={[{ id: 'active', label: 'Active' }]}
                watchedOnly
                onWatchedOnlyChange={onWatchedOnlyChange}
                countLabel="1 project(s)"
            />
        );

        const clearButton = screen.getByRole('button', { name: /Clear All/i });
        await user.click(clearButton);

        expect(onGoalFilterChange).toHaveBeenCalledWith('');
        expect(onTagsChange).toHaveBeenCalledWith([]);
        expect(onStatusesChange).toHaveBeenCalledWith([]);
        expect(onWatchedOnlyChange).toHaveBeenCalledWith(false);
    });
});


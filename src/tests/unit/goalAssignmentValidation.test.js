import { describe, it, expect } from 'vitest';
import { validateGoalAssignment } from '../../utils/goalAssignmentValidation.js';

const goals = [
    { id: '1', title: 'Root A', parentId: null },
    { id: '2', title: 'A Child 1', parentId: '1' },
    { id: '3', title: 'A Child 2', parentId: '1' },
    { id: '10', title: 'Root B', parentId: null },
    { id: '11', title: 'B Child 1', parentId: '10' }
];

describe('validateGoalAssignment', () => {
    it('allows one goal per hierarchy root', () => {
        const result = validateGoalAssignment(goals, ['2', '11']);
        expect(result.valid).toBe(true);
    });

    it('rejects sibling goals in the same hierarchy', () => {
        const result = validateGoalAssignment(goals, ['2', '3']);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/same goal hierarchy/i);
    });

    it('rejects ancestor and descendant pair', () => {
        const result = validateGoalAssignment(goals, ['1', '2']);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/same goal hierarchy/i);
    });
});


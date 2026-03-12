import { describe, expect, it } from 'vitest';
import {
    GOAL_LEVELS,
    GOAL_ROOT_TYPE,
    getAllowedGoalTypes,
    getGoalTypeLabel,
    getNextGoalType,
    isValidChildGoalType
} from '../../../shared/goalLevels.js';

describe('goal levels', () => {
    it('defines the enterprise cascade in order', () => {
        expect(GOAL_LEVELS.map((level) => level.code)).toEqual([
            'enterprise',
            'portfolio',
            'service',
            'team'
        ]);
        expect(GOAL_ROOT_TYPE).toBe('enterprise');
    });

    it('returns only the next allowed child type for each level', () => {
        expect(getAllowedGoalTypes()).toEqual(['enterprise']);
        expect(getAllowedGoalTypes({ parentType: 'enterprise' })).toEqual(['portfolio']);
        expect(getAllowedGoalTypes({ parentType: 'portfolio' })).toEqual(['service']);
        expect(getAllowedGoalTypes({ parentType: 'service' })).toEqual(['team']);
        expect(getAllowedGoalTypes({ parentType: 'team' })).toEqual([]);
        expect(getNextGoalType('portfolio')).toBe('service');
    });

    it('maps labels and child validation to the new taxonomy', () => {
        expect(getGoalTypeLabel('enterprise')).toBe('Enterprise');
        expect(getGoalTypeLabel('team')).toBe('Team');
        expect(isValidChildGoalType('enterprise', 'portfolio')).toBe(true);
        expect(isValidChildGoalType('portfolio', 'team')).toBe(false);
    });
});

import { describe, expect, it } from 'vitest';
import {
    DATA_CLASSIFICATIONS,
    DATA_LIFECYCLE_POLICY,
    GOAL_LIFECYCLE_STATES,
    INTAKE_FORM_LIFECYCLE_STATES,
    LIFECYCLE_VIEW_MODES,
    PROJECT_LIFECYCLE_STATES,
    RETENTION_WINDOWS,
    getGoalLifecycleViewStates,
    getIntakeFormLifecycleViewStates,
    getProjectLifecycleViewStates,
    normalizeGoalLifecycleState,
    normalizeIntakeFormLifecycleState,
    normalizeLifecycleView,
    normalizeProjectLifecycleState
} from '../../../shared/dataLifecyclePolicy.js';

describe('data lifecycle policy', () => {
    it('defines the expected classifications and default windows', () => {
        expect(DATA_CLASSIFICATIONS.RESTRICTED).toBe('restricted');
        expect(DATA_LIFECYCLE_POLICY.classifications.projects).toBe(DATA_CLASSIFICATIONS.CONFIDENTIAL);
        expect(DATA_LIFECYCLE_POLICY.classifications.executive_report_pack_runs).toBe(DATA_CLASSIFICATIONS.OPERATIONAL_EPHEMERA);
        expect(RETENTION_WINDOWS.projectArchiveCompletedMonths).toBe(12);
        expect(RETENTION_WINDOWS.auditHotRetentionMonths).toBe(36);
    });

    it('normalizes lifecycle states to safe defaults', () => {
        expect(normalizeLifecycleView('ARCHIVED')).toBe(LIFECYCLE_VIEW_MODES.ARCHIVED);
        expect(normalizeLifecycleView('unexpected')).toBe(LIFECYCLE_VIEW_MODES.ACTIVE);

        expect(normalizeProjectLifecycleState('completed')).toBe(PROJECT_LIFECYCLE_STATES.COMPLETED);
        expect(normalizeProjectLifecycleState('bad')).toBe(PROJECT_LIFECYCLE_STATES.ACTIVE);

        expect(normalizeGoalLifecycleState('retired')).toBe(GOAL_LIFECYCLE_STATES.RETIRED);
        expect(normalizeGoalLifecycleState('bad')).toBe(GOAL_LIFECYCLE_STATES.ACTIVE);

        expect(normalizeIntakeFormLifecycleState('draft')).toBe(INTAKE_FORM_LIFECYCLE_STATES.DRAFT);
        expect(normalizeIntakeFormLifecycleState('bad')).toBe(INTAKE_FORM_LIFECYCLE_STATES.ACTIVE);
    });

    it('maps active, archived, and all view modes to the right lifecycle states', () => {
        expect(getProjectLifecycleViewStates('active')).toEqual(['active', 'completed']);
        expect(getProjectLifecycleViewStates('archived')).toEqual(['archived']);
        expect(getProjectLifecycleViewStates('all')).toEqual(['active', 'completed', 'archived']);

        expect(getGoalLifecycleViewStates('active')).toEqual(['active']);
        expect(getGoalLifecycleViewStates('archived')).toEqual(['retired', 'archived']);
        expect(getGoalLifecycleViewStates('all')).toEqual(['active', 'retired', 'archived']);

        expect(getIntakeFormLifecycleViewStates('active')).toEqual(['active']);
        expect(getIntakeFormLifecycleViewStates('archived')).toEqual(['retired', 'archived']);
        expect(getIntakeFormLifecycleViewStates('all')).toEqual(['draft', 'active', 'retired', 'archived']);
    });
});

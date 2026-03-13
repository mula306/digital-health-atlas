import { sql } from '../db.js';
import {
    DATA_CLASSIFICATIONS,
    GOAL_LIFECYCLE_STATES,
    INTAKE_FORM_LIFECYCLE_STATES,
    LIFECYCLE_VIEW_MODES,
    PROJECT_LIFECYCLE_STATES,
    getGoalLifecycleViewStates,
    getIntakeFormLifecycleViewStates,
    getProjectLifecycleViewStates,
    normalizeGoalLifecycleState,
    normalizeIntakeFormLifecycleState,
    normalizeLifecycleView,
    normalizeProjectLifecycleState
} from '../../shared/dataLifecyclePolicy.js';

export {
    DATA_CLASSIFICATIONS,
    GOAL_LIFECYCLE_STATES,
    INTAKE_FORM_LIFECYCLE_STATES,
    LIFECYCLE_VIEW_MODES,
    PROJECT_LIFECYCLE_STATES,
    getGoalLifecycleViewStates,
    getIntakeFormLifecycleViewStates,
    getProjectLifecycleViewStates,
    normalizeGoalLifecycleState,
    normalizeIntakeFormLifecycleState,
    normalizeLifecycleView,
    normalizeProjectLifecycleState
};

export const ACTIVE_PROJECT_LIFECYCLE_STATES = Object.freeze(getProjectLifecycleViewStates(LIFECYCLE_VIEW_MODES.ACTIVE));
export const ACTIVE_GOAL_LIFECYCLE_STATES = Object.freeze(getGoalLifecycleViewStates(LIFECYCLE_VIEW_MODES.ACTIVE));
export const ACTIVE_INTAKE_FORM_LIFECYCLE_STATES = Object.freeze(getIntakeFormLifecycleViewStates(LIFECYCLE_VIEW_MODES.ACTIVE));

export const buildLifecycleInClause = (prefix, values = []) => {
    const unique = [...new Set((values || []).map((value) => String(value).trim().toLowerCase()).filter(Boolean))];
    if (unique.length === 0) {
        return {
            text: 'NULL',
            params: {}
        };
    }
    const params = {};
    const text = unique.map((value, index) => {
        const key = `${prefix}${index}`;
        params[key] = value;
        return `@${key}`;
    }).join(', ');
    return { text, params };
};

export const addLifecycleParams = (request, params = {}) => {
    Object.entries(params).forEach(([key, value]) => {
        request.input(key, sql.NVarChar(30), value);
    });
};

export const deriveProjectLifecycleFromStatus = ({ currentLifecycleState, status, completedAt }) => {
    const normalizedCurrent = normalizeProjectLifecycleState(currentLifecycleState);
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (normalizedCurrent === PROJECT_LIFECYCLE_STATES.ARCHIVED) {
        return {
            lifecycleState: PROJECT_LIFECYCLE_STATES.ARCHIVED,
            completedAt: completedAt || null
        };
    }
    if (normalizedStatus === 'completed') {
        return {
            lifecycleState: PROJECT_LIFECYCLE_STATES.COMPLETED,
            completedAt: completedAt || new Date()
        };
    }
    return {
        lifecycleState: PROJECT_LIFECYCLE_STATES.ACTIVE,
        completedAt: normalizedCurrent === PROJECT_LIFECYCLE_STATES.COMPLETED ? null : (completedAt || null)
    };
};

export const getProjectRestoreLifecycleState = (status) => {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    return normalizedStatus === 'completed'
        ? PROJECT_LIFECYCLE_STATES.COMPLETED
        : PROJECT_LIFECYCLE_STATES.ACTIVE;
};

export const touchProjectActivity = async (dbOrTx, projectId, when = new Date()) => {
    if (!projectId) return;
    await dbOrTx.request()
        .input('projectId', sql.Int, Number(projectId))
        .input('lastActivityAt', sql.DateTime2, when)
        .query(`
            UPDATE Projects
            SET lastActivityAt = CASE
                WHEN lastActivityAt IS NULL OR lastActivityAt < @lastActivityAt THEN @lastActivityAt
                ELSE lastActivityAt
            END
            WHERE id = @projectId
        `);
};

export const touchGoalActivity = async (dbOrTx, goalIds = [], when = new Date()) => {
    const normalizedIds = [...new Set((goalIds || [])
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value)))];
    if (normalizedIds.length === 0) return;

    const request = dbOrTx.request().input('lastActivityAt', sql.DateTime2, when);
    const placeholders = normalizedIds.map((goalId, index) => {
        const key = `goalId${index}`;
        request.input(key, sql.Int, goalId);
        return `@${key}`;
    }).join(', ');

    await request.query(`
        UPDATE Goals
        SET lastActivityAt = CASE
            WHEN lastActivityAt IS NULL OR lastActivityAt < @lastActivityAt THEN @lastActivityAt
            ELSE lastActivityAt
        END
        WHERE id IN (${placeholders})
    `);
};

export const touchGoalActivityForProject = async (dbOrTx, projectId, when = new Date()) => {
    if (!projectId) return;
    const result = await dbOrTx.request()
        .input('projectId', sql.Int, Number(projectId))
        .query(`
            SELECT goalId
            FROM ProjectGoals
            WHERE projectId = @projectId
            UNION
            SELECT goalId
            FROM Projects
            WHERE id = @projectId AND goalId IS NOT NULL
        `);
    await touchGoalActivity(dbOrTx, result.recordset.map((row) => row.goalId), when);
};

export const isProjectLifecycleReadOnly = (lifecycleState) => normalizeProjectLifecycleState(lifecycleState) === PROJECT_LIFECYCLE_STATES.ARCHIVED;

export const isGoalLifecycleReadOnly = (lifecycleState) => {
    const normalized = normalizeGoalLifecycleState(lifecycleState);
    return normalized === GOAL_LIFECYCLE_STATES.RETIRED || normalized === GOAL_LIFECYCLE_STATES.ARCHIVED;
};

export const isIntakeFormLifecycleReadOnly = (lifecycleState) => {
    const normalized = normalizeIntakeFormLifecycleState(lifecycleState);
    return normalized === INTAKE_FORM_LIFECYCLE_STATES.RETIRED || normalized === INTAKE_FORM_LIFECYCLE_STATES.ARCHIVED;
};

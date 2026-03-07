import { getPool } from '../db.js';

/**
 * Walk a goal up to its root (no parent), returning the chain of IDs.
 * @param {Array} allGoals - flat array of {id, parentId}
 * @param {number|string} goalId
 * @returns {number[]} chain from goalId up to root, inclusive
 */
export function getAncestorChain(allGoals, goalId) {
    const chain = [];
    const byId = new Map(allGoals.map(g => [String(g.id), g]));
    let current = byId.get(String(goalId));
    while (current) {
        chain.push(Number(current.id));
        current = current.parentId ? byId.get(String(current.parentId)) : null;
    }
    return chain;
}

/**
 * Get the root ancestor of a goal.
 */
export function getRootGoalId(allGoals, goalId) {
    const chain = getAncestorChain(allGoals, goalId);
    return chain.length > 0 ? chain[chain.length - 1] : null;
}

/**
 * Get all descendant IDs of a goal (recursive children).
 */
export function getDescendantIds(allGoals, goalId) {
    const descendants = [];
    const id = Number(goalId);
    const children = allGoals.filter(g => Number(g.parentId) === id);
    for (const child of children) {
        descendants.push(Number(child.id));
        descendants.push(...getDescendantIds(allGoals, child.id));
    }
    return descendants;
}

/**
 * Validate that a set of goalIds does not contain two goals
 * from the same hierarchy (i.e. one is an ancestor/descendant of another).
 *
 * Rule: for any pair (A, B) in goalIds, A must NOT be an ancestor or
 * descendant of B.
 *
 * @param {Array} allGoals - flat array of {id, parentId}
 * @param {number[]} goalIds - the goals to validate
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateGoalAssignment(allGoals, goalIds) {
    if (!goalIds || goalIds.length <= 1) return { valid: true };

    const ids = goalIds.map(Number);
    const rootToGoal = new Map();

    // Rule: only one goal per root hierarchy (siblings included)
    for (const id of ids) {
        const rootId = getRootGoalId(allGoals, id);
        if (rootId === null) continue;
        if (rootToGoal.has(rootId)) {
            const existingGoalId = rootToGoal.get(rootId);
            const existingGoal = allGoals.find(g => Number(g.id) === existingGoalId);
            const currentGoal = allGoals.find(g => Number(g.id) === id);
            return {
                valid: false,
                error: `"${existingGoal?.title}" and "${currentGoal?.title}" are in the same goal hierarchy. A project can only be assigned to one goal per hierarchy.`
            };
        }
        rootToGoal.set(rootId, id);
    }

    for (let i = 0; i < ids.length; i++) {
        const chainA = new Set(getAncestorChain(allGoals, ids[i]));
        const descendantsA = new Set(getDescendantIds(allGoals, ids[i]));

        for (let j = i + 1; j < ids.length; j++) {
            // B is an ancestor of A  (B appears in A's ancestor chain)
            if (chainA.has(ids[j])) {
                const goalA = allGoals.find(g => Number(g.id) === ids[i]);
                const goalB = allGoals.find(g => Number(g.id) === ids[j]);
                return {
                    valid: false,
                    error: `"${goalA?.title}" and "${goalB?.title}" are in the same goal hierarchy. A project can only be assigned to one goal per hierarchy.`
                };
            }
            // B is a descendant of A
            if (descendantsA.has(ids[j])) {
                const goalA = allGoals.find(g => Number(g.id) === ids[i]);
                const goalB = allGoals.find(g => Number(g.id) === ids[j]);
                return {
                    valid: false,
                    error: `"${goalA?.title}" and "${goalB?.title}" are in the same goal hierarchy. A project can only be assigned to one goal per hierarchy.`
                };
            }
        }
    }

    return { valid: true };
}

/**
 * Load all goals (lightweight: id, parentId, title) from DB.
 */
export async function loadGoalsForValidation() {
    const pool = await getPool();
    const result = await pool.request().query('SELECT id, parentId, title FROM Goals');
    return result.recordset;
}

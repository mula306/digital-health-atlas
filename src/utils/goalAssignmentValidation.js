const toNumber = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
};

const buildGoalMap = (goals) => {
    const byId = new Map();
    goals.forEach((goal) => {
        const id = toNumber(goal.id);
        if (id !== null) {
            byId.set(id, goal);
        }
    });
    return byId;
};

const getAncestorChain = (goalsById, goalId) => {
    const chain = [];
    let current = goalsById.get(goalId);
    while (current) {
        const id = toNumber(current.id);
        if (id === null) break;
        chain.push(id);
        const parentId = toNumber(current.parentId);
        current = parentId === null ? null : goalsById.get(parentId);
    }
    return chain;
};

const getRootGoalId = (goalsById, goalId) => {
    const chain = getAncestorChain(goalsById, goalId);
    return chain.length > 0 ? chain[chain.length - 1] : null;
};

const getDescendantIds = (goals, goalId) => {
    const descendants = [];
    const parent = toNumber(goalId);
    if (parent === null) return descendants;

    const children = goals.filter((goal) => toNumber(goal.parentId) === parent);
    children.forEach((child) => {
        const childId = toNumber(child.id);
        if (childId === null) return;
        descendants.push(childId);
        descendants.push(...getDescendantIds(goals, childId));
    });
    return descendants;
};

export function validateGoalAssignment(goals, goalIds) {
    const ids = goalIds.map(toNumber).filter((id) => id !== null);
    if (ids.length <= 1) {
        return { valid: true };
    }

    const goalsById = buildGoalMap(goals);
    const rootToGoal = new Map();

    // Rule: only one goal per root hierarchy (siblings included)
    for (const id of ids) {
        const rootId = getRootGoalId(goalsById, id);
        if (rootId === null) continue;
        if (rootToGoal.has(rootId)) {
            const existingGoalId = rootToGoal.get(rootId);
            const existingGoal = goalsById.get(existingGoalId);
            const currentGoal = goalsById.get(id);
            return {
                valid: false,
                error: `"${existingGoal?.title || existingGoalId}" and "${currentGoal?.title || id}" are in the same goal hierarchy. A project can only be assigned to one goal per hierarchy.`
            };
        }
        rootToGoal.set(rootId, id);
    }

    for (let i = 0; i < ids.length; i += 1) {
        const currentId = ids[i];
        const currentGoal = goalsById.get(currentId);
        const ancestorSet = new Set(getAncestorChain(goalsById, currentId));
        const descendantSet = new Set(getDescendantIds(goals, currentId));

        for (let j = i + 1; j < ids.length; j += 1) {
            const candidateId = ids[j];
            if (ancestorSet.has(candidateId) || descendantSet.has(candidateId)) {
                const candidateGoal = goalsById.get(candidateId);
                return {
                    valid: false,
                    error: `"${currentGoal?.title || currentId}" and "${candidateGoal?.title || candidateId}" are in the same goal hierarchy. A project can only be assigned to one goal per hierarchy.`
                };
            }
        }
    }

    return { valid: true };
}


/**
 * Recursively find all descendant goal IDs for a given parent goal ID.
 * @param {Array} goals - List of all goals
 * @param {string|number} parentId - The ID of the parent goal
 * @returns {Array} List of descendant goal IDs
 */
export const getDescendantGoalIds = (goals, parentId) => {
    let descendants = [];
    // Loose equality to handle potential string/number mismatch
    const children = goals.filter(g => g.parentId == parentId);
    children.forEach(child => {
        descendants.push(child.id);
        descendants = [...descendants, ...getDescendantGoalIds(goals, child.id)];
    });
    return descendants;
};

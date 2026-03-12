import { GOAL_LEVELS, getGoalTypeLabel } from '../../shared/goalLevels.js';

export const buildGoalMap = (goals = []) => new Map(
    (Array.isArray(goals) ? goals : [])
        .filter((goal) => goal && goal.id !== undefined && goal.id !== null)
        .map((goal) => [String(goal.id), goal])
);

export const buildGoalPath = (goalsById, goalOrId) => {
    const path = [];
    let current = goalOrId && typeof goalOrId === 'object'
        ? goalOrId
        : goalsById.get(String(goalOrId));
    const visited = new Set();

    while (current && !visited.has(String(current.id))) {
        visited.add(String(current.id));
        path.unshift(current);
        if (!current.parentId) break;
        current = goalsById.get(String(current.parentId));
    }

    return path;
};

export const getGoalPath = (goals = [], goalOrId) => buildGoalPath(buildGoalMap(goals), goalOrId);

export const getGoalAtLevel = (goals = [], goalOrId, levelCode, options = {}) => {
    const { fallbackToDeepest = false } = options;
    const path = getGoalPath(goals, goalOrId);
    const levelIndex = GOAL_LEVELS.findIndex((level) => level.code === levelCode);
    if (levelIndex < 0) return null;
    if (path[levelIndex]) return path[levelIndex];
    return fallbackToDeepest ? path[path.length - 1] || null : null;
};

export const getGoalHierarchy = (goals = [], goalOrId) => {
    const hierarchy = Object.fromEntries(GOAL_LEVELS.map((level) => [level.code, '-']));
    const path = getGoalPath(goals, goalOrId);

    path.forEach((goal, index) => {
        const level = GOAL_LEVELS[index];
        if (level) {
            hierarchy[level.code] = goal.title || '-';
        }
    });

    return hierarchy;
};

export const formatGoalOptionLabel = (goal) => {
    if (!goal) return '';
    return `${goal.title} (${getGoalTypeLabel(goal.type)})`;
};

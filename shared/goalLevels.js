export const LEGACY_GOAL_TYPE_MAP = Object.freeze({
    org: 'enterprise',
    div: 'portfolio',
    dept: 'service',
    branch: 'team'
});

export const GOAL_LEVELS = Object.freeze([
    {
        code: 'enterprise',
        label: 'Enterprise',
        pluralLabel: 'Enterprises',
        goalLabel: 'Enterprise Goal'
    },
    {
        code: 'portfolio',
        label: 'Portfolio',
        pluralLabel: 'Portfolios',
        goalLabel: 'Portfolio Goal'
    },
    {
        code: 'service',
        label: 'Service',
        pluralLabel: 'Services',
        goalLabel: 'Service Goal'
    },
    {
        code: 'team',
        label: 'Team',
        pluralLabel: 'Teams',
        goalLabel: 'Team Goal'
    }
]);

export const GOAL_LEVEL_CODES = Object.freeze(GOAL_LEVELS.map((level) => level.code));
export const GOAL_ROOT_TYPE = GOAL_LEVELS[0].code;
export const GOAL_LEAF_TYPE = GOAL_LEVELS[GOAL_LEVELS.length - 1].code;

const GOAL_LEVEL_INDEX = Object.freeze(
    Object.fromEntries(GOAL_LEVELS.map((level, index) => [level.code, index]))
);

export const GOAL_LEVEL_LABELS = Object.freeze(
    Object.fromEntries(GOAL_LEVELS.map((level) => [level.code, level.label]))
);

export const GOAL_CHILD_TYPE_BY_PARENT = Object.freeze(
    Object.fromEntries(
        GOAL_LEVELS.map((level, index) => [level.code, GOAL_LEVELS[index + 1]?.code || null])
    )
);

export const GOAL_PARENT_TYPE_BY_CHILD = Object.freeze(
    Object.fromEntries(
        GOAL_LEVELS
            .map((level, index) => [level.code, GOAL_LEVELS[index - 1]?.code || null])
    )
);

export const normalizeGoalType = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return GOAL_LEVEL_CODES.includes(normalized) ? normalized : '';
};

export const migrateLegacyGoalType = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return LEGACY_GOAL_TYPE_MAP[normalized] || normalized;
};

export const isValidGoalType = (value) => normalizeGoalType(value) !== '';

export const getGoalTypeIndex = (value) => {
    const normalized = normalizeGoalType(value);
    return normalized ? GOAL_LEVEL_INDEX[normalized] : -1;
};

export const getGoalLevelDefinition = (value) => {
    const normalized = normalizeGoalType(value);
    return GOAL_LEVELS.find((level) => level.code === normalized) || null;
};

export const getGoalTypeLabel = (value) => getGoalLevelDefinition(value)?.label || 'Goal';

export const getGoalTypeGoalLabel = (value) => getGoalLevelDefinition(value)?.goalLabel || 'Goal';

export const getNextGoalType = (value) => {
    const normalized = normalizeGoalType(value);
    return normalized ? GOAL_CHILD_TYPE_BY_PARENT[normalized] || null : null;
};

export const getParentGoalType = (value) => {
    const normalized = normalizeGoalType(value);
    return normalized ? GOAL_PARENT_TYPE_BY_CHILD[normalized] || null : null;
};

export const canGoalTypeHaveChildren = (value) => getNextGoalType(value) !== null;

export const isValidRootGoalType = (value) => normalizeGoalType(value) === GOAL_ROOT_TYPE;

export const isValidChildGoalType = (parentType, childType) => {
    const normalizedParent = normalizeGoalType(parentType);
    const normalizedChild = normalizeGoalType(childType);
    return !!normalizedParent && !!normalizedChild && GOAL_CHILD_TYPE_BY_PARENT[normalizedParent] === normalizedChild;
};

export const getAllowedGoalTypes = ({ parentType = null } = {}) => {
    const normalizedParent = normalizeGoalType(parentType);
    if (!normalizedParent) {
        return [GOAL_ROOT_TYPE];
    }

    const childType = GOAL_CHILD_TYPE_BY_PARENT[normalizedParent];
    return childType ? [childType] : [];
};

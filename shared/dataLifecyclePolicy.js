export const DATA_CLASSIFICATIONS = Object.freeze({
    RESTRICTED: 'restricted',
    CONFIDENTIAL: 'confidential',
    INTERNAL: 'internal',
    OPERATIONAL_EPHEMERA: 'operational_ephemera'
});

export const PROJECT_LIFECYCLE_STATES = Object.freeze({
    ACTIVE: 'active',
    COMPLETED: 'completed',
    ARCHIVED: 'archived'
});

export const GOAL_LIFECYCLE_STATES = Object.freeze({
    ACTIVE: 'active',
    RETIRED: 'retired',
    ARCHIVED: 'archived'
});

export const INTAKE_FORM_LIFECYCLE_STATES = Object.freeze({
    DRAFT: 'draft',
    ACTIVE: 'active',
    RETIRED: 'retired',
    ARCHIVED: 'archived'
});

export const PROJECT_LIFECYCLE_VALUES = Object.freeze(Object.values(PROJECT_LIFECYCLE_STATES));
export const GOAL_LIFECYCLE_VALUES = Object.freeze(Object.values(GOAL_LIFECYCLE_STATES));
export const INTAKE_FORM_LIFECYCLE_VALUES = Object.freeze(Object.values(INTAKE_FORM_LIFECYCLE_STATES));

export const LIFECYCLE_VIEW_MODES = Object.freeze({
    ACTIVE: 'active',
    ARCHIVED: 'archived',
    ALL: 'all'
});

export const LIFECYCLE_VIEW_VALUES = Object.freeze(Object.values(LIFECYCLE_VIEW_MODES));

export const RETENTION_WINDOWS = Object.freeze({
    projectArchiveCompletedMonths: 12,
    projectArchiveOnHoldMonths: 18,
    goalRetireMonths: 24,
    goalArchiveMonths: 24,
    intakeHistoryYears: 7,
    statusReportFullRetentionMonths: 24,
    executiveRunSuccessMonths: 18,
    executiveRunFailureMonths: 24,
    auditHotRetentionMonths: 36,
    sharingHistoryMonths: 24
});

export const DATA_LIFECYCLE_POLICY = Object.freeze({
    classifications: Object.freeze({
        users: DATA_CLASSIFICATIONS.RESTRICTED,
        intake_submissions: DATA_CLASSIFICATIONS.RESTRICTED,
        governance_reviews: DATA_CLASSIFICATIONS.RESTRICTED,
        governance_votes: DATA_CLASSIFICATIONS.RESTRICTED,
        audit_log: DATA_CLASSIFICATIONS.RESTRICTED,
        projects: DATA_CLASSIFICATIONS.CONFIDENTIAL,
        goals: DATA_CLASSIFICATIONS.CONFIDENTIAL,
        kpis: DATA_CLASSIFICATIONS.CONFIDENTIAL,
        status_reports: DATA_CLASSIFICATIONS.CONFIDENTIAL,
        project_benefits: DATA_CLASSIFICATIONS.CONFIDENTIAL,
        org_sharing_requests: DATA_CLASSIFICATIONS.CONFIDENTIAL,
        organizations: DATA_CLASSIFICATIONS.INTERNAL,
        tags: DATA_CLASSIFICATIONS.INTERNAL,
        governance_boards: DATA_CLASSIFICATIONS.INTERNAL,
        workflow_sla_policy: DATA_CLASSIFICATIONS.INTERNAL,
        executive_report_packs: DATA_CLASSIFICATIONS.INTERNAL,
        executive_report_pack_runs: DATA_CLASSIFICATIONS.OPERATIONAL_EPHEMERA,
        project_org_access: DATA_CLASSIFICATIONS.OPERATIONAL_EPHEMERA,
        goal_org_access: DATA_CLASSIFICATIONS.OPERATIONAL_EPHEMERA
    }),
    retentionWindows: RETENTION_WINDOWS
});

const normalizeValue = (value) => String(value || '').trim().toLowerCase();

export const normalizeLifecycleView = (value) => {
    const normalized = normalizeValue(value) || LIFECYCLE_VIEW_MODES.ACTIVE;
    return LIFECYCLE_VIEW_VALUES.includes(normalized) ? normalized : LIFECYCLE_VIEW_MODES.ACTIVE;
};

export const normalizeProjectLifecycleState = (value) => {
    const normalized = normalizeValue(value) || PROJECT_LIFECYCLE_STATES.ACTIVE;
    return PROJECT_LIFECYCLE_VALUES.includes(normalized) ? normalized : PROJECT_LIFECYCLE_STATES.ACTIVE;
};

export const normalizeGoalLifecycleState = (value) => {
    const normalized = normalizeValue(value) || GOAL_LIFECYCLE_STATES.ACTIVE;
    return GOAL_LIFECYCLE_VALUES.includes(normalized) ? normalized : GOAL_LIFECYCLE_STATES.ACTIVE;
};

export const normalizeIntakeFormLifecycleState = (value) => {
    const normalized = normalizeValue(value) || INTAKE_FORM_LIFECYCLE_STATES.ACTIVE;
    return INTAKE_FORM_LIFECYCLE_VALUES.includes(normalized) ? normalized : INTAKE_FORM_LIFECYCLE_STATES.ACTIVE;
};

export const isArchivedProjectLifecycleState = (value) => normalizeProjectLifecycleState(value) === PROJECT_LIFECYCLE_STATES.ARCHIVED;
export const isArchivedGoalLifecycleState = (value) => {
    const normalized = normalizeGoalLifecycleState(value);
    return normalized === GOAL_LIFECYCLE_STATES.RETIRED || normalized === GOAL_LIFECYCLE_STATES.ARCHIVED;
};
export const isArchivedIntakeFormLifecycleState = (value) => {
    const normalized = normalizeIntakeFormLifecycleState(value);
    return normalized === INTAKE_FORM_LIFECYCLE_STATES.RETIRED || normalized === INTAKE_FORM_LIFECYCLE_STATES.ARCHIVED;
};

export const getProjectLifecycleViewStates = (view = LIFECYCLE_VIEW_MODES.ACTIVE) => {
    const normalized = normalizeLifecycleView(view);
    if (normalized === LIFECYCLE_VIEW_MODES.ARCHIVED) return [PROJECT_LIFECYCLE_STATES.ARCHIVED];
    if (normalized === LIFECYCLE_VIEW_MODES.ALL) return [...PROJECT_LIFECYCLE_VALUES];
    return [PROJECT_LIFECYCLE_STATES.ACTIVE, PROJECT_LIFECYCLE_STATES.COMPLETED];
};

export const getGoalLifecycleViewStates = (view = LIFECYCLE_VIEW_MODES.ACTIVE) => {
    const normalized = normalizeLifecycleView(view);
    if (normalized === LIFECYCLE_VIEW_MODES.ARCHIVED) return [GOAL_LIFECYCLE_STATES.RETIRED, GOAL_LIFECYCLE_STATES.ARCHIVED];
    if (normalized === LIFECYCLE_VIEW_MODES.ALL) return [...GOAL_LIFECYCLE_VALUES];
    return [GOAL_LIFECYCLE_STATES.ACTIVE];
};

export const getIntakeFormLifecycleViewStates = (view = LIFECYCLE_VIEW_MODES.ACTIVE) => {
    const normalized = normalizeLifecycleView(view);
    if (normalized === LIFECYCLE_VIEW_MODES.ARCHIVED) return [INTAKE_FORM_LIFECYCLE_STATES.RETIRED, INTAKE_FORM_LIFECYCLE_STATES.ARCHIVED];
    if (normalized === LIFECYCLE_VIEW_MODES.ALL) return [...INTAKE_FORM_LIFECYCLE_VALUES];
    return [INTAKE_FORM_LIFECYCLE_STATES.ACTIVE];
};

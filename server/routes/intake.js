import express from 'express';
import { getPool, sql } from '../db.js';
import { checkPermission, requireAuth, getAuthUser, hasPermission } from '../middleware/authMiddleware.js';
import {
    intakeSubmissionCreateLimiter,
    governanceRoutingLimiter,
    governanceVoteLimiter,
    governanceDecisionLimiter,
    intakeConversationLimiter
} from '../middleware/rateLimiters.js';
import { handleError } from '../utils/errorHandler.js';
import { logAudit } from '../utils/auditLogger.js';
import { addParams, buildInClause } from '../utils/sqlHelpers.js';
import {
    ensureRequiredIntakeFields,
    getIntakeSystemField,
    INTAKE_SYSTEM_FIELD_KEYS
} from '../../shared/intakeSystemFields.js';
import { findGoalAccessGapsForOrg, ensureReadGoalAccessForOrg } from '../utils/goalAccess.js';
import { ensureOrganizationExists, isAdminUser, parseOptionalOrgId, resolveOwnedOrgId } from '../utils/orgOwnership.js';
import { validateGoalAssignment, loadGoalsForValidation } from '../utils/goalValidation.js';

const router = express.Router();

const TASK_STATUSES = new Set(['todo', 'in-progress', 'blocked', 'review', 'done']);
const TASK_PRIORITIES = new Set(['low', 'medium', 'high']);

const parseJsonOrFallback = (rawValue, fallback) => {
    try {
        if (rawValue === undefined || rawValue === null || rawValue === '') return fallback;
        return JSON.parse(rawValue);
    } catch {
        return fallback;
    }
};

const mapIntakeFormRow = (form) => ({
    id: form.id.toString(),
    name: form.name,
    description: form.description,
    fields: parseJsonOrFallback(form.fields, []),
    defaultGoalId: form.defaultGoalId ? form.defaultGoalId.toString() : null,
    governanceMode: normalizeGovernanceMode(form.governanceMode, 'off'),
    governanceBoardId: form.governanceBoardId ? form.governanceBoardId.toString() : null,
    orgId: form.orgId === null || form.orgId === undefined ? null : String(form.orgId),
    createdAt: form.createdAt
});

const mapSubmissionRow = (sub) => {
    const storedData = parseJsonOrFallback(sub.infoRequests, []);
    const isConversationFormat = storedData.length > 0 && storedData[0]?.type;

    return {
        id: sub.id.toString(),
        formId: sub.formId.toString(),
        formData: parseJsonOrFallback(sub.formData, {}),
        status: sub.status,
        governanceRequired: !!sub.governanceRequired,
        governanceStatus: sub.governanceStatus || 'not-started',
        governanceDecision: sub.governanceDecision || null,
        governanceReason: sub.governanceReason || null,
        priorityScore: sub.priorityScore === null || sub.priorityScore === undefined ? null : Number(sub.priorityScore),
        conversation: isConversationFormat ? storedData : [],
        convertedProjectId: sub.convertedProjectId ? sub.convertedProjectId.toString() : null,
        submittedAt: sub.submittedAt,
        submitterName: sub.submitterName || null,
        submitterEmail: sub.submitterEmail || null,
        submitterId: sub.submitterId || null,
        orgId: sub.orgId === null || sub.orgId === undefined ? null : String(sub.orgId)
    };
};

const requireScopedOrgId = (user, message = 'No organization assigned. Contact your administrator.') => {
    if (isAdminUser(user)) return null;
    const orgId = parseOptionalOrgId(user?.orgId);
    if (!Number.isFinite(orgId)) {
        throw new Error(message);
    }
    return orgId;
};

const hasMatchingOrgScope = (userOrgId, resourceOrgId) => (
    Number.isFinite(userOrgId) &&
    Number.isFinite(resourceOrgId) &&
    userOrgId === resourceOrgId
);

const hasActiveBoardMembership = async ({ pool, boardId, userOid }) => {
    const parsedBoardId = parseOptionalOrgId(boardId);
    if (!Number.isFinite(parsedBoardId) || !userOid) return false;

    const result = await pool.request()
        .input('boardId', sql.Int, parsedBoardId)
        .input('userOid', sql.NVarChar(100), userOid)
        .query(`
            SELECT TOP 1 id
            FROM GovernanceMembership
            WHERE boardId = @boardId
              AND userOid = @userOid
              AND isActive = 1
              AND effectiveFrom <= GETDATE()
              AND (effectiveTo IS NULL OR effectiveTo > GETDATE())
        `);

    return result.recordset.length > 0;
};

const buildGovernanceSubmissionScope = async ({ pool, user, submission }) => {
    const viewerOrgId = parseOptionalOrgId(user?.orgId);
    const submissionOrgId = parseOptionalOrgId(submission?.orgId);
    const boardOrgId = parseOptionalOrgId(submission?.boardOrgId);
    const governanceBoardId = parseOptionalOrgId(submission?.governanceBoardId);

    const scope = {
        isOwner: submission?.submitterId === user?.oid,
        sameSubmissionOrg: hasMatchingOrgScope(viewerOrgId, submissionOrgId),
        sameBoardOrg: hasMatchingOrgScope(viewerOrgId, boardOrgId),
        hasActiveBoardMembership: false
    };

    if (!isAdminUser(user)) {
        scope.hasActiveBoardMembership = await hasActiveBoardMembership({
            pool,
            boardId: governanceBoardId,
            userOid: user?.oid
        });
    }

    return scope;
};

const hasGovernanceSubmissionScope = (scope, { allowOwner = false } = {}) => {
    if (allowOwner && scope.isOwner) return true;
    return scope.sameSubmissionOrg || scope.sameBoardOrg || scope.hasActiveBoardMembership;
};

const normalizeConversionGoalIds = (projectData = {}) => {
    const goalIds = Array.isArray(projectData?.goalIds)
        ? projectData.goalIds
        : (projectData?.goalId !== undefined && projectData?.goalId !== null && projectData?.goalId !== ''
            ? [projectData.goalId]
            : []);

    const normalized = [...new Set(goalIds
        .map((goalId) => Number.parseInt(goalId, 10))
        .filter((goalId) => !Number.isNaN(goalId)))];

    return normalized;
};

const normalizeKickoffTasks = (tasks = []) => (
    (Array.isArray(tasks) ? tasks : [])
        .filter((task) => task && String(task.title || '').trim())
        .map((task) => {
            const status = TASK_STATUSES.has(String(task.status || '').trim().toLowerCase())
                ? String(task.status).trim().toLowerCase()
                : 'todo';
            const priority = TASK_PRIORITIES.has(String(task.priority || '').trim().toLowerCase())
                ? String(task.priority).trim().toLowerCase()
                : 'medium';
            const normalizeDate = (value) => {
                if (!value) return null;
                const parsed = new Date(value);
                if (Number.isNaN(parsed.getTime())) return null;
                return parsed.toISOString().slice(0, 10);
            };

            return {
                title: String(task.title || '').trim(),
                description: String(task.description || '').trim(),
                status,
                priority,
                startDate: normalizeDate(task.startDate),
                endDate: normalizeDate(task.endDate)
            };
        })
);

const appendConversionContext = (description, conversionContext) => {
    const normalizedDescription = String(description || '').trim();
    const normalizedContext = String(conversionContext || '').trim();
    return [normalizedDescription, normalizedContext].filter(Boolean).join('\n\n');
};

const resolveSubmissionSystemValue = ({ formFields, formData, key }) => {
    const field = getIntakeSystemField(formFields, key);
    if (!field) return '';
    return String(formData?.[field.id] || '').trim();
};

const canManageIntakeSubmissions = async (user) => {
    if (!user) return false;
    return hasPermission(user, ['can_manage_intake', 'can_manage_governance']);
};

const canRouteGovernanceSubmission = async (user) => {
    if (!user) return false;
    return canManageIntakeSubmissions(user);
};

const hasGovernanceSchema = async (pool) => {
    try {
        const result = await pool.request().query(`
            SELECT
                CASE WHEN OBJECT_ID('GovernanceSettings', 'U') IS NOT NULL THEN 1 ELSE 0 END AS hasSettings,
                CASE WHEN COL_LENGTH('IntakeForms', 'governanceMode') IS NOT NULL THEN 1 ELSE 0 END AS hasFormMode,
                CASE WHEN COL_LENGTH('IntakeSubmissions', 'governanceRequired') IS NOT NULL THEN 1 ELSE 0 END AS hasSubmissionGovernance
        `);
        const row = result.recordset[0] || {};
        return !!(row.hasSettings && row.hasFormMode && row.hasSubmissionGovernance);
    } catch {
        return false;
    }
};

const hasGovernancePhase1Schema = async (pool) => {
    try {
        const result = await pool.request().query(`
            SELECT
                CASE WHEN OBJECT_ID('GovernanceReview', 'U') IS NOT NULL THEN 1 ELSE 0 END AS hasReview,
                CASE WHEN OBJECT_ID('GovernanceReviewParticipant', 'U') IS NOT NULL THEN 1 ELSE 0 END AS hasReviewParticipant,
                CASE WHEN OBJECT_ID('GovernanceVote', 'U') IS NOT NULL THEN 1 ELSE 0 END AS hasVote
        `);
        const row = result.recordset[0] || {};
        return !!(row.hasReview && row.hasReviewParticipant && row.hasVote);
    } catch {
        return false;
    }
};

const hasGovernancePhase3Schema = async (pool) => {
    try {
        const result = await pool.request().query(`
            SELECT
                CASE WHEN COL_LENGTH('GovernanceSettings', 'quorumPercent') IS NOT NULL THEN 1 ELSE 0 END AS hasQuorumPercent,
                CASE WHEN COL_LENGTH('GovernanceSettings', 'quorumMinCount') IS NOT NULL THEN 1 ELSE 0 END AS hasQuorumMinCount,
                CASE WHEN COL_LENGTH('GovernanceSettings', 'decisionRequiresQuorum') IS NOT NULL THEN 1 ELSE 0 END AS hasDecisionRequiresQuorum,
                CASE WHEN COL_LENGTH('GovernanceSettings', 'voteWindowDays') IS NOT NULL THEN 1 ELSE 0 END AS hasVoteWindowDays,
                CASE WHEN COL_LENGTH('GovernanceReview', 'policySnapshotJson') IS NOT NULL THEN 1 ELSE 0 END AS hasPolicySnapshot,
                CASE WHEN COL_LENGTH('GovernanceReview', 'voteDeadlineAt') IS NOT NULL THEN 1 ELSE 0 END AS hasVoteDeadline
        `);
        const row = result.recordset[0] || {};
        return !!(
            row.hasQuorumPercent &&
            row.hasQuorumMinCount &&
            row.hasDecisionRequiresQuorum &&
            row.hasVoteWindowDays &&
            row.hasPolicySnapshot &&
            row.hasVoteDeadline
        );
    } catch {
        return false;
    }
};

const hasGovernanceBoardPolicySchema = async (pool) => {
    try {
        const result = await pool.request().query(`
            SELECT
                CASE WHEN COL_LENGTH('GovernanceBoard', 'quorumPercentOverride') IS NOT NULL THEN 1 ELSE 0 END AS hasQuorumPercentOverride,
                CASE WHEN COL_LENGTH('GovernanceBoard', 'quorumMinCountOverride') IS NOT NULL THEN 1 ELSE 0 END AS hasQuorumMinCountOverride,
                CASE WHEN COL_LENGTH('GovernanceBoard', 'decisionRequiresQuorumOverride') IS NOT NULL THEN 1 ELSE 0 END AS hasDecisionRequiresQuorumOverride,
                CASE WHEN COL_LENGTH('GovernanceBoard', 'voteWindowDaysOverride') IS NOT NULL THEN 1 ELSE 0 END AS hasVoteWindowDaysOverride
        `);
        const row = result.recordset[0] || {};
        return !!(
            row.hasQuorumPercentOverride &&
            row.hasQuorumMinCountOverride &&
            row.hasDecisionRequiresQuorumOverride &&
            row.hasVoteWindowDaysOverride
        );
    } catch {
        return false;
    }
};

const hasGovernanceCapacitySchema = async (pool) => {
    try {
        const result = await pool.request().query(`
            SELECT
                CASE WHEN COL_LENGTH('GovernanceBoard', 'weeklyCapacityHours') IS NOT NULL THEN 1 ELSE 0 END AS hasWeeklyCapacityHours,
                CASE WHEN COL_LENGTH('GovernanceBoard', 'wipLimit') IS NOT NULL THEN 1 ELSE 0 END AS hasWipLimit,
                CASE WHEN COL_LENGTH('GovernanceBoard', 'defaultSubmissionEffortHours') IS NOT NULL THEN 1 ELSE 0 END AS hasDefaultSubmissionEffortHours,
                CASE WHEN COL_LENGTH('IntakeSubmissions', 'estimatedEffortHours') IS NOT NULL THEN 1 ELSE 0 END AS hasEstimatedEffortHours
        `);
        const row = result.recordset[0] || {};
        return !!(
            row.hasWeeklyCapacityHours &&
            row.hasWipLimit &&
            row.hasDefaultSubmissionEffortHours &&
            row.hasEstimatedEffortHours
        );
    } catch {
        return false;
    }
};

const toFiniteNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const DEFAULT_GOVERNANCE_POLICY = Object.freeze({
    quorumPercent: 60,
    quorumMinCount: 1,
    decisionRequiresQuorum: true,
    voteWindowDays: null
});

const normalizeGovernancePolicy = (policy) => {
    const rawPercent = Number(policy?.quorumPercent);
    const rawMinCount = Number(policy?.quorumMinCount);
    const rawWindowDays = policy?.voteWindowDays === null || policy?.voteWindowDays === undefined || policy?.voteWindowDays === ''
        ? null
        : Number(policy.voteWindowDays);
    const percent = Number.isFinite(rawPercent) ? Math.min(100, Math.max(1, Math.trunc(rawPercent))) : DEFAULT_GOVERNANCE_POLICY.quorumPercent;
    const minCount = Number.isFinite(rawMinCount) ? Math.max(1, Math.trunc(rawMinCount)) : DEFAULT_GOVERNANCE_POLICY.quorumMinCount;
    let voteWindowDays = null;
    if (rawWindowDays !== null && Number.isFinite(rawWindowDays)) {
        voteWindowDays = Math.min(90, Math.max(1, Math.trunc(rawWindowDays)));
    }
    const decisionRequiresQuorum = policy?.decisionRequiresQuorum === undefined
        ? DEFAULT_GOVERNANCE_POLICY.decisionRequiresQuorum
        : !!policy.decisionRequiresQuorum;
    return {
        quorumPercent: percent,
        quorumMinCount: minCount,
        decisionRequiresQuorum,
        voteWindowDays
    };
};

const parsePolicySnapshot = (policySnapshotJson) => {
    if (!policySnapshotJson) return null;
    try {
        const parsed = JSON.parse(policySnapshotJson);
        return normalizeGovernancePolicy(parsed);
    } catch {
        return null;
    }
};

const calculateRequiredVotes = (eligibleVoterCount, policy) => {
    if (!Number.isFinite(eligibleVoterCount) || eligibleVoterCount <= 0) return 0;
    const byPercent = Math.ceil((eligibleVoterCount * policy.quorumPercent) / 100);
    return Math.max(policy.quorumMinCount, byPercent);
};

const normalizeCriteriaSnapshot = (criteriaJson) => {
    let parsed = [];
    try {
        parsed = JSON.parse(criteriaJson || '[]');
    } catch {
        parsed = [];
    }

    if (!Array.isArray(parsed)) return [];

    return parsed.map((c, idx) => ({
        id: String(c?.id || `criterion-${idx + 1}`),
        name: String(c?.name || `Criterion ${idx + 1}`),
        weight: toFiniteNumber(c?.weight) ?? 0,
        enabled: c?.enabled !== false,
        sortOrder: Number.isInteger(c?.sortOrder) ? c.sortOrder : idx + 1
    }));
};

const validateVoteScores = (scores, criteria) => {
    if (!scores || typeof scores !== 'object' || Array.isArray(scores)) {
        throw new Error('scores must be an object keyed by criterion id');
    }

    const enabledCriteria = criteria.filter(c => c.enabled);
    if (enabledCriteria.length === 0) {
        throw new Error('No enabled criteria available for this review');
    }

    const normalizedScores = {};
    for (const criterion of enabledCriteria) {
        const value = toFiniteNumber(scores[criterion.id]);
        if (value === null) {
            throw new Error(`Missing score for criterion '${criterion.id}'`);
        }
        if (value < 1 || value > 5) {
            throw new Error(`Score for criterion '${criterion.id}' must be between 1 and 5`);
        }
        normalizedScores[criterion.id] = value;
    }

    return normalizedScores;
};

const calculatePriorityScore = (criteria, votes) => {
    const enabledCriteria = criteria.filter(c => c.enabled);
    if (enabledCriteria.length === 0) {
        return { priorityScore: null, voteCount: votes.length, weightedTotal: null };
    }
    if (votes.length === 0) {
        return { priorityScore: null, voteCount: 0, weightedTotal: 0 };
    }

    let weightedTotal = 0;
    let totalWeight = 0;

    for (const criterion of enabledCriteria) {
        const criterionScores = votes
            .map(v => toFiniteNumber(v?.scores?.[criterion.id]))
            .filter(v => v !== null);
        if (criterionScores.length === 0) continue;

        const avg = criterionScores.reduce((sum, val) => sum + val, 0) / criterionScores.length;
        weightedTotal += avg * criterion.weight;
        totalWeight += criterion.weight;
    }

    if (totalWeight <= 0) {
        return { priorityScore: null, voteCount: votes.length, weightedTotal };
    }

    const normalized100 = (weightedTotal / (totalWeight * 5)) * 100;
    const rounded = Math.round(normalized100 * 100) / 100;
    return { priorityScore: rounded, voteCount: votes.length, weightedTotal };
};

const resolveGovernanceDefaults = async (pool, formId) => {
    const schemaReady = await hasGovernanceSchema(pool);
    if (!schemaReady) {
        return {
            schemaReady: false,
            governanceEnabled: false,
            governanceMode: 'off',
            governanceRequired: false,
            governanceStatus: 'skipped',
            governanceReason: 'Governance schema not installed. Using legacy intake flow.'
        };
    }

    const settingsResult = await pool.request().query('SELECT TOP 1 governanceEnabled FROM GovernanceSettings ORDER BY id');
    const governanceEnabled = settingsResult.recordset[0] ? !!settingsResult.recordset[0].governanceEnabled : false;

    const formResult = await pool.request()
        .input('formId', sql.Int, formId)
        .query('SELECT * FROM IntakeForms WHERE id = @formId');

    const governanceMode = (formResult.recordset[0]?.governanceMode || 'off').toLowerCase();
    const governanceRequired = governanceEnabled && governanceMode === 'required';

    return {
        schemaReady: true,
        governanceEnabled,
        governanceMode,
        governanceRequired,
        governanceStatus: governanceRequired ? 'not-started' : 'skipped',
        governanceReason: governanceRequired
            ? 'Governance required by intake form policy.'
            : 'Governance not required for this submission.'
    };
};

const fetchGovernancePolicySettings = async (pool, boardId = null) => {
    const phase3Ready = await hasGovernancePhase3Schema(pool);
    if (!phase3Ready) return { ...DEFAULT_GOVERNANCE_POLICY };
    const settingsResult = await pool.request().query(`
        SELECT TOP 1 quorumPercent, quorumMinCount, decisionRequiresQuorum, voteWindowDays
        FROM GovernanceSettings
        ORDER BY id
    `);
    const globalDefaults = normalizeGovernancePolicy(settingsResult.recordset[0] || {});

    const parsedBoardId = Number(boardId);
    if (!Number.isFinite(parsedBoardId)) {
        return globalDefaults;
    }

    const boardPolicyReady = await hasGovernanceBoardPolicySchema(pool);
    if (!boardPolicyReady) {
        return globalDefaults;
    }

    const boardResult = await pool.request()
        .input('boardId', sql.Int, Math.trunc(parsedBoardId))
        .query(`
            SELECT TOP 1
                quorumPercentOverride,
                quorumMinCountOverride,
                decisionRequiresQuorumOverride,
                voteWindowDaysOverride
            FROM GovernanceBoard
            WHERE id = @boardId
        `);
    if (boardResult.recordset.length === 0) {
        return globalDefaults;
    }

    const board = boardResult.recordset[0];
    return normalizeGovernancePolicy({
        quorumPercent: board.quorumPercentOverride === null ? globalDefaults.quorumPercent : board.quorumPercentOverride,
        quorumMinCount: board.quorumMinCountOverride === null ? globalDefaults.quorumMinCount : board.quorumMinCountOverride,
        decisionRequiresQuorum: board.decisionRequiresQuorumOverride === null ? globalDefaults.decisionRequiresQuorum : !!board.decisionRequiresQuorumOverride,
        voteWindowDays: board.voteWindowDaysOverride === null ? globalDefaults.voteWindowDays : board.voteWindowDaysOverride
    });
};

const normalizeGovernanceMode = (value, fallback = 'off') => {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'off' || normalized === 'optional' || normalized === 'required') {
        return normalized;
    }
    return fallback;
};

const DEFAULT_WORKFLOW_SLA_POLICIES = Object.freeze({
    triage: {
        stageKey: 'triage',
        displayName: 'Triage',
        targetHours: 72,
        warningHours: 48,
        escalationHours: 96
    },
    governance: {
        stageKey: 'governance',
        displayName: 'Governance Review',
        targetHours: 120,
        warningHours: 96,
        escalationHours: 144
    },
    resolution: {
        stageKey: 'resolution',
        displayName: 'Resolution',
        targetHours: 48,
        warningHours: 36,
        escalationHours: 72
    }
});

const normalizeSlaPolicy = (stageKey, policy = {}) => {
    const defaults = DEFAULT_WORKFLOW_SLA_POLICIES[stageKey] || DEFAULT_WORKFLOW_SLA_POLICIES.triage;
    const targetHours = Number.isFinite(Number(policy.targetHours))
        ? Math.max(1, Math.trunc(Number(policy.targetHours)))
        : defaults.targetHours;
    const warningHoursRaw = Number.isFinite(Number(policy.warningHours))
        ? Math.trunc(Number(policy.warningHours))
        : defaults.warningHours;
    const warningHours = Math.max(0, Math.min(targetHours, warningHoursRaw));
    const escalationHoursRaw = Number.isFinite(Number(policy.escalationHours))
        ? Math.trunc(Number(policy.escalationHours))
        : defaults.escalationHours;
    const escalationHours = Math.max(warningHours, escalationHoursRaw);

    return {
        stageKey,
        displayName: typeof policy.displayName === 'string' && policy.displayName.trim()
            ? policy.displayName.trim()
            : defaults.displayName,
        targetHours,
        warningHours,
        escalationHours
    };
};

const hasWorkflowSlaSchema = async (pool) => {
    try {
        const result = await pool.request().query(`
            SELECT
                CASE WHEN OBJECT_ID('WorkflowSlaPolicy', 'U') IS NOT NULL THEN 1 ELSE 0 END AS hasWorkflowSlaPolicy,
                CASE WHEN COL_LENGTH('IntakeSubmissions', 'lastSlaNudgedAt') IS NOT NULL THEN 1 ELSE 0 END AS hasLastSlaNudgedAt,
                CASE WHEN COL_LENGTH('IntakeSubmissions', 'lastSlaNudgedByOid') IS NOT NULL THEN 1 ELSE 0 END AS hasLastSlaNudgedByOid
        `);
        const row = result.recordset[0] || {};
        return !!(row.hasWorkflowSlaPolicy && row.hasLastSlaNudgedAt && row.hasLastSlaNudgedByOid);
    } catch {
        return false;
    }
};

const fetchWorkflowSlaPolicies = async (pool) => {
    const policies = {
        triage: { ...DEFAULT_WORKFLOW_SLA_POLICIES.triage },
        governance: { ...DEFAULT_WORKFLOW_SLA_POLICIES.governance },
        resolution: { ...DEFAULT_WORKFLOW_SLA_POLICIES.resolution }
    };

    if (!(await hasWorkflowSlaSchema(pool))) {
        return policies;
    }

    const result = await pool.request().query(`
        SELECT stageKey, displayName, targetHours, warningHours, escalationHours, isActive
        FROM WorkflowSlaPolicy
        WHERE isActive = 1
    `);

    for (const row of result.recordset) {
        const stageKey = String(row.stageKey || '').trim().toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(policies, stageKey)) continue;
        policies[stageKey] = normalizeSlaPolicy(stageKey, row);
    }

    return policies;
};

const parseDateOrNull = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
};

const getSubmissionWorkflowStage = (submission) => {
    const status = String(submission?.status || '').toLowerCase();
    const governanceRequired = !!submission?.governanceRequired;
    const governanceStatus = String(submission?.governanceStatus || '').toLowerCase();

    if (status === 'approved' || status === 'rejected') return null;
    if (governanceRequired && governanceStatus !== 'decided' && governanceStatus !== 'skipped') {
        return 'governance';
    }
    if (governanceRequired && governanceStatus === 'decided') {
        return 'resolution';
    }
    return 'triage';
};

const getSubmissionSlaAnchor = (submission, reviewStartedAt = null, reviewDecidedAt = null) => {
    const stage = getSubmissionWorkflowStage(submission);
    if (!stage) return null;

    if (stage === 'governance') {
        return reviewStartedAt || parseDateOrNull(submission?.submittedAt);
    }
    if (stage === 'resolution') {
        return reviewDecidedAt || reviewStartedAt || parseDateOrNull(submission?.submittedAt);
    }
    return parseDateOrNull(submission?.submittedAt);
};

const buildSlaSnapshot = ({ stageKey, startedAt, policies }) => {
    if (!stageKey || !startedAt || !policies?.[stageKey]) return null;
    const policy = policies[stageKey];
    const now = Date.now();
    const elapsedMs = Math.max(0, now - startedAt.getTime());
    const elapsedHours = Math.round((elapsedMs / 3600000) * 100) / 100;
    const remainingHours = Math.round((policy.targetHours - elapsedHours) * 100) / 100;
    const escalationInHours = Math.round((policy.escalationHours - elapsedHours) * 100) / 100;
    const isBreached = elapsedHours > policy.targetHours;
    const isWarning = !isBreached && elapsedHours >= policy.warningHours;
    const isEscalationDue = elapsedHours >= policy.escalationHours;

    return {
        stageKey,
        displayName: policy.displayName,
        startedAt: startedAt.toISOString(),
        elapsedHours,
        targetHours: policy.targetHours,
        warningHours: policy.warningHours,
        escalationHours: policy.escalationHours,
        remainingHours,
        escalationInHours,
        isBreached,
        isWarning,
        isEscalationDue,
        urgency: isEscalationDue ? 'escalate' : isBreached ? 'breach' : isWarning ? 'warning' : 'normal'
    };
};

const parseNullableBoardId = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
};

// ==================== INTAKE FORMS ====================

// Get all intake forms
router.get('/forms', requireAuth, async (req, res) => {
    try {
        const user = getAuthUser(req);
        const canViewForms = await hasPermission(user, [
            'can_view_intake',
            'can_view_incoming_requests',
            'can_view_governance_queue',
            'can_manage_intake_forms',
            'can_manage_intake'
        ]);
        if (!canViewForms) return res.status(403).json({ error: 'Forbidden' });

        const pool = await getPool();
        let result;
        if (isAdminUser(user)) {
            result = await pool.request().query('SELECT * FROM IntakeForms ORDER BY id');
        } else {
            const viewerOrgId = requireScopedOrgId(user, 'No organization assigned. Contact your administrator to view intake forms.');
            result = await pool.request()
                .input('orgId', sql.Int, viewerOrgId)
                .query('SELECT * FROM IntakeForms WHERE orgId = @orgId ORDER BY id');
        }

        res.json(result.recordset.map(mapIntakeFormRow));
    } catch (err) {
        if (err?.message?.toLowerCase().includes('no organization assigned')) {
            return res.status(403).json({ error: err.message });
        }
        handleError(res, 'fetching intake forms', err);
    }
});

// Create intake form
router.post('/forms', checkPermission('can_manage_intake_forms'), async (req, res) => {
    try {
        const { name, description, fields, defaultGoalId, governanceMode, governanceBoardId } = req.body;
        const normalizedFields = ensureRequiredIntakeFields(fields);
        const pool = await getPool();
        let ownerOrgId;
        try {
            ownerOrgId = resolveOwnedOrgId({
                user: req.user,
                requestedOrgId: req.body?.orgId,
                missingUserOrgMessage: 'No organization assigned. Contact your administrator to create intake forms.',
                adminOrgRequiredMessage: 'orgId is required for admin-created intake forms'
            });
            await ensureOrganizationExists(pool, ownerOrgId);
        } catch (orgErr) {
            const message = orgErr?.message || 'Unable to resolve intake form organization';
            const statusCode = message.toLowerCase().includes('no organization assigned') ? 403 : 400;
            return res.status(statusCode).json({ error: message });
        }
        const schemaReady = await hasGovernanceSchema(pool);
        const normalizedMode = normalizeGovernanceMode(governanceMode, 'off');
        let parsedBoardId = parseNullableBoardId(governanceBoardId);
        const parsedDefaultGoalId = defaultGoalId === undefined || defaultGoalId === null || defaultGoalId === ''
            ? null
            : Number.parseInt(defaultGoalId, 10);

        if (defaultGoalId !== undefined && defaultGoalId !== null && defaultGoalId !== '' && Number.isNaN(parsedDefaultGoalId)) {
            return res.status(400).json({ error: 'defaultGoalId must be a valid goal id' });
        }

        if (schemaReady && normalizedMode !== 'off' && parsedBoardId === null) {
            return res.status(400).json({ error: 'governanceBoardId is required when governanceMode is optional or required' });
        }

        if (schemaReady && parsedBoardId !== null) {
            const boardExists = await pool.request()
                .input('id', sql.Int, parsedBoardId)
                .query('SELECT TOP 1 id FROM GovernanceBoard WHERE id = @id');
            if (boardExists.recordset.length === 0) {
                return res.status(400).json({ error: 'Invalid governanceBoardId' });
            }
        }

        if (!schemaReady) {
            parsedBoardId = null;
        }

        const defaultGoalAccessGaps = await findGoalAccessGapsForOrg({
            dbOrTx: pool,
            goalIds: parsedDefaultGoalId === null ? [] : [parsedDefaultGoalId],
            orgId: ownerOrgId
        });
        if (defaultGoalAccessGaps.length > 0) {
            return res.status(409).json({
                error: `Selected default goal is not visible to the form organization: ${defaultGoalAccessGaps[0].title}`
            });
        }

        const request = pool.request()
            .input('name', sql.NVarChar, name)
            .input('description', sql.NVarChar, description)
            .input('fields', sql.NVarChar, JSON.stringify(normalizedFields))
            .input('defaultGoalId', sql.Int, parsedDefaultGoalId)
            .input('orgId', sql.Int, ownerOrgId);

        let result;
        if (schemaReady) {
            request
                .input('governanceMode', sql.NVarChar(20), normalizedMode)
                .input('governanceBoardId', sql.Int, parsedBoardId);
            result = await request.query(`
                INSERT INTO IntakeForms (name, description, fields, defaultGoalId, governanceMode, governanceBoardId, orgId)
                OUTPUT INSERTED.id, INSERTED.createdAt
                VALUES (@name, @description, @fields, @defaultGoalId, @governanceMode, @governanceBoardId, @orgId)
            `);
        } else {
            result = await request.query(`
                INSERT INTO IntakeForms (name, description, fields, defaultGoalId, orgId)
                OUTPUT INSERTED.id, INSERTED.createdAt
                VALUES (@name, @description, @fields, @defaultGoalId, @orgId)
            `);
        }

        const newId = result.recordset[0].id.toString();
        logAudit({
            action: 'intake_form.create',
            entityType: 'intake_form',
            entityId: newId,
            entityTitle: name,
            user: getAuthUser(req),
            after: {
                name,
                description,
                defaultGoalId: parsedDefaultGoalId,
                orgId: ownerOrgId,
                governanceMode: schemaReady ? normalizedMode : 'off',
                governanceBoardId: schemaReady && parsedBoardId !== null ? String(parsedBoardId) : null
            },
            req
        });
        res.json(mapIntakeFormRow({
            id: result.recordset[0].id,
            name,
            description,
            fields: JSON.stringify(normalizedFields),
            defaultGoalId: parsedDefaultGoalId,
            governanceMode: schemaReady ? normalizedMode : 'off',
            governanceBoardId: parsedBoardId,
            orgId: ownerOrgId,
            createdAt: result.recordset[0].createdAt
        }));
    } catch (err) {
        handleError(res, 'creating intake form', err);
    }
});

// Update intake form
router.put('/forms/:id', checkPermission('can_manage_intake_forms'), async (req, res) => {
    try {
        const { name, description, fields, defaultGoalId, governanceMode, governanceBoardId } = req.body;
        const normalizedFields = ensureRequiredIntakeFields(fields);
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const schemaReady = await hasGovernanceSchema(pool);
        const prev = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT id, name, description, defaultGoalId, governanceMode, governanceBoardId, orgId FROM IntakeForms WHERE id = @id');
        if (prev.recordset.length === 0) return res.status(404).json({ error: 'Form not found' });

        const current = prev.recordset[0];
        const hasOrgIdInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'orgId');
        let ownerOrgId = current.orgId === null || current.orgId === undefined ? null : Number(current.orgId);
        if (!isAdminUser(req.user)) {
            const viewerOrgId = requireScopedOrgId(req.user, 'No organization assigned. Contact your administrator to update intake forms.');
            if (ownerOrgId !== null && ownerOrgId !== viewerOrgId) {
                return res.status(403).json({ error: 'You can only update intake forms owned by your organization' });
            }
        }
        if (hasOrgIdInput) {
            if (!isAdminUser(req.user)) {
                return res.status(403).json({ error: 'Only admins can change an intake form organization' });
            }
            try {
                ownerOrgId = resolveOwnedOrgId({
                    user: req.user,
                    requestedOrgId: req.body?.orgId,
                    missingUserOrgMessage: 'No organization assigned. Contact your administrator to update intake form ownership.',
                    adminOrgRequiredMessage: 'orgId is required when updating an intake form without an owner organization'
                });
                await ensureOrganizationExists(pool, ownerOrgId);
            } catch (orgErr) {
                return res.status(400).json({ error: orgErr?.message || 'Unable to resolve intake form organization' });
            }
        }
        if (ownerOrgId === null || ownerOrgId === undefined) {
            return res.status(409).json({
                error: 'Intake form organization is not assigned. Run the org ownership backfill or provide orgId as an admin.'
            });
        }

        const parsedDefaultGoalId = defaultGoalId === undefined
            ? (current.defaultGoalId === null || current.defaultGoalId === undefined ? null : Number(current.defaultGoalId))
            : (defaultGoalId === null || defaultGoalId === '' ? null : Number.parseInt(defaultGoalId, 10));
        if (defaultGoalId !== undefined && defaultGoalId !== null && defaultGoalId !== '' && Number.isNaN(parsedDefaultGoalId)) {
            return res.status(400).json({ error: 'defaultGoalId must be a valid goal id' });
        }
        const normalizedMode = schemaReady
            ? normalizeGovernanceMode(governanceMode, normalizeGovernanceMode(current.governanceMode, 'off'))
            : 'off';
        let parsedBoardId = schemaReady
            ? parseNullableBoardId(governanceBoardId !== undefined ? governanceBoardId : current.governanceBoardId)
            : null;

        if (schemaReady && normalizedMode !== 'off' && parsedBoardId === null) {
            return res.status(400).json({ error: 'governanceBoardId is required when governanceMode is optional or required' });
        }

        if (schemaReady && parsedBoardId !== null) {
            const boardExists = await pool.request()
                .input('id', sql.Int, parsedBoardId)
                .query('SELECT TOP 1 id FROM GovernanceBoard WHERE id = @id');
            if (boardExists.recordset.length === 0) {
                return res.status(400).json({ error: 'Invalid governanceBoardId' });
            }
        }

        const defaultGoalAccessGaps = await findGoalAccessGapsForOrg({
            dbOrTx: pool,
            goalIds: parsedDefaultGoalId === null ? [] : [parsedDefaultGoalId],
            orgId: ownerOrgId
        });
        if (defaultGoalAccessGaps.length > 0) {
            return res.status(409).json({
                error: `Selected default goal is not visible to the form organization: ${defaultGoalAccessGaps[0].title}`
            });
        }

        const request = pool.request()
            .input('id', sql.Int, id)
            .input('name', sql.NVarChar, name)
            .input('description', sql.NVarChar, description)
            .input('fields', sql.NVarChar, JSON.stringify(normalizedFields))
            .input('defaultGoalId', sql.Int, parsedDefaultGoalId)
            .input('orgId', sql.Int, ownerOrgId);

        if (schemaReady) {
            await request
                .input('governanceMode', sql.NVarChar(20), normalizedMode)
                .input('governanceBoardId', sql.Int, parsedBoardId)
                .query(`
                    UPDATE IntakeForms
                    SET name = @name,
                        description = @description,
                        fields = @fields,
                        defaultGoalId = @defaultGoalId,
                        orgId = @orgId,
                        governanceMode = @governanceMode,
                        governanceBoardId = @governanceBoardId
                    WHERE id = @id
                `);
        } else {
            await request.query(`
                UPDATE IntakeForms
                SET name = @name, description = @description, fields = @fields, defaultGoalId = @defaultGoalId, orgId = @orgId
                WHERE id = @id
            `);
        }

        logAudit({
            action: 'intake_form.update',
            entityType: 'intake_form',
            entityId: id,
            entityTitle: name,
            user: getAuthUser(req),
            before: prev.recordset[0],
            after: {
                name,
                description,
                defaultGoalId: parsedDefaultGoalId,
                orgId: ownerOrgId,
                governanceMode: schemaReady ? normalizedMode : null,
                governanceBoardId: schemaReady && parsedBoardId !== null ? String(parsedBoardId) : null
            },
            req
        });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'updating intake form', err);
    }
});

// Delete intake form
router.delete('/forms/:id', checkPermission('can_manage_intake_forms'), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT name FROM IntakeForms WHERE id = @id');
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM IntakeForms WHERE id = @id');

        logAudit({ action: 'intake_form.delete', entityType: 'intake_form', entityId: id, entityTitle: prev.recordset[0]?.name, user: getAuthUser(req), before: prev.recordset[0], req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'deleting intake form', err);
    }
});

// ==================== INTAKE SUBMISSIONS ====================

// Governance queue (intake-scoped alias for governance prioritization)
router.get('/governance-queue', checkPermission('can_view_governance_queue'), async (req, res) => {
    try {
        const pool = await getPool();
        if (!(await hasGovernanceSchema(pool))) {
            return res.status(503).json({ error: 'Governance schema not installed. Run governance migration first.' });
        }
        const phase1Ready = await hasGovernancePhase1Schema(pool);
        const workflowSlaReady = await hasWorkflowSlaSchema(pool);
        const governanceCapacityReady = await hasGovernanceCapacitySchema(pool);
        const workflowSlaPolicies = await fetchWorkflowSlaPolicies(pool);
        const user = getAuthUser(req);

        const boardId = parseInt(req.query.boardId, 10);
        const governanceStatus = req.query.governanceStatus;
        const decision = req.query.governanceDecision;
        const myPendingVotes = String(req.query.myPendingVotes || '').toLowerCase() === 'true';
        const needsChairDecision = String(req.query.needsChairDecision || '').toLowerCase() === 'true';
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const offset = (page - 1) * limit;

        if ((myPendingVotes || needsChairDecision) && !phase1Ready) {
            return res.status(409).json({
                error: 'Governance review phase is not installed. Run governance phase 1 migration first.'
            });
        }

        const filters = ['s.governanceRequired = 1'];
        const addFilterParam = [];

        if (!Number.isNaN(boardId)) {
            filters.push('f.governanceBoardId = @boardId');
            addFilterParam.push(['boardId', sql.Int, boardId]);
        }
        if (typeof governanceStatus === 'string' && governanceStatus.trim()) {
            filters.push('s.governanceStatus = @governanceStatus');
            addFilterParam.push(['governanceStatus', sql.NVarChar(20), governanceStatus.trim()]);
        }
        if (typeof decision === 'string' && decision.trim()) {
            filters.push('s.governanceDecision = @decision');
            addFilterParam.push(['decision', sql.NVarChar(30), decision.trim()]);
        }
        if (myPendingVotes) {
            filters.push(`
                EXISTS (
                    SELECT 1
                    FROM GovernanceReview gr
                    INNER JOIN GovernanceReviewParticipant grp
                        ON grp.reviewId = gr.id
                       AND grp.userOid = @requestUserOid
                       AND grp.isEligibleVoter = 1
                    LEFT JOIN GovernanceVote gv
                        ON gv.reviewId = gr.id
                       AND gv.voterUserOid = @requestUserOid
                    WHERE gr.submissionId = s.id
                      AND gr.reviewRound = (
                          SELECT MAX(gr2.reviewRound)
                          FROM GovernanceReview gr2
                          WHERE gr2.submissionId = s.id
                      )
                      AND gr.status = 'in-review'
                      AND gv.id IS NULL
                )
            `);
            addFilterParam.push(['requestUserOid', sql.NVarChar(100), user?.oid || '']);
        }
        if (needsChairDecision) {
            filters.push(`
                EXISTS (
                    SELECT 1
                    FROM GovernanceReview gr
                    INNER JOIN GovernanceReviewParticipant grp
                        ON grp.reviewId = gr.id
                       AND grp.userOid = @requestUserOid
                       AND grp.participantRole = 'chair'
                       AND grp.isEligibleVoter = 1
                    WHERE gr.submissionId = s.id
                      AND gr.reviewRound = (
                          SELECT MAX(gr2.reviewRound)
                          FROM GovernanceReview gr2
                          WHERE gr2.submissionId = s.id
                      )
                      AND gr.status = 'in-review'
                )
            `);
            if (!myPendingVotes) {
                addFilterParam.push(['requestUserOid', sql.NVarChar(100), user?.oid || '']);
            }
        }
        if (!isAdminUser(user)) {
            const viewerOrgId = parseOptionalOrgId(user?.orgId);
            filters.push(`
                (
                    (@viewerScopeOrgId IS NOT NULL AND (s.orgId = @viewerScopeOrgId OR b.orgId = @viewerScopeOrgId))
                    OR EXISTS (
                        SELECT 1
                        FROM GovernanceMembership gmScope
                        WHERE gmScope.boardId = f.governanceBoardId
                          AND gmScope.userOid = @viewerScopeUserOid
                          AND gmScope.isActive = 1
                          AND gmScope.effectiveFrom <= GETDATE()
                          AND (gmScope.effectiveTo IS NULL OR gmScope.effectiveTo > GETDATE())
                    )
                )
            `);
            addFilterParam.push(['viewerScopeUserOid', sql.NVarChar(100), user?.oid || '']);
            addFilterParam.push(['viewerScopeOrgId', sql.Int, Number.isFinite(viewerOrgId) ? viewerOrgId : null]);
        }

        const where = `WHERE ${filters.join(' AND ')}`;

        const countRequest = pool.request();
        addFilterParam.forEach(([name, type, value]) => countRequest.input(name, type, value));
        const totalResult = await countRequest.query(`
            SELECT COUNT(*) AS total
            FROM IntakeSubmissions s
            INNER JOIN IntakeForms f ON f.id = s.formId
            LEFT JOIN GovernanceBoard b ON b.id = f.governanceBoardId
            ${where}
        `);
        const total = totalResult.recordset[0].total;

        const dataRequest = pool.request()
            .input('limit', sql.Int, limit)
            .input('offset', sql.Int, offset);
        addFilterParam.forEach(([name, type, value]) => dataRequest.input(name, type, value));
        const latestReviewSelect = phase1Ready
            ? `
                lr.latestReviewId,
                lr.latestReviewStatus,
                lr.latestReviewStartedAt,
                lr.latestReviewDecidedAt,
            `
            : `
                NULL AS latestReviewId,
                NULL AS latestReviewStatus,
                NULL AS latestReviewStartedAt,
                NULL AS latestReviewDecidedAt,
            `;
        const latestReviewApply = phase1Ready
            ? `
                OUTER APPLY (
                    SELECT TOP 1
                        gr.id AS latestReviewId,
                        gr.status AS latestReviewStatus,
                        gr.startedAt AS latestReviewStartedAt,
                        gr.decidedAt AS latestReviewDecidedAt
                    FROM GovernanceReview gr
                    WHERE gr.submissionId = s.id
                    ORDER BY gr.reviewRound DESC
                ) lr
            `
            : '';
        const slaNudgeSelect = workflowSlaReady
            ? `
                s.lastSlaNudgedAt,
                s.lastSlaNudgedByOid,
            `
            : `
                NULL AS lastSlaNudgedAt,
                NULL AS lastSlaNudgedByOid,
            `;
        const capacitySelect = governanceCapacityReady
            ? `
                s.estimatedEffortHours,
                b.weeklyCapacityHours,
                b.wipLimit,
                b.defaultSubmissionEffortHours,
            `
            : `
                NULL AS estimatedEffortHours,
                NULL AS weeklyCapacityHours,
                NULL AS wipLimit,
                NULL AS defaultSubmissionEffortHours,
            `;
        const dataResult = await dataRequest.query(`
            SELECT
                s.id,
                s.formId,
                s.orgId,
                s.status,
                s.submittedAt,
                s.submitterName,
                s.submitterEmail,
                s.governanceRequired,
                s.governanceStatus,
                s.governanceDecision,
                s.governanceReason,
                s.priorityScore,
                ${latestReviewSelect}
                ${slaNudgeSelect}
                ${capacitySelect}
                f.name AS formName,
                f.governanceMode,
                f.governanceBoardId,
                b.name AS governanceBoardName
            FROM IntakeSubmissions s
            INNER JOIN IntakeForms f ON f.id = s.formId
            LEFT JOIN GovernanceBoard b ON b.id = f.governanceBoardId
            ${latestReviewApply}
            ${where}
            ORDER BY
                CASE WHEN s.priorityScore IS NULL THEN 1 ELSE 0 END,
                s.priorityScore DESC,
                s.submittedAt ASC
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `);

        let capacity = null;
        if (!Number.isNaN(boardId) && governanceCapacityReady) {
            const boardCapacityRequest = pool.request()
                .input('boardId', sql.Int, boardId);
            let boardCapacityWhere = 'WHERE b.id = @boardId';
            if (!isAdminUser(user)) {
                const viewerOrgId = parseOptionalOrgId(user?.orgId);
                boardCapacityRequest
                    .input('viewerScopeUserOid', sql.NVarChar(100), user?.oid || '')
                    .input('viewerScopeOrgId', sql.Int, Number.isFinite(viewerOrgId) ? viewerOrgId : null);
                boardCapacityWhere += `
                    AND (
                        (@viewerScopeOrgId IS NOT NULL AND b.orgId = @viewerScopeOrgId)
                        OR EXISTS (
                            SELECT 1
                            FROM GovernanceMembership gmScope
                            WHERE gmScope.boardId = b.id
                              AND gmScope.userOid = @viewerScopeUserOid
                              AND gmScope.isActive = 1
                              AND gmScope.effectiveFrom <= GETDATE()
                              AND (gmScope.effectiveTo IS NULL OR gmScope.effectiveTo > GETDATE())
                        )
                    )
                `;
            }
            const boardCapacityResult = await boardCapacityRequest.query(`
                SELECT TOP 1
                    b.id,
                    b.name,
                    b.orgId,
                    b.weeklyCapacityHours,
                    b.wipLimit,
                    b.defaultSubmissionEffortHours
                FROM GovernanceBoard b
                ${boardCapacityWhere}
            `);
            const boardCapacity = boardCapacityResult.recordset[0] || null;

            if (boardCapacity) {
                const defaultEffort = Number(boardCapacity.defaultSubmissionEffortHours || 40);
                const queueSummary = await pool.request()
                    .input('boardId', sql.Int, boardId)
                    .input('defaultEffort', sql.Decimal(9, 2), defaultEffort)
                    .query(`
                        SELECT
                            SUM(CASE
                                WHEN s.governanceRequired = 1
                                     AND s.governanceStatus IN ('not-started', 'in-review')
                                    THEN 1 ELSE 0
                            END) AS pendingDecisionCount,
                            SUM(CASE
                                WHEN s.governanceRequired = 1
                                     AND s.governanceStatus IN ('not-started', 'in-review')
                                    THEN ISNULL(s.estimatedEffortHours, @defaultEffort)
                                    ELSE 0
                            END) AS pendingDecisionEffortHours,
                            SUM(CASE
                                WHEN s.governanceRequired = 1
                                     AND s.governanceStatus = 'decided'
                                     AND s.governanceDecision = 'approved-backlog'
                                     AND s.convertedProjectId IS NULL
                                    THEN 1 ELSE 0
                            END) AS approvedBacklogCount
                        FROM IntakeSubmissions s
                        INNER JOIN IntakeForms f ON f.id = s.formId
                        WHERE f.governanceBoardId = @boardId
                    `);

                const activeProjectRequest = pool.request();
                if (boardCapacity.orgId === null || boardCapacity.orgId === undefined) {
                    activeProjectRequest.input('boardOrgId', sql.Int, null);
                } else {
                    activeProjectRequest.input('boardOrgId', sql.Int, Number(boardCapacity.orgId));
                }
                const activeProjectResult = await activeProjectRequest.query(`
                    SELECT COUNT(*) AS activeProjectCount
                    FROM Projects p
                    WHERE p.status = 'active'
                      AND (@boardOrgId IS NULL OR p.orgId = @boardOrgId)
                `);

                const pendingDecisionCount = Number(queueSummary.recordset[0]?.pendingDecisionCount || 0);
                const pendingDecisionEffortHours = Math.round(Number(queueSummary.recordset[0]?.pendingDecisionEffortHours || 0) * 100) / 100;
                const approvedBacklogCount = Number(queueSummary.recordset[0]?.approvedBacklogCount || 0);
                const activeProjectCount = Number(activeProjectResult.recordset[0]?.activeProjectCount || 0);
                const weeklyCapacityHours = boardCapacity.weeklyCapacityHours === null || boardCapacity.weeklyCapacityHours === undefined
                    ? null
                    : Number(boardCapacity.weeklyCapacityHours);
                const wipLimit = boardCapacity.wipLimit === null || boardCapacity.wipLimit === undefined
                    ? null
                    : Number(boardCapacity.wipLimit);
                const projectedWipCount = activeProjectCount + pendingDecisionCount;
                const projectedWeeklyDemandHours = pendingDecisionEffortHours;
                const wipHeadroom = wipLimit === null ? null : (wipLimit - projectedWipCount);
                const capacityHeadroomHours = weeklyCapacityHours === null
                    ? null
                    : (Math.round((weeklyCapacityHours - projectedWeeklyDemandHours) * 100) / 100);

                capacity = {
                    schemaReady: true,
                    boardId: String(boardCapacity.id),
                    boardName: boardCapacity.name,
                    weeklyCapacityHours,
                    wipLimit,
                    defaultSubmissionEffortHours: defaultEffort,
                    activeProjectCount,
                    pendingDecisionCount,
                    pendingDecisionEffortHours,
                    approvedBacklogCount,
                    scenarioApproveNow: {
                        projectedWipCount,
                        projectedWeeklyDemandHours,
                        wipHeadroom,
                        capacityHeadroomHours,
                        wipBreached: wipLimit !== null && projectedWipCount > wipLimit,
                        capacityBreached: weeklyCapacityHours !== null && projectedWeeklyDemandHours > weeklyCapacityHours
                    }
                };
            }
        }

        res.json({
            items: dataResult.recordset.map(item => {
                const stageKey = getSubmissionWorkflowStage(item);
                const reviewStartedAt = parseDateOrNull(item.latestReviewStartedAt);
                const reviewDecidedAt = parseDateOrNull(item.latestReviewDecidedAt);
                const slaAnchor = getSubmissionSlaAnchor(item, reviewStartedAt, reviewDecidedAt);
                const stageSla = buildSlaSnapshot({
                    stageKey,
                    startedAt: slaAnchor,
                    policies: workflowSlaPolicies
                });
                const defaultEffort = item.defaultSubmissionEffortHours === null || item.defaultSubmissionEffortHours === undefined
                    ? 40
                    : Number(item.defaultSubmissionEffortHours);
                const capacityEffortHours = item.estimatedEffortHours === null || item.estimatedEffortHours === undefined
                    ? defaultEffort
                    : Number(item.estimatedEffortHours);

                return {
                    id: item.id.toString(),
                    formId: item.formId.toString(),
                    orgId: item.orgId === null || item.orgId === undefined ? null : String(item.orgId),
                    formName: item.formName,
                    status: item.status,
                    submittedAt: item.submittedAt,
                    submitterName: item.submitterName || null,
                    submitterEmail: item.submitterEmail || null,
                    governanceRequired: !!item.governanceRequired,
                    governanceStatus: item.governanceStatus,
                    governanceDecision: item.governanceDecision || null,
                    governanceReason: item.governanceReason || null,
                    priorityScore: item.priorityScore === null ? null : Number(item.priorityScore),
                    estimatedEffortHours: item.estimatedEffortHours === null || item.estimatedEffortHours === undefined
                        ? null
                        : Number(item.estimatedEffortHours),
                    capacityEffortHours,
                    governanceMode: item.governanceMode || 'off',
                    governanceBoardId: item.governanceBoardId ? item.governanceBoardId.toString() : null,
                    governanceBoardName: item.governanceBoardName || null,
                    boardWeeklyCapacityHours: item.weeklyCapacityHours === null || item.weeklyCapacityHours === undefined
                        ? null
                        : Number(item.weeklyCapacityHours),
                    boardWipLimit: item.wipLimit === null || item.wipLimit === undefined ? null : Number(item.wipLimit),
                    boardDefaultSubmissionEffortHours: defaultEffort,
                    latestReviewId: item.latestReviewId ? String(item.latestReviewId) : null,
                    latestReviewStatus: item.latestReviewStatus || null,
                    latestReviewStartedAt: item.latestReviewStartedAt || null,
                    latestReviewDecidedAt: item.latestReviewDecidedAt || null,
                    stageSla,
                    lastSlaNudgedAt: item.lastSlaNudgedAt || null,
                    lastSlaNudgedByOid: item.lastSlaNudgedByOid || null
                };
            }),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            },
            capacity
        });
    } catch (err) {
        handleError(res, 'fetching intake governance queue', err);
    }
});

// Workflow SLA policy (triage/governance/resolution)
router.get('/sla/policies', requireAuth, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const canView = await hasPermission(user, [
            'can_view_incoming_requests',
            'can_view_governance_queue',
            'can_manage_intake',
            'can_manage_governance',
            'can_manage_workflow_sla'
        ]);
        if (!canView) return res.status(403).json({ error: 'Forbidden' });

        const pool = await getPool();
        const policies = await fetchWorkflowSlaPolicies(pool);
        res.json({
            policies: Object.values(policies),
            schemaReady: await hasWorkflowSlaSchema(pool)
        });
    } catch (err) {
        handleError(res, 'fetching workflow SLA policies', err);
    }
});

router.put('/sla/policies', requireAuth, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        const canManage = await hasPermission(user, ['can_manage_workflow_sla', 'can_manage_intake', 'can_manage_governance']);
        if (!canManage) return res.status(403).json({ error: 'Forbidden' });

        const payload = Array.isArray(req.body?.policies) ? req.body.policies : null;
        if (!payload || payload.length === 0) {
            return res.status(400).json({ error: 'policies array is required' });
        }

        const pool = await getPool();
        if (!(await hasWorkflowSlaSchema(pool))) {
            return res.status(409).json({ error: 'Workflow SLA schema is not installed. Run `npm run setup-db:full` in `server`.' });
        }

        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            for (const rawPolicy of payload) {
                const stageKey = String(rawPolicy?.stageKey || '').trim().toLowerCase();
                if (!Object.prototype.hasOwnProperty.call(DEFAULT_WORKFLOW_SLA_POLICIES, stageKey)) {
                    throw new Error(`Unsupported stageKey '${stageKey}'`);
                }
                const normalized = normalizeSlaPolicy(stageKey, rawPolicy);
                const isActive = rawPolicy?.isActive === undefined ? 1 : (rawPolicy?.isActive ? 1 : 0);

                await new sql.Request(tx)
                    .input('stageKey', sql.NVarChar(40), stageKey)
                    .input('displayName', sql.NVarChar(100), normalized.displayName)
                    .input('targetHours', sql.Int, normalized.targetHours)
                    .input('warningHours', sql.Int, normalized.warningHours)
                    .input('escalationHours', sql.Int, normalized.escalationHours)
                    .input('isActive', sql.Bit, isActive)
                    .input('updatedByOid', sql.NVarChar(100), user?.oid || null)
                    .query(`
                        MERGE WorkflowSlaPolicy AS target
                        USING (SELECT @stageKey AS stageKey) AS source
                        ON target.stageKey = source.stageKey
                        WHEN MATCHED THEN
                            UPDATE SET
                                displayName = @displayName,
                                targetHours = @targetHours,
                                warningHours = @warningHours,
                                escalationHours = @escalationHours,
                                isActive = @isActive,
                                updatedAt = GETDATE(),
                                updatedByOid = @updatedByOid
                        WHEN NOT MATCHED THEN
                            INSERT (stageKey, displayName, targetHours, warningHours, escalationHours, isActive, updatedByOid)
                            VALUES (@stageKey, @displayName, @targetHours, @warningHours, @escalationHours, @isActive, @updatedByOid);
                    `);
            }
            await tx.commit();
        } catch (err) {
            await tx.rollback();
            throw err;
        }

        logAudit({
            action: 'intake.sla_policy_update',
            entityType: 'workflow_sla_policy',
            entityId: null,
            entityTitle: 'Workflow SLA Policy',
            user,
            after: { updatedStages: payload.map((item) => item?.stageKey).filter(Boolean) },
            req
        });

        const policies = await fetchWorkflowSlaPolicies(pool);
        res.json({
            success: true,
            policies: Object.values(policies)
        });
    } catch (err) {
        if (err?.message?.includes('stageKey') || err?.message?.includes('Unsupported')) {
            return res.status(400).json({ error: err.message });
        }
        handleError(res, 'updating workflow SLA policies', err);
    }
});

router.get('/sla/summary', requireAuth, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const canViewIncoming = await hasPermission(user, ['can_view_incoming_requests', 'can_manage_intake']);
        const canViewGovernance = await hasPermission(user, ['can_view_governance_queue', 'can_manage_governance']);
        if (!canViewIncoming && !canViewGovernance) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const pool = await getPool();
        const phase1Ready = await hasGovernancePhase1Schema(pool);
        const workflowSlaReady = await hasWorkflowSlaSchema(pool);
        const policies = await fetchWorkflowSlaPolicies(pool);

        const filter = canViewIncoming ? '' : 'AND s.governanceRequired = 1';
        const latestReviewApply = phase1Ready
            ? `
                OUTER APPLY (
                    SELECT TOP 1
                        gr.startedAt AS latestReviewStartedAt,
                        gr.decidedAt AS latestReviewDecidedAt
                    FROM GovernanceReview gr
                    WHERE gr.submissionId = s.id
                    ORDER BY gr.reviewRound DESC
                ) lr
            `
            : '';
        const latestReviewSelect = phase1Ready
            ? 'lr.latestReviewStartedAt, lr.latestReviewDecidedAt,'
            : 'NULL AS latestReviewStartedAt, NULL AS latestReviewDecidedAt,';
        const slaNudgeSelect = workflowSlaReady
            ? 's.lastSlaNudgedAt, s.lastSlaNudgedByOid,'
            : 'NULL AS lastSlaNudgedAt, NULL AS lastSlaNudgedByOid,';

        const result = await pool.request().query(`
            SELECT
                s.id,
                s.status,
                s.submittedAt,
                s.governanceRequired,
                s.governanceStatus,
                s.governanceDecision,
                ${slaNudgeSelect}
                ${latestReviewSelect}
                f.name AS formName
            FROM IntakeSubmissions s
            INNER JOIN IntakeForms f ON f.id = s.formId
            ${latestReviewApply}
            WHERE s.status NOT IN ('approved', 'rejected')
            ${filter}
            ORDER BY s.submittedAt ASC
        `);

        const stageStats = {
            triage: { total: 0, warning: 0, breached: 0, escalationDue: 0 },
            governance: { total: 0, warning: 0, breached: 0, escalationDue: 0 },
            resolution: { total: 0, warning: 0, breached: 0, escalationDue: 0 }
        };
        const breaches = [];

        for (const row of result.recordset) {
            const stageKey = getSubmissionWorkflowStage(row);
            if (!stageKey) continue;
            const anchor = getSubmissionSlaAnchor(
                row,
                parseDateOrNull(row.latestReviewStartedAt),
                parseDateOrNull(row.latestReviewDecidedAt)
            );
            const stageSla = buildSlaSnapshot({
                stageKey,
                startedAt: anchor,
                policies
            });
            if (!stageSla) continue;

            stageStats[stageKey].total += 1;
            if (stageSla.isWarning) stageStats[stageKey].warning += 1;
            if (stageSla.isBreached) stageStats[stageKey].breached += 1;
            if (stageSla.isEscalationDue) stageStats[stageKey].escalationDue += 1;

            if (stageSla.isBreached || stageSla.isEscalationDue) {
                breaches.push({
                    submissionId: String(row.id),
                    formName: row.formName || 'Submission',
                    status: row.status,
                    governanceStatus: row.governanceStatus || null,
                    stageSla,
                    lastSlaNudgedAt: row.lastSlaNudgedAt || null
                });
            }
        }

        breaches.sort((a, b) => {
            if (a.stageSla.isEscalationDue !== b.stageSla.isEscalationDue) {
                return a.stageSla.isEscalationDue ? -1 : 1;
            }
            return b.stageSla.elapsedHours - a.stageSla.elapsedHours;
        });

        res.json({
            stageStats,
            policies: Object.values(policies),
            breaches: breaches.slice(0, 50)
        });
    } catch (err) {
        handleError(res, 'fetching workflow SLA summary', err);
    }
});

router.post('/submissions/:id/sla/nudge', requireAuth, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        const canManage = await hasPermission(user, ['can_manage_workflow_sla', 'can_manage_intake', 'can_manage_governance']);
        if (!canManage) return res.status(403).json({ error: 'Forbidden' });

        const submissionId = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(submissionId)) return res.status(400).json({ error: 'Invalid submission id' });

        const pool = await getPool();
        if (!(await hasWorkflowSlaSchema(pool))) {
            return res.status(409).json({ error: 'Workflow SLA schema is not installed. Run `npm run setup-db:full` in `server`.' });
        }

        const phase1Ready = await hasGovernancePhase1Schema(pool);
        const latestReviewApply = phase1Ready
            ? `
                OUTER APPLY (
                    SELECT TOP 1
                        gr.startedAt AS latestReviewStartedAt,
                        gr.decidedAt AS latestReviewDecidedAt
                    FROM GovernanceReview gr
                    WHERE gr.submissionId = s.id
                    ORDER BY gr.reviewRound DESC
                ) lr
            `
            : '';
        const latestReviewSelect = phase1Ready
            ? 'lr.latestReviewStartedAt, lr.latestReviewDecidedAt'
            : 'NULL AS latestReviewStartedAt, NULL AS latestReviewDecidedAt';

        const submissionResult = await pool.request()
            .input('id', sql.Int, submissionId)
            .query(`
                SELECT
                    s.id,
                    s.status,
                    s.submittedAt,
                    s.governanceRequired,
                    s.governanceStatus,
                    s.governanceDecision,
                    ${latestReviewSelect}
                FROM IntakeSubmissions s
                ${latestReviewApply}
                WHERE s.id = @id
            `);

        if (submissionResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        const submission = submissionResult.recordset[0];
        const stageKey = getSubmissionWorkflowStage(submission);
        if (!stageKey) {
            return res.status(409).json({ error: 'Submission is closed and has no active workflow stage.' });
        }

        const policies = await fetchWorkflowSlaPolicies(pool);
        const stageSla = buildSlaSnapshot({
            stageKey,
            startedAt: getSubmissionSlaAnchor(
                submission,
                parseDateOrNull(submission.latestReviewStartedAt),
                parseDateOrNull(submission.latestReviewDecidedAt)
            ),
            policies
        });

        await pool.request()
            .input('id', sql.Int, submissionId)
            .input('nudgedByOid', sql.NVarChar(100), user?.oid || null)
            .query(`
                UPDATE IntakeSubmissions
                SET
                    lastSlaNudgedAt = GETDATE(),
                    lastSlaNudgedByOid = @nudgedByOid
                WHERE id = @id
            `);

        logAudit({
            action: 'submission.sla_nudge',
            entityType: 'submission',
            entityId: submissionId,
            entityTitle: `Submission ${submissionId}`,
            user,
            after: {
                stageKey,
                stageSla
            },
            req
        });

        res.json({
            success: true,
            stageKey,
            stageSla,
            nudgedAt: new Date().toISOString()
        });
    } catch (err) {
        handleError(res, 'posting workflow SLA nudge', err);
    }
});

// Get all submissions (Admin/Manager only)
router.get('/submissions', requireAuth, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const canViewAllSubmissions =
            await canManageIntakeSubmissions(user);
        if (!canViewAllSubmissions) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const pool = await getPool();
        let result;
        if (isAdminUser(user)) {
            result = await pool.request().query('SELECT * FROM IntakeSubmissions ORDER BY submittedAt DESC');
        } else {
            const viewerOrgId = requireScopedOrgId(user, 'No organization assigned. Contact your administrator to view intake submissions.');
            result = await pool.request()
                .input('orgId', sql.Int, viewerOrgId)
                .query('SELECT * FROM IntakeSubmissions WHERE orgId = @orgId ORDER BY submittedAt DESC');
        }

        res.json(result.recordset.map(mapSubmissionRow));
    } catch (err) {
        if (err?.message?.toLowerCase().includes('no organization assigned')) {
            return res.status(403).json({ error: err.message });
        }
        handleError(res, 'fetching submissions', err);
    }
});

// Get MY submissions (Authenticated User)
router.get('/my-submissions', requireAuth, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const pool = await getPool();
        const result = await pool.request()
            .input('submitterId', sql.NVarChar, user.oid)
            .query('SELECT * FROM IntakeSubmissions WHERE submitterId = @submitterId ORDER BY submittedAt DESC');

        res.json(result.recordset.map(mapSubmissionRow));
    } catch (err) {
        handleError(res, 'fetching my submissions', err);
    }
});

// Create submission (Authenticated)
router.post('/submissions', requireAuth, intakeSubmissionCreateLimiter, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const { formId, formData } = req.body;
        const parsedFormId = parseInt(formId, 10);
        if (Number.isNaN(parsedFormId)) {
            return res.status(400).json({ error: 'Invalid formId' });
        }

        const pool = await getPool();
        const submitterOrgId = requireScopedOrgId(user, 'No organization assigned. Contact your administrator to submit intake requests.');

        // Server-side validation of dynamic fields
        const formResult = await pool.request()
            .input('formId', sql.Int, parsedFormId)
            .query('SELECT id, fields, orgId FROM IntakeForms WHERE id = @formId');

        if (formResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Form not found' });
        }
        const formRecord = formResult.recordset[0];
        if (!isAdminUser(user)) {
            const formOrgId = parseOptionalOrgId(formRecord.orgId);
            if (Number.isFinite(formOrgId) && formOrgId !== submitterOrgId) {
                return res.status(403).json({ error: 'You can only submit intake forms owned by your organization' });
            }
        }

        let formFields = [];
        try {
            formFields = JSON.parse(formRecord.fields || '[]');
        } catch (e) {
            console.error('Failed to parse form fields for validation', e);
        }

        const missingFields = formFields
            .filter(f => {
                if (!f.required) return false;
                const val = formData ? formData[f.id] : undefined;
                return val === undefined || val === null || String(val).trim() === '';
            })
            .map(f => f.label || f.id);

        if (missingFields.length > 0) {
            return res.status(400).json({
                error: `Missing required fields: ${missingFields.join(', ')}`
            });
        }

        const governanceDefaults = await resolveGovernanceDefaults(pool, parsedFormId);
        let result;
        if (governanceDefaults.schemaReady) {
            result = await pool.request()
                .input('formId', sql.Int, parsedFormId)
                .input('formData', sql.NVarChar, JSON.stringify(formData))
                .input('submitterId', sql.NVarChar, user ? user.oid : null)
                .input('submitterName', sql.NVarChar, user ? user.name : null)
                .input('orgId', sql.Int, submitterOrgId)
                .input('governanceRequired', sql.Bit, governanceDefaults.governanceRequired ? 1 : 0)
                .input('governanceStatus', sql.NVarChar(20), governanceDefaults.governanceStatus)
                .input('governanceReason', sql.NVarChar(sql.MAX), governanceDefaults.governanceReason)
                .input('submitterEmail', sql.NVarChar, user ? user.email : null)
                .query(`
                    INSERT INTO IntakeSubmissions (
                        formId,
                        formData,
                        infoRequests,
                        submitterId,
                        submitterName,
                        submitterEmail,
                        orgId,
                        governanceRequired,
                        governanceStatus,
                        governanceReason
                    )
                    OUTPUT INSERTED.id, INSERTED.submittedAt
                    VALUES (
                        @formId,
                        @formData,
                        '[]',
                        @submitterId,
                        @submitterName,
                        @submitterEmail,
                        @orgId,
                        @governanceRequired,
                        @governanceStatus,
                        @governanceReason
                    )
                `);
        } else {
            result = await pool.request()
                .input('formId', sql.Int, parsedFormId)
                .input('formData', sql.NVarChar, JSON.stringify(formData))
                .input('submitterId', sql.NVarChar, user ? user.oid : null)
                .input('submitterName', sql.NVarChar, user ? user.name : null)
                .input('orgId', sql.Int, submitterOrgId)
                .input('submitterEmail', sql.NVarChar, user ? user.email : null)
                .query(`
                    INSERT INTO IntakeSubmissions (
                        formId, formData, infoRequests, submitterId, submitterName, submitterEmail, orgId
                    )
                    OUTPUT INSERTED.id, INSERTED.submittedAt
                    VALUES (@formId, @formData, '[]', @submitterId, @submitterName, @submitterEmail, @orgId)
                `);
        }

        const newSubId = result.recordset[0].id.toString();
        logAudit({
            action: 'submission.create',
            entityType: 'submission',
            entityId: newSubId,
            entityTitle: `Form ${parsedFormId}`,
            user,
            after: {
                formId: parsedFormId,
                status: 'pending',
                orgId: submitterOrgId,
                governanceRequired: governanceDefaults.governanceRequired,
                governanceStatus: governanceDefaults.governanceStatus
            },
            req
        });
        res.json(mapSubmissionRow({
            id: result.recordset[0].id,
            formId: parsedFormId,
            formData: JSON.stringify(formData),
            status: 'pending',
            governanceRequired: governanceDefaults.governanceRequired,
            governanceStatus: governanceDefaults.governanceStatus,
            governanceDecision: null,
            governanceReason: governanceDefaults.governanceReason,
            priorityScore: null,
            infoRequests: '[]',
            convertedProjectId: null,
            submittedAt: result.recordset[0].submittedAt,
            submitterId: user?.oid || null,
            submitterName: user?.name || null,
            submitterEmail: user?.email || null,
            orgId: submitterOrgId
        }));
    } catch (err) {
        if (err?.message?.toLowerCase().includes('no organization assigned')) {
            return res.status(403).json({ error: err.message });
        }
        handleError(res, 'creating submission', err);
    }
});

// Update submission (Status, Project, or Conversation Read State)
router.put('/submissions/:id', requireAuth, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const { status, convertedProjectId, conversation } = req.body;
        const id = parseInt(req.params.id);
        const pool = await getPool();

        // 1. Fetch existing submission to check permissions directly
        const prevResult = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT
                    submitterId,
                    orgId,
                    status,
                    convertedProjectId,
                    governanceRequired,
                    governanceStatus,
                    governanceDecision
                FROM IntakeSubmissions
                WHERE id = @id
            `);

        if (prevResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        const prev = prevResult.recordset[0];

        // 2. Determine Permissions
        const isManager = await canManageIntakeSubmissions(user);
        const isOwner = prev.submitterId === user.oid;

        if (!isManager && !isOwner) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        if (isManager && !isAdminUser(user)) {
            const managerOrgId = requireScopedOrgId(user, 'No organization assigned. Contact your administrator to manage intake submissions.');
            const submissionOrgId = parseOptionalOrgId(prev.orgId);
            if (Number.isFinite(submissionOrgId) && submissionOrgId !== managerOrgId) {
                return res.status(403).json({ error: 'You can only manage submissions owned by your organization' });
            }
        }

        // 3. Prepare Updates
        const request = pool.request().input('id', sql.Int, id);
        let updateParts = [];
        const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : null;
        const wantsApprovedStatus = normalizedStatus === 'approved';
        const hasConvertedProjectIdInput = convertedProjectId !== undefined;
        const parsedConvertedProjectId = hasConvertedProjectIdInput
            ? (convertedProjectId ? parseInt(convertedProjectId, 10) : null)
            : null;
        const wantsProjectConversion = hasConvertedProjectIdInput && parsedConvertedProjectId !== null;

        if (hasConvertedProjectIdInput && convertedProjectId && Number.isNaN(parsedConvertedProjectId)) {
            return res.status(400).json({ error: 'Invalid convertedProjectId' });
        }

        if (isManager && (wantsApprovedStatus || wantsProjectConversion)) {
            const governanceRequired = !!prev.governanceRequired;
            const governanceStatus = String(prev.governanceStatus || '').toLowerCase();
            const governanceDecision = String(prev.governanceDecision || '').toLowerCase();
            const governanceAllowsConversion = !governanceRequired ||
                (governanceStatus === 'decided' && governanceDecision === 'approved-now');

            if (!governanceAllowsConversion) {
                return res.status(409).json({
                    error: 'Cannot convert to project until governance is decided as approved-now.'
                });
            }
        }

        // Manager only fields
        if (isManager) {
            if (status !== undefined) {
                request.input('status', sql.NVarChar, status);
                updateParts.push('status = @status');
            }
            if (hasConvertedProjectIdInput) {
                request.input('convertedProjectId', sql.Int, parsedConvertedProjectId);
                updateParts.push('convertedProjectId = @convertedProjectId');
            }
        }

        // Conversation updates (Allowed for Manager and Owner - e.g. marking read)
        if (conversation !== undefined) {
            // We map 'conversation' from body to 'infoRequests' column
            request.input('infoRequests', sql.NVarChar, JSON.stringify(conversation));
            updateParts.push('infoRequests = @infoRequests');
        }

        if (updateParts.length === 0) {
            return res.json({ success: true, message: 'No changes applicable.' });
        }

        const query = `UPDATE IntakeSubmissions SET ${updateParts.join(', ')} WHERE id = @id`;
        await request.query(query);

        // Audit Log
        logAudit({
            action: 'submission.update',
            entityType: 'submission',
            entityId: id,
            entityTitle: `Submission ${id}`,
            user,
            after: { status, convertedProjectId: hasConvertedProjectIdInput ? parsedConvertedProjectId : undefined, conversationUpdated: !!conversation },
            req
        });

        res.json({ success: true });
    } catch (err) {
        if (err?.message?.toLowerCase().includes('no organization assigned')) {
            return res.status(403).json({ error: err.message });
        }
        handleError(res, 'updating submission', err);
    }
});

router.post('/submissions/:id/convert', requireAuth, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        if (!(await canManageIntakeSubmissions(user))) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const submissionId = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(submissionId)) {
            return res.status(400).json({ error: 'Invalid submission id' });
        }

        const pool = await getPool();
        const submissionResult = await pool.request()
            .input('id', sql.Int, submissionId)
            .query(`
                SELECT TOP 1
                    s.*,
                    f.name AS formName,
                    f.fields AS formFields,
                    f.defaultGoalId,
                    f.orgId AS formOrgId,
                    f.governanceBoardId,
                    b.name AS governanceBoardName,
                    b.orgId AS boardOrgId,
                    submitter.orgId AS submitterOrgId
                FROM IntakeSubmissions s
                INNER JOIN IntakeForms f ON f.id = s.formId
                LEFT JOIN GovernanceBoard b ON b.id = f.governanceBoardId
                LEFT JOIN Users submitter ON submitter.oid = s.submitterId
                WHERE s.id = @id
            `);

        if (submissionResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Submission not found' });
        }

        const submission = submissionResult.recordset[0];
        const resolvedSubmissionOrgId = parseOptionalOrgId(
            submission.orgId ?? submission.submitterOrgId ?? submission.formOrgId
        );
        if (!isAdminUser(user)) {
            const managerOrgId = parseOptionalOrgId(user?.orgId);
            let hasBoardMembership = false;
            if (submission.governanceBoardId) {
                const membershipResult = await pool.request()
                    .input('boardId', sql.Int, submission.governanceBoardId)
                    .input('userOid', sql.NVarChar(100), user?.oid || '')
                    .query(`
                        SELECT TOP 1 id
                        FROM GovernanceMembership
                        WHERE boardId = @boardId
                          AND userOid = @userOid
                          AND isActive = 1
                          AND effectiveFrom <= GETDATE()
                          AND (effectiveTo IS NULL OR effectiveTo > GETDATE())
                    `);
                hasBoardMembership = membershipResult.recordset.length > 0;
            }
            const hasSubmissionOrgAccess = Number.isFinite(managerOrgId) && Number.isFinite(resolvedSubmissionOrgId) && managerOrgId === resolvedSubmissionOrgId;
            const boardOrgId = parseOptionalOrgId(submission.boardOrgId);
            const hasBoardOrgAccess = Number.isFinite(managerOrgId) && Number.isFinite(boardOrgId) && managerOrgId === boardOrgId;
            if (!hasSubmissionOrgAccess && !hasBoardOrgAccess && !hasBoardMembership) {
                return res.status(403).json({ error: 'You can only convert submissions owned by your organization' });
            }
        }
        if (!Number.isFinite(resolvedSubmissionOrgId)) {
            return res.status(409).json({
                error: 'Submission organization is not assigned. Run the org ownership backfill before converting this submission.'
            });
        }

        const normalizedSubmissionStatus = String(submission.status || '').trim().toLowerCase();
        if (submission.convertedProjectId) {
            return res.status(409).json({
                error: `Submission has already been converted to project ${submission.convertedProjectId}.`
            });
        }
        if (normalizedSubmissionStatus === 'rejected') {
            return res.status(409).json({ error: 'Rejected submissions cannot be converted to projects.' });
        }

        const governanceRequired = !!submission.governanceRequired;
        const governanceStatus = String(submission.governanceStatus || '').trim().toLowerCase();
        const governanceDecision = String(submission.governanceDecision || '').trim().toLowerCase();
        if (governanceRequired && !(governanceStatus === 'decided' && governanceDecision === 'approved-now')) {
            return res.status(409).json({
                error: 'Cannot convert to project until governance is decided as approved-now.'
            });
        }

        const projectData = req.body?.projectData && typeof req.body.projectData === 'object'
            ? req.body.projectData
            : {};
        const kickoffTasks = normalizeKickoffTasks(req.body?.kickoffTasks);
        const conversionContext = req.body?.conversionContext;
        const formFields = parseJsonOrFallback(submission.formFields, []);
        const submissionFormData = parseJsonOrFallback(submission.formData, {});
        const systemProjectName = resolveSubmissionSystemValue({
            formFields,
            formData: submissionFormData,
            key: INTAKE_SYSTEM_FIELD_KEYS.PROJECT_NAME
        });
        const systemDescription = resolveSubmissionSystemValue({
            formFields,
            formData: submissionFormData,
            key: INTAKE_SYSTEM_FIELD_KEYS.PROJECT_DESCRIPTION
        });

        const projectTitle = String(projectData?.title || systemProjectName || '').trim() || 'New Project';
        const projectDescription = appendConversionContext(
            projectData?.description !== undefined ? projectData.description : systemDescription,
            conversionContext
        );
        const projectStatus = String(projectData?.status || 'active').trim().toLowerCase() || 'active';
        const requestedGoalIds = normalizeConversionGoalIds(projectData);
        const goalIds = requestedGoalIds.length > 0
            ? requestedGoalIds
            : (submission.defaultGoalId ? [Number(submission.defaultGoalId)] : []);

        if (goalIds.length > 1) {
            const allGoals = await loadGoalsForValidation();
            const validation = validateGoalAssignment(allGoals, goalIds);
            if (!validation.valid) {
                return res.status(400).json({ error: validation.error });
            }
        }

        if (goalIds.length > 0) {
            const { text, params } = buildInClause('convertGoalId', goalIds);
            const goalRequest = pool.request();
            addParams(goalRequest, params);
            const goalResult = await goalRequest.query(`
                SELECT id, title, orgId
                FROM Goals
                WHERE id IN (${text})
            `);
            const foundGoalIds = new Set(goalResult.recordset.map((row) => Number(row.id)));
            const missingGoalIds = goalIds.filter((goalId) => !foundGoalIds.has(Number(goalId)));
            if (missingGoalIds.length > 0) {
                return res.status(400).json({
                    error: `Goal id(s) not found: ${missingGoalIds.join(', ')}`
                });
            }
        }

        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            await ensureReadGoalAccessForOrg({
                dbOrTx: tx,
                goalIds,
                orgId: resolvedSubmissionOrgId,
                grantedByOid: user?.oid || null
            });

            const remainingGoalAccessGaps = await findGoalAccessGapsForOrg({
                dbOrTx: tx,
                goalIds,
                orgId: resolvedSubmissionOrgId
            });
            if (remainingGoalAccessGaps.length > 0) {
                const accessError = new Error(
                    `Selected goals are not visible to the submission organization: ${remainingGoalAccessGaps.map((goal) => goal.title).join(', ')}`
                );
                accessError.statusCode = 409;
                throw accessError;
            }

            const projectInsert = await new sql.Request(tx)
                .input('title', sql.NVarChar(255), projectTitle)
                .input('description', sql.NVarChar(sql.MAX), projectDescription || null)
                .input('status', sql.NVarChar(20), projectStatus)
                .input('orgId', sql.Int, resolvedSubmissionOrgId)
                .query(`
                    INSERT INTO Projects (title, description, status, orgId)
                    OUTPUT INSERTED.id, INSERTED.createdAt
                    VALUES (@title, @description, @status, @orgId)
                `);
            const projectId = Number(projectInsert.recordset[0].id);

            for (const goalId of goalIds) {
                await new sql.Request(tx)
                    .input('projectId', sql.Int, projectId)
                    .input('goalId', sql.Int, goalId)
                    .query('INSERT INTO ProjectGoals (projectId, goalId) VALUES (@projectId, @goalId)');
            }

            for (const task of kickoffTasks) {
                await new sql.Request(tx)
                    .input('projectId', sql.Int, projectId)
                    .input('title', sql.NVarChar(255), task.title)
                    .input('status', sql.NVarChar(20), task.status)
                    .input('priority', sql.NVarChar(20), task.priority)
                    .input('description', sql.NVarChar(sql.MAX), task.description || '')
                    .input('startDate', sql.Date, task.startDate)
                    .input('endDate', sql.Date, task.endDate)
                    .query(`
                        INSERT INTO Tasks (projectId, title, status, priority, description, startDate, endDate)
                        VALUES (@projectId, @title, @status, @priority, @description, @startDate, @endDate)
                    `);
            }

            await new sql.Request(tx)
                .input('submissionId', sql.Int, submissionId)
                .input('projectId', sql.Int, projectId)
                .input('orgId', sql.Int, resolvedSubmissionOrgId)
                .query(`
                    UPDATE IntakeSubmissions
                    SET
                        status = 'approved',
                        convertedProjectId = @projectId,
                        orgId = @orgId
                    WHERE id = @submissionId
                `);

            await tx.commit();

            logAudit({
                action: 'submission.convert',
                entityType: 'submission',
                entityId: String(submissionId),
                entityTitle: `Submission ${submissionId}`,
                user,
                after: {
                    projectId,
                    orgId: resolvedSubmissionOrgId,
                    goalIds,
                    kickoffTaskCount: kickoffTasks.length
                },
                req
            });

            return res.json({
                success: true,
                submissionId: String(submissionId),
                projectId: String(projectId),
                seededTaskCount: kickoffTasks.length,
                seededTaskErrors: [],
                project: {
                    id: String(projectId),
                    title: projectTitle,
                    description: projectDescription || '',
                    status: projectStatus,
                    orgId: String(resolvedSubmissionOrgId),
                    goalIds: goalIds.map(String),
                    goalId: goalIds[0] ? String(goalIds[0]) : null,
                    linkedGoalCount: goalIds.length,
                    visibleGoalCount: goalIds.length,
                    goalContextStatus: goalIds.length > 0 ? 'complete' : 'no-goals-linked',
                    goalContextMissing: false,
                    accessLevel: 'owner',
                    hasWriteAccess: true,
                    tasks: kickoffTasks.map((task, index) => ({
                        id: `seeded-${projectId}-${index + 1}`,
                        title: task.title,
                        status: task.status,
                        priority: task.priority,
                        description: task.description || '',
                        startDate: task.startDate,
                        endDate: task.endDate
                    })),
                    createdAt: projectInsert.recordset[0].createdAt
                }
            });
        } catch (txErr) {
            await tx.rollback();
            throw txErr;
        }
    } catch (err) {
        if (err?.statusCode === 409) {
            return res.status(409).json({ error: err.message });
        }
        if (err?.message?.toLowerCase().includes('no organization assigned')) {
            return res.status(403).json({ error: err.message });
        }
        handleError(res, 'converting intake submission to project', err);
    }
});

// Intake manager can explicitly apply governance for optional/off submissions
router.post('/submissions/:id/governance/apply', requireAuth, governanceRoutingLimiter, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        if (!(await canRouteGovernanceSubmission(user))) return res.status(403).json({ error: 'Forbidden' });

        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid submission id' });

        const { reason } = req.body || {};
        const governanceReason = typeof reason === 'string' && reason.trim()
            ? reason.trim()
            : 'Marked for governance review by intake manager.';

        const pool = await getPool();
        if (!(await hasGovernanceSchema(pool))) {
            return res.status(503).json({ error: 'Governance schema not installed. Run governance migration first.' });
        }
        const prevResult = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT
                    s.id,
                    s.submitterId,
                    s.orgId,
                    s.status,
                    s.governanceRequired,
                    s.governanceStatus,
                    s.governanceReason,
                    f.governanceBoardId,
                    b.orgId AS boardOrgId
                FROM IntakeSubmissions s
                LEFT JOIN IntakeForms f ON f.id = s.formId
                LEFT JOIN GovernanceBoard b ON b.id = f.governanceBoardId
                WHERE s.id = @id
            `);
        if (prevResult.recordset.length === 0) return res.status(404).json({ error: 'Submission not found' });
        const prev = prevResult.recordset[0];
        if (!isAdminUser(user)) {
            const scope = await buildGovernanceSubmissionScope({ pool, user, submission: prev });
            if (!hasGovernanceSubmissionScope(scope)) {
                return res.status(403).json({ error: 'Forbidden' });
            }
        }

        if (['approved', 'rejected'].includes((prev.status || '').toLowerCase())) {
            return res.status(409).json({ error: 'Cannot apply governance to a closed submission' });
        }
        if ((prev.governanceStatus || '').toLowerCase() === 'decided') {
            return res.status(409).json({ error: 'Governance already decided for this submission' });
        }

        await pool.request()
            .input('id', sql.Int, id)
            .input('governanceReason', sql.NVarChar(sql.MAX), governanceReason)
            .query(`
                UPDATE IntakeSubmissions
                SET governanceRequired = 1,
                    governanceStatus = CASE WHEN governanceStatus = 'skipped' THEN 'not-started' ELSE governanceStatus END,
                    governanceReason = @governanceReason
                WHERE id = @id
            `);

        logAudit({
            action: 'submission.governance_apply',
            entityType: 'submission',
            entityId: id,
            entityTitle: `Submission ${id}`,
            user,
            before: prev,
            after: { governanceRequired: true, governanceStatus: 'not-started', governanceReason },
            req
        });

        res.json({ success: true });
    } catch (err) {
        handleError(res, 'applying governance on submission', err);
    }
});

// Intake manager can skip governance for submissions not requiring governance
router.post('/submissions/:id/governance/skip', requireAuth, governanceRoutingLimiter, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        if (!(await canRouteGovernanceSubmission(user))) return res.status(403).json({ error: 'Forbidden' });

        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid submission id' });

        const { reason } = req.body || {};
        const governanceReason = typeof reason === 'string' && reason.trim()
            ? reason.trim()
            : 'Governance skipped by intake manager.';

        const pool = await getPool();
        if (!(await hasGovernanceSchema(pool))) {
            return res.status(503).json({ error: 'Governance schema not installed. Run governance migration first.' });
        }
        const prevResult = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT
                    s.id,
                    s.submitterId,
                    s.orgId,
                    s.status,
                    s.governanceRequired,
                    s.governanceStatus,
                    s.governanceReason,
                    f.governanceBoardId,
                    b.orgId AS boardOrgId
                FROM IntakeSubmissions s
                LEFT JOIN IntakeForms f ON f.id = s.formId
                LEFT JOIN GovernanceBoard b ON b.id = f.governanceBoardId
                WHERE s.id = @id
            `);
        if (prevResult.recordset.length === 0) return res.status(404).json({ error: 'Submission not found' });
        const prev = prevResult.recordset[0];
        if (!isAdminUser(user)) {
            const scope = await buildGovernanceSubmissionScope({ pool, user, submission: prev });
            if (!hasGovernanceSubmissionScope(scope)) {
                return res.status(403).json({ error: 'Forbidden' });
            }
        }

        if ((prev.governanceStatus || '').toLowerCase() === 'decided') {
            return res.status(409).json({ error: 'Cannot skip governance after decision' });
        }

        await pool.request()
            .input('id', sql.Int, id)
            .input('governanceReason', sql.NVarChar(sql.MAX), governanceReason)
            .query(`
                UPDATE IntakeSubmissions
                SET governanceRequired = 0,
                    governanceStatus = 'skipped',
                    governanceReason = @governanceReason
                WHERE id = @id
            `);

        logAudit({
            action: 'submission.governance_skip',
            entityType: 'submission',
            entityId: id,
            entityTitle: `Submission ${id}`,
            user,
            before: prev,
            after: { governanceRequired: false, governanceStatus: 'skipped', governanceReason },
            req
        });

        res.json({ success: true });
    } catch (err) {
        handleError(res, 'skipping governance on submission', err);
    }
});

// Start governance review round for a submission
router.post('/submissions/:id/governance/start', requireAuth, governanceRoutingLimiter, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        if (!(await canRouteGovernanceSubmission(user))) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const submissionId = parseInt(req.params.id, 10);
        if (Number.isNaN(submissionId)) return res.status(400).json({ error: 'Invalid submission id' });

        const pool = await getPool();
        if (!(await hasGovernanceSchema(pool)) || !(await hasGovernancePhase1Schema(pool))) {
            return res.status(503).json({ error: 'Governance phase 1 schema not installed. Run governance phase 1 migration first.' });
        }
        const isPhase3Ready = await hasGovernancePhase3Schema(pool);

        const submissionResult = await pool.request()
            .input('id', sql.Int, submissionId)
            .query(`
                SELECT
                    s.id,
                    s.submitterId,
                    s.orgId,
                    s.status,
                    s.governanceRequired,
                    s.governanceStatus,
                    s.governanceDecision,
                    s.formId,
                    f.governanceBoardId,
                    b.orgId AS boardOrgId
                FROM IntakeSubmissions s
                INNER JOIN IntakeForms f ON f.id = s.formId
                LEFT JOIN GovernanceBoard b ON b.id = f.governanceBoardId
                WHERE s.id = @id
            `);

        if (submissionResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Submission not found' });
        }

        const submission = submissionResult.recordset[0];
        if (!isAdminUser(user)) {
            const scope = await buildGovernanceSubmissionScope({ pool, user, submission });
            if (!hasGovernanceSubmissionScope(scope)) {
                return res.status(403).json({ error: 'Forbidden' });
            }
        }
        if (!submission.governanceRequired) {
            return res.status(409).json({ error: 'Submission is not marked for governance. Apply governance first.' });
        }
        if (!submission.governanceBoardId) {
            return res.status(409).json({ error: 'Intake form is not mapped to a governance board.' });
        }
        const policySettings = isPhase3Ready
            ? await fetchGovernancePolicySettings(pool, submission.governanceBoardId)
            : { ...DEFAULT_GOVERNANCE_POLICY };
        if (['approved', 'rejected'].includes((submission.status || '').toLowerCase())) {
            return res.status(409).json({ error: 'Cannot start governance for a closed submission.' });
        }

        const existingOpenReview = await pool.request()
            .input('submissionId', sql.Int, submissionId)
            .query(`
                SELECT TOP 1 id, reviewRound, status
                FROM GovernanceReview
                WHERE submissionId = @submissionId AND status = 'in-review'
                ORDER BY reviewRound DESC
            `);

        if (existingOpenReview.recordset.length > 0) {
            const review = existingOpenReview.recordset[0];
            return res.json({
                success: true,
                reviewId: review.id.toString(),
                reviewRound: review.reviewRound,
                status: review.status,
                message: 'Governance review already in progress.'
            });
        }

        const requestedCriteriaVersionId = parseInt(req.body?.criteriaVersionId, 10);
        let criteriaVersionResult;
        if (!Number.isNaN(requestedCriteriaVersionId)) {
            criteriaVersionResult = await pool.request()
                .input('criteriaVersionId', sql.Int, requestedCriteriaVersionId)
                .input('boardId', sql.Int, submission.governanceBoardId)
                .query(`
                    SELECT TOP 1 id, versionNo, status, criteriaJson
                    FROM GovernanceCriteriaVersion
                    WHERE id = @criteriaVersionId
                      AND boardId = @boardId
                `);
        } else {
            criteriaVersionResult = await pool.request()
                .input('boardId', sql.Int, submission.governanceBoardId)
                .query(`
                    SELECT TOP 1 id, versionNo, status, criteriaJson
                    FROM GovernanceCriteriaVersion
                    WHERE boardId = @boardId
                      AND status = 'published'
                    ORDER BY versionNo DESC
                `);
        }

        if (criteriaVersionResult.recordset.length === 0) {
            return res.status(409).json({ error: 'No criteria version available for this board.' });
        }
        const criteriaVersion = criteriaVersionResult.recordset[0];
        if (criteriaVersion.status === 'retired') {
            return res.status(409).json({ error: 'Selected criteria version is retired.' });
        }

        const criteriaSnapshot = normalizeCriteriaSnapshot(criteriaVersion.criteriaJson);
        if (criteriaSnapshot.length === 0) {
            return res.status(409).json({ error: 'Selected criteria version has no criteria.' });
        }

        const participantsResult = await pool.request()
            .input('boardId', sql.Int, submission.governanceBoardId)
            .query(`
                SELECT userOid, role
                FROM GovernanceMembership
                WHERE boardId = @boardId
                  AND isActive = 1
                  AND effectiveFrom <= GETDATE()
                  AND (effectiveTo IS NULL OR effectiveTo > GETDATE())
                ORDER BY role DESC, createdAt ASC
            `);

        if (participantsResult.recordset.length === 0) {
            return res.status(409).json({ error: 'No active governance members on this board.' });
        }

        const roundResult = await pool.request()
            .input('submissionId', sql.Int, submissionId)
            .query(`
                SELECT ISNULL(MAX(reviewRound), 0) + 1 AS nextRound
                FROM GovernanceReview
                WHERE submissionId = @submissionId
            `);
        const nextRound = roundResult.recordset[0].nextRound;

        const tx = new sql.Transaction(pool);
        let reviewId;
        let voteDeadlineAt = null;
        try {
            await tx.begin();

            const createReviewRequest = new sql.Request(tx);
            createReviewRequest
                .input('submissionId', sql.Int, submissionId)
                .input('boardId', sql.Int, submission.governanceBoardId)
                .input('reviewRound', sql.Int, nextRound)
                .input('criteriaVersionId', sql.Int, criteriaVersion.id)
                .input('criteriaSnapshotJson', sql.NVarChar(sql.MAX), JSON.stringify(criteriaSnapshot))
                .input('startedByOid', sql.NVarChar(100), user.oid);

            let reviewInsert;
            if (isPhase3Ready) {
                const voteWindowDays = policySettings.voteWindowDays;
                voteDeadlineAt = voteWindowDays
                    ? new Date(Date.now() + (voteWindowDays * 24 * 60 * 60 * 1000))
                    : null;
                reviewInsert = await createReviewRequest
                    .input('policySnapshotJson', sql.NVarChar(sql.MAX), JSON.stringify(policySettings))
                    .input('voteDeadlineAt', sql.DateTime2, voteDeadlineAt)
                    .query(`
                        INSERT INTO GovernanceReview (
                            submissionId, boardId, reviewRound, status,
                            criteriaVersionId, criteriaSnapshotJson, startedByOid,
                            policySnapshotJson, voteDeadlineAt
                        )
                        OUTPUT INSERTED.id
                        VALUES (
                            @submissionId, @boardId, @reviewRound, 'in-review',
                            @criteriaVersionId, @criteriaSnapshotJson, @startedByOid,
                            @policySnapshotJson, @voteDeadlineAt
                        )
                    `);
            } else {
                reviewInsert = await createReviewRequest.query(`
                    INSERT INTO GovernanceReview (
                        submissionId, boardId, reviewRound, status,
                        criteriaVersionId, criteriaSnapshotJson, startedByOid
                    )
                    OUTPUT INSERTED.id
                    VALUES (
                        @submissionId, @boardId, @reviewRound, 'in-review',
                        @criteriaVersionId, @criteriaSnapshotJson, @startedByOid
                    )
                `);
            }
            reviewId = reviewInsert.recordset[0].id;

            for (const participant of participantsResult.recordset) {
                const participantRequest = new sql.Request(tx);
                await participantRequest
                    .input('reviewId', sql.Int, reviewId)
                    .input('userOid', sql.NVarChar(100), participant.userOid)
                    .input('participantRole', sql.NVarChar(20), participant.role || 'member')
                    .query(`
                        INSERT INTO GovernanceReviewParticipant (
                            reviewId, userOid, participantRole, isEligibleVoter
                        )
                        VALUES (@reviewId, @userOid, @participantRole, 1)
                    `);
            }

            const updateSubmissionRequest = new sql.Request(tx);
            await updateSubmissionRequest
                .input('submissionId', sql.Int, submissionId)
                .query(`
                    UPDATE IntakeSubmissions
                    SET governanceStatus = 'in-review',
                        governanceDecision = NULL
                    WHERE id = @submissionId
                `);

            await tx.commit();
        } catch (err) {
            await tx.rollback();
            throw err;
        }

        logAudit({
            action: 'submission.governance_start',
            entityType: 'submission',
            entityId: submissionId,
            entityTitle: `Submission ${submissionId}`,
            user,
            after: {
                reviewId,
                reviewRound: nextRound,
                boardId: submission.governanceBoardId,
                criteriaVersionId: criteriaVersion.id,
                criteriaVersionNo: criteriaVersion.versionNo,
                participantCount: participantsResult.recordset.length,
                policy: policySettings,
                voteDeadlineAt
            },
            req
        });

        res.json({
            success: true,
            reviewId: reviewId.toString(),
            reviewRound: nextRound,
            criteriaVersionId: criteriaVersion.id.toString(),
            criteriaVersionNo: criteriaVersion.versionNo,
            participantCount: participantsResult.recordset.length,
            policy: policySettings,
            voteDeadlineAt
        });
    } catch (err) {
        handleError(res, 'starting governance review', err);
    }
});

// Get governance details for a submission (latest review round)
router.get('/submissions/:id/governance', requireAuth, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const submissionId = parseInt(req.params.id, 10);
        if (Number.isNaN(submissionId)) return res.status(400).json({ error: 'Invalid submission id' });

        const pool = await getPool();
        if (!(await hasGovernanceSchema(pool)) || !(await hasGovernancePhase1Schema(pool))) {
            return res.status(503).json({ error: 'Governance phase 1 schema not installed. Run governance phase 1 migration first.' });
        }
        const phase3Ready = await hasGovernancePhase3Schema(pool);
        const workflowSlaReady = await hasWorkflowSlaSchema(pool);
        const workflowSlaPolicies = await fetchWorkflowSlaPolicies(pool);
        const slaNudgeSelect = workflowSlaReady
            ? `
                s.lastSlaNudgedAt,
                s.lastSlaNudgedByOid,
            `
            : `
                NULL AS lastSlaNudgedAt,
                NULL AS lastSlaNudgedByOid,
            `;

        const submissionResult = await pool.request()
            .input('id', sql.Int, submissionId)
            .query(`
                SELECT
                    s.id,
                    s.formId,
                    s.submitterId,
                    s.orgId,
                    s.status,
                    s.submittedAt,
                    s.governanceRequired,
                    s.governanceStatus,
                    s.governanceDecision,
                    s.governanceReason,
                    s.priorityScore,
                    ${slaNudgeSelect}
                    f.name AS formName,
                    f.governanceBoardId,
                    b.name AS boardName,
                    b.orgId AS boardOrgId
                FROM IntakeSubmissions s
                INNER JOIN IntakeForms f ON f.id = s.formId
                LEFT JOIN GovernanceBoard b ON b.id = f.governanceBoardId
                WHERE s.id = @id
            `);

        if (submissionResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        const submission = submissionResult.recordset[0];

        const canViewGovernance = await hasPermission(user, [
            'can_view_governance_queue',
            'can_manage_governance',
            'can_vote_governance',
            'can_decide_governance'
        ]);
        const isOwner = submission.submitterId === user.oid;
        const canManageGovernanceFlow = await canRouteGovernanceSubmission(user);
        if (!canViewGovernance && !canManageGovernanceFlow && !isOwner) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        if (!isAdminUser(user) && !isOwner) {
            const scope = await buildGovernanceSubmissionScope({ pool, user, submission });
            if (!hasGovernanceSubmissionScope(scope)) {
                return res.status(403).json({ error: 'Forbidden' });
            }
        }

        const reviewResult = await pool.request()
            .input('submissionId', sql.Int, submissionId)
            .query(`
                SELECT TOP 1
                    id, submissionId, boardId, reviewRound, status, decision, decisionReason,
                    criteriaVersionId, criteriaSnapshotJson, startedAt, startedByOid, decidedAt, decidedByOid,
                    ${phase3Ready ? 'policySnapshotJson, voteDeadlineAt' : 'NULL AS policySnapshotJson, NULL AS voteDeadlineAt'}
                FROM GovernanceReview
                WHERE submissionId = @submissionId
                ORDER BY reviewRound DESC
            `);

        if (reviewResult.recordset.length === 0) {
            const stageKey = getSubmissionWorkflowStage(submission);
            const stageSla = buildSlaSnapshot({
                stageKey,
                startedAt: getSubmissionSlaAnchor(submission),
                policies: workflowSlaPolicies
            });
            return res.json({
                submission: {
                    id: submission.id.toString(),
                    formId: submission.formId.toString(),
                    formName: submission.formName,
                    orgId: submission.orgId === null || submission.orgId === undefined ? null : String(submission.orgId),
                    status: submission.status,
                    submittedAt: submission.submittedAt,
                    governanceRequired: !!submission.governanceRequired,
                    governanceStatus: submission.governanceStatus,
                    governanceDecision: submission.governanceDecision,
                    governanceReason: submission.governanceReason,
                    priorityScore: submission.priorityScore === null ? null : Number(submission.priorityScore),
                    governanceBoardId: submission.governanceBoardId ? submission.governanceBoardId.toString() : null,
                    governanceBoardName: submission.boardName || null,
                    stageSla,
                    lastSlaNudgedAt: submission.lastSlaNudgedAt || null,
                    lastSlaNudgedByOid: submission.lastSlaNudgedByOid || null
                },
                review: null
            });
        }

        const review = reviewResult.recordset[0];
        const participantsResult = await pool.request()
            .input('reviewId', sql.Int, review.id)
            .query(`
                SELECT
                    p.id,
                    p.userOid,
                    p.participantRole,
                    p.isEligibleVoter,
                    p.createdAt,
                    u.name AS userName,
                    u.email AS userEmail
                FROM GovernanceReviewParticipant p
                LEFT JOIN Users u ON u.oid = p.userOid
                WHERE p.reviewId = @reviewId
                ORDER BY p.participantRole DESC, p.createdAt ASC
            `);

        const votesResult = await pool.request()
            .input('reviewId', sql.Int, review.id)
            .query(`
                SELECT
                    v.id,
                    v.voterUserOid,
                    v.scoresJson,
                    v.comment,
                    v.conflictDeclared,
                    v.submittedAt,
                    v.updatedAt,
                    u.name AS voterName,
                    u.email AS voterEmail
                FROM GovernanceVote v
                LEFT JOIN Users u ON u.oid = v.voterUserOid
                WHERE v.reviewId = @reviewId
                ORDER BY v.submittedAt ASC
            `);

        const criteriaSnapshot = normalizeCriteriaSnapshot(review.criteriaSnapshotJson);
        const votes = votesResult.recordset.map(vote => {
            let parsedScores = {};
            try {
                parsedScores = JSON.parse(vote.scoresJson || '{}');
            } catch {
                parsedScores = {};
            }
            return {
                id: vote.id.toString(),
                voterUserOid: vote.voterUserOid,
                voterName: vote.voterName || null,
                voterEmail: vote.voterEmail || null,
                scores: parsedScores,
                comment: vote.comment || null,
                conflictDeclared: !!vote.conflictDeclared,
                submittedAt: vote.submittedAt,
                updatedAt: vote.updatedAt
            };
        });

        const scoreSummary = calculatePriorityScore(criteriaSnapshot, votes);
        const eligibleVoterCount = participantsResult.recordset.filter(p => p.isEligibleVoter).length;
        const participationPct = eligibleVoterCount > 0
            ? Math.round((scoreSummary.voteCount / eligibleVoterCount) * 100)
            : 0;
        const policy = parsePolicySnapshot(review.policySnapshotJson) || (await fetchGovernancePolicySettings(pool, review.boardId));
        const requiredVotes = calculateRequiredVotes(eligibleVoterCount, policy);
        const quorumMet = scoreSummary.voteCount >= requiredVotes;
        const voteDeadlineAt = review.voteDeadlineAt || null;
        const deadlinePassed = voteDeadlineAt ? new Date(voteDeadlineAt).getTime() < Date.now() : false;
        const reviewStartedAt = parseDateOrNull(review.startedAt);
        const reviewDecidedAt = parseDateOrNull(review.decidedAt);
        const stageKey = getSubmissionWorkflowStage(submission);
        const stageSla = buildSlaSnapshot({
            stageKey,
            startedAt: getSubmissionSlaAnchor(submission, reviewStartedAt, reviewDecidedAt),
            policies: workflowSlaPolicies
        });

        res.json({
            submission: {
                id: submission.id.toString(),
                formId: submission.formId.toString(),
                formName: submission.formName,
                orgId: submission.orgId === null || submission.orgId === undefined ? null : String(submission.orgId),
                status: submission.status,
                submittedAt: submission.submittedAt,
                governanceRequired: !!submission.governanceRequired,
                governanceStatus: submission.governanceStatus,
                governanceDecision: submission.governanceDecision,
                governanceReason: submission.governanceReason,
                priorityScore: submission.priorityScore === null ? null : Number(submission.priorityScore),
                governanceBoardId: submission.governanceBoardId ? submission.governanceBoardId.toString() : null,
                governanceBoardName: submission.boardName || null,
                stageSla,
                lastSlaNudgedAt: submission.lastSlaNudgedAt || null,
                lastSlaNudgedByOid: submission.lastSlaNudgedByOid || null
            },
            review: {
                id: review.id.toString(),
                boardId: review.boardId.toString(),
                reviewRound: review.reviewRound,
                status: review.status,
                decision: review.decision || null,
                decisionReason: review.decisionReason || null,
                criteriaVersionId: review.criteriaVersionId ? review.criteriaVersionId.toString() : null,
                criteria: criteriaSnapshot.sort((a, b) => a.sortOrder - b.sortOrder),
                startedAt: review.startedAt,
                startedByOid: review.startedByOid || null,
                voteDeadlineAt,
                deadlinePassed,
                policy,
                decidedAt: review.decidedAt || null,
                decidedByOid: review.decidedByOid || null,
                participants: participantsResult.recordset.map(p => ({
                    id: p.id.toString(),
                    userOid: p.userOid,
                    participantRole: p.participantRole,
                    isEligibleVoter: !!p.isEligibleVoter,
                    userName: p.userName || null,
                    userEmail: p.userEmail || null,
                    createdAt: p.createdAt
                })),
                votes,
                scoreSummary: {
                    priorityScore: scoreSummary.priorityScore,
                    voteCount: scoreSummary.voteCount,
                    eligibleVoterCount,
                    participationPct,
                    requiredVotes,
                    quorumMet
                }
            }
        });
    } catch (err) {
        handleError(res, 'fetching submission governance details', err);
    }
});

// Submit or update a governance vote
router.post('/submissions/:id/governance/votes', requireAuth, governanceVoteLimiter, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const canVote = await hasPermission(user, 'can_vote_governance');
        if (!canVote) return res.status(403).json({ error: 'Forbidden' });

        const submissionId = parseInt(req.params.id, 10);
        if (Number.isNaN(submissionId)) return res.status(400).json({ error: 'Invalid submission id' });

        const pool = await getPool();
        if (!(await hasGovernanceSchema(pool)) || !(await hasGovernancePhase1Schema(pool))) {
            return res.status(503).json({ error: 'Governance phase 1 schema not installed. Run governance phase 1 migration first.' });
        }
        const phase3Ready = await hasGovernancePhase3Schema(pool);

        const reviewResult = await pool.request()
            .input('submissionId', sql.Int, submissionId)
            .query(`
                SELECT TOP 1
                    id, submissionId, status, criteriaSnapshotJson,
                    ${phase3Ready ? 'policySnapshotJson, voteDeadlineAt' : 'NULL AS policySnapshotJson, NULL AS voteDeadlineAt'}
                FROM GovernanceReview
                WHERE submissionId = @submissionId
                ORDER BY reviewRound DESC
            `);

        if (reviewResult.recordset.length === 0) {
            return res.status(409).json({ error: 'No governance review exists for this submission.' });
        }

        const review = reviewResult.recordset[0];
        if (review.status !== 'in-review') {
            return res.status(409).json({ error: 'Governance review is not open for voting.' });
        }
        if (review.voteDeadlineAt && new Date(review.voteDeadlineAt).getTime() < Date.now()) {
            return res.status(409).json({ error: 'Voting window has closed for this review.' });
        }

        const participantResult = await pool.request()
            .input('reviewId', sql.Int, review.id)
            .input('userOid', sql.NVarChar(100), user.oid)
            .query(`
                SELECT TOP 1 id, isEligibleVoter
                FROM GovernanceReviewParticipant
                WHERE reviewId = @reviewId AND userOid = @userOid
            `);

        if (participantResult.recordset.length === 0 || !participantResult.recordset[0].isEligibleVoter) {
            return res.status(403).json({ error: 'User is not an eligible voter for this review.' });
        }

        const criteria = normalizeCriteriaSnapshot(review.criteriaSnapshotJson);
        let normalizedScores;
        try {
            normalizedScores = validateVoteScores(req.body?.scores, criteria);
        } catch (validationErr) {
            return res.status(400).json({ error: validationErr.message });
        }

        const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : null;
        const conflictDeclared = req.body?.conflictDeclared === true;

        const existingVote = await pool.request()
            .input('reviewId', sql.Int, review.id)
            .input('voterUserOid', sql.NVarChar(100), user.oid)
            .query(`
                SELECT TOP 1 id
                FROM GovernanceVote
                WHERE reviewId = @reviewId AND voterUserOid = @voterUserOid
            `);

        let voteId;
        let action;
        if (existingVote.recordset.length > 0) {
            voteId = existingVote.recordset[0].id;
            action = 'update';
            await pool.request()
                .input('id', sql.Int, voteId)
                .input('scoresJson', sql.NVarChar(sql.MAX), JSON.stringify(normalizedScores))
                .input('comment', sql.NVarChar(sql.MAX), comment)
                .input('conflictDeclared', sql.Bit, conflictDeclared ? 1 : 0)
                .query(`
                    UPDATE GovernanceVote
                    SET scoresJson = @scoresJson,
                        comment = @comment,
                        conflictDeclared = @conflictDeclared,
                        updatedAt = GETDATE()
                    WHERE id = @id
                `);
        } else {
            action = 'create';
            const insertVote = await pool.request()
                .input('reviewId', sql.Int, review.id)
                .input('voterUserOid', sql.NVarChar(100), user.oid)
                .input('scoresJson', sql.NVarChar(sql.MAX), JSON.stringify(normalizedScores))
                .input('comment', sql.NVarChar(sql.MAX), comment)
                .input('conflictDeclared', sql.Bit, conflictDeclared ? 1 : 0)
                .query(`
                    INSERT INTO GovernanceVote (reviewId, voterUserOid, scoresJson, comment, conflictDeclared)
                    OUTPUT INSERTED.id
                    VALUES (@reviewId, @voterUserOid, @scoresJson, @comment, @conflictDeclared)
                `);
            voteId = insertVote.recordset[0].id;
        }

        const allVotesResult = await pool.request()
            .input('reviewId', sql.Int, review.id)
            .query('SELECT scoresJson FROM GovernanceVote WHERE reviewId = @reviewId');
        const allVotes = allVotesResult.recordset.map(v => {
            try {
                return { scores: JSON.parse(v.scoresJson || '{}') };
            } catch {
                return { scores: {} };
            }
        });
        const scoreSummary = calculatePriorityScore(criteria, allVotes);

        await pool.request()
            .input('submissionId', sql.Int, submissionId)
            .input('priorityScore', sql.Decimal(9, 2), scoreSummary.priorityScore)
            .query(`
                UPDATE IntakeSubmissions
                SET priorityScore = @priorityScore
                WHERE id = @submissionId
            `);

        logAudit({
            action: `submission.governance_vote_${action}`,
            entityType: 'submission',
            entityId: submissionId,
            entityTitle: `Submission ${submissionId}`,
            user,
            after: {
                reviewId: review.id,
                voteId,
                conflictDeclared,
                priorityScore: scoreSummary.priorityScore,
                voteCount: scoreSummary.voteCount
            },
            req
        });

        res.json({
            success: true,
            reviewId: review.id.toString(),
            voteId: voteId.toString(),
            priorityScore: scoreSummary.priorityScore,
            voteCount: scoreSummary.voteCount,
            voteDeadlineAt: review.voteDeadlineAt || null
        });
    } catch (err) {
        handleError(res, 'submitting governance vote', err);
    }
});

// Finalize governance decision for the active review
router.post('/submissions/:id/governance/decide', requireAuth, governanceDecisionLimiter, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const canDecide = await hasPermission(user, 'can_decide_governance');
        if (!canDecide) return res.status(403).json({ error: 'Forbidden' });

        const submissionId = parseInt(req.params.id, 10);
        if (Number.isNaN(submissionId)) return res.status(400).json({ error: 'Invalid submission id' });

        const decision = String(req.body?.decision || '').trim();
        const allowedDecisions = ['approved-now', 'approved-backlog', 'needs-info', 'rejected'];
        if (!allowedDecisions.includes(decision)) {
            return res.status(400).json({ error: `decision must be one of: ${allowedDecisions.join(', ')}` });
        }
        const decisionReason = typeof req.body?.decisionReason === 'string' ? req.body.decisionReason.trim() : null;

        const pool = await getPool();
        if (!(await hasGovernanceSchema(pool)) || !(await hasGovernancePhase1Schema(pool))) {
            return res.status(503).json({ error: 'Governance phase 1 schema not installed. Run governance phase 1 migration first.' });
        }
        const phase3Ready = await hasGovernancePhase3Schema(pool);

        const reviewResult = await pool.request()
            .input('submissionId', sql.Int, submissionId)
            .query(`
                SELECT TOP 1
                    id, status, criteriaSnapshotJson,
                    ${phase3Ready ? 'policySnapshotJson, voteDeadlineAt' : 'NULL AS policySnapshotJson, NULL AS voteDeadlineAt'}
                FROM GovernanceReview
                WHERE submissionId = @submissionId
                ORDER BY reviewRound DESC
            `);

        if (reviewResult.recordset.length === 0) {
            return res.status(409).json({ error: 'No governance review exists for this submission.' });
        }

        const review = reviewResult.recordset[0];
        if (review.status !== 'in-review') {
            return res.status(409).json({ error: 'Governance review is not open.' });
        }

        const chairParticipantResult = await pool.request()
            .input('reviewId', sql.Int, review.id)
            .input('userOid', sql.NVarChar(100), user.oid)
            .query(`
                SELECT TOP 1 id
                FROM GovernanceReviewParticipant
                WHERE reviewId = @reviewId
                  AND userOid = @userOid
                  AND participantRole = 'chair'
                  AND isEligibleVoter = 1
            `);
        if (chairParticipantResult.recordset.length === 0) {
            return res.status(403).json({ error: 'Only the governance chair for this review can record a final decision.' });
        }

        const allVotesResult = await pool.request()
            .input('reviewId', sql.Int, review.id)
            .query('SELECT scoresJson FROM GovernanceVote WHERE reviewId = @reviewId');
        const allVotes = allVotesResult.recordset.map(v => {
            try {
                return { scores: JSON.parse(v.scoresJson || '{}') };
            } catch {
                return { scores: {} };
            }
        });

        const criteria = normalizeCriteriaSnapshot(review.criteriaSnapshotJson);
        const scoreSummary = calculatePriorityScore(criteria, allVotes);
        let requiredVotes = 0;
        let quorumMet = true;
        let policy = { ...DEFAULT_GOVERNANCE_POLICY };
        if (phase3Ready) {
            policy = parsePolicySnapshot(review.policySnapshotJson) || (await fetchGovernancePolicySettings(pool, review.boardId));
            const participantsResult = await pool.request()
                .input('reviewId', sql.Int, review.id)
                .query(`
                    SELECT COUNT(*) AS eligibleVoterCount
                    FROM GovernanceReviewParticipant
                    WHERE reviewId = @reviewId AND isEligibleVoter = 1
                `);
            const eligibleVoterCount = Number(participantsResult.recordset[0]?.eligibleVoterCount || 0);
            requiredVotes = calculateRequiredVotes(eligibleVoterCount, policy);
            quorumMet = scoreSummary.voteCount >= requiredVotes;
            if (policy.decisionRequiresQuorum && !quorumMet) {
                return res.status(409).json({
                    error: `Quorum not met. ${scoreSummary.voteCount}/${requiredVotes} votes received.`,
                    quorum: {
                        requiredVotes,
                        voteCount: scoreSummary.voteCount,
                        quorumMet,
                        policy
                    }
                });
            }
        }

        const tx = new sql.Transaction(pool);
        try {
            await tx.begin();

            const reviewUpdate = new sql.Request(tx);
            await reviewUpdate
                .input('id', sql.Int, review.id)
                .input('decision', sql.NVarChar(30), decision)
                .input('decisionReason', sql.NVarChar(sql.MAX), decisionReason)
                .input('decidedByOid', sql.NVarChar(100), user.oid)
                .query(`
                    UPDATE GovernanceReview
                    SET status = 'decided',
                        decision = @decision,
                        decisionReason = @decisionReason,
                        decidedAt = GETDATE(),
                        decidedByOid = @decidedByOid
                    WHERE id = @id
                `);

            const submissionUpdate = new sql.Request(tx);
            await submissionUpdate
                .input('submissionId', sql.Int, submissionId)
                .input('decision', sql.NVarChar(30), decision)
                .input('decisionReason', sql.NVarChar(sql.MAX), decisionReason)
                .input('priorityScore', sql.Decimal(9, 2), scoreSummary.priorityScore)
                .query(`
                    UPDATE IntakeSubmissions
                    SET governanceStatus = 'decided',
                        governanceDecision = @decision,
                        governanceReason = @decisionReason,
                        priorityScore = COALESCE(@priorityScore, priorityScore)
                    WHERE id = @submissionId
                `);

            await tx.commit();
        } catch (err) {
            await tx.rollback();
            throw err;
        }

        logAudit({
            action: 'submission.governance_decide',
            entityType: 'submission',
            entityId: submissionId,
            entityTitle: `Submission ${submissionId}`,
            user,
            after: {
                reviewId: review.id,
                decision,
                decisionReason,
                priorityScore: scoreSummary.priorityScore,
                voteCount: scoreSummary.voteCount,
                requiredVotes,
                quorumMet,
                policy
            },
            req
        });

        res.json({
            success: true,
            reviewId: review.id.toString(),
            decision,
            priorityScore: scoreSummary.priorityScore,
            voteCount: scoreSummary.voteCount,
            quorum: {
                requiredVotes,
                quorumMet,
                policy
            }
        });
    } catch (err) {
        handleError(res, 'finalizing governance decision', err);
    }
});

// Add Message to Conversation (User or Admin)
router.post('/submissions/:id/message', requireAuth, intakeConversationLimiter, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const submissionId = parseInt(req.params.id);
        const { message } = req.body;

        if (!message) return res.status(400).json({ error: 'Message required' });

        const pool = await getPool();

        // Fetch current conversation
        const subResult = await pool.request()
            .input('id', sql.Int, submissionId)
            .query(`
                SELECT
                    s.infoRequests,
                    s.submitterId,
                    s.orgId,
                    f.governanceBoardId,
                    b.orgId AS boardOrgId
                FROM IntakeSubmissions s
                LEFT JOIN IntakeForms f ON f.id = s.formId
                LEFT JOIN GovernanceBoard b ON b.id = f.governanceBoardId
                WHERE s.id = @id
            `);

        if (subResult.recordset.length === 0) return res.status(404).json({ error: 'Submission not found' });

        const submission = subResult.recordset[0];
        const conversation = JSON.parse(submission.infoRequests || '[]');

        // Determine role and validate access
        // Determine role and validate access
        // Admin or Manager (with permission) can message any. Submitter can only message own.
        // We check for 'can_manage_intake' (Submission Management) OR 'can_view_incoming_requests' (Intake Access)
        const canManage = await hasPermission(user, ['can_manage_intake', 'can_view_incoming_requests']);
        const isOwner = submission.submitterId === user.oid;

        if (!canManage && !isOwner) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        if (canManage && !isOwner && !isAdminUser(user)) {
            const scope = await buildGovernanceSubmissionScope({ pool, user, submission });
            if (!hasGovernanceSubmissionScope(scope)) {
                return res.status(403).json({ error: 'Forbidden' });
            }
        }

        const senderType = canManage ? 'admin' : 'requester';

        // Add new message
        conversation.push({
            id: `msg-${Date.now()}`,
            type: senderType,
            message: message,
            timestamp: new Date().toISOString(),
            read: false,
            senderName: user.name
        });

        // Update DB (also update status if needed)
        let statusUpdate = '';
        if (senderType === 'admin') statusUpdate = ", status = 'awaiting-response'";
        if (senderType === 'requester') statusUpdate = ", status = 'pending'"; // Re-open for admin review

        const request = pool.request()
            .input('id', sql.Int, submissionId)
            .input('conversation', sql.NVarChar, JSON.stringify(conversation));

        await request.query(`UPDATE IntakeSubmissions SET infoRequests = @conversation ${statusUpdate} WHERE id = @id`);

        logAudit({ action: 'submission.message', entityType: 'submission', entityId: submissionId, entityTitle: `Message by ${user.name}`, user, after: { senderType, message: message.substring(0, 200) }, req });
        res.json({ success: true, conversation });
    } catch (err) {
        handleError(res, 'adding message', err);
    }
});

export default router;

import express from 'express';
import { getPool, sql } from '../db.js';
import { checkPermission, requireAuth, getAuthUser } from '../middleware/authMiddleware.js';
import { requireOrg } from '../middleware/orgScope.js';
import { handleError } from '../utils/errorHandler.js';
import { logAudit } from '../utils/auditLogger.js';

const router = express.Router();

const hasGovernanceSchema = async (pool) => {
    const result = await pool.request().query(`
        SELECT
            CASE WHEN OBJECT_ID('GovernanceSettings', 'U') IS NOT NULL THEN 1 ELSE 0 END AS hasSettings,
            CASE WHEN OBJECT_ID('GovernanceBoard', 'U') IS NOT NULL THEN 1 ELSE 0 END AS hasBoard,
            CASE WHEN OBJECT_ID('GovernanceMembership', 'U') IS NOT NULL THEN 1 ELSE 0 END AS hasMembership,
            CASE WHEN OBJECT_ID('GovernanceCriteriaVersion', 'U') IS NOT NULL THEN 1 ELSE 0 END AS hasCriteriaVersion,
            CASE WHEN COL_LENGTH('IntakeForms', 'governanceMode') IS NOT NULL THEN 1 ELSE 0 END AS hasFormMode,
            CASE WHEN COL_LENGTH('IntakeSubmissions', 'governanceRequired') IS NOT NULL THEN 1 ELSE 0 END AS hasSubmissionGovernance
    `);

    const row = result.recordset[0] || {};
    return !!(
        row.hasSettings &&
        row.hasBoard &&
        row.hasMembership &&
        row.hasCriteriaVersion &&
        row.hasFormMode &&
        row.hasSubmissionGovernance
    );
};

const parseBooleanOrNull = (value) => {
    if (value === true || value === false) return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return null;
};

const toFiniteIntOrNull = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.trunc(n);
};

const DEFAULT_GOVERNANCE_POLICY = Object.freeze({
    quorumPercent: 60,
    quorumMinCount: 1,
    decisionRequiresQuorum: true,
    voteWindowDays: null
});

const normalizeGovernancePolicy = (policy = {}) => {
    const rawPercent = Number(policy.quorumPercent);
    const rawMinCount = Number(policy.quorumMinCount);
    const rawWindowDays = policy.voteWindowDays === null || policy.voteWindowDays === undefined || policy.voteWindowDays === ''
        ? null
        : Number(policy.voteWindowDays);
    const percent = Number.isFinite(rawPercent) ? Math.min(100, Math.max(1, Math.trunc(rawPercent))) : DEFAULT_GOVERNANCE_POLICY.quorumPercent;
    const minCount = Number.isFinite(rawMinCount) ? Math.max(1, Math.trunc(rawMinCount)) : DEFAULT_GOVERNANCE_POLICY.quorumMinCount;
    let voteWindowDays = null;
    if (rawWindowDays !== null && Number.isFinite(rawWindowDays)) {
        voteWindowDays = Math.min(90, Math.max(1, Math.trunc(rawWindowDays)));
    }
    const decisionRequiresQuorum = policy.decisionRequiresQuorum === undefined
        ? DEFAULT_GOVERNANCE_POLICY.decisionRequiresQuorum
        : !!policy.decisionRequiresQuorum;

    return {
        quorumPercent: percent,
        quorumMinCount: minCount,
        decisionRequiresQuorum,
        voteWindowDays
    };
};

const hasGovernancePhase3Schema = async (pool) => {
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
};

const hasGovernanceBoardPolicySchema = async (pool) => {
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
};

const getDefaultGovernancePolicy = (settings, phase3Ready) => {
    if (!phase3Ready) return { ...DEFAULT_GOVERNANCE_POLICY };
    return normalizeGovernancePolicy({
        quorumPercent: settings?.quorumPercent,
        quorumMinCount: settings?.quorumMinCount,
        decisionRequiresQuorum: settings?.decisionRequiresQuorum,
        voteWindowDays: settings?.voteWindowDays
    });
};

const buildBoardPolicy = (boardRow, defaultPolicy, boardPolicyReady) => {
    const safeDefaults = normalizeGovernancePolicy(defaultPolicy);
    if (!boardPolicyReady) {
        return {
            useGlobalDefaults: true,
            source: 'global',
            overrides: {
                quorumPercent: null,
                quorumMinCount: null,
                decisionRequiresQuorum: null,
                voteWindowDays: null
            },
            effective: safeDefaults,
            sources: {
                quorumPercent: 'global',
                quorumMinCount: 'global',
                decisionRequiresQuorum: 'global',
                voteWindowDays: 'global'
            }
        };
    }

    const overrides = {
        quorumPercent: boardRow.quorumPercentOverride === null || boardRow.quorumPercentOverride === undefined
            ? null
            : Number(boardRow.quorumPercentOverride),
        quorumMinCount: boardRow.quorumMinCountOverride === null || boardRow.quorumMinCountOverride === undefined
            ? null
            : Number(boardRow.quorumMinCountOverride),
        decisionRequiresQuorum: boardRow.decisionRequiresQuorumOverride === null || boardRow.decisionRequiresQuorumOverride === undefined
            ? null
            : !!boardRow.decisionRequiresQuorumOverride,
        voteWindowDays: boardRow.voteWindowDaysOverride === null || boardRow.voteWindowDaysOverride === undefined
            ? null
            : Number(boardRow.voteWindowDaysOverride)
    };
    const effective = normalizeGovernancePolicy({
        quorumPercent: overrides.quorumPercent ?? safeDefaults.quorumPercent,
        quorumMinCount: overrides.quorumMinCount ?? safeDefaults.quorumMinCount,
        decisionRequiresQuorum: overrides.decisionRequiresQuorum ?? safeDefaults.decisionRequiresQuorum,
        voteWindowDays: overrides.voteWindowDays === null ? safeDefaults.voteWindowDays : overrides.voteWindowDays
    });
    const useGlobalDefaults = (
        overrides.quorumPercent === null &&
        overrides.quorumMinCount === null &&
        overrides.decisionRequiresQuorum === null &&
        overrides.voteWindowDays === null
    );

    return {
        useGlobalDefaults,
        source: useGlobalDefaults ? 'global' : 'board',
        overrides,
        effective,
        sources: {
            quorumPercent: overrides.quorumPercent === null ? 'global' : 'board',
            quorumMinCount: overrides.quorumMinCount === null ? 'global' : 'board',
            decisionRequiresQuorum: overrides.decisionRequiresQuorum === null ? 'global' : 'board',
            voteWindowDays: overrides.voteWindowDays === null ? 'global' : 'board'
        }
    };
};

const parseBoardPolicyPayload = (rawPolicy) => {
    if (rawPolicy === undefined) return null;
    if (!rawPolicy || typeof rawPolicy !== 'object' || Array.isArray(rawPolicy)) {
        throw new Error('boardPolicy must be an object');
    }

    const useGlobalDefaults = rawPolicy.useGlobalDefaults !== false;
    if (useGlobalDefaults) {
        return {
            useGlobalDefaults: true,
            overrides: {
                quorumPercent: null,
                quorumMinCount: null,
                decisionRequiresQuorum: null,
                voteWindowDays: null
            }
        };
    }

    if (
        rawPolicy.quorumPercent === undefined ||
        rawPolicy.quorumMinCount === undefined ||
        rawPolicy.decisionRequiresQuorum === undefined ||
        !Object.prototype.hasOwnProperty.call(rawPolicy, 'voteWindowDays')
    ) {
        throw new Error('boardPolicy custom mode requires quorumPercent, quorumMinCount, decisionRequiresQuorum, and voteWindowDays');
    }

    const quorumPercent = toFiniteIntOrNull(rawPolicy.quorumPercent);
    if (quorumPercent === null || quorumPercent < 1 || quorumPercent > 100) {
        throw new Error('boardPolicy.quorumPercent must be an integer between 1 and 100');
    }

    const quorumMinCount = toFiniteIntOrNull(rawPolicy.quorumMinCount);
    if (quorumMinCount === null || quorumMinCount < 1) {
        throw new Error('boardPolicy.quorumMinCount must be an integer >= 1');
    }

    const decisionRequiresQuorum = parseBooleanOrNull(rawPolicy.decisionRequiresQuorum);
    if (decisionRequiresQuorum === null) {
        throw new Error('boardPolicy.decisionRequiresQuorum must be boolean');
    }

    let voteWindowDays = null;
    if (rawPolicy.voteWindowDays !== null && rawPolicy.voteWindowDays !== '') {
        const parsedWindow = toFiniteIntOrNull(rawPolicy.voteWindowDays);
        if (parsedWindow === null || parsedWindow < 1 || parsedWindow > 90) {
            throw new Error('boardPolicy.voteWindowDays must be null or an integer between 1 and 90');
        }
        voteWindowDays = parsedWindow;
    }

    return {
        useGlobalDefaults: false,
        overrides: {
            quorumPercent,
            quorumMinCount,
            decisionRequiresQuorum,
            voteWindowDays
        }
    };
};

const normalizeCriteria = (criteria) => {
    if (!Array.isArray(criteria) || criteria.length === 0) {
        throw new Error('criteria must be a non-empty array');
    }

    return criteria.map((item, idx) => {
        if (!item || typeof item !== 'object') {
            throw new Error(`criteria[${idx}] must be an object`);
        }

        const name = typeof item.name === 'string' ? item.name.trim() : '';
        if (!name) {
            throw new Error(`criteria[${idx}].name is required`);
        }

        const weight = Number(item.weight);
        if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
            throw new Error(`criteria[${idx}].weight must be between 0 and 100`);
        }

        return {
            id: item.id || `criterion-${idx + 1}`,
            name,
            weight,
            enabled: item.enabled !== false,
            sortOrder: Number.isInteger(item.sortOrder) ? item.sortOrder : idx + 1
        };
    });
};

const assertPublishedWeightTotal = (criteria) => {
    const activeWeightTotal = criteria
        .filter(c => c.enabled)
        .reduce((sum, c) => sum + c.weight, 0);

    if (Math.abs(activeWeightTotal - 100) > 0.001) {
        throw new Error(`Active criteria weight must total 100 (found ${activeWeightTotal})`);
    }
};

async function getOrCreateGovernanceSettings(pool) {
    const existing = await pool.request().query('SELECT TOP 1 * FROM GovernanceSettings ORDER BY id');
    if (existing.recordset.length > 0) {
        return existing.recordset[0];
    }

    const inserted = await pool.request()
        .query('INSERT INTO GovernanceSettings (governanceEnabled) OUTPUT INSERTED.* VALUES (0)');
    return inserted.recordset[0];
}

router.use(async (req, res, next) => {
    try {
        const pool = await getPool();
        const ready = await hasGovernanceSchema(pool);
        if (!ready) {
            return res.status(503).json({
                error: 'Governance schema not installed. Run migration: npm run migrate:governance:phase0 (from /server).'
            });
        }
        return next();
    } catch (err) {
        return handleError(res, 'checking governance schema', err);
    }
});

// ==================== SETTINGS ====================

router.get('/settings', requireAuth, async (req, res) => {
    try {
        const pool = await getPool();
        const settings = await getOrCreateGovernanceSettings(pool);
        const phase3Ready = await hasGovernancePhase3Schema(pool);
        const boardPolicyReady = phase3Ready ? await hasGovernanceBoardPolicySchema(pool) : false;
        const defaults = getDefaultGovernancePolicy(settings, phase3Ready);
        res.json({
            governanceEnabled: !!settings.governanceEnabled,
            quorumPercent: defaults.quorumPercent,
            quorumMinCount: defaults.quorumMinCount,
            decisionRequiresQuorum: defaults.decisionRequiresQuorum,
            voteWindowDays: defaults.voteWindowDays,
            defaultQuorumPercent: defaults.quorumPercent,
            defaultQuorumMinCount: defaults.quorumMinCount,
            defaultDecisionRequiresQuorum: defaults.decisionRequiresQuorum,
            defaultVoteWindowDays: defaults.voteWindowDays,
            phase3Ready,
            boardPolicyReady,
            updatedAt: settings.updatedAt,
            updatedByOid: settings.updatedByOid || null
        });
    } catch (err) {
        handleError(res, 'fetching governance settings', err);
    }
});

router.put('/settings', checkPermission('can_manage_governance'), async (req, res) => {
    try {
        const { governanceEnabled } = req.body;
        if (typeof governanceEnabled !== 'boolean') {
            return res.status(400).json({ error: 'governanceEnabled (boolean) is required' });
        }

        const pool = await getPool();
        const phase3Ready = await hasGovernancePhase3Schema(pool);
        const current = await getOrCreateGovernanceSettings(pool);
        const user = getAuthUser(req);

        const currentQuorumPercent = Number(current.quorumPercent || 60);
        const currentQuorumMinCount = Number(current.quorumMinCount || 1);
        const currentDecisionRequiresQuorum = current.decisionRequiresQuorum === undefined ? true : !!current.decisionRequiresQuorum;
        const currentVoteWindowDays = current.voteWindowDays === undefined ? null : current.voteWindowDays;

        let quorumPercent = currentQuorumPercent;
        let quorumMinCount = currentQuorumMinCount;
        let decisionRequiresQuorum = currentDecisionRequiresQuorum;
        let voteWindowDays = currentVoteWindowDays;

        if (phase3Ready) {
            const quorumPercentInput = req.body.defaultQuorumPercent !== undefined
                ? req.body.defaultQuorumPercent
                : req.body.quorumPercent;
            const quorumMinInput = req.body.defaultQuorumMinCount !== undefined
                ? req.body.defaultQuorumMinCount
                : req.body.quorumMinCount;
            const decisionRequiresQuorumInput = req.body.defaultDecisionRequiresQuorum !== undefined
                ? req.body.defaultDecisionRequiresQuorum
                : req.body.decisionRequiresQuorum;
            const voteWindowInput = req.body.defaultVoteWindowDays !== undefined
                ? req.body.defaultVoteWindowDays
                : req.body.voteWindowDays;

            if (quorumPercentInput !== undefined) {
                const parsed = toFiniteIntOrNull(quorumPercentInput);
                if (parsed === null || parsed < 1 || parsed > 100) {
                    return res.status(400).json({ error: 'defaultQuorumPercent must be an integer between 1 and 100' });
                }
                quorumPercent = parsed;
            }
            if (quorumMinInput !== undefined) {
                const parsed = toFiniteIntOrNull(quorumMinInput);
                if (parsed === null || parsed < 1) {
                    return res.status(400).json({ error: 'defaultQuorumMinCount must be an integer >= 1' });
                }
                quorumMinCount = parsed;
            }
            if (decisionRequiresQuorumInput !== undefined) {
                if (typeof decisionRequiresQuorumInput !== 'boolean') {
                    return res.status(400).json({ error: 'defaultDecisionRequiresQuorum must be boolean' });
                }
                decisionRequiresQuorum = decisionRequiresQuorumInput;
            }
            if (voteWindowInput !== undefined) {
                if (voteWindowInput === null || voteWindowInput === '') {
                    voteWindowDays = null;
                } else {
                    const parsed = toFiniteIntOrNull(voteWindowInput);
                    if (parsed === null || parsed < 1 || parsed > 90) {
                        return res.status(400).json({ error: 'defaultVoteWindowDays must be null or an integer between 1 and 90' });
                    }
                    voteWindowDays = parsed;
                }
            }
        }

        const request = pool.request()
            .input('id', sql.Int, current.id)
            .input('governanceEnabled', sql.Bit, governanceEnabled ? 1 : 0)
            .input('updatedByOid', sql.NVarChar(100), user?.oid || null);

        if (phase3Ready) {
            await request
                .input('quorumPercent', sql.Int, quorumPercent)
                .input('quorumMinCount', sql.Int, quorumMinCount)
                .input('decisionRequiresQuorum', sql.Bit, decisionRequiresQuorum ? 1 : 0)
                .input('voteWindowDays', sql.Int, voteWindowDays)
                .query(`
                    UPDATE GovernanceSettings
                    SET governanceEnabled = @governanceEnabled,
                        quorumPercent = @quorumPercent,
                        quorumMinCount = @quorumMinCount,
                        decisionRequiresQuorum = @decisionRequiresQuorum,
                        voteWindowDays = @voteWindowDays,
                        updatedAt = GETDATE(),
                        updatedByOid = @updatedByOid
                    WHERE id = @id
                `);
        } else {
            await request.query(`
                UPDATE GovernanceSettings
                SET governanceEnabled = @governanceEnabled,
                    updatedAt = GETDATE(),
                    updatedByOid = @updatedByOid
                WHERE id = @id
            `);
        }

        logAudit({
            action: 'governance.settings_update',
            entityType: 'governance_settings',
            entityId: current.id,
            entityTitle: 'Global Governance Settings',
            user,
            before: {
                governanceEnabled: !!current.governanceEnabled,
                quorumPercent: currentQuorumPercent,
                quorumMinCount: currentQuorumMinCount,
                decisionRequiresQuorum: currentDecisionRequiresQuorum,
                voteWindowDays: currentVoteWindowDays
            },
            after: {
                governanceEnabled,
                quorumPercent: phase3Ready ? quorumPercent : currentQuorumPercent,
                quorumMinCount: phase3Ready ? quorumMinCount : currentQuorumMinCount,
                decisionRequiresQuorum: phase3Ready ? decisionRequiresQuorum : currentDecisionRequiresQuorum,
                voteWindowDays: phase3Ready ? voteWindowDays : currentVoteWindowDays
            },
            req
        });

        const boardPolicyReady = phase3Ready ? await hasGovernanceBoardPolicySchema(pool) : false;
        res.json({
            success: true,
            governanceEnabled,
            quorumPercent: phase3Ready ? quorumPercent : currentQuorumPercent,
            quorumMinCount: phase3Ready ? quorumMinCount : currentQuorumMinCount,
            decisionRequiresQuorum: phase3Ready ? decisionRequiresQuorum : currentDecisionRequiresQuorum,
            voteWindowDays: phase3Ready ? voteWindowDays : currentVoteWindowDays,
            defaultQuorumPercent: phase3Ready ? quorumPercent : currentQuorumPercent,
            defaultQuorumMinCount: phase3Ready ? quorumMinCount : currentQuorumMinCount,
            defaultDecisionRequiresQuorum: phase3Ready ? decisionRequiresQuorum : currentDecisionRequiresQuorum,
            defaultVoteWindowDays: phase3Ready ? voteWindowDays : currentVoteWindowDays,
            phase3Ready,
            boardPolicyReady
        });
    } catch (err) {
        handleError(res, 'updating governance settings', err);
    }
});

// ==================== BOARDS ====================

router.get('/users', checkPermission('can_manage_governance'), async (req, res) => {
    try {
        const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        const requestedLimit = parseInt(req.query.limit, 10);
        const limit = Number.isNaN(requestedLimit)
            ? 25
            : Math.max(1, Math.min(100, requestedLimit));

        const pool = await getPool();
        const request = pool.request()
            .input('limit', sql.Int, limit);

        let whereClause = '';
        let orderClause = `
            ORDER BY
                CASE WHEN u.lastLogin IS NULL THEN 1 ELSE 0 END,
                u.lastLogin DESC,
                u.name ASC
        `;

        if (rawQuery) {
            request
                .input('q', sql.NVarChar(255), rawQuery)
                .input('qContains', sql.NVarChar(260), `%${rawQuery}%`)
                .input('qPrefix', sql.NVarChar(260), `${rawQuery}%`);

            whereClause = `
                WHERE u.name LIKE @qContains
                   OR u.email LIKE @qContains
                   OR u.oid LIKE @qContains
            `;
            orderClause = `
                ORDER BY
                    CASE
                        WHEN u.name = @q THEN 0
                        WHEN u.email = @q THEN 1
                        WHEN u.name LIKE @qPrefix THEN 2
                        WHEN u.email LIKE @qPrefix THEN 3
                        ELSE 4
                    END,
                    CASE WHEN u.lastLogin IS NULL THEN 1 ELSE 0 END,
                    u.lastLogin DESC,
                    u.name ASC
            `;
        }

        const result = await request.query(`
            SELECT TOP (@limit)
                u.oid,
                u.name,
                u.email,
                u.lastLogin
            FROM Users u
            ${whereClause}
            ${orderClause}
        `);

        res.json(result.recordset.map(row => ({
            oid: row.oid,
            name: row.name,
            email: row.email || null,
            lastLogin: row.lastLogin || null
        })));
    } catch (err) {
        handleError(res, 'fetching governance users', err);
    }
});

router.get('/boards', checkPermission(['can_view_governance_queue', 'can_manage_governance']), async (req, res) => {
    try {
        const includeInactive = parseBooleanOrNull(req.query.includeInactive);
        const pool = await getPool();
        const phase3Ready = await hasGovernancePhase3Schema(pool);
        const boardPolicyReady = phase3Ready ? await hasGovernanceBoardPolicySchema(pool) : false;
        const settings = await getOrCreateGovernanceSettings(pool);
        const defaultPolicy = getDefaultGovernancePolicy(settings, phase3Ready);

        const request = pool.request();
        let where = '';
        if (includeInactive !== true) {
            where = 'WHERE b.isActive = 1';
        }
        const boardPolicySelect = boardPolicyReady
            ? `
                b.quorumPercentOverride,
                b.quorumMinCountOverride,
                b.decisionRequiresQuorumOverride,
                b.voteWindowDaysOverride,
            `
            : `
                NULL AS quorumPercentOverride,
                NULL AS quorumMinCountOverride,
                NULL AS decisionRequiresQuorumOverride,
                NULL AS voteWindowDaysOverride,
            `;

        const result = await request.query(`
            SELECT
                b.id,
                b.name,
                b.isActive,
                b.createdAt,
                b.createdByOid,
                ${boardPolicySelect}
                (
                    SELECT COUNT(*)
                    FROM GovernanceMembership gm
                    WHERE gm.boardId = b.id
                      AND gm.isActive = 1
                      AND (gm.effectiveTo IS NULL OR gm.effectiveTo > GETDATE())
                ) AS activeMemberCount
            FROM GovernanceBoard b
            ${where}
            ORDER BY b.name ASC
        `);

        res.json(result.recordset.map(row => {
            const policy = buildBoardPolicy(row, defaultPolicy, boardPolicyReady);
            return {
                id: row.id.toString(),
                name: row.name,
                isActive: !!row.isActive,
                createdAt: row.createdAt,
                createdByOid: row.createdByOid || null,
                activeMemberCount: Number(row.activeMemberCount || 0),
                policy,
                policySource: policy.source,
                useGlobalPolicyDefaults: policy.useGlobalDefaults,
                policyOverrides: policy.overrides,
                effectivePolicy: policy.effective,
                policySources: policy.sources,
                boardPolicyReady
            };
        }));
    } catch (err) {
        handleError(res, 'fetching governance boards', err);
    }
});

router.post('/boards', checkPermission('can_manage_governance'), async (req, res) => {
    try {
        const { name, isActive } = req.body;
        const trimmedName = typeof name === 'string' ? name.trim() : '';
        if (!trimmedName) return res.status(400).json({ error: 'name is required' });

        const user = getAuthUser(req);
        const pool = await getPool();
        const phase3Ready = await hasGovernancePhase3Schema(pool);
        const boardPolicyReady = phase3Ready ? await hasGovernanceBoardPolicySchema(pool) : false;
        const parsedBoardPolicy = parseBoardPolicyPayload(req.body?.boardPolicy);
        if (parsedBoardPolicy && !boardPolicyReady) {
            return res.status(409).json({
                error: 'Board policy overrides are not available yet. Run `npm run migrate:governance:phase3` in `server`.'
            });
        }

        const policyOverrides = parsedBoardPolicy?.overrides || {
            quorumPercent: null,
            quorumMinCount: null,
            decisionRequiresQuorum: null,
            voteWindowDays: null
        };

        const insertRequest = pool.request()
            .input('name', sql.NVarChar(255), trimmedName)
            .input('isActive', sql.Bit, isActive === false ? 0 : 1)
            .input('createdByOid', sql.NVarChar(100), user?.oid || null);

        let result;
        if (boardPolicyReady) {
            result = await insertRequest
                .input('quorumPercentOverride', sql.Int, policyOverrides.quorumPercent)
                .input('quorumMinCountOverride', sql.Int, policyOverrides.quorumMinCount)
                .input('decisionRequiresQuorumOverride', sql.Bit, policyOverrides.decisionRequiresQuorum === null ? null : (policyOverrides.decisionRequiresQuorum ? 1 : 0))
                .input('voteWindowDaysOverride', sql.Int, policyOverrides.voteWindowDays)
                .query(`
                    INSERT INTO GovernanceBoard (
                        name,
                        isActive,
                        createdByOid,
                        quorumPercentOverride,
                        quorumMinCountOverride,
                        decisionRequiresQuorumOverride,
                        voteWindowDaysOverride
                    )
                    OUTPUT INSERTED.id, INSERTED.createdAt
                    VALUES (
                        @name,
                        @isActive,
                        @createdByOid,
                        @quorumPercentOverride,
                        @quorumMinCountOverride,
                        @decisionRequiresQuorumOverride,
                        @voteWindowDaysOverride
                    )
                `);
        } else {
            result = await insertRequest.query(`
                INSERT INTO GovernanceBoard (name, isActive, createdByOid)
                OUTPUT INSERTED.id, INSERTED.createdAt
                VALUES (@name, @isActive, @createdByOid)
            `);
        }

        const boardId = result.recordset[0].id.toString();
        const settings = await getOrCreateGovernanceSettings(pool);
        const defaultPolicy = getDefaultGovernancePolicy(settings, phase3Ready);
        const policy = parsedBoardPolicy
            ? {
                useGlobalDefaults: parsedBoardPolicy.useGlobalDefaults,
                source: parsedBoardPolicy.useGlobalDefaults ? 'global' : 'board',
                overrides: policyOverrides,
                effective: parsedBoardPolicy.useGlobalDefaults ? defaultPolicy : normalizeGovernancePolicy(policyOverrides),
                sources: {
                    quorumPercent: parsedBoardPolicy.useGlobalDefaults ? 'global' : 'board',
                    quorumMinCount: parsedBoardPolicy.useGlobalDefaults ? 'global' : 'board',
                    decisionRequiresQuorum: parsedBoardPolicy.useGlobalDefaults ? 'global' : 'board',
                    voteWindowDays: parsedBoardPolicy.useGlobalDefaults ? 'global' : 'board'
                }
            }
            : buildBoardPolicy({}, defaultPolicy, boardPolicyReady);

        logAudit({
            action: 'governance.board_create',
            entityType: 'governance_board',
            entityId: boardId,
            entityTitle: trimmedName,
            user,
            after: {
                name: trimmedName,
                isActive: isActive !== false,
                boardPolicy: parsedBoardPolicy ? policy : { useGlobalDefaults: true, source: 'global' }
            },
            req
        });

        res.json({
            id: boardId,
            name: trimmedName,
            isActive: isActive !== false,
            createdAt: result.recordset[0].createdAt,
            policy,
            policySource: policy.source,
            useGlobalPolicyDefaults: policy.useGlobalDefaults,
            policyOverrides: policy.overrides,
            effectivePolicy: policy.effective,
            policySources: policy.sources,
            boardPolicyReady
        });
    } catch (err) {
        if (err?.message?.startsWith('boardPolicy')) {
            return res.status(400).json({ error: err.message });
        }
        handleError(res, 'creating governance board', err);
    }
});

router.put('/boards/:id', checkPermission('can_manage_governance'), async (req, res) => {
    try {
        const boardId = parseInt(req.params.id, 10);
        if (Number.isNaN(boardId)) return res.status(400).json({ error: 'Invalid board id' });

        const { name, isActive } = req.body;
        const pool = await getPool();
        const phase3Ready = await hasGovernancePhase3Schema(pool);
        const boardPolicyReady = phase3Ready ? await hasGovernanceBoardPolicySchema(pool) : false;
        const parsedBoardPolicy = parseBoardPolicyPayload(req.body?.boardPolicy);
        if (parsedBoardPolicy && !boardPolicyReady) {
            return res.status(409).json({
                error: 'Board policy overrides are not available yet. Run `npm run migrate:governance:phase3` in `server`.'
            });
        }

        const selectPolicyColumns = boardPolicyReady
            ? ', quorumPercentOverride, quorumMinCountOverride, decisionRequiresQuorumOverride, voteWindowDaysOverride'
            : '';
        const prev = await pool.request()
            .input('id', sql.Int, boardId)
            .query(`SELECT id, name, isActive${selectPolicyColumns} FROM GovernanceBoard WHERE id = @id`);

        if (prev.recordset.length === 0) return res.status(404).json({ error: 'Board not found' });

        const request = pool.request().input('id', sql.Int, boardId);
        const updates = [];
        if (name !== undefined) {
            const trimmedName = typeof name === 'string' ? name.trim() : '';
            if (!trimmedName) return res.status(400).json({ error: 'name cannot be empty' });
            request.input('name', sql.NVarChar(255), trimmedName);
            updates.push('name = @name');
        }
        if (isActive !== undefined) {
            const parsed = parseBooleanOrNull(isActive);
            if (parsed === null) return res.status(400).json({ error: 'isActive must be boolean' });
            request.input('isActive', sql.Bit, parsed ? 1 : 0);
            updates.push('isActive = @isActive');
        }
        if (parsedBoardPolicy) {
            request.input('quorumPercentOverride', sql.Int, parsedBoardPolicy.overrides.quorumPercent);
            request.input('quorumMinCountOverride', sql.Int, parsedBoardPolicy.overrides.quorumMinCount);
            request.input('decisionRequiresQuorumOverride', sql.Bit, parsedBoardPolicy.overrides.decisionRequiresQuorum === null
                ? null
                : (parsedBoardPolicy.overrides.decisionRequiresQuorum ? 1 : 0));
            request.input('voteWindowDaysOverride', sql.Int, parsedBoardPolicy.overrides.voteWindowDays);

            updates.push('quorumPercentOverride = @quorumPercentOverride');
            updates.push('quorumMinCountOverride = @quorumMinCountOverride');
            updates.push('decisionRequiresQuorumOverride = @decisionRequiresQuorumOverride');
            updates.push('voteWindowDaysOverride = @voteWindowDaysOverride');
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        await request.query(`UPDATE GovernanceBoard SET ${updates.join(', ')} WHERE id = @id`);
        const user = getAuthUser(req);
        logAudit({
            action: 'governance.board_update',
            entityType: 'governance_board',
            entityId: boardId,
            entityTitle: name || prev.recordset[0].name,
            user,
            before: prev.recordset[0],
            after: { name, isActive, boardPolicy: parsedBoardPolicy || undefined },
            req
        });

        res.json({ success: true, boardPolicyReady });
    } catch (err) {
        if (err?.message?.startsWith('boardPolicy')) {
            return res.status(400).json({ error: err.message });
        }
        handleError(res, 'updating governance board', err);
    }
});

router.get('/boards/:id/members', checkPermission(['can_view_governance_queue', 'can_manage_governance']), async (req, res) => {
    try {
        const boardId = parseInt(req.params.id, 10);
        if (Number.isNaN(boardId)) return res.status(400).json({ error: 'Invalid board id' });

        const includeInactive = parseBooleanOrNull(req.query.includeInactive);
        const pool = await getPool();
        const request = pool.request().input('boardId', sql.Int, boardId);

        const where = includeInactive === true ? '' : 'AND gm.isActive = 1';
        const result = await request.query(`
            SELECT
                gm.id,
                gm.boardId,
                gm.userOid,
                gm.role,
                gm.isActive,
                gm.effectiveFrom,
                gm.effectiveTo,
                gm.createdAt,
                u.name AS userName,
                u.email AS userEmail
            FROM GovernanceMembership gm
            LEFT JOIN Users u ON u.oid = gm.userOid
            WHERE gm.boardId = @boardId
              ${where}
            ORDER BY gm.createdAt DESC
        `);

        res.json(result.recordset.map(row => ({
            id: row.id.toString(),
            boardId: row.boardId.toString(),
            userOid: row.userOid,
            role: row.role,
            isActive: !!row.isActive,
            effectiveFrom: row.effectiveFrom,
            effectiveTo: row.effectiveTo,
            createdAt: row.createdAt,
            userName: row.userName || null,
            userEmail: row.userEmail || null
        })));
    } catch (err) {
        handleError(res, 'fetching governance members', err);
    }
});

router.post('/boards/:id/members', checkPermission('can_manage_governance'), async (req, res) => {
    try {
        const boardId = parseInt(req.params.id, 10);
        if (Number.isNaN(boardId)) return res.status(400).json({ error: 'Invalid board id' });

        const { userOid, role, isActive, effectiveFrom, effectiveTo } = req.body;
        const trimmedOid = typeof userOid === 'string' ? userOid.trim() : '';
        if (!trimmedOid) return res.status(400).json({ error: 'userOid is required' });

        const memberRole = role === 'chair' ? 'chair' : 'member';
        const activeFlag = isActive === false ? 0 : 1;

        const pool = await getPool();
        const user = getAuthUser(req);
        const boardResult = await pool.request()
            .input('id', sql.Int, boardId)
            .query('SELECT id, name FROM GovernanceBoard WHERE id = @id');
        if (boardResult.recordset.length === 0) return res.status(404).json({ error: 'Board not found' });

        const directoryUserResult = await pool.request()
            .input('oid', sql.NVarChar(100), trimmedOid)
            .query('SELECT TOP 1 oid, name, email FROM Users WHERE oid = @oid');
        if (directoryUserResult.recordset.length === 0) {
            return res.status(400).json({ error: 'User not found in Users table' });
        }
        const directoryUser = directoryUserResult.recordset[0];

        const existing = await pool.request()
            .input('boardId', sql.Int, boardId)
            .input('userOid', sql.NVarChar(100), trimmedOid)
            .query(`
                SELECT TOP 1 id, role, isActive, effectiveFrom, effectiveTo
                FROM GovernanceMembership
                WHERE boardId = @boardId AND userOid = @userOid
                ORDER BY createdAt DESC
            `);

        let membershipId;
        if (existing.recordset.length > 0) {
            membershipId = existing.recordset[0].id;
            await pool.request()
                .input('id', sql.Int, membershipId)
                .input('role', sql.NVarChar(20), memberRole)
                .input('isActive', sql.Bit, activeFlag)
                .input('effectiveFrom', sql.DateTime2, effectiveFrom ? new Date(effectiveFrom) : existing.recordset[0].effectiveFrom)
                .input('effectiveTo', sql.DateTime2, effectiveTo ? new Date(effectiveTo) : null)
                .query(`
                    UPDATE GovernanceMembership
                    SET role = @role,
                        isActive = @isActive,
                        effectiveFrom = @effectiveFrom,
                        effectiveTo = @effectiveTo
                    WHERE id = @id
                `);
        } else {
            const inserted = await pool.request()
                .input('boardId', sql.Int, boardId)
                .input('userOid', sql.NVarChar(100), trimmedOid)
                .input('role', sql.NVarChar(20), memberRole)
                .input('isActive', sql.Bit, activeFlag)
                .input('effectiveFrom', sql.DateTime2, effectiveFrom ? new Date(effectiveFrom) : new Date())
                .input('effectiveTo', sql.DateTime2, effectiveTo ? new Date(effectiveTo) : null)
                .input('createdByOid', sql.NVarChar(100), user?.oid || null)
                .query(`
                    INSERT INTO GovernanceMembership (boardId, userOid, role, isActive, effectiveFrom, effectiveTo, createdByOid)
                    OUTPUT INSERTED.id
                    VALUES (@boardId, @userOid, @role, @isActive, @effectiveFrom, @effectiveTo, @createdByOid)
                `);
            membershipId = inserted.recordset[0].id;
        }

        logAudit({
            action: 'governance.member_upsert',
            entityType: 'governance_membership',
            entityId: membershipId,
            entityTitle: `${boardResult.recordset[0].name}: ${directoryUser.name || trimmedOid}`,
            user,
            after: {
                boardId,
                userOid: trimmedOid,
                userName: directoryUser.name || null,
                userEmail: directoryUser.email || null,
                role: memberRole,
                isActive: !!activeFlag,
                effectiveFrom,
                effectiveTo
            },
            req
        });

        res.json({ success: true, id: membershipId.toString() });
    } catch (err) {
        handleError(res, 'upserting governance member', err);
    }
});

// ==================== CRITERIA VERSIONS ====================

router.get('/boards/:id/criteria/versions', checkPermission(['can_view_governance_queue', 'can_manage_governance']), async (req, res) => {
    try {
        const boardId = parseInt(req.params.id, 10);
        if (Number.isNaN(boardId)) return res.status(400).json({ error: 'Invalid board id' });

        const pool = await getPool();
        const result = await pool.request()
            .input('boardId', sql.Int, boardId)
            .query(`
                SELECT id, boardId, versionNo, status, criteriaJson, publishedAt, publishedByOid, createdAt, createdByOid
                FROM GovernanceCriteriaVersion
                WHERE boardId = @boardId
                ORDER BY versionNo DESC
            `);

        const versions = result.recordset.map(v => ({
            id: v.id.toString(),
            boardId: v.boardId.toString(),
            versionNo: v.versionNo,
            status: v.status,
            criteria: JSON.parse(v.criteriaJson || '[]'),
            publishedAt: v.publishedAt,
            publishedByOid: v.publishedByOid || null,
            createdAt: v.createdAt,
            createdByOid: v.createdByOid || null
        }));

        res.json(versions);
    } catch (err) {
        handleError(res, 'fetching governance criteria versions', err);
    }
});

router.post('/boards/:id/criteria/versions', checkPermission('can_manage_governance'), async (req, res) => {
    try {
        const boardId = parseInt(req.params.id, 10);
        if (Number.isNaN(boardId)) return res.status(400).json({ error: 'Invalid board id' });

        const criteria = normalizeCriteria(req.body.criteria);
        const user = getAuthUser(req);
        const pool = await getPool();

        const boardExists = await pool.request()
            .input('id', sql.Int, boardId)
            .query('SELECT id FROM GovernanceBoard WHERE id = @id');
        if (boardExists.recordset.length === 0) return res.status(404).json({ error: 'Board not found' });

        const nextVersionResult = await pool.request()
            .input('boardId', sql.Int, boardId)
            .query('SELECT ISNULL(MAX(versionNo), 0) + 1 AS nextVersion FROM GovernanceCriteriaVersion WHERE boardId = @boardId');
        const nextVersion = nextVersionResult.recordset[0].nextVersion;

        const inserted = await pool.request()
            .input('boardId', sql.Int, boardId)
            .input('versionNo', sql.Int, nextVersion)
            .input('status', sql.NVarChar(20), 'draft')
            .input('criteriaJson', sql.NVarChar(sql.MAX), JSON.stringify(criteria))
            .input('createdByOid', sql.NVarChar(100), user?.oid || null)
            .query(`
                INSERT INTO GovernanceCriteriaVersion (boardId, versionNo, status, criteriaJson, createdByOid)
                OUTPUT INSERTED.id, INSERTED.createdAt
                VALUES (@boardId, @versionNo, @status, @criteriaJson, @createdByOid)
            `);

        const createdId = inserted.recordset[0].id.toString();
        logAudit({
            action: 'governance.criteria_version_create',
            entityType: 'governance_criteria_version',
            entityId: createdId,
            entityTitle: `Board ${boardId} v${nextVersion}`,
            user,
            after: { boardId, versionNo: nextVersion, status: 'draft', criteriaCount: criteria.length },
            req
        });

        res.json({
            id: createdId,
            boardId: boardId.toString(),
            versionNo: nextVersion,
            status: 'draft',
            criteria,
            createdAt: inserted.recordset[0].createdAt
        });
    } catch (err) {
        if (err.message?.includes('criteria')) {
            return res.status(400).json({ error: err.message });
        }
        handleError(res, 'creating governance criteria version', err);
    }
});

router.put('/boards/:id/criteria/versions/:versionId', checkPermission('can_manage_governance'), async (req, res) => {
    try {
        const boardId = parseInt(req.params.id, 10);
        const versionId = parseInt(req.params.versionId, 10);
        if (Number.isNaN(boardId) || Number.isNaN(versionId)) {
            return res.status(400).json({ error: 'Invalid board/version id' });
        }

        const criteria = normalizeCriteria(req.body.criteria);
        const pool = await getPool();

        const existing = await pool.request()
            .input('id', sql.Int, versionId)
            .input('boardId', sql.Int, boardId)
            .query(`
                SELECT id, boardId, versionNo, status
                FROM GovernanceCriteriaVersion
                WHERE id = @id AND boardId = @boardId
            `);
        if (existing.recordset.length === 0) return res.status(404).json({ error: 'Criteria version not found' });
        if (existing.recordset[0].status !== 'draft') {
            return res.status(409).json({ error: 'Only draft versions can be edited' });
        }

        await pool.request()
            .input('id', sql.Int, versionId)
            .input('criteriaJson', sql.NVarChar(sql.MAX), JSON.stringify(criteria))
            .query('UPDATE GovernanceCriteriaVersion SET criteriaJson = @criteriaJson WHERE id = @id');

        const user = getAuthUser(req);
        logAudit({
            action: 'governance.criteria_version_update',
            entityType: 'governance_criteria_version',
            entityId: versionId,
            entityTitle: `Board ${boardId} v${existing.recordset[0].versionNo}`,
            user,
            after: { boardId, versionId, criteriaCount: criteria.length },
            req
        });

        res.json({ success: true });
    } catch (err) {
        if (err.message?.includes('criteria')) {
            return res.status(400).json({ error: err.message });
        }
        handleError(res, 'updating governance criteria version', err);
    }
});

router.post('/boards/:id/criteria/versions/:versionId/publish', checkPermission('can_manage_governance'), async (req, res) => {
    try {
        const boardId = parseInt(req.params.id, 10);
        const versionId = parseInt(req.params.versionId, 10);
        if (Number.isNaN(boardId) || Number.isNaN(versionId)) {
            return res.status(400).json({ error: 'Invalid board/version id' });
        }

        const pool = await getPool();
        const user = getAuthUser(req);
        const target = await pool.request()
            .input('id', sql.Int, versionId)
            .input('boardId', sql.Int, boardId)
            .query(`
                SELECT id, boardId, versionNo, status, criteriaJson
                FROM GovernanceCriteriaVersion
                WHERE id = @id AND boardId = @boardId
            `);

        if (target.recordset.length === 0) return res.status(404).json({ error: 'Criteria version not found' });
        if (target.recordset[0].status === 'retired') return res.status(409).json({ error: 'Retired version cannot be published' });

        const parsedCriteria = JSON.parse(target.recordset[0].criteriaJson || '[]');
        assertPublishedWeightTotal(parsedCriteria);

        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            const request = new sql.Request(tx);
            await request
                .input('boardId', sql.Int, boardId)
                .query(`
                    UPDATE GovernanceCriteriaVersion
                    SET status = 'retired'
                    WHERE boardId = @boardId AND status = 'published'
                `);

            await request
                .input('id', sql.Int, versionId)
                .input('publishedByOid', sql.NVarChar(100), user?.oid || null)
                .query(`
                    UPDATE GovernanceCriteriaVersion
                    SET status = 'published',
                        publishedAt = GETDATE(),
                        publishedByOid = @publishedByOid
                    WHERE id = @id
                `);
            await tx.commit();
        } catch (err) {
            await tx.rollback();
            throw err;
        }

        logAudit({
            action: 'governance.criteria_version_publish',
            entityType: 'governance_criteria_version',
            entityId: versionId,
            entityTitle: `Board ${boardId} v${target.recordset[0].versionNo}`,
            user,
            after: { boardId, versionId, versionNo: target.recordset[0].versionNo, status: 'published' },
            req
        });

        res.json({ success: true });
    } catch (err) {
        if (err.message?.includes('weight must total 100')) {
            return res.status(400).json({ error: err.message });
        }
        handleError(res, 'publishing governance criteria version', err);
    }
});

// ==================== QUEUE ====================

router.get('/queue', checkPermission('can_view_governance_queue'), async (req, res) => {
    try {
        const boardId = parseInt(req.query.boardId, 10);
        const governanceStatus = req.query.governanceStatus;
        const decision = req.query.governanceDecision;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const offset = (page - 1) * limit;

        const pool = await getPool();
        const request = pool.request()
            .input('limit', sql.Int, limit)
            .input('offset', sql.Int, offset);

        const filters = ['s.governanceRequired = 1'];
        if (!Number.isNaN(boardId)) {
            request.input('boardId', sql.Int, boardId);
            filters.push('f.governanceBoardId = @boardId');
        }
        if (typeof governanceStatus === 'string' && governanceStatus.trim()) {
            request.input('governanceStatus', sql.NVarChar(20), governanceStatus.trim());
            filters.push('s.governanceStatus = @governanceStatus');
        }
        if (typeof decision === 'string' && decision.trim()) {
            request.input('decision', sql.NVarChar(30), decision.trim());
            filters.push('s.governanceDecision = @decision');
        }

        const where = `WHERE ${filters.join(' AND ')}`;

        const totalResult = await request.query(`
            SELECT COUNT(*) AS total
            FROM IntakeSubmissions s
            INNER JOIN IntakeForms f ON f.id = s.formId
            ${where}
        `);
        const total = totalResult.recordset[0].total;

        const dataRequest = pool.request()
            .input('limit', sql.Int, limit)
            .input('offset', sql.Int, offset);
        if (!Number.isNaN(boardId)) dataRequest.input('boardId', sql.Int, boardId);
        if (typeof governanceStatus === 'string' && governanceStatus.trim()) dataRequest.input('governanceStatus', sql.NVarChar(20), governanceStatus.trim());
        if (typeof decision === 'string' && decision.trim()) dataRequest.input('decision', sql.NVarChar(30), decision.trim());

        const result = await dataRequest.query(`
            SELECT
                s.id,
                s.formId,
                s.status,
                s.submittedAt,
                s.submitterName,
                s.submitterEmail,
                s.governanceRequired,
                s.governanceStatus,
                s.governanceDecision,
                s.governanceReason,
                s.priorityScore,
                f.name AS formName,
                f.governanceMode,
                f.governanceBoardId,
                b.name AS boardName
            FROM IntakeSubmissions s
            INNER JOIN IntakeForms f ON f.id = s.formId
            LEFT JOIN GovernanceBoard b ON b.id = f.governanceBoardId
            ${where}
            ORDER BY
                CASE WHEN s.priorityScore IS NULL THEN 1 ELSE 0 END,
                s.priorityScore DESC,
                s.submittedAt ASC
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `);

        res.json({
            items: result.recordset.map(row => ({
                id: row.id.toString(),
                formId: row.formId.toString(),
                formName: row.formName,
                status: row.status,
                submittedAt: row.submittedAt,
                submitterName: row.submitterName || null,
                submitterEmail: row.submitterEmail || null,
                governanceRequired: !!row.governanceRequired,
                governanceStatus: row.governanceStatus,
                governanceDecision: row.governanceDecision || null,
                governanceReason: row.governanceReason || null,
                priorityScore: row.priorityScore === null ? null : Number(row.priorityScore),
                governanceMode: row.governanceMode || 'off',
                governanceBoardId: row.governanceBoardId ? row.governanceBoardId.toString() : null,
                governanceBoardName: row.boardName || null
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        handleError(res, 'fetching governance queue', err);
    }
});

export default router;

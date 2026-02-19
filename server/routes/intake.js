import express from 'express';
import { getPool, sql } from '../db.js';
import { checkPermission, requireAuth, getAuthUser, hasPermission } from '../middleware/authMiddleware.js';
import { handleError } from '../utils/errorHandler.js';
import { logAudit } from '../utils/auditLogger.js';

const router = express.Router();

const isIntakeManager = (user) => {
    return !!(user?.roles && (
        user.roles.includes('Admin') ||
        user.roles.includes('IntakeManager') ||
        user.permissions?.includes('can_manage_intake')
    ));
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

const toFiniteNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
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

// ==================== INTAKE FORMS ====================

// Get all intake forms
router.get('/forms', checkPermission('can_view_intake'), async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT * FROM IntakeForms ORDER BY id');

        const forms = result.recordset.map(form => ({
            id: form.id.toString(),
            name: form.name,
            description: form.description,
            fields: JSON.parse(form.fields || '[]'),
            defaultGoalId: form.defaultGoalId ? form.defaultGoalId.toString() : null,
            createdAt: form.createdAt
        }));

        res.json(forms);
    } catch (err) {
        handleError(res, 'fetching intake forms', err);
    }
});

// Create intake form
router.post('/forms', checkPermission('can_manage_intake_forms'), async (req, res) => {
    try {
        const { name, description, fields, defaultGoalId } = req.body;
        const pool = await getPool();
        const result = await pool.request()
            .input('name', sql.NVarChar, name)
            .input('description', sql.NVarChar, description)
            .input('fields', sql.NVarChar, JSON.stringify(fields))
            .input('defaultGoalId', sql.Int, defaultGoalId ? parseInt(defaultGoalId) : null)
            .query('INSERT INTO IntakeForms (name, description, fields, defaultGoalId) OUTPUT INSERTED.id, INSERTED.createdAt VALUES (@name, @description, @fields, @defaultGoalId)');

        const newId = result.recordset[0].id.toString();
        logAudit({ action: 'intake_form.create', entityType: 'intake_form', entityId: newId, entityTitle: name, user: getAuthUser(req), after: { name, description, defaultGoalId }, req });
        res.json({
            id: newId,
            name,
            description,
            fields,
            defaultGoalId,
            createdAt: result.recordset[0].createdAt
        });
    } catch (err) {
        handleError(res, 'creating intake form', err);
    }
});

// Update intake form
router.put('/forms/:id', checkPermission('can_manage_intake_forms'), async (req, res) => {
    try {
        const { name, description, fields, defaultGoalId } = req.body;
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT name, description, defaultGoalId FROM IntakeForms WHERE id = @id');
        await pool.request()
            .input('id', sql.Int, id)
            .input('name', sql.NVarChar, name)
            .input('description', sql.NVarChar, description)
            .input('fields', sql.NVarChar, JSON.stringify(fields))
            .input('defaultGoalId', sql.Int, defaultGoalId ? parseInt(defaultGoalId) : null)
            .query('UPDATE IntakeForms SET name = @name, description = @description, fields = @fields, defaultGoalId = @defaultGoalId WHERE id = @id');

        logAudit({ action: 'intake_form.update', entityType: 'intake_form', entityId: id, entityTitle: name, user: getAuthUser(req), before: prev.recordset[0], after: { name, description, defaultGoalId }, req });
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

        const boardId = parseInt(req.query.boardId, 10);
        const governanceStatus = req.query.governanceStatus;
        const decision = req.query.governanceDecision;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const offset = (page - 1) * limit;

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

        const where = `WHERE ${filters.join(' AND ')}`;

        const countRequest = pool.request();
        addFilterParam.forEach(([name, type, value]) => countRequest.input(name, type, value));
        const totalResult = await countRequest.query(`
            SELECT COUNT(*) AS total
            FROM IntakeSubmissions s
            INNER JOIN IntakeForms f ON f.id = s.formId
            ${where}
        `);
        const total = totalResult.recordset[0].total;

        const dataRequest = pool.request()
            .input('limit', sql.Int, limit)
            .input('offset', sql.Int, offset);
        addFilterParam.forEach(([name, type, value]) => dataRequest.input(name, type, value));
        const dataResult = await dataRequest.query(`
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
                b.name AS governanceBoardName
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
            items: dataResult.recordset.map(item => ({
                id: item.id.toString(),
                formId: item.formId.toString(),
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
                governanceMode: item.governanceMode || 'off',
                governanceBoardId: item.governanceBoardId ? item.governanceBoardId.toString() : null,
                governanceBoardName: item.governanceBoardName || null
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        handleError(res, 'fetching intake governance queue', err);
    }
});

// Get all submissions (Admin/Manager only)
router.get('/submissions', checkPermission('can_view_incoming_requests'), async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT * FROM IntakeSubmissions ORDER BY submittedAt DESC');

        const submissions = result.recordset.map(sub => {
            const storedData = JSON.parse(sub.infoRequests || '[]');
            const isConversationFormat = storedData.length > 0 && storedData[0]?.type;

            return {
                id: sub.id.toString(),
                formId: sub.formId.toString(),
                formData: JSON.parse(sub.formData || '{}'),
                status: sub.status,
                governanceRequired: !!sub.governanceRequired,
                governanceStatus: sub.governanceStatus || 'not-started',
                governanceDecision: sub.governanceDecision || null,
                governanceReason: sub.governanceReason || null,
                priorityScore: sub.priorityScore === null ? null : Number(sub.priorityScore),
                conversation: isConversationFormat ? storedData : [],
                convertedProjectId: sub.convertedProjectId ? sub.convertedProjectId.toString() : null,
                submittedAt: sub.submittedAt,
                submitterName: sub.submitterName,
                submitterEmail: sub.submitterEmail
            };
        });

        res.json(submissions);
    } catch (err) {
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

        const submissions = result.recordset.map(sub => {
            const storedData = JSON.parse(sub.infoRequests || '[]');
            const isConversationFormat = storedData.length > 0 && storedData[0]?.type;

            return {
                id: sub.id.toString(),
                formId: sub.formId.toString(),
                formData: JSON.parse(sub.formData || '{}'),
                status: sub.status,
                governanceRequired: !!sub.governanceRequired,
                governanceStatus: sub.governanceStatus || 'not-started',
                governanceDecision: sub.governanceDecision || null,
                governanceReason: sub.governanceReason || null,
                priorityScore: sub.priorityScore === null ? null : Number(sub.priorityScore),
                conversation: isConversationFormat ? storedData : [],
                convertedProjectId: sub.convertedProjectId ? sub.convertedProjectId.toString() : null,
                submittedAt: sub.submittedAt
            };
        });

        res.json(submissions);
    } catch (err) {
        handleError(res, 'fetching my submissions', err);
    }
});

// Create submission (Authenticated)
router.post('/submissions', async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const { formId, formData } = req.body;
        const parsedFormId = parseInt(formId, 10);
        if (Number.isNaN(parsedFormId)) {
            return res.status(400).json({ error: 'Invalid formId' });
        }
        const pool = await getPool();
        const governanceDefaults = await resolveGovernanceDefaults(pool, parsedFormId);
        let result;
        if (governanceDefaults.schemaReady) {
            result = await pool.request()
                .input('formId', sql.Int, parsedFormId)
                .input('formData', sql.NVarChar, JSON.stringify(formData))
                .input('submitterId', sql.NVarChar, user ? user.oid : null)
                .input('submitterName', sql.NVarChar, user ? user.name : null)
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
                .input('submitterEmail', sql.NVarChar, user ? user.email : null)
                .query(`
                    INSERT INTO IntakeSubmissions (
                        formId, formData, infoRequests, submitterId, submitterName, submitterEmail
                    )
                    OUTPUT INSERTED.id, INSERTED.submittedAt
                    VALUES (@formId, @formData, '[]', @submitterId, @submitterName, @submitterEmail)
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
                governanceRequired: governanceDefaults.governanceRequired,
                governanceStatus: governanceDefaults.governanceStatus
            },
            req
        });
        res.json({
            id: newSubId,
            formId: parsedFormId,
            formData,
            status: 'pending',
            governanceRequired: governanceDefaults.governanceRequired,
            governanceStatus: governanceDefaults.governanceStatus,
            governanceDecision: null,
            governanceReason: governanceDefaults.governanceReason,
            priorityScore: null,
            infoRequests: [],
            convertedProjectId: null,
            submittedAt: result.recordset[0].submittedAt
        });
    } catch (err) {
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
            .query('SELECT submitterId, status, convertedProjectId FROM IntakeSubmissions WHERE id = @id');

        if (prevResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        const prev = prevResult.recordset[0];

        // 2. Determine Permissions
        const isManager = isIntakeManager(user);
        const isOwner = prev.submitterId === user.oid;

        if (!isManager && !isOwner) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        // 3. Prepare Updates
        const request = pool.request().input('id', sql.Int, id);
        let updateParts = [];

        // Manager only fields
        if (isManager) {
            if (status !== undefined) {
                request.input('status', sql.NVarChar, status);
                updateParts.push('status = @status');
            }
            if (convertedProjectId !== undefined) {
                request.input('convertedProjectId', sql.Int, convertedProjectId ? parseInt(convertedProjectId) : null);
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
            after: { status, conversationUpdated: !!conversation },
            req
        });

        res.json({ success: true });
    } catch (err) {
        handleError(res, 'updating submission', err);
    }
});

// Intake manager can explicitly apply governance for optional/off submissions
router.post('/submissions/:id/governance/apply', requireAuth, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        if (!isIntakeManager(user)) return res.status(403).json({ error: 'Forbidden' });

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
                SELECT id, status, governanceRequired, governanceStatus, governanceReason
                FROM IntakeSubmissions
                WHERE id = @id
            `);
        if (prevResult.recordset.length === 0) return res.status(404).json({ error: 'Submission not found' });
        const prev = prevResult.recordset[0];

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
router.post('/submissions/:id/governance/skip', requireAuth, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        if (!isIntakeManager(user)) return res.status(403).json({ error: 'Forbidden' });

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
                SELECT id, status, governanceRequired, governanceStatus, governanceReason
                FROM IntakeSubmissions
                WHERE id = @id
            `);
        if (prevResult.recordset.length === 0) return res.status(404).json({ error: 'Submission not found' });
        const prev = prevResult.recordset[0];

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
router.post('/submissions/:id/governance/start', requireAuth, async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const canManageGovernance = await hasPermission(user, 'can_manage_governance');
        if (!canManageGovernance && !isIntakeManager(user)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const submissionId = parseInt(req.params.id, 10);
        if (Number.isNaN(submissionId)) return res.status(400).json({ error: 'Invalid submission id' });

        const pool = await getPool();
        if (!(await hasGovernanceSchema(pool)) || !(await hasGovernancePhase1Schema(pool))) {
            return res.status(503).json({ error: 'Governance phase 1 schema not installed. Run governance phase 1 migration first.' });
        }

        const submissionResult = await pool.request()
            .input('id', sql.Int, submissionId)
            .query(`
                SELECT
                    s.id,
                    s.status,
                    s.governanceRequired,
                    s.governanceStatus,
                    s.governanceDecision,
                    s.formId,
                    f.governanceBoardId
                FROM IntakeSubmissions s
                INNER JOIN IntakeForms f ON f.id = s.formId
                WHERE s.id = @id
            `);

        if (submissionResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Submission not found' });
        }

        const submission = submissionResult.recordset[0];
        if (!submission.governanceRequired) {
            return res.status(409).json({ error: 'Submission is not marked for governance. Apply governance first.' });
        }
        if (!submission.governanceBoardId) {
            return res.status(409).json({ error: 'Intake form is not mapped to a governance board.' });
        }
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
        try {
            await tx.begin();

            const createReviewRequest = new sql.Request(tx);
            const reviewInsert = await createReviewRequest
                .input('submissionId', sql.Int, submissionId)
                .input('boardId', sql.Int, submission.governanceBoardId)
                .input('reviewRound', sql.Int, nextRound)
                .input('criteriaVersionId', sql.Int, criteriaVersion.id)
                .input('criteriaSnapshotJson', sql.NVarChar(sql.MAX), JSON.stringify(criteriaSnapshot))
                .input('startedByOid', sql.NVarChar(100), user.oid)
                .query(`
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
                participantCount: participantsResult.recordset.length
            },
            req
        });

        res.json({
            success: true,
            reviewId: reviewId.toString(),
            reviewRound: nextRound,
            criteriaVersionId: criteriaVersion.id.toString(),
            criteriaVersionNo: criteriaVersion.versionNo,
            participantCount: participantsResult.recordset.length
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

        const submissionResult = await pool.request()
            .input('id', sql.Int, submissionId)
            .query(`
                SELECT
                    s.id,
                    s.formId,
                    s.submitterId,
                    s.status,
                    s.submittedAt,
                    s.governanceRequired,
                    s.governanceStatus,
                    s.governanceDecision,
                    s.governanceReason,
                    s.priorityScore,
                    f.name AS formName,
                    f.governanceBoardId,
                    b.name AS boardName
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
        if (!canViewGovernance && !isIntakeManager(user) && !isOwner) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const reviewResult = await pool.request()
            .input('submissionId', sql.Int, submissionId)
            .query(`
                SELECT TOP 1
                    id, submissionId, boardId, reviewRound, status, decision, decisionReason,
                    criteriaVersionId, criteriaSnapshotJson, startedAt, startedByOid, decidedAt, decidedByOid
                FROM GovernanceReview
                WHERE submissionId = @submissionId
                ORDER BY reviewRound DESC
            `);

        if (reviewResult.recordset.length === 0) {
            return res.json({
                submission: {
                    id: submission.id.toString(),
                    formId: submission.formId.toString(),
                    formName: submission.formName,
                    status: submission.status,
                    submittedAt: submission.submittedAt,
                    governanceRequired: !!submission.governanceRequired,
                    governanceStatus: submission.governanceStatus,
                    governanceDecision: submission.governanceDecision,
                    governanceReason: submission.governanceReason,
                    priorityScore: submission.priorityScore === null ? null : Number(submission.priorityScore),
                    governanceBoardId: submission.governanceBoardId ? submission.governanceBoardId.toString() : null,
                    governanceBoardName: submission.boardName || null
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

        res.json({
            submission: {
                id: submission.id.toString(),
                formId: submission.formId.toString(),
                formName: submission.formName,
                status: submission.status,
                submittedAt: submission.submittedAt,
                governanceRequired: !!submission.governanceRequired,
                governanceStatus: submission.governanceStatus,
                governanceDecision: submission.governanceDecision,
                governanceReason: submission.governanceReason,
                priorityScore: submission.priorityScore === null ? null : Number(submission.priorityScore),
                governanceBoardId: submission.governanceBoardId ? submission.governanceBoardId.toString() : null,
                governanceBoardName: submission.boardName || null
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
                    participationPct
                }
            }
        });
    } catch (err) {
        handleError(res, 'fetching submission governance details', err);
    }
});

// Submit or update a governance vote
router.post('/submissions/:id/governance/votes', requireAuth, async (req, res) => {
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

        const reviewResult = await pool.request()
            .input('submissionId', sql.Int, submissionId)
            .query(`
                SELECT TOP 1
                    id, submissionId, status, criteriaSnapshotJson
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
            voteCount: scoreSummary.voteCount
        });
    } catch (err) {
        handleError(res, 'submitting governance vote', err);
    }
});

// Finalize governance decision for the active review
router.post('/submissions/:id/governance/decide', requireAuth, async (req, res) => {
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

        const reviewResult = await pool.request()
            .input('submissionId', sql.Int, submissionId)
            .query(`
                SELECT TOP 1 id, status, criteriaSnapshotJson
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
                voteCount: scoreSummary.voteCount
            },
            req
        });

        res.json({
            success: true,
            reviewId: review.id.toString(),
            decision,
            priorityScore: scoreSummary.priorityScore,
            voteCount: scoreSummary.voteCount
        });
    } catch (err) {
        handleError(res, 'finalizing governance decision', err);
    }
});

// Add Message to Conversation (User or Admin)
router.post('/submissions/:id/message', requireAuth, async (req, res) => {
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
            .query('SELECT infoRequests, submitterId FROM IntakeSubmissions WHERE id = @id');

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

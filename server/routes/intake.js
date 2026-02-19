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

import express from 'express';
import { getPool, sql } from '../db.js';
import { checkPermission, requireAuth, getAuthUser } from '../middleware/authMiddleware.js';
import { handleError } from '../utils/errorHandler.js';
import { logAudit } from '../utils/auditLogger.js';

const router = express.Router();

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
router.post('/forms', checkPermission('can_manage_intake'), async (req, res) => {
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
router.put('/forms/:id', checkPermission('can_manage_intake'), async (req, res) => {
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
router.delete('/forms/:id', checkPermission('can_manage_intake'), async (req, res) => {
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
        const pool = await getPool();

        const result = await pool.request()
            .input('formId', sql.Int, parseInt(formId))
            .input('formData', sql.NVarChar, JSON.stringify(formData))
            .input('submitterId', sql.NVarChar, user ? user.oid : null)
            .input('submitterName', sql.NVarChar, user ? user.name : null)
            .input('submitterEmail', sql.NVarChar, user ? user.preferred_username : null) // Azure AD often puts email here
            .query('INSERT INTO IntakeSubmissions (formId, formData, infoRequests, submitterId, submitterName, submitterEmail) OUTPUT INSERTED.id, INSERTED.submittedAt VALUES (@formId, @formData, \'[]\', @submitterId, @submitterName, @submitterEmail)');

        const newSubId = result.recordset[0].id.toString();
        logAudit({ action: 'submission.create', entityType: 'submission', entityId: newSubId, entityTitle: `Form ${formId}`, user, after: { formId, status: 'pending' }, req });
        res.json({
            id: newSubId,
            formId,
            formData,
            status: 'pending',
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
        const isManager = user.roles && (
            user.roles.includes('Admin') ||
            user.roles.includes('IntakeManager') ||
            user.permissions?.includes('can_manage_intake') // fallback if expanded
        );
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
        // Admin can message any. Submitter can only message own.
        const isAdmin = user.roles && (user.roles.includes('Admin') || user.roles.includes('Editor'));
        const isOwner = submission.submitterId === user.oid;

        if (!isAdmin && !isOwner) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const senderType = isAdmin ? 'admin' : 'requester';

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

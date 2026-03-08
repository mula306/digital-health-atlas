import express from 'express';
import { getPool, sql } from '../db.js';
import { checkPermission, getAuthUser } from '../middleware/authMiddleware.js';
import { withSharedScope } from '../middleware/orgScope.js';
import { handleError } from '../utils/errorHandler.js';
import { logAudit } from '../utils/auditLogger.js';
import { addParams, buildInClause } from '../utils/sqlHelpers.js';

const router = express.Router();

const DEFAULT_TIMEZONE = 'America/Regina';
const DEFAULT_SCHEDULER_INTERVAL_MS = 60000;

let schedulerTimer = null;
let schedulerRunning = false;
let lastSchedulerSweepAt = null;
let lastSchedulerResult = null;

const isAdmin = (user) => {
    const roles = Array.isArray(user?.roles) ? user.roles : [];
    return roles.includes('Admin');
};

const parseJsonSafe = (raw, fallback) => {
    if (!raw) return fallback;
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
};

const parseStringArray = (value) => {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => (typeof item === 'string' ? item.trim() : String(item || '').trim()))
        .filter(Boolean);
};

const normalizePackPayload = (payload = {}, fallback = null) => {
    const name = typeof payload.name === 'string' ? payload.name.trim() : (fallback?.name || '');
    if (!name) {
        throw new Error('name is required');
    }

    const description = payload.description === undefined
        ? (fallback?.description ?? null)
        : (typeof payload.description === 'string' ? payload.description.trim() : null);

    const scheduleTypeRaw = payload.scheduleType === undefined
        ? (fallback?.scheduleType || 'weekly')
        : payload.scheduleType;
    const scheduleType = String(scheduleTypeRaw || 'weekly').trim().toLowerCase();
    if (!['weekly', 'manual'].includes(scheduleType)) {
        throw new Error('scheduleType must be weekly or manual');
    }

    const scheduleDayOfWeekRaw = payload.scheduleDayOfWeek === undefined
        ? fallback?.scheduleDayOfWeek
        : payload.scheduleDayOfWeek;
    let scheduleDayOfWeek = null;
    if (scheduleType === 'weekly') {
        if (scheduleDayOfWeekRaw === null || scheduleDayOfWeekRaw === undefined || scheduleDayOfWeekRaw === '') {
            scheduleDayOfWeek = 1; // Monday default
        } else {
            const parsed = Number(scheduleDayOfWeekRaw);
            if (!Number.isFinite(parsed) || parsed < 0 || parsed > 6) {
                throw new Error('scheduleDayOfWeek must be between 0 and 6');
            }
            scheduleDayOfWeek = Math.trunc(parsed);
        }
    }

    const scheduleHourRaw = payload.scheduleHour === undefined ? (fallback?.scheduleHour ?? 9) : payload.scheduleHour;
    const scheduleMinuteRaw = payload.scheduleMinute === undefined ? (fallback?.scheduleMinute ?? 0) : payload.scheduleMinute;
    const scheduleHour = Math.trunc(Number(scheduleHourRaw));
    const scheduleMinute = Math.trunc(Number(scheduleMinuteRaw));
    if (!Number.isFinite(scheduleHour) || scheduleHour < 0 || scheduleHour > 23) {
        throw new Error('scheduleHour must be between 0 and 23');
    }
    if (!Number.isFinite(scheduleMinute) || scheduleMinute < 0 || scheduleMinute > 59) {
        throw new Error('scheduleMinute must be between 0 and 59');
    }

    const timezone = typeof payload.timezone === 'string' && payload.timezone.trim()
        ? payload.timezone.trim()
        : (fallback?.timezone || DEFAULT_TIMEZONE);

    const exceptionOnly = payload.exceptionOnly === undefined
        ? !!fallback?.exceptionOnly
        : !!payload.exceptionOnly;
    const isActive = payload.isActive === undefined
        ? (fallback?.isActive !== false)
        : !!payload.isActive;

    const recipients = payload.recipients === undefined
        ? (Array.isArray(fallback?.recipients) ? fallback.recipients : [])
        : parseStringArray(payload.recipients);

    const defaultFilter = fallback?.filters && typeof fallback.filters === 'object'
        ? fallback.filters
        : {};
    const rawFilters = payload.filters && typeof payload.filters === 'object'
        ? payload.filters
        : defaultFilter;

    const normalizeIntArray = (items) => {
        if (!Array.isArray(items)) return [];
        const parsed = items
            .map((item) => Number.parseInt(item, 10))
            .filter((item) => !Number.isNaN(item));
        return [...new Set(parsed)];
    };

    const filters = {
        goalIds: normalizeIntArray(rawFilters.goalIds),
        tagIds: normalizeIntArray(rawFilters.tagIds),
        statuses: parseStringArray(rawFilters.statuses).map((status) => status.toLowerCase()),
        watchedOnly: !!rawFilters.watchedOnly
    };

    return {
        name,
        description,
        scheduleType,
        scheduleDayOfWeek,
        scheduleHour,
        scheduleMinute,
        timezone,
        exceptionOnly,
        isActive,
        recipients,
        filters
    };
};

const computeNextRunAt = (pack, now = new Date()) => {
    if (!pack || pack.scheduleType !== 'weekly' || pack.isActive === false) return null;

    const next = new Date(now);
    next.setSeconds(0, 0);
    next.setHours(pack.scheduleHour, pack.scheduleMinute, 0, 0);

    const targetDay = Number(pack.scheduleDayOfWeek);
    const currentDay = next.getDay();
    let delta = (targetDay - currentDay + 7) % 7;
    if (delta === 0 && next.getTime() <= now.getTime()) {
        delta = 7;
    }
    next.setDate(next.getDate() + delta);
    return next;
};

const toPackResponse = (row) => {
    const recipients = parseJsonSafe(row.recipientJson, []);
    const filters = parseJsonSafe(row.filterJson, {});
    const lastRunSummary = parseJsonSafe(row.lastRunSummaryJson, null);

    return {
        id: String(row.id),
        name: row.name,
        description: row.description || null,
        ownerOid: row.ownerOid || null,
        scopeOrgId: row.scopeOrgId === null || row.scopeOrgId === undefined ? null : String(row.scopeOrgId),
        isActive: !!row.isActive,
        scheduleType: row.scheduleType,
        scheduleDayOfWeek: row.scheduleDayOfWeek === null ? null : Number(row.scheduleDayOfWeek),
        scheduleHour: Number(row.scheduleHour),
        scheduleMinute: Number(row.scheduleMinute),
        timezone: row.timezone || DEFAULT_TIMEZONE,
        exceptionOnly: !!row.exceptionOnly,
        filters: filters && typeof filters === 'object' ? filters : {},
        recipients: Array.isArray(recipients) ? recipients : [],
        lastRunAt: row.lastRunAt || null,
        nextRunAt: row.nextRunAt || null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lastRun: row.lastRunId ? {
            id: String(row.lastRunId),
            status: row.lastRunStatus,
            startedAt: row.lastRunStartedAt,
            completedAt: row.lastRunCompletedAt,
            summary: lastRunSummary
        } : null
    };
};

const executePackRun = async ({
    pool,
    packRow,
    runType = 'manual',
    initiatedByOid = null,
    fallbackOrgId = null
}) => {
    const scopeOrgId = packRow.scopeOrgId === null || packRow.scopeOrgId === undefined
        ? fallbackOrgId
        : Number(packRow.scopeOrgId);
    const pack = {
        id: String(packRow.id),
        name: packRow.name,
        scheduleType: packRow.scheduleType,
        scheduleDayOfWeek: packRow.scheduleDayOfWeek,
        scheduleHour: Number(packRow.scheduleHour),
        scheduleMinute: Number(packRow.scheduleMinute),
        timezone: packRow.timezone || DEFAULT_TIMEZONE,
        exceptionOnly: !!packRow.exceptionOnly,
        isActive: !!packRow.isActive,
        recipients: parseJsonSafe(packRow.recipientJson, []),
        filters: parseJsonSafe(packRow.filterJson, {}),
        scopeOrgId
    };

    const startedAt = new Date();

    try {
        const summary = await computePackSummary({
            pool,
            orgId: scopeOrgId,
            viewerOid: packRow.ownerOid || initiatedByOid || '',
            pack,
            lastRunAt: packRow.lastRunAt || null
        });

        const completedAt = new Date();
        const nextRunAt = computeNextRunAt(pack, completedAt);

        const runInsert = await pool.request()
            .input('packId', sql.Int, Number(packRow.id))
            .input('runType', sql.NVarChar(20), runType)
            .input('status', sql.NVarChar(20), 'completed')
            .input('startedAt', sql.DateTime2, startedAt)
            .input('completedAt', sql.DateTime2, completedAt)
            .input('initiatedByOid', sql.NVarChar(100), initiatedByOid)
            .input('summaryJson', sql.NVarChar(sql.MAX), JSON.stringify(summary))
            .query(`
                INSERT INTO ExecutiveReportPackRun (
                    packId, runType, status, startedAt, completedAt, initiatedByOid, summaryJson
                )
                OUTPUT INSERTED.id
                VALUES (
                    @packId, @runType, @status, @startedAt, @completedAt, @initiatedByOid, @summaryJson
                )
            `);

        await pool.request()
            .input('id', sql.Int, Number(packRow.id))
            .input('lastRunAt', sql.DateTime2, completedAt)
            .input('nextRunAt', sql.DateTime2, nextRunAt)
            .query(`
                UPDATE ExecutiveReportPack
                SET
                    lastRunAt = @lastRunAt,
                    nextRunAt = @nextRunAt,
                    updatedAt = GETDATE()
                WHERE id = @id
            `);

        return {
            ok: true,
            packId: String(packRow.id),
            runId: String(runInsert.recordset[0].id),
            summary,
            completedAt,
            nextRunAt
        };
    } catch (err) {
        const failedAt = new Date();
        await pool.request()
            .input('packId', sql.Int, Number(packRow.id))
            .input('runType', sql.NVarChar(20), runType)
            .input('status', sql.NVarChar(20), 'failed')
            .input('startedAt', sql.DateTime2, startedAt)
            .input('completedAt', sql.DateTime2, failedAt)
            .input('initiatedByOid', sql.NVarChar(100), initiatedByOid)
            .input('errorText', sql.NVarChar(sql.MAX), String(err?.message || 'Unknown scheduler error'))
            .query(`
                INSERT INTO ExecutiveReportPackRun (
                    packId, runType, status, startedAt, completedAt, initiatedByOid, errorText
                )
                VALUES (
                    @packId, @runType, @status, @startedAt, @completedAt, @initiatedByOid, @errorText
                )
            `);

        return {
            ok: false,
            packId: String(packRow.id),
            error: String(err?.message || 'Unknown scheduler error')
        };
    }
};

export const runDueExecutiveReportPacks = async ({ maxRuns = 10 } = {}) => {
    if (schedulerRunning) {
        return {
            running: true,
            startedAt: lastSchedulerSweepAt,
            results: [],
            skipped: true
        };
    }

    schedulerRunning = true;
    const startedAt = new Date();
    lastSchedulerSweepAt = startedAt.toISOString();
    const results = [];

    try {
        const pool = await getPool();
        const dueResult = await pool.request()
            .input('now', sql.DateTime2, startedAt)
            .input('maxRuns', sql.Int, Math.max(1, Number(maxRuns) || 10))
            .query(`
                SELECT TOP (@maxRuns) *
                FROM ExecutiveReportPack
                WHERE isActive = 1
                  AND scheduleType = 'weekly'
                  AND nextRunAt IS NOT NULL
                  AND nextRunAt <= @now
                ORDER BY nextRunAt ASC, id ASC
            `);

        for (const row of dueResult.recordset) {
            const runResult = await executePackRun({
                pool,
                packRow: row,
                runType: 'scheduled',
                initiatedByOid: null,
                fallbackOrgId: row.scopeOrgId === null || row.scopeOrgId === undefined ? null : Number(row.scopeOrgId)
            });
            results.push(runResult);
        }

        lastSchedulerResult = {
            startedAt: startedAt.toISOString(),
            completedAt: new Date().toISOString(),
            total: results.length,
            completed: results.filter((item) => item.ok).length,
            failed: results.filter((item) => !item.ok).length
        };

        return {
            running: false,
            startedAt: lastSchedulerSweepAt,
            results
        };
    } finally {
        schedulerRunning = false;
    }
};

export const getExecutivePackSchedulerStatus = async () => {
    const pool = await getPool();
    const dueResult = await pool.request().query(`
        SELECT COUNT(*) AS dueCount
        FROM ExecutiveReportPack
        WHERE isActive = 1
          AND scheduleType = 'weekly'
          AND nextRunAt IS NOT NULL
          AND nextRunAt <= GETDATE()
    `);

    return {
        running: schedulerRunning,
        lastSweepAt: lastSchedulerSweepAt,
        lastResult: lastSchedulerResult,
        dueCount: Number(dueResult.recordset[0]?.dueCount || 0)
    };
};

export const startExecutivePackScheduler = ({ intervalMs = DEFAULT_SCHEDULER_INTERVAL_MS } = {}) => {
    if (schedulerTimer) {
        return {
            started: false,
            intervalMs,
            message: 'Scheduler already running'
        };
    }

    const safeInterval = Math.max(15000, Number(intervalMs) || DEFAULT_SCHEDULER_INTERVAL_MS);
    schedulerTimer = setInterval(() => {
        runDueExecutiveReportPacks().catch((err) => {
            console.error('Executive pack scheduler error:', err);
        });
    }, safeInterval);
    runDueExecutiveReportPacks().catch((err) => {
        console.error('Executive pack scheduler bootstrap error:', err);
    });

    if (typeof schedulerTimer.unref === 'function') {
        schedulerTimer.unref();
    }

    return {
        started: true,
        intervalMs: safeInterval
    };
};

const buildProjectScopeWhere = (orgScoped) => {
    if (!orgScoped) return '1=1';
    return `
        (
            p.orgId = @orgId
            OR p.id IN (
                SELECT projectId
                FROM ProjectOrgAccess
                WHERE orgId = @orgId
                  AND (expiresAt IS NULL OR expiresAt > GETDATE())
            )
        )
    `;
};

const computePackSummary = async ({ pool, orgId, viewerOid, pack, lastRunAt }) => {
    const whereConditions = [buildProjectScopeWhere(orgId !== null && orgId !== undefined)];
    const params = {
        viewerOid
    };

    if (orgId !== null && orgId !== undefined) {
        params.orgId = orgId;
    }

    if (Array.isArray(pack.filters?.goalIds) && pack.filters.goalIds.length > 0) {
        const { text, params: inParams } = buildInClause('goalId', pack.filters.goalIds);
        Object.assign(params, inParams);
        whereConditions.push(`p.id IN (SELECT projectId FROM ProjectGoals WHERE goalId IN (${text}))`);
    }

    if (Array.isArray(pack.filters?.tagIds) && pack.filters.tagIds.length > 0) {
        const { text, params: inParams } = buildInClause('tagId', pack.filters.tagIds);
        Object.assign(params, inParams);
        whereConditions.push(`EXISTS (SELECT 1 FROM ProjectTags pt WHERE pt.projectId = p.id AND pt.tagId IN (${text}))`);
    }

    if (pack.filters?.watchedOnly) {
        whereConditions.push('EXISTS (SELECT 1 FROM ProjectWatchers pw WHERE pw.projectId = p.id AND pw.userOid = @viewerOid)');
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
    const request = pool.request();
    addParams(request, params);

    const rowsResult = await request.query(`
        SELECT
            p.id,
            p.title,
            COALESCE(NULLIF(LOWER(JSON_VALUE(lsr.reportData, '$.overallStatus')), ''), 'unknown') AS overallStatus,
            ISNULL(ot.overdueCount, 0) AS overdueCount
        FROM Projects p
        OUTER APPLY (
            SELECT TOP 1 sr.reportData
            FROM StatusReports sr
            WHERE sr.projectId = p.id
            ORDER BY sr.createdAt DESC
        ) lsr
        OUTER APPLY (
            SELECT COUNT(*) AS overdueCount
            FROM Tasks t
            WHERE t.projectId = p.id
              AND t.status <> 'done'
              AND t.endDate < CAST(GETDATE() AS DATE)
        ) ot
        ${whereClause}
    `);

    let projects = rowsResult.recordset.map((row) => ({
        id: String(row.id),
        title: row.title,
        overallStatus: row.overallStatus || 'unknown',
        overdueCount: Number(row.overdueCount || 0)
    }));

    if (Array.isArray(pack.filters?.statuses) && pack.filters.statuses.length > 0) {
        const allowedStatuses = new Set(pack.filters.statuses.map((status) => String(status).toLowerCase()));
        projects = projects.filter((project) => allowedStatuses.has(project.overallStatus));
    }

    const redProjects = projects.filter((project) => project.overallStatus === 'red');
    const yellowProjects = projects.filter((project) => project.overallStatus === 'yellow');
    const unknownProjects = projects.filter((project) => project.overallStatus === 'unknown');
    const overdueProjects = projects.filter((project) => project.overdueCount > 0);
    const exceptionProjects = projects.filter((project) =>
        project.overallStatus === 'red' ||
        project.overallStatus === 'yellow' ||
        project.overdueCount > 0
    );

    const filteredProjects = pack.exceptionOnly ? exceptionProjects : projects;
    const topExceptions = [...exceptionProjects]
        .sort((a, b) => {
            const severityA = (a.overallStatus === 'red' ? 3 : a.overallStatus === 'yellow' ? 2 : 1) + Math.min(3, a.overdueCount);
            const severityB = (b.overallStatus === 'red' ? 3 : b.overallStatus === 'yellow' ? 2 : 1) + Math.min(3, b.overdueCount);
            if (severityA !== severityB) return severityB - severityA;
            return a.title.localeCompare(b.title);
        })
        .slice(0, 10);

    let changedReportsCount = 0;
    if (lastRunAt && filteredProjects.length > 0) {
        const projectIds = filteredProjects.map((project) => Number.parseInt(project.id, 10));
        const { text, params: projectParams } = buildInClause('projectId', projectIds);
        const deltaRequest = pool.request().input('lastRunAt', sql.DateTime2, new Date(lastRunAt));
        addParams(deltaRequest, projectParams);
        const deltaResult = await deltaRequest.query(`
            SELECT COUNT(*) AS changedReports
            FROM StatusReports sr
            WHERE sr.projectId IN (${text})
              AND sr.createdAt > @lastRunAt
        `);
        changedReportsCount = Number(deltaResult.recordset[0]?.changedReports || 0);
    }

    return {
        generatedAt: new Date().toISOString(),
        totalProjects: filteredProjects.length,
        redCount: redProjects.length,
        yellowCount: yellowProjects.length,
        unknownCount: unknownProjects.length,
        overdueProjectCount: overdueProjects.length,
        changedReportsCount,
        exceptionOnly: !!pack.exceptionOnly,
        topExceptions
    };
};

// List configured executive packs
router.get('/packs', checkPermission(['can_view_reports', 'can_view_exec_dashboard']), async (req, res) => {
    try {
        const user = getAuthUser(req);
        const pool = await getPool();
        const request = pool.request();
        const adminUser = isAdmin(user);

        let where = '';
        if (!adminUser) {
            where = 'WHERE p.ownerOid = @ownerOid';
            request.input('ownerOid', sql.NVarChar(100), user?.oid || '');
        }

        const result = await request.query(`
            SELECT
                p.*,
                lr.id AS lastRunId,
                lr.status AS lastRunStatus,
                lr.startedAt AS lastRunStartedAt,
                lr.completedAt AS lastRunCompletedAt,
                lr.summaryJson AS lastRunSummaryJson
            FROM ExecutiveReportPack p
            OUTER APPLY (
                SELECT TOP 1 r.id, r.status, r.startedAt, r.completedAt, r.summaryJson
                FROM ExecutiveReportPackRun r
                WHERE r.packId = p.id
                ORDER BY r.startedAt DESC
            ) lr
            ${where}
            ORDER BY p.updatedAt DESC
        `);

        res.json(result.recordset.map(toPackResponse));
    } catch (err) {
        handleError(res, 'listing executive report packs', err);
    }
});

// Create a new executive pack
router.post('/packs', checkPermission(['can_create_reports', 'can_view_exec_dashboard']), async (req, res) => {
    try {
        const user = getAuthUser(req);
        const payload = normalizePackPayload(req.body || {});
        const nextRunAt = computeNextRunAt(payload);
        const scopeOrgId = req.orgId === undefined ? null : req.orgId;

        const pool = await getPool();
        if (scopeOrgId !== null && scopeOrgId !== undefined) {
            const orgCheck = await pool.request()
                .input('orgId', sql.Int, scopeOrgId)
                .query('SELECT TOP 1 id FROM Organizations WHERE id = @orgId');
            if (!orgCheck.recordset.length) {
                return res.status(400).json({ error: 'Invalid scopeOrgId' });
            }
        }
        const insert = await pool.request()
            .input('name', sql.NVarChar(160), payload.name)
            .input('description', sql.NVarChar(500), payload.description)
            .input('ownerOid', sql.NVarChar(100), user?.oid || null)
            .input('scopeOrgId', sql.Int, scopeOrgId)
            .input('isActive', sql.Bit, payload.isActive ? 1 : 0)
            .input('scheduleType', sql.NVarChar(20), payload.scheduleType)
            .input('scheduleDayOfWeek', sql.TinyInt, payload.scheduleDayOfWeek)
            .input('scheduleHour', sql.TinyInt, payload.scheduleHour)
            .input('scheduleMinute', sql.TinyInt, payload.scheduleMinute)
            .input('timezone', sql.NVarChar(64), payload.timezone || DEFAULT_TIMEZONE)
            .input('exceptionOnly', sql.Bit, payload.exceptionOnly ? 1 : 0)
            .input('filterJson', sql.NVarChar(sql.MAX), JSON.stringify(payload.filters || {}))
            .input('recipientJson', sql.NVarChar(sql.MAX), JSON.stringify(payload.recipients || []))
            .input('nextRunAt', sql.DateTime2, nextRunAt)
            .query(`
                INSERT INTO ExecutiveReportPack (
                    name, description, ownerOid, isActive, scheduleType, scheduleDayOfWeek,
                    scheduleHour, scheduleMinute, timezone, exceptionOnly, filterJson, scopeOrgId,
                    recipientJson, nextRunAt
                )
                OUTPUT INSERTED.*
                VALUES (
                    @name, @description, @ownerOid, @isActive, @scheduleType, @scheduleDayOfWeek,
                    @scheduleHour, @scheduleMinute, @timezone, @exceptionOnly, @filterJson, @scopeOrgId,
                    @recipientJson, @nextRunAt
                )
            `);

        const row = insert.recordset[0];
        logAudit({
            action: 'exec_pack.create',
            entityType: 'executive_pack',
            entityId: row.id,
            entityTitle: payload.name,
            user,
            after: {
                scheduleType: payload.scheduleType,
                scheduleDayOfWeek: payload.scheduleDayOfWeek,
                scheduleHour: payload.scheduleHour,
                scheduleMinute: payload.scheduleMinute,
                exceptionOnly: payload.exceptionOnly,
                recipients: payload.recipients,
                scopeOrgId
            },
            req
        });

        res.json(toPackResponse(row));
    } catch (err) {
        if (err?.message?.includes('required') || err?.message?.includes('must be')) {
            return res.status(400).json({ error: err.message });
        }
        handleError(res, 'creating executive report pack', err);
    }
});

// Update an existing pack
router.put('/packs/:id', checkPermission(['can_create_reports', 'can_view_exec_dashboard']), async (req, res) => {
    try {
        const packId = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(packId)) return res.status(400).json({ error: 'Invalid pack id' });

        const user = getAuthUser(req);
        const pool = await getPool();
        const existing = await pool.request()
            .input('id', sql.Int, packId)
            .query('SELECT * FROM ExecutiveReportPack WHERE id = @id');
        if (existing.recordset.length === 0) return res.status(404).json({ error: 'Pack not found' });

        const previous = existing.recordset[0];
        if (!isAdmin(user) && previous.ownerOid !== user?.oid) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const fallback = {
            name: previous.name,
            description: previous.description || null,
            scheduleType: previous.scheduleType,
            scheduleDayOfWeek: previous.scheduleDayOfWeek,
            scheduleHour: previous.scheduleHour,
            scheduleMinute: previous.scheduleMinute,
            timezone: previous.timezone || DEFAULT_TIMEZONE,
            exceptionOnly: !!previous.exceptionOnly,
            isActive: !!previous.isActive,
            recipients: parseJsonSafe(previous.recipientJson, []),
            filters: parseJsonSafe(previous.filterJson, {})
        };

        const payload = normalizePackPayload(req.body || {}, fallback);
        const nextRunAt = computeNextRunAt(payload);
        let scopeOrgId = previous.scopeOrgId === null || previous.scopeOrgId === undefined
            ? (req.orgId === undefined ? null : req.orgId)
            : Number(previous.scopeOrgId);
        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'scopeOrgId')) {
            const requested = req.body?.scopeOrgId;
            if (requested === null || requested === '') {
                if (!isAdmin(user)) {
                    return res.status(403).json({ error: 'Only admins can set pack scope outside their organization.' });
                }
                scopeOrgId = null;
            } else {
                const parsedScope = Number.parseInt(requested, 10);
                if (Number.isNaN(parsedScope)) {
                    return res.status(400).json({ error: 'scopeOrgId must be null or a valid organization id' });
                }
                if (!isAdmin(user) && req.orgId !== null && req.orgId !== undefined && Number(req.orgId) !== parsedScope) {
                    return res.status(403).json({ error: 'scopeOrgId must match your organization.' });
                }
                scopeOrgId = parsedScope;
            }
        }
        if (scopeOrgId !== null && scopeOrgId !== undefined) {
            const orgCheck = await pool.request()
                .input('orgId', sql.Int, scopeOrgId)
                .query('SELECT TOP 1 id FROM Organizations WHERE id = @orgId');
            if (!orgCheck.recordset.length) {
                return res.status(400).json({ error: 'Invalid scopeOrgId' });
            }
        }

        await pool.request()
            .input('id', sql.Int, packId)
            .input('name', sql.NVarChar(160), payload.name)
            .input('description', sql.NVarChar(500), payload.description)
            .input('scopeOrgId', sql.Int, scopeOrgId)
            .input('isActive', sql.Bit, payload.isActive ? 1 : 0)
            .input('scheduleType', sql.NVarChar(20), payload.scheduleType)
            .input('scheduleDayOfWeek', sql.TinyInt, payload.scheduleDayOfWeek)
            .input('scheduleHour', sql.TinyInt, payload.scheduleHour)
            .input('scheduleMinute', sql.TinyInt, payload.scheduleMinute)
            .input('timezone', sql.NVarChar(64), payload.timezone || DEFAULT_TIMEZONE)
            .input('exceptionOnly', sql.Bit, payload.exceptionOnly ? 1 : 0)
            .input('filterJson', sql.NVarChar(sql.MAX), JSON.stringify(payload.filters || {}))
            .input('recipientJson', sql.NVarChar(sql.MAX), JSON.stringify(payload.recipients || []))
            .input('nextRunAt', sql.DateTime2, nextRunAt)
            .query(`
                UPDATE ExecutiveReportPack
                SET
                    name = @name,
                    description = @description,
                    isActive = @isActive,
                    scheduleType = @scheduleType,
                    scheduleDayOfWeek = @scheduleDayOfWeek,
                    scheduleHour = @scheduleHour,
                    scheduleMinute = @scheduleMinute,
                    timezone = @timezone,
                    exceptionOnly = @exceptionOnly,
                    scopeOrgId = @scopeOrgId,
                    filterJson = @filterJson,
                    recipientJson = @recipientJson,
                    nextRunAt = @nextRunAt,
                    updatedAt = GETDATE()
                WHERE id = @id
            `);

        const refreshed = await pool.request()
            .input('id', sql.Int, packId)
            .query('SELECT * FROM ExecutiveReportPack WHERE id = @id');

        logAudit({
            action: 'exec_pack.update',
            entityType: 'executive_pack',
            entityId: packId,
            entityTitle: payload.name,
            user,
            before: {
                name: previous.name,
                scheduleType: previous.scheduleType,
                scheduleDayOfWeek: previous.scheduleDayOfWeek,
                scheduleHour: previous.scheduleHour,
                scheduleMinute: previous.scheduleMinute,
                exceptionOnly: !!previous.exceptionOnly
            },
            after: {
                name: payload.name,
                scheduleType: payload.scheduleType,
                scheduleDayOfWeek: payload.scheduleDayOfWeek,
                scheduleHour: payload.scheduleHour,
                scheduleMinute: payload.scheduleMinute,
                exceptionOnly: payload.exceptionOnly,
                scopeOrgId
            },
            req
        });

        res.json(toPackResponse(refreshed.recordset[0]));
    } catch (err) {
        if (err?.message?.includes('required') || err?.message?.includes('must be')) {
            return res.status(400).json({ error: err.message });
        }
        handleError(res, 'updating executive report pack', err);
    }
});

// List run history for a pack
router.get('/packs/:id/runs', checkPermission(['can_view_reports', 'can_view_exec_dashboard']), async (req, res) => {
    try {
        const packId = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(packId)) return res.status(400).json({ error: 'Invalid pack id' });

        const user = getAuthUser(req);
        const pool = await getPool();
        const packResult = await pool.request()
            .input('id', sql.Int, packId)
            .query('SELECT id, ownerOid FROM ExecutiveReportPack WHERE id = @id');
        if (packResult.recordset.length === 0) return res.status(404).json({ error: 'Pack not found' });
        if (!isAdmin(user) && packResult.recordset[0].ownerOid !== user?.oid) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const runs = await pool.request()
            .input('packId', sql.Int, packId)
            .query(`
                SELECT TOP 30 id, packId, runType, status, startedAt, completedAt, initiatedByOid, summaryJson, errorText
                FROM ExecutiveReportPackRun
                WHERE packId = @packId
                ORDER BY startedAt DESC
            `);

        res.json(runs.recordset.map((row) => ({
            id: String(row.id),
            packId: String(row.packId),
            runType: row.runType,
            status: row.status,
            startedAt: row.startedAt,
            completedAt: row.completedAt || null,
            initiatedByOid: row.initiatedByOid || null,
            summary: parseJsonSafe(row.summaryJson, null),
            errorText: row.errorText || null
        })));
    } catch (err) {
        handleError(res, 'listing executive pack runs', err);
    }
});

// Run a pack immediately
router.post('/packs/:id/run-now', checkPermission(['can_create_reports', 'can_view_exec_dashboard']), withSharedScope, async (req, res) => {
    try {
        const packId = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(packId)) return res.status(400).json({ error: 'Invalid pack id' });

        const user = getAuthUser(req);
        const pool = await getPool();
        const packResult = await pool.request()
            .input('id', sql.Int, packId)
            .query('SELECT * FROM ExecutiveReportPack WHERE id = @id');
        if (packResult.recordset.length === 0) return res.status(404).json({ error: 'Pack not found' });

        const packRow = packResult.recordset[0];
        if (!isAdmin(user) && packRow.ownerOid !== user?.oid) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const runResult = await executePackRun({
            pool,
            packRow,
            runType: 'manual',
            initiatedByOid: user?.oid || null,
            fallbackOrgId: req.orgId === undefined ? null : req.orgId
        });
        if (!runResult.ok) {
            return res.status(500).json({ error: runResult.error || 'Failed to run executive pack' });
        }

        logAudit({
            action: 'exec_pack.run_now',
            entityType: 'executive_pack',
            entityId: packId,
            entityTitle: packRow.name,
            user,
            after: {
                runId: runResult.runId,
                totalProjects: runResult.summary?.totalProjects ?? 0,
                redCount: runResult.summary?.redCount ?? 0,
                yellowCount: runResult.summary?.yellowCount ?? 0,
                overdueProjectCount: runResult.summary?.overdueProjectCount ?? 0
            },
            req
        });

        res.json({
            success: true,
            runId: runResult.runId,
            summary: runResult.summary,
            lastRunAt: runResult.completedAt,
            nextRunAt: runResult.nextRunAt
        });
    } catch (err) {
        handleError(res, 'running executive report pack', err);
    }
});

// Scheduler status for automated executive packs
router.get('/scheduler/status', checkPermission(['can_view_reports', 'can_view_exec_dashboard']), async (_req, res) => {
    try {
        const status = await getExecutivePackSchedulerStatus();
        res.json(status);
    } catch (err) {
        handleError(res, 'fetching executive pack scheduler status', err);
    }
});

// Trigger due scheduled runs immediately
router.post('/scheduler/run-due', checkPermission(['can_create_reports', 'can_view_exec_dashboard']), async (req, res) => {
    try {
        const maxRuns = Number.parseInt(req.body?.maxRuns, 10);
        const result = await runDueExecutiveReportPacks({
            maxRuns: Number.isNaN(maxRuns) ? 10 : maxRuns
        });
        res.json(result);
    } catch (err) {
        handleError(res, 'running due executive report packs', err);
    }
});

export default router;

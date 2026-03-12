import sql from 'mssql';
import { faker } from '@faker-js/faker';
import { getPool } from '../db.js';

const PROJECT_COUNT = Number.parseInt(process.env.FAKER_PROJECTS || '40', 10);
const TASKS_PER_PROJECT_MIN = Number.parseInt(process.env.FAKER_TASKS_MIN || '6', 10);
const TASKS_PER_PROJECT_MAX = Number.parseInt(process.env.FAKER_TASKS_MAX || '14', 10);
const REPORTS_PER_PROJECT_MIN = Number.parseInt(process.env.FAKER_REPORTS_MIN || '1', 10);
const REPORTS_PER_PROJECT_MAX = Number.parseInt(process.env.FAKER_REPORTS_MAX || '3', 10);
const TAGS_PER_PROJECT_MIN = Number.parseInt(process.env.FAKER_TAGS_MIN || '1', 10);
const TAGS_PER_PROJECT_MAX = Number.parseInt(process.env.FAKER_TAGS_MAX || '3', 10);
const DEFAULT_SEED_ORGANIZATIONS = Object.freeze([
    { name: 'Clinical Operations', slug: 'clinical-operations' },
    { name: 'Digital Health Delivery', slug: 'digital-health-delivery' }
]);

const existsTable = async (pool, tableName) => {
    const result = await pool.request()
        .input('tableName', sql.NVarChar, tableName)
        .query(`
            SELECT CASE WHEN EXISTS (
                SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @tableName
            ) THEN 1 ELSE 0 END AS tableExists
        `);
    return result.recordset[0].tableExists === 1;
};

const existsColumn = async (pool, tableName, columnName) => {
    const result = await pool.request()
        .input('tableName', sql.NVarChar, tableName)
        .input('columnName', sql.NVarChar, columnName)
        .query(`
            SELECT CASE WHEN EXISTS (
                SELECT 1
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = @tableName AND COLUMN_NAME = @columnName
            ) THEN 1 ELSE 0 END AS columnExists
        `);
    return result.recordset[0].columnExists === 1;
};

const loadActiveOrganizations = async (pool) => {
    const result = await pool.request().query(`
        SELECT id, name, slug
        FROM Organizations
        WHERE isActive = 1
        ORDER BY id ASC
    `);
    return result.recordset;
};

const upsertSeedOrganization = async (pool, { name, slug }) => {
    const result = await pool.request()
        .input('name', sql.NVarChar, name)
        .input('slug', sql.NVarChar, slug)
        .query(`
            MERGE Organizations AS target
            USING (SELECT @slug AS slug) AS source
            ON target.slug = source.slug
            WHEN MATCHED THEN
                UPDATE SET name = @name, isActive = 1
            WHEN NOT MATCHED THEN
                INSERT (name, slug, isActive)
                VALUES (@name, @slug, 1)
            OUTPUT INSERTED.id, INSERTED.name, INSERTED.slug;
        `);

    return result.recordset[0] || null;
};

const ensureSeedOrganizations = async (pool) => {
    const hasOrganizations = await existsTable(pool, 'Organizations');
    if (!hasOrganizations) return [];

    let activeOrganizations = await loadActiveOrganizations(pool);

    for (const organization of DEFAULT_SEED_ORGANIZATIONS) {
        if (activeOrganizations.length >= 2) {
            break;
        }
        if (activeOrganizations.some((activeOrg) => activeOrg.slug === organization.slug)) {
            continue;
        }

        const upserted = await upsertSeedOrganization(pool, organization);
        if (upserted) {
            activeOrganizations = [...activeOrganizations, upserted];
        }
    }

    if (activeOrganizations.length < 2) {
        activeOrganizations = await loadActiveOrganizations(pool);
    }

    return activeOrganizations.slice(0, 2);
};

const loadGoalsForScope = async (pool, { goalsHaveOrgId, orgId = null } = {}) => {
    if (goalsHaveOrgId) {
        const result = await pool.request()
            .input('orgId', sql.Int, orgId)
            .query(`
                SELECT id, orgId, type, parentId
                FROM Goals
                WHERE orgId = @orgId
                ORDER BY id ASC
            `);
        return result.recordset;
    }

    const result = await pool.request().query(`
        SELECT id, orgId, type, parentId
        FROM Goals
        ORDER BY id ASC
    `);
    return result.recordset;
};

const ensureGoal = async (pool, { title, type, parentId = null, orgId = null, goalsHaveOrgId }) => {
    const existingRequest = pool.request()
        .input('title', sql.NVarChar, title)
        .input('parentId', sql.Int, parentId);

    if (goalsHaveOrgId) {
        existingRequest.input('orgId', sql.Int, orgId);
    }

    const existingQuery = goalsHaveOrgId
        ? `
            SELECT TOP 1 id
            FROM Goals
            WHERE title = @title
              AND ((parentId IS NULL AND @parentId IS NULL) OR parentId = @parentId)
              AND orgId = @orgId
            ORDER BY id ASC
        `
        : `
            SELECT TOP 1 id
            FROM Goals
            WHERE title = @title
              AND ((parentId IS NULL AND @parentId IS NULL) OR parentId = @parentId)
            ORDER BY id ASC
        `;

    const existing = await existingRequest.query(existingQuery);
    if (existing.recordset.length > 0) {
        return existing.recordset[0].id;
    }

    const insertRequest = pool.request()
        .input('title', sql.NVarChar, title)
        .input('type', sql.NVarChar, type)
        .input('parentId', sql.Int, parentId);

    if (goalsHaveOrgId) {
        insertRequest.input('orgId', sql.Int, orgId);
    }

    const insertQuery = goalsHaveOrgId
        ? `
            INSERT INTO Goals (title, type, parentId, orgId)
            OUTPUT INSERTED.id
            VALUES (@title, @type, @parentId, @orgId)
        `
        : `
            INSERT INTO Goals (title, type, parentId)
            OUTPUT INSERTED.id
            VALUES (@title, @type, @parentId)
        `;

    const result = await insertRequest.query(insertQuery);
    return result.recordset[0].id;
};

const ensureGoalHierarchyForOrg = async (pool, { orgId = null, goalsHaveOrgId }) => {
    let scopedGoals = await loadGoalsForScope(pool, { goalsHaveOrgId, orgId });
    if (scopedGoals.some((goal) => goal.parentId)) {
        return scopedGoals;
    }

    const rootGoalId = await ensureGoal(pool, {
        title: 'Health System Transformation',
        type: 'enterprise',
        parentId: null,
        orgId,
        goalsHaveOrgId
    });
    const portfolio1 = await ensureGoal(pool, {
        title: 'Digital Front Door',
        type: 'portfolio',
        parentId: rootGoalId,
        orgId,
        goalsHaveOrgId
    });
    const portfolio2 = await ensureGoal(pool, {
        title: 'Clinical Platform Modernization',
        type: 'portfolio',
        parentId: rootGoalId,
        orgId,
        goalsHaveOrgId
    });
    const service1 = await ensureGoal(pool, {
        title: 'Virtual Care Access',
        type: 'service',
        parentId: portfolio1,
        orgId,
        goalsHaveOrgId
    });
    const service2 = await ensureGoal(pool, {
        title: 'Scheduling and Referrals',
        type: 'service',
        parentId: portfolio1,
        orgId,
        goalsHaveOrgId
    });
    const service3 = await ensureGoal(pool, {
        title: 'EHR Optimization',
        type: 'service',
        parentId: portfolio2,
        orgId,
        goalsHaveOrgId
    });
    const service4 = await ensureGoal(pool, {
        title: 'Data and Reporting',
        type: 'service',
        parentId: portfolio2,
        orgId,
        goalsHaveOrgId
    });

    await ensureGoal(pool, { title: 'Virtual Care Intake Team', type: 'team', parentId: service1, orgId, goalsHaveOrgId });
    await ensureGoal(pool, { title: 'Virtual Care Delivery Team', type: 'team', parentId: service1, orgId, goalsHaveOrgId });
    await ensureGoal(pool, { title: 'Referral Optimization Team', type: 'team', parentId: service2, orgId, goalsHaveOrgId });
    await ensureGoal(pool, { title: 'Scheduling Operations Team', type: 'team', parentId: service2, orgId, goalsHaveOrgId });
    await ensureGoal(pool, { title: 'Clinical Workflow Team', type: 'team', parentId: service3, orgId, goalsHaveOrgId });
    await ensureGoal(pool, { title: 'Platform Reliability Team', type: 'team', parentId: service3, orgId, goalsHaveOrgId });
    await ensureGoal(pool, { title: 'Analytics Delivery Team', type: 'team', parentId: service4, orgId, goalsHaveOrgId });
    await ensureGoal(pool, { title: 'Performance Reporting Team', type: 'team', parentId: service4, orgId, goalsHaveOrgId });

    scopedGoals = await loadGoalsForScope(pool, { goalsHaveOrgId, orgId });
    return scopedGoals;
};

const ensureGoals = async (pool, organizations, goalsHaveOrgId) => {
    if (!goalsHaveOrgId) {
        await ensureGoalHierarchyForOrg(pool, { orgId: null, goalsHaveOrgId: false });
        return loadGoalsForScope(pool, { goalsHaveOrgId: false });
    }

    const scopedGoals = [];
    for (const organization of organizations) {
        const goalsForOrg = await ensureGoalHierarchyForOrg(pool, {
            orgId: organization.id,
            goalsHaveOrgId
        });
        scopedGoals.push(...goalsForOrg);
    }

    return scopedGoals;
};

const getProjectAssignableGoals = (goals) => {
    const goalRecords = Array.isArray(goals) ? goals : [];
    const teamGoals = goalRecords.filter((goal) => goal.type === 'team');
    if (teamGoals.length > 0) return teamGoals;

    const serviceGoals = goalRecords.filter((goal) => goal.type === 'service');
    if (serviceGoals.length > 0) return serviceGoals;

    return goalRecords.filter((goal) => goal.type !== 'enterprise');
};

const ensureKpisForGoals = async (pool, goalIds) => {
    console.log('Seeding KPIs for goals...');
    for (const goalId of goalIds) {
        const kpiCountResult = await pool.request()
            .input('goalId', sql.Int, goalId)
            .query('SELECT COUNT(*) as count FROM KPIs WHERE goalId = @goalId');

        const currentCount = kpiCountResult.recordset[0].count;
        const targetCount = faker.number.int({ min: 3, max: 5 });

        if (currentCount < targetCount) {
            const needed = targetCount - currentCount;
            const table = new sql.Table('KPIs');
            table.create = false;
            table.columns.add('goalId', sql.Int, { nullable: false });
            table.columns.add('name', sql.NVarChar(255), { nullable: false });
            table.columns.add('target', sql.Decimal(18, 2), { nullable: true });
            table.columns.add('currentValue', sql.Decimal(18, 2), { nullable: true });
            table.columns.add('unit', sql.NVarChar(20), { nullable: true });

            for (let i = 0; i < needed; i++) {
                table.rows.add(
                    goalId,
                    faker.company.buzzPhrase(),
                    faker.number.float({ min: 80, max: 100, precision: 0.1 }),
                    faker.number.float({ min: 50, max: 95, precision: 0.1 }),
                    '%'
                );
            }
            const request = new sql.Request(pool);
            await request.bulk(table);
        }
    }
};

const maybeSeedProjectGoals = async (pool, hasProjectGoals, projectId, goalId) => {
    if (!hasProjectGoals) return;

    await pool.request()
        .input('projectId', sql.Int, projectId)
        .input('goalId', sql.Int, goalId)
        .query(`
            IF NOT EXISTS (
                SELECT 1 FROM ProjectGoals WHERE projectId = @projectId AND goalId = @goalId
            )
            BEGIN
                INSERT INTO ProjectGoals (projectId, goalId) VALUES (@projectId, @goalId)
            END
        `);
};

async function seedFakerData() {
    const pool = await getPool();

    try {
        console.log('Starting faker seed...');
        const projectsHaveOrgId = await existsColumn(pool, 'Projects', 'orgId');
        const goalsHaveOrgId = await existsColumn(pool, 'Goals', 'orgId');
        const hasProjectGoals = await existsTable(pool, 'ProjectGoals');
        const organizations = await ensureSeedOrganizations(pool);
        const goalRecords = await ensureGoals(pool, organizations, goalsHaveOrgId);
        const goalIds = goalRecords.map((goal) => goal.id);
        await ensureKpisForGoals(pool, goalIds);

        const organizationsToUse = organizations.length > 0
            ? organizations
            : [{ id: null, name: 'Default Seed Scope', slug: 'default-seed-scope' }];
        const assignableGoalsByOrg = new Map(
            organizationsToUse.map((organization) => {
                const scopedGoals = goalsHaveOrgId
                    ? goalRecords.filter((goal) => Number(goal.orgId) === Number(organization.id))
                    : goalRecords;
                return [String(organization.id ?? 'default'), getProjectAssignableGoals(scopedGoals)];
            })
        );
        const defaultAssignableGoals = getProjectAssignableGoals(goalRecords);

        if (organizations.length > 0) {
            console.log(`Using organizations: ${organizations.map((organization) => organization.name).join(', ')}`);
        }

        const createdProjectIds = [];
        for (let i = 0; i < PROJECT_COUNT; i += 1) {
            const targetOrganization = organizationsToUse[i % organizationsToUse.length];
            const scopedAssignableGoals = assignableGoalsByOrg.get(String(targetOrganization.id ?? 'default')) || defaultAssignableGoals;
            const selectedGoal = faker.helpers.arrayElement(scopedAssignableGoals.length > 0 ? scopedAssignableGoals : defaultAssignableGoals);
            const goalId = selectedGoal?.id;
            const projectOrgId = projectsHaveOrgId
                ? (selectedGoal?.orgId ?? targetOrganization.id ?? null)
                : null;
            const request = pool.request()
                .input('title', sql.NVarChar(255), `${faker.commerce.productName()} Initiative`)
                .input('description', sql.NVarChar(sql.MAX), faker.lorem.sentences({ min: 1, max: 2 }))
                .input('status', sql.NVarChar(20), faker.helpers.arrayElement(['active', 'planning', 'on-hold', 'completed']))
                .input('goalId', sql.Int, goalId);

            if (projectsHaveOrgId) {
                request.input('orgId', sql.Int, projectOrgId);
            }

            const insertProjectQuery = projectsHaveOrgId
                ? `
                    INSERT INTO Projects (title, description, status, goalId, orgId)
                    OUTPUT INSERTED.id
                    VALUES (@title, @description, @status, @goalId, @orgId)
                `
                : `
                    INSERT INTO Projects (title, description, status, goalId)
                    OUTPUT INSERTED.id
                    VALUES (@title, @description, @status, @goalId)
                `;

            const projectResult = await request.query(insertProjectQuery);
            const projectId = projectResult.recordset[0].id;
            createdProjectIds.push(projectId);
            await maybeSeedProjectGoals(pool, hasProjectGoals, projectId, goalId);

            // Fetch PDEs (KPIs) for this project's Goal
            const kpisResult = await pool.request()
                .input('goalId', sql.Int, goalId)
                .query('SELECT id, name FROM KPIs WHERE goalId = @goalId');

            const availableKpis = kpisResult.recordset;
            if (availableKpis.length > 0) {
                // Determine how many benefits to seed (e.g. 1 to 3, but not more than available KPIs)
                const benefitCount = Math.min(
                    faker.number.int({ min: 1, max: 3 }),
                    availableKpis.length
                );
                const selectedKpis = faker.helpers.arrayElements(availableKpis, benefitCount);

                for (const kpi of selectedKpis) {
                    await pool.request()
                        .input('projectId', sql.Int, projectId)
                        .input('title', sql.NVarChar(255), kpi.name)
                        .input('linkedKpiId', sql.Int, kpi.id)
                        .input('baselineValue', sql.Decimal(18, 2), faker.number.float({ min: 10, max: 50, precision: 0.1 }))
                        .input('targetValue', sql.Decimal(18, 2), faker.number.float({ min: 80, max: 100, precision: 0.1 }))
                        .input('currentValue', sql.Decimal(18, 2), faker.number.float({ min: 50, max: 95, precision: 0.1 }))
                        .input('unit', sql.NVarChar(50), '%')
                        .input('status', sql.NVarChar(50), faker.helpers.arrayElement(['planned', 'in-progress', 'realized', 'at-risk', 'not-realized']))
                        .query(`
                            INSERT INTO ProjectBenefitRealization (projectId, title, linkedKpiId, baselineValue, targetValue, currentValue, unit, status)
                            VALUES (@projectId, @title, @linkedKpiId, @baselineValue, @targetValue, @currentValue, @unit, @status)
                        `);
                }
            }
        }
        console.log(`Created projects: ${createdProjectIds.length}`);

        const tasksTable = new sql.Table('Tasks');
        tasksTable.create = false;
        tasksTable.columns.add('projectId', sql.Int, { nullable: false });
        tasksTable.columns.add('title', sql.NVarChar(255), { nullable: false });
        tasksTable.columns.add('status', sql.NVarChar(20), { nullable: true });
        tasksTable.columns.add('priority', sql.NVarChar(20), { nullable: true });
        tasksTable.columns.add('startDate', sql.Date, { nullable: true });
        tasksTable.columns.add('endDate', sql.Date, { nullable: true });

        let taskCount = 0;
        for (const projectId of createdProjectIds) {
            const count = faker.number.int({ min: TASKS_PER_PROJECT_MIN, max: TASKS_PER_PROJECT_MAX });
            for (let i = 0; i < count; i += 1) {
                const startDate = faker.date.recent({ days: 90 });
                const endDate = faker.date.soon({ days: 120, refDate: startDate });
                tasksTable.rows.add(
                    projectId,
                    `${faker.hacker.verb()} ${faker.hacker.noun()}`,
                    faker.helpers.arrayElement(['todo', 'in-progress', 'review', 'done']),
                    faker.helpers.arrayElement(['low', 'medium', 'high']),
                    startDate,
                    endDate
                );
                taskCount += 1;
            }
        }
        if (taskCount > 0) {
            await new sql.Request(pool).bulk(tasksTable);
        }
        console.log(`Created tasks: ${taskCount}`);

        let reportCount = 0;
        for (const projectId of createdProjectIds) {
            const versions = faker.number.int({
                min: REPORTS_PER_PROJECT_MIN,
                max: REPORTS_PER_PROJECT_MAX
            });
            for (let version = 1; version <= versions; version += 1) {
                const reportData = JSON.stringify({
                    summary: faker.lorem.paragraph(),
                    overallStatus: faker.helpers.arrayElement(['green', 'yellow', 'red']),
                    purpose: faker.lorem.paragraph(),
                    executiveSummary: faker.lorem.paragraph(),
                    goodNews: faker.lorem.paragraph(),
                    kpis: faker.lorem.paragraph(),
                    contacts: Array.from({ length: faker.number.int({ min: 4, max: 6 }) }, () => ({
                        id: faker.string.uuid(),
                        name: faker.person.fullName(),
                        organization: faker.company.name()
                    })),
                    workstreams: Array.from({ length: faker.number.int({ min: 4, max: 6 }) }, () => ({
                        id: faker.string.uuid(),
                        name: faker.company.catchPhrase(),
                        progressLastPeriod: faker.lorem.sentence(),
                        workAhead: faker.lorem.sentence(),
                        barriers: faker.lorem.sentence(),
                        status: faker.helpers.arrayElement(['green', 'yellow', 'red'])
                    })),
                    risks: Array.from({ length: faker.number.int({ min: 4, max: 6 }) }, () => ({
                        id: faker.string.uuid(),
                        description: faker.lorem.sentence(),
                        impact: faker.lorem.sentence(),
                        priority: faker.helpers.arrayElement(['low', 'medium', 'high']),
                        mitigation: faker.lorem.sentence(),
                        status: faker.helpers.arrayElement(['open', 'closed']),
                        closedDate: faker.date.recent(),
                        closedRationale: faker.lorem.sentence()
                    })),
                    milestones: Array.from({ length: faker.number.int({ min: 4, max: 6 }) }, () => ({
                        id: faker.string.uuid(),
                        name: faker.company.buzzPhrase(),
                        date: faker.date.future(),
                        status: faker.helpers.arrayElement(['pending', 'in-progress', 'complete'])
                    })),
                    decisions: Array.from({ length: faker.number.int({ min: 4, max: 6 }) }, () => ({
                        id: faker.string.uuid(),
                        description: faker.lorem.sentence(),
                        priority: faker.helpers.arrayElement(['low', 'medium', 'high']),
                        status: faker.helpers.arrayElement(['pending', 'approved', 'rejected']),
                        decisionStatement: faker.lorem.sentence(),
                        decisionDate: faker.date.recent()
                    }))
                });

                await pool.request()
                    .input('projectId', sql.Int, projectId)
                    .input('version', sql.Int, version)
                    .input('reportData', sql.NVarChar(sql.MAX), reportData)
                    .input('createdBy', sql.NVarChar(100), faker.internet.email())
                    .query(`
                        INSERT INTO StatusReports (projectId, version, reportData, createdBy)
                        VALUES (@projectId, @version, @reportData, @createdBy)
                    `);
                reportCount += 1;
            }
        }
        console.log(`Created status reports: ${reportCount}`);

        const hasTags = await existsTable(pool, 'Tags');
        const hasProjectTags = await existsTable(pool, 'ProjectTags');
        if (hasTags && hasProjectTags) {
            const tagsResult = await pool.request()
                .query(`SELECT id FROM Tags WHERE status = 'active'`);
            const tagIds = tagsResult.recordset.map((row) => row.id);

            if (tagIds.length > 0) {
                const projectTagsTable = new sql.Table('ProjectTags');
                projectTagsTable.create = false;
                projectTagsTable.columns.add('projectId', sql.Int, { nullable: false });
                projectTagsTable.columns.add('tagId', sql.Int, { nullable: false });
                projectTagsTable.columns.add('isPrimary', sql.Bit, { nullable: false });

                for (const projectId of createdProjectIds) {
                    const count = Math.min(
                        faker.number.int({ min: TAGS_PER_PROJECT_MIN, max: TAGS_PER_PROJECT_MAX }),
                        tagIds.length
                    );
                    const picked = faker.helpers.arrayElements(tagIds, count);
                    for (const tagId of picked) {
                        projectTagsTable.rows.add(projectId, tagId, 0);
                    }
                }

                if (projectTagsTable.rows.length > 0) {
                    await new sql.Request(pool).bulk(projectTagsTable);
                    console.log(`Created project tags: ${projectTagsTable.rows.length}`);
                }
            }
        }

        console.log('Faker seed complete.');
        process.exit(0);
    } catch (err) {
        console.error('Faker seed failed:', err.message);
        process.exit(1);
    }
}

seedFakerData();

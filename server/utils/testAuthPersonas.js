import { normalizeRoleList } from './rbacCatalog.js';

const normalizeMockPersona = (persona) => ({
    ...persona,
    roles: normalizeRoleList(Array.isArray(persona?.roles) ? persona.roles : []),
    orgId: persona?.orgId ? Number.parseInt(persona.orgId, 10) : null
});

export const TEST_PERSONAS = Object.freeze({
    admin: normalizeMockPersona({
        oid: 'test-admin-oid',
        tid: 'test-tenant-id',
        name: 'Test Admin',
        email: 'admin@test.local',
        roles: ['Admin'],
        orgId: 1
    }),
    viewer: normalizeMockPersona({
        oid: 'test-viewer-oid',
        tid: 'test-tenant-id',
        name: 'Test Viewer',
        email: 'viewer@test.local',
        roles: ['Viewer'],
        orgId: 1
    }),
    editor: normalizeMockPersona({
        oid: 'test-editor-oid',
        tid: 'test-tenant-id',
        name: 'Test Editor',
        email: 'editor@test.local',
        roles: ['Editor'],
        orgId: 1
    }),
    intake_manager: normalizeMockPersona({
        oid: 'test-intake-manager-oid',
        tid: 'test-tenant-id',
        name: 'Test Intake Manager',
        email: 'intake-manager@test.local',
        roles: ['IntakeManager'],
        orgId: 1
    }),
    governance_member: normalizeMockPersona({
        oid: 'test-governance-member-oid',
        tid: 'test-tenant-id',
        name: 'Test Governance Member',
        email: 'governance-member@test.local',
        roles: ['GovernanceMember'],
        orgId: 1
    }),
    governance_chair: normalizeMockPersona({
        oid: 'test-governance-chair-oid',
        tid: 'test-tenant-id',
        name: 'Test Governance Chair',
        email: 'governance-chair@test.local',
        roles: ['GovernanceChair'],
        orgId: 1
    }),
    org2_editor: normalizeMockPersona({
        oid: 'test-org2-editor-oid',
        tid: 'test-tenant-id',
        name: 'Test Org2 Editor',
        email: 'org2-editor@test.local',
        roles: ['Editor'],
        orgId: 2
    })
});

export const getMockTestPersona = (personaKey) => {
    const normalizedKey = String(personaKey || '').trim().toLowerCase();
    return TEST_PERSONAS[normalizedKey] || null;
};


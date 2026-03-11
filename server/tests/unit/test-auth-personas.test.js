import test from 'node:test';
import assert from 'node:assert/strict';
import { TEST_PERSONAS, getMockTestPersona } from '../../utils/testAuthPersonas.js';
import { createApp } from '../../app.js';

test('mock personas are available and role arrays are normalized', () => {
    const requiredPersonas = [
        'admin',
        'viewer',
        'editor',
        'intake_manager',
        'governance_member',
        'governance_chair',
        'org2_editor'
    ];
    requiredPersonas.forEach((personaKey) => {
        const persona = TEST_PERSONAS[personaKey];
        assert.ok(persona, `missing persona ${personaKey}`);
        assert.ok(Array.isArray(persona.roles), `${personaKey} roles should be an array`);
        assert.ok(persona.roles.length > 0, `${personaKey} should include at least one role`);
    });
});

test('getMockTestPersona is case-insensitive', () => {
    const persona = getMockTestPersona('GoVeRnAnCe_MeMbEr');
    assert.equal(persona?.oid, TEST_PERSONAS.governance_member.oid);
});

test('mock auth mode is blocked in production', () => {
    assert.throws(() => {
        createApp({
            testAuthMode: 'mock',
            env: {
                NODE_ENV: 'production'
            }
        });
    }, /not allowed in production/i);
});


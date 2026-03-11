import { describe, expect, it } from 'vitest';
import {
    ensureRequiredIntakeFields,
    getIntakeSystemField,
    INTAKE_SYSTEM_FIELD_KEYS
} from '../../../shared/intakeSystemFields.js';

describe('intake system fields', () => {
    it('adds the required system fields to new forms', () => {
        const fields = ensureRequiredIntakeFields([]);

        expect(fields).toHaveLength(3);
        expect(fields.map((field) => field.label)).toEqual([
            'Your Name',
            'Project Name',
            'Description'
        ]);
        expect(fields.every((field) => field.required)).toBe(true);
    });

    it('upgrades legacy labels into explicit system fields', () => {
        const fields = ensureRequiredIntakeFields([
            { id: 'legacy-name', type: 'text', label: 'Request Name', required: true, options: [] },
            { id: 'legacy-desc', type: 'textarea', label: 'Description', required: false, options: [] }
        ]);

        const projectNameField = getIntakeSystemField(fields, INTAKE_SYSTEM_FIELD_KEYS.PROJECT_NAME);
        const descriptionField = getIntakeSystemField(fields, INTAKE_SYSTEM_FIELD_KEYS.PROJECT_DESCRIPTION);
        const requesterField = getIntakeSystemField(fields, INTAKE_SYSTEM_FIELD_KEYS.REQUESTER_NAME);

        expect(projectNameField).toMatchObject({
            id: 'projectName',
            label: 'Project Name',
            required: true,
            systemKey: INTAKE_SYSTEM_FIELD_KEYS.PROJECT_NAME
        });
        expect(descriptionField).toMatchObject({
            id: 'legacy-desc',
            label: 'Description',
            required: true,
            systemKey: INTAKE_SYSTEM_FIELD_KEYS.PROJECT_DESCRIPTION
        });
        expect(requesterField).toMatchObject({
            label: 'Your Name',
            required: true,
            systemKey: INTAKE_SYSTEM_FIELD_KEYS.REQUESTER_NAME
        });
    });
});

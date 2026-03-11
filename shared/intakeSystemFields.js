export const INTAKE_SYSTEM_FIELD_KEYS = Object.freeze({
    REQUESTER_NAME: 'requester_name',
    PROJECT_NAME: 'project_name',
    PROJECT_DESCRIPTION: 'project_description'
});

export const INTAKE_SYSTEM_FIELDS = Object.freeze([
    {
        key: INTAKE_SYSTEM_FIELD_KEYS.REQUESTER_NAME,
        id: 'requesterName',
        type: 'text',
        label: 'Your Name'
    },
    {
        key: INTAKE_SYSTEM_FIELD_KEYS.PROJECT_NAME,
        id: 'projectName',
        type: 'text',
        label: 'Project Name'
    },
    {
        key: INTAKE_SYSTEM_FIELD_KEYS.PROJECT_DESCRIPTION,
        id: 'projectDescription',
        type: 'textarea',
        label: 'Description'
    }
]);

const normalizeLabel = (value) => String(value || '').trim().toLowerCase();

const getSystemDefinition = (key) => INTAKE_SYSTEM_FIELDS.find((field) => field.key === key) || null;

const matchesSystemField = (field, definition) => {
    if (!field || !definition) return false;
    if (String(field.systemKey || '').trim().toLowerCase() === definition.key) return true;
    return normalizeLabel(field.label) === normalizeLabel(definition.label);
};

const normalizeFieldOptions = (field) => {
    if (field?.type !== 'select') return [];
    return Array.isArray(field.options) ? field.options : [];
};

export const getIntakeSystemField = (fields = [], key) => {
    const definition = getSystemDefinition(key);
    if (!definition || !Array.isArray(fields)) return null;
    return fields.find((field) => matchesSystemField(field, definition)) || null;
};

export const createIntakeSystemField = (key, existingField = null) => {
    const definition = getSystemDefinition(key);
    if (!definition) return null;

    return {
        id: existingField?.id || definition.id,
        type: definition.type,
        label: definition.label,
        required: true,
        options: normalizeFieldOptions(existingField),
        systemKey: definition.key,
        locked: true
    };
};

export const ensureRequiredIntakeFields = (fields = []) => {
    const sourceFields = Array.isArray(fields) ? fields : [];
    const consumedIndexes = new Set();

    const normalizedSystemFields = INTAKE_SYSTEM_FIELDS.map((definition) => {
        const existingIndex = sourceFields.findIndex((field, index) => (
            !consumedIndexes.has(index) && matchesSystemField(field, definition)
        ));
        const existingField = existingIndex >= 0 ? sourceFields[existingIndex] : null;
        if (existingIndex >= 0) {
            consumedIndexes.add(existingIndex);
        }
        return createIntakeSystemField(definition.key, existingField);
    }).filter(Boolean);

    const remainingFields = sourceFields
        .filter((_, index) => !consumedIndexes.has(index))
        .map((field, index) => ({
            id: field?.id || `f-${Date.now()}-${index}`,
            type: field?.type || 'text',
            label: field?.label || '',
            required: !!field?.required,
            options: normalizeFieldOptions(field),
            systemKey: field?.systemKey || null,
            locked: !!field?.locked
        }));

    return [...normalizedSystemFields, ...remainingFields];
};

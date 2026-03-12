import { useEffect, useState } from 'react';
import { Plus, Trash2, Copy, Check, FileText, ChevronUp, ChevronDown } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { ensureRequiredIntakeFields, INTAKE_SYSTEM_FIELDS } from '../../../shared/intakeSystemFields.js';
import './Intake.css';

const FIELD_TYPES = [
    { value: 'text', label: 'Text' },
    { value: 'textarea', label: 'Long Text' },
    { value: 'email', label: 'Email' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
    { value: 'select', label: 'Dropdown' }
];

const parseSelectOptions = (value) => String(value || '')
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean);

const withOptionsText = (field) => ({
    ...field,
    optionsText: field.type === 'select'
        ? (typeof field.optionsText === 'string' ? field.optionsText : (field.options || []).join(', '))
        : ''
});

const buildEditableFields = (sourceFields) => ensureRequiredIntakeFields(sourceFields).map(withOptionsText);

const serializeField = (field) => ({
    id: field.id,
    type: field.type,
    label: field.label,
    required: !!field.required,
    options: field.type === 'select'
        ? parseSelectOptions(typeof field.optionsText === 'string' ? field.optionsText : (field.options || []).join(', '))
        : [],
    systemKey: field.systemKey || null,
    locked: !!field.locked
});

export function IntakeFormBuilder({ form, onClose }) {
    const {
        addIntakeForm,
        updateIntakeForm,
        goals,
        fetchGovernanceBoards,
        fetchOrganizations,
        hasPermission,
        hasRole,
        currentUser
    } = useData();
    const toast = useToast();
    const isEditing = !!form;
    const canManageGovernance = hasPermission('can_manage_governance');
    const isAdmin = hasRole('Admin');

    const [name, setName] = useState(form?.name || '');
    const [description, setDescription] = useState(form?.description || '');
    const [fields, setFields] = useState(() => buildEditableFields(form?.fields || []));
    const [defaultGoalId, setDefaultGoalId] = useState(form?.defaultGoalId || '');
    const [governanceMode, setGovernanceMode] = useState(form?.governanceMode || 'off');
    const [governanceBoardId, setGovernanceBoardId] = useState(form?.governanceBoardId || '');
    const [governanceBoards, setGovernanceBoards] = useState([]);
    const [organizations, setOrganizations] = useState([]);
    const [selectedOrgId, setSelectedOrgId] = useState(form?.orgId || (currentUser?.orgId ? String(currentUser.orgId) : ''));
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        let cancelled = false;
        async function loadBoards() {
            if (!canManageGovernance) return;
            try {
                const boards = await fetchGovernanceBoards({ includeInactive: true });
                if (!cancelled) setGovernanceBoards(Array.isArray(boards) ? boards : []);
            } catch (err) {
                console.warn('Failed to load governance boards', err);
                if (!cancelled) setGovernanceBoards([]);
            }
        }
        loadBoards();
        return () => {
            cancelled = true;
        };
    }, [canManageGovernance, fetchGovernanceBoards]);

    useEffect(() => {
        let cancelled = false;
        async function loadOrganizations() {
            if (!isAdmin) return;
            try {
                const orgs = await fetchOrganizations();
                if (!cancelled) {
                    setOrganizations(Array.isArray(orgs) ? orgs : []);
                }
            } catch (err) {
                console.warn('Failed to load organizations for intake forms', err);
                if (!cancelled) {
                    setOrganizations([]);
                }
            }
        }
        loadOrganizations();
        return () => {
            cancelled = true;
        };
    }, [fetchOrganizations, isAdmin]);

    const addField = () => {
        setFields(buildEditableFields([...fields, {
            id: `f-${Date.now()}`,
            type: 'text',
            label: '',
            required: false,
            options: [],
            optionsText: ''
        }]));
    };

    const updateField = (id, updates) => {
        setFields(fields.map(f => f.id === id ? { ...f, ...updates } : f));
    };

    const removeField = (id) => {
        const fieldToRemove = fields.find((field) => field.id === id);
        if (fieldToRemove?.locked) return;
        setFields(fields.filter(f => f.id !== id));
    };

    const moveField = (index, direction) => {
        const newFields = [...fields];
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= fields.length) return;
        if (fields[index]?.locked || fields[newIndex]?.locked) return;
        [newFields[index], newFields[newIndex]] = [newFields[newIndex], newFields[index]];
        setFields(newFields);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (canManageGovernance && governanceMode !== 'off' && !governanceBoardId) {
            return;
        }
        if (isAdmin && !selectedOrgId) {
            toast.error('Select an owning organization for this intake form');
            return;
        }

        const formData = {
            name,
            description,
            fields: fields.map(serializeField),
            defaultGoalId: defaultGoalId || null
        };
        if (isAdmin) {
            formData.orgId = selectedOrgId;
        }
        if (canManageGovernance) {
            formData.governanceMode = governanceMode;
            formData.governanceBoardId = governanceMode === 'off' ? null : (governanceBoardId || null);
        }

        try {
            if (isEditing) {
                await updateIntakeForm(form.id, formData);
                toast.success('Intake form updated');
            } else {
                await addIntakeForm(formData);
                toast.success('Intake form created');
            }
            onClose();
        } catch (err) {
            toast.error(err.message || 'Failed to save intake form');
        }
    };

    const getFormUrl = () => {
        const baseUrl = window.location.origin;
        return `${baseUrl}/#/intake/${form?.id}`;
    };

    const copyLink = () => {
        navigator.clipboard.writeText(getFormUrl());
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const hasMissingLabels = fields.some(f => !f.label || !f.label.trim());
    const missingSystemFields = INTAKE_SYSTEM_FIELDS.filter((systemField) => (
        !fields.some((field) => String(field.systemKey || '').toLowerCase() === systemField.key)
    ));
    const hasGovernanceError = canManageGovernance && governanceMode !== 'off' && !governanceBoardId;
    const hasOrgSelectionError = isAdmin && !selectedOrgId;

    const isInvalid = !name || hasMissingLabels || missingSystemFields.length > 0 || hasGovernanceError || hasOrgSelectionError;

    return (
        <form onSubmit={handleSubmit} className="intake-form-builder">
            <div className="form-group">
                <label>Form Name *</label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., New Project Request"
                    className="form-input"
                    required
                />
            </div>

            <div className="form-group">
                <label>Description</label>
                <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Instructions for the requester..."
                    className="form-textarea"
                    rows={2}
                />
            </div>

            {isAdmin && (
                <div className="form-group">
                    <label>Owning Organization *</label>
                    <select
                        value={selectedOrgId}
                        onChange={(e) => setSelectedOrgId(e.target.value)}
                        className="form-select"
                        required
                    >
                        <option value="">Select organization</option>
                        {organizations.map((organization) => (
                            <option key={organization.id} value={organization.id}>
                                {organization.name}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            <div className="form-group">
                <label>Default Goal (optional)</label>
                <select
                    value={defaultGoalId}
                    onChange={(e) => setDefaultGoalId(e.target.value)}
                    className="form-select"
                >
                    <option value="">No default goal</option>
                    {goals.map(g => (
                        <option key={g.id} value={g.id}>{g.title}</option>
                    ))}
                </select>
            </div>

            {canManageGovernance && (
                <>
                    <div className="form-group">
                        <label>Governance Policy</label>
                        <select
                            value={governanceMode}
                            onChange={(e) => {
                                const mode = e.target.value;
                                setGovernanceMode(mode);
                                if (mode === 'off') setGovernanceBoardId('');
                            }}
                            className="form-select"
                        >
                            <option value="off">Off (default intake flow)</option>
                            <option value="optional">Optional (manager decides per submission)</option>
                            <option value="required">Required (always enters governance if enabled)</option>
                        </select>
                    </div>

                    <div className="form-group">
                        <label>Governance Board {governanceMode !== 'off' ? '*' : '(optional)'}</label>
                        <select
                            value={governanceBoardId}
                            onChange={(e) => setGovernanceBoardId(e.target.value)}
                            className="form-select"
                            disabled={governanceMode === 'off'}
                        >
                            <option value="">{governanceMode === 'off' ? 'No board required' : 'Select board'}</option>
                            {governanceBoards.map(board => (
                                <option key={board.id} value={board.id}>
                                    {board.name} {board.isActive ? '' : '(Inactive)'}
                                </option>
                            ))}
                        </select>
                        {governanceMode !== 'off' && !governanceBoardId && (
                            <p className="intake-form-warning">
                                Select a board when policy is optional or required.
                            </p>
                        )}
                    </div>
                </>
            )}

            <div className="form-section">
                <div className="section-header">
                    <h4>Form Fields</h4>
                    <button type="button" className="btn-icon" onClick={addField}>
                        <Plus size={16} /> Add Field
                    </button>
                </div>

                {fields.length === 0 && (
                    <div className="empty-fields">
                        <FileText size={32} />
                        <p>No fields yet. Add fields to build your form.</p>
                    </div>
                )}

                <div className="fields-list">
                    {fields.map((field, index) => (
                        <div key={field.id} className="field-item">
                            <div className="field-drag">
                                <button
                                    type="button"
                                    onClick={() => moveField(index, -1)}
                                    disabled={index === 0 || field.locked || fields[index - 1]?.locked}
                                    className="move-btn"
                                    aria-label="Move field up"
                                >
                                    <ChevronUp size={14} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => moveField(index, 1)}
                                    disabled={index === fields.length - 1 || field.locked || fields[index + 1]?.locked}
                                    className="move-btn"
                                    aria-label="Move field down"
                                >
                                    <ChevronDown size={14} />
                                </button>
                            </div>

                            <div className="field-config">
                                <input
                                    type="text"
                                    value={field.label}
                                    onChange={(e) => updateField(field.id, { label: e.target.value })}
                                    placeholder="Field label"
                                    className="form-input field-label-input"
                                    disabled={field.locked}
                                />

                                <select
                                    value={field.type}
                                    onChange={(e) => updateField(field.id, { type: e.target.value })}
                                    className="form-select field-type-select"
                                    disabled={field.locked}
                                >
                                    {FIELD_TYPES.map(t => (
                                        <option key={t.value} value={t.value}>{t.label}</option>
                                    ))}
                                </select>

                                <label className="required-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={field.required}
                                        onChange={(e) => updateField(field.id, { required: e.target.checked })}
                                        disabled={field.locked}
                                    />
                                    {field.locked ? 'Required system field' : 'Required'}
                                </label>

                                <button
                                    type="button"
                                    onClick={() => removeField(field.id)}
                                    className="btn-icon-danger"
                                    disabled={field.locked}
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>

                            {field.type === 'select' && (
                                <div className="field-options">
                                    <input
                                        type="text"
                                        value={field.optionsText || ''}
                                        onChange={(e) => updateField(field.id, {
                                            optionsText: e.target.value,
                                            options: parseSelectOptions(e.target.value)
                                        })}
                                        placeholder="Options (comma-separated)"
                                        className="form-input"
                                    />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {isEditing && (
                <div className="form-link-section">
                    <label>Shareable Link</label>
                    <div className="link-copy">
                        <input type="text" value={getFormUrl()} readOnly className="form-input" />
                        <button type="button" onClick={copyLink} className="btn-secondary">
                            {copied ? <Check size={16} /> : <Copy size={16} />}
                            {copied ? 'Copied!' : 'Copy'}
                        </button>
                    </div>
                </div>
            )}

            <div className="form-actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                {isInvalid && (
                    <div style={{ backgroundColor: 'var(--bg-warning, #fffbeb)', border: '1px solid var(--border-warning, #fef08a)', borderRadius: '6px', padding: '0.75rem', marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--text-warning, #92400e)' }}>
                        <strong>Cannot save form yet. Please fix the following:</strong>
                        <ul style={{ margin: '0.5rem 0 0 1.25rem', padding: 0 }}>
                            {!name && <li>Form Name is required</li>}
                            {hasMissingLabels && <li>All fields must have a label</li>}
                            {missingSystemFields.length > 0 && <li>Your Name, Project Name, and Description are required system fields on every intake form</li>}
                            {hasGovernanceError && <li>Governance Board must be selected when policy is Optional or Required</li>}
                        </ul>
                    </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                    <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
                    <button
                        type="submit"
                        className="btn-primary"
                        disabled={isInvalid}
                    >
                        {isEditing ? 'Save Changes' : 'Create Form'}
                    </button>
                </div>
            </div>
        </form>
    );
}

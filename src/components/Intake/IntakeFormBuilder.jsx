import { useState } from 'react';
import { Plus, Trash2, Copy, GripVertical, Check, FileText } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { Modal } from '../UI/Modal';
import './Intake.css';

const FIELD_TYPES = [
    { value: 'text', label: 'Text' },
    { value: 'textarea', label: 'Long Text' },
    { value: 'email', label: 'Email' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
    { value: 'select', label: 'Dropdown' }
];

export function IntakeFormBuilder({ form, onClose }) {
    const { addIntakeForm, updateIntakeForm, goals } = useData();
    const isEditing = !!form;

    const [name, setName] = useState(form?.name || '');
    const [description, setDescription] = useState(form?.description || '');
    const [fields, setFields] = useState(form?.fields || []);
    const [defaultGoalId, setDefaultGoalId] = useState(form?.defaultGoalId || '');
    const [copied, setCopied] = useState(false);

    const addField = () => {
        setFields([...fields, {
            id: `f-${Date.now()}`,
            type: 'text',
            label: '',
            required: false,
            options: []
        }]);
    };

    const updateField = (id, updates) => {
        setFields(fields.map(f => f.id === id ? { ...f, ...updates } : f));
    };

    const removeField = (id) => {
        setFields(fields.filter(f => f.id !== id));
    };

    const moveField = (index, direction) => {
        const newFields = [...fields];
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= fields.length) return;
        [newFields[index], newFields[newIndex]] = [newFields[newIndex], newFields[index]];
        setFields(newFields);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const formData = {
            name,
            description,
            fields,
            defaultGoalId: defaultGoalId || null
        };

        if (isEditing) {
            updateIntakeForm(form.id, formData);
        } else {
            addIntakeForm(formData);
        }
        onClose();
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

    return (
        <form onSubmit={handleSubmit} className="intake-form-builder">
            <div className="form-group">
                <label>Form Name *</label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., New Project Request"
                    required
                />
            </div>

            <div className="form-group">
                <label>Description</label>
                <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Instructions for the requester..."
                    rows={2}
                />
            </div>

            <div className="form-group">
                <label>Default Goal (optional)</label>
                <select
                    value={defaultGoalId}
                    onChange={(e) => setDefaultGoalId(e.target.value)}
                >
                    <option value="">No default goal</option>
                    {goals.map(g => (
                        <option key={g.id} value={g.id}>{g.title}</option>
                    ))}
                </select>
            </div>

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
                                    disabled={index === 0}
                                    className="move-btn"
                                >↑</button>
                                <button
                                    type="button"
                                    onClick={() => moveField(index, 1)}
                                    disabled={index === fields.length - 1}
                                    className="move-btn"
                                >↓</button>
                            </div>

                            <div className="field-config">
                                <input
                                    type="text"
                                    value={field.label}
                                    onChange={(e) => updateField(field.id, { label: e.target.value })}
                                    placeholder="Field label"
                                    className="field-label-input"
                                />

                                <select
                                    value={field.type}
                                    onChange={(e) => updateField(field.id, { type: e.target.value })}
                                    className="field-type-select"
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
                                    />
                                    Required
                                </label>

                                <button
                                    type="button"
                                    onClick={() => removeField(field.id)}
                                    className="btn-icon-danger"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>

                            {field.type === 'select' && (
                                <div className="field-options">
                                    <input
                                        type="text"
                                        value={(field.options || []).join(', ')}
                                        onChange={(e) => updateField(field.id, {
                                            options: e.target.value.split(',').map(o => o.trim()).filter(Boolean)
                                        })}
                                        placeholder="Options (comma-separated)"
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
                        <input type="text" value={getFormUrl()} readOnly />
                        <button type="button" onClick={copyLink} className="btn-secondary">
                            {copied ? <Check size={16} /> : <Copy size={16} />}
                            {copied ? 'Copied!' : 'Copy'}
                        </button>
                    </div>
                </div>
            )}

            <div className="form-actions">
                <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary" disabled={!name || fields.length === 0}>
                    {isEditing ? 'Save Changes' : 'Create Form'}
                </button>
            </div>
        </form>
    );
}

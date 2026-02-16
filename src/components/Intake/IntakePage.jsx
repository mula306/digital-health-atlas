import { useState } from 'react';
import { Plus, Copy, Check, Edit2, Trash2, FileText, Inbox } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { Modal } from '../UI/Modal';
import { IntakeFormBuilder } from './IntakeFormBuilder';
import { IntakeRequestsList } from './IntakeRequestsList';
import { MySubmissionsList } from './MySubmissionsList';
import { useAuth } from '../../hooks/useAuth';
import './Intake.css';

export function IntakePage() {
    const { intakeForms, deleteIntakeForm, intakeSubmissions, permissions } = useData();
    const { userRoles } = useAuth();

    // Permission Check Helper
    const hasPermission = (permissionKey) => {
        if (userRoles.includes('Admin')) return true;
        return userRoles.some(role => {
            const entry = permissions.find(p => p.role === role && p.permission === permissionKey);
            return entry ? entry.isAllowed : false;
        });
    };

    const canViewIncoming = hasPermission('can_view_incoming_requests');
    const canManageForms = hasPermission('can_manage_intake_forms');

    const [activeTab, setActiveTab] = useState('my-requests');
    const [showFormModal, setShowFormModal] = useState(false);
    const [editingForm, setEditingForm] = useState(null);
    const [copiedId, setCopiedId] = useState('');

    const pendingCount = intakeSubmissions.filter(s => s.status === 'pending' || s.status === 'info-requested').length;

    const copyFormLink = (formId) => {
        const baseUrl = window.location.origin;
        navigator.clipboard.writeText(`${baseUrl}/#/intake/${formId}`);
        setCopiedId(formId);
        setTimeout(() => setCopiedId(''), 2000);
    };

    const handleDeleteForm = (formId) => {
        if (confirm('Are you sure you want to delete this form? Existing submissions will remain.')) {
            deleteIntakeForm(formId);
        }
    };

    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    return (
        <div className="intake-page">
            <div className="intake-header">
                <h1>Intake Portal</h1>
                {canManageForms && activeTab === 'forms' && (
                    <button className="btn-primary" onClick={() => { setEditingForm(null); setShowFormModal(true); }}>
                        <Plus size={18} /> New Form
                    </button>
                )}
            </div>

            {/* Main Tabs */}
            <div className="intake-tabs">
                <button
                    className={`intake-tab ${activeTab === 'my-requests' ? 'active' : ''}`}
                    onClick={() => setActiveTab('my-requests')}
                >
                    <FileText size={16} /> My Requests
                </button>

                <button
                    className={`intake-tab ${activeTab === 'forms' ? 'active' : ''}`}
                    onClick={() => setActiveTab('forms')}
                >
                    <Plus size={16} /> New Request
                </button>

                {canViewIncoming && (
                    <>
                        <button
                            className={`intake-tab ${activeTab === 'requests' ? 'active' : ''}`}
                            onClick={() => setActiveTab('requests')}
                        >
                            <Inbox size={16} /> Incoming Requests
                            {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
                        </button>
                    </>
                )}
            </div>

            {activeTab === 'my-requests' && (
                <MySubmissionsList />
            )}

            {activeTab === 'forms' && (
                <>
                    {intakeForms.length === 0 ? (
                        <div className="intake-empty">
                            <FileText size={48} />
                            <p>No intake forms available at this time.</p>
                            {canManageForms && (
                                <button className="btn-primary" onClick={() => { setEditingForm(null); setShowFormModal(true); }}>
                                    <Plus size={18} /> Create Form
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="forms-grid">
                            {intakeForms.map(form => {
                                const submissionCount = intakeSubmissions.filter(s => s.formId === form.id).length;
                                return (
                                    <div key={form.id} className="form-card">
                                        <div className="form-card-header">
                                            <h3>{form.name}</h3>
                                            {canManageForms && (
                                                <div className="form-card-actions">
                                                    <button
                                                        className="icon-btn"
                                                        title="Edit Form"
                                                        onClick={() => { setEditingForm(form); setShowFormModal(true); }}
                                                    >
                                                        <Edit2 size={16} />
                                                    </button>
                                                    <button
                                                        className="icon-btn"
                                                        title="Delete Form"
                                                        onClick={() => handleDeleteForm(form.id)}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        {form.description && <p>{form.description}</p>}

                                        {canManageForms && ( // Or separate view permission? Sticking to manage for now since standard users just click 'Start'
                                            <div className="form-card-meta">
                                                <span>{form.fields.length} fields</span>
                                                <span>•</span>
                                                <span>{submissionCount} submissions</span>
                                                <span>•</span>
                                                <span>Created {formatDate(form.createdAt)}</span>
                                            </div>
                                        )}

                                        <div className="form-card-footer">
                                            {/* Allow anyone to copy link if they can see the form */}
                                            <button
                                                className="btn-secondary"
                                                onClick={() => copyFormLink(form.id)}
                                                style={{ flex: 1 }}
                                            >
                                                {copiedId === form.id ? <Check size={16} /> : <Copy size={16} />}
                                                {copiedId === form.id ? 'Copied!' : 'Copy Link'}
                                            </button>
                                            <button
                                                className="btn-primary"
                                                onClick={() => window.open(`/#/intake/${form.id}`, '_blank')}
                                                style={{ flex: 1 }}
                                            >
                                                Start {form.name}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {activeTab === 'requests' && canViewIncoming && (
                <IntakeRequestsList />
            )}

            {/* Form Builder Modal */}
            <Modal
                isOpen={showFormModal}
                onClose={() => setShowFormModal(false)}
                title={editingForm ? 'Edit Form' : 'Create Intake Form'}
                size="large"
                closeOnOverlayClick={false}
            >
                <IntakeFormBuilder
                    form={editingForm}
                    onClose={() => setShowFormModal(false)}
                />
            </Modal>
        </div>
    );
}

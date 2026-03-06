import { useMemo, useState } from 'react';
import { Plus, Copy, Check, Edit2, Trash2, FileText, Inbox, Scale, CheckCircle, AlertCircle } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { Modal } from '../UI/Modal';
import { IntakeFormBuilder } from './IntakeFormBuilder';
import { IntakeRequestsList } from './IntakeRequestsList';
import { MySubmissionsList } from './MySubmissionsList';
import './Intake.css';

export function IntakePage() {
    const {
        intakeForms,
        deleteIntakeForm,
        intakeSubmissions,
        mySubmissions,
        hasPermission
    } = useData();

    const canViewIntakeForms = hasPermission('can_view_intake') || hasPermission('can_manage_intake');
    const canManageIntake = hasPermission('can_manage_intake');
    const canViewIncoming = hasPermission('can_view_incoming_requests');
    const canManageForms = hasPermission('can_manage_intake_forms');
    const canViewGovernanceQueue = hasPermission('can_view_governance_queue');
    const canVoteGovernance = hasPermission('can_vote_governance');
    const canDecideGovernance = hasPermission('can_decide_governance');

    const [activeView, setActiveView] = useState(null);
    const [showFormModal, setShowFormModal] = useState(false);
    const [editingForm, setEditingForm] = useState(null);
    const [copiedId, setCopiedId] = useState('');

    const pendingCount = intakeSubmissions.filter((s) => s.status === 'pending').length;
    const awaitingCount = intakeSubmissions.filter((s) => s.status === 'awaiting-response').length;
    const openTriageCount = pendingCount + awaitingCount;
    const governancePendingCount = canViewIncoming
        ? intakeSubmissions.filter((s) => {
            if (!s.governanceRequired) return false;
            const state = String(s.governanceStatus || '').toLowerCase();
            return state !== 'decided' && state !== 'skipped';
        }).length
        : null;
    const resolutionReadyCount = canViewIncoming
        ? intakeSubmissions.filter((s) => {
            if (s.status === 'approved' || s.status === 'rejected') return false;
            if (!s.governanceRequired) return true;
            return String(s.governanceStatus || '').toLowerCase() === 'decided';
        }).length
        : null;
    const governanceRequiredCount = canViewIncoming
        ? intakeSubmissions.filter((s) => !!s.governanceRequired).length
        : null;
    const governanceNotStartedCount = canViewIncoming
        ? intakeSubmissions.filter((s) => !!s.governanceRequired && String(s.governanceStatus || '').toLowerCase() === 'not-started').length
        : null;
    const governanceInReviewCount = canViewIncoming
        ? intakeSubmissions.filter((s) => !!s.governanceRequired && String(s.governanceStatus || '').toLowerCase() === 'in-review').length
        : null;
    const governanceDecidedCount = canViewIncoming
        ? intakeSubmissions.filter((s) => !!s.governanceRequired && String(s.governanceStatus || '').toLowerCase() === 'decided').length
        : null;
    const governanceSkippedCount = canViewIncoming
        ? intakeSubmissions.filter((s) => !!s.governanceRequired && String(s.governanceStatus || '').toLowerCase() === 'skipped').length
        : null;
    const readyToResolveCount = canViewIncoming
        ? intakeSubmissions.filter((s) => {
            if (s.status === 'approved' || s.status === 'rejected') return false;
            if (!s.governanceRequired) return true;
            const status = String(s.governanceStatus || '').toLowerCase();
            const decision = String(s.governanceDecision || '').toLowerCase();
            return status === 'decided' && decision === 'approved-now';
        }).length
        : null;
    const blockedByGovernanceCount = canViewIncoming
        ? intakeSubmissions.filter((s) => {
            if (s.status === 'approved' || s.status === 'rejected') return false;
            if (!s.governanceRequired) return false;
            const status = String(s.governanceStatus || '').toLowerCase();
            const decision = String(s.governanceDecision || '').toLowerCase();
            return !(status === 'decided' && decision === 'approved-now');
        }).length
        : null;
    const closedCount = canViewIncoming
        ? intakeSubmissions.filter((s) => s.status === 'approved' || s.status === 'rejected').length
        : null;
    const governancePersona =
        canViewGovernanceQueue &&
        (canVoteGovernance || canDecideGovernance) &&
        !canManageIntake &&
        !canViewIncoming &&
        !canManageForms;

    const canAccessIntakeWorkspace =
        canViewIntakeForms ||
        canViewIncoming ||
        canViewGovernanceQueue ||
        canManageForms ||
        (mySubmissions?.length || 0) > 0;

    const availableViews = useMemo(() => {
        const views = new Set(['my-requests']);
        if (canViewIntakeForms) views.add('submit');
        if (canViewIncoming) {
            views.add('triage');
            views.add('resolution');
        }
        if (canViewGovernanceQueue) views.add('governance');
        if (canManageForms) views.add('form-admin');
        return views;
    }, [canManageForms, canViewGovernanceQueue, canViewIncoming, canViewIntakeForms]);

    const defaultView = useMemo(() => {
        if (governancePersona && availableViews.has('governance')) return 'governance';
        if (availableViews.has('triage')) return 'triage';
        if (availableViews.has('governance')) return 'governance';
        if (availableViews.has('submit')) return 'submit';
        return 'my-requests';
    }, [availableViews, governancePersona]);

    const resolvedActiveView = activeView && availableViews.has(activeView) ? activeView : defaultView;

    const workflowViews = useMemo(() => {
        return [
            {
                id: 'submit',
                step: '1',
                label: 'Submission',
                icon: FileText,
                description: 'Start request intake from published forms.',
                ready: canViewIntakeForms && intakeForms.length > 0,
                complete: (mySubmissions?.length || 0) > 0,
                counter: `${intakeForms.length} form${intakeForms.length === 1 ? '' : 's'}`,
                blocker: !canViewIntakeForms
                    ? 'You do not have intake form access.'
                    : intakeForms.length === 0
                        ? 'No intake forms are currently published.'
                        : ''
            },
            {
                id: 'triage',
                step: '2',
                label: 'Triage',
                icon: Inbox,
                description: 'Review incoming submissions and requester follow-up.',
                ready: canViewIncoming,
                complete: canViewIncoming && openTriageCount === 0,
                counter: canViewIncoming ? `${openTriageCount} open` : 'Restricted',
                blocker: canViewIncoming ? '' : 'Requires incoming request permission.'
            },
            {
                id: 'governance',
                step: '3',
                label: 'Governance',
                icon: Scale,
                description: 'Route and score submissions requiring governance.',
                ready: canViewGovernanceQueue,
                complete: canViewGovernanceQueue && governancePendingCount === 0,
                counter: governancePendingCount === null
                    ? (canViewGovernanceQueue ? 'Queue available' : 'Restricted')
                    : `${governancePendingCount} in review`,
                blocker: canViewGovernanceQueue ? '' : 'Requires governance queue permission.'
            },
            {
                id: 'resolution',
                step: '4',
                label: 'Resolution',
                icon: CheckCircle,
                description: 'Finalize outcomes and convert approved requests.',
                ready: canViewIncoming,
                complete: canViewIncoming && resolutionReadyCount === 0,
                counter: resolutionReadyCount === null ? 'Restricted' : `${resolutionReadyCount} ready`,
                blocker: canViewIncoming ? '' : 'Requires incoming request permission.'
            }
        ];
    }, [
        canViewIntakeForms,
        intakeForms.length,
        mySubmissions?.length,
        canViewIncoming,
        openTriageCount,
        canViewGovernanceQueue,
        governancePendingCount,
        resolutionReadyCount
    ]);

    const triageKpis = useMemo(() => ([
        { label: 'Pending Review', value: pendingCount },
        { label: 'Awaiting Response', value: awaitingCount },
        { label: 'Open Triage', value: openTriageCount }
    ]), [awaitingCount, openTriageCount, pendingCount]);

    const governanceKpis = useMemo(() => {
        if (!canViewIncoming) {
            return [
                { label: 'Queue Totals', value: '-' },
                { label: 'In Review', value: '-' },
                { label: 'Decided', value: '-' }
            ];
        }
        return [
            { label: 'Governance Required', value: governanceRequiredCount ?? 0 },
            { label: 'Not Started', value: governanceNotStartedCount ?? 0 },
            { label: 'In Review', value: governanceInReviewCount ?? 0 },
            { label: 'Decided', value: governanceDecidedCount ?? 0 },
            { label: 'Skipped', value: governanceSkippedCount ?? 0 }
        ];
    }, [
        canViewIncoming,
        governanceDecidedCount,
        governanceInReviewCount,
        governanceNotStartedCount,
        governanceRequiredCount,
        governanceSkippedCount
    ]);

    const resolutionKpis = useMemo(() => {
        if (!canViewIncoming) {
            return [
                { label: 'Ready to Resolve', value: '-' },
                { label: 'Blocked by Governance', value: '-' },
                { label: 'Closed', value: '-' }
            ];
        }
        return [
            { label: 'Ready to Resolve', value: readyToResolveCount ?? 0 },
            { label: 'Blocked by Governance', value: blockedByGovernanceCount ?? 0 },
            { label: 'Closed', value: closedCount ?? 0 }
        ];
    }, [blockedByGovernanceCount, canViewIncoming, closedCount, readyToResolveCount]);

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

    const getWorkflowState = (view) => {
        if (!view.ready) return 'not-ready';
        if (view.complete) return 'complete';
        return 'ready';
    };

    const renderFormsGrid = ({ manageMode = false }) => {
        if (intakeForms.length === 0) {
            return (
                <div className="intake-empty">
                    <FileText size={48} />
                    <p>No intake forms available at this time.</p>
                    {manageMode && canManageForms && (
                        <button className="btn-primary" onClick={() => { setEditingForm(null); setShowFormModal(true); }}>
                            <Plus size={18} /> Create Form
                        </button>
                    )}
                </div>
            );
        }

        return (
            <div className="forms-grid">
                {intakeForms.map((form) => {
                    const submissionCount = intakeSubmissions.filter((s) => s.formId === form.id).length;
                    const governancePolicy = form.governanceMode
                        ? `Governance: ${form.governanceMode}`
                        : 'Governance: off';
                    return (
                        <div key={form.id} className="form-card">
                            <div className="form-card-header">
                                <h3>{form.name}</h3>
                                {manageMode && canManageForms && (
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

                            <div className="form-card-meta">
                                <span>{form.fields.length} fields</span>
                                <span>|</span>
                                <span>{submissionCount} submissions</span>
                                {manageMode && (
                                    <>
                                        <span>|</span>
                                        <span>{governancePolicy}</span>
                                        <span>|</span>
                                        <span>Created {formatDate(form.createdAt)}</span>
                                    </>
                                )}
                            </div>

                            <div className="form-card-footer">
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
        );
    };

    const renderKpiStrip = (cards) => (
        <div className="intake-stage-kpis">
            {cards.map((card) => (
                <article key={card.label} className="intake-kpi-card">
                    <span className="intake-kpi-label">{card.label}</span>
                    <strong className="intake-kpi-value">{card.value}</strong>
                </article>
            ))}
        </div>
    );

    return (
        <div className="intake-page">
            {!canAccessIntakeWorkspace ? (
                <div className="intake-empty">
                    <AlertCircle size={48} />
                    <p>You do not currently have access to any intake workspaces.</p>
                </div>
            ) : (
                <>
                    <div className="intake-workflow-nav">
                        {workflowViews.map((view) => {
                            const Icon = view.icon;
                            const state = getWorkflowState(view);
                            return (
                                <button
                                    key={view.id}
                                    className={`workflow-step-card ${resolvedActiveView === view.id ? 'active' : ''} ${state}`}
                                    onClick={() => setActiveView(view.id)}
                                    disabled={!view.ready}
                                >
                                    <div className="workflow-step-card-head">
                                        <span className="workflow-step-label">
                                            <span className="workflow-step-index">{view.step}</span>
                                            {view.label}
                                        </span>
                                        <span className={`workflow-step-badge ${state}`}>
                                            {state === 'not-ready' ? 'Not Ready' : state === 'complete' ? 'Complete' : 'Ready'}
                                        </span>
                                    </div>
                                    <div className="workflow-step-card-body">
                                        <Icon size={16} />
                                        <p>{view.description}</p>
                                    </div>
                                    <div className="workflow-step-meta">
                                        <span>{view.counter}</span>
                                        {view.blocker && <span className="workflow-step-blocker">{view.blocker}</span>}
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    <div className="intake-utility-nav">
                        <button
                            className={`intake-utility-btn ${resolvedActiveView === 'my-requests' ? 'active' : ''}`}
                            onClick={() => setActiveView('my-requests')}
                        >
                            <FileText size={15} /> My Requests
                        </button>
                        {canManageForms && (
                            <button
                                className={`intake-utility-btn ${resolvedActiveView === 'form-admin' ? 'active' : ''}`}
                                onClick={() => setActiveView('form-admin')}
                            >
                                <Plus size={15} /> Form Admin
                            </button>
                        )}
                    </div>

                    {canManageForms && resolvedActiveView === 'form-admin' && (
                        <div className="intake-header intake-header-actions">
                            <button className="btn-primary" onClick={() => { setEditingForm(null); setShowFormModal(true); }}>
                                <Plus size={18} /> New Form
                            </button>
                        </div>
                    )}

                    {resolvedActiveView === 'submit' && renderFormsGrid({ manageMode: false })}

                    {resolvedActiveView === 'my-requests' && (
                        <MySubmissionsList />
                    )}

                    {resolvedActiveView === 'triage' && canViewIncoming && (
                        <>
                            {renderKpiStrip(triageKpis)}
                            <IntakeRequestsList initialFilter="all" showFilterTabs={false} />
                        </>
                    )}

                    {resolvedActiveView === 'governance' && canViewGovernanceQueue && (
                        <>
                            {renderKpiStrip(governanceKpis)}
                            {!canViewIncoming && (
                                <div className="intake-kpi-note">
                                    Detailed governance totals are visible in the queue summary and filters below.
                                </div>
                            )}
                            <IntakeRequestsList initialFilter="governance" showFilterTabs={false} />
                        </>
                    )}

                    {resolvedActiveView === 'resolution' && canViewIncoming && (
                        <>
                            {renderKpiStrip(resolutionKpis)}
                            <IntakeRequestsList initialFilter="all" showFilterTabs={false} />
                        </>
                    )}

                    {resolvedActiveView === 'form-admin' && canManageForms && renderFormsGrid({ manageMode: true })}

                    {resolvedActiveView === 'triage' && !canViewIncoming && (
                        <div className="intake-empty">
                            <AlertCircle size={40} />
                            <p>Incoming request access is required for triage.</p>
                        </div>
                    )}

                    {resolvedActiveView === 'governance' && !canViewGovernanceQueue && (
                        <div className="intake-empty">
                            <AlertCircle size={40} />
                            <p>Governance queue access is required for this stage.</p>
                        </div>
                    )}

                    {resolvedActiveView === 'resolution' && !canViewIncoming && (
                        <div className="intake-empty">
                            <AlertCircle size={40} />
                            <p>Incoming request access is required for resolution.</p>
                        </div>
                    )}
                </>
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

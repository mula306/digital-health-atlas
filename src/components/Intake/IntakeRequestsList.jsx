import { useState, useEffect, useRef, useCallback } from 'react';
import { Eye, Copy, Check, MessageSquare, CheckCircle, XCircle, ArrowRight, Clock, Send, Scale, RefreshCw, Vote } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { Modal } from '../UI/Modal';
import './Intake.css';

const STATUS_LABELS = {
    'pending': 'Pending Review',
    'awaiting-response': 'Awaiting Response',
    'approved': 'Approved',
    'rejected': 'Rejected'
};

const GOVERNANCE_STATUS_LABELS = {
    'not-started': 'Not Started',
    'in-review': 'In Review',
    'decided': 'Decided',
    'skipped': 'Skipped'
};

const GOVERNANCE_DECISION_LABELS = {
    'approved-now': 'Approved Now',
    'approved-backlog': 'Approved Backlog',
    'needs-info': 'Needs Info',
    'rejected': 'Rejected'
};

export function IntakeRequestsList({ initialFilter = 'all' }) {
    const {
        intakeSubmissions,
        intakeForms,
        goals,
        currentUser,
        hasPermission,
        addConversationMessage,
        markConversationRead,
        migrateInfoRequestsToConversation,
        updateIntakeSubmission,
        convertSubmissionToProject,
        fetchIntakeGovernanceQueue,
        getSubmissionGovernance,
        startSubmissionGovernance,
        submitSubmissionGovernanceVote,
        decideSubmissionGovernance,
        applySubmissionGovernance,
        skipSubmissionGovernance
    } = useData();
    const toast = useToast();

    const [filter, setFilter] = useState(initialFilter);
    const [selectedSubmission, setSelectedSubmission] = useState(null);
    const [showConvertModal, setShowConvertModal] = useState(false);
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [newMessage, setNewMessage] = useState('');
    const [convertGoalId, setConvertGoalId] = useState('');
    const [copiedLink, setCopiedLink] = useState('');
    const [governanceQueue, setGovernanceQueue] = useState([]);
    const [loadingGovernanceQueue, setLoadingGovernanceQueue] = useState(false);
    const [governanceDetails, setGovernanceDetails] = useState(null);
    const [loadingGovernanceDetails, setLoadingGovernanceDetails] = useState(false);
    const [governanceActionLoading, setGovernanceActionLoading] = useState(false);
    const [governanceError, setGovernanceError] = useState('');
    const [voteScores, setVoteScores] = useState({});
    const [voteComment, setVoteComment] = useState('');
    const [voteConflictDeclared, setVoteConflictDeclared] = useState(false);
    const [decision, setDecision] = useState('approved-now');
    const [decisionReason, setDecisionReason] = useState('');
    const conversationEndRef = useRef(null);

    const canViewIncomingRequests = hasPermission('can_view_incoming_requests');
    const canViewGovernanceQueue = hasPermission('can_view_governance_queue');
    const canVoteGovernance = hasPermission('can_vote_governance');
    const canDecideGovernance = hasPermission('can_decide_governance');
    const canManageGovernance = hasPermission('can_manage_governance');
    const userRoles = Array.isArray(currentUser?.roles) ? currentUser.roles : [];
    const isIntakeManagerRole = userRoles.includes('Admin') || userRoles.includes('IntakeManager');
    const canRouteGovernance = canManageGovernance || isIntakeManagerRole;

    // Auto-scroll to bottom of conversation
    useEffect(() => {
        if (conversationEndRef.current) {
            conversationEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [selectedSubmission?.conversation]);

    useEffect(() => {
        setFilter(initialFilter);
    }, [initialFilter]);

    // Mark messages as read when viewing
    useEffect(() => {
        if (selectedSubmission && canViewIncomingRequests) {
            const hasUnread = selectedSubmission.conversation?.some(msg => !msg.read && msg.type === 'requester');
            if (hasUnread) {
                markConversationRead(selectedSubmission.id);
            }
        }
    }, [selectedSubmission, markConversationRead, canViewIncomingRequests]);

    // Get submission with migrated conversation
    const getSubmissionWithConversation = (submission) => {
        return migrateInfoRequestsToConversation(submission);
    };

    const loadGovernanceQueue = useCallback(async () => {
        if (!canViewGovernanceQueue) return;
        try {
            setLoadingGovernanceQueue(true);
            const result = await fetchIntakeGovernanceQueue({ page: 1, limit: 200 });
            setGovernanceQueue(result.items || []);
        } catch (err) {
            console.error('Failed to load governance queue:', err);
            toast.error(err.message || 'Failed to load governance queue');
        } finally {
            setLoadingGovernanceQueue(false);
        }
    }, [canViewGovernanceQueue, fetchIntakeGovernanceQueue, toast]);

    useEffect(() => {
        if (filter === 'governance') {
            loadGovernanceQueue();
        }
    }, [filter, loadGovernanceQueue]);

    const loadGovernanceDetails = useCallback(async (submissionId) => {
        if (!canViewGovernanceQueue) return;
        try {
            setLoadingGovernanceDetails(true);
            setGovernanceError('');
            const details = await getSubmissionGovernance(submissionId);
            setGovernanceDetails(details);

            setSelectedSubmission(prev => {
                if (!prev || String(prev.id) !== String(submissionId)) return prev;
                return {
                    ...prev,
                    ...(details?.submission || {}),
                    conversation: prev.conversation || []
                };
            });

            const myVote = details?.review?.votes?.find(v => v.voterUserOid === currentUser?.oid);
            const initialScores = {};
            (details?.review?.criteria || []).forEach(c => {
                initialScores[c.id] = myVote?.scores?.[c.id] ?? 3;
            });
            setVoteScores(initialScores);
            setVoteComment(myVote?.comment || '');
            setVoteConflictDeclared(!!myVote?.conflictDeclared);
        } catch (err) {
            console.error('Failed to load governance details:', err);
            setGovernanceError(err.message || 'Failed to load governance details');
        } finally {
            setLoadingGovernanceDetails(false);
        }
    }, [canViewGovernanceQueue, getSubmissionGovernance, currentUser?.oid]);

    const filteredSubmissions = filter === 'governance'
        ? governanceQueue
        : intakeSubmissions.filter(s => {
            if (filter === 'all') return true;
            return s.status === filter;
        });

    const getForm = (formId) => intakeForms.find(f => f.id === formId);

    const getFieldValue = (submission, fieldId) => {
        return submission.formData?.[fieldId] || '-';
    };

    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatMessageTime = (dateStr) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const handleSendMessage = async () => {
        if (!canViewIncomingRequests) return;
        if (!newMessage.trim() || !selectedSubmission) return;

        try {
            await addConversationMessage(selectedSubmission.id, newMessage, 'admin');

            // Create the new message object locally for optimistic update
            const newMsg = {
                id: `msg-${Date.now()}`,
                type: 'admin',
                message: newMessage,
                timestamp: new Date().toISOString(),
                read: true
            };

            // Immediately update local state for responsive UI
            const updatedConversation = [...(selectedSubmission.conversation || []), newMsg];
            setSelectedSubmission({
                ...selectedSubmission,
                status: 'awaiting-response',
                conversation: updatedConversation
            });

            // Clear input
            setNewMessage('');
            toast.success('Message sent to requester');
        } catch (err) {
            console.error(err);
            toast.error('Failed to send message');
        }
    };

    const openSubmission = async (submission) => {
        const fullSubmission = intakeSubmissions.find(s => String(s.id) === String(submission.id));
        const selected = getSubmissionWithConversation(fullSubmission || submission);
        setSelectedSubmission(selected);
        setGovernanceDetails(null);
        setGovernanceError('');
        setVoteScores({});
        setVoteComment('');
        setVoteConflictDeclared(false);
        setDecision('approved-now');
        setDecisionReason('');

        if (selected.governanceRequired || filter === 'governance') {
            await loadGovernanceDetails(selected.id);
        }
    };

    const handleApplyGovernance = async () => {
        if (!selectedSubmission) return;
        const reason = window.prompt('Reason for applying governance (optional):', 'Marked for governance review by intake manager.') || '';
        try {
            setGovernanceActionLoading(true);
            await applySubmissionGovernance(selectedSubmission.id, reason);
            setSelectedSubmission(prev => prev ? {
                ...prev,
                governanceRequired: true,
                governanceStatus: 'not-started',
                governanceDecision: null,
                governanceReason: reason || 'Marked for governance review by intake manager.'
            } : prev);
            if (filter === 'governance') await loadGovernanceQueue();
            toast.success('Submission marked for governance');
        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Failed to apply governance');
        } finally {
            setGovernanceActionLoading(false);
        }
    };

    const handleSkipGovernance = async () => {
        if (!selectedSubmission) return;
        const reason = window.prompt('Reason for skipping governance (optional):', 'Governance skipped by intake manager.') || '';
        try {
            setGovernanceActionLoading(true);
            await skipSubmissionGovernance(selectedSubmission.id, reason);
            setSelectedSubmission(prev => prev ? {
                ...prev,
                governanceRequired: false,
                governanceStatus: 'skipped',
                governanceReason: reason || 'Governance skipped by intake manager.'
            } : prev);
            setGovernanceDetails(null);
            if (filter === 'governance') await loadGovernanceQueue();
            toast.success('Governance skipped for submission');
        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Failed to skip governance');
        } finally {
            setGovernanceActionLoading(false);
        }
    };

    const handleStartGovernance = async () => {
        if (!selectedSubmission) return;
        try {
            setGovernanceActionLoading(true);
            await startSubmissionGovernance(selectedSubmission.id);
            setSelectedSubmission(prev => prev ? {
                ...prev,
                governanceRequired: true,
                governanceStatus: 'in-review',
                governanceDecision: null
            } : prev);
            await loadGovernanceDetails(selectedSubmission.id);
            if (filter === 'governance') await loadGovernanceQueue();
            toast.success('Governance review started');
        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Failed to start governance review');
        } finally {
            setGovernanceActionLoading(false);
        }
    };

    const handleSubmitVote = async () => {
        if (!selectedSubmission || !governanceDetails?.review?.criteria?.length) return;
        try {
            setGovernanceActionLoading(true);
            const scores = {};
            governanceDetails.review.criteria.forEach(c => {
                scores[c.id] = Number(voteScores[c.id] ?? 3);
            });

            await submitSubmissionGovernanceVote(selectedSubmission.id, {
                scores,
                comment: voteComment,
                conflictDeclared: voteConflictDeclared
            });

            await loadGovernanceDetails(selectedSubmission.id);
            if (filter === 'governance') await loadGovernanceQueue();
            toast.success('Governance vote submitted');
        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Failed to submit vote');
        } finally {
            setGovernanceActionLoading(false);
        }
    };

    const handleDecide = async () => {
        if (!selectedSubmission) return;
        try {
            setGovernanceActionLoading(true);
            await decideSubmissionGovernance(selectedSubmission.id, {
                decision,
                decisionReason
            });
            setSelectedSubmission(prev => prev ? {
                ...prev,
                governanceStatus: 'decided',
                governanceDecision: decision,
                governanceReason: decisionReason || prev.governanceReason
            } : prev);
            await loadGovernanceDetails(selectedSubmission.id);
            if (filter === 'governance') await loadGovernanceQueue();
            toast.success('Governance decision recorded');
        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Failed to record governance decision');
        } finally {
            setGovernanceActionLoading(false);
        }
    };


    const handleConvert = async () => {
        if (!canViewIncomingRequests) return;
        if (!governanceAllowsConversion) {
            toast.error('Conversion requires governance decision: Approved Now.');
            return;
        }
        const form = getForm(selectedSubmission.formId);
        if (!form) {
            toast.error('Form definition not found');
            return;
        }
        const nameField = form.fields.find(f => f.type === 'text');
        const descField = form.fields.find(f => f.type === 'textarea');

        const projectData = {
            title: selectedSubmission.formData?.[nameField?.id] || 'New Project',
            description: selectedSubmission.formData?.[descField?.id] || '',
            goalId: convertGoalId || null,
            status: 'active'
        };

        try {
            await convertSubmissionToProject(selectedSubmission.id, projectData);
            setShowConvertModal(false);
            setSelectedSubmission(null);
            toast.success('Request converted to project!');
        } catch (err) {
            console.error('Failed to convert submission to project:', err);
            toast.error(err.message || 'Failed to create project. Please try again.');
        }
    };

    const handleReject = () => {
        if (!canViewIncomingRequests) return;
        setShowRejectModal(true);
    };

    const confirmReject = () => {
        updateIntakeSubmission(selectedSubmission.id, { status: 'rejected' });
        setShowRejectModal(false);
        setSelectedSubmission(null);
        toast.success('Request rejected');
    };

    const copyConversationLink = (submission) => {
        if (!submission?.formId) return;
        const baseUrl = window.location.origin;
        const link = `${baseUrl}/#/intake/${submission.formId}?sub=${submission.id}`;
        navigator.clipboard.writeText(link);
        setCopiedLink(submission.id);
        setTimeout(() => setCopiedLink(''), 2000);
    };

    const pendingCount = intakeSubmissions.filter(s => s.status === 'pending').length;
    const awaitingCount = intakeSubmissions.filter(s => s.status === 'awaiting-response').length;
    const governanceCount = filter === 'governance'
        ? governanceQueue.length
        : intakeSubmissions.filter(s => s.governanceRequired).length;

    // Count unread messages across all submissions
    const getUnreadCount = (submission) => {
        const sub = getSubmissionWithConversation(submission);
        return sub.conversation?.filter(msg => !msg.read && msg.type === 'requester').length || 0;
    };

    const selectedForm = selectedSubmission ? getForm(selectedSubmission.formId) : null;
    const governanceReview = governanceDetails?.review || null;
    const governanceSummary = governanceReview?.scoreSummary || null;
    const isCurrentUserGovernanceChair = !!governanceReview?.participants?.some(participant =>
        participant.userOid === currentUser?.oid &&
        participant.participantRole === 'chair' &&
        participant.isEligibleVoter
    );
    const canRecordGovernanceDecision = canDecideGovernance && isCurrentUserGovernanceChair;
    const governanceAllowsConversion = !selectedSubmission?.governanceRequired || (
        String(selectedSubmission?.governanceStatus || '').toLowerCase() === 'decided' &&
        String(selectedSubmission?.governanceDecision || '').toLowerCase() === 'approved-now'
    );

    return (
        <div className="intake-requests">
            {/* Tabs */}
            <div className="intake-tabs">
                <button
                    className={`intake-tab ${filter === 'all' ? 'active' : ''}`}
                    onClick={() => setFilter('all')}
                >
                    All Requests
                </button>
                <button
                    className={`intake-tab ${filter === 'pending' ? 'active' : ''}`}
                    onClick={() => setFilter('pending')}
                >
                    Pending
                    {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
                </button>
                <button
                    className={`intake-tab ${filter === 'awaiting-response' ? 'active' : ''}`}
                    onClick={() => setFilter('awaiting-response')}
                >
                    Awaiting Response
                    {awaitingCount > 0 && <span className="badge">{awaitingCount}</span>}
                </button>
                <button
                    className={`intake-tab ${filter === 'approved' ? 'active' : ''}`}
                    onClick={() => setFilter('approved')}
                >
                    Approved
                </button>
                <button
                    className={`intake-tab ${filter === 'rejected' ? 'active' : ''}`}
                    onClick={() => setFilter('rejected')}
                >
                    Rejected
                </button>
                {canViewGovernanceQueue && (
                    <button
                        className={`intake-tab ${filter === 'governance' ? 'active' : ''}`}
                        onClick={() => setFilter('governance')}
                    >
                        <Scale size={14} style={{ marginRight: '0.35rem' }} />
                        Governance
                        {governanceCount > 0 && <span className="badge">{governanceCount}</span>}
                    </button>
                )}
            </div>

            {filter === 'governance' && canViewGovernanceQueue && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
                    <button className="btn-secondary" onClick={loadGovernanceQueue} disabled={loadingGovernanceQueue}>
                        <RefreshCw size={14} /> {loadingGovernanceQueue ? 'Refreshing...' : 'Refresh Queue'}
                    </button>
                </div>
            )}

            {/* Table */}
            {filteredSubmissions.length === 0 ? (
                <div className="intake-empty">
                    <Clock size={48} />
                    <p>{loadingGovernanceQueue ? 'Loading governance queue...' : 'No requests found'}</p>
                </div>
            ) : (
                <table className="requests-table">
                    <thead>
                        <tr>
                            <th>Form</th>
                            <th>Submitted</th>
                            <th>Status</th>
                            {canViewGovernanceQueue && <th>Governance</th>}
                            <th>Preview</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredSubmissions.map(submission => {
                            const form = getForm(submission.formId);
                            const firstField = form?.fields?.[0];
                            const unreadCount = getUnreadCount(submission);
                            const governanceState = submission.governanceRequired
                                ? (GOVERNANCE_STATUS_LABELS[submission.governanceStatus] || submission.governanceStatus || 'Required')
                                : 'Not Required';
                            return (
                                <tr key={submission.id}>
                                    <td>
                                        {form?.name || submission.formName || 'Unknown Form'}
                                        {unreadCount > 0 && (
                                            <span className="unread-badge" style={{ marginLeft: '0.5rem' }}>
                                                {unreadCount} new
                                            </span>
                                        )}
                                    </td>
                                    <td>{formatDate(submission.submittedAt)}</td>
                                    <td>
                                        <span className={`status-badge ${submission.status}`}>
                                            {STATUS_LABELS[submission.status] || submission.status}
                                        </span>
                                    </td>
                                    {canViewGovernanceQueue && (
                                        <td>
                                            {submission.governanceRequired ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                                    <span className={`status-badge governance-${submission.governanceStatus || 'not-started'}`}>
                                                        {governanceState}
                                                    </span>
                                                    {submission.priorityScore !== null && submission.priorityScore !== undefined && (
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                                                            Score: {submission.priorityScore}
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>Not Required</span>
                                            )}
                                        </td>
                                    )}
                                    <td>
                                        {firstField ? getFieldValue(submission, firstField.id) : '-'}
                                    </td>
                                    <td>
                                        <div className="request-actions">
                                            <button
                                                className="btn-secondary"
                                                onClick={() => openSubmission(submission)}
                                            >
                                                <Eye size={14} /> View
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}

            {/* Detail Modal */}
            <Modal
                isOpen={!!selectedSubmission}
                onClose={() => setSelectedSubmission(null)}
                title="Request Details"
                size="large"
                closeOnOverlayClick={false}
            >
                {selectedSubmission && (
                    <div className="submission-detail">
                        <div className="submission-meta">
                            <span className={`status-badge ${selectedSubmission.status}`}>
                                {STATUS_LABELS[selectedSubmission.status] || selectedSubmission.status}
                            </span>
                            <span style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
                                Submitted {formatDate(selectedSubmission.submittedAt)}
                            </span>
                        </div>

                        {(selectedSubmission.governanceRequired || selectedSubmission.governanceStatus || (selectedSubmission.priorityScore !== null && selectedSubmission.priorityScore !== undefined)) && (
                            <div className="submission-meta" style={{ marginTop: '0.5rem', gap: '0.5rem' }}>
                                <span className={`status-badge governance-${selectedSubmission.governanceStatus || 'not-started'}`}>
                                    Governance: {selectedSubmission.governanceRequired
                                        ? (GOVERNANCE_STATUS_LABELS[selectedSubmission.governanceStatus] || selectedSubmission.governanceStatus || 'Required')
                                        : 'Not Required'}
                                </span>
                                {selectedSubmission.governanceDecision && (
                                    <span className="status-badge approved">
                                        Decision: {GOVERNANCE_DECISION_LABELS[selectedSubmission.governanceDecision] || selectedSubmission.governanceDecision}
                                    </span>
                                )}
                                {selectedSubmission.priorityScore !== null && selectedSubmission.priorityScore !== undefined && (
                                    <span style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
                                        Priority Score: {selectedSubmission.priorityScore}
                                    </span>
                                )}
                            </div>
                        )}

                        <div className="submission-fields" style={{ marginTop: '1.5rem' }}>
                            {selectedForm?.fields?.length ? (
                                selectedForm.fields.map(field => (
                                    <div key={field.id} className="form-group" style={{ marginBottom: '1rem' }}>
                                        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)' }}>
                                            {field.label}
                                        </label>
                                        <div style={{ marginTop: '0.25rem', color: 'var(--text-primary)' }}>
                                            {getFieldValue(selectedSubmission, field.id)}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
                                    Form field details are not available for this item.
                                </div>
                            )}
                        </div>

                        {(canViewGovernanceQueue || canRouteGovernance) && (
                            <div className="conversation-section" style={{ marginTop: '1.25rem' }}>
                                <div className="conversation-header">
                                    <h4>
                                        <Scale size={16} />
                                        Governance
                                    </h4>
                                    {selectedSubmission.governanceRequired && canViewGovernanceQueue && (
                                        <button
                                            className="btn-secondary"
                                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                                            onClick={() => loadGovernanceDetails(selectedSubmission.id)}
                                            disabled={loadingGovernanceDetails || governanceActionLoading}
                                        >
                                            <RefreshCw size={12} />
                                            Refresh
                                        </button>
                                    )}
                                </div>

                                <div style={{ display: 'grid', gap: '0.4rem', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                                    <div>
                                        <strong>Board:</strong> {selectedSubmission.governanceBoardName || governanceDetails?.submission?.governanceBoardName || 'Unassigned'}
                                    </div>
                                    <div>
                                        <strong>Status:</strong> {GOVERNANCE_STATUS_LABELS[selectedSubmission.governanceStatus] || selectedSubmission.governanceStatus || 'not-started'}
                                    </div>
                                    <div>
                                        <strong>Decision:</strong> {selectedSubmission.governanceDecision ? (GOVERNANCE_DECISION_LABELS[selectedSubmission.governanceDecision] || selectedSubmission.governanceDecision) : 'Pending'}
                                    </div>
                                    <div>
                                        <strong>Reason:</strong> {selectedSubmission.governanceReason || 'n/a'}
                                    </div>
                                </div>

                                {governanceError && (
                                    <div style={{ fontSize: '0.8rem', color: '#b91c1c', marginBottom: '0.75rem' }}>
                                        {governanceError}
                                    </div>
                                )}
                                {loadingGovernanceDetails && (
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: '0.75rem' }}>
                                        Loading governance details...
                                    </div>
                                )}

                                {canRouteGovernance && (
                                    <div className="form-actions" style={{ marginTop: '0.75rem', marginBottom: '0.75rem' }}>
                                        {!selectedSubmission.governanceRequired && (
                                            <button className="btn-secondary" onClick={handleApplyGovernance} disabled={governanceActionLoading}>
                                                <Scale size={16} /> Apply Governance
                                            </button>
                                        )}
                                        {selectedSubmission.governanceRequired && selectedSubmission.governanceStatus === 'not-started' && (
                                            <button className="btn-primary" onClick={handleStartGovernance} disabled={governanceActionLoading}>
                                                <Vote size={16} /> Start Review
                                            </button>
                                        )}
                                        {selectedSubmission.governanceRequired && selectedSubmission.governanceStatus !== 'decided' && (
                                            <button className="btn-secondary" onClick={handleSkipGovernance} disabled={governanceActionLoading}>
                                                Skip Governance
                                            </button>
                                        )}
                                    </div>
                                )}

                                {selectedSubmission.governanceRequired && governanceReview && (
                                    <div style={{ marginTop: '0.75rem' }}>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: '0.75rem' }}>
                                            Participation: {governanceSummary?.voteCount ?? 0} / {governanceSummary?.eligibleVoterCount ?? 0} voters ({governanceSummary?.participationPct ?? 0}%)
                                            {governanceSummary?.requiredVotes !== undefined && (
                                                <span style={{ marginLeft: '0.75rem' }}>
                                                    Quorum: {governanceSummary.voteCount ?? 0}/{governanceSummary.requiredVotes}
                                                    {governanceSummary.quorumMet ? ' (met)' : ' (pending)'}
                                                </span>
                                            )}
                                            {governanceSummary?.priorityScore !== null && governanceSummary?.priorityScore !== undefined && (
                                                <span style={{ marginLeft: '0.75rem' }}>
                                                    Current Score: {governanceSummary.priorityScore}
                                                </span>
                                            )}
                                        </div>
                                        {governanceReview.voteDeadlineAt && (
                                            <div style={{ fontSize: '0.78rem', marginBottom: '0.75rem', color: governanceReview.deadlinePassed ? '#b91c1c' : 'var(--text-tertiary)' }}>
                                                Voting deadline: {formatDate(governanceReview.voteDeadlineAt)}
                                                {governanceReview.deadlinePassed ? ' (closed)' : ''}
                                            </div>
                                        )}

                                        {canVoteGovernance && governanceReview.status === 'in-review' && (
                                            <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem', marginBottom: '0.75rem' }}>
                                                <h5 style={{ margin: '0 0 0.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                    <Vote size={15} /> Submit Vote
                                                </h5>
                                                {(governanceReview.criteria || []).filter(c => c.enabled).map(criterion => (
                                                    <div key={criterion.id} className="form-group" style={{ marginBottom: '0.75rem' }}>
                                                        <label style={{ fontSize: '0.8rem' }}>
                                                            {criterion.name} ({criterion.weight}%)
                                                        </label>
                                                        <select
                                                            value={voteScores[criterion.id] ?? 3}
                                                            onChange={(e) => setVoteScores(prev => ({ ...prev, [criterion.id]: Number(e.target.value) }))}
                                                        >
                                                            <option value={1}>1 - Low</option>
                                                            <option value={2}>2</option>
                                                            <option value={3}>3 - Medium</option>
                                                            <option value={4}>4</option>
                                                            <option value={5}>5 - High</option>
                                                        </select>
                                                    </div>
                                                ))}
                                                <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                                                    <label style={{ fontSize: '0.8rem' }}>Comment (optional)</label>
                                                    <textarea
                                                        value={voteComment}
                                                        onChange={(e) => setVoteComment(e.target.value)}
                                                        placeholder="Add rationale for your score..."
                                                    />
                                                </div>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={voteConflictDeclared}
                                                        onChange={(e) => setVoteConflictDeclared(e.target.checked)}
                                                    />
                                                    I have a conflict of interest related to this vote
                                                </label>
                                                <div className="form-actions" style={{ marginTop: '0.75rem' }}>
                                                    <button className="btn-primary" onClick={handleSubmitVote} disabled={governanceActionLoading}>
                                                        Submit Vote
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {governanceReview.votes?.length > 0 && (
                                            <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem', marginBottom: '0.75rem' }}>
                                                <h5 style={{ margin: '0 0 0.5rem' }}>Vote History</h5>
                                                <div style={{ display: 'grid', gap: '0.5rem' }}>
                                                    {governanceReview.votes.map(vote => (
                                                        <div key={vote.id} style={{ border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.5rem' }}>
                                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                                                                {(vote.voterName || vote.voterEmail || vote.voterUserOid)} - {formatMessageTime(vote.submittedAt)}
                                                            </div>
                                                            {vote.comment && (
                                                                <div style={{ marginTop: '0.25rem', fontSize: '0.875rem' }}>{vote.comment}</div>
                                                            )}
                                                            {vote.conflictDeclared && (
                                                                <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#b45309' }}>
                                                                    Conflict declared
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {canRecordGovernanceDecision && governanceReview.status === 'in-review' && (
                                            <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem' }}>
                                                <h5 style={{ margin: '0 0 0.5rem' }}>Record Decision</h5>
                                                <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                                                    <label style={{ fontSize: '0.8rem' }}>Decision</label>
                                                    <select value={decision} onChange={(e) => setDecision(e.target.value)}>
                                                        <option value="approved-now">Approved Now</option>
                                                        <option value="approved-backlog">Approved Backlog</option>
                                                        <option value="needs-info">Needs Info</option>
                                                        <option value="rejected">Rejected</option>
                                                    </select>
                                                </div>
                                                <div className="form-group">
                                                    <label style={{ fontSize: '0.8rem' }}>Decision Rationale</label>
                                                    <textarea
                                                        value={decisionReason}
                                                        onChange={(e) => setDecisionReason(e.target.value)}
                                                        placeholder="Document rationale for the governance decision..."
                                                    />
                                                </div>
                                                <div className="form-actions" style={{ marginTop: '0.75rem' }}>
                                                    <button
                                                        className="btn-primary"
                                                        onClick={handleDecide}
                                                        disabled={governanceActionLoading || (governanceReview.policy?.decisionRequiresQuorum && governanceSummary?.quorumMet === false)}
                                                    >
                                                        Save Decision
                                                    </button>
                                                </div>
                                                {governanceReview.policy?.decisionRequiresQuorum && governanceSummary?.quorumMet === false && (
                                                    <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: '#b45309' }}>
                                                        Quorum is required before final decision.
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {canDecideGovernance && !isCurrentUserGovernanceChair && governanceReview.status === 'in-review' && (
                                            <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: '#b45309' }}>
                                                Only the governance chair can record the final decision for this review.
                                            </div>
                                        )}

                                        {governanceReview.status === 'decided' && (
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>
                                                Decision recorded as {GOVERNANCE_DECISION_LABELS[governanceReview.decision] || governanceReview.decision || 'n/a'}
                                                {governanceReview.decidedAt ? ` on ${formatDate(governanceReview.decidedAt)}` : ''}.
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Conversation Section */}
                        {canViewIncomingRequests ? (
                            <div className="conversation-section">
                                <div className="conversation-header">
                                    <h4>
                                        <MessageSquare size={16} />
                                        Conversation
                                    </h4>
                                    {selectedSubmission.formId && (
                                        <button
                                            className="btn-secondary"
                                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                                            onClick={() => copyConversationLink(selectedSubmission)}
                                        >
                                            {copiedLink === selectedSubmission.id ? <Check size={12} /> : <Copy size={12} />}
                                            {copiedLink === selectedSubmission.id ? 'Copied!' : 'Copy Link'}
                                        </button>
                                    )}
                                </div>

                                <div className="conversation-thread">
                                    {selectedSubmission.conversation?.length > 0 ? (
                                        selectedSubmission.conversation.map(msg => (
                                            <div key={msg.id} className={`conversation-message ${msg.type}`}>
                                                <div className="message-bubble">
                                                    {msg.message}
                                                </div>
                                                <div className="message-meta">
                                                    {msg.senderName || (msg.type === 'admin' ? 'Admin' : 'Requester')} - {formatMessageTime(msg.timestamp)}
                                                    {!msg.read && msg.type === 'requester' && <span className="message-unread" />}
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="conversation-empty">
                                            No messages yet. Start a conversation with the requester.
                                        </div>
                                    )}
                                    <div ref={conversationEndRef} />
                                </div>

                                {selectedSubmission.status !== 'approved' && selectedSubmission.status !== 'rejected' && (
                                    <div className="conversation-input">
                                        <textarea
                                            value={newMessage}
                                            onChange={(e) => setNewMessage(e.target.value)}
                                            placeholder="Type a message to the requester..."
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault();
                                                    handleSendMessage();
                                                }
                                            }}
                                        />
                                        <button
                                            className="btn-primary"
                                            onClick={handleSendMessage}
                                            disabled={!newMessage.trim()}
                                        >
                                            <Send size={16} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="conversation-section">
                                <div className="conversation-empty">
                                    Conversation is only available to intake managers.
                                </div>
                            </div>
                        )}

                        {/* Actions */}
                        {canViewIncomingRequests && selectedSubmission.status !== 'approved' && selectedSubmission.status !== 'rejected' && (
                            <div className="form-actions" style={{ marginTop: '1.5rem' }}>
                                <button
                                    className="btn-secondary"
                                    onClick={handleReject}
                                    style={{ color: '#ef4444' }}
                                >
                                    <XCircle size={16} /> Reject
                                </button>
                                {governanceAllowsConversion ? (
                                    <button
                                        className="btn-primary"
                                        onClick={() => setShowConvertModal(true)}
                                    >
                                        <ArrowRight size={16} /> Convert to Project
                                    </button>
                                ) : (
                                    <div style={{ fontSize: '0.78rem', color: '#b45309' }}>
                                        Conversion requires governance decision: Approved Now.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </Modal>

            {/* Convert to Project Modal */}
            <Modal
                isOpen={showConvertModal}
                onClose={() => setShowConvertModal(false)}
                title="Convert to Project"
                closeOnOverlayClick={false}
            >
                <div className="form-group">
                    <label>Link to Goal (optional)</label>
                    <select
                        value={convertGoalId}
                        onChange={(e) => setConvertGoalId(e.target.value)}
                    >
                        <option value="">No goal</option>
                        {goals.map(g => (
                            <option key={g.id} value={g.id}>{g.title}</option>
                        ))}
                    </select>
                </div>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)', marginBottom: '1rem' }}>
                    This will create a new project from this request and mark the request as approved.
                </p>
                <div className="form-actions">
                    <button className="btn-secondary" onClick={() => setShowConvertModal(false)}>Cancel</button>
                    <button className="btn-primary" onClick={handleConvert} disabled={!governanceAllowsConversion}>
                        <CheckCircle size={16} /> Create Project
                    </button>
                </div>
            </Modal>

            {/* Reject Confirmation Modal */}
            <Modal
                isOpen={showRejectModal}
                onClose={() => setShowRejectModal(false)}
                title="Reject Request"
                closeOnOverlayClick={false}
            >
                <div className="modal-content">
                    <p>Are you sure you want to reject this request? The requester will be notified.</p>
                    <div className="form-actions" style={{ marginTop: '1.5rem' }}>
                        <button className="btn-secondary" onClick={() => setShowRejectModal(false)}>Cancel</button>
                        <button
                            className="btn-primary"
                            onClick={confirmReject}
                            style={{ backgroundColor: '#ef4444', borderColor: '#ef4444' }}
                        >
                            <XCircle size={16} /> Confirm Rejection
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { Eye, Copy, Check, MessageSquare, CheckCircle, XCircle, ArrowRight, Clock, Send, Scale, RefreshCw, Vote, ChevronDown } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { Modal } from '../UI/Modal';
import { canRouteGovernanceSubmission, getGovernanceReviewPermissions } from '../../utils/governanceAccess';
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

const GOVERNANCE_REASON_TEMPLATES = {
    apply: [
        'Regulatory or safety risk requires formal governance review.',
        'Cross-team capacity and funding impact requires governance prioritization.',
        'Strategic impact requires scoring and governance decision.'
    ],
    skip: [
        'Low-risk intake item can proceed through standard triage.',
        'Request is informational and does not require governance scoring.',
        'Urgent operational fix approved for expedited intake handling.'
    ]
};

export function IntakeRequestsList({ initialFilter = 'all', showFilterTabs = true }) {
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
        fetchGovernanceBoards,
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
    const [voteOpen, setVoteOpen] = useState(true);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [decisionOpen, setDecisionOpen] = useState(true);
    const [governanceBoards, setGovernanceBoards] = useState([]);
    const [queueBoardId, setQueueBoardId] = useState('');
    const [queueGovernanceStatus, setQueueGovernanceStatus] = useState('');
    const [queueGovernanceDecision, setQueueGovernanceDecision] = useState('');
    const [queueMyPendingVotes, setQueueMyPendingVotes] = useState(false);
    const [queueNeedsChairDecision, setQueueNeedsChairDecision] = useState(false);
    const [queuePagination, setQueuePagination] = useState({
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 1
    });
    const [queuePage, setQueuePage] = useState(1);
    const [showGovernanceReasonModal, setShowGovernanceReasonModal] = useState(false);
    const [governanceReasonMode, setGovernanceReasonMode] = useState('apply');
    const [governanceReasonTemplate, setGovernanceReasonTemplate] = useState('');
    const [governanceReasonText, setGovernanceReasonText] = useState('');
    const conversationEndRef = useRef(null);

    const canViewIncomingRequests = hasPermission('can_view_incoming_requests');
    const canViewGovernanceQueue = hasPermission('can_view_governance_queue');
    const canVoteGovernance = hasPermission('can_vote_governance');
    const canDecideGovernance = hasPermission('can_decide_governance');
    const canRouteGovernance = canRouteGovernanceSubmission({ hasPermission, currentUser });

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
            const result = await fetchIntakeGovernanceQueue({
                page: queuePage,
                limit: queuePagination.limit,
                boardId: queueBoardId || undefined,
                governanceStatus: queueGovernanceStatus || undefined,
                governanceDecision: queueGovernanceDecision || undefined,
                myPendingVotes: queueMyPendingVotes ? 'true' : undefined,
                needsChairDecision: queueNeedsChairDecision ? 'true' : undefined
            });
            setGovernanceQueue(result.items || []);
            setQueuePagination(prev => ({
                page: Number(result?.pagination?.page || prev.page || 1),
                limit: Number(result?.pagination?.limit || prev.limit || 50),
                total: Number(result?.pagination?.total || 0),
                totalPages: Math.max(1, Number(result?.pagination?.totalPages || 1))
            }));
        } catch (err) {
            console.error('Failed to load governance queue:', err);
            toast.error(err.message || 'Failed to load governance queue');
        } finally {
            setLoadingGovernanceQueue(false);
        }
    }, [
        canViewGovernanceQueue,
        fetchIntakeGovernanceQueue,
        queuePage,
        queuePagination.limit,
        queueBoardId,
        queueGovernanceStatus,
        queueGovernanceDecision,
        queueMyPendingVotes,
        queueNeedsChairDecision,
        toast
    ]);

    const loadGovernanceBoards = useCallback(async () => {
        if (!canViewGovernanceQueue) return;
        try {
            const boards = await fetchGovernanceBoards({ includeInactive: true });
            setGovernanceBoards(Array.isArray(boards) ? boards : []);
        } catch (err) {
            console.error('Failed to load governance boards:', err);
            setGovernanceBoards([]);
        }
    }, [canViewGovernanceQueue, fetchGovernanceBoards]);

    useEffect(() => {
        if (filter === 'governance') {
            loadGovernanceBoards();
            loadGovernanceQueue();
        }
    }, [filter, loadGovernanceBoards, loadGovernanceQueue]);

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
        setGovernanceReasonMode('apply');
        setGovernanceReasonTemplate(GOVERNANCE_REASON_TEMPLATES.apply[0]);
        setGovernanceReasonText('');
        setShowGovernanceReasonModal(true);
    };

    const handleConfirmGovernanceReason = async () => {
        if (!selectedSubmission) return;
        const isSkip = governanceReasonMode === 'skip';
        const customReason = governanceReasonText.trim();
        const selectedTemplate = governanceReasonTemplate.trim();
        const reason = customReason || selectedTemplate;

        if (isSkip && !reason) {
            toast.error('Reason is required when skipping governance.');
            return;
        }

        try {
            setGovernanceActionLoading(true);
            if (isSkip) {
                await skipSubmissionGovernance(selectedSubmission.id, reason);
                setSelectedSubmission(prev => prev ? {
                    ...prev,
                    governanceRequired: false,
                    governanceStatus: 'skipped',
                    governanceReason: reason || 'Governance skipped by intake manager.'
                } : prev);
                setGovernanceDetails(null);
                toast.success('Governance skipped for submission');
            } else {
                await applySubmissionGovernance(selectedSubmission.id, reason);
                setSelectedSubmission(prev => prev ? {
                    ...prev,
                    governanceRequired: true,
                    governanceStatus: 'not-started',
                    governanceDecision: null,
                    governanceReason: reason || 'Marked for governance review by intake manager.'
                } : prev);
                toast.success('Submission marked for governance');
            }
            if (filter === 'governance') await loadGovernanceQueue();
            setShowGovernanceReasonModal(false);
            setGovernanceReasonText('');
        } catch (err) {
            console.error(err);
            toast.error(err.message || `Failed to ${isSkip ? 'skip' : 'apply'} governance`);
        } finally {
            setGovernanceActionLoading(false);
        }
    };

    const handleSkipGovernance = async () => {
        if (!selectedSubmission) return;
        setGovernanceReasonMode('skip');
        setGovernanceReasonTemplate(GOVERNANCE_REASON_TEMPLATES.skip[0]);
        setGovernanceReasonText('');
        setShowGovernanceReasonModal(true);
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
        ? queuePagination.total
        : intakeSubmissions.filter(s => s.governanceRequired).length;

    // Count unread messages across all submissions
    const getUnreadCount = (submission) => {
        const sub = getSubmissionWithConversation(submission);
        return sub.conversation?.filter(msg => !msg.read && msg.type === 'requester').length || 0;
    };

    const selectedForm = selectedSubmission ? getForm(selectedSubmission.formId) : null;
    const governanceReview = governanceDetails?.review || null;
    const governanceSummary = governanceReview?.scoreSummary || null;
    const governanceReviewPermissions = getGovernanceReviewPermissions({
        review: governanceReview,
        currentUser,
        hasPermission
    });
    const governanceAllowsConversion = !selectedSubmission?.governanceRequired || (
        String(selectedSubmission?.governanceStatus || '').toLowerCase() === 'decided' &&
        String(selectedSubmission?.governanceDecision || '').toLowerCase() === 'approved-now'
    );
    const isGovernanceFilter = filter === 'governance';

    const updateQueueFilter = (updates) => {
        setQueuePage(1);
        if (updates.boardId !== undefined) setQueueBoardId(updates.boardId);
        if (updates.governanceStatus !== undefined) setQueueGovernanceStatus(updates.governanceStatus);
        if (updates.governanceDecision !== undefined) setQueueGovernanceDecision(updates.governanceDecision);
        if (updates.myPendingVotes !== undefined) setQueueMyPendingVotes(updates.myPendingVotes);
        if (updates.needsChairDecision !== undefined) setQueueNeedsChairDecision(updates.needsChairDecision);
    };

    const clearQueueFilters = () => {
        setQueuePage(1);
        setQueueBoardId('');
        setQueueGovernanceStatus('');
        setQueueGovernanceDecision('');
        setQueueMyPendingVotes(false);
        setQueueNeedsChairDecision(false);
    };

    return (
        <div className="intake-requests">
            {/* Tabs */}
            {showFilterTabs && (
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
            )}

            {isGovernanceFilter && canViewGovernanceQueue && (
                <div className="intake-governance-filters">
                    <div className="governance-filter-grid">
                        <div className="form-group governance-filter-field">
                            <label>Board</label>
                            <select
                                className="form-select governance-filter-select"
                                value={queueBoardId}
                                onChange={(e) => updateQueueFilter({ boardId: e.target.value })}
                            >
                                <option value="">All boards</option>
                                {governanceBoards.map((board) => (
                                    <option key={board.id} value={board.id}>
                                        {board.name} {board.isActive ? '' : '(Inactive)'}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group governance-filter-field">
                            <label>Governance Status</label>
                            <select
                                className="form-select governance-filter-select"
                                value={queueGovernanceStatus}
                                onChange={(e) => updateQueueFilter({ governanceStatus: e.target.value })}
                            >
                                <option value="">All statuses</option>
                                <option value="not-started">Not Started</option>
                                <option value="in-review">In Review</option>
                                <option value="decided">Decided</option>
                                <option value="skipped">Skipped</option>
                            </select>
                        </div>
                        <div className="form-group governance-filter-field">
                            <label>Decision</label>
                            <select
                                className="form-select governance-filter-select"
                                value={queueGovernanceDecision}
                                onChange={(e) => updateQueueFilter({ governanceDecision: e.target.value })}
                            >
                                <option value="">All decisions</option>
                                <option value="approved-now">Approved Now</option>
                                <option value="approved-backlog">Approved Backlog</option>
                                <option value="needs-info">Needs Info</option>
                                <option value="rejected">Rejected</option>
                            </select>
                        </div>
                        <div className="governance-filter-checks">
                            <label className="governance-filter-checkbox">
                                <input
                                    type="checkbox"
                                    checked={queueMyPendingVotes}
                                    onChange={(e) => updateQueueFilter({ myPendingVotes: e.target.checked })}
                                />
                                <span>My pending votes</span>
                            </label>
                            <label className="governance-filter-checkbox">
                                <input
                                    type="checkbox"
                                    checked={queueNeedsChairDecision}
                                    onChange={(e) => updateQueueFilter({ needsChairDecision: e.target.checked })}
                                />
                                <span>Needs chair decision</span>
                            </label>
                        </div>
                    </div>
                    <div className="governance-filter-footer">
                        <div className="governance-filter-count">
                            {queuePagination.total} item{queuePagination.total === 1 ? '' : 's'} in queue
                        </div>
                        <div className="governance-filter-actions">
                            <button className="btn-secondary" onClick={clearQueueFilters} disabled={loadingGovernanceQueue}>
                                Reset Filters
                            </button>
                            <button className="btn-secondary" onClick={loadGovernanceQueue} disabled={loadingGovernanceQueue}>
                                <RefreshCw size={14} /> {loadingGovernanceQueue ? 'Refreshing...' : 'Refresh Queue'}
                            </button>
                        </div>
                    </div>
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

            {isGovernanceFilter && canViewGovernanceQueue && queuePagination.totalPages > 1 && (
                <div style={{ marginTop: '0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        Page {queuePagination.page} of {queuePagination.totalPages}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <button
                            className="btn-secondary"
                            onClick={() => setQueuePage(prev => Math.max(1, prev - 1))}
                            disabled={loadingGovernanceQueue || queuePage <= 1}
                        >
                            Previous
                        </button>
                        <button
                            className="btn-secondary"
                            onClick={() => setQueuePage(prev => Math.min(queuePagination.totalPages, prev + 1))}
                            disabled={loadingGovernanceQueue || queuePage >= queuePagination.totalPages}
                        >
                            Next
                        </button>
                    </div>
                </div>
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

                                {/* Summary Bar */}
                                <div className="governance-summary-bar">
                                    <div className="governance-summary-item">
                                        <strong>Board</strong>
                                        <span>{selectedSubmission.governanceBoardName || governanceDetails?.submission?.governanceBoardName || 'Unassigned'}</span>
                                    </div>
                                    <div className="governance-summary-item">
                                        <strong>Status</strong>
                                        <span>{GOVERNANCE_STATUS_LABELS[selectedSubmission.governanceStatus] || selectedSubmission.governanceStatus || 'Not Started'}</span>
                                    </div>
                                    <div className="governance-summary-item">
                                        <strong>Decision</strong>
                                        <span>{selectedSubmission.governanceDecision ? (GOVERNANCE_DECISION_LABELS[selectedSubmission.governanceDecision] || selectedSubmission.governanceDecision) : 'Pending'}</span>
                                    </div>
                                    {selectedSubmission.priorityScore !== null && selectedSubmission.priorityScore !== undefined && (
                                        <div className="governance-summary-item">
                                            <strong>Score</strong>
                                            <span>{selectedSubmission.priorityScore}</span>
                                        </div>
                                    )}
                                    {selectedSubmission.governanceReason && (
                                        <div className="governance-summary-item" style={{ gridColumn: '1 / -1' }}>
                                            <strong>Reason</strong>
                                            <span>{selectedSubmission.governanceReason}</span>
                                        </div>
                                    )}
                                </div>

                                {governanceError && (
                                    <div className="governance-error">{governanceError}</div>
                                )}
                                {loadingGovernanceDetails && (
                                    <div className="governance-loading">Loading governance details...</div>
                                )}

                                {/* Routing Action Bar */}
                                {canRouteGovernance && (
                                    <div className="governance-action-bar">
                                        {!selectedSubmission.governanceRequired && (
                                            <button className="btn-secondary" onClick={handleApplyGovernance} disabled={governanceActionLoading}>
                                                <Scale size={14} /> Apply Governance
                                            </button>
                                        )}
                                        {selectedSubmission.governanceRequired && selectedSubmission.governanceStatus === 'not-started' && (
                                            <button className="btn-primary" onClick={handleStartGovernance} disabled={governanceActionLoading}>
                                                <Vote size={14} /> Start Review
                                            </button>
                                        )}
                                        {selectedSubmission.governanceRequired && selectedSubmission.governanceStatus !== 'decided' && (
                                            <button className="btn-secondary" onClick={handleSkipGovernance} disabled={governanceActionLoading}>
                                                Skip Governance
                                            </button>
                                        )}
                                    </div>
                                )}

                                {/* Governance Review Details */}
                                {selectedSubmission.governanceRequired && governanceReview && (
                                    <>
                                        {/* Quorum Progress Bar */}
                                        {governanceSummary && (
                                            <div className="governance-quorum-bar" style={{ marginTop: '0.75rem' }}>
                                                <span>
                                                    {governanceSummary.voteCount ?? 0}/{governanceSummary.eligibleVoterCount ?? 0} voted
                                                </span>
                                                <div className="governance-quorum-track">
                                                    <div
                                                        className={`governance-quorum-fill ${governanceSummary.quorumMet ? 'met' : ''}`}
                                                        style={{ width: `${Math.min(100, governanceSummary.participationPct ?? 0)}%` }}
                                                    />
                                                </div>
                                                {governanceSummary.requiredVotes !== undefined && (
                                                    <span>
                                                        Quorum: {governanceSummary.quorumMet ? '✓ Met' : `${governanceSummary.voteCount ?? 0}/${governanceSummary.requiredVotes} needed`}
                                                    </span>
                                                )}
                                                {governanceSummary.priorityScore !== null && governanceSummary.priorityScore !== undefined && (
                                                    <span style={{ marginLeft: 'auto' }}>
                                                        Score: {governanceSummary.priorityScore}
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {governanceReview.voteDeadlineAt && (
                                            <div className={`governance-deadline ${governanceReview.deadlinePassed ? 'passed' : ''}`}>
                                                Voting deadline: {formatDate(governanceReview.voteDeadlineAt)}
                                                {governanceReview.deadlinePassed ? ' (closed)' : ''}
                                            </div>
                                        )}

                                        {/* Vote Panel */}
                                        {canVoteGovernance && governanceReview.status === 'in-review' && (
                                            <div className="governance-panel">
                                                <button className="governance-panel-header" onClick={() => setVoteOpen(v => !v)}>
                                                    <span className="panel-title">
                                                        <Vote size={15} /> Submit Your Vote
                                                    </span>
                                                    <ChevronDown size={14} className={`panel-toggle ${voteOpen ? 'open' : ''}`} />
                                                </button>
                                                {voteOpen && (
                                                    <div className="governance-panel-content">
                                                        {governanceReviewPermissions.canVote ? (
                                                            <>
                                                                {(governanceReview.criteria || []).filter(c => c.enabled).map(criterion => (
                                                                    <div key={criterion.id} className="form-group" style={{ marginBottom: '0.6rem' }}>
                                                                        <label style={{ fontSize: '0.8rem' }}>
                                                                            {criterion.name} ({criterion.weight}%)
                                                                        </label>
                                                                        <select
                                                                            value={voteScores[criterion.id] ?? 3}
                                                                            onChange={(e) => setVoteScores(prev => ({ ...prev, [criterion.id]: Number(e.target.value) }))}
                                                                            disabled={governanceActionLoading}
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
                                                                        disabled={governanceActionLoading}
                                                                    />
                                                                </div>
                                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem' }}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={voteConflictDeclared}
                                                                        onChange={(e) => setVoteConflictDeclared(e.target.checked)}
                                                                        disabled={governanceActionLoading}
                                                                    />
                                                                    I have a conflict of interest related to this vote
                                                                </label>
                                                                <div className="form-actions" style={{ marginTop: '0.75rem' }}>
                                                                    <button className="btn-primary" onClick={handleSubmitVote} disabled={governanceActionLoading}>
                                                                        Submit Vote
                                                                    </button>
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <div className="governance-warning">
                                                                {governanceReviewPermissions.voteBlocker || 'Voting is currently unavailable.'}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Vote History Panel */}
                                        {governanceReview.votes?.length > 0 && (
                                            <div className="governance-panel">
                                                <button className="governance-panel-header" onClick={() => setHistoryOpen(v => !v)}>
                                                    <span className="panel-title">
                                                        Vote History
                                                        <span className="governance-tab-badge">{governanceReview.votes.length}</span>
                                                    </span>
                                                    <ChevronDown size={14} className={`panel-toggle ${historyOpen ? 'open' : ''}`} />
                                                </button>
                                                {historyOpen && (
                                                    <div className="governance-panel-content">
                                                        {governanceReview.votes.map(vote => (
                                                            <div key={vote.id} className="governance-vote-card">
                                                                <div className="governance-vote-meta">
                                                                    {(vote.voterName || vote.voterEmail || vote.voterUserOid)} — {formatMessageTime(vote.submittedAt)}
                                                                </div>
                                                                {vote.comment && (
                                                                    <div className="governance-vote-comment">{vote.comment}</div>
                                                                )}
                                                                {vote.conflictDeclared && (
                                                                    <div className="governance-vote-conflict">Conflict declared</div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Decision Panel */}
                                        {canDecideGovernance && governanceReview.status === 'in-review' && (
                                            <div className="governance-panel">
                                                <button className="governance-panel-header" onClick={() => setDecisionOpen(v => !v)}>
                                                    <span className="panel-title">Record Decision</span>
                                                    <ChevronDown size={14} className={`panel-toggle ${decisionOpen ? 'open' : ''}`} />
                                                </button>
                                                {decisionOpen && (
                                                    <div className="governance-panel-content">
                                                        <div className="form-group" style={{ marginBottom: '0.6rem' }}>
                                                            <label style={{ fontSize: '0.8rem' }}>Decision</label>
                                                            <select
                                                                value={decision}
                                                                onChange={(e) => setDecision(e.target.value)}
                                                                disabled={!governanceReviewPermissions.canDecide || governanceActionLoading}
                                                            >
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
                                                                disabled={!governanceReviewPermissions.canDecide || governanceActionLoading}
                                                            />
                                                        </div>
                                                        <div className="form-actions" style={{ marginTop: '0.75rem' }}>
                                                            <button
                                                                className="btn-primary"
                                                                onClick={handleDecide}
                                                                disabled={governanceActionLoading || !governanceReviewPermissions.canDecide}
                                                            >
                                                                Save Decision
                                                            </button>
                                                        </div>
                                                        {governanceReviewPermissions.decisionBlocker && (
                                                            <div className="governance-warning">
                                                                {governanceReviewPermissions.decisionBlocker}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {governanceReview.status === 'decided' && (
                                            <div className="governance-decided-note" style={{ marginTop: '0.5rem' }}>
                                                Decision recorded as {GOVERNANCE_DECISION_LABELS[governanceReview.decision] || governanceReview.decision || 'n/a'}
                                                {governanceReview.decidedAt ? ` on ${formatDate(governanceReview.decidedAt)}` : ''}.
                                            </div>
                                        )}
                                    </>
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

            <Modal
                isOpen={showGovernanceReasonModal}
                onClose={() => setShowGovernanceReasonModal(false)}
                title={governanceReasonMode === 'skip' ? 'Skip Governance' : 'Apply Governance'}
                closeOnOverlayClick={false}
            >
                <div className="form-group">
                    <label>Reason Template</label>
                    <select
                        value={governanceReasonTemplate}
                        onChange={(e) => setGovernanceReasonTemplate(e.target.value)}
                        disabled={governanceActionLoading}
                    >
                        <option value="">No template</option>
                        {GOVERNANCE_REASON_TEMPLATES[governanceReasonMode].map((template) => (
                            <option key={template} value={template}>{template}</option>
                        ))}
                    </select>
                </div>
                <div className="form-group">
                    <label>
                        Custom Reason {governanceReasonMode === 'skip' ? '*' : '(optional)'}
                    </label>
                    <textarea
                        value={governanceReasonText}
                        onChange={(e) => setGovernanceReasonText(e.target.value)}
                        placeholder={governanceReasonMode === 'skip' ? 'Provide reason for skipping governance...' : 'Add context for governance routing...'}
                        disabled={governanceActionLoading}
                    />
                </div>
                {governanceReasonMode === 'skip' && !governanceReasonText.trim() && !governanceReasonTemplate && (
                    <div className="governance-warning">A reason is required when skipping governance.</div>
                )}
                <div className="form-actions">
                    <button className="btn-secondary" onClick={() => setShowGovernanceReasonModal(false)} disabled={governanceActionLoading}>
                        Cancel
                    </button>
                    <button className="btn-primary" onClick={handleConfirmGovernanceReason} disabled={governanceActionLoading}>
                        {governanceActionLoading ? 'Saving...' : 'Confirm'}
                    </button>
                </div>
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


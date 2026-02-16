import { useState, useEffect, useRef } from 'react';
import { Eye, Copy, Check, MessageSquare, CheckCircle, XCircle, ArrowRight, Clock, Send } from 'lucide-react';
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

export function IntakeRequestsList() {
    const {
        intakeSubmissions,
        intakeForms,
        goals,
        addConversationMessage,
        markConversationRead,
        migrateInfoRequestsToConversation,
        updateIntakeSubmission,
        convertSubmissionToProject
    } = useData();
    const toast = useToast();

    const [filter, setFilter] = useState('all');
    const [selectedSubmission, setSelectedSubmission] = useState(null);
    const [showConvertModal, setShowConvertModal] = useState(false);
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [newMessage, setNewMessage] = useState('');
    const [convertGoalId, setConvertGoalId] = useState('');
    const [copiedLink, setCopiedLink] = useState('');
    const conversationEndRef = useRef(null);

    // Auto-scroll to bottom of conversation
    useEffect(() => {
        if (conversationEndRef.current) {
            conversationEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [selectedSubmission?.conversation]);

    // Mark messages as read when viewing
    useEffect(() => {
        if (selectedSubmission) {
            const hasUnread = selectedSubmission.conversation?.some(msg => !msg.read && msg.type === 'requester');
            if (hasUnread) {
                markConversationRead(selectedSubmission.id);
            }
        }
    }, [selectedSubmission, markConversationRead]);

    // Get submission with migrated conversation
    const getSubmissionWithConversation = (submission) => {
        return migrateInfoRequestsToConversation(submission);
    };

    const filteredSubmissions = intakeSubmissions.filter(s => {
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


    const handleConvert = async () => {
        const form = getForm(selectedSubmission.formId);
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
            toast.error('Failed to create project. Please try again.');
        }
    };

    const handleReject = () => {
        setShowRejectModal(true);
    };

    const confirmReject = () => {
        updateIntakeSubmission(selectedSubmission.id, { status: 'rejected' });
        setShowRejectModal(false);
        setSelectedSubmission(null);
        toast.success('Request rejected');
    };

    const copyConversationLink = (submission) => {
        const baseUrl = window.location.origin;
        const link = `${baseUrl}/#/intake/${submission.formId}?sub=${submission.id}`;
        navigator.clipboard.writeText(link);
        setCopiedLink(submission.id);
        setTimeout(() => setCopiedLink(''), 2000);
    };

    const pendingCount = intakeSubmissions.filter(s => s.status === 'pending').length;
    const awaitingCount = intakeSubmissions.filter(s => s.status === 'awaiting-response').length;

    // Count unread messages across all submissions
    const getUnreadCount = (submission) => {
        const sub = getSubmissionWithConversation(submission);
        return sub.conversation?.filter(msg => !msg.read && msg.type === 'requester').length || 0;
    };

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
            </div>

            {/* Table */}
            {filteredSubmissions.length === 0 ? (
                <div className="intake-empty">
                    <Clock size={48} />
                    <p>No requests found</p>
                </div>
            ) : (
                <table className="requests-table">
                    <thead>
                        <tr>
                            <th>Form</th>
                            <th>Submitted</th>
                            <th>Status</th>
                            <th>Preview</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredSubmissions.map(submission => {
                            const form = getForm(submission.formId);
                            const firstField = form?.fields[0];
                            const unreadCount = getUnreadCount(submission);
                            return (
                                <tr key={submission.id}>
                                    <td>
                                        {form?.name || 'Unknown Form'}
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
                                    <td>
                                        {firstField && getFieldValue(submission, firstField.id)}
                                    </td>
                                    <td>
                                        <div className="request-actions">
                                            <button
                                                className="btn-secondary"
                                                onClick={() => setSelectedSubmission(getSubmissionWithConversation(submission))}
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

                        <div className="submission-fields" style={{ marginTop: '1.5rem' }}>
                            {getForm(selectedSubmission.formId)?.fields.map(field => (
                                <div key={field.id} className="form-group" style={{ marginBottom: '1rem' }}>
                                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)' }}>
                                        {field.label}
                                    </label>
                                    <div style={{ marginTop: '0.25rem', color: 'var(--text-primary)' }}>
                                        {getFieldValue(selectedSubmission, field.id)}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Conversation Section */}
                        <div className="conversation-section">
                            <div className="conversation-header">
                                <h4>
                                    <MessageSquare size={16} />
                                    Conversation
                                </h4>
                                <button
                                    className="btn-secondary"
                                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                                    onClick={() => copyConversationLink(selectedSubmission)}
                                >
                                    {copiedLink === selectedSubmission.id ? <Check size={12} /> : <Copy size={12} />}
                                    {copiedLink === selectedSubmission.id ? 'Copied!' : 'Copy Link'}
                                </button>
                            </div>

                            <div className="conversation-thread">
                                {selectedSubmission.conversation?.length > 0 ? (
                                    selectedSubmission.conversation.map(msg => (
                                        <div key={msg.id} className={`conversation-message ${msg.type}`}>
                                            <div className="message-bubble">
                                                {msg.message}
                                            </div>
                                            <div className="message-meta">
                                                {msg.senderName || (msg.type === 'admin' ? 'Admin' : 'Requester')} • {formatMessageTime(msg.timestamp)}
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

                            {/* Message Input - only show for non-closed submissions */}
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

                        {/* Actions */}
                        {selectedSubmission.status !== 'approved' && selectedSubmission.status !== 'rejected' && (
                            <div className="form-actions" style={{ marginTop: '1.5rem' }}>
                                <button
                                    className="btn-secondary"
                                    onClick={handleReject}
                                    style={{ color: '#ef4444' }}
                                >
                                    <XCircle size={16} /> Reject
                                </button>
                                <button
                                    className="btn-primary"
                                    onClick={() => setShowConvertModal(true)}
                                >
                                    <ArrowRight size={16} /> Convert to Project
                                </button>
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
                    <button className="btn-primary" onClick={handleConvert}>
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

import { useState, useRef, useEffect } from 'react';
import { Clock, MessageSquare, Eye, Send, CheckCircle, XCircle } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { Modal } from '../UI/Modal';
import { useAuth } from '../../hooks/useAuth';
import './Intake.css';

const STATUS_LABELS = {
    'pending': 'Pending Review',
    'awaiting-response': 'Action Required',
    'approved': 'Approved',
    'rejected': 'Declined'
};

export function MySubmissionsList() {
    const { mySubmissions, intakeForms, addConversationMessage, markConversationRead } = useData();
    const { account } = useAuth();
    const [selectedSubmission, setSelectedSubmission] = useState(null);
    const [newMessage, setNewMessage] = useState('');
    const conversationEndRef = useRef(null);

    // Filter out temporary optimistic updates if needed, though they should be fine
    const sortedSubmissions = [...mySubmissions].sort((a, b) =>
        new Date(b.submittedAt) - new Date(a.submittedAt)
    );

    useEffect(() => {
        if (conversationEndRef.current) {
            conversationEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [selectedSubmission?.conversation]);

    // Mark messages as read when viewing
    useEffect(() => {
        if (selectedSubmission) {
            const hasUnread = selectedSubmission.conversation?.some(msg => !msg.read && msg.type === 'admin');
            if (hasUnread) {
                markConversationRead(selectedSubmission.id);
            }
        }
    }, [selectedSubmission, markConversationRead]);

    const getForm = (formId) => intakeForms.find(f => f.id === formId);

    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
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
            await addConversationMessage(selectedSubmission.id, newMessage, 'requester');

            // Optimistic update for UI responsiveness
            const newMsg = {
                id: `temp-${Date.now()}`,
                type: 'requester',
                message: newMessage,
                timestamp: new Date().toISOString(),
                read: true
            };

            setSelectedSubmission(prev => ({
                ...prev,
                conversation: [...(prev.conversation || []), newMsg],
                status: 'pending' // Reverts to pending after user reply
            }));

            setNewMessage('');
        } catch (err) {
            alert('Failed to send message. Please try again.');
        }
    };

    const getUnreadCount = (submission) => {
        return submission.conversation?.filter(msg => !msg.read && msg.type === 'admin').length || 0;
    };

    if (mySubmissions.length === 0) {
        return (
            <div className="intake-empty">
                <Clock size={48} />
                <p>You haven't submitted any requests yet.</p>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-tertiary)' }}>
                    Select a form above to create your first request.
                </p>
            </div>
        );
    }

    return (
        <div className="my-submissions">
            <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>My Request History</h3>
            <div className="submissions-list">
                {sortedSubmissions.map(submission => {
                    const form = getForm(submission.formId);
                    const unreadCount = getUnreadCount(submission);
                    const isActionRequired = submission.status === 'awaiting-response';

                    return (
                        <div key={submission.id} className="submission-item-card" onClick={() => setSelectedSubmission(submission)}>
                            <div className="submission-card-top">
                                <div className="submission-main-info">
                                    {/* Primary: Project Name (or Form Name if no fields) */}
                                    <h4 className="submission-title">
                                        {form?.fields?.[0] ? (submission.formData?.[form.fields[0].id] || 'Untitled Request') : (form?.name || 'Unknown Request')}
                                    </h4>

                                    {/* Secondary: Form Type */}
                                    <div className="submission-type">
                                        <span className="type-label">Type:</span> {form?.name || 'Unknown Type'}
                                    </div>
                                </div>
                                <span className={`status-badge ${submission.status}`}>
                                    {STATUS_LABELS[submission.status] || submission.status}
                                </span>
                            </div>

                            <div className="submission-card-bottom">
                                <div className="submission-meta-row">
                                    <span className="submission-date">
                                        <Clock size={12} /> {formatDate(submission.submittedAt)}
                                    </span>
                                    {unreadCount > 0 && (
                                        <span className="unread-badge">{unreadCount} new messages</span>
                                    )}
                                </div>
                                {isActionRequired && (
                                    <div className="action-required-banner">
                                        <MessageSquare size={14} />
                                        <span>Waiting for your reply</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

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
                        <div className="submission-meta-header">
                            <div>
                                <h2>{getForm(selectedSubmission.formId)?.name}</h2>
                                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>
                                    Submitted on {formatDate(selectedSubmission.submittedAt)}
                                </span>
                            </div>
                            <span className={`status-badge ${selectedSubmission.status} large`}>
                                {STATUS_LABELS[selectedSubmission.status] || selectedSubmission.status}
                            </span>
                        </div>

                        {selectedSubmission.status === 'approved' && (
                            <div className="status-banner success">
                                <CheckCircle size={20} />
                                <div>
                                    <strong>Approved!</strong>
                                    <p>Your request has been approved and converted into a project.</p>
                                </div>
                            </div>
                        )}

                        {selectedSubmission.status === 'rejected' && (
                            <div className="status-banner error">
                                <XCircle size={20} />
                                <div>
                                    <strong>Declined</strong>
                                    <p>Your request could not be fulfilled at this time.</p>
                                </div>
                            </div>
                        )}

                        {/* Form Data Summary */}
                        <div className="submission-summary">
                            <h4>Request Data</h4>
                            <div className="summary-grid">
                                {Object.entries(selectedSubmission.formData).map(([key, value]) => {
                                    // Try to find label from form definition
                                    const form = getForm(selectedSubmission.formId);
                                    const label = form?.fields.find(f => f.id === key)?.label || key;
                                    return (
                                        <div key={key} className="summary-item">
                                            <span className="label">{label}</span>
                                            <span className="value">{String(value)}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Conversation */}
                        <div className="conversation-section" style={{ marginTop: '2rem' }}>
                            <div className="conversation-header">
                                <h4>Discussion</h4>
                            </div>

                            <div className="conversation-thread">
                                {selectedSubmission.conversation?.length > 0 ? (
                                    selectedSubmission.conversation.map(msg => (
                                        <div key={msg.id} className={`conversation-message ${msg.type}`}>
                                            <div className="message-bubble">
                                                {msg.message}
                                            </div>
                                            <div className="message-meta">
                                                {msg.type === 'admin' ? (msg.senderName || 'Project Team') : 'You'} • {formatMessageTime(msg.timestamp)}
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="conversation-empty">
                                        No messages yet.
                                    </div>
                                )}
                                <div ref={conversationEndRef} />
                            </div>

                            {/* Reply Input - Only block if closed */}
                            {selectedSubmission.status !== 'approved' && selectedSubmission.status !== 'rejected' && (
                                <div className="conversation-input">
                                    <textarea
                                        value={newMessage}
                                        onChange={(e) => setNewMessage(e.target.value)}
                                        placeholder="Type your reply..."
                                        rows={2}
                                    />
                                    <button
                                        className="btn-primary"
                                        onClick={handleSendMessage}
                                        disabled={!newMessage.trim()}
                                    >
                                        <Send size={16} /> Send
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}

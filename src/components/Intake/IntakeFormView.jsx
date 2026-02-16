import { useState, useEffect, useRef } from 'react';
import { CheckCircle, AlertCircle, Send, MessageSquare } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../hooks/useAuth';
import './Intake.css';

export function IntakeFormView({ formId, submissionId }) {
    const {
        intakeForms,
        addIntakeSubmission,
        intakeSubmissions,
        addConversationMessage,
        migrateInfoRequestsToConversation
    } = useData();
    const [formData, setFormData] = useState({});
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState('');
    const [responseText, setResponseText] = useState('');
    const conversationEndRef = useRef(null);

    const form = intakeForms.find(f => f.id === formId);
    const rawSubmission = submissionId ? intakeSubmissions.find(s => s.id === submissionId) : null;
    const submission = rawSubmission ? migrateInfoRequestsToConversation(rawSubmission) : null;

    // Check if this is a conversation response (has submission ID)
    const isConversationMode = !!submissionId && !!submission;
    const hasConversation = submission?.conversation?.length > 0;

    // Auto-scroll to bottom of conversation
    useEffect(() => {
        if (conversationEndRef.current) {
            conversationEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [submission?.conversation]);

    const { account } = useAuth(); // Get current user

    useEffect(() => {
        // Initialize form data
        if (form) {
            const initialData = {};
            form.fields.forEach(field => {
                // Auto-fill known fields if available
                if (account) {
                    const labelLower = field.label.toLowerCase();
                    if (labelLower.includes('name') && !labelLower.includes('project')) {
                        initialData[field.id] = account.name || '';
                    } else if (labelLower.includes('email')) {
                        initialData[field.id] = account.username || '';
                    } else {
                        initialData[field.id] = '';
                    }
                } else {
                    initialData[field.id] = '';
                }
            });
            setFormData(initialData);
        }
    }, [form, account]);

    const formatMessageTime = (dateStr) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (!form) {
        return (
            <div className="intake-public-page">
                <div className="intake-public-card">
                    <div className="intake-success">
                        <div className="intake-success-icon" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                            <AlertCircle size={40} />
                        </div>
                        <h2>Form Not Found</h2>
                        <p>This intake form doesn't exist or has been removed.</p>
                    </div>
                </div>
            </div>
        );
    }

    // Conversation response mode
    if (isConversationMode) {
        // Check if submission is already closed
        if (submission.status === 'approved' || submission.status === 'rejected') {
            return (
                <div className="intake-public-page">
                    <div className="intake-public-card">
                        <div className="intake-success">
                            <div className="intake-success-icon" style={{
                                background: submission.status === 'approved'
                                    ? 'rgba(16, 185, 129, 0.1)'
                                    : 'rgba(239, 68, 68, 0.1)',
                                color: submission.status === 'approved' ? '#10b981' : '#ef4444'
                            }}>
                                <CheckCircle size={40} />
                            </div>
                            <h2>Request {submission.status === 'approved' ? 'Approved' : 'Closed'}</h2>
                            <p>
                                {submission.status === 'approved'
                                    ? 'Your request has been approved and converted to a project.'
                                    : 'This request has been closed.'}
                            </p>
                        </div>
                    </div>
                </div>
            );
        }

        const handleConversationResponse = async (e) => {
            e.preventDefault();
            if (!responseText.trim()) return;
            await addConversationMessage(submissionId, responseText, 'requester');
            setResponseText('');
            setSubmitted(true);
        };

        if (submitted) {
            return (
                <div className="intake-public-page">
                    <div className="intake-public-card">
                        <div className="intake-success">
                            <div className="intake-success-icon">
                                <CheckCircle size={40} />
                            </div>
                            <h2>Response Submitted</h2>
                            <p>Thank you for your response. The team will review it and may follow up with additional questions.</p>
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="intake-public-page">
                <div className="intake-public-card">
                    <div className="intake-public-header">
                        <div className="intake-header-brand">Digital Health Atlas</div>
                        <h1>Conversation</h1>
                        <p>View messages and respond to questions about your request.</p>
                    </div>

                    <div className="intake-public-form">
                        {/* Show conversation history */}
                        {hasConversation && (
                            <div className="requester-conversation">
                                <h3>
                                    <MessageSquare size={18} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
                                    Message History
                                </h3>
                                <div className="conversation-thread">
                                    {submission.conversation.map(msg => (
                                        <div key={msg.id} className={`conversation-message ${msg.type}`}>
                                            <div className="message-bubble">
                                                {msg.message}
                                            </div>
                                            <div className="message-meta">
                                                {msg.type === 'admin' ? 'Project Team' : 'You'} • {formatMessageTime(msg.timestamp)}
                                            </div>
                                        </div>
                                    ))}
                                    <div ref={conversationEndRef} />
                                </div>
                            </div>
                        )}

                        {/* Response input */}
                        <form onSubmit={handleConversationResponse}>
                            <div className="intake-field">
                                <label>Your Response <span className="required-star">*</span></label>
                                <textarea
                                    value={responseText}
                                    onChange={(e) => setResponseText(e.target.value)}
                                    rows={4}
                                    required
                                    placeholder="Enter your response..."
                                />
                            </div>
                            <button type="submit" className="btn-primary" style={{ width: '100%' }}>
                                <Send size={18} /> Send Response
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    // Regular form submission mode
    const handleChange = (fieldId, value) => {
        setFormData(prev => ({ ...prev, [fieldId]: value }));
        setError('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Validate required fields
        const missingFields = form.fields
            .filter(f => f.required && !formData[f.id])
            .map(f => f.label);

        if (missingFields.length > 0) {
            setError(`Please fill in: ${missingFields.join(', ')}`);
            return;
        }

        try {
            await addIntakeSubmission({
                formId: form.id,
                formData: formData
            });
            setSubmitted(true);
        } catch (err) {
            console.error("Submission failed:", err);
            setError("Failed to submit request. Please try again.");
        }
    };

    if (submitted) {
        return (
            <div className="intake-public-page">
                <div className="intake-public-card">
                    <div className="intake-success">
                        <div className="intake-success-icon">
                            <CheckCircle size={40} />
                        </div>
                        <h2>Request Submitted!</h2>
                        <p>Thank you for your submission. Our team will review your request and get back to you soon.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="intake-public-page">
            <div className="intake-public-card">
                <div className="intake-public-header">
                    <div className="intake-header-brand">Digital Health Atlas</div>
                    <h1>{form.name}</h1>
                    {form.description && <p>{form.description}</p>}
                </div>

                <form className="intake-public-form" onSubmit={handleSubmit}>
                    {form.fields.map(field => (
                        <div key={field.id} className="intake-field">
                            <label>
                                {field.label}
                                {field.required && <span className="required-star"> *</span>}
                            </label>

                            {field.type === 'text' && (
                                <input
                                    type="text"
                                    value={formData[field.id] || ''}
                                    onChange={(e) => handleChange(field.id, e.target.value)}
                                    required={field.required}
                                />
                            )}

                            {field.type === 'textarea' && (
                                <textarea
                                    value={formData[field.id] || ''}
                                    onChange={(e) => handleChange(field.id, e.target.value)}
                                    rows={4}
                                    required={field.required}
                                />
                            )}

                            {field.type === 'email' && (
                                <input
                                    type="email"
                                    value={formData[field.id] || ''}
                                    onChange={(e) => handleChange(field.id, e.target.value)}
                                    required={field.required}
                                />
                            )}

                            {field.type === 'number' && (
                                <input
                                    type="number"
                                    value={formData[field.id] || ''}
                                    onChange={(e) => handleChange(field.id, e.target.value)}
                                    required={field.required}
                                />
                            )}

                            {field.type === 'date' && (
                                <input
                                    type="date"
                                    value={formData[field.id] || ''}
                                    onChange={(e) => handleChange(field.id, e.target.value)}
                                    required={field.required}
                                />
                            )}

                            {field.type === 'select' && (
                                <select
                                    value={formData[field.id] || ''}
                                    onChange={(e) => handleChange(field.id, e.target.value)}
                                    required={field.required}
                                >
                                    <option value="">Select...</option>
                                    {(field.options || []).map(opt => (
                                        <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    ))}

                    {error && (
                        <div style={{ color: '#ef4444', fontSize: '0.875rem' }}>
                            {error}
                        </div>
                    )}

                    <button type="submit" className="btn-primary" style={{ width: '100%' }}>
                        Submit Request
                    </button>
                </form>
            </div>
        </div>
    );
}

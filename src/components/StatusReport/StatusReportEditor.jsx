import { useState } from 'react';
import { useMsal } from '@azure/msal-react';
import {
    Plus, Trash2, ChevronDown, ChevronUp, Users,
    Target, AlertTriangle, CheckCircle, FileText
} from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import './StatusReport.css';

// No static milestone types - milestones are now fully dynamic

export function StatusReportEditor({ projectId, projectTitle: _projectTitle, previousReport, onSave, onCancel }) {
    const { addStatusReport, currentUser } = useData();
    const { success } = useToast();
    const { instance } = useMsal();

    // Initialize from previous report or defaults
    const [author, setAuthor] = useState(currentUser?.name || '');
    const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
    const [overallStatus, setOverallStatus] = useState(previousReport?.overallStatus || 'green');
    const [purpose, setPurpose] = useState(previousReport?.purpose || '');
    const [executiveSummary, setExecutiveSummary] = useState(previousReport?.executiveSummary || '');
    const [contacts, setContacts] = useState(Array.isArray(previousReport?.contacts) ? previousReport.contacts : []);
    const [milestones, setMilestones] = useState(Array.isArray(previousReport?.milestones) ? previousReport.milestones : []);
    const [workstreams, setWorkstreams] = useState(Array.isArray(previousReport?.workstreams) ? previousReport.workstreams : []);
    const [risks, setRisks] = useState(Array.isArray(previousReport?.risks) ? previousReport.risks : []);
    const [decisions, setDecisions] = useState(Array.isArray(previousReport?.decisions) ? previousReport.decisions : []);
    const [kpis, setKpis] = useState(previousReport?.kpis || '');
    const [goodNews, setGoodNews] = useState(previousReport?.goodNews || '');
    const [governanceNotes, setGovernanceNotes] = useState(previousReport?.governanceNotes || '');

    // Accordion states
    const [expandedSections, setExpandedSections] = useState({
        header: true,
        purpose: true,
        executiveSummary: true,
        contacts: false,
        milestones: false,
        workstreams: true,
        risks: true,
        decisions: true,
        freeform: false
    });

    const toggleSection = (section) => {
        setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
    };

    // Contact management
    const addContact = () => {
        setContacts([...contacts, { id: Date.now(), name: '', organization: '' }]);
    };

    const updateContact = (id, field, value) => {
        setContacts(contacts.map(c => c.id === id ? { ...c, [field]: value } : c));
    };

    const removeContact = (id) => {
        setContacts(contacts.filter(c => c.id !== id));
    };

    // Milestone management - now dynamic like workstreams
    const addMilestone = () => {
        setMilestones([...milestones, {
            id: Date.now(),
            name: '',
            date: '',
            status: 'pending'
        }]);
    };

    const updateMilestone = (id, field, value) => {
        setMilestones(milestones.map(m => m.id === id ? { ...m, [field]: value } : m));
    };

    const removeMilestone = (id) => {
        setMilestones(milestones.filter(m => m.id !== id));
    };

    // Workstream management
    const addWorkstream = () => {
        setWorkstreams([...workstreams, {
            id: Date.now(),
            name: '',
            progressLastPeriod: '',
            workAhead: '',
            barriers: '',
            status: 'green'
        }]);
    };

    const updateWorkstream = (id, field, value) => {
        setWorkstreams(workstreams.map(w => w.id === id ? { ...w, [field]: value } : w));
    };

    const removeWorkstream = (id) => {
        setWorkstreams(workstreams.filter(w => w.id !== id));
    };

    // Risk management
    const addRisk = () => {
        setRisks([...risks, {
            id: Date.now(),
            description: '',
            impact: '',
            priority: 'medium',
            mitigation: '',
            status: 'open',
            closedDate: null,
            closedRationale: null
        }]);
    };

    const updateRisk = (id, field, value) => {
        setRisks(risks.map(r => r.id === id ? { ...r, [field]: value } : r));
    };

    const _closeRisk = (id, rationale) => {
        setRisks(risks.map(r => r.id === id ? {
            ...r,
            status: 'closed',
            closedDate: new Date().toISOString(),
            closedRationale: rationale
        } : r));
    };

    const removeRisk = (id) => {
        setRisks(risks.filter(r => r.id !== id));
    };

    // Decision management
    const addDecision = () => {
        setDecisions([...decisions, {
            id: Date.now(),
            description: '',
            priority: 'medium',
            status: 'pending',
            decisionStatement: '',
            decisionDate: null
        }]);
    };

    const updateDecision = (id, field, value) => {
        setDecisions(decisions.map(d => d.id === id ? { ...d, [field]: value } : d));
    };

    const removeDecision = (id) => {
        setDecisions(decisions.filter(d => d.id !== id));
    };

    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isSubmitting) return;

        setIsSubmitting(true);
        try {
            const reportData = {
                createdBy: author,
                reportDate,
                overallStatus,
                purpose,
                executiveSummary,
                contacts,
                milestones,
                workstreams,
                risks,
                decisions,
                kpis,
                goodNews,
                governanceNotes
            };

            await addStatusReport(projectId, reportData);
            success('Status report created');
            onSave?.();
        } catch (error) {
            console.error("Failed to save report:", error);
            setIsSubmitting(false);
        }
    };

    // eslint-disable-next-line no-unused-vars
    const renderSectionHeader = (title, section, SectionIcon) => (
        <button
            type="button"
            className="section-accordion-header"
            onClick={() => toggleSection(section)}
        >
            <div className="section-header-left">
                <SectionIcon size={18} />
                <span>{title}</span>
            </div>
            {expandedSections[section] ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
    );

    return (
        <form onSubmit={handleSubmit} className="status-report-editor">
            {/* Header Section */}
            <div className="editor-section">
                {renderSectionHeader("Report Header", "header", FileText)}
                {expandedSections.header && (
                    <div className="section-content">
                        <div className="form-row-3">
                            <div className="form-group">
                                <label>Report Date *</label>
                                <input
                                    type="date"
                                    value={reportDate}
                                    onChange={(e) => setReportDate(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Prepared By *</label>
                                <input
                                    type="text"
                                    value={author}
                                    readOnly
                                    style={{ backgroundColor: '#f3f4f6', cursor: 'not-allowed' }}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Overall Status *</label>
                                <div className="status-selector">
                                    {['green', 'yellow', 'red'].map(status => (
                                        <button
                                            key={status}
                                            type="button"
                                            className={`status-btn ${status} ${overallStatus === status ? 'active' : ''}`}
                                            onClick={() => setOverallStatus(status)}
                                        >
                                            {status === 'green' ? 'On Track' : status === 'yellow' ? 'At Risk' : 'Off Track'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Purpose Section */}
            <div className="editor-section">
                {renderSectionHeader("Project Purpose", "purpose", Target)}
                {expandedSections.purpose && (
                    <div className="section-content">
                        <div className="form-group">
                            <label>Purpose Statement</label>
                            <textarea
                                value={purpose}
                                onChange={(e) => setPurpose(e.target.value)}
                                placeholder="Brief project purpose (3-4 lines max)..."
                                rows={3}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Executive Summary - Current State Section */}
            <div className="editor-section">
                {renderSectionHeader("Executive Summary - Current State", "executiveSummary", FileText)}
                {expandedSections.executiveSummary && (
                    <div className="section-content">
                        <div className="form-group">
                            <label>Current State Summary</label>
                            <textarea
                                value={executiveSummary}
                                onChange={(e) => setExecutiveSummary(e.target.value)}
                                placeholder="Summarize the current state of the project..."
                                rows={4}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Contacts Section */}
            <div className="editor-section">
                {renderSectionHeader("Key Contacts", "contacts", Users)}
                {expandedSections.contacts && (
                    <div className="section-content">
                        {contacts.map(contact => (
                            <div key={contact.id} className="contact-row">
                                <input
                                    type="text"
                                    value={contact.name}
                                    onChange={(e) => updateContact(contact.id, 'name', e.target.value)}
                                    placeholder="Name"
                                />
                                <input
                                    type="text"
                                    value={contact.organization}
                                    onChange={(e) => updateContact(contact.id, 'organization', e.target.value)}
                                    placeholder="Organization"
                                />
                                <button type="button" onClick={() => removeContact(contact.id)} className="btn-icon-danger">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                        <button type="button" onClick={addContact} className="btn-add-item">
                            <Plus size={16} /> Add Contact
                        </button>
                    </div>
                )}
            </div>

            {/* Milestones Section */}
            <div className="editor-section">
                {renderSectionHeader("Milestone Timeline", "milestones", Target)}
                {expandedSections.milestones && (
                    <div className="section-content">
                        {milestones.map(milestone => (
                            <div key={milestone.id} className="milestone-card">
                                <div className="milestone-header">
                                    <input
                                        type="text"
                                        value={milestone.name}
                                        onChange={(e) => updateMilestone(milestone.id, 'name', e.target.value)}
                                        placeholder="Milestone Name"
                                        className="milestone-name"
                                    />
                                    <input
                                        type="date"
                                        value={milestone.date}
                                        onChange={(e) => updateMilestone(milestone.id, 'date', e.target.value)}
                                        className="milestone-date"
                                    />
                                    <select
                                        value={milestone.status}
                                        onChange={(e) => updateMilestone(milestone.id, 'status', e.target.value)}
                                        className={`milestone-status ${milestone.status}`}
                                    >
                                        <option value="pending">⏳ Pending</option>
                                        <option value="in-progress">🔄 In Progress</option>
                                        <option value="complete">✅ Complete</option>
                                    </select>
                                    <button type="button" onClick={() => removeMilestone(milestone.id)} className="btn-icon-danger">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                        <button type="button" onClick={addMilestone} className="btn-add-item">
                            <Plus size={16} /> Add Milestone
                        </button>
                    </div>
                )}
            </div>

            {/* Workstreams Section */}
            <div className="editor-section">
                {renderSectionHeader("Workstream Status", "workstreams", CheckCircle)}
                {expandedSections.workstreams && (
                    <div className="section-content">
                        {workstreams.map(ws => (
                            <div key={ws.id} className="workstream-card">
                                <div className="workstream-header">
                                    <input
                                        type="text"
                                        value={ws.name}
                                        onChange={(e) => updateWorkstream(ws.id, 'name', e.target.value)}
                                        placeholder="Workstream Name"
                                        className="workstream-name"
                                    />
                                    <select
                                        value={ws.status}
                                        onChange={(e) => updateWorkstream(ws.id, 'status', e.target.value)}
                                        className={`workstream-status ${ws.status}`}
                                    >
                                        <option value="green">🟢 On Track</option>
                                        <option value="yellow">🟡 At Risk</option>
                                        <option value="red">🔴 Off Track</option>
                                    </select>
                                    <button type="button" onClick={() => removeWorkstream(ws.id)} className="btn-icon-danger">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                                <div className="workstream-fields">
                                    <div className="form-group">
                                        <label>Progress Last Period</label>
                                        <textarea
                                            value={ws.progressLastPeriod}
                                            onChange={(e) => updateWorkstream(ws.id, 'progressLastPeriod', e.target.value)}
                                            rows={2}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Work Ahead</label>
                                        <textarea
                                            value={ws.workAhead}
                                            onChange={(e) => updateWorkstream(ws.id, 'workAhead', e.target.value)}
                                            rows={2}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Barriers</label>
                                        <textarea
                                            value={ws.barriers}
                                            onChange={(e) => updateWorkstream(ws.id, 'barriers', e.target.value)}
                                            rows={2}
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                        <button type="button" onClick={addWorkstream} className="btn-add-item">
                            <Plus size={16} /> Add Workstream
                        </button>
                    </div>
                )}
            </div>

            {/* Risks Section */}
            <div className="editor-section">
                {renderSectionHeader("Risk Register", "risks", AlertTriangle)}
                {expandedSections.risks && (
                    <div className="section-content">
                        {risks.map(risk => (
                            <div key={risk.id} className={`risk-card ${risk.status}`}>
                                <div className="risk-header">
                                    <select
                                        value={risk.priority}
                                        onChange={(e) => updateRisk(risk.id, 'priority', e.target.value)}
                                        className={`priority-select ${risk.priority}`}
                                    >
                                        <option value="high">High</option>
                                        <option value="medium">Medium</option>
                                        <option value="low">Low</option>
                                    </select>
                                    <select
                                        value={risk.status}
                                        onChange={(e) => updateRisk(risk.id, 'status', e.target.value)}
                                    >
                                        <option value="open">Open</option>
                                        <option value="closed">Closed</option>
                                    </select>
                                    <button type="button" onClick={() => removeRisk(risk.id)} className="btn-icon-danger">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                                <div className="form-group">
                                    <label>Risk Description</label>
                                    <textarea
                                        value={risk.description}
                                        onChange={(e) => updateRisk(risk.id, 'description', e.target.value)}
                                        rows={2}
                                    />
                                </div>
                                <div className="form-row-2">
                                    <div className="form-group">
                                        <label>Impact</label>
                                        <textarea
                                            value={risk.impact}
                                            onChange={(e) => updateRisk(risk.id, 'impact', e.target.value)}
                                            rows={2}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Mitigation</label>
                                        <textarea
                                            value={risk.mitigation}
                                            onChange={(e) => updateRisk(risk.id, 'mitigation', e.target.value)}
                                            rows={2}
                                        />
                                    </div>
                                </div>
                                {risk.status === 'closed' && (
                                    <div className="form-group">
                                        <label>Closure Rationale</label>
                                        <input
                                            type="text"
                                            value={risk.closedRationale || ''}
                                            onChange={(e) => updateRisk(risk.id, 'closedRationale', e.target.value)}
                                        />
                                    </div>
                                )}
                            </div>
                        ))}
                        <button type="button" onClick={addRisk} className="btn-add-item">
                            <Plus size={16} /> Add Risk
                        </button>
                    </div>
                )}
            </div>

            {/* Decisions Section */}
            <div className="editor-section">
                {renderSectionHeader("Decision Log", "decisions", CheckCircle)}
                {expandedSections.decisions && (
                    <div className="section-content">
                        {decisions.map(decision => (
                            <div key={decision.id} className={`decision-card ${decision.status}`}>
                                <div className="decision-header">
                                    <select
                                        value={decision.priority}
                                        onChange={(e) => updateDecision(decision.id, 'priority', e.target.value)}
                                        className={`priority-select ${decision.priority}`}
                                    >
                                        <option value="high">High</option>
                                        <option value="medium">Medium</option>
                                        <option value="low">Low</option>
                                    </select>
                                    <select
                                        value={decision.status}
                                        onChange={(e) => updateDecision(decision.id, 'status', e.target.value)}
                                    >
                                        <option value="pending">Pending</option>
                                        <option value="approved">Approved</option>
                                        <option value="rejected">Rejected</option>
                                    </select>
                                    <button type="button" onClick={() => removeDecision(decision.id)} className="btn-icon-danger">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                                <div className="form-group">
                                    <label>Decision Description</label>
                                    <textarea
                                        value={decision.description}
                                        onChange={(e) => updateDecision(decision.id, 'description', e.target.value)}
                                        rows={2}
                                    />
                                </div>
                                {decision.status !== 'pending' && (
                                    <div className="form-row-2">
                                        <div className="form-group">
                                            <label>Decision Statement</label>
                                            <textarea
                                                value={decision.decisionStatement}
                                                onChange={(e) => updateDecision(decision.id, 'decisionStatement', e.target.value)}
                                                rows={2}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Decision Date</label>
                                            <input
                                                type="date"
                                                value={decision.decisionDate || ''}
                                                onChange={(e) => updateDecision(decision.id, 'decisionDate', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                        <button type="button" onClick={addDecision} className="btn-add-item">
                            <Plus size={16} /> Add Decision
                        </button>
                    </div>
                )}
            </div>

            {/* Freeform Sections */}
            <div className="editor-section">
                {renderSectionHeader("Additional Sections", "freeform", FileText)}
                {expandedSections.freeform && (
                    <div className="section-content">
                        <div className="form-group">
                            <label>KPIs / Stats</label>
                            <textarea
                                value={kpis}
                                onChange={(e) => setKpis(e.target.value)}
                                placeholder="Budget utilization, milestone completion rates, etc."
                                rows={3}
                            />
                        </div>
                        <div className="form-group">
                            <label>Good News Stories</label>
                            <textarea
                                value={goodNews}
                                onChange={(e) => setGoodNews(e.target.value)}
                                placeholder="Positive updates, wins, team achievements..."
                                rows={3}
                            />
                        </div>
                        <div className="form-group">
                            <label>Notes to Governance</label>
                            <textarea
                                value={governanceNotes}
                                onChange={(e) => setGovernanceNotes(e.target.value)}
                                placeholder="Items requiring board attention, escalations..."
                                rows={3}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Actions */}
            <div className="editor-actions">
                <button type="button" onClick={onCancel} className="btn-secondary" disabled={isSubmitting}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={!author || !reportDate || isSubmitting}>
                    {isSubmitting ? 'Saving...' : `Create Version ${previousReport ? previousReport.version + 1 : 1}`}
                </button>
            </div>
        </form>
    );
}

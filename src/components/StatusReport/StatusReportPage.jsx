import { useState, useEffect, useCallback } from 'react';
import { Plus, FileText, History, Eye, RefreshCw } from 'lucide-react';
import { useData } from '../../context/DataContext';

import { Modal } from '../UI/Modal';
import { StatusReportEditor } from './StatusReportEditor';
import { StatusReportView } from './StatusReportView';
import { StatusReportHistory } from './StatusReportHistory';
import { StatusReportCompare } from './StatusReportCompare';
import './StatusReport.css';

import { API_BASE } from '../../apiClient';

export function StatusReportPage({ project, onClose: _onClose }) {
    const { authFetch } = useData();
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('current'); // 'current', 'history', 'edit'
    const [viewingReport, setViewingReport] = useState(null);
    const [comparingReports, setComparingReports] = useState(null);

    // Fetch reports on mount
    const fetchReports = useCallback(async () => {
        // console.log("StatusReportPage: Fetching reports for project", project.id);
        setLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/projects/${project.id}/reports`);
            if (res.ok) {
                const data = await res.json();
                // console.log("StatusReportPage: Fetched reports:", data);
                setReports(data);
            } else {
                console.error("StatusReportPage: Fetch failed status:", res.status);
            }
        } catch (err) {
            console.error("Failed to load reports:", err);
        } finally {
            setLoading(false);
        }
    }, [project.id, authFetch]);

    useEffect(() => {
        fetchReports();
    }, [fetchReports]);

    const latestReport = reports.length > 0 ? reports[0] : null; // API returns sorted DESC
    useEffect(() => {
        // console.log("StatusReportPage: latestReport:", latestReport);
    }, [latestReport]);

    const handleViewReport = (report) => {
        setViewingReport(report);
        setActiveTab('view');
    };

    const handleCompare = (report1, report2) => {
        // Ensure older version is first
        const sorted = [report1, report2].sort((a, b) => a.version - b.version);
        setComparingReports(sorted);
        setActiveTab('compare');
    };

    const handleCreateNew = () => {
        setActiveTab('edit');
    };

    const handleSaveComplete = () => {
        fetchReports();
        setActiveTab('current');
        setViewingReport(null);
    };

    return (
        <div className="status-report-page">
            {/* Tabs with New Report button */}
            <div className="report-tabs">
                <button
                    className={`report-tab ${activeTab === 'current' ? 'active' : ''}`}
                    onClick={() => { setActiveTab('current'); setViewingReport(null); }}
                >
                    <Eye size={16} /> Current
                </button>
                <button
                    className={`report-tab ${activeTab === 'history' ? 'active' : ''}`}
                    onClick={() => setActiveTab('history')}
                >
                    <History size={16} /> History ({reports.length})
                </button>
                <button className="btn-primary btn-new-report" onClick={handleCreateNew}>
                    <Plus size={16} /> New Report
                </button>
            </div>

            {loading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <RefreshCw className="spin" size={24} /> Loading reports...
                </div>
            ) : (
                /* Content Area - Scrollable */
                <div className="report-content-area">
                    {activeTab === 'current' && (
                        <>
                            {latestReport ? (
                                <StatusReportView
                                    report={latestReport}
                                    projectTitle={project.title}
                                />
                            ) : (
                                <div className="empty-reports">
                                    <FileText size={48} />
                                    <p>No status reports yet. Create your first report to establish a governance baseline.</p>
                                    <button className="btn-primary" onClick={handleCreateNew}>
                                        <Plus size={16} /> Create First Report
                                    </button>
                                </div>
                            )}
                        </>
                    )}

                    {activeTab === 'history' && (
                        <StatusReportHistory
                            projectId={project.id}
                            reports={reports}
                            onViewReport={handleViewReport}
                            onCompare={handleCompare}
                        />
                    )}

                    {activeTab === 'view' && viewingReport && (
                        <StatusReportView
                            report={viewingReport}
                            projectTitle={project.title}
                        />
                    )}

                    {activeTab === 'compare' && comparingReports && (
                        <StatusReportCompare
                            report1={comparingReports[0]}
                            report2={comparingReports[1]}
                            projectTitle={project.title}
                            onClose={() => setActiveTab('history')}
                        />
                    )}
                </div>
            )}
            {activeTab === 'edit' && (
                <Modal
                    isOpen={true}
                    onClose={() => setActiveTab(latestReport ? 'current' : 'current')}
                    title={`Create Status Report v${reports.length + 1}`}
                    size="xl"
                    closeOnOverlayClick={false}
                >
                    <StatusReportEditor
                        projectId={project.id}
                        projectTitle={project.title}
                        previousReport={latestReport}
                        onSave={handleSaveComplete}
                        onCancel={() => setActiveTab(latestReport ? 'current' : 'current')}
                    />
                </Modal>
            )}
        </div>
    );
}


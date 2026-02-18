import { useState, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import { ReportFilterTree } from './ReportFilterTree';
import { ReportPreview } from './ReportPreview';
import './Reports.css';

export function ReportsView() {
    const { fetchExecSummaryProjects } = useData();
    const [selectedProjectIds, setSelectedProjectIds] = useState([]);
    const [allProjects, setAllProjects] = useState([]);

    // Fetch full project list once on mount
    useEffect(() => {
        let isMounted = true;
        fetchExecSummaryProjects().then(data => {
            if (isMounted && data && Array.isArray(data)) {
                setAllProjects(data);
            }
        });
        return () => { isMounted = false; };
    }, [fetchExecSummaryProjects]);

    return (
        <div className="reports-container">
            <div className="report-sidebar">
                <div className="report-sidebar-header">
                    <h3>Select Projects</h3>
                </div>
                <div className="report-tree-content">
                    <ReportFilterTree
                        onSelectionChange={setSelectedProjectIds}
                        allProjects={allProjects}
                    />
                </div>
            </div>

            <ReportPreview
                selectedProjectIds={selectedProjectIds}
                allProjects={allProjects}
            />
        </div>
    );
}

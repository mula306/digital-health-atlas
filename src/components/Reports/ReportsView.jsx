import { useState } from 'react';
import { ReportFilterTree } from './ReportFilterTree';
import { ReportPreview } from './ReportPreview';
import './Reports.css';

export function ReportsView() {
    const [selectedProjectIds, setSelectedProjectIds] = useState([]);

    return (
        <div className="reports-container">
            <div className="report-sidebar">
                <div className="report-sidebar-header">
                    <h3>Select Projects</h3>
                </div>
                <div className="report-tree-content">
                    <ReportFilterTree onSelectionChange={setSelectedProjectIds} />
                </div>
            </div>

            <ReportPreview selectedProjectIds={selectedProjectIds} />
        </div>
    );
}

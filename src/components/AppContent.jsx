import { useState, useEffect, Suspense, lazy } from 'react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { Layout } from './Layout/Layout';
import { ToastContainer } from './UI/Toast';
import KanbanView from './Kanban/KanbanView';

// Lazy load heavy components
const GoalView = lazy(() => import('./Goals/GoalView').then(module => ({ default: module.GoalView })));
// KanbanView is now static
const Dashboard = lazy(() => import('./Dashboard/Dashboard').then(module => ({ default: module.Dashboard })));
const ExecDashboard = lazy(() => import('./Dashboard/ExecDashboard').then(module => ({ default: module.ExecDashboard })));
const ReportsView = lazy(() => import('./Reports/ReportsView').then(module => ({ default: module.ReportsView })));
const IntakePage = lazy(() => import('./Intake/IntakePage').then(module => ({ default: module.IntakePage })));
const IntakeFormView = lazy(() => import('./Intake/IntakeFormView').then(module => ({ default: module.IntakeFormView })));
const MetricsPage = lazy(() => import('./Metrics/MetricsPage').then(module => ({ default: module.MetricsPage })));
const AdminPanel = lazy(() => import('./Admin/AdminPanel').then(module => ({ default: module.AdminPanel })));

const LoadingSpinner = () => (
    <div className="flex h-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
    </div>
);

export function AppContent() {
    // Initialize from localStorage or default
    const [currentView, setCurrentView] = useState(() => localStorage.getItem('dha_current_view') || 'exec-dashboard');
    const [projectFilter, setProjectFilter] = useState(null);
    const [metricsFilter, setMetricsFilter] = useState(null);
    const [intakeParams, setIntakeParams] = useState(null);
    const { hasPermission, error } = useData();
    const toast = useToast();

    // Show global data errors
    useEffect(() => {
        if (error) {
            toast.error(error);
        }
    }, [error, toast]);

    // Handle hash-based routing for public intake forms
    useEffect(() => {
        const handleHashChange = () => {
            const hash = window.location.hash;
            if (hash.startsWith('#/intake/')) {
                const parts = hash.replace('#/intake/', '').split('?');
                const formId = parts[0];
                const params = new URLSearchParams(parts[1] || '');
                setIntakeParams({
                    formId,
                    submissionId: params.get('sub'),
                    requestId: params.get('req')
                });
                setCurrentView('public-intake');
            }
        };

        handleHashChange();
        window.addEventListener('hashchange', handleHashChange);
        return () => window.removeEventListener('hashchange', handleHashChange);
    }, []);

    const navigateToProjectsWithGoalFilter = (goalId) => {
        // Reset selected project when filtering by goal
        localStorage.removeItem('dha_selected_project_id');
        setProjectFilter(goalId);
        localStorage.setItem('dha_current_view', 'projects');
        setCurrentView('projects');
    };

    const navigateToMetricsWithGoalFilter = (goalId) => {
        setMetricsFilter(goalId);
        localStorage.setItem('dha_current_view', 'metrics');
        setCurrentView('metrics');
    };

    const handleViewChange = (view) => {
        if (view !== 'projects') {
            setProjectFilter(null);
        }
        if (view !== 'metrics') {
            setMetricsFilter(null);
        }
        // Reset selected project on main navigation changes
        // This ensures clicking "Projects" in sidebar always goes to the list
        localStorage.removeItem('dha_selected_project_id');

        // Clear hash when navigating away from public intake
        if (window.location.hash.startsWith('#/intake/')) {
            window.location.hash = '';
        }
        localStorage.setItem('dha_current_view', view);
        setCurrentView(view);
    };

    const renderView = () => {
        return (
            <Suspense fallback={<LoadingSpinner />}>
                {(() => {
                    switch (currentView) {
                        case 'dashboard':
                            return hasPermission('can_view_dashboard') ?
                                <Dashboard /> :
                                <div className="p-4">Access Denied</div>;
                        case 'exec-dashboard':
                            return hasPermission('can_view_exec_dashboard') ?
                                <ExecDashboard /> :
                                <div className="p-4">Access Denied</div>;
                        case 'goals':
                            return hasPermission('can_view_goals') ?
                                <GoalView
                                    onNavigateToProjects={navigateToProjectsWithGoalFilter}
                                    onNavigateToMetrics={navigateToMetricsWithGoalFilter}
                                /> :
                                <div className="p-4">Access Denied</div>;
                        case 'projects':
                            return hasPermission('can_view_projects') ? (
                                <KanbanView
                                    initialGoalFilter={projectFilter}
                                    onClearFilter={() => setProjectFilter(null)}
                                />
                            ) : <div className="p-4">Access Denied</div>;
                        case 'reports':
                            return hasPermission('can_view_reports') ?
                                <ReportsView /> :
                                <div className="p-4">Access Denied</div>;
                        case 'metrics':
                            return hasPermission('can_view_metrics') ?
                                <MetricsPage
                                    initialGoalFilter={metricsFilter}
                                    onClearFilter={() => setMetricsFilter(null)}
                                /> :
                                <div className="p-4">Access Denied</div>;
                        case 'intake':
                            return hasPermission('can_view_intake') ?
                                <IntakePage /> :
                                <div className="p-4">Access Denied</div>;
                        case 'admin':
                            return (hasPermission('can_manage_users') || hasPermission('can_manage_tags') || hasPermission('can_view_audit_log')) ?
                                <AdminPanel /> :
                                <div className="p-4">Access Denied</div>;
                        case 'public-intake':
                            return intakeParams ? (
                                <IntakeFormView
                                    formId={intakeParams.formId}
                                    submissionId={intakeParams.submissionId}
                                    requestId={intakeParams.requestId}
                                />
                            ) : null;
                        default:
                            return <Dashboard />;
                    }
                })()}
            </Suspense>
        );
    };

    // For public intake view, don't show the layout
    if (currentView === 'public-intake') {
        return (
            <>
                {renderView()}
                <ToastContainer />
            </>
        );
    }

    return (
        <>
            <Layout currentView={currentView} onViewChange={handleViewChange}>
                {renderView()}
            </Layout>
            <ToastContainer />
        </>
    );
}

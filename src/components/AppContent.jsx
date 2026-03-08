import { useState, useEffect, useMemo, useCallback, Suspense, lazy } from 'react';
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
const MyWorkPage = lazy(() => import('./MyWork/MyWorkPage').then(module => ({ default: module.MyWorkPage })));

const VIEW_QUERY_KEY = 'view';
const INTAKE_STAGE_QUERY_KEY = 'stage';
const ADMIN_TAB_QUERY_KEY = 'adminTab';
const ADMIN_GOVERNANCE_TAB_QUERY_KEY = 'adminStep';
const ADMIN_ORG_SECTION_QUERY_KEY = 'orgSection';
const ADMIN_ORG_SHARING_TAB_QUERY_KEY = 'orgShare';
const DEFAULT_VIEW = 'my-work';
const DEFAULT_INTAKE_STAGE = 'my-requests';
const INTAKE_STAGE_STORAGE_KEY = 'dha_intake_stage';
const INTAKE_STAGES = new Set(['my-requests', 'submit', 'triage', 'governance', 'resolution', 'form-admin']);
const DEFAULT_ADMIN_TAB = 'permissions';
const DEFAULT_ADMIN_GOVERNANCE_TAB = 'settings';
const DEFAULT_ADMIN_ORG_SECTION = 'orgs';
const DEFAULT_ADMIN_ORG_SHARING_TAB = 'projects';
const ADMIN_TAB_STORAGE_KEY = 'dha_admin_tab';
const ADMIN_GOVERNANCE_TAB_STORAGE_KEY = 'dha_admin_governance_tab';
const ADMIN_ORG_SECTION_STORAGE_KEY = 'dha_admin_org_section';
const ADMIN_ORG_SHARING_TAB_STORAGE_KEY = 'dha_admin_org_sharing_tab';
const ADMIN_TABS = new Set(['permissions', 'tags', 'audit-log', 'governance', 'organizations']);
const ADMIN_GOVERNANCE_TABS = new Set(['settings', 'boards', 'members', 'criteria']);
const ADMIN_ORG_SECTIONS = new Set(['orgs', 'members', 'sharing']);
const ADMIN_ORG_SHARING_TABS = new Set(['projects', 'goals']);
const NAVIGABLE_VIEWS = new Set([
    'my-work',
    'dashboard',
    'exec-dashboard',
    'goals',
    'projects',
    'reports',
    'metrics',
    'intake',
    'admin'
]);

const LoadingSpinner = () => (
    <div className="flex h-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderBottomColor: 'var(--accent-primary)' }}></div>
    </div>
);

const getRequestedViewFromLocation = () => {
    if (typeof window === 'undefined') return DEFAULT_VIEW;
    const fromUrl = new URLSearchParams(window.location.search).get(VIEW_QUERY_KEY);
    if (fromUrl && NAVIGABLE_VIEWS.has(fromUrl)) {
        return fromUrl;
    }

    const stored = localStorage.getItem('dha_current_view');
    if (stored && NAVIGABLE_VIEWS.has(stored)) {
        return stored;
    }
    return DEFAULT_VIEW;
};

const getRequestedIntakeStageFromLocation = () => {
    if (typeof window === 'undefined') return DEFAULT_INTAKE_STAGE;
    const fromUrl = new URLSearchParams(window.location.search).get(INTAKE_STAGE_QUERY_KEY);
    if (fromUrl && INTAKE_STAGES.has(fromUrl)) {
        return fromUrl;
    }

    const stored = localStorage.getItem(INTAKE_STAGE_STORAGE_KEY);
    if (stored && INTAKE_STAGES.has(stored)) {
        return stored;
    }
    return DEFAULT_INTAKE_STAGE;
};

const getRequestedAdminTabFromLocation = () => {
    if (typeof window === 'undefined') return DEFAULT_ADMIN_TAB;
    const fromUrl = new URLSearchParams(window.location.search).get(ADMIN_TAB_QUERY_KEY);
    if (fromUrl && ADMIN_TABS.has(fromUrl)) {
        return fromUrl;
    }

    const stored = localStorage.getItem(ADMIN_TAB_STORAGE_KEY);
    if (stored && ADMIN_TABS.has(stored)) {
        return stored;
    }
    return DEFAULT_ADMIN_TAB;
};

const getRequestedAdminGovernanceTabFromLocation = () => {
    if (typeof window === 'undefined') return DEFAULT_ADMIN_GOVERNANCE_TAB;
    const fromUrl = new URLSearchParams(window.location.search).get(ADMIN_GOVERNANCE_TAB_QUERY_KEY);
    if (fromUrl && ADMIN_GOVERNANCE_TABS.has(fromUrl)) {
        return fromUrl;
    }

    const stored = localStorage.getItem(ADMIN_GOVERNANCE_TAB_STORAGE_KEY);
    if (stored && ADMIN_GOVERNANCE_TABS.has(stored)) {
        return stored;
    }
    return DEFAULT_ADMIN_GOVERNANCE_TAB;
};

const getRequestedAdminOrgSectionFromLocation = () => {
    if (typeof window === 'undefined') return DEFAULT_ADMIN_ORG_SECTION;
    const fromUrl = new URLSearchParams(window.location.search).get(ADMIN_ORG_SECTION_QUERY_KEY);
    if (fromUrl && ADMIN_ORG_SECTIONS.has(fromUrl)) {
        return fromUrl;
    }

    const stored = localStorage.getItem(ADMIN_ORG_SECTION_STORAGE_KEY);
    if (stored && ADMIN_ORG_SECTIONS.has(stored)) {
        return stored;
    }
    return DEFAULT_ADMIN_ORG_SECTION;
};

const getRequestedAdminOrgSharingTabFromLocation = () => {
    if (typeof window === 'undefined') return DEFAULT_ADMIN_ORG_SHARING_TAB;
    const fromUrl = new URLSearchParams(window.location.search).get(ADMIN_ORG_SHARING_TAB_QUERY_KEY);
    if (fromUrl && ADMIN_ORG_SHARING_TABS.has(fromUrl)) {
        return fromUrl;
    }

    const stored = localStorage.getItem(ADMIN_ORG_SHARING_TAB_STORAGE_KEY);
    if (stored && ADMIN_ORG_SHARING_TABS.has(stored)) {
        return stored;
    }
    return DEFAULT_ADMIN_ORG_SHARING_TAB;
};

const updateBrowserView = (
    view,
    {
        replace = false,
        intakeStage = DEFAULT_INTAKE_STAGE,
        adminTab = DEFAULT_ADMIN_TAB,
        adminGovernanceTab = DEFAULT_ADMIN_GOVERNANCE_TAB,
        adminOrgSection = DEFAULT_ADMIN_ORG_SECTION,
        adminOrgSharingTab = DEFAULT_ADMIN_ORG_SHARING_TAB
    } = {}
) => {
    if (typeof window === 'undefined' || view === 'public-intake') return;

    const url = new URL(window.location.href);
    if (view && NAVIGABLE_VIEWS.has(view)) {
        url.searchParams.set(VIEW_QUERY_KEY, view);
    } else {
        url.searchParams.delete(VIEW_QUERY_KEY);
    }
    if (view === 'intake' && intakeStage && INTAKE_STAGES.has(intakeStage)) {
        url.searchParams.set(INTAKE_STAGE_QUERY_KEY, intakeStage);
    } else {
        url.searchParams.delete(INTAKE_STAGE_QUERY_KEY);
    }
    if (view === 'admin' && adminTab && ADMIN_TABS.has(adminTab)) {
        url.searchParams.set(ADMIN_TAB_QUERY_KEY, adminTab);
        if (adminTab === 'governance' && adminGovernanceTab && ADMIN_GOVERNANCE_TABS.has(adminGovernanceTab)) {
            url.searchParams.set(ADMIN_GOVERNANCE_TAB_QUERY_KEY, adminGovernanceTab);
        } else {
            url.searchParams.delete(ADMIN_GOVERNANCE_TAB_QUERY_KEY);
        }

        if (adminTab === 'organizations' && adminOrgSection && ADMIN_ORG_SECTIONS.has(adminOrgSection)) {
            url.searchParams.set(ADMIN_ORG_SECTION_QUERY_KEY, adminOrgSection);
            if (adminOrgSection === 'sharing' && adminOrgSharingTab && ADMIN_ORG_SHARING_TABS.has(adminOrgSharingTab)) {
                url.searchParams.set(ADMIN_ORG_SHARING_TAB_QUERY_KEY, adminOrgSharingTab);
            } else {
                url.searchParams.delete(ADMIN_ORG_SHARING_TAB_QUERY_KEY);
            }
        } else {
            url.searchParams.delete(ADMIN_ORG_SECTION_QUERY_KEY);
            url.searchParams.delete(ADMIN_ORG_SHARING_TAB_QUERY_KEY);
        }
    } else {
        url.searchParams.delete(ADMIN_TAB_QUERY_KEY);
        url.searchParams.delete(ADMIN_GOVERNANCE_TAB_QUERY_KEY);
        url.searchParams.delete(ADMIN_ORG_SECTION_QUERY_KEY);
        url.searchParams.delete(ADMIN_ORG_SHARING_TAB_QUERY_KEY);
    }

    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next === current) return;

    if (replace) {
        window.history.replaceState({}, '', next);
    } else {
        window.history.pushState({}, '', next);
    }
};

export function AppContent() {
    const [currentView, setCurrentView] = useState(() => getRequestedViewFromLocation());
    const [intakeStage, setIntakeStage] = useState(() => getRequestedIntakeStageFromLocation());
    const [adminTab, setAdminTab] = useState(() => getRequestedAdminTabFromLocation());
    const [adminGovernanceTab, setAdminGovernanceTab] = useState(() => getRequestedAdminGovernanceTabFromLocation());
    const [adminOrgSection, setAdminOrgSection] = useState(() => getRequestedAdminOrgSectionFromLocation());
    const [adminOrgSharingTab, setAdminOrgSharingTab] = useState(() => getRequestedAdminOrgSharingTabFromLocation());
    const [projectFilter, setProjectFilter] = useState(null);
    const [metricsFilter, setMetricsFilter] = useState(null);
    const [intakeParams, setIntakeParams] = useState(null);
    const { hasPermission, error } = useData();
    const toast = useToast();
    const canAccessIntakeWorkspace =
        hasPermission('can_view_intake') ||
        hasPermission('can_manage_intake') ||
        hasPermission('can_manage_intake_forms') ||
        hasPermission('can_view_incoming_requests') ||
        hasPermission('can_view_governance_queue');
    const canAccessAdminPanel =
        hasPermission('can_manage_role_permissions') ||
        hasPermission('can_view_audit_log') ||
        hasPermission('can_manage_tags') ||
        hasPermission('can_manage_governance') ||
        hasPermission('can_manage_organizations') ||
        hasPermission('can_manage_sharing_requests');
    const accessibleViews = useMemo(() => {
        const views = ['my-work'];
        if (hasPermission('can_view_exec_dashboard')) views.push('exec-dashboard');
        if (hasPermission('can_view_goals')) views.push('goals');
        if (hasPermission('can_view_metrics')) views.push('metrics');
        if (hasPermission('can_view_dashboard')) views.push('dashboard');
        if (hasPermission('can_view_projects')) views.push('projects');
        if (hasPermission('can_view_reports')) views.push('reports');
        if (canAccessIntakeWorkspace) views.push('intake');
        if (canAccessAdminPanel) views.push('admin');
        return views;
    }, [canAccessAdminPanel, canAccessIntakeWorkspace, hasPermission]);
    const resolvedCurrentView = useMemo(() => {
        if (currentView === 'public-intake') return currentView;
        if (accessibleViews.includes(currentView)) return currentView;
        return accessibleViews[0] || DEFAULT_VIEW;
    }, [accessibleViews, currentView]);

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
                return;
            }

            setIntakeParams(null);
            setCurrentView(prev => (prev === 'public-intake' ? getRequestedViewFromLocation() : prev));
            setIntakeStage(getRequestedIntakeStageFromLocation());
            setAdminTab(getRequestedAdminTabFromLocation());
            setAdminGovernanceTab(getRequestedAdminGovernanceTabFromLocation());
            setAdminOrgSection(getRequestedAdminOrgSectionFromLocation());
            setAdminOrgSharingTab(getRequestedAdminOrgSharingTabFromLocation());
        };

        handleHashChange();
        window.addEventListener('hashchange', handleHashChange);
        return () => window.removeEventListener('hashchange', handleHashChange);
    }, []);

    useEffect(() => {
        const handlePopState = () => {
            if (window.location.hash.startsWith('#/intake/')) return;
            const nextView = getRequestedViewFromLocation();
            const nextIntakeStage = getRequestedIntakeStageFromLocation();
            const nextAdminTab = getRequestedAdminTabFromLocation();
            const nextAdminGovernanceTab = getRequestedAdminGovernanceTabFromLocation();
            const nextAdminOrgSection = getRequestedAdminOrgSectionFromLocation();
            const nextAdminOrgSharingTab = getRequestedAdminOrgSharingTabFromLocation();
            setCurrentView(nextView);
            setIntakeStage(nextIntakeStage);
            setAdminTab(nextAdminTab);
            setAdminGovernanceTab(nextAdminGovernanceTab);
            setAdminOrgSection(nextAdminOrgSection);
            setAdminOrgSharingTab(nextAdminOrgSharingTab);
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    useEffect(() => {
        if (resolvedCurrentView === 'public-intake') return;
        localStorage.setItem('dha_current_view', resolvedCurrentView);
        localStorage.setItem(INTAKE_STAGE_STORAGE_KEY, intakeStage);
        localStorage.setItem(ADMIN_TAB_STORAGE_KEY, adminTab);
        localStorage.setItem(ADMIN_GOVERNANCE_TAB_STORAGE_KEY, adminGovernanceTab);
        localStorage.setItem(ADMIN_ORG_SECTION_STORAGE_KEY, adminOrgSection);
        localStorage.setItem(ADMIN_ORG_SHARING_TAB_STORAGE_KEY, adminOrgSharingTab);
        const currentUrlView = new URLSearchParams(window.location.search).get(VIEW_QUERY_KEY);
        const currentUrlStage = new URLSearchParams(window.location.search).get(INTAKE_STAGE_QUERY_KEY);
        const currentUrlAdminTab = new URLSearchParams(window.location.search).get(ADMIN_TAB_QUERY_KEY);
        const currentUrlAdminGovernanceTab = new URLSearchParams(window.location.search).get(ADMIN_GOVERNANCE_TAB_QUERY_KEY);
        const currentUrlAdminOrgSection = new URLSearchParams(window.location.search).get(ADMIN_ORG_SECTION_QUERY_KEY);
        const currentUrlAdminOrgSharingTab = new URLSearchParams(window.location.search).get(ADMIN_ORG_SHARING_TAB_QUERY_KEY);
        const expectedStage = resolvedCurrentView === 'intake' ? intakeStage : null;
        const expectedAdminTab = resolvedCurrentView === 'admin' ? adminTab : null;
        const expectedAdminGovernanceTab = resolvedCurrentView === 'admin' && adminTab === 'governance' ? adminGovernanceTab : null;
        const expectedAdminOrgSection = resolvedCurrentView === 'admin' && adminTab === 'organizations' ? adminOrgSection : null;
        const expectedAdminOrgSharingTab = resolvedCurrentView === 'admin' && adminTab === 'organizations' && adminOrgSection === 'sharing'
            ? adminOrgSharingTab
            : null;
        if (
            currentUrlView !== resolvedCurrentView ||
            (expectedStage || '') !== (currentUrlStage || '') ||
            (expectedAdminTab || '') !== (currentUrlAdminTab || '') ||
            (expectedAdminGovernanceTab || '') !== (currentUrlAdminGovernanceTab || '') ||
            (expectedAdminOrgSection || '') !== (currentUrlAdminOrgSection || '') ||
            (expectedAdminOrgSharingTab || '') !== (currentUrlAdminOrgSharingTab || '')
        ) {
            updateBrowserView(resolvedCurrentView, {
                replace: true,
                intakeStage,
                adminTab,
                adminGovernanceTab,
                adminOrgSection,
                adminOrgSharingTab
            });
        }
    }, [resolvedCurrentView, intakeStage, adminTab, adminGovernanceTab, adminOrgSection, adminOrgSharingTab]);

    const handleViewChange = useCallback((view, options = {}) => {
        const preserveSelectedProject = options?.preserveSelectedProject === true;
        const selectedProjectId = options?.selectedProjectId ? String(options.selectedProjectId) : null;
        const replaceHistory = options?.replaceHistory === true;
        const stageOption = options?.stage;
        const adminTabOption = options?.adminTab;
        const adminGovernanceTabOption = options?.adminStep;
        const adminOrgSectionOption = options?.orgSection;
        const adminOrgSharingTabOption = options?.orgShareTab;
        const nextIntakeStage = INTAKE_STAGES.has(String(stageOption || ''))
            ? String(stageOption)
            : intakeStage;
        const nextAdminTab = ADMIN_TABS.has(String(adminTabOption || ''))
            ? String(adminTabOption)
            : adminTab;
        const nextAdminGovernanceTab = ADMIN_GOVERNANCE_TABS.has(String(adminGovernanceTabOption || ''))
            ? String(adminGovernanceTabOption)
            : adminGovernanceTab;
        const nextAdminOrgSection = ADMIN_ORG_SECTIONS.has(String(adminOrgSectionOption || ''))
            ? String(adminOrgSectionOption)
            : adminOrgSection;
        const nextAdminOrgSharingTab = ADMIN_ORG_SHARING_TABS.has(String(adminOrgSharingTabOption || ''))
            ? String(adminOrgSharingTabOption)
            : adminOrgSharingTab;

        if (view !== 'projects') {
            setProjectFilter(null);
        }
        if (view !== 'metrics') {
            setMetricsFilter(null);
        }
        if (preserveSelectedProject && selectedProjectId) {
            localStorage.setItem('dha_selected_project_id', selectedProjectId);
        } else {
            localStorage.removeItem('dha_selected_project_id');
        }

        if (window.location.hash.startsWith('#/intake/')) {
            window.location.hash = '';
        }

        localStorage.setItem('dha_current_view', view);
        if (view === 'intake') {
            setIntakeStage(nextIntakeStage);
            localStorage.setItem(INTAKE_STAGE_STORAGE_KEY, nextIntakeStage);
        }
        if (view === 'admin') {
            setAdminTab(nextAdminTab);
            setAdminGovernanceTab(nextAdminGovernanceTab);
            setAdminOrgSection(nextAdminOrgSection);
            setAdminOrgSharingTab(nextAdminOrgSharingTab);
            localStorage.setItem(ADMIN_TAB_STORAGE_KEY, nextAdminTab);
            localStorage.setItem(ADMIN_GOVERNANCE_TAB_STORAGE_KEY, nextAdminGovernanceTab);
            localStorage.setItem(ADMIN_ORG_SECTION_STORAGE_KEY, nextAdminOrgSection);
            localStorage.setItem(ADMIN_ORG_SHARING_TAB_STORAGE_KEY, nextAdminOrgSharingTab);
        }
        setCurrentView(view);
        updateBrowserView(view, {
            replace: replaceHistory,
            intakeStage: nextIntakeStage,
            adminTab: nextAdminTab,
            adminGovernanceTab: nextAdminGovernanceTab,
            adminOrgSection: nextAdminOrgSection,
            adminOrgSharingTab: nextAdminOrgSharingTab
        });
    }, [intakeStage, adminTab, adminGovernanceTab, adminOrgSection, adminOrgSharingTab]);

    const navigateToProjectsWithGoalFilter = useCallback((goalId) => {
        // Reset selected project when filtering by goal
        localStorage.removeItem('dha_selected_project_id');
        setProjectFilter(goalId);
        handleViewChange('projects');
    }, [handleViewChange]);

    const navigateToMetricsWithGoalFilter = useCallback((goalId) => {
        setMetricsFilter(goalId);
        handleViewChange('metrics');
    }, [handleViewChange]);

    const renderView = () => {
        return (
            <Suspense fallback={<LoadingSpinner />}>
                {(() => {
                    switch (resolvedCurrentView) {
                        case 'my-work':
                            return <MyWorkPage onViewChange={handleViewChange} />;
                        case 'dashboard':
                            return hasPermission('can_view_dashboard') ?
                                <Dashboard /> :
                                <div className="p-4">Access Denied</div>;
                        case 'exec-dashboard':
                            return hasPermission('can_view_exec_dashboard') ?
                                <ExecDashboard onViewChange={handleViewChange} /> :
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
                            return canAccessIntakeWorkspace ?
                                <IntakePage
                                    initialStage={intakeStage}
                                    onStageChange={setIntakeStage}
                                /> :
                                <div className="p-4">Access Denied</div>;
                        case 'admin':
                            return canAccessAdminPanel ?
                                <AdminPanel
                                    initialTab={adminTab}
                                    onTabChange={setAdminTab}
                                    governanceTab={adminGovernanceTab}
                                    onGovernanceTabChange={setAdminGovernanceTab}
                                    organizationSection={adminOrgSection}
                                    onOrganizationSectionChange={setAdminOrgSection}
                                    organizationSharingTab={adminOrgSharingTab}
                                    onOrganizationSharingTabChange={setAdminOrgSharingTab}
                                /> :
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
                            return <MyWorkPage onViewChange={handleViewChange} />;
                    }
                })()}
            </Suspense>
        );
    };

    // For public intake view, don't show the layout
    if (resolvedCurrentView === 'public-intake') {
        return (
            <>
                {renderView()}
                <ToastContainer />
            </>
        );
    }

    return (
        <>
            <Layout currentView={resolvedCurrentView} onViewChange={handleViewChange}>
                {renderView()}
            </Layout>
            <ToastContainer />
        </>
    );
}

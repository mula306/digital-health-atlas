import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ArrowRight,
    AlertCircle,
    BriefcaseBusiness,
    ClipboardList,
    FolderOpen,
    Inbox,
    Scale,
    Star
} from 'lucide-react';
import { useData } from '../../context/DataContext';
import './MyWorkPage.css';

const OPEN_SUBMISSION_STATUSES = new Set(['pending', 'awaiting-response']);
const INTAKE_FOCUS_STORAGE_KEY = 'dha_intake_focus_submission_payload';
const PROJECT_TASK_FOCUS_STORAGE_KEY = 'dha_project_focus_task_payload';

function formatDate(dateValue) {
    if (!dateValue) return 'n/a';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return 'n/a';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatGovernanceState(item) {
    const status = String(item?.governanceStatus || item?.status || 'in-review').replace(/-/g, ' ');
    return status.charAt(0).toUpperCase() + status.slice(1);
}

export function MyWorkPage({ onViewChange }) {
    const {
        currentUser,
        projects,
        mySubmissions,
        hasPermission,
        fetchIntakeGovernanceQueue
    } = useData();

    const [pendingVotes, setPendingVotes] = useState([]);
    const [governanceLoading, setGovernanceLoading] = useState(false);
    const [governanceLoadError, setGovernanceLoadError] = useState('');

    const canViewProjects = hasPermission('can_view_projects');
    const canViewIntake =
        hasPermission('can_view_intake') ||
        hasPermission('can_manage_intake') ||
        hasPermission('can_manage_intake_forms') ||
        hasPermission('can_view_incoming_requests') ||
        hasPermission('can_view_governance_queue');
    const canViewGovernanceQueue = hasPermission('can_view_governance_queue');

    useEffect(() => {
        if (!canViewGovernanceQueue) {
            setPendingVotes([]);
            setGovernanceLoadError('');
            return;
        }

        let cancelled = false;
        const loadPendingVotes = async () => {
            try {
                setGovernanceLoading(true);
                const result = await fetchIntakeGovernanceQueue({
                    page: 1,
                    limit: 8,
                    myPendingVotes: 'true'
                });
                if (!cancelled) {
                    setPendingVotes(Array.isArray(result?.items) ? result.items : []);
                    setGovernanceLoadError('');
                }
            } catch (error) {
                if (!cancelled) {
                    setPendingVotes([]);
                    setGovernanceLoadError(error?.message || 'Unable to load governance queue.');
                }
            } finally {
                if (!cancelled) {
                    setGovernanceLoading(false);
                }
            }
        };

        loadPendingVotes();
        return () => { cancelled = true; };
    }, [canViewGovernanceQueue, fetchIntakeGovernanceQueue]);

    const watchedProjects = useMemo(() => {
        return projects.filter((project) => !!project.isWatched);
    }, [projects]);

    const openSubmissions = useMemo(() => {
        return mySubmissions.filter((submission) => OPEN_SUBMISSION_STATUSES.has(String(submission.status || '').toLowerCase()));
    }, [mySubmissions]);

    const awaitingResponseSubmissions = useMemo(() => {
        return mySubmissions.filter((submission) => String(submission.status || '').toLowerCase() === 'awaiting-response');
    }, [mySubmissions]);

    const myOpenTasks = useMemo(() => {
        const currentOid = String(currentUser?.oid || '');
        if (!currentOid) return [];

        const items = [];
        projects.forEach((project) => {
            const taskList = Array.isArray(project.tasks) ? project.tasks : [];
            taskList.forEach((task) => {
                if (String(task.assigneeOid || '') !== currentOid) return;
                if (String(task.status || '').toLowerCase() === 'done') return;
                items.push({
                    ...task,
                    projectId: String(project.id),
                    projectTitle: project.title
                });
            });
        });

        return items.slice(0, 8);
    }, [currentUser?.oid, projects]);

    const loadedProjectsWithTasks = useMemo(() => {
        return projects.filter((project) => Array.isArray(project.tasks)).length;
    }, [projects]);

    const openProject = useCallback((project) => {
        const projectId = String(project.id);
        localStorage.removeItem('dha_selected_project_id');
        localStorage.removeItem('dha_project_filter_id');
        localStorage.setItem('dha_project_filter_payload', JSON.stringify({
            projectId,
            requestedAt: Date.now()
        }));
        window.dispatchEvent(new CustomEvent('dha:filter-project', {
            detail: {
                projectId,
                projectTitle: project.title
            }
        }));
        onViewChange?.('projects');
    }, [onViewChange]);

    const openProjectsView = useCallback(() => {
        onViewChange?.('projects');
    }, [onViewChange]);

    const openTask = useCallback((task) => {
        const projectId = String(task?.projectId || '').trim();
        const taskId = String(task?.id || '').trim();
        if (!projectId || !taskId) return;

        localStorage.removeItem('dha_project_filter_payload');
        localStorage.setItem(PROJECT_TASK_FOCUS_STORAGE_KEY, JSON.stringify({
            projectId,
            taskId,
            requestedAt: Date.now()
        }));
        onViewChange?.('projects', {
            preserveSelectedProject: true,
            selectedProjectId: projectId
        });
    }, [onViewChange]);

    const openIntakeStage = useCallback((stage = 'my-requests') => {
        onViewChange?.('intake', { stage });
    }, [onViewChange]);

    const openMySubmission = useCallback((submission) => {
        const submissionId = String(submission?.id || '').trim();
        if (!submissionId) return;

        localStorage.setItem(INTAKE_FOCUS_STORAGE_KEY, JSON.stringify({
            submissionId,
            stage: 'my-requests',
            requestedAt: Date.now()
        }));
        onViewChange?.('intake', { stage: 'my-requests' });
    }, [onViewChange]);

    const openIntakeView = useCallback(() => {
        openIntakeStage('my-requests');
    }, [openIntakeStage]);

    const openGovernanceSubmission = useCallback((submission) => {
        const submissionId = String(submission?.id || '').trim();
        if (!submissionId) return;

        localStorage.setItem(INTAKE_FOCUS_STORAGE_KEY, JSON.stringify({
            submissionId,
            stage: 'governance',
            requestedAt: Date.now()
        }));
        onViewChange?.('intake', { stage: 'governance' });
    }, [onViewChange]);

    const openGovernanceView = useCallback(() => {
        openIntakeStage('governance');
    }, [openIntakeStage]);

    return (
        <div className="my-work-page">
            <section className="my-work-header glass-panel">
                <div>
                    <h2>
                        <BriefcaseBusiness size={18} />
                        My Work Hub
                    </h2>
                    <p>Focus on personal work items across projects, intake, and governance.</p>
                </div>
                <div className="my-work-header-actions">
                    {canViewProjects && (
                        <button className="btn-secondary" onClick={openProjectsView}>
                            <FolderOpen size={15} />
                            Projects
                        </button>
                    )}
                    {canViewIntake && (
                        <button className="btn-secondary" onClick={openIntakeView}>
                            <Inbox size={15} />
                            Intake
                        </button>
                    )}
                </div>
            </section>

            <section className="my-work-metrics">
                <article className="my-work-metric glass">
                    <span className="my-work-metric-label">Watched Projects</span>
                    <strong className="my-work-metric-value">{watchedProjects.length}</strong>
                </article>
                <article className="my-work-metric glass">
                    <span className="my-work-metric-label">Open My Requests</span>
                    <strong className="my-work-metric-value">{openSubmissions.length}</strong>
                </article>
                <article className="my-work-metric glass">
                    <span className="my-work-metric-label">Awaiting My Response</span>
                    <strong className="my-work-metric-value">{awaitingResponseSubmissions.length}</strong>
                </article>
                <article className="my-work-metric glass">
                    <span className="my-work-metric-label">My Pending Votes</span>
                    <strong className="my-work-metric-value">{pendingVotes.length}</strong>
                </article>
            </section>

            <section className="my-work-grid">
                <article className="my-work-panel glass-panel">
                    <header className="my-work-panel-head">
                        <h3><Star size={16} /> Watched Projects</h3>
                        {canViewProjects && (
                            <button className="btn-link" onClick={openProjectsView}>
                                Open Projects <ArrowRight size={14} />
                            </button>
                        )}
                    </header>
                    {!canViewProjects ? (
                        <div className="my-work-empty">
                            <AlertCircle size={16} />
                            Project access is restricted for your account.
                        </div>
                    ) : watchedProjects.length === 0 ? (
                        <div className="my-work-empty">No watched projects yet. Star projects to keep them in focus.</div>
                    ) : (
                        <div className="my-work-list">
                            {watchedProjects.slice(0, 6).map((project) => (
                                <button
                                    key={project.id}
                                    className="my-work-list-item"
                                    onClick={() => openProject(project)}
                                    title={project.title}
                                >
                                    <span className="my-work-list-primary">{project.title}</span>
                                    <span className="my-work-list-secondary">
                                        {project.completion || 0}% complete
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </article>

                <article className="my-work-panel glass-panel">
                    <header className="my-work-panel-head">
                        <h3><ClipboardList size={16} /> Assigned Tasks</h3>
                        {canViewProjects && (
                            <button className="btn-link" onClick={openProjectsView}>
                                Open Boards <ArrowRight size={14} />
                            </button>
                        )}
                    </header>
                    {!canViewProjects ? (
                        <div className="my-work-empty">
                            <AlertCircle size={16} />
                            Project access is restricted for your account.
                        </div>
                    ) : myOpenTasks.length === 0 ? (
                        <div className="my-work-empty">
                            {loadedProjectsWithTasks === 0
                                ? 'No task detail loaded yet. Open a project to pull your assigned tasks.'
                                : 'No open tasks assigned to you.'}
                        </div>
                    ) : (
                        <div className="my-work-list">
                            {myOpenTasks.map((task) => (
                                <button
                                    key={task.id}
                                    className="my-work-list-item"
                                    onClick={() => openTask(task)}
                                    title={`${task.projectTitle}: ${task.title}`}
                                >
                                    <span className="my-work-list-primary">{task.title}</span>
                                    <span className="my-work-list-secondary">
                                        {task.projectTitle} - {String(task.status || 'todo').replace(/-/g, ' ')}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </article>

                <article className="my-work-panel glass-panel">
                    <header className="my-work-panel-head">
                        <h3><Inbox size={16} /> My Intake Requests</h3>
                        {canViewIntake && (
                            <button className="btn-link" onClick={openIntakeView}>
                                Open Intake <ArrowRight size={14} />
                            </button>
                        )}
                    </header>
                    {!canViewIntake ? (
                        <div className="my-work-empty">
                            <AlertCircle size={16} />
                            Intake access is restricted for your account.
                        </div>
                    ) : openSubmissions.length === 0 ? (
                        <div className="my-work-empty">No open intake requests assigned to your account.</div>
                    ) : (
                        <div className="my-work-list">
                            {openSubmissions.slice(0, 6).map((submission) => (
                                <button
                                    key={submission.id}
                                    className="my-work-list-item"
                                    onClick={() => openMySubmission(submission)}
                                    title={submission.formName || 'Intake Request'}
                                >
                                    <span className="my-work-list-primary">{submission.formName || 'Intake Request'}</span>
                                    <span className="my-work-list-secondary">
                                        {String(submission.status || 'pending').replace(/-/g, ' ')} - Submitted {formatDate(submission.submittedAt)}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </article>

                <article className="my-work-panel glass-panel">
                    <header className="my-work-panel-head">
                        <h3><Scale size={16} /> Governance Votes</h3>
                        {canViewIntake && (
                            <button className="btn-link" onClick={openGovernanceView}>
                                Open Governance <ArrowRight size={14} />
                            </button>
                        )}
                    </header>
                    {!canViewGovernanceQueue ? (
                        <div className="my-work-empty">
                            <AlertCircle size={16} />
                            Governance queue access is restricted for your account.
                        </div>
                    ) : governanceLoading ? (
                        <div className="my-work-empty">Loading governance queue...</div>
                    ) : governanceLoadError ? (
                        <div className="my-work-empty">{governanceLoadError}</div>
                    ) : pendingVotes.length === 0 ? (
                        <div className="my-work-empty">No pending governance votes.</div>
                    ) : (
                        <div className="my-work-list">
                            {pendingVotes.map((item) => (
                                <button
                                    key={item.id}
                                    className="my-work-list-item"
                                    onClick={() => openGovernanceSubmission(item)}
                                    title={item.formName || 'Submission'}
                                >
                                    <span className="my-work-list-primary">{item.formName || 'Submission'}</span>
                                    <span className="my-work-list-secondary">
                                        {formatGovernanceState(item)} - Submitted {formatDate(item.submittedAt)}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </article>
            </section>
        </div>
    );
}

export default MyWorkPage;

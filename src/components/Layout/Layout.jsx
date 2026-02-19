import {
    LayoutDashboard,
    Target,
    Folder,
    BarChart3,
    Menu,
    X,
    Inbox,
    FileText,
    Shield,
    TrendingUp,
    Search,
    Sun,
    Moon,
    ArrowRight
} from 'lucide-react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../context/ThemeContext';
import { ThemeToggle } from '../UI/ThemeToggle';
import { API_BASE } from '../../apiClient';
import './Layout.css';

const SIDEBAR_PREFERENCE_KEY = 'dha_sidebar_open';
const RECENT_VIEWS_KEY = 'dha_recent_views';
const MAX_RECENT_VIEWS = 5;

// ... UserProfile component ...
function UserProfile() {
    const { instance, account, userRoles } = useAuth();
    const name = account?.name || 'User';
    // Display the highest role for debugging/info
    const roleDisplay = userRoles.length > 0 ? userRoles[0] : 'No Role';

    const handleLogout = () => {
        instance.logoutRedirect({
            postLogoutRedirectUri: "/",
            mainWindowRedirectUri: "/"
        });
    };

    return (
        <div className="user-profile">
            <div className="user-info">
                <span className="user-name">{name}</span>
                <span className="user-role">{roleDisplay}</span>
            </div>
            <button onClick={handleLogout} className="sign-out-btn">
                Sign Out
            </button>
            <div className="user-avatar">
                {name.charAt(0)}
            </div>
        </div>
    );
}

export function Layout({ children, currentView, onViewChange }) {
    const [isMobileView, setIsMobileView] = useState(() => typeof window !== 'undefined' ? window.innerWidth <= 992 : false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
        if (typeof window === 'undefined') return false;
        const savedPreference = localStorage.getItem(SIDEBAR_PREFERENCE_KEY);
        if (savedPreference !== null) return savedPreference === 'true';
        return window.innerWidth > 992;
    });
    const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
    const [commandQuery, setCommandQuery] = useState('');
    const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
    const [allCommandProjects, setAllCommandProjects] = useState([]);
    const [recentViews, setRecentViews] = useState(() => {
        if (typeof window === 'undefined') return [];
        try {
            const raw = localStorage.getItem(RECENT_VIEWS_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
        } catch {
            return [];
        }
    });

    const { isAppAdmin } = useAuth();
    const {
        hasPermission,
        goals = [],
        projects = [],
        projectsPagination,
        fetchExecSummaryProjects,
        authFetch
    } = useData();
    const { theme, toggleTheme } = useTheme();
    const [portfolioPulseStats, setPortfolioPulseStats] = useState(null);

    const allNavItems = [
        { id: 'exec-dashboard', label: 'Executive Summary', icon: LayoutDashboard, permission: 'can_view_exec_dashboard' },
        { id: 'goals', label: 'Goals', icon: Target, permission: 'can_view_goals' },
        { id: 'metrics', label: 'Metrics', icon: TrendingUp, permission: 'can_view_metrics' },
        { id: 'dashboard', label: 'Project Dashboard', icon: BarChart3, permission: 'can_view_dashboard' },
        { id: 'projects', label: 'Projects', icon: Folder, permission: 'can_view_projects' },
        { id: 'reports', label: 'Reports', icon: FileText, permission: 'can_view_reports' },
        { id: 'intake', label: 'Intake', icon: Inbox, permission: 'can_view_intake' },
    ];

    const navItems = allNavItems.filter(item => {
        if (!item.permission) return true;
        return hasPermission(item.permission);
    });

    if (isAppAdmin) {
        navItems.push({ id: 'admin', label: 'Admin Panel', icon: Shield });
    }

    const navItemsById = useMemo(() => {
        return navItems.reduce((accumulator, item) => {
            accumulator[item.id] = item;
            return accumulator;
        }, {});
    }, [navItems]);

    const pageDescriptions = {
        'exec-dashboard': 'Portfolio-level health, trends, and strategic outcomes.',
        goals: 'Track strategic objectives and ensure delivery alignment.',
        metrics: 'Explore KPI performance and trend visibility.',
        dashboard: 'Cross-project delivery status and operational movement.',
        projects: 'Deep project execution with task-level visibility.',
        reports: 'Create and compare status narratives across projects.',
        intake: 'Review and triage incoming project requests.',
        admin: 'Manage access, governance settings, and platform controls.'
    };

    const trackRecentView = useCallback((viewId) => {
        setRecentViews(previous => {
            const next = [viewId, ...previous.filter(item => item !== viewId)].slice(0, MAX_RECENT_VIEWS);
            return next;
        });
    }, []);

    const handleNavClick = useCallback((viewId, options = {}) => {
        onViewChange(viewId, options);
        trackRecentView(viewId);
        if (isMobileView) {
            setIsSidebarOpen(false);
        }
    }, [isMobileView, onViewChange, trackRecentView]);

    useEffect(() => {
        if (!(hasPermission('can_view_projects') || hasPermission('can_view_exec_dashboard'))) {
            return;
        }

        let isMounted = true;

        const loadPortfolioPulse = async () => {
            try {
                const summaryPromise = fetchExecSummaryProjects().catch(() => []);
                const dashboardPromise = authFetch(`${API_BASE}/dashboard/stats`)
                    .then(res => (res.ok ? res.json() : null))
                    .catch(() => null);

                const [summary, dashboardStats] = await Promise.all([summaryPromise, dashboardPromise]);
                if (!isMounted) return;

                const allProjects = Array.isArray(summary) ? summary : [];
                const attentionFromStatus = allProjects.filter(project => {
                    const status = project?.report?.overallStatus;
                    return status === 'red' || status === 'yellow';
                }).length;

                setAllCommandProjects(allProjects);
                setPortfolioPulseStats({
                    totalProjects: allProjects.length,
                    attentionNeeded: attentionFromStatus,
                    avgCompletion: dashboardStats?.avgProjectCompletion ?? null
                });
            } catch {
                if (!isMounted) return;
                setAllCommandProjects([]);
                setPortfolioPulseStats(null);
            }
        };

        loadPortfolioPulse();
        return () => { isMounted = false; };
    }, [authFetch, fetchExecSummaryProjects, hasPermission]);

    const workspacePulse = useMemo(() => {
        const totalProjects = portfolioPulseStats?.totalProjects
            ?? projectsPagination?.total
            ?? projects.length;
        const totalGoals = goals.length;
        const averageCompletion = portfolioPulseStats?.avgCompletion ?? (projects.length > 0
            ? Math.round(projects.reduce((sum, project) => sum + (project.completion || 0), 0) / projects.length)
            : 0);
        const attentionNeeded = portfolioPulseStats?.attentionNeeded ?? projects.filter(project => {
            const taskVolume = project.taskCount || project.tasks?.length || 0;
            return taskVolume >= 3 && (project.completion || 0) < 45;
        }).length;

        return [
            { label: 'Projects', value: totalProjects },
            { label: 'Goals', value: totalGoals },
            { label: 'Avg Completion', value: `${averageCompletion}%` },
            { label: 'Attention Needed', value: attentionNeeded }
        ];
    }, [goals.length, portfolioPulseStats, projects, projectsPagination?.total]);

    const recentCommands = useMemo(() => {
        return recentViews
            .map(viewId => navItemsById[viewId])
            .filter(Boolean)
            .map(item => ({
                id: `recent-${item.id}`,
                type: 'view',
                label: `Recent: ${item.label}`,
                description: 'Recently visited workspace',
                icon: item.icon,
                viewId: item.id,
                keywords: `recent ${item.label}`.toLowerCase(),
                baseScore: 120
            }));
    }, [navItemsById, recentViews]);

    const viewCommands = useMemo(() => {
        return navItems.map(item => ({
            id: `view-${item.id}`,
            type: 'view',
            label: item.label,
            description: 'Navigate to workspace',
            icon: item.icon,
            viewId: item.id,
            keywords: `${item.label} ${item.id} workspace`.toLowerCase(),
            baseScore: 90
        }));
    }, [navItems]);

    const actionCommands = useMemo(() => {
        return [
            {
                id: 'action-theme',
                type: 'action',
                label: theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode',
                description: 'Toggle color theme',
                icon: theme === 'light' ? Moon : Sun,
                action: 'toggle-theme',
                keywords: 'theme mode appearance dark light',
                baseScore: 85
            },
            {
                id: 'action-sidebar',
                type: 'action',
                label: isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar',
                description: 'Toggle navigation rail',
                icon: Menu,
                action: 'toggle-sidebar',
                keywords: 'sidebar navigation menu collapse expand',
                baseScore: 80
            }
        ];
    }, [isSidebarOpen, theme]);

    const goalNameById = useMemo(() => {
        return goals.reduce((accumulator, goal) => {
            accumulator[String(goal.id)] = goal.title || 'Goal';
            return accumulator;
        }, {});
    }, [goals]);

    const quickProjectCommands = useMemo(() => {
        return [...projects]
            .sort((a, b) => (b.completion || 0) - (a.completion || 0))
            .slice(0, 3)
            .map(project => ({
                id: `quick-project-${project.id}`,
                type: 'project',
                label: `Continue: ${project.title}`,
                description: `${project.completion || 0}% complete`,
                icon: Folder,
                projectId: project.id,
                keywords: `${project.title} continue project`.toLowerCase(),
                baseScore: 70
            }));
    }, [projects]);

    const projectCommands = useMemo(() => {
        const sourceProjects = allCommandProjects.length > 0 ? allCommandProjects : projects;
        return sourceProjects.map(project => ({
            id: `project-${project.id}`,
            type: 'project',
            label: project.title,
            description: `${goalNameById[String(project.goalId)] || 'Unlinked goal'} - ${typeof project.completion === 'number' ? `${project.completion}% complete` : 'Open project'}`,
            icon: Folder,
            projectId: project.id,
            keywords: `${project.title} ${goalNameById[String(project.goalId)] || ''} project ${project.id}`.toLowerCase(),
            baseScore: 65
        }));
    }, [allCommandProjects, goalNameById, projects]);

    const goalCommands = useMemo(() => {
        return goals.slice(0, 120).map(goal => ({
            id: `goal-${goal.id}`,
            type: 'goal',
            label: goal.title,
            description: 'Open goals workspace',
            icon: Target,
            goalId: goal.id,
            keywords: `${goal.title} goal objective`.toLowerCase(),
            baseScore: 60
        }));
    }, [goals]);

    const closeCommandPalette = useCallback(() => {
        setIsCommandPaletteOpen(false);
        setCommandQuery('');
        setSelectedCommandIndex(0);
    }, []);

    const executeCommand = useCallback((command) => {
        if (!command) return;

        if (command.type === 'view') {
            handleNavClick(command.viewId);
        }

        if (command.type === 'project') {
            const projectId = String(command.projectId);
            localStorage.removeItem('dha_selected_project_id');
            localStorage.setItem('dha_project_filter_id', projectId);
            window.dispatchEvent(new CustomEvent('dha:filter-project', {
                detail: {
                    projectId,
                    projectTitle: command.label
                }
            }));
            handleNavClick('projects');
        }

        if (command.type === 'goal') {
            localStorage.removeItem('dha_selected_project_id');
            handleNavClick('goals');
        }

        if (command.type === 'action') {
            if (command.action === 'toggle-theme') {
                toggleTheme();
            }
            if (command.action === 'toggle-sidebar') {
                setIsSidebarOpen(previous => !previous);
            }
        }

        closeCommandPalette();
    }, [closeCommandPalette, handleNavClick, toggleTheme]);

    const commandResults = useMemo(() => {
        const normalizedQuery = commandQuery.trim().toLowerCase();
        const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

        if (tokens.length === 0) {
            const all = [...recentCommands, ...viewCommands, ...actionCommands, ...quickProjectCommands];
            const unique = [];
            const seenIds = new Set();
            all.forEach(command => {
                if (!seenIds.has(command.id)) {
                    seenIds.add(command.id);
                    unique.push(command);
                }
            });
            return unique.slice(0, 10);
        }

        const allCommands = [...viewCommands, ...actionCommands, ...projectCommands, ...goalCommands];
        return allCommands
            .map(command => {
                const haystack = `${command.label} ${command.description} ${command.keywords}`.toLowerCase();
                let score = command.baseScore || 0;

                for (const token of tokens) {
                    if (command.label.toLowerCase().startsWith(token)) {
                        score += 60;
                    } else if (command.label.toLowerCase().includes(token)) {
                        score += 35;
                    } else if (haystack.includes(token)) {
                        score += 15;
                    } else {
                        score -= 25;
                    }
                }

                return { ...command, score };
            })
            .filter(command => command.score > 0)
            .sort((left, right) => right.score - left.score)
            .slice(0, 14);
    }, [actionCommands, commandQuery, goalCommands, projectCommands, quickProjectCommands, recentCommands, viewCommands]);

    const activeCommandIndex = commandResults.length === 0
        ? 0
        : Math.min(selectedCommandIndex, commandResults.length - 1);

    useEffect(() => {
        localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(isSidebarOpen));
    }, [isSidebarOpen]);

    useEffect(() => {
        localStorage.setItem(RECENT_VIEWS_KEY, JSON.stringify(recentViews));
    }, [recentViews]);

    useEffect(() => {
        const handleResize = () => {
            setIsMobileView(window.innerWidth <= 992);
        };

        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        const handleKeyDown = (event) => {
            const isCommandShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
            if (isCommandShortcut) {
                event.preventDefault();
                if (isCommandPaletteOpen) {
                    closeCommandPalette();
                } else {
                    setSelectedCommandIndex(0);
                    setIsCommandPaletteOpen(true);
                }
                return;
            }

            if (!isCommandPaletteOpen) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                closeCommandPalette();
                return;
            }

            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedCommandIndex(previous => {
                    if (commandResults.length === 0) return 0;
                    const normalizedIndex = Math.min(previous, commandResults.length - 1);
                    return (normalizedIndex + 1) % commandResults.length;
                });
                return;
            }

            if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedCommandIndex(previous => {
                    if (commandResults.length === 0) return 0;
                    const normalizedIndex = Math.min(previous, commandResults.length - 1);
                    return (normalizedIndex - 1 + commandResults.length) % commandResults.length;
                });
                return;
            }

            if (event.key === 'Enter') {
                event.preventDefault();
                executeCommand(commandResults[activeCommandIndex]);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeCommandIndex, closeCommandPalette, commandResults, executeCommand, isCommandPaletteOpen]);

    const pageTitle = navItemsById[currentView]?.label || 'Digital Health Atlas';
    const pageSubtitle = pageDescriptions[currentView] || 'One workspace for strategy, delivery, and reporting.';

    const commandTypeLabel = {
        view: 'View',
        project: 'Project',
        goal: 'Goal',
        action: 'Action'
    };

    return (
        <div className="layout">
            {/* Sidebar Overlay for Mobile */}
            {isSidebarOpen && isMobileView && (
                <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)}></div>
            )}

            {/* Sidebar */}
            <aside className={`sidebar ${isSidebarOpen ? 'open' : 'closed'}`}>
                <div className="sidebar-header">
                    <div className="logo">
                        <div className="logo-icon">DHA</div>
                        {/* Text removed as requested, keeping only logo icon */}
                    </div>
                    <button
                        className="toggle-sidebar-btn"
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    >
                        {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
                    </button>
                </div>

                <nav className="nav-menu">
                    {navItems.map(item => (
                        <button
                            key={item.id}
                            className={`nav-item ${currentView === item.id ? 'active' : ''}`}
                            onClick={() => handleNavClick(item.id)}
                        >
                            <item.icon size={22} />
                            {isSidebarOpen && <span>{item.label}</span>}
                        </button>
                    ))}
                </nav>
            </aside>


            {/* Main Content */}
            <main className="main-content">
                <header className="top-header">
                    {/* Mobile Menu Button */}
                    <button
                        className="mobile-menu-btn"
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        aria-label="Toggle Menu"
                    >
                        <Menu size={24} />
                    </button>

                    <div className="page-heading">
                        <h2 className="page-title">{pageTitle}</h2>
                        <p className="page-subtitle">{pageSubtitle}</p>
                    </div>

                    <div className="header-actions">
                        <button
                            className="command-launch-btn"
                            onClick={() => {
                                setSelectedCommandIndex(0);
                                setIsCommandPaletteOpen(true);
                            }}
                            aria-label="Open command palette"
                            title="Search and actions (Ctrl/Cmd + K)"
                        >
                            <Search size={16} />
                            <span className="command-launch-label">Search and actions</span>
                            <kbd className="command-shortcut">Ctrl/Cmd + K</kbd>
                        </button>

                        <ThemeToggle />
                        <UserProfile />
                    </div>
                </header>

                <section className="workspace-pulse" aria-label="Workspace overview">
                    {workspacePulse.map(item => (
                        <article className="pulse-card glass" key={item.label}>
                            <span className="pulse-label">{item.label}</span>
                            <strong className="pulse-value">{item.value}</strong>
                        </article>
                    ))}
                </section>

                <div className="content-scrollable">
                    {children}
                </div>
            </main>

            {isCommandPaletteOpen && (
                <div className="command-overlay" onClick={closeCommandPalette}>
                    <div className="command-palette glass-panel" onClick={event => event.stopPropagation()}>
                        <div className="command-input-row">
                            <Search size={18} className="command-search-icon" />
                            <input
                                className="command-input"
                                type="text"
                                placeholder="Jump to a view, project, goal, or quick action..."
                                value={commandQuery}
                                onChange={event => {
                                    setSelectedCommandIndex(0);
                                    setCommandQuery(event.target.value);
                                }}
                                autoFocus
                            />
                        </div>

                        <div className="command-results">
                            {commandResults.length === 0 ? (
                                <div className="command-empty-state">
                                    <p>No matches found.</p>
                                    <small>Try a different keyword.</small>
                                </div>
                            ) : (
                                commandResults.map((command, index) => {
                                    const Icon = command.icon || Search;
                                    return (
                                        <button
                                            key={command.id}
                                            className={`command-item ${index === activeCommandIndex ? 'active' : ''}`}
                                            onMouseEnter={() => setSelectedCommandIndex(index)}
                                            onClick={() => executeCommand(command)}
                                        >
                                            <span className="command-item-icon">
                                                <Icon size={16} />
                                            </span>
                                            <span className="command-item-text">
                                                <span className="command-item-label">{command.label}</span>
                                                <span className="command-item-description">{command.description}</span>
                                            </span>
                                            <span className="command-item-meta">
                                                <span className="command-type-tag">{commandTypeLabel[command.type] || 'Item'}</span>
                                                <ArrowRight size={14} />
                                            </span>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

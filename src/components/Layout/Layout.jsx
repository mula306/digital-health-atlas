import { LayoutDashboard, Target, Folder, BarChart3, Menu, X, Inbox, FileText, Shield, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../hooks/useAuth';
import { ThemeToggle } from '../UI/ThemeToggle';
import './Layout.css';

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
    const [isSidebarOpen, setIsSidebarOpen] = useState(() => typeof window !== 'undefined' ? window.innerWidth > 992 : false);
    const { isAppAdmin } = useAuth();
    const { hasPermission } = useData();

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

    const handleNavClick = (viewId) => {
        onViewChange(viewId);
        // Auto-close sidebar on mobile after clicking a link
        if (window.innerWidth <= 992) {
            setIsSidebarOpen(false);
        }
    };

    return (
        <div className="layout">
            {/* Sidebar Overlay for Mobile */}
            {isSidebarOpen && window.innerWidth <= 992 && (
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

                    <h2 className="page-title">Digital Health Atlas</h2>

                    <div className="header-actions">

                        <ThemeToggle />
                        <UserProfile />
                    </div>
                </header>

                <div className="content-scrollable">
                    {children}
                </div>
            </main>
        </div>
    );
}

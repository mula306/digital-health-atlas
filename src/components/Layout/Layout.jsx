import { LayoutDashboard, Target, Folder, BarChart3, Menu, X, Search, Inbox, FileText, Shield, TrendingUp } from 'lucide-react';
import { useState, useEffect } from 'react';
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
        <div className="user-profile" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: '1.2' }}>
                <span className="user-name" style={{ fontSize: '0.9rem', fontWeight: '500' }}>{name}</span>
                <span className="user-role" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{roleDisplay}</span>
            </div>
            <button
                onClick={handleLogout}
                style={{
                    padding: '0.4rem 0.8rem',
                    fontSize: '0.8rem',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer'
                }}
            >
                Sign Out
            </button>
            <div className="user-avatar" style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'var(--accent-primary)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: '600'
            }}>
                {name.charAt(0)}
            </div>
        </div>
    );
}

export function Layout({ children, currentView, onViewChange, onSearch }) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const { isAppAdmin } = useAuth();
    const { hasPermission } = useData(); // Get hasPermission helper

    // Set initial sidebar state on mount
    useEffect(() => {
        setIsSidebarOpen(window.innerWidth > 992);
    }, []);

    const allNavItems = [
        { id: 'exec-dashboard', label: 'Executive Summary', icon: LayoutDashboard, permission: 'can_view_exec_dashboard' },
        { id: 'dashboard', label: 'Dashboard', icon: BarChart3, permission: 'can_view_dashboard' },
        { id: 'goals', label: 'Goals', icon: Target, permission: 'can_view_goals' },
        { id: 'metrics', label: 'Metrics', icon: TrendingUp, permission: 'can_view_metrics' },
        { id: 'projects', label: 'Projects', icon: Folder, permission: 'can_view_projects' },
        { id: 'reports', label: 'Reports', icon: FileText, permission: 'can_view_reports' },
        { id: 'intake', label: 'Intake', icon: Inbox, permission: 'can_view_intake' },
    ];

    const navItems = allNavItems.filter(item => {
        if (!item.permission) return true; // No permission required
        return hasPermission(item.permission);
    });

    if (isAppAdmin) {
        navItems.push({ id: 'admin', label: 'Admin Panel', icon: Shield });
    }

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        if (onSearch && searchQuery.trim()) {
            onSearch(searchQuery);
        }
    };

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
                        {/* Search Bar */}
                        <form className="search-form" onSubmit={handleSearchSubmit}>
                            <Search size={18} className="search-icon" />
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="search-input"
                            />
                        </form>

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

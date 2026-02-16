import React from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../../authConfig';
import './LoginPage.css'; // We'll create this next
import { LayoutDashboard, Building2 } from 'lucide-react'; // Using an icon as a logo placeholder if needed

export const LoginPage = () => {
    const { instance } = useMsal();

    const handleLogin = () => {
        instance.loginRedirect(loginRequest).catch(e => {
            console.error(e);
        });
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="login-header">
                    <div className="login-logo">
                        <LayoutDashboard size={48} color="#0ea5e9" />
                    </div>
                    <h1>Digital Health Atlas</h1>
                    <p className="login-subtitle">Goal and Project Tracking System</p>
                </div>

                <div className="login-body">
                    <p className="login-instruction">Please sign in with your organizational account to access the dashboard.</p>

                    <button className="org-login-btn" onClick={handleLogin}>
                        <Building2 size={20} />
                        <span>Sign In with your Organization</span>
                    </button>
                </div>

                <div className="login-footer">
                    <p>&copy; {new Date().getFullYear()} Digital Health Atlas. All rights reserved.</p>
                    <p>Secure System &bull; Authorized Access Only</p>
                </div>
            </div>

            <div className="login-background-overlay"></div>
        </div>
    );
};

import React from 'react';

export class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        // Update state so the next render will show the fallback UI.
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        // You can also log the error to an error reporting service
        console.error("Uncaught error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    render() {
        if (this.state.hasError) {
            // You can render any custom fallback UI
            return (
                <div style={{
                    padding: '2rem',
                    margin: '2rem',
                    border: '1px solid #fee2e2',
                    borderRadius: '8px',
                    backgroundColor: '#fef2f2',
                    color: '#991b1b',
                    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
                }}>
                    <h2 style={{ marginTop: 0 }}>Something went wrong.</h2>
                    <details style={{ whiteSpace: 'pre-wrap', marginTop: '1rem' }}>
                        <summary style={{ cursor: 'pointer', fontWeight: '600' }}>See error details</summary>
                        <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', overflowX: 'auto' }}>
                            <p><strong>{this.state.error && this.state.error.toString()}</strong></p>
                            <p style={{ color: '#ef4444' }}>{this.state.errorInfo && this.state.errorInfo.componentStack}</p>
                        </div>
                    </details>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            marginTop: '1.5rem',
                            padding: '0.5rem 1rem',
                            backgroundColor: '#dc2626',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: '500'
                        }}
                    >
                        Reload Application
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

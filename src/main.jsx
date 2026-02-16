import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PublicClientApplication, EventType } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { msalConfig } from './authConfig';
import './index.css'
import App from './App.jsx'
import { ErrorBoundary } from './components/UI/ErrorBoundary';

// Initialize MSAL
let msalInstance;

try {
  msalInstance = new PublicClientApplication(msalConfig);
} catch (error) {
  console.error("MSAL Instantiation Failed:", error);
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = ''; // Clear existing content
    const container = document.createElement('div');
    container.style.cssText = "padding: 20px; color: red; font-family: sans-serif;";

    const h1 = document.createElement('h1');
    h1.textContent = "Configuration Error";

    const p1 = document.createElement('p');
    p1.textContent = "Failed to create PublicClientApplication. Please check your config.";

    const pre = document.createElement('pre');
    pre.style.cssText = "background: #f0f0f0; padding: 10px;";
    pre.textContent = error.message; // Safe text insertion

    const p2 = document.createElement('p');
    p2.textContent = "Ensure your .env file has a valid VITE_AZURE_CLIENT_ID.";

    container.appendChild(h1);
    container.appendChild(p1);
    container.appendChild(pre);
    container.appendChild(p2);
    root.appendChild(container);
  }
  throw error; // Stop execution
}

// Check if we are running inside a popup window (for auth callback)
const isInPopup = window.opener && window.opener !== window;
const hasAuthHash = window.location.hash.includes('code=') || window.location.hash.includes('state=');

async function initializeApp() {
  await msalInstance.initialize();

  // Handle redirect promise for auth callbacks
  try {
    const response = await msalInstance.handleRedirectPromise();

    // If we're in a popup with an auth response, MSAL should close it automatically.
    // But if for some reason it doesn't, and we have a response, we can try to close.
    if (isInPopup && hasAuthHash) {
      // In a popup with auth hash - don't render the app, just let MSAL handle it
      console.log("Auth callback in popup detected, waiting for MSAL to close...");
      // Give MSAL a moment to process and close the popup
      // If we're still here after a bit, something went wrong
      setTimeout(() => {
        if (window.opener) {
          window.close();
        }
      }, 1000);
      return; // Don't render the app in popup
    }

    // We're in the main window - proceed with app rendering
    if (response) {
      msalInstance.setActiveAccount(response.account);
    } else if (!msalInstance.getActiveAccount() && msalInstance.getAllAccounts().length > 0) {
      msalInstance.setActiveAccount(msalInstance.getAllAccounts()[0]);
    }
  } catch (error) {
    // Handle expected errors gracefully
    if (error.errorCode === "no_token_request_cache_error" ||
      (error.message && error.message.includes("no_token_request_cache_error"))) {
      console.warn("Silent auth error (stale hash), clearing URL hash...", error);
      // Clear the stale hash
      window.history.replaceState(null, '', window.location.pathname);
    } else {
      throw error;
    }
  }

  // Account selection on login success
  msalInstance.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_SUCCESS && event.payload.account) {
      msalInstance.setActiveAccount(event.payload.account);
    }
  });

  // Render the app
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ErrorBoundary>
        <MsalProvider instance={msalInstance}>
          <App />
        </MsalProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}

initializeApp().catch(error => {
  console.error("Application Failed to Start:", error);
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = ''; // Clear existing content
    const container = document.createElement('div');
    container.style.cssText = "padding: 20px; color: red; font-family: sans-serif;";

    const h1 = document.createElement('h1');
    h1.textContent = "Application Failed to Start";

    const p1 = document.createElement('p');
    p1.textContent = "Authentication initialization failed. Please check your console logs.";

    const pre = document.createElement('pre');
    pre.style.cssText = "background: #f0f0f0; padding: 10px;";
    pre.textContent = error.message; // Safe text insertion

    const p2 = document.createElement('p');
    p2.textContent = "Ensure your .env file has the correct VITE_AZURE_CLIENT_ID.";

    container.appendChild(h1);
    container.appendChild(p1);
    container.appendChild(pre);
    container.appendChild(p2);
    root.appendChild(container);
  }
});

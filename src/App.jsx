import { ThemeProvider } from './context/ThemeContext';
import { DataProvider } from './context/DataContext';
import { ToastProvider } from './context/ToastContext';
import { AuthenticatedTemplate, UnauthenticatedTemplate } from '@azure/msal-react';
import { LoginPage } from './components/Auth/LoginPage';
import { AppContent } from './components/AppContent';

const TEST_AUTH_MODE = String(import.meta.env.VITE_TEST_AUTH_MODE || '').toLowerCase();
const IS_TEST_AUTH_MOCK = TEST_AUTH_MODE === 'mock';

function MainAppContent() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <DataProvider>
          <AppContent />
        </DataProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

function App() {
  if (IS_TEST_AUTH_MOCK) {
    return <MainAppContent />;
  }

  return (
    <>
      <AuthenticatedTemplate>
        <MainAppContent />
      </AuthenticatedTemplate>
      <UnauthenticatedTemplate>
        <LoginPage />
      </UnauthenticatedTemplate>
    </>
  );
}

export default App;

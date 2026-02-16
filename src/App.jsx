import { ThemeProvider } from './context/ThemeContext';
import { DataProvider } from './context/DataContext';
import { ToastProvider } from './context/ToastContext';
import { AuthenticatedTemplate, UnauthenticatedTemplate } from '@azure/msal-react';
import { LoginPage } from './components/Auth/LoginPage';
import { AppContent } from './components/AppContent';

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

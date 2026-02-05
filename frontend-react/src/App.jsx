import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import LandingPage from './pages/Landing/LandingPage';
import LoginPage from './pages/Auth/LoginPage';
import OrgSetup from './pages/Auth/OrgSetup';
import ToolsPage from './pages/Tools/ToolsPage';
import ResponseAssistantPage from './pages/ResponseAssistant/ResponseAssistantPage';
import InsightsEnginePage from './pages/InsightsEngine/InsightsEnginePage';
import DraftAssistantPage from './pages/DraftAssistant/DraftAssistantPage';
import ListNormalizerPage from './pages/ListNormalizer/ListNormalizerPage';
import TeamsPage from './pages/Teams/TeamsPage';
import AdminDashboard from './pages/Admin/AdminDashboard';
import SettingsPage from './pages/Settings/SettingsPage';
import KnowledgeBasePage from './pages/ResponseAssistant/KnowledgeBasePage';

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function AdminRoute({ children }) {
  const { isSuperAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  if (!isSuperAdmin) {
    return <Navigate to="/tools" replace />;
  }

  return children;
}

export default function App() {
  const { isAuthenticated, organization, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading Lightspeed...</p>
      </div>
    );
  }

  return (
    <Routes>
      {/* Public routes */}
      <Route
        path="/"
        element={isAuthenticated ? <Navigate to="/tools" replace /> : <LandingPage />}
      />
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/tools" replace /> : <LoginPage />}
      />

      {/* Org setup for new users */}
      <Route
        path="/setup"
        element={
          <ProtectedRoute>
            {organization ? <Navigate to="/tools" replace /> : <OrgSetup />}
          </ProtectedRoute>
        }
      />

      {/* Protected routes */}
      <Route
        path="/tools"
        element={
          <ProtectedRoute>
            {!organization ? <Navigate to="/setup" replace /> : <ToolsPage />}
          </ProtectedRoute>
        }
      />

      <Route
        path="/tools/response-assistant/*"
        element={
          <ProtectedRoute>
            <ResponseAssistantPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/tools/insights-engine"
        element={
          <ProtectedRoute>
            <InsightsEnginePage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/tools/draft-assistant"
        element={
          <ProtectedRoute>
            <DraftAssistantPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/tools/list-normalizer"
        element={
          <ProtectedRoute>
            <ListNormalizerPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/knowledge-base"
        element={
          <ProtectedRoute>
            <KnowledgeBasePage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/teams"
        element={
          <ProtectedRoute>
            <TeamsPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminDashboard />
          </AdminRoute>
        }
      />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

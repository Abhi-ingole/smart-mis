import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { AuthProvider, useAuth } from "./lib/auth";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import LoginPage from "./pages/Login";
import ChangePasswordPage from "./pages/ChangePassword";
const DashboardPage = lazy(() => import("./pages/Dashboard"));
const AddDataPage = lazy(() => import("./pages/AddData"));
const ReportsPage = lazy(() => import("./pages/Reports"));
const SettingsPage = lazy(() => import("./pages/Settings"));

function Protected({ children, need }: { children: ReactNode; need?: "edit" | "admin" }) {
  const { user, loading, can } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (need && !can(need)) return <Navigate to="/" replace />;
  return (
    <Layout>
      <Suspense fallback={<Spinner />}>{children}</Suspense>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Protected><DashboardPage /></Protected>} />
        <Route path="/add" element={<Protected need="edit"><AddDataPage /></Protected>} />
        <Route path="/reports" element={<Protected><ReportsPage /></Protected>} />
        <Route path="/settings" element={<Protected need="admin"><SettingsPage /></Protected>} />
        <Route path="/password" element={<Protected><ChangePasswordPage /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { SkeletonDashboard, ToastProvider } from "./components/ui";
import { DatasetsProvider } from "./state/datasets";
import OverviewPage from "./pages/Overview";

const UploadPage = lazy(() => import("./pages/Upload"));
const DatasetsPage = lazy(() => import("./pages/Datasets"));
const DashboardPage = lazy(() => import("./pages/Dashboard"));
const ReportPage = lazy(() => import("./pages/ReportBuilder"));
const InsightsPage = lazy(() => import("./pages/Insights"));
const QualityPage = lazy(() => import("./pages/DataQuality"));
const SettingsPage = lazy(() => import("./pages/Settings"));

export default function App() {
  return (
    <ToastProvider>
      <DatasetsProvider>
        <Layout>
          <Suspense fallback={<SkeletonDashboard />}>
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/datasets" element={<DatasetsPage />} />
              <Route path="/dashboard/:id?" element={<DashboardPage />} />
              <Route path="/report/:id?" element={<ReportPage />} />
              <Route path="/insights/:id?" element={<InsightsPage />} />
              <Route path="/quality/:id?" element={<QualityPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Layout>
      </DatasetsProvider>
    </ToastProvider>
  );
}

import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { SkeletonDashboard, ToastProvider } from "./components/ui";
import { DatasetsProvider } from "./state/datasets";
import { SchedulerProvider } from "./state/scheduler";
import OverviewPage from "./pages/Overview";

const UploadPage = lazy(() => import("./pages/Upload"));
const DatasetsPage = lazy(() => import("./pages/Datasets"));
const DashboardPage = lazy(() => import("./pages/Dashboard"));
const ReportPage = lazy(() => import("./pages/ReportBuilder"));
const InsightsPage = lazy(() => import("./pages/Insights"));
const QualityPage = lazy(() => import("./pages/DataQuality"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const MappingPage = lazy(() => import("./pages/Mapping"));
const AskPage = lazy(() => import("./pages/Ask"));
const SchedulePage = lazy(() => import("./pages/Schedule"));

export default function App() {
  return (
    <ToastProvider>
      <DatasetsProvider>
        <SchedulerProvider>
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
              <Route path="/mapping/:id?" element={<MappingPage />} />
              <Route path="/ask/:id?" element={<AskPage />} />
              <Route path="/schedule/:id?" element={<SchedulePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Layout>
        </SchedulerProvider>
      </DatasetsProvider>
    </ToastProvider>
  );
}

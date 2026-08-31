import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/useAuth';
import LoginForm from './components/LoginForm';
import Layout from './components/Layout';
import AppErrorBoundary from './components/AppErrorBoundary';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const CompanyDetail = lazy(() => import('./pages/CompanyDetail'));
const DataProcessing = lazy(() => import('./pages/DataProcessing'));
const OwnershipGraph = lazy(() => import('./pages/OwnershipGraph'));
const RatingCenter = lazy(() => import('./pages/RatingCenter'));
const NewsCenter = lazy(() => import('./pages/NewsCenter'));
const NotFound = lazy(() => import('./pages/NotFound'));

function AppRoutes() {
  const { authenticated } = useAuth();

  if (!authenticated) return <LoginForm />;

  return (
    <Suspense fallback={<div className="page-loader">Sayfa yükleniyor...</div>}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/company" element={<CompanyDetail />} />
          <Route path="/processing" element={<DataProcessing />} />
          <Route path="/graph" element={<OwnershipGraph />} />
          <Route path="/ratings" element={<RatingCenter />} />
          <Route path="/news" element={<NewsCenter />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppErrorBoundary>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AppErrorBoundary>
      </AuthProvider>
    </ThemeProvider>
  );
}

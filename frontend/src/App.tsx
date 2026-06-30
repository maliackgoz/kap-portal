import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/useAuth';
import LoginForm from './components/LoginForm';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CompanyDetail from './pages/CompanyDetail';
import DataProcessing from './pages/DataProcessing';
import GraphPlaceholder from './pages/GraphPlaceholder';
import RatingCenter from './pages/RatingCenter';
import NewsCenter from './pages/NewsCenter';

function AppRoutes() {
  const { authenticated } = useAuth();

  if (!authenticated) return <LoginForm />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/company" element={<CompanyDetail />} />
        <Route path="/processing" element={<DataProcessing />} />
        <Route path="/graph" element={<GraphPlaceholder />} />
        <Route path="/ratings" element={<RatingCenter />} />
        <Route path="/news" element={<NewsCenter />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

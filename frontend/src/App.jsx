import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { StoreProvider } from './contexts/StoreContext';
import ProtectedRoute from './components/ProtectedRoute';
import Navbar from './components/Navbar';
import LoginPage from './pages/LoginPage';
import RegisterOrgPage from './pages/RegisterOrgPage';
import PricingPage from './pages/PricingPage';
import PaymentSuccessPage from './pages/PaymentSuccessPage';
import DashboardPage from './pages/DashboardPage';
import ChatPage from './pages/ChatPage';
import InventoryPage from './pages/InventoryPage';
import ManageEmployeesPage from './pages/ManageEmployeesPage';
import StoreManagementPage from './pages/StoreManagementPage';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <StoreProvider>
          <Navbar />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register/org" element={<RegisterOrgPage />} />
            <Route path="/pricing" element={
              <ProtectedRoute><PricingPage /></ProtectedRoute>
            } />
            <Route path="/payment/success" element={
              <ProtectedRoute><PaymentSuccessPage /></ProtectedRoute>
            } />
            <Route path="/dashboard" element={
              <ProtectedRoute requiredTier="tier1"><DashboardPage /></ProtectedRoute>
            } />
            <Route path="/chat" element={
              <ProtectedRoute requiredTier="tier2"><ChatPage /></ProtectedRoute>
            } />
            <Route path="/inventory" element={
              <ProtectedRoute requiredTier="tier1"><InventoryPage /></ProtectedRoute>
            } />
            <Route path="/manage-employees" element={
              <ProtectedRoute adminOnly managerOk requiredTier="tier1"><ManageEmployeesPage /></ProtectedRoute>
            } />
            <Route path="/stores" element={
              <ProtectedRoute adminOnly requiredTier="tier1"><StoreManagementPage /></ProtectedRoute>
            } />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </StoreProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

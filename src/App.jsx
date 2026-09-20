import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import MediaPage from './pages/MediaPage'
import QrPage from './pages/QrPage'
import LoginPage from './pages/LoginPage'
import VmbPage from './pages/VmbPage'
import RequireToolsAuth from './components/auth/RequireToolsAuth'

/**
 * Tools App.
 *
 *   /login → đăng nhập (public)
 *   /      → thư viện tài nguyên   (yêu cầu đăng nhập)
 *   /qr    → tạo mã QR              (yêu cầu đăng nhập)
 *   /vmb   → vé máy bay             (YÊU CẦU ĐĂNG NHẬP — đổi từ Phase D
 *              trở đi, dùng chung tools_user cho cả 3 tab, per-user 2FA
 *              secret cho tab Tra cứu)
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route path="/" element={
          <RequireToolsAuth><MediaPage /></RequireToolsAuth>
        } />
        <Route path="/qr" element={
          <RequireToolsAuth><QrPage /></RequireToolsAuth>
        } />
        <Route path="/vmb" element={
          <RequireToolsAuth><VmbPage /></RequireToolsAuth>
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

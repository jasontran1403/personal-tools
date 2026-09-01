import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import MediaPage from './pages/MediaPage'
import QrPage from './pages/QrPage'

/**
 * Tools App — tools.domain.com
 *
 * Routing (tất cả public, không cần đăng nhập):
 *   /     → thư viện tài nguyên (Hình ảnh · Tệp · Office · Watermark · Todo)
 *   /qr   → tạo mã QR
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"   element={<MediaPage />} />
        <Route path="/qr" element={<QrPage />} />
        <Route path="*"   element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

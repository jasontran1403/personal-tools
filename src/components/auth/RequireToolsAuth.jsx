import { Navigate, useLocation } from 'react-router-dom'
import { useToolsAuth } from '../../hooks/useToolsAuth'

/**
 * Bọc route riêng tư. Ba khả năng:
 *   - Đang verify token → hiện Skeleton (tránh flash "chưa đăng nhập" khi
 *     người dùng thật sự đã đăng nhập rồi refresh).
 *   - Verify xong, không có auth → redirect /login, gắn `back` để đăng nhập
 *     xong quay lại đúng chỗ (kể cả query string).
 *   - Có auth → render children.
 *
 * Ngoài ra chặn theo quyền admin qua prop `requireAdmin` — nếu tab/trang chỉ
 * dành cho admin (ví dụ QLNguoiDung), bọc thêm cấp nữa.
 */
export default function RequireToolsAuth({ children, requireAdmin = false }) {
  const { auth, ready } = useToolsAuth()
  const location = useLocation()

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span>Đang kiểm tra phiên đăng nhập…</span>
        </div>
      </div>
    )
  }

  if (!auth) {
    const back = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?back=${back}`} replace />
  }

  if (requireAdmin && !auth.admin) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="text-5xl mb-3">🔒</div>
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Không đủ quyền</h1>
          <p className="text-sm text-gray-500">Trang này chỉ dành cho quản trị viên.</p>
        </div>
      </div>
    )
  }

  return children
}

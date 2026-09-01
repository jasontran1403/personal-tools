import { useNavigate } from 'react-router-dom'

/**
 * Khung chung cho 3 trang tiện ích (QR / Ký số / Watermark).
 *
 * Cố ý KHÔNG có menu điều hướng: các trang này không xuất hiện ở đâu cả,
 * ai biết đường dẫn thì vào. Chỉ có nút quay lại và slot cho hành động chính.
 *
 * Full-width + responsive giống khu vực Kế toán để UI đồng bộ.
 */
export default function ToolShell({ icon, title, subtitle, actions, children, fullBleed = false }) {
  const nav = useNavigate()
  // Người dùng thường mở thẳng link (không qua trang nào khác) nên history
  // rỗng — lúc đó ẩn nút quay lại thay vì bấm vào không có phản ứng gì.
  const canGoBack = typeof window !== 'undefined' && window.history.length > 1

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm shrink-0">
        <div className="w-full px-4 sm:px-6 lg:px-8 flex items-center h-14 gap-3">
          {canGoBack && (
            <button
              onClick={() => nav(-1)}
              aria-label="Quay lại"
              className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
            >
              ←
            </button>
          )}

          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 shrink-0 bg-blue-600 rounded-lg flex items-center justify-center text-base">
              {icon}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-gray-900 text-sm leading-tight truncate">{title}</p>
              {subtitle && (
                <p className="text-xs text-gray-400 leading-tight truncate hidden sm:block">{subtitle}</p>
              )}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </div>
      </header>

      <main className={fullBleed
        ? 'flex-1 min-h-0 flex flex-col'
        : 'flex-1 w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-6'}>
        {children}
      </main>
    </div>
  )
}

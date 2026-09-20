import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import Tabs from '../components/common/Tabs'
import UserMenu from '../components/auth/UserMenu'
import TicketsTab   from '../components/vmb/TicketsTab'
import PassengersTab from '../components/vmb/PassengersTab'
import LookupTab    from '../components/vmb/LookupTab'
import TodoTab      from '../components/vmb/TodoTab'
import useTodayTaskStats from '../hooks/useTodayTaskStats'

/**
 * Trang /vmb — bắt buộc đăng nhập (Phase D). Route được bọc RequireToolsAuth
 * ở App.jsx nên vào được đây chắc chắn đã có user.
 *
 * ── Full-width layout ────────────────────────────────────────
 * Không cap max-width — nhân viên vé làm việc trên màn 27" cần tận dụng hết
 * chiều ngang cho bảng 16 cột.
 *
 * ── 2026-09-20: thêm tab Todo ─────────────────────────────
 * Tab thứ 4, layout calendar 7 ngày. Cùng lúc bơm badge "số task còn phải
 * hoàn thành trong ngày" + countdown deadline gần nhất vào tab Tra cứu qua
 * hook {@link useTodayTaskStats}. Badge tự cập nhật mỗi 30s (poll BE) + tick
 * countdown mỗi giây.
 */
const BASE_TABS = [
  { key: 'tickets',     label: 'Vé máy bay',      icon: '✈️' },
  { key: 'passengers',  label: 'Thông tin khách', icon: '👥' },
  { key: 'lookup',      label: 'Tra cứu',         icon: '🔎' },
  { key: 'todo',        label: 'Todo',            icon: '📋' },
]

export default function VmbPage() {
  const [params, setParams] = useSearchParams()
  const tab = BASE_TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'tickets'

  const setTab = (k) => {
    const next = new URLSearchParams(params)
    next.set('tab', k)
    setParams(next, { replace: true })
  }

  // ── Stats today cho badge Todo ──────────────────────
  // refresh: expose ra để truyền xuống TodoTab, gọi ngay sau mỗi thao tác
  // (tạo/sửa/xóa/complete/extend/cancel) → badge sync tức thì, không chờ
  // 30s poll interval.
  const { pendingCount, countdownLabel, refresh: refreshTaskStats } = useTodayTaskStats()

  // Bơm badge động vào tab TODO — copy mảng để không mutate constants
  // ── 2026-09-20: badge chuyển từ tab "Tra cứu" → "Todo" cho đúng ngữ nghĩa ──
  const tabs = useMemo(() => BASE_TABS.map(t => {
    if (t.key !== 'todo') return t
    if (!pendingCount) return t
    // Badge: "4 · 1h23m" (số task còn lại + countdown deadline gần nhất)
    const parts = [String(pendingCount)]
    if (countdownLabel) parts.push(countdownLabel)
    return { ...t, badge: parts.join(' · ') }
  }), [pendingCount, countdownLabel])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Không mount Toaster ở đây — main.jsx đã có global Toaster */}

      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-white/40 shadow-sm">
        <div className="w-full px-3 sm:px-4 py-2 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600
              text-white flex items-center justify-center shadow-lg shadow-blue-500/20">
              ✈️
            </span>
            <div>
              <div className="text-sm font-bold text-gray-900 leading-tight">Vé máy bay</div>
              <div className="text-[10px] text-gray-500 leading-tight">Nhật Nam Tools</div>
            </div>
          </div>
          <div className="flex-1" />
          <Link to="/"
            className="text-xs text-gray-500 hover:text-gray-800 font-medium px-3 py-1.5 rounded-lg
                       hover:bg-gray-100 transition hidden sm:inline-flex">
            ← Về Tools
          </Link>
          <UserMenu />
        </div>

        {/* Tabs */}
        <div className="w-full px-3 sm:px-4">
          <Tabs
            tabs={tabs}
            active={tab}
            onChange={setTab}
          />
        </div>
      </header>

      {/* Nội dung theo tab — full width, padding hẹp */}
      <main className="w-full px-2 sm:px-3 py-3">
        {tab === 'tickets'    && <TicketsTab />}
        {tab === 'passengers' && <PassengersTab />}
        {tab === 'lookup'     && <LookupTab />}
        {tab === 'todo'       && <TodoTab onTasksChanged={refreshTaskStats} />}
      </main>
    </div>
  )
}
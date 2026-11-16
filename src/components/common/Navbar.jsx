import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Navbar dùng chung cho /vmb — thay thế Tabs cũ.
 *
 * ── Desktop (≥ sm) ─────────────────────────────────────────
 *   Hiển thị nguyên hàng tab ngang (icon + label) + badge nếu có.
 *   Active tab có gạch chân xanh (giống Tabs cũ).
 *
 * ── Mobile (< sm) ──────────────────────────────────────────
 *   Thu lại thành icon ☰ (burger). Click mở drawer tối giữa màn hình
 *   (theo screenshot: khung tròn, các mục căn giữa, nút × đóng).
 *   Drawer gồm:
 *     • Danh sách tab (click → switch + đóng)
 *     • Mục "Đăng xuất" (callback onLogout)
 *
 * Props:
 *   tabs       — [{ key, icon?, label, badge? }]
 *   active     — key đang chọn
 *   onChange   — (newKey) => void
 *   onLogout   — () => void (hiển thị trong menu mobile)
 *   userName   — tên user (hiển thị trong menu mobile, optional)
 */
export default function Navbar({ tabs, active, onChange, onLogout, userName }) {
  const [open, setOpen] = useState(false)

  // Đóng drawer khi đổi tab
  const handleClick = key => {
    if (key !== active) onChange?.(key)
    setOpen(false)
  }

  return (
    <>
      {/* ── Desktop: tab bar ngang ── */}
      <div className="hidden sm:flex w-full items-center gap-1 overflow-x-auto overflow-y-hidden
          [touch-action:pan-x] [overscroll-behavior-x:contain]
          [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map(({ key, icon, label, badge }) => {
          const isActive = key === active
          return (
            <button
              key={key}
              type="button"
              onClick={() => handleClick(key)}
              className={`flex items-center gap-1.5 px-3 sm:px-4 h-12 text-sm font-semibold
                border-b-2 -mb-px whitespace-nowrap shrink-0 transition-colors
                ${isActive
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'}`}
            >
              {icon && <span>{icon}</span>}
              <span>{label}</span>
              {badge != null && badge !== '' && (
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold
                  ${isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Mobile: nút burger icon ── */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="sm:hidden inline-flex items-center justify-center w-10 h-10 rounded-full
                   bg-white border border-gray-200 shadow-sm active:scale-95 transition
                   dark:bg-slate-800 dark:border-slate-700"
        aria-label="Mở menu"
      >
        <svg viewBox="0 0 20 20" className="w-5 h-5 text-gray-700 dark:text-gray-200" fill="currentColor">
          <path d="M3 5h14v2H3V5zm0 4h14v2H3V9zm0 4h14v2H3v-2z" />
        </svg>
      </button>

      {open && (
        <MobileDrawer
          tabs={tabs}
          active={active}
          userName={userName}
          onClick={handleClick}
          onLogout={() => { setOpen(false); onLogout?.() }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** Mobile drawer: giữa màn hình, nền tối, khung tròn (mô phỏng screenshot). */
function MobileDrawer({ tabs, active, userName, onClick, onLogout, onClose }) {
  const panelRef = useRef(null)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const content = (
    <div
      className="fixed inset-0 flex items-center justify-center p-6"
      style={{ zIndex: 2147483646 }}
      role="dialog" aria-modal="true"
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel tròn — mô phỏng ảnh mẫu user gửi */}
      <div
        ref={panelRef}
        className="relative w-full max-w-xs rounded-[2rem] bg-slate-900 text-white
                   border border-slate-800 shadow-2xl overflow-hidden"
        style={{ animation: 'drawerIn .18s ease-out' }}
      >
        {/* Nút đóng góc trên phải */}
        <button
          type="button" onClick={onClose}
          aria-label="Đóng"
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20
                     flex items-center justify-center text-lg leading-none"
        >
          ×
        </button>

        {userName && (
          <div className="pt-6 pb-3 text-left text-xs text-gray-400 border-b border-white/5 px-6">
            Xin chào <span className="font-semibold text-gray-200">{userName}</span>
          </div>
        )}

        {/* 2026-11-16: Canh TRÁI toàn bộ menu mobile. */}
        <div className="py-6 px-4 flex flex-col items-stretch gap-1">
          {tabs.map(({ key, label, badge }) => {
            const isActive = key === active
            return (
              <button
                key={key}
                type="button"
                onClick={() => onClick(key)}
                className={`w-full py-3 px-4 text-base font-semibold rounded-xl transition text-left
                  ${isActive
                    ? 'bg-white/10 text-white'
                    : 'text-gray-200 hover:bg-white/5'}`}
              >
                <span className="inline-flex items-center gap-2">
                  {label}
                  {badge != null && badge !== '' && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500 text-white">
                      {badge}
                    </span>
                  )}
                </span>
              </button>
            )
          })}

          {/* Đăng xuất — luôn ở cuối, canh trái */}
          <button
            type="button"
            onClick={onLogout}
            className="w-full mt-2 py-3 px-4 text-base font-semibold rounded-xl text-left
                       text-rose-300 hover:bg-rose-500/10 transition"
          >
            ⏻ Đăng xuất
          </button>
        </div>
      </div>

      <style>{`
        @keyframes drawerIn {
          from { opacity: 0; transform: scale(.96); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(content, document.body)
}

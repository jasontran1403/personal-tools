import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/**
 * ThemeProvider — quản lý dark / light / system cho toàn app.
 *
 * ── 3 mode ─────────────────────────────────────────────────
 *   'light'  — luôn sáng
 *   'dark'   — luôn tối
 *   'system' — theo prefers-color-scheme của OS (watch thay đổi real-time)
 *
 * ── Áp dụng ───────────────────────────────────────────────
 *   Toggle thêm/xoá class "dark" trên <html>. CSS override toàn bộ ở
 *   src/theme/darkmode.css dựa vào selector `html.dark .bg-white`, …
 *   → không phải sửa từng component Tailwind sẵn có.
 *
 * ── Persistence ───────────────────────────────────────────
 *   localStorage key 'theme-mode' = 'light'|'dark'|'system'. Default
 *   'system' (nếu chưa chọn gì).
 *
 * ── FOUC ──────────────────────────────────────────────────
 *   main.jsx chạy applyThemeFromStorage() TRƯỚC khi React mount để
 *   gán class ngay, tránh flash trắng khi đang ở mode dark.
 */

const STORAGE_KEY = 'theme-mode'
const MODES = ['light', 'dark', 'system']

const ThemeContext = createContext({
  mode: 'system',
  resolved: 'light',
  setMode: () => {},
  toggle: () => {},
})

export function useTheme() { return useContext(ThemeContext) }

export function ThemeProvider({ children }) {
  const [mode, setModeRaw] = useState(() => readMode())
  const [systemDark, setSystemDark] = useState(() => prefersDark())

  // Lắng system preference khi mode === 'system'
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e) => setSystemDark(e.matches)
    // Safari <14 dùng addListener
    if (mql.addEventListener) mql.addEventListener('change', onChange)
    else mql.addListener(onChange)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange)
      else mql.removeListener(onChange)
    }
  }, [])

  const resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

  // Sync class lên <html>
  useEffect(() => {
    applyResolved(resolved)
  }, [resolved])

  const setMode = useCallback((next) => {
    if (!MODES.includes(next)) return
    setModeRaw(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch {}
  }, [])

  const toggle = useCallback(() => {
    // Cycle light → dark → system → light
    setMode(mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light')
  }, [mode, setMode])

  const value = useMemo(() => ({ mode, resolved, setMode, toggle }), [mode, resolved, setMode, toggle])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// ────────────────────────────────────────────────────────────
// Helpers (cũng dùng được ngoài component)
// ────────────────────────────────────────────────────────────

function readMode() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {}
  return 'system'
}

function prefersDark() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
  } catch { return false }
}

function applyResolved(resolved) {
  const root = document.documentElement
  if (resolved === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
  root.style.colorScheme = resolved === 'dark' ? 'dark' : 'light'
}

/**
 * Gọi trước khi mount React (ở main.jsx) để tránh flash sáng khi user
 * đang chọn dark mode.
 */
export function applyThemeFromStorage() {
  const mode = readMode()
  const resolved = mode === 'system' ? (prefersDark() ? 'dark' : 'light') : mode
  applyResolved(resolved)
}

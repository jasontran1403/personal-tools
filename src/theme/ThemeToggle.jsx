import { useTheme } from './ThemeProvider'

/**
 * ThemeToggle — nút cycle Light → Dark → System.
 *
 * Props:
 *   compact — true: chỉ icon tròn (dùng cho header mobile).
 *             false (default): icon + label.
 */
export default function ThemeToggle({ compact = false, className = '' }) {
  const { mode, resolved, toggle } = useTheme()

  const icon = mode === 'light' ? SunIcon : mode === 'dark' ? MoonIcon : SystemIcon
  const label = mode === 'light' ? 'Sáng' : mode === 'dark' ? 'Tối' : 'Theo máy'
  const title = `Giao diện: ${label} (click để đổi) · hiện đang ${resolved === 'dark' ? 'tối' : 'sáng'}`

  const Icon = icon

  if (compact) {
    return (
      <button type="button" onClick={toggle} title={title} aria-label={title}
        className={`w-9 h-9 rounded-full border border-gray-200 bg-white hover:bg-gray-50
          shadow-sm transition flex items-center justify-center ${className}`}>
        <Icon className="w-4 h-4 text-gray-600" />
      </button>
    )
  }

  return (
    <button type="button" onClick={toggle} title={title}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-gray-200
        bg-white hover:bg-gray-50 shadow-sm text-xs font-semibold text-gray-700 transition ${className}`}>
      <Icon className="w-4 h-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

function SunIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}
function MoonIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}
function SystemIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  )
}

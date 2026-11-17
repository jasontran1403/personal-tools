import { useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import Navbar from '../components/common/Navbar'
import UserMenu from '../components/auth/UserMenu'
import ThemeToggle from '../theme/ThemeToggle'
import { useToolsAuth } from '../hooks/useToolsAuth'
import TicketsTab   from '../components/vmb/TicketsTab'
import PassengersTab from '../components/vmb/PassengersTab'
import CustomersTab  from '../components/vmb/Customerstab'
import LookupTab    from '../components/vmb/LookupTab'
import TodoTab      from '../components/vmb/TodoTab'
import PdfTab       from '../components/vmb/pdf/PdfTab'
import FinanceTab   from '../components/vmb/finance/FinanceTab'
import OfficeWorkspace from '../components/office/OfficeWorkspace'
import FilesBrowser    from '../components/files/FilesBrowser'
import InvoicesPage    from '../components/vmb/invoices/InvoicesPage'
import useTodayTaskStats from '../hooks/useTodayTaskStats'

/**
 * Trang /vmb — version 2026-11-16.
 *
 * ── Thay đổi so với bản trước ───────────────────────────────
 * • Tabs cũ → Navbar (desktop hiển thị hàng tab, mobile thu lại thành burger).
 * • Thêm tab "Tài chính".
 * • Bỏ nút "← Về Tools" (desktop lẫn mobile).
 * • Mobile: giữ nút theme sáng/tối/auto ở dòng đầu, kế bên icon burger.
 *   Mục Đăng xuất chuyển vào trong menu burger.
 */
const BASE_TABS = [
  { key: 'tickets',     label: 'Vé máy bay',  icon: '✈️' },
  { key: 'customers',   label: 'Khách hàng',  icon: '🏢' },
  { key: 'passengers',  label: 'Thông tin',   icon: '👥' },
  { key: 'finance',     label: 'Tài chính',   icon: '💰' },
  { key: 'lookup',      label: 'Tra cứu',     icon: '🔎' },
  { key: 'pdf',         label: 'Pdf',         icon: '📄' },
  { key: 'office',      label: 'Office',      icon: '📊' },
  { key: 'files',       label: 'Tệp',         icon: '📁' },
  { key: 'todo',        label: 'Todo',        icon: '📋' },
]

export default function VmbPage() {
  const [params, setParams] = useSearchParams()
  const tab = BASE_TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'tickets'
  const { auth, logout } = useToolsAuth()

  const [invoicesOpen, setInvoicesOpen]       = useState(false)
  const [invoicesMounted, setInvoicesMounted] = useState(false)
  const [invReload, setInvReload]   = useState(0)
  const [tickReload, setTickReload] = useState(0)

  const openInvoices = () => { setInvoicesMounted(true); setInvoicesOpen(true); setInvReload(x => x + 1) }
  const closeInvoices = () => { setInvoicesOpen(false); setTickReload(x => x + 1) }

  useEffect(() => {
    const on = tab === 'tickets' && invoicesOpen
    document.body.classList.toggle('vmb-invoices-open', on)
    return () => document.body.classList.remove('vmb-invoices-open')
  }, [tab, invoicesOpen])

  const setTab = (k) => {
    const next = new URLSearchParams(params)
    next.set('tab', k)
    setParams(next, { replace: true })
    setInvoicesOpen(false)
  }

  // Logout flow — giữ confirm giống cũ
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const doLogout = () => {
    try { logout() } catch (_) {}
    try { localStorage.clear() } catch (_) {}
    toast.success('Đã đăng xuất')
    window.location.href = '/'
  }

  const { pendingCount, countdownLabel, refresh: refreshTaskStats } = useTodayTaskStats()

  const tabs = useMemo(() => BASE_TABS.map(t => {
    if (t.key !== 'todo') return t
    if (!pendingCount) return t
    const parts = [String(pendingCount)]
    if (countdownLabel) parts.push(countdownLabel)
    return { ...t, badge: parts.join(' · ') }
  }), [pendingCount, countdownLabel])

  const userName = auth?.displayName || auth?.username || ''

  return (
    <div className="h-dvh overflow-hidden flex flex-col bg-gradient-to-br from-slate-50 to-blue-50">
      <style>{`body.vmb-invoices-open .vmb-fab{display:none !important}`}</style>

      {/* Header */}
      <header className="shrink-0 z-30 bg-white/80 backdrop-blur-xl border-b border-white/40 shadow-sm">
        <div className="w-full px-3 sm:px-4 py-2 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600
              text-white flex items-center justify-center shadow-lg shadow-blue-500/20">
              ✈️
            </span>
            <div>
              <div className="text-sm font-bold text-gray-900 leading-tight">247</div>
              <div className="text-[10px] text-gray-500 leading-tight">Cùng Bay</div>
            </div>
          </div>

          <div className="flex-1" />

          {/* ── Mobile: Theme toggle + Burger (dòng đầu, không có link về Tools) ── */}
          <div className="flex sm:hidden items-center gap-2">
            <ThemeToggle />
            <Navbar
              tabs={tabs}
              active={tab}
              onChange={setTab}
              onLogout={() => setShowLogoutConfirm(true)}
              userName={userName}
            />
          </div>

          {/* ── Desktop: UserMenu (gồm theme + avatar đăng xuất) ── */}
          <div className="hidden sm:flex items-center gap-2">
            <UserMenu />
          </div>
        </div>

        {/* ── Desktop: hàng Navbar ngang ──
            2026-11-17: bỏ bg-white/85 (không được darkmode override → trắng chói
            trong theme tối). Để trong suốt cho kế thừa nền header đã theme sẵn. */}
        <div className="w-full px-3 sm:px-4 hidden sm:block border-t border-gray-200 dark:border-slate-700">
          <Navbar
            tabs={tabs}
            active={tab}
            onChange={setTab}
            onLogout={() => setShowLogoutConfirm(true)}
            userName={userName}
          />
        </div>
      </header>

      <main className="flex-1 overflow-hidden w-full px-2 sm:px-3 py-3">
        {tab === 'tickets' && (
          <div className="relative h-full overflow-hidden">
            <div
              className="flex h-full w-[200%] transition-transform duration-300 ease-out"
              style={{ transform: invoicesOpen ? 'translateX(-50%)' : 'translateX(0)' }}
            >
              <div className="w-1/2 h-full min-w-0 overflow-hidden">
                <TicketsTab onOpenInvoices={openInvoices} fabHidden={invoicesOpen} refreshSignal={tickReload} />
              </div>
              <div className="w-1/2 h-full min-w-0 overflow-hidden">
                {invoicesMounted && <InvoicesPage onBack={closeInvoices} refreshSignal={invReload} />}
              </div>
            </div>
          </div>
        )}
        {tab === 'customers'  && <CustomersTab />}
        {tab === 'passengers' && <PassengersTab />}
        {tab === 'finance'    && <FinanceTab />}
        {tab === 'lookup'     && <LookupTab />}
        {tab === 'pdf'        && <PdfTab />}
        {tab === 'office'     && <OfficeWorkspace onNotify={(msg, ok=true) => (ok ? toast.success(msg) : toast.error(msg))} />}
        {tab === 'files'      && <FilesBrowser    onNotify={(msg, ok=true) => (ok ? toast.success(msg) : toast.error(msg))} />}
        {tab === 'todo'       && <TodoTab onTasksChanged={refreshTaskStats} />}
      </main>

      {showLogoutConfirm && (
        <LogoutConfirm
          display={userName}
          onCancel={() => setShowLogoutConfirm(false)}
          onConfirm={() => { setShowLogoutConfirm(false); doLogout() }}
        />
      )}
    </div>
  )
}

/** Confirm đăng xuất — reuse style cũ trong UserMenu nhưng tách ra để dùng từ Navbar. */
function LogoutConfirm({ display, onCancel, onConfirm }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onCancel])

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 2147483647 }}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-100 p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center text-xl shrink-0">⏻</div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900">Xác nhận đăng xuất</h3>
            <p className="mt-1 text-sm text-gray-600">
              Bạn có chắc muốn đăng xuất{display ? <> khỏi tài khoản <span className="font-semibold">{display}</span></> : null}?
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100">Hủy</button>
          <button type="button" onClick={onConfirm} autoFocus
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700">
            Đăng xuất
          </button>
        </div>
      </div>
    </div>
  )
}

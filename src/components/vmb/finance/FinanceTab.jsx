import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { listFinanceAccounts, setAccountInitial, syncFinanceLedger } from '../../../services/vmbApi'
import AccountHistoryModal from './AccountHistoryModal'
import ExpenseModal from './ExpenseModal'
import ExchangeRatePanel from './ExchangeRatePanel'
import { parseAmount, formatMoney } from '../../../lib/money'

// 2026-11-19: Gom chữ số + chèn dấu "." ngăn cách nghìn (số nguyên, chuẩn VN),
//   format NGAY mỗi lần gõ/xóa 1 ký tự.
export const groupVnInt = (v) => {
  const d = String(v ?? '').replace(/[^0-9]/g, '')
  return d ? d.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : ''
}

/**
 * Tab "Tài chính".
 *
 * ── 2026-11-17 (v3) ───────────────────────────────────────
 * • QUAN TRỌNG: project dùng dark-theme bằng CLASS (html.dark + darkmode.css),
 *   KHÔNG dùng Tailwind `dark:` (vốn chạy theo prefers-color-scheme của OS).
 *   → Ở đây CHỈ viết class sáng (bg-white, text-gray-*, bg-gray-*…) và để
 *   darkmode.css tự override cho theme tối. Tuyệt đối không dùng `dark:`.
 * • Layout full width, màu dịu dễ đọc, số dư để màu trung tính.
 */

// Dải accent trái + nền icon. Dùng tone -600 (đậm vừa), giữ nguyên ở 2 theme.
const ACCENTS = {
  CASH:       { bar: 'bg-emerald-600', icon: '💵', chip: 'bg-emerald-100 text-emerald-700' },
  HD:         { bar: 'bg-blue-600',    icon: '🏦', chip: 'bg-blue-100 text-blue-700' },
  VCB:        { bar: 'bg-cyan-600',    icon: '🏛️', chip: 'bg-cyan-100 text-cyan-700' },
  HNH_DEBT:   { bar: 'bg-rose-600',    icon: '📋', chip: 'bg-rose-100 text-rose-700' },
  VJ_DEPOSIT: { bar: 'bg-amber-600',   icon: '🧾', chip: 'bg-amber-100 text-amber-700' },
}

export default function FinanceTab() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading]   = useState(true)
  const [history, setHistory]   = useState(null)
  const [showExpense, setShowExpense] = useState(false)
  const [editInitial, setEditInitial] = useState(null)
  const [initialAmt, setInitialAmt] = useState('')
  const [showSync, setShowSync] = useState(false)   // 2026-11-19: đồng bộ sổ cái

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listFinanceAccounts()
      setAccounts(res.data?.data || [])
    } catch (e) {
      toast.error('Không tải được tài khoản')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const spendable = accounts.filter(a => !a.isVirtual)
  const virtual   = accounts.filter(a => a.isVirtual)

  const saveInitial = async () => {
    if (!editInitial) return
    const n = parseAmount(initialAmt)
    if (!(n >= 0)) return toast.error('Số tiền không hợp lệ')
    try {
      await setAccountInitial(editInitial.id, formatMoney(n, 'VND', { withUnit: false }))
      toast.success('Đã cập nhật số dư')
      setEditInitial(null)
      setInitialAmt('')
      load()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Thất bại')
    }
  }

  return (
    <div className="h-full overflow-auto">
      <div className="w-full px-3 sm:px-5 py-4 space-y-6">

        {/* ── Top bar ── */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-bold text-gray-900">Tài chính</div>
            <div className="text-xs text-gray-500">
              Quản lý các tài khoản thu/chi &amp; công nợ.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setShowSync(true)}
              className="px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold
                         shadow-sm hover:bg-teal-700 active:scale-95 transition">
              🔄 Đồng bộ sổ cái
            </button>
            <button type="button" onClick={() => setShowExpense(true)}
              className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold
                         shadow-sm hover:bg-violet-700 active:scale-95 transition">
              💸 Chi
            </button>
          </div>
        </div>

        {/* ── Tài khoản chi được ── */}
        <section>
          <SectionLabel>Tài khoản</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {spendable.map(acc => (
              <AccountCard key={acc.id} acc={acc}
                onHistory={() => setHistory({ account: acc })}
                onSetInitial={() => { setEditInitial(acc); setInitialAmt(acc.balance || '') }} />
            ))}
            {loading && spendable.length === 0 && (
              <div className="sm:col-span-2 xl:col-span-3 text-center text-sm text-gray-400 py-10">Đang tải…</div>
            )}
          </div>
        </section>

        {/* ── Công nợ / ký quỹ ── */}
        <section>
          <SectionLabel>Công nợ &amp; Ký quỹ</SectionLabel>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {virtual.map(acc => (
              <AccountCard key={acc.id} acc={acc}
                onHistory={() => setHistory({ account: acc })}
                onSetInitial={() => { setEditInitial(acc); setInitialAmt(acc.balance || '') }}
                virtual />
            ))}
          </div>
        </section>

        {/* ── Tỷ giá quy đổi (2026-11-19) ── */}
        <section>
          <SectionLabel>Tỷ giá quy đổi</SectionLabel>
          <ExchangeRatePanel />
        </section>

        {/* ── Hint ── */}
        <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-100 text-[12px] leading-relaxed text-gray-700">
          💡 <b>Quy tắc tự động:</b> công nợ HNH lưu dạng <b>số âm</b> (âm = mình đang nợ).
          Khi bán vé, <b>công nợ HNH</b> tăng theo giá vốn (giá gốc + phí thu hộ + phí xuất
          vé) cho vé <b>KHÁC VJ</b> → số dư âm thêm; vé <b>VJ</b> trừ vào tài khoản
          <b>ký quỹ VJ</b>. Thanh toán vé vào tài khoản nào thì tài khoản đó tăng. Chi từ
          tiền mặt/VCB/HD sang <b>HNH</b> sẽ giảm công nợ (số dư tăng dần về 0); chi sang
          <b> ký quỹ VJ</b> sẽ tăng ký quỹ.
        </div>
      </div>

      {history && (
        <AccountHistoryModal
          account={history.account}
          onClose={() => setHistory(null)}
          onChanged={load}
        />
      )}

      {showExpense && (
        <ExpenseModal
          accounts={accounts}
          onClose={() => setShowExpense(false)}
          onSaved={() => { setShowExpense(false); load() }}
        />
      )}

      {editInitial && (
        <InitialBalanceModal
          account={editInitial}
          value={initialAmt}
          onChange={setInitialAmt}
          onCancel={() => { setEditInitial(null); setInitialAmt('') }}
          onConfirm={saveInitial}
        />
      )}

      {showSync && (
        <LedgerSyncModal
          accounts={accounts}
          onCancel={() => setShowSync(false)}
          onSaved={() => { setShowSync(false); load() }}
        />
      )}
    </div>
  )
}

/**
 * ── 2026-11-19: Đồng bộ sổ cái ──────────────────────────────
 * Nhập lại số dư 5 tài khoản (tiền mặt, VCB, HD, công nợ HNH, ký quỹ VJ).
 * Mặc định = số dư hiện tại; user chỉ sửa ô cần đổi. Input format VN, số nguyên.
 * Lưu → BE chốt mốc; lịch sử trước mốc không hiển thị nữa.
 */
const SYNC_ORDER = ['CASH', 'VCB', 'HD', 'HNH_DEBT', 'VJ_DEPOSIT']
const SYNC_LABEL = {
  CASH: 'Tiền mặt', VCB: 'Tài khoản Vietcombank', HD: 'Tài khoản HD',
  HNH_DEBT: 'Công nợ HNH', VJ_DEPOSIT: 'Ký quỹ VJ',
}
function LedgerSyncModal({ accounts, onCancel, onSaved }) {
  const byCode = {}
  for (const a of accounts) byCode[a.code] = a
  // Khởi tạo input = số dư hiện tại (đã có dấu chấm). Dùng abs cho ô, giữ dấu âm riêng.
  const [vals, setVals] = useState(() => {
    const init = {}
    for (const code of SYNC_ORDER) {
      const raw = byCode[code]?.balance || '0'
      const neg = parseAmount(raw) < 0
      init[code] = { text: groupVnInt(raw), neg }
    }
    return init
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, busy])

  const setCode = (code, patch) => setVals(v => ({ ...v, [code]: { ...v[code], ...patch } }))

  const submit = async () => {
    const body = {}
    for (const code of SYNC_ORDER) {
      const digits = (vals[code].text || '').replace(/[^0-9]/g, '') || '0'
      body[code] = (vals[code].neg ? '-' : '') + digits
    }
    setBusy(true)
    try {
      await syncFinanceLedger(body)
      toast.success('Đã đồng bộ sổ cái')
      onSaved()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Đồng bộ thất bại')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 120 }}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={busy ? undefined : onCancel} />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 max-h-[92vh] overflow-y-auto">
        <h3 className="text-base font-bold text-gray-900">🔄 Đồng bộ sổ cái</h3>
        <p className="mt-1 text-xs text-gray-500 leading-relaxed">
          Nhập lại số dư hiện có của từng tài khoản. Ô nào không đổi thì để nguyên.
          Sau khi đồng bộ, lịch sử giao dịch <b>trước thời điểm này</b> sẽ không hiển thị nữa.
        </p>

        <div className="mt-4 space-y-3">
          {SYNC_ORDER.map(code => {
            const virtual = code === 'HNH_DEBT' || code === 'VJ_DEPOSIT'
            return (
              <div key={code}>
                <label className="text-xs font-semibold text-gray-600">{SYNC_LABEL[code]}</label>
                <div className="mt-1 flex items-stretch gap-1.5">
                  {virtual && (
                    <button type="button"
                      onClick={() => setCode(code, { neg: !vals[code].neg })}
                      title="Đổi dấu âm/dương"
                      className={`px-3 rounded-lg border text-sm font-bold shrink-0 transition
                        ${vals[code].neg
                          ? 'bg-rose-100 border-rose-300 text-rose-700'
                          : 'bg-gray-100 border-gray-300 text-gray-600'}`}>
                      {vals[code].neg ? '−' : '+'}
                    </button>
                  )}
                  <input
                    type="text" inputMode="numeric"
                    value={vals[code].text}
                    onChange={e => setCode(code, { text: groupVnInt(e.target.value) })}
                    placeholder="0"
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900
                               font-mono text-lg text-right outline-none focus:border-blue-500" />
                  <span className="px-2 flex items-center text-sm text-gray-400 shrink-0">₫</span>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-50">Hủy</button>
          <button type="button" onClick={submit} disabled={busy}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
            {busy ? 'Đang đồng bộ…' : 'Đồng bộ'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div className="text-[11px] font-bold tracking-wide text-gray-400 uppercase mb-2">
      {children}
    </div>
  )
}

function AccountCard({ acc, onHistory, onSetInitial, virtual = false }) {
  const a = ACCENTS[acc.code] || { bar: 'bg-gray-400', icon: '💼', chip: 'bg-gray-100 text-gray-600' }
  const bal = parseAmount(acc.balance) || 0
  const negative = bal < 0
  return (
    <div className="relative flex rounded-2xl overflow-hidden bg-white border border-gray-200 shadow-sm">
      {/* Dải accent trái mảnh */}
      <div className={`w-1.5 shrink-0 ${a.bar}`} />

      <div className="flex-1 min-w-0 p-4">
        <div className="flex items-start gap-3">
          <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${a.chip}`}>
            {a.icon}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-gray-800 truncate">{acc.name}</div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400">
              {virtual ? 'Số dư ảo' : 'Số dư hiện tại'}
            </div>
            {/* Số dư màu trung tính cho dễ đọc; âm thì đỏ. */}
            <div className={`mt-0.5 text-2xl font-bold font-mono tabular-nums truncate ${negative ? 'text-rose-600' : 'text-gray-800'}`}>
              {negative ? '−' : ''}{formatMoney(Math.abs(bal), 'VND')}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={onSetInitial}
            className="flex-1 px-2 py-1.5 rounded-lg bg-gray-100 text-xs font-semibold text-gray-700
              hover:bg-gray-200 transition">
            {bal === 0 ? '+ Nạp đầu kỳ' : '✎ Sửa số dư'}
          </button>
          <button type="button" onClick={onHistory}
            className="flex-1 px-2 py-1.5 rounded-lg bg-gray-800 text-white text-xs font-semibold
              hover:bg-gray-900 transition">
            📊 Lịch sử
          </button>
        </div>
      </div>
    </div>
  )
}

function InitialBalanceModal({ account, value, onChange, onCancel, onConfirm }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 120 }}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5">
        <h3 className="text-base font-bold text-gray-900">Số dư cho {account.name}</h3>
        <p className="mt-1 text-xs text-gray-500">Nhập số dư hiện có để hệ thống làm mốc tính toán.</p>
        <input
          type="text" autoFocus inputMode="numeric"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="VD: 15.000.000"
          className="mt-3 w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900
                     font-mono text-lg outline-none focus:border-blue-500"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100">Hủy</button>
          <button type="button" onClick={onConfirm}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            Lưu
          </button>
        </div>
      </div>
    </div>
  )
}
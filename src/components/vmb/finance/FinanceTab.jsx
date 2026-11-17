import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { listFinanceAccounts, setAccountInitial } from '../../../services/vmbApi'
import AccountHistoryModal from './AccountHistoryModal'
import ExpenseModal from './ExpenseModal'
import { parseAmount, formatMoney } from '../../../lib/money'

/**
 * Tab "Tài chính".
 *
 * ── 2026-11-16 (v2) ───────────────────────────────────────
 * • Layout FULL WIDTH (bỏ max-w / mx-auto).
 * • Bảng màu tinh gọn hơn: thẻ nền tối nhẹ, dải màu accent mảnh bên trái,
 *   số dư nổi bật, icon trong chip bo tròn.
 */

// Mỗi tài khoản 1 "accent" nhẹ nhàng (dải màu trái mảnh + nền icon).
// 2026-11-17: Dùng tone -600 trầm hơn, bỏ ring gây chói; số dư để màu trung
//   tính cho dễ đọc, chỉ icon mang màu.
const ACCENTS = {
  CASH:       { bar: 'bg-emerald-600', icon: '💵', chip: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' },
  HD:         { bar: 'bg-blue-600',    icon: '🏦', chip: 'bg-blue-500/12 text-blue-700 dark:text-blue-300' },
  VCB:        { bar: 'bg-cyan-600',    icon: '🏛️', chip: 'bg-cyan-500/12 text-cyan-700 dark:text-cyan-300' },
  HNH_DEBT:   { bar: 'bg-rose-600',    icon: '📋', chip: 'bg-rose-500/12 text-rose-700 dark:text-rose-300' },
  VJ_DEPOSIT: { bar: 'bg-amber-600',   icon: '🧾', chip: 'bg-amber-500/12 text-amber-700 dark:text-amber-300' },
}

export default function FinanceTab() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading]   = useState(true)
  const [history, setHistory]   = useState(null)
  const [showExpense, setShowExpense] = useState(false)
  const [editInitial, setEditInitial] = useState(null)
  const [initialAmt, setInitialAmt] = useState('')

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
      {/* FULL WIDTH — không giới hạn max-width */}
      <div className="w-full px-3 sm:px-5 py-4 space-y-6">

        {/* ── Top bar ── */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-bold text-slate-900 dark:text-white">Tài chính</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Quản lý các tài khoản thu/chi &amp; công nợ.
            </div>
          </div>
          <button type="button" onClick={() => setShowExpense(true)}
            className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold
                       shadow-sm hover:bg-violet-700 active:scale-95 transition">
            💸 Chi
          </button>
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

        {/* ── Hint ── */}
        <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700
                        text-[12px] leading-relaxed text-slate-700 dark:text-slate-300">
          💡 <b>Quy tắc tự động:</b> khi bán vé, tài khoản <b>công nợ HNH</b> tăng theo
          giá vốn (giá gốc + phí thu hộ + phí xuất vé) cho vé <b>KHÁC VJ</b>; vé <b>VJ</b>
          trừ vào tài khoản <b>ký quỹ VJ</b>. Thanh toán vé vào tài khoản nào thì tài khoản
          đó tăng. Chi từ tiền mặt/VCB/HD sang <b>HNH</b> sẽ giảm công nợ; chi sang
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
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div className="text-[11px] font-bold tracking-wide text-slate-400 dark:text-slate-500 uppercase mb-2">
      {children}
    </div>
  )
}

function AccountCard({ acc, onHistory, onSetInitial, virtual = false }) {
  const a = ACCENTS[acc.code] || { bar: 'bg-slate-400', icon: '💼', chip: 'bg-slate-200 text-slate-600' }
  const bal = parseAmount(acc.balance) || 0
  const negative = bal < 0
  return (
    <div className="relative flex rounded-2xl overflow-hidden bg-white dark:bg-slate-800/80
                    border border-slate-200 dark:border-slate-700 shadow-sm">
      {/* Dải accent trái mảnh */}
      <div className={`w-1.5 shrink-0 ${a.bar}`} />

      <div className="flex-1 min-w-0 p-4">
        <div className="flex items-start gap-3">
          <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${a.chip}`}>
            {a.icon}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{acc.name}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {virtual ? 'Số dư ảo' : 'Số dư hiện tại'}
            </div>
            {/* Số dư để màu trung tính cho dễ đọc; âm thì đỏ. */}
            <div className={`mt-0.5 text-2xl font-bold font-mono tabular-nums truncate ${negative ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'}`}>
              {negative ? '−' : ''}{formatMoney(Math.abs(bal), 'VND')}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={onSetInitial}
            className="flex-1 px-2 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700
              text-xs font-semibold text-slate-700 dark:text-slate-200
              hover:bg-slate-200 dark:hover:bg-slate-600 transition">
            {bal === 0 ? '+ Nạp đầu kỳ' : '✎ Sửa số dư'}
          </button>
          <button type="button" onClick={onHistory}
            className="flex-1 px-2 py-1.5 rounded-lg bg-slate-700 text-white
              text-xs font-semibold hover:bg-slate-800 transition">
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
      <div className="relative w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-5">
        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Số dư cho {account.name}</h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Nhập số dư hiện có để hệ thống làm mốc tính toán.</p>
        <input
          type="text" autoFocus inputMode="numeric"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="VD: 15.000.000"
          className="mt-3 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600
                     dark:bg-slate-900 dark:text-gray-100 font-mono text-lg outline-none focus:border-blue-500"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700">Hủy</button>
          <button type="button" onClick={onConfirm}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            Lưu
          </button>
        </div>
      </div>
    </div>
  )
}

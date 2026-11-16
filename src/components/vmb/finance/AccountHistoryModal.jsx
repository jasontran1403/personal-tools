import { useCallback, useEffect, useState } from 'react'
import Modal from '../../common/Modal'
import { listAccountHistory } from '../../../services/vmbApi'
import { parseAmount } from '../../../lib/money'

/**
 * Modal hiển thị lịch sử giao dịch của 1 tài khoản tài chính.
 * Sắp xếp mới nhất → xa nhất.
 *
 * ── 2026-11-16 (v2) ───────────────────────────────────────
 * • Khung danh sách có MIN-HEIGHT → khi trống vẫn thấy khung placeholder.
 * • MAX-HEIGHT = chiều cao màn hình (modal max-h-92vh); CHỈ khung danh sách
 *   cuộn bên trong, phần tổng quan phía trên luôn cố định.
 *
 * Quy ước dấu:
 *   INCOME (thu) → + ; EXPENSE (chi) → − ; TICKET tùy loại tài khoản.
 */
export default function AccountHistoryModal({ account, onClose }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listAccountHistory(account.id)
      setRows(res.data?.data || [])
    } catch (_) { /* ignore */ }
    finally { setLoading(false) }
  }, [account.id])
  useEffect(() => { load() }, [load])

  const kindMeta = (row) => {
    if (row.kind === 'INIT') return { sign: '', color: 'text-gray-500 dark:text-gray-400', label: 'Khởi tạo' }
    if (row.kind === 'INCOME') return { sign: '+', color: 'text-green-600 dark:text-green-400', label: 'Thu' }
    if (row.kind === 'EXPENSE') {
      if (account.code === 'HNH_DEBT') return { sign: '−', color: 'text-blue-600 dark:text-blue-400', label: 'Giảm công nợ' }
      if (account.code === 'VJ_DEPOSIT') return { sign: '+', color: 'text-blue-600 dark:text-blue-400', label: 'Nạp ký quỹ' }
      return { sign: '−', color: 'text-rose-600 dark:text-rose-400', label: 'Chi' }
    }
    if (row.kind === 'TICKET') {
      if (account.code === 'HNH_DEBT') return { sign: '+', color: 'text-rose-600 dark:text-rose-400', label: 'Xuất vé (nợ)' }
      if (account.code === 'VJ_DEPOSIT') return { sign: '−', color: 'text-rose-600 dark:text-rose-400', label: 'Xuất vé (VJ)' }
    }
    return { sign: '', color: 'text-gray-500', label: row.kind }
  }

  return (
    <Modal open onClose={onClose} title={`Lịch sử — ${account.name}`} size="lg">
      {/* Tổng quan — CỐ ĐỊNH (không cuộn) */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Số dư hiện tại:{' '}
          <span className="font-bold font-mono text-gray-900 dark:text-gray-100">{account.balance || '0'}</span>
        </div>
        <div className="text-[11px] text-gray-400">
          {loading ? 'Đang tải…' : `${rows.length} giao dịch`}
        </div>
      </div>

      {/* Khung danh sách — min-height placeholder, chỉ khung này cuộn.
          max-height ≈ màn hình (modal max-h-92vh trừ header + tổng quan). */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-700
                      bg-gray-50/60 dark:bg-slate-900/40
                      min-h-[320px] max-h-[calc(92vh-190px)] overflow-y-auto">
        {loading ? (
          <Placeholder>Đang tải lịch sử…</Placeholder>
        ) : rows.length === 0 ? (
          <Placeholder>Chưa có giao dịch nào.</Placeholder>
        ) : (
          <div className="p-2 space-y-1.5">
            {rows.map(r => {
              const meta = kindMeta(r)
              return (
                <div key={r.id}
                  className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-mono tabular-nums font-bold ${meta.color}`}>
                      {meta.sign} {r.amount}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700
                                     text-gray-600 dark:text-gray-300 font-semibold">
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-gray-400 ml-auto whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString('vi-VN')}
                    </span>
                  </div>
                  {(r.beneficiary || r.note) && (
                    <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-300 break-words">
                      {r.beneficiary && <span className="font-semibold">{r.beneficiary}</span>}
                      {r.beneficiary && r.note ? ' · ' : ''}
                      {r.note}
                    </div>
                  )}
                  {r.createdBy && (
                    <div className="text-[10px] text-gray-400">bởi {r.createdBy}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}

function Placeholder({ children }) {
  return (
    <div className="h-[320px] flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 gap-2">
      <span className="text-3xl opacity-40">🧾</span>
      <span className="text-sm italic">{children}</span>
    </div>
  )
}

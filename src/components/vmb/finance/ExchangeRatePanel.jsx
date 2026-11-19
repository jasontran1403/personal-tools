import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  getExchangeRates, saveExchangeRates, getExchangeRateHistory,
} from '../../../services/vmbApi'
import { groupVnInt } from './FinanceTab'

/**
 * ── 2026-11-19: Tỷ giá quy đổi ──────────────────────────────
 * Panel hiển thị tỷ giá hiện hành (mới nhất mỗi tiền tệ) + nút cập nhật tỷ giá
 * hôm nay + xem lịch sử (bảng: mỗi tiền tệ 1 cột, mỗi ngày 1 dòng).
 *
 * Tỷ giá lưu số nguyên VND cho 1 đơn vị; hiển thị format VN (25930 → 25.930).
 * Dark-theme bằng class nên ở đây chỉ dùng class sáng.
 */
export default function ExchangeRatePanel() {
  const [data, setData] = useState(null)   // { date, currencies, today, latest }
  const [loading, setLoading] = useState(true)
  const [showEdit, setShowEdit] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getExchangeRates()
      setData(res.data?.data || null)
    } catch {
      toast.error('Không tải được tỷ giá')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const currencies = data?.currencies || []
  const latest = data?.latest || {}
  const today = data?.today || {}

  return (
    <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-xs text-gray-500">
          Tỷ giá hiện hành (mới nhất mỗi tiền tệ). Cập nhật 1 lần / ngày vào đầu ca.
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => setShowHistory(true)}
            className="px-3 py-1.5 rounded-lg bg-gray-800 text-white text-xs font-semibold hover:bg-gray-900">
            📊 Lịch sử tỷ giá
          </button>
          <button type="button" onClick={() => setShowEdit(true)}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700">
            ✎ Cập nhật tỷ giá
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-6 text-center text-sm text-gray-400">Đang tải…</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {currencies.map(cur => {
            const r = latest[cur]
            const isToday = today[cur] != null
            return (
              <div key={cur}
                className={`rounded-xl border px-3 py-2 ${r ? 'bg-gray-50 border-gray-200' : 'bg-gray-50/50 border-dashed border-gray-200'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-700">{cur}</span>
                  {isToday && (
                    <span className="text-[9px] font-bold text-emerald-600 uppercase">hôm nay</span>
                  )}
                </div>
                <div className={`text-lg font-mono font-bold tabular-nums ${r ? 'text-gray-900' : 'text-gray-300'}`}>
                  {r ? groupVnInt(r) : '—'}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showEdit && (
        <RateEditModal
          currencies={currencies}
          today={today} latest={latest} date={data?.date}
          onCancel={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load() }}
        />
      )}
      {showHistory && (
        <RateHistoryModal onClose={() => setShowHistory(false)} />
      )}
    </div>
  )
}

/**
 * Modal cập nhật tỷ giá hôm nay. Mỗi tiền tệ 1 ô; prefill = tỷ giá hôm nay nếu
 * có, nếu không thì tỷ giá mới nhất. Input số nguyên, format VN khi gõ.
 */
function RateEditModal({ currencies, today, latest, date, onCancel, onSaved }) {
  const [vals, setVals] = useState(() => {
    const init = {}
    for (const cur of currencies) {
      const seed = today[cur] ?? latest[cur] ?? ''
      init[cur] = groupVnInt(seed)
    }
    return init
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, busy])

  const submit = async () => {
    const rates = {}
    for (const cur of currencies) {
      const digits = (vals[cur] || '').replace(/[^0-9]/g, '')
      if (digits) rates[cur] = digits   // ô trống → bỏ qua, không ghi đè
    }
    if (Object.keys(rates).length === 0) return toast.error('Chưa nhập tỷ giá nào')
    setBusy(true)
    try {
      await saveExchangeRates({ date, rates })
      toast.success('Đã cập nhật tỷ giá')
      onSaved()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Cập nhật thất bại')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 130 }}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={busy ? undefined : onCancel} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl p-5 max-h-[92vh] overflow-y-auto">
        <h3 className="text-base font-bold text-gray-900">✎ Cập nhật tỷ giá</h3>
        <p className="mt-1 text-xs text-gray-500">
          Ngày áp dụng: <b>{date}</b>. Nhập số VND cho 1 đơn vị tiền tệ (số nguyên). Ô để trống sẽ không cập nhật.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {currencies.map(cur => (
            <div key={cur}>
              <label className="text-xs font-semibold text-gray-600">{cur}</label>
              <input
                type="text" inputMode="numeric"
                value={vals[cur] || ''}
                onChange={e => setVals(v => ({ ...v, [cur]: groupVnInt(e.target.value) }))}
                placeholder="VD: 25.930"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900
                           font-mono text-right outline-none focus:border-indigo-500" />
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-50">Hủy</button>
          <button type="button" onClick={submit} disabled={busy}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? 'Đang lưu…' : 'Lưu tỷ giá'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Modal lịch sử tỷ giá — bảng: mỗi tiền tệ 1 cột, mỗi ngày 1 dòng. */
function RateHistoryModal({ onClose }) {
  const [rows, setRows] = useState(null)   // [{ date, rates:{cur:rate} }]
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const res = await getExchangeRateHistory()
        setRows(res.data?.data || [])
      } catch {
        toast.error('Không tải được lịch sử')
        setRows([])
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // Cột tiền tệ = hợp các tiền tệ xuất hiện (giữ thứ tự xuất hiện).
  const cols = []
  const seen = new Set()
  for (const r of (rows || [])) {
    for (const cur of Object.keys(r.rates || {})) {
      if (!seen.has(cur)) { seen.add(cur); cols.push(cur) }
    }
  }

  const fmtDate = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 130 }}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl p-5 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-gray-900">📊 Lịch sử tỷ giá</h3>
          <button type="button" onClick={onClose}
            className="w-8 h-8 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700">✕</button>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">Đang tải…</div>
        ) : (rows || []).length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">Chưa có dữ liệu tỷ giá.</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b border-gray-200 whitespace-nowrap">Ngày</th>
                  {cols.map(cur => (
                    <th key={cur} className="px-3 py-2 text-right font-semibold text-gray-600 border-b border-gray-200">{cur}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.date} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-semibold text-gray-800 border-b border-gray-100 whitespace-nowrap">{fmtDate(r.date)}</td>
                    {cols.map(cur => (
                      <td key={cur} className="px-3 py-2 text-right font-mono tabular-nums text-gray-700 border-b border-gray-100">
                        {r.rates?.[cur] ? groupVnInt(r.rates[cur]) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

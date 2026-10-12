import { useState } from 'react'
import PriceInput from './PriceInput'

/**
 * Editor cho danh sách phí chi tiết của 1 vé.
 *
 * ── 2026-10-12: Multi-currency per fee ───────────────────────
 *   Mỗi dòng phí có thể chọn RIÊNG đơn vị tiền (VND / USD), độc lập với
 *   booking.currency. Mặc định = booking.currency (prop {@code currency}).
 *   Lý do: 1 số dịch vụ (phí chỗ ngồi, phí hành lý…) mua bằng VND nhưng
 *   booking là USD → quy đổi ra USD bị lẻ (943.000 / 26170 = 36,03362…).
 *   Giữ nguyên VND → cộng thẳng vào tổng VND khi tính.
 *
 * Props:
 *   value       — TicketFeeIO[]  (id?, feeType, amount, currency?, note, orderIdx)
 *   onChange    — (newList) → void
 *   currency    — "VND" | "USD" của booking (dùng làm mặc định khi thêm phí)
 *   feeTypes    — [{ code, label }, ...] (từ /api/tools/vmb/fee-types)
 */
export default function TicketFeesEditor({ value = [], onChange, currency = 'VND', feeTypes = [] }) {
  const [pickType, setPickType]     = useState('')
  const [pickAmount, setPickAmount] = useState('')
  // 2026-10-12: currency riêng cho form "thêm phí". Mặc định = booking.currency.
  const [pickCurrency, setPickCurrency] = useState(currency)

  const add = () => {
    if (!pickType) return
    if (!pickAmount || pickAmount.trim() === '' || pickAmount.trim() === '0') return
    const idx = value.length
    onChange([
      ...value,
      {
        id: null,
        feeType: pickType,
        feeTypeLabel: labelOf(pickType, feeTypes),
        amount: pickAmount.trim(),
        currency: pickCurrency || currency,
        note: '',
        orderIdx: idx,
      },
    ])
    setPickType('')
    setPickAmount('')
    setPickCurrency(currency)
  }

  const removeAt = (i) => {
    onChange(value.filter((_, idx) => idx !== i))
  }

  const editAmount = (i, v) => {
    onChange(value.map((f, idx) => idx === i ? { ...f, amount: v } : f))
  }

  const editCurrency = (i, v) => {
    onChange(value.map((f, idx) => idx === i ? { ...f, currency: v } : f))
  }

  const editNote = (i, v) => {
    onChange(value.map((f, idx) => idx === i ? { ...f, note: v } : f))
  }

  return (
    <div className="space-y-2">
      {/* Add row */}
      <div className="flex flex-wrap items-end gap-2 p-2 rounded-lg bg-blue-50/40 border border-blue-100">
        <div className="flex-1 min-w-[160px]">
          <div className="text-[10px] font-semibold text-gray-600 mb-1">Loại phí</div>
          <select value={pickType} onChange={e => setPickType(e.target.value)}
            className="w-full px-2 py-1.5 rounded-md border border-gray-300 bg-white text-sm outline-none focus:border-blue-500">
            <option value="">— Chọn loại phí —</option>
            {feeTypes.map(t => (
              <option key={t.code} value={t.code}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="w-36">
          <div className="text-[10px] font-semibold text-gray-600 mb-1">Số tiền</div>
          <PriceInput value={pickAmount} currency={pickCurrency} onChange={setPickAmount} />
        </div>
        <div className="w-20">
          <div className="text-[10px] font-semibold text-gray-600 mb-1">Đơn vị</div>
          <select value={pickCurrency} onChange={e => setPickCurrency(e.target.value)}
            className="w-full px-2 py-1.5 rounded-md border border-gray-300 bg-white text-sm font-mono outline-none focus:border-blue-500">
            <option value="VND">VND</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <button type="button" onClick={add} disabled={!pickType || !pickAmount}
          className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
          + Thêm phí
        </button>
      </div>

      {/* Existing list */}
      {value.length === 0 ? (
        <div className="text-[11px] text-gray-400 italic px-2 py-1">
          Chưa có phí nào. Vé có thể tồn tại không phí — thêm khi cần.
        </div>
      ) : (
        <div className="space-y-1">
          {value.map((f, i) => {
            const feeCur = f.currency || currency
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 p-2 rounded-md bg-white border border-gray-200">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">
                  {f.feeTypeLabel || labelOf(f.feeType, feeTypes)}
                </span>
                <div className="w-32">
                  <PriceInput value={f.amount} currency={feeCur}
                    onChange={v => editAmount(i, v)} />
                </div>
                <select value={feeCur} onChange={e => editCurrency(i, e.target.value)}
                  className="w-20 px-2 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-mono outline-none focus:border-blue-500"
                  title="Đơn vị tiền của dòng phí này">
                  <option value="VND">VND</option>
                  <option value="USD">USD</option>
                </select>
                <input type="text" value={f.note || ''}
                  onChange={e => editNote(i, e.target.value)}
                  placeholder="Ghi chú (tùy chọn)"
                  className="flex-1 min-w-[120px] px-2 py-1.5 rounded-md border border-gray-200 bg-white text-xs outline-none focus:border-blue-500" />
                <button type="button" onClick={() => removeAt(i)}
                  title="Xóa dòng phí này"
                  className="w-7 h-7 rounded-md text-rose-600 hover:bg-rose-50 flex items-center justify-center">
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function labelOf(code, feeTypes) {
  const t = feeTypes.find(x => x.code === code)
  return t ? t.label : code
}

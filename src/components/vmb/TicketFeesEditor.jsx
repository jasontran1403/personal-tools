import { useState } from 'react'
import PriceInput from './PriceInput'

/**
 * Editor cho danh sách phí chi tiết của 1 vé.
 *
 * Props:
 *   value       — TicketFeeIO[]  (id nếu có; feeType/amount/note/orderIdx)
 *   onChange    — (newList) → void
 *   currency    — VND | USD (để format PriceInput)
 *   feeTypes    — [{ code, label }, ...] (từ /api/tools/vmb/fee-types)
 *
 * UX:
 *   - Dropdown chọn loại phí + PriceInput số tiền + nút "+ Thêm".
 *   - Danh sách phí đã thêm, mỗi dòng: label loại phí | số tiền (edit) | nút xóa.
 *   - Cùng loại phí có thể lặp nhiều dòng (VD 2× Phí hành lý).
 *
 * KHÔNG lưu tổng — chi tiết đúng như yêu cầu.
 */
export default function TicketFeesEditor({ value = [], onChange, currency = 'VND', feeTypes = [] }) {
  const [pickType, setPickType]     = useState('')
  const [pickAmount, setPickAmount] = useState('')

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
        note: '',
        orderIdx: idx,
      },
    ])
    setPickType('')
    setPickAmount('')
  }

  const removeAt = (i) => {
    onChange(value.filter((_, idx) => idx !== i))
  }

  const editAmount = (i, v) => {
    onChange(value.map((f, idx) => idx === i ? { ...f, amount: v } : f))
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
          <PriceInput value={pickAmount} currency={currency} onChange={setPickAmount} />
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
          {value.map((f, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 p-2 rounded-md bg-white border border-gray-200">
              <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">
                {f.feeTypeLabel || labelOf(f.feeType, feeTypes)}
              </span>
              <div className="w-32">
                <PriceInput value={f.amount} currency={currency}
                  onChange={v => editAmount(i, v)} />
              </div>
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
          ))}
        </div>
      )}
    </div>
  )
}

function labelOf(code, feeTypes) {
  const t = feeTypes.find(x => x.code === code)
  return t ? t.label : code
}
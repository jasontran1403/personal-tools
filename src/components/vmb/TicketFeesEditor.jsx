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
  // 2026-11-07: Số vé riêng cho dịch vụ (optional)
  const [pickTicketNumber, setPickTicketNumber] = useState('')

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
        ticketNumber: pickTicketNumber.trim(),
        orderIdx: idx,
      },
    ])
    setPickType('')
    setPickAmount('')
    setPickCurrency(currency)
    setPickTicketNumber('')
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

  // 2026-11-07: Sửa số vé riêng của dịch vụ
  const editTicketNumber = (i, v) => {
    onChange(value.map((f, idx) => idx === i ? { ...f, ticketNumber: v } : f))
  }

  return (
    <div className="space-y-2">
      {/* ── Add row — 2026-11-07 (rev): mọi control đều h-10 để thẳng hàng;
          Đơn vị chuyển từ <select> sang toggle VND/USD. */}
      <div className="flex flex-wrap items-end gap-2 p-2 rounded-lg bg-blue-50/40 border border-blue-100">
        <div className="flex-1 min-w-[160px]">
          <div className="text-[10px] font-semibold text-gray-600 mb-1">Loại phí</div>
          <select value={pickType} onChange={e => setPickType(e.target.value)}
            className="w-full h-10 px-2 py-0 rounded-md border border-gray-300 bg-white text-sm outline-none focus:border-blue-500">
            <option value="">— Chọn loại phí —</option>
            {feeTypes.map(t => (
              <option key={t.code} value={t.code}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="w-36">
          <div className="text-[10px] font-semibold text-gray-600 mb-1">Số tiền</div>
          <div className="h-10">
            {/* 2026-11-07: hideUnit vì đã có toggle Đơn vị bên cạnh */}
            <PriceInput value={pickAmount} currency={pickCurrency} onChange={setPickAmount} hideUnit />
          </div>
        </div>
        <div className="w-24">
          <div className="text-[10px] font-semibold text-gray-600 mb-1">Đơn vị</div>
          <FeeCurrencyToggle value={pickCurrency} onChange={setPickCurrency} />
        </div>
        {/* Số vé riêng của dịch vụ (optional) */}
        <div className="w-40">
          <div className="text-[10px] font-semibold text-gray-600 mb-1">Số vé (tuỳ chọn)</div>
          <input type="text" value={pickTicketNumber}
            onChange={e => setPickTicketNumber(e.target.value)}
            placeholder="Số vé dịch vụ"
            className="w-full h-10 px-2 py-0 rounded-md border border-gray-300 bg-white text-sm font-mono outline-none focus:border-blue-500" />
        </div>
        <button type="button" onClick={add} disabled={!pickType || !pickAmount}
          className="h-10 px-3 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
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
            // 2026-11-07 (rev): Height đều nhau cho mọi control (h-9 = 36px khớp
            //   với PriceInput py-2 text-sm). Badge inline-flex items-center.
            //   Ghi chú ngắn lại 20% — chuyển từ flex-1 sang width cố định.
            //   Số vé: prefix "Số vé:" dính vào input, user chỉ nhập phần số;
            //   khi value rỗng, input rỗng (không hiện "Số vé:" như data).
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 p-2 rounded-md bg-white border border-gray-200">
                <span className="h-9 inline-flex items-center text-[11px] font-bold px-3 rounded-md bg-indigo-100 text-indigo-800">
                  {f.feeTypeLabel || labelOf(f.feeType, feeTypes)}
                </span>
                <div className="w-32 h-9">
                  <PriceInput value={f.amount} currency={feeCur}
                    onChange={v => editAmount(i, v)} />
                </div>
                <div className="w-24">
                  <FeeCurrencyToggle value={feeCur} onChange={v => editCurrency(i, v)} compact />
                </div>
                {/* Số vé — prefix "Số vé:" dính sẵn, cùng bg với input (seamless) */}
                <label className="h-9 w-44 flex items-center rounded-md border border-gray-200 bg-white focus-within:border-blue-500 overflow-hidden cursor-text">
                  <span className="pl-2 pr-1 text-[11px] text-gray-500 select-none whitespace-nowrap bg-white">
                    Số vé:
                  </span>
                  <input type="text" value={f.ticketNumber || ''}
                    onChange={e => editTicketNumber(i, e.target.value)}
                    placeholder=""
                    title="Số vé riêng của dịch vụ (optional) — để trống nếu dùng chung số vé chính"
                    style={{ background: 'transparent', boxShadow: 'none', appearance: 'none' }}
                    className="flex-1 min-w-0 h-full pr-2 text-xs font-mono outline-none border-0" />
                </label>
                <input type="text" value={f.note || ''}
                  onChange={e => editNote(i, e.target.value)}
                  placeholder="Ghi chú (tùy chọn)"
                  className="h-9 w-56 py-0 px-2 rounded-md border border-gray-200 bg-white text-xs outline-none focus:border-blue-500" />
                <button type="button" onClick={() => removeAt(i)}
                  title="Xóa dòng phí này"
                  className="w-9 h-9 rounded-md text-rose-600 hover:bg-rose-50 flex items-center justify-center text-lg leading-none">
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

/**
 * ── 2026-11-07 ────────────────────────────────────────────
 * Toggle 2 lựa chọn VND / USD cho dòng phí. `compact` = height 36px (h-9)
 * để khớp với các control trong list đã thêm; mặc định h-10 cho add-row.
 */
function FeeCurrencyToggle({ value, onChange, compact }) {
  const h = compact ? 'h-9' : 'h-10'
  return (
    <div className={`inline-flex ${h} w-full rounded-md bg-gray-100 p-0.5 border border-gray-300`}>
      {['VND', 'USD'].map(cur => (
        <button key={cur} type="button" onClick={() => onChange(cur)}
          className={`flex-1 h-full rounded text-[11px] font-bold font-mono transition
            ${value === cur
              ? 'bg-white shadow text-blue-700'
              : 'text-gray-500 hover:text-gray-800'}`}>
          {cur}
        </button>
      ))}
    </div>
  )
}
import { useState, useEffect, useRef } from 'react'
import { parseAmount, formatMoney } from '../../lib/money'

/**
 * Ô nhập số tiền — có LIVE FORMAT khi gõ.
 *
 * ── 2026-11-07 (rev) — Live-format VND ngay khi gõ ──────────
 *   Trước: chỉ format khi blur → gõ "1200" thấy "1200", bỏ focus mới ra "1.200".
 *   Nay: mỗi lần gõ, nếu currency=VND thì auto re-format ngay + GIỮ con trỏ
 *        đúng vị trí (bù delta cho các dấu "." mới chèn).
 *   USD giữ nguyên format-on-blur để không phá luồng gõ 2 số thập phân.
 *
 * ── 2026-11-07: hideUnit prop ───────────────────────────────
 *   Bật khi parent đã có toggle/label đơn vị bên cạnh, tránh đè lên UI.
 *
 * ── sumOnPaste ────────────────────────────────────────────
 *   Bật → paste tự trích số đầu chuỗi + cộng dồn vào buffer.
 */
export default function PriceInput({
  value = '',
  currency = 'VND',
  onChange,
  placeholder,
  className = '',
  disabled = false,
  autoFocus = false,
  sumOnPaste = false,
  hideUnit = false,     // 2026-11-07
}) {
  const [buf, setBuf] = useState(value ?? '')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!focused) setBuf(value ?? '')
  }, [value, focused])

  // ── Live-format VND khi gõ ──
  //   VND không có phần thập phân → có thể format mỗi keystroke.
  //   USD có 2 số thập phân → nếu live-format sẽ phá khi user đang gõ phần thập
  //   phân (1.5 → format thành 1.50 ngay), nên USD giữ format-on-blur như cũ.
  const handleChange = (e) => {
    const inputEl = e.target
    const raw = inputEl.value
    const selStart = inputEl.selectionStart ?? raw.length

    if (currency === 'VND') {
      // Chỉ giữ số (strip mọi non-digit kể cả dấu .)
      const digits = raw.replace(/\D/g, '')
      if (digits === '') { setBuf(''); onChange?.(''); return }
      const n = Number(digits)
      if (!Number.isFinite(n)) { setBuf(raw); return }
      const formatted = formatMoney(n, 'VND', { withUnit: false })
      // Bù delta cho con trỏ: đếm số ký tự không-số bên trái selStart
      //   trong raw cũ vs trong formatted mới → shift pos.
      const digitsBeforeCursor = raw.slice(0, selStart).replace(/\D/g, '').length
      let newPos = 0, seen = 0
      for (let i = 0; i < formatted.length && seen < digitsBeforeCursor; i++) {
        if (/\d/.test(formatted[i])) seen++
        newPos = i + 1
      }
      setBuf(formatted)
      onChange?.(formatted)
      // Restore cursor sau khi React render.
      requestAnimationFrame(() => {
        if (inputRef.current) {
          try { inputRef.current.setSelectionRange(newPos, newPos) } catch {}
        }
      })
      return
    }
    // USD: cho user tự do gõ, format khi blur.
    setBuf(raw)
  }

  const handleBlur = () => {
    setFocused(false)
    const n = parseAmount(buf)
    if (!Number.isFinite(n)) {
      onChange?.(''); setBuf(''); return
    }
    const formatted = formatMoney(n, currency, { withUnit: false })
    setBuf(formatted)
    onChange?.(formatted)
  }

  const handlePaste = (e) => {
    const pasted = (e.clipboardData || window.clipboardData)?.getData('text') ?? ''
    if (!pasted) return
    const cleaned = pasted.trim()
    const m = /^([\d.,\s_]+)/.exec(cleaned)
    if (!m) return
    let raw = m[1].replace(/[\s_]/g, '')
    if (raw.includes(',') && !raw.includes('.')) raw = raw.replace(/,/g, '.')
    const pastedNum = parseAmount(raw)
    if (!Number.isFinite(pastedNum)) return
    e.preventDefault()
    let finalNum
    if (sumOnPaste) {
      const currentNum = parseAmount(buf)
      finalNum = (Number.isFinite(currentNum) ? currentNum : 0) + pastedNum
    } else {
      finalNum = pastedNum
    }
    const formatted = formatMoney(finalNum, currency, { withUnit: false })
    setBuf(formatted)
    onChange?.(formatted)
  }

  const paddingRight = hideUnit ? 'pr-3' : 'pr-14'

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        inputMode={currency === 'USD' ? 'decimal' : 'numeric'}
        value={buf}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        onPaste={handlePaste}
        placeholder={placeholder ?? (currency === 'USD' ? '0,00' : '0')}
        disabled={disabled}
        autoFocus={autoFocus}
        title={sumOnPaste ? 'Paste sẽ tự trích số và cộng dồn vào tổng' : undefined}
        className={`w-full pl-3 ${paddingRight} py-2 rounded-lg border border-gray-300 bg-white text-sm
          text-right font-mono tabular-nums
          focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none
          disabled:bg-gray-50 disabled:text-gray-500
          ${className}`}
      />
      {!hideUnit && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-gray-400 pointer-events-none">
          {currency}
        </span>
      )}
    </div>
  )
}
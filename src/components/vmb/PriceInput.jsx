import { useState, useEffect } from 'react'
import { parseAmount, formatMoney } from '../../lib/money'

/**
 * Ô nhập số tiền có format khi blur.
 *
 * - Trong lúc gõ (focus): giữ NGUYÊN chuỗi người dùng đánh — không tự format
 *   để con trỏ không nhảy loạn xạ.
 * - Khi rời ô (blur): parse rồi format lại theo currency (USD 2 số lẻ, VND
 *   nguyên; dấu chấm phân cách hàng nghìn) → chuỗi format hiển thị đẹp và cũng
 *   là chuỗi gửi lên BE (BE lưu String, giữ nguyên format).
 *
 * value / onChange dùng chuỗi — parent tự bảo quản.
 *
 * ── 2026-09-20: sumOnPaste ──────────────────────────────────
 * Khi bật {@code sumOnPaste}, thao tác Ctrl+V vào ô sẽ:
 *   1. Trích số từ text được paste (VD "198000AX" → 198000; "79,000" → 79000).
 *   2. Cộng dồn vào giá trị hiện tại trong ô.
 *   3. Cập nhật ô + gọi onChange với chuỗi đã format.
 * Không ăn xén khoảng trắng hay từ khóa gì cả — chỉ tách phần số ở đầu (bỏ
 * các dấu . , _ giữa các cụm nghìn), gặp chữ cái hoặc ký tự lạ thì dừng.
 * Đặc biệt hữu ích cho phí thu hộ nơi user paste liên tiếp mã vé + phí.
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
}) {
  // Buffer nội bộ trong lúc focus — sync ngược từ prop khi không focus
  const [buf, setBuf] = useState(value ?? '')
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setBuf(value ?? '')
  }, [value, focused])

  const handleBlur = () => {
    setFocused(false)
    const n = parseAmount(buf)
    if (!Number.isFinite(n)) {
      // Không parse được → giữ nguyên chuỗi rỗng để BE lưu ""
      onChange?.('')
      setBuf('')
      return
    }
    const formatted = formatMoney(n, currency, { withUnit: false })
    setBuf(formatted)
    onChange?.(formatted)
  }

  const handlePaste = (e) => {
    if (!sumOnPaste) return
    // Lấy clipboard text
    const pasted = (e.clipboardData || window.clipboardData)?.getData('text') ?? ''
    if (!pasted) return

    // Trích số ở ĐẦU chuỗi — bỏ . , _ và khoảng trắng (thousand-sep), dừng ở chữ.
    const cleaned = pasted.trim()
    const m = /^([\d.,\s_]+)/.exec(cleaned)
    if (!m) return // không phát hiện số → để browser tự paste bình thường

    e.preventDefault()

    // Chuẩn hóa: strip whitespace + underscore
    let raw = m[1].replace(/[\s_]/g, '')

    // ── 2026-09-20 fix ────────────────────────────────────
    // Pre-format: nếu chuỗi CHỈ CÓ comma (không có dot) → đổi hết comma
    // thành dot. Xong parseAmount tự xử đúng qua heuristic dot có sẵn.
    //   "99,000"    → "99.000"    → parseAmount → 99000
    //   "18,181"    → "18.181"    → parseAmount → 18181
    //   "1,234,567" → "1.234.567" → parseAmount → 1234567
    //   "624,20"    → "624.20"    → parseAmount → 624.2 (decimal OK)
    // Chuỗi có cả dot lẫn comma ("1.234,56") KHÔNG đụng vào — parseAmount
    // đã xử lý đúng mixed format.
    if (raw.includes(',') && !raw.includes('.')) {
      raw = raw.replace(/,/g, '.')
    }

    const pastedNum = parseAmount(raw)
    if (!Number.isFinite(pastedNum)) return

    // Cộng vào giá trị hiện tại
    const currentNum = parseAmount(buf)
    const sum = (Number.isFinite(currentNum) ? currentNum : 0) + pastedNum
    const formatted = formatMoney(sum, currency, { withUnit: false })

    setBuf(formatted)
    onChange?.(formatted)
  }

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="decimal"
        value={buf}
        onChange={e => setBuf(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        onPaste={handlePaste}
        placeholder={placeholder ?? (currency === 'USD' ? '0,00' : '0')}
        disabled={disabled}
        autoFocus={autoFocus}
        title={sumOnPaste ? 'Paste sẽ tự trích số và cộng dồn vào tổng' : undefined}
        className={`w-full pl-3 pr-14 py-2 rounded-lg border border-gray-300 bg-white text-sm
          text-right font-mono tabular-nums
          focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none
          disabled:bg-gray-50 disabled:text-gray-500
          ${className}`}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-gray-400 pointer-events-none">
        {currency}
      </span>
    </div>
  )
}
export const fmtCurrency = v =>
  v == null ? '—' : new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND'}).format(v)

export const fmtDateTime = ms => {
  if (!ms) return '—'
  return new Intl.DateTimeFormat('vi-VN',{
    timeZone:'Asia/Ho_Chi_Minh',
    day:'2-digit',month:'2-digit',year:'numeric',
    hour:'2-digit',minute:'2-digit'
  }).format(new Date(ms))
}

export const todayVN = () => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh'
  }).format(new Date())
}

/** Kiểm tra còn trong 6 giờ kể từ khi tạo đơn */
export const within6h = createdAtMs => {
  if (!createdAtMs) return false
  return (Date.now() - createdAtMs) < 6 * 3600 * 1000
}

/** @deprecated dùng within6h */
export const within12h = within6h

/** Tính thời gian còn lại (ms) trong vòng 6h */
export const timeLeftMs = createdAtMs => {
  if (!createdAtMs) return 0
  const left = 6 * 3600 * 1000 - (Date.now() - createdAtMs)
  return Math.max(0, left)
}

/** Format còn lại thành "Xh Ym" */
export const fmtTimeLeft = createdAtMs => {
  const ms = timeLeftMs(createdAtMs)
  if (ms <= 0) return '0 phút'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h > 0) return `${h}h ${m}m`
  return `${m} phút`
}
/**
 * Định dạng tiền theo chuẩn Việt Nam: 123123123 → "123.123.123đ"
 * Khác fmtCurrency ở chỗ dùng hậu tố "đ" thay vì "₫" và không có khoảng trắng —
 * đúng cách viết quen thuộc trên chứng từ kế toán trong nước.
 */
export const fmtVnd = v => {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number(v)) + 'đ'
}

/** Rút gọn số lớn cho card thống kê: 1234567890 → "1,23 tỷ" */
export const fmtVndShort = v => {
  const n = Number(v)
  if (v == null || Number.isNaN(n)) return '—'
  const abs = Math.abs(n)
  const nf = (x, d = 2) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d }).format(x)
  if (abs >= 1e9) return `${nf(n / 1e9)} tỷ`
  if (abs >= 1e6) return `${nf(n / 1e6, 1)} tr`
  return fmtVnd(n)
}

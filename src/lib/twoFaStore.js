/**
 * 2026-11-12: Kho lưu 2FA dùng chung (localStorage) + phát sự kiện để mọi
 * component đang hiển thị tự cập nhật khi danh sách đổi.
 *
 * ⚠ Secret 2FA chỉ nằm LOCAL trên thiết bị (key `vmb_2fa_entries`), không
 *   đồng bộ lên server.
 */

const LS_KEY = 'vmb_2fa_entries'
const EVT = 'vmb:2fa-changed'

export function load2fa() {
  try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : [] } catch { return [] }
}

function save2fa(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)) } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch { /* ignore */ }
}

function uid() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2)
}

/** Thêm 1 entry. entry = { name, issuer, secret, digits, period, algorithm } */
export function add2fa(entry) {
  save2fa([{ id: uid(), ...entry }, ...load2fa()])
}

/** Thêm nhiều entry (từ QR export). Bỏ trùng theo secret. Trả số thực thêm. */
export function addMany2fa(entries) {
  if (!entries || !entries.length) return 0
  const list = load2fa()
  const existing = new Set(list.map(x => x.secret))
  const fresh = entries.filter(e => e.secret && !existing.has(e.secret)).map(e => ({ id: uid(), ...e }))
  if (fresh.length) save2fa([...fresh, ...list])
  return fresh.length
}

export function remove2fa(id) {
  save2fa(load2fa().filter(x => x.id !== id))
}

/** Đăng ký lắng nghe thay đổi (cả khi đổi ở tab khác). Trả hàm hủy. */
export function subscribe2fa(cb) {
  const handler = () => cb()
  window.addEventListener(EVT, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(EVT, handler)
    window.removeEventListener('storage', handler)
  }
}
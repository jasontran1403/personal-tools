// ═══════════════════════════════════════════════════════════════════════════
// Cổng đăng nhập cho khu Tiện ích nội bộ (/tools)
//
// Khác hẳn với đăng nhập Kế toán (useAuth.js): khu này KHÔNG dùng tài khoản
// trong bảng users. Chỉ có hai tài khoản cứng được phép vào, xác thực ngay ở
// trình duyệt rồi tự phát một JWT (HS256, ký bằng Web Crypto) để:
//   • Có hạn dùng (exp) → hết hạn thì đá ra đăng nhập lại.
//   • Có chữ ký → không sửa tay để kéo dài phiên được.
//
// LƯU Ý BẢO MẬT: vì ký ở client nên SECRET nằm trong bundle, đây là cổng chặn
// GIAO DIỆN, không phải hàng rào ở API. Các endpoint /api/tools/** phía backend
// vẫn công khai như thiết kế cũ. Muốn siết thật thì phải phát/kiểm token này ở
// Spring (xem ghi chú ở cuối repo).
// ═══════════════════════════════════════════════════════════════════════════

/** Hai tài khoản được phép — KHÔNG lưu vào DB, chỉ nằm ở đây. */
const ACCOUNTS = {
  nguyenhai: '1412',
  phuongthao: '123',
}
export const ALLOWED_USERNAMES = new Set(Object.keys(ACCOUNTS))

/** Khóa ký JWT. Đổi chuỗi này sẽ vô hiệu mọi token đã phát trước đó. */
const SECRET = 'tools-gate::b6f0a1c9-nhatnam-internal-2024'

/**
 * Hạn dùng token.
 *   • Ghi nhớ  → 30 ngày, lưu localStorage (còn sau khi đóng trình duyệt).
 *   • Không    → 12 giờ,  lưu sessionStorage (mất khi đóng tab).
 *
 * MUỐN THỬ NHANH cảnh báo "hết phiên": tạm hạ TTL_SESSION xuống, ví dụ
 * 30 * 1000 (30 giây), đăng nhập KHÔNG tick ghi nhớ rồi đợi.
 */
export const TTL_REMEMBER = 30 * 24 * 60 * 60 * 1000
export const TTL_SESSION  = 12 * 60 * 60 * 1000

const K_TOKEN    = 'tools:token'
const K_REMEMBER = 'tools:remember'
const K_USERNAME = 'tools:username'

/** Chuẩn hóa tên đăng nhập: bỏ khoảng trắng thừa + về chữ thường (không phân biệt hoa/thường) */
export function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase()
}

export function checkCredentials(username, password) {
  const u = normalizeUsername(username)
  return Object.prototype.hasOwnProperty.call(ACCOUNTS, u)
    && ACCOUNTS[u] === password
}

// ── base64url + HMAC-SHA256 (Web Crypto) ────────────────────────────────────

const enc = new TextEncoder()

function b64urlFromBytes(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToString(s) {
  let t = s.replace(/-/g, '+').replace(/_/g, '/')
  while (t.length % 4) t += '='
  const bin = atob(t)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

const b64urlFromString = str => b64urlFromBytes(enc.encode(str))

async function hmac(data) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return b64urlFromBytes(new Uint8Array(sig))
}

// ── Tạo / đọc / kiểm token ──────────────────────────────────────────────────

export async function createToken(username, ttlMs) {
  const now = Math.floor(Date.now() / 1000)
  const header  = { alg: 'HS256', typ: 'JWT' }
  const payload = { sub: username, scope: 'tools', iat: now, exp: now + Math.floor(ttlMs / 1000) }
  const head = b64urlFromString(JSON.stringify(header))
  const body = b64urlFromString(JSON.stringify(payload))
  const sig  = await hmac(`${head}.${body}`)
  return `${head}.${body}.${sig}`
}

/** Đọc payload mà KHÔNG kiểm chữ ký — dùng cho việc xem nhanh exp/sub. */
export function decodeToken(token) {
  try {
    const parts = String(token).split('.')
    if (parts.length !== 3) return null
    return JSON.parse(b64urlToString(parts[1]))
  } catch {
    return null
  }
}

export function isExpired(token) {
  const p = decodeToken(token)
  if (!p || typeof p.exp !== 'number') return true
  return p.exp * 1000 <= Date.now()
}

/** Kiểm đầy đủ: chữ ký + scope + hạn dùng + username hợp lệ. Trả payload hoặc null. */
export async function verifyToken(token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) return null
  const expected = await hmac(`${parts[0]}.${parts[1]}`)
  if (expected !== parts[2]) return null
  const p = decodeToken(token)
  if (!p || p.scope !== 'tools') return null
  if (typeof p.exp !== 'number' || p.exp * 1000 <= Date.now()) return null
  if (!ALLOWED_USERNAMES.has(p.sub)) return null
  return p
}

// ── Lưu / xóa phiên ─────────────────────────────────────────────────────────

export function readToolsToken() {
  return localStorage.getItem(K_TOKEN) || sessionStorage.getItem(K_TOKEN)
}

export function saveToolsToken(token, { remember = false, username = '' } = {}) {
  const store = remember ? localStorage : sessionStorage
  const other = remember ? sessionStorage : localStorage

  other.removeItem(K_TOKEN)
  other.removeItem(K_USERNAME)

  store.setItem(K_TOKEN, token)
  if (username) store.setItem(K_USERNAME, username)

  if (remember) {
    localStorage.setItem(K_REMEMBER, '1')
    if (username) localStorage.setItem(K_USERNAME, username)
  } else {
    localStorage.removeItem(K_REMEMBER)
  }
}

/** Xóa phiên. Mặc định giữ lại tên đã "ghi nhớ" để điền sẵn form đăng nhập. */
export function wipeToolsToken({ keepRememberedUsername = true } = {}) {
  const remembered = keepRememberedUsername && localStorage.getItem(K_REMEMBER) === '1'
    ? localStorage.getItem(K_USERNAME)
    : null

  ;[localStorage, sessionStorage].forEach(s => s.removeItem(K_TOKEN))
  sessionStorage.removeItem(K_USERNAME)

  if (remembered) {
    localStorage.setItem(K_USERNAME, remembered)
  } else {
    localStorage.removeItem(K_REMEMBER)
    localStorage.removeItem(K_USERNAME)
  }
}

export function rememberedToolsUsername() {
  return localStorage.getItem(K_REMEMBER) === '1'
    ? (localStorage.getItem(K_USERNAME) || '')
    : ''
}

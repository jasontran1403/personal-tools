// ═══════════════════════════════════════════════════════════════════════════
// Auth phía client cho khu Tiện ích (/tools/*).
//
// TRƯỚC: ký JWT ngay trong bundle bằng Web Crypto — chỉ chặn được giao diện,
// backend vẫn công khai. Ai biết URL /api/tools/media là vẫn tải file.
//
// GIỜ: đăng nhập gọi thẳng POST /api/tools/auth/login của backend. Backend phát
// JWT ký bằng secret ở server, tự kiểm khi mọi request /api/tools/{media,files,
// todo,office,users,watermark/save} đi qua ToolsAuthFilter. Bí mật không còn ở
// browser nên không thể giả token.
//
// File này chỉ còn: lưu/đọc/xóa token trong storage + gọi các endpoint auth.
// Toàn bộ verify chuyển sang backend.
// ═══════════════════════════════════════════════════════════════════════════

import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:9009'

const K_TOKEN     = 'tools:token'
const K_USER      = 'tools:user'        // JSON: { username, displayName, admin, expiresAt }
const K_REMEMBER  = 'tools:remember'
const K_USERNAME  = 'tools:username'    // tên đã "ghi nhớ" để điền sẵn form

/** Client axios độc lập với instance chính (không có Authorization interceptor gọi lại vòng) */
const authClient = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' },
})

/**
 * Giải nén envelope { success, code, message, data } của backend.
 *
 * ── FIX 2026-09-13 ──────────────────────────────────────────────────────
 * Backend Nhật Nam dùng code 900 cho response THÀNH CÔNG (không phải 200 hay
 * 0 theo convention chung). Version cũ check `code !== 0 && code !== 200` →
 * ném Error kèm message = "Đăng nhập thành công", khiến LoginPage catch
 * rồi `toast.error("Đăng nhập thành công")` với icon đỏ — trông rất buồn cười.
 *
 * Chuyển sang dùng field `success: true` làm nguồn sự thật — flag boolean
 * ổn định qua mọi endpoint, không phụ thuộc code cụ thể của backend nào.
 */
const unwrap = res => {
  const env = res?.data
  if (!env) throw new Error('Máy chủ không trả về dữ liệu')
  if (env.success === false) {
    throw new Error(env.message || 'Yêu cầu thất bại')
  }
  return env.data
}

// ── Đọc/ghi token ─────────────────────────────────────────────────

export function readToolsToken() {
  return localStorage.getItem(K_TOKEN) || sessionStorage.getItem(K_TOKEN)
}

export function readToolsUser() {
  const raw = localStorage.getItem(K_USER) || sessionStorage.getItem(K_USER)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

function saveSession(token, user, remember) {
  const store = remember ? localStorage : sessionStorage
  const other = remember ? sessionStorage : localStorage

  other.removeItem(K_TOKEN)
  other.removeItem(K_USER)

  store.setItem(K_TOKEN, token)
  store.setItem(K_USER, JSON.stringify(user))

  if (remember) {
    localStorage.setItem(K_REMEMBER, '1')
    localStorage.setItem(K_USERNAME, user.username || '')
  } else {
    localStorage.removeItem(K_REMEMBER)
  }
}

/** Xóa phiên. Mặc định giữ lại username đã ghi nhớ để điền sẵn form đăng nhập. */
export function wipeToolsToken({ keepRememberedUsername = true } = {}) {
  const remembered = keepRememberedUsername && localStorage.getItem(K_REMEMBER) === '1'
    ? localStorage.getItem(K_USERNAME)
    : null

  ;[localStorage, sessionStorage].forEach(s => {
    s.removeItem(K_TOKEN)
    s.removeItem(K_USER)
  })

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

// ── Gọi backend ───────────────────────────────────────────────────

/**
 * Đăng nhập. Trả { ok, message?, user? }.
 * Không ném exception ra ngoài để UI đăng nhập không phải bọc try/catch riêng
 * cho từng lý do sai (sai mật khẩu, mạng lỗi...).
 */
export async function login(username, password, remember = false) {
  try {
    const res = await authClient.post('/api/tools/auth/login', {
      username, password, remember,
    })
    const data = unwrap(res)
    saveSession(data.token, {
      username: data.username,
      displayName: data.displayName || '',
      admin: !!data.admin,
      expiresAt: data.expiresAt,
    }, remember)
    return { ok: true, user: data }
  } catch (e) {
    // axios ném cả khi status !=2xx và khi backend trả success: false
    const msg = e?.response?.data?.message || e?.message || 'Đăng nhập thất bại.'
    return { ok: false, message: msg }
  }
}

/**
 * Verify token còn hạn/còn hiệu lực không. Đồng thời làm mới thông tin user
 * (displayName, admin) để không phụ thuộc cache localStorage.
 */
export async function verifyToken() {
  const token = readToolsToken()
  if (!token) return null
  try {
    const res = await authClient.post('/api/tools/auth/verify', null, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = unwrap(res)
    // Cập nhật thông tin user mới nhất, giữ nơi lưu (local/session) đúng như cũ
    const remember = localStorage.getItem(K_TOKEN) === token
    saveSession(token, {
      username: data.username,
      displayName: data.displayName || '',
      admin: !!data.admin,
      expiresAt: data.expiresAt,
    }, remember)
    return data
  } catch {
    // Token đã hết hạn / bị vô hiệu / sai chữ ký → dọn phiên
    wipeToolsToken({ keepRememberedUsername: true })
    return null
  }
}

/** Đổi mật khẩu của chính mình */
export async function changePassword(currentPassword, newPassword) {
  const token = readToolsToken()
  if (!token) throw new Error('Chưa đăng nhập')
  const res = await authClient.post(
    '/api/tools/auth/change-password',
    { currentPassword, newPassword },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return unwrap(res)
}
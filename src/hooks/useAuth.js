import { useState, useEffect } from 'react'

/**
 * Lưu phiên đăng nhập.
 *
 * Hai chế độ:
 *   • Ghi nhớ  → localStorage, còn nguyên sau khi đóng trình duyệt.
 *   • Không    → sessionStorage, mất khi đóng tab (mặc định như trước).
 *
 * Đọc thì tìm ở CẢ HAI để không phụ thuộc lựa chọn lúc đăng nhập.
 * Ghi thì chỉ ghi vào đúng một nơi, và xóa nơi còn lại để không có 2 token
 * lệch nhau — nguồn lỗi rất khó truy.
 */

const KEY_TOKEN    = 'token'
const KEY_ROLE     = 'role'
const KEY_USERNAME = 'username'
const KEY_REMEMBER = 'remember'

export function readToken() {
  return localStorage.getItem(KEY_TOKEN) || sessionStorage.getItem(KEY_TOKEN)
}

function readAuth() {
  const token = readToken()
  if (!token) return null
  return {
    token,
    role:     localStorage.getItem(KEY_ROLE)     || sessionStorage.getItem(KEY_ROLE),
    username: localStorage.getItem(KEY_USERNAME) || sessionStorage.getItem(KEY_USERNAME),
  }
}

/** Xóa sạch phiên ở cả hai nơi. Giữ lại username đã ghi nhớ để điền sẵn form. */
export function wipeAuth({ keepRememberedUsername = true } = {}) {
  const remembered = keepRememberedUsername && localStorage.getItem(KEY_REMEMBER) === '1'
    ? localStorage.getItem(KEY_USERNAME)
    : null

  ;[localStorage, sessionStorage].forEach(store => {
    store.removeItem(KEY_TOKEN)
    store.removeItem(KEY_ROLE)
    store.removeItem(KEY_USERNAME)
  })
  sessionStorage.removeItem('invoice:pageState')

  if (remembered) {
    localStorage.setItem(KEY_USERNAME, remembered)
  } else {
    localStorage.removeItem(KEY_REMEMBER)
    localStorage.removeItem(KEY_USERNAME)
  }
}

/** Tên đăng nhập đã ghi nhớ, để điền sẵn ô username ở màn hình đăng nhập */
export function rememberedUsername() {
  return localStorage.getItem(KEY_REMEMBER) === '1'
    ? (localStorage.getItem(KEY_USERNAME) || '')
    : ''
}

export function useAuth() {
  const [auth, setAuth] = useState(readAuth)

  // Đăng xuất ở tab này thì các tab khác cũng phải thoát theo
  useEffect(() => {
    const onStorage = e => {
      if (e.key === KEY_TOKEN || e.key === null) setAuth(readAuth())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const saveAuth = (token, role, { remember = false, username = '' } = {}) => {
    // Ghi vào một nơi, dọn nơi còn lại
    const store = remember ? localStorage : sessionStorage
    const other = remember ? sessionStorage : localStorage

    other.removeItem(KEY_TOKEN)
    other.removeItem(KEY_ROLE)
    other.removeItem(KEY_USERNAME)

    store.setItem(KEY_TOKEN, token)
    store.setItem(KEY_ROLE, role)
    if (username) store.setItem(KEY_USERNAME, username)

    if (remember) {
      localStorage.setItem(KEY_REMEMBER, '1')
      if (username) localStorage.setItem(KEY_USERNAME, username)
    } else {
      localStorage.removeItem(KEY_REMEMBER)
    }

    setAuth({ token, role, username })
  }

  const clearAuth = () => {
    // Đăng xuất chủ động → bỏ luôn ghi nhớ, tránh lần sau tự vào lại
    wipeAuth({ keepRememberedUsername: false })
    setAuth(null)
  }

  const isAccountant = auth?.role === 'ACCOUNTANT' || auth?.role === 'SUPERADMIN'

  return { auth, saveAuth, clearAuth, isAccountant }
}
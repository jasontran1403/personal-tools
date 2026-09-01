import { useState, useEffect, useCallback } from 'react'
import {
  readToolsToken, decodeToken, isExpired,
  createToken, saveToolsToken, wipeToolsToken, checkCredentials, normalizeUsername,
  TTL_REMEMBER, TTL_SESSION,
} from '../services/toolsAuth'

/** Đọc phiên hiện tại; token hết hạn coi như chưa đăng nhập. */
function currentAuth() {
  const token = readToolsToken()
  if (!token || isExpired(token)) return null
  const p = decodeToken(token)
  return { token, username: p?.sub || '', exp: p?.exp || 0 }
}

/**
 * Đăng nhập / đăng xuất cho khu Tiện ích (/tools).
 * Tách khỏi useAuth (Kế toán) để hai phiên không giẫm lên nhau.
 */
export function useToolsAuth() {
  const [auth, setAuth] = useState(currentAuth)

  // Đăng nhập/đăng xuất ở tab này thì tab khác đồng bộ theo
  useEffect(() => {
    const onStorage = e => {
      if (e.key === 'tools:token' || e.key === null) setAuth(currentAuth())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  /** @returns {Promise<{ok:boolean, message?:string}>} */
  const login = useCallback(async (username, password, remember = false) => {
    const uname = normalizeUsername(username)
    if (!checkCredentials(uname, password)) {
      return { ok: false, message: 'Sai tên đăng nhập hoặc mật khẩu.' }
    }
    const token = await createToken(uname, remember ? TTL_REMEMBER : TTL_SESSION)
    saveToolsToken(token, { remember, username: uname })
    setAuth(currentAuth())
    return { ok: true }
  }, [])

  const logout = useCallback(() => {
    wipeToolsToken({ keepRememberedUsername: false })
    setAuth(null)
  }, [])

  const refresh = useCallback(() => setAuth(currentAuth()), [])

  return { auth, login, logout, refresh }
}

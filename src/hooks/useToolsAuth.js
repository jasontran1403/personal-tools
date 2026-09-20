import { useState, useEffect, useCallback, useRef } from 'react'
import {
  readToolsToken, readToolsUser, wipeToolsToken,
  login as apiLogin, verifyToken as apiVerify,
} from '../services/toolsAuth'

/**
 * Đăng nhập / đăng xuất cho khu Tiện ích (/tools).
 *
 * Khi hook mount, tự gọi verifyToken để:
 *   - Loại token đã hết hạn (backend từ chối, hook xóa luôn).
 *   - Làm mới thông tin user (admin có thể vừa đổi displayName ở bảng users).
 *
 * `ready` = true khi lần verify đầu tiên xong. UI hiển thị Skeleton hoặc chặn
 * điều hướng cho tới lúc đó để tránh flash "đăng nhập → chưa đăng nhập → đăng
 * nhập" khi refresh trang.
 */
export function useToolsAuth() {
  const [auth, setAuth] = useState(() => {
    const token = readToolsToken()
    const user  = readToolsUser()
    return token && user ? { token, ...user } : null
  })
  const [ready, setReady] = useState(false)
  const verifiedOnce = useRef(false)

  // Đăng nhập/đăng xuất ở tab này đồng bộ sang tab khác qua storage event
  useEffect(() => {
    const onStorage = e => {
      if (e.key === 'tools:token' || e.key === null) {
        const token = readToolsToken()
        const user  = readToolsUser()
        setAuth(token && user ? { token, ...user } : null)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Verify 1 lần lúc mount. Nếu backend từ chối → auth về null.
  useEffect(() => {
    if (verifiedOnce.current) return
    verifiedOnce.current = true
    ;(async () => {
      const token = readToolsToken()
      if (!token) { setReady(true); return }
      const data = await apiVerify()
      if (data) {
        setAuth({
          token,
          username: data.username,
          displayName: data.displayName || '',
          admin: !!data.admin,
          expiresAt: data.expiresAt,
        })
      } else {
        setAuth(null)
      }
      setReady(true)
    })()
  }, [])

  const login = useCallback(async (username, password, remember = false) => {
    const res = await apiLogin(username, password, remember)
    if (res.ok) {
      const d = res.user
      setAuth({
        token: d.token,
        username: d.username,
        displayName: d.displayName || '',
        admin: !!d.admin,
        expiresAt: d.expiresAt,
      })
    }
    return res
  }, [])

  const logout = useCallback(() => {
    wipeToolsToken({ keepRememberedUsername: false })
    setAuth(null)
  }, [])

  return { auth, ready, login, logout }
}

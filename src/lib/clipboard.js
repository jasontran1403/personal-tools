/**
 * Copy chuỗi vào clipboard.
 *
 * Ưu tiên navigator.clipboard (secure context: HTTPS hoặc localhost). Fallback
 * dùng execCommand cho HTTP nội bộ. Return Promise<boolean> — true nếu OK.
 *
 * Không bắn toast trong đây — caller tự bắn để text tùy ngữ cảnh
 * ("Đã copy tên đăng nhập", "Đã copy mật khẩu"...).
 */
export async function copyText(text) {
  if (text == null || text === '') return false
  const s = String(text)
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(s)
      return true
    }
  } catch { /* fallback */ }

  // Fallback: tạo textarea ẩn, select, execCommand
  try {
    const ta = document.createElement('textarea')
    ta.value = s
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

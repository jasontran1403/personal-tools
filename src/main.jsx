import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './theme/darkmode.css'
import AppToaster from './components/common/AppToaster'
import { ThemeProvider, applyThemeFromStorage } from './theme/ThemeProvider'

// Áp dark class NGAY trước khi React mount để tránh "flash sáng" khi user
// đã chọn dark mode (persisted ở localStorage) hoặc OS đang dark.
applyThemeFromStorage()

function lockViewportZoom() {
  let meta = document.querySelector('meta[name="viewport"]')
  if (!meta) { meta = document.createElement('meta'); meta.name = 'viewport'; document.head.appendChild(meta) }
  meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover')
  // iOS Safari bỏ qua user-scalable=no → chặn pinch-zoom bằng gesture* events.
  //   Các event này CHỈ bắn khi pinch nên không ảnh hưởng cuộn.
  //   ⚠ 2026-11-12: KHÔNG dùng listener touchmove/touchend non-passive trên
  //   document để chặn zoom — chúng tắt fast-path cuộn của trình duyệt, gây
  //   "thỉnh thoảng cuộn bị kẹt". Zoom bằng cử chỉ do CSS `touch-action:
  //   pan-x pan-y` (Android/Chrome) + gesture* (iOS) đã xử lý.
  const swallow = e => e.preventDefault()
  document.addEventListener('gesturestart', swallow, { passive: false })
  document.addEventListener('gesturechange', swallow, { passive: false })
  document.addEventListener('gestureend', swallow, { passive: false })
}
lockViewportZoom()

// 2026-11-13: Sau khi deploy bản mới, chunk lazy-load cũ (vd assets/index-xxxx.js)
//   bị xóa → tab đang mở nạp động sẽ lỗi "Failed to fetch dynamically imported
//   module" / MIME text/html. Tự reload 1 lần để lấy index.html mới (chặn loop:
//   tối đa 1 lần mỗi 10s — nếu reload xong vẫn lỗi thì là vấn đề khác, không loop).
window.addEventListener('vite:preloadError', () => {
  const key = 'vitePreloadReloadAt'
  const last = Number(sessionStorage.getItem(key) || 0)
  if (Date.now() - last > 10000) {
    sessionStorage.setItem(key, String(Date.now()))
    window.location.reload()
  }
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <App />
    <AppToaster position="top-right" />
  </ThemeProvider>
)
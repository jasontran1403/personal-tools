import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './theme/darkmode.css'
import { Toaster } from 'react-hot-toast'
import { ThemeProvider, applyThemeFromStorage } from './theme/ThemeProvider'

// Áp dark class NGAY trước khi React mount để tránh "flash sáng" khi user
// đã chọn dark mode (persisted ở localStorage) hoặc OS đang dark.
applyThemeFromStorage()

function lockViewportZoom() {
  let meta = document.querySelector('meta[name="viewport"]')
  if (!meta) { meta = document.createElement('meta'); meta.name = 'viewport'; document.head.appendChild(meta) }
  meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover')
  const swallow = e => e.preventDefault()
  document.addEventListener('gesturestart', swallow, { passive: false })
  document.addEventListener('gesturechange', swallow, { passive: false })
  document.addEventListener('gestureend', swallow, { passive: false })
}
lockViewportZoom()

ReactDOM.createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <App />
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 3000,
        // Toast tự theo dark class qua CSS trong darkmode.css nhưng
        // react-hot-toast dùng inline style — ép màu cơ bản ở đây.
        className: 'tools-toast',
      }}
    />
  </ThemeProvider>
)

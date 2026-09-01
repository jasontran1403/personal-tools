import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { Toaster } from 'react-hot-toast'

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
  <>
    <App />
    <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
  </>
)

import axios from 'axios'
import { readToolsToken, wipeToolsToken } from './toolsAuth'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:9009'

const api = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' }
})

/**
 * Không phải endpoint tool nào cũng cần Bearer:
 *   - /api/tools/auth/**   : bản thân là đăng nhập, không cần
 *   - /api/tools/qr, /watermark/add|logo, /sign : tiện ích, không lưu theo user
 *
 * Còn lại đều gắn token. Nếu chưa có token thì cứ để trống — backend sẽ trả 401
 * và interceptor response sẽ điều hướng về màn Đăng nhập.
 *
 * ── FIX 2026-09-15 ──────────────────────────────────────────────────────
 * Trước đây `needsAuth('/vmb-files/')` trả true để interceptor tự đính Bearer
 * — nhưng token đó là scope Tools, không verify được ở JwtAuthenticationFilter
 * chính (2 secret khác nhau) → 401 "signature does not match".
 *
 * Nay BE đã: (a) hợp nhất secret, (b) đưa /vmb-files/** vào PUBLIC_API_PREFIXES.
 * File mặt vé + CCCD/PP là static với tên UUID không đoán được, tương đương
 * "public" cho mục đích thực tế. FE không cần đính token cho /vmb-files/ nữa,
 * ưu điểm là {@code <iframe>} / {@code <img>} có thể lấy trực tiếp qua URL
 * không phải fetch-as-blob rồi createObjectURL.
 */
const NO_AUTH_PREFIXES = [
  '/api/tools/auth',
  '/api/tools/qr',
  '/api/tools/watermark/add',
  '/api/tools/watermark/logo',
  '/api/tools/sign',
]

function needsAuth(url = '') {
  // /vmb-files/** giờ public — không đính token
  if (url.startsWith('/vmb-files/')) return false
  if (!url.startsWith('/api/tools/')) return false
  return !NO_AUTH_PREFIXES.some(p => url.startsWith(p))
}

api.interceptors.request.use(cfg => {
  // Upload file → xóa Content-Type để trình duyệt tự đặt kèm boundary
  if (typeof FormData !== 'undefined' && cfg.data instanceof FormData) {
    delete cfg.headers['Content-Type']
    delete cfg.headers['content-type']
  }
  if (needsAuth(cfg.url || '')) {
    const token = readToolsToken()
    if (token) cfg.headers.Authorization = `Bearer ${token}`
  }
  return cfg
})

api.interceptors.response.use(
  res => res,
  err => {
    const status = err?.response?.status
    if (status === 401 && needsAuth(err?.config?.url || '')) {
      wipeToolsToken({ keepRememberedUsername: true })
      window.dispatchEvent(new CustomEvent('tools:session-expired'))
      if (!window.location.pathname.startsWith('/login')) {
        const back = encodeURIComponent(window.location.pathname + window.location.search)
        window.location.replace(`/login?back=${back}`)
      }
    }
    return Promise.reject(err)
  },
)

export default api

// ─── Media ────────────────────────────────────────────────────────
export const mediaUrl = path => {
  if (!path) return ''
  return /^https?:\/\//.test(path) ? path : BASE + path
}

/**
 * URL đầy đủ cho file /vmb-files/** (dùng cho <img src>, <iframe src>).
 * Endpoint này giờ public — không cần token.
 */
export const vmbFileUrl = path => {
  if (!path) return ''
  return /^https?:\/\//.test(path) ? path : BASE + path
}

export const listMedia = (page = 0, size = 40, filters = {}) => {
  const params = { page, size }
  if (filters.favorite) params.favorite = true
  if (filters.from) params.from = filters.from
  if (filters.to) params.to = filters.to
  if (filters.q) params.q = filters.q
  if (filters.albumId) params.albumId = filters.albumId
  return api.get('/api/tools/media', { params })
}

export const renameMedia = (id, name) => api.patch(`/api/tools/media/${id}/name`, { name })
export const favoriteMedia = (id, favorite) => api.patch(`/api/tools/media/${id}/favorite`, { favorite })
export const favoriteMediaBatch = (ids, favorite = true) => api.post('/api/tools/media/favorite-batch', { ids, favorite })

export const uploadMedia = (files, onProgress) => {
  const form = new FormData()
  Array.from(files).forEach(f => form.append('files', f))
  return api.post('/api/tools/media/upload', form, { timeout: 15 * 60 * 1000, onUploadProgress: onProgress })
}

export const CHUNK_THRESHOLD = 8 * 1024 * 1024
const CHUNK_SIZE = 4 * 1024 * 1024

const unwrapEnvelope = res => {
  const env = res?.data
  if (env && typeof env.code === 'number' && !(env.code >= 900 && env.code < 1000)) throw new Error(env.message || 'Yêu cầu thất bại')
  return env?.data ?? env
}

export const uploadOneFile = async (file, onProgress) => {
  if (file.size <= CHUNK_THRESHOLD) {
    const form = new FormData()
    form.append('files', file)
    const res = await api.post('/api/tools/media/upload', form, {
      timeout: 15 * 60 * 1000,
      onUploadProgress: ev => { if (ev.total) onProgress?.(Math.round((ev.loaded / ev.total) * 100)) },
    })
    const data = unwrapEnvelope(res)
    if (data?.failed?.length) throw new Error(data.failed[0])
    return data?.saved?.[0]
  }

  const init = unwrapEnvelope(await api.post('/api/tools/media/chunk/init'))
  const uploadId = init.uploadId
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
  for (let i = 0; i < totalChunks; i++) {
    const blob = file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size))
    const form = new FormData()
    form.append('uploadId', uploadId)
    form.append('index', String(i))
    form.append('chunk', blob, `part_${i}`)
    await api.post('/api/tools/media/chunk/part', form, {
      timeout: 10 * 60 * 1000,
      onUploadProgress: ev => { const partRatio = ev.total ? ev.loaded / ev.total : 0; onProgress?.(Math.round(((i + partRatio) / totalChunks) * 99)) },
    })
    onProgress?.(Math.round(((i + 1) / totalChunks) * 99))
  }
  const asset = unwrapEnvelope(await api.post('/api/tools/media/chunk/complete', { uploadId, totalChunks, fileName: file.name, contentType: file.type || '' }))
  onProgress?.(100)
  return asset
}

export const deleteMedia = id => api.delete(`/api/tools/media/${id}`)
export const deleteMediaBatch = ids => api.post('/api/tools/media/delete-batch', { ids })
export const mediaZipUrl = ids => `${BASE}/api/tools/media/download-zip?ids=${ids.join(',')}`

// Albums
export const listAlbums = () => api.get('/api/tools/media/albums')
export const createAlbum = name => api.post('/api/tools/media/albums', { name })
export const deleteAlbum = id => api.delete(`/api/tools/media/albums/${id}`)
export const renameAlbum = (id, name) => api.patch(`/api/tools/media/albums/${id}/name`, { name })
export const addToAlbum = (albumId, assetIds) => api.post(`/api/tools/media/albums/${albumId}/add`, { assetIds })
export const removeFromAlbum = (albumId, assetIds) => api.post(`/api/tools/media/albums/${albumId}/remove`, { assetIds })

// QR
export const generateQr = params => {
  const body = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') body.append(k, v) })
  return api.post('/api/tools/qr/generate', body, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
}

// Watermark
export const fetchWatermarkLogo = () => api.get('/api/tools/watermark/logo', { responseType: 'blob' })
export const applyWatermark = (file, settings, type, onProgress) => {
  const form = new FormData()
  form.append('file', file)
  form.append('settings', JSON.stringify(settings))
  form.append('type', type)
  return api.post('/api/tools/watermark/add', form, { responseType: 'blob', timeout: 15 * 60 * 1000, onUploadProgress: onProgress })
}
export const watermarkAndSave = (file, settings, onProgress, signal) => {
  const form = new FormData()
  form.append('file', file)
  form.append('settings', JSON.stringify(settings))
  return api.post('/api/tools/watermark/save', form, { timeout: 15 * 60 * 1000, onUploadProgress: onProgress, signal })
}

// Sign PDF
export const signPdf = async ({ file, zones, pin }) => {
  const form = new FormData()
  form.append('file', file)
  form.append('zones', JSON.stringify({ zones }))
  const res = await api.post('/api/tools/sign', form, { responseType: 'blob', timeout: 5 * 60 * 1000, headers: { 'X-Token-Pin': pin } })
  const type = res.data?.type || ''
  if (type.includes('json')) { let m = 'Ký số thất bại'; try { const b = JSON.parse(await res.data.text()); m = b.message || m } catch { }; throw new Error(m) }
  if (!type.includes('pdf')) { const h = await res.data.slice(0, 5).text(); if (!h.startsWith('%PDF')) throw new Error('Không phải file PDF') }
  const cd = res.headers['content-disposition'] || ''
  const match = cd.match(/filename[^;=\n]*=\s*(?:["']?)([^"'\n;]+)/i)
  return { blobUrl: URL.createObjectURL(res.data), filename: match?.[1] || `signed_${Date.now()}.pdf` }
}
export const checkTokenStatus = pin => api.post('/api/tools/sign/token-status', {}, { headers: { 'X-Token-Pin': pin } })

// Download
export const downloadFile = async (url, filename) => {
  const res = await fetch(mediaUrl(url))
  if (!res.ok) throw new Error('Không tải được file')
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl; a.download = filename || 'download'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
}

// Todo
export const listTodos = (page = 0, size = 100, filters = {}) => {
  const params = { page, size }
  if (filters.status) params.status = filters.status
  if (filters.creator) params.creator = filters.creator
  if (filters.q) params.q = filters.q
  if (filters.from) params.from = filters.from
  if (filters.to) params.to = filters.to
  return api.get('/api/tools/todo', { params })
}
export const createTodo = data => api.post('/api/tools/todo', data)
export const updateTodo = (id, data) => api.patch(`/api/tools/todo/${id}`, data)
export const updateTodoStatus = (id, status) => api.patch(`/api/tools/todo/${id}/status`, { status })
export const deleteTodo = id => api.delete(`/api/tools/todo/${id}`)

// ─── Tools users (admin) ──────────────────────────────────────────
export const listToolsUsers = () => api.get('/api/tools/users')
export const createToolsUser = data => api.post('/api/tools/users', data)
export const updateToolsUser = (id, data) => api.patch(`/api/tools/users/${id}`, data)
export const deleteToolsUser = id => api.delete(`/api/tools/users/${id}`)
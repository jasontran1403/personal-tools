import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:9009'

const api = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' }
})

// Upload file → remove Content-Type to let browser set boundary
api.interceptors.request.use(cfg => {
  if (typeof FormData !== 'undefined' && cfg.data instanceof FormData) {
    delete cfg.headers['Content-Type']
    delete cfg.headers['content-type']
  }
  return cfg
})

export default api

// ─── Media ────────────────────────────────────────────────────────
export const mediaUrl = path => {
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
  if (type.includes('json')) { let m = 'Ký số thất bại'; try { const b = JSON.parse(await res.data.text()); m = b.message || m } catch {}; throw new Error(m) }
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

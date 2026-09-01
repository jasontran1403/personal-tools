import api from './api'

/**
 * Kho Tệp + máy in.
 *
 * Tách khỏi api.js cho gọn, nhưng DÙNG CHUNG axios instance để thừa hưởng
 * interceptor xử lý phiên hết hạn và bộ gỡ Content-Type cho FormData.
 */

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:9009'

/** Backend trả đường dẫn tương đối (/files/xxx) vì không biết domain đang chạy */
export const fileUrl = path => {
  if (!path) return ''
  return /^https?:\/\//.test(path) ? path : BASE + path
}

/**
 * Backend bọc mọi phản hồi trong { code, message, data }. Mã 9xx là lỗi xác
 * thực đã được interceptor xử lý; các mã còn lại khác success thì ném ra để
 * component chỉ cần try/catch.
 */
const unwrap = res => {
  const env = res?.data
  if (env && typeof env.code === 'number' && !(env.code >= 900 && env.code < 1000)) {
    throw new Error(env.message || 'Yêu cầu thất bại')
  }
  return env?.data ?? env
}

// ═══════════════════════════════════════════════════════════════════
// Danh sách
// ═══════════════════════════════════════════════════════════════════

/**
 * @param filters { q, exts: [], from, to, sort: 'createdAt'|'name'|'size', dir: 'asc'|'desc' }
 */
export const listFiles = async (page = 0, size = 40, filters = {}) => {
  const params = {
    page, size,
    sort: filters.sort || 'createdAt',
    dir:  filters.dir  || 'desc',
  }
  if (filters.q) params.q = filters.q
  if (filters.from) params.from = filters.from
  if (filters.to)   params.to   = filters.to
  if (filters.exts?.length) params.ext = filters.exts.join(',')

  return unwrap(await api.get('/api/tools/files', { params }))
}

export const listFileFacets = async () =>
  unwrap(await api.get('/api/tools/files/facets'))

// ═══════════════════════════════════════════════════════════════════
// Đặt tên
// ═══════════════════════════════════════════════════════════════════

/**
 * Hỏi trước xem tên có bị trùng không → { finalName, renamed, requested }.
 * Gọi lúc người dùng vừa gõ xong, để cảnh báo hiện NGAY chứ không đợi tải xong.
 */
export const checkFileName = async (name, ext) =>
  unwrap(await api.post('/api/tools/files/check-name', { name, ext }))

export const renameFile = async (id, name) =>
  unwrap(await api.patch(`/api/tools/files/${id}/name`, { name }))

export const deleteFile = id => api.delete(`/api/tools/files/${id}`)

/** Xóa nhiều tệp cùng lúc */
export const deleteFilesBatch = ids =>
  api.post('/api/tools/files/delete-batch', { ids })

/** URL tải nhiều tệp về dưới dạng 1 file zip */
export const filesZipUrl = ids =>
  `${BASE}/api/tools/files/download-zip?ids=${ids.join(',')}`

// ═══════════════════════════════════════════════════════════════════
// Tải lên
// ═══════════════════════════════════════════════════════════════════

/** File lớn hơn ngưỡng này thì chia nhỏ để gửi */
export const CHUNK_THRESHOLD = 8 * 1024 * 1024
const CHUNK_SIZE = 4 * 1024 * 1024

/**
 * Tải MỘT tệp, tự chọn cách gửi theo kích thước.
 *
 * Chia nhỏ giải quyết hai chuyện với file nặng: mạng rớt giữa chừng chỉ mất một
 * phần thay vì mất trắng, và mỗi request đều nhỏ nên không đụng giới hạn
 * max-file-size của Spring.
 *
 * @param desiredName tên người dùng nhập; để trống thì lấy tên file gốc
 * @param onProgress  nhận số 0–100
 * @param signal      AbortSignal để huỷ giữa chừng
 */
export const uploadFile = async (file, desiredName, onProgress, signal) => {
  if (file.size <= CHUNK_THRESHOLD) {
    const form = new FormData()
    form.append('file', file)
    if (desiredName) form.append('name', desiredName)

    return unwrap(await api.post('/api/tools/files/upload', form, {
      timeout: 15 * 60 * 1000,
      signal,
      onUploadProgress: ev => {
        if (ev.total) onProgress?.(Math.round((ev.loaded / ev.total) * 100))
      },
    }))
  }

  // ── Gửi theo từng phần ──
  const { uploadId } = unwrap(await api.post('/api/tools/files/chunk/init', {}, { signal }))
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

  for (let i = 0; i < totalChunks; i++) {
    const blob = file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size))
    const form = new FormData()
    form.append('uploadId', uploadId)
    form.append('index', String(i))
    form.append('chunk', blob, `part_${i}`)

    await api.post('/api/tools/files/chunk/part', form, {
      timeout: 10 * 60 * 1000,
      signal,
      onUploadProgress: ev => {
        // Tổng tiến độ = số phần xong + phần đang gửi dở. Chốt ở 99 vì bước
        // ghép file ở máy chủ vẫn chưa chạy.
        const partRatio = ev.total ? ev.loaded / ev.total : 0
        onProgress?.(Math.round(((i + partRatio) / totalChunks) * 99))
      },
    })
    onProgress?.(Math.round(((i + 1) / totalChunks) * 99))
  }

  const asset = unwrap(await api.post('/api/tools/files/chunk/complete', {
    uploadId,
    totalChunks,
    fileName: file.name,
    name: desiredName || '',
    contentType: file.type || '',
  }, { signal }))

  onProgress?.(100)
  return asset
}

// ═══════════════════════════════════════════════════════════════════
// Nội dung
// ═══════════════════════════════════════════════════════════════════

/** Nội dung dạng chữ — mã nguồn, csv, md, sql */
export const fetchFileText = async id =>
  unwrap(await api.get(`/api/tools/files/${id}/text`))

/** Nội dung nhị phân — xlsx, docx, pdf. Trả ArrayBuffer cho SheetJS/mammoth. */
export const fetchFileBuffer = async (id, url) => {
  const res = await fetch(fileUrl(url))
  if (!res.ok) throw new Error('Không tải được nội dung tệp')
  return res.arrayBuffer()
}

/** Ghi đè nội dung sau khi sửa. @param blob Blob đã dựng ở client */
export const saveFileContent = async (id, blob, fileName, onProgress) => {
  const form = new FormData()
  form.append('file', new File([blob], fileName || 'file'))
  return unwrap(await api.put(`/api/tools/files/${id}/content`, form, {
    timeout: 10 * 60 * 1000,
    onUploadProgress: ev => {
      if (ev.total) onProgress?.(Math.round((ev.loaded / ev.total) * 100))
    },
  }))
}

/**
 * Tải tệp về máy.
 *
 * Đi qua endpoint /download chứ không dùng <a download> với /files/xxx:
 * thuộc tính download bị bỏ qua khi khác origin (dev chạy 5173, API ở 9009),
 * trình duyệt sẽ MỞ file thay vì tải, và tên hiển thị cũng mất.
 */
export const downloadFileAsset = async asset => {
  const res = await fetch(`${BASE}/api/tools/files/${asset.id}/download`)
  if (!res.ok) throw new Error('Không tải được tệp')
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = objectUrl
  a.download = asset.originalName || 'download'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
}

/** Đưa Blob dựng ở client (xlsx/csv/docx đã export) về máy người dùng */
export const saveBlobAs = (blob, fileName) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

// ═══════════════════════════════════════════════════════════════════
// Máy in
// ═══════════════════════════════════════════════════════════════════

export const listPrinters = async () =>
  unwrap(await api.get('/api/tools/printers'))

/** Quét mạng — mất vài giây, timeout nới rộng */
export const discoverPrinters = async () =>
  unwrap(await api.post('/api/tools/printers/discover', {}, { timeout: 60 * 1000 }))

export const connectPrinter = async (uri, name) =>
  unwrap(await api.post('/api/tools/printers/connect', { uri, name }))

export const printFile = async (fileId, printer, options) =>
  unwrap(await api.post('/api/tools/printers/print', { fileId, printer, options },
    { timeout: 60 * 1000 }))

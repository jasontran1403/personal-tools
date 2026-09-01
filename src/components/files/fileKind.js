/**
 * Bảng tra: đuôi file → cách preview, màu badge, biểu tượng.
 *
 * Backend cũng phân loại (FileStorageService.detectKind) nhưng frontend không
 * dựa hoàn toàn vào đó: file cũ trong DB có thể mang `kind` của phiên bản trước,
 * và người dùng đổi tên vẫn giữ đuôi cũ. Đuôi file là nguồn sự thật cuối cùng.
 */

export const KIND = {
  IMAGE:   'IMAGE',
  VIDEO:   'VIDEO',
  PDF:     'PDF',
  SHEET:   'SHEET',    // xlsx, xls, csv — xem và sửa được
  DOC:     'DOC',      // docx — xem và sửa được
  CODE:    'CODE',     // hiện dạng IDE, có tô màu cú pháp
  SQL:     'SQL',      // như CODE nhưng tự format lại cho dễ đọc
  MARKDOWN:'MARKDOWN',
  TEXT:    'TEXT',
  OTHER:   'OTHER',    // chỉ hiện metadata
}

const BY_EXT = {
  // Ảnh
  jpg: KIND.IMAGE, jpeg: KIND.IMAGE, png: KIND.IMAGE, gif: KIND.IMAGE,
  webp: KIND.IMAGE, bmp: KIND.IMAGE, avif: KIND.IMAGE, svg: KIND.IMAGE,
  // Video
  mp4: KIND.VIDEO, mov: KIND.VIDEO, m4v: KIND.VIDEO, webm: KIND.VIDEO,
  avi: KIND.VIDEO, mkv: KIND.VIDEO,
  // Tài liệu
  pdf: KIND.PDF,
  xlsx: KIND.SHEET, xls: KIND.SHEET, xlsm: KIND.SHEET, csv: KIND.SHEET, tsv: KIND.SHEET,
  docx: KIND.DOC,
  // Chữ
  md: KIND.MARKDOWN, markdown: KIND.MARKDOWN,
  sql: KIND.SQL,
  txt: KIND.TEXT, log: KIND.TEXT,
  // Mã nguồn
  java: KIND.CODE, js: KIND.CODE, jsx: KIND.CODE, ts: KIND.CODE, tsx: KIND.CODE,
  html: KIND.CODE, htm: KIND.CODE, css: KIND.CODE, scss: KIND.CODE,
  py: KIND.CODE, json: KIND.CODE, xml: KIND.CODE, yml: KIND.CODE, yaml: KIND.CODE,
  sh: KIND.CODE, kt: KIND.CODE, go: KIND.CODE, rs: KIND.CODE, php: KIND.CODE,
  rb: KIND.CODE, c: KIND.CODE, cpp: KIND.CODE, h: KIND.CODE, cs: KIND.CODE,
  vue: KIND.CODE, svelte: KIND.CODE,
}

/** Ngôn ngữ cho highlight.js — tên không phải lúc nào cũng trùng đuôi file */
const HLJS_LANG = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', kt: 'kotlin', rs: 'rust', sh: 'bash', yml: 'yaml',
  htm: 'xml', html: 'xml', svelte: 'xml', vue: 'xml', h: 'cpp',
}

export const extOf = name => {
  if (!name) return ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export const kindOf = asset => {
  const ext = (asset?.ext || extOf(asset?.originalName) || '').toLowerCase()
  return BY_EXT[ext] || KIND.OTHER
}

export const hljsLangOf = ext => HLJS_LANG[ext] || ext || 'plaintext'

/** Preview được thì mở cửa sổ xem; không thì chỉ hiện thông tin tệp */
export const isPreviewable = asset => kindOf(asset) !== KIND.OTHER

/** Sửa trực tiếp rồi lưu đè được */
export const isEditable = asset => {
  const k = kindOf(asset)
  return k === KIND.SHEET || k === KIND.DOC
}

/**
 * Màu badge theo nhóm đuôi.
 *
 * Cùng một hệ màu với phần còn lại của app (thang màu Tailwind), mỗi nhóm một
 * sắc riêng để liếc qua là nhận ra loại file mà không cần đọc chữ.
 */
const BADGE = {
  [KIND.IMAGE]:    'bg-violet-50  text-violet-700  border-violet-200',
  [KIND.VIDEO]:    'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
  [KIND.PDF]:      'bg-red-50     text-red-700     border-red-200',
  [KIND.SHEET]:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  [KIND.DOC]:      'bg-blue-50    text-blue-700    border-blue-200',
  [KIND.CODE]:     'bg-slate-100  text-slate-700   border-slate-300',
  [KIND.SQL]:      'bg-amber-50   text-amber-700   border-amber-200',
  [KIND.MARKDOWN]: 'bg-sky-50     text-sky-700     border-sky-200',
  [KIND.TEXT]:     'bg-gray-100   text-gray-600    border-gray-200',
  [KIND.OTHER]:    'bg-gray-100   text-gray-500    border-gray-200',
}

export const badgeClassOf = asset => BADGE[kindOf(asset)] || BADGE[KIND.OTHER]

const ICON = {
  [KIND.IMAGE]: '🖼️', [KIND.VIDEO]: '🎬', [KIND.PDF]: '📕',
  [KIND.SHEET]: '📊', [KIND.DOC]: '📝', [KIND.CODE]: '💻',
  [KIND.SQL]: '🗄️', [KIND.MARKDOWN]: '📄', [KIND.TEXT]: '📄',
  [KIND.OTHER]: '📦',
}

export const iconOf = asset => ICON[kindOf(asset)] || ICON[KIND.OTHER]

export const KIND_LABEL = {
  [KIND.IMAGE]: 'Hình ảnh', [KIND.VIDEO]: 'Video', [KIND.PDF]: 'PDF',
  [KIND.SHEET]: 'Bảng tính', [KIND.DOC]: 'Tài liệu', [KIND.CODE]: 'Mã nguồn',
  [KIND.SQL]: 'SQL', [KIND.MARKDOWN]: 'Markdown', [KIND.TEXT]: 'Văn bản',
  [KIND.OTHER]: 'Tệp khác',
}

// ── Định dạng hiển thị ───────────────────────────────────────────

export const fmtSize = bytes => {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

const pad = n => String(n).padStart(2, '0')

export const fmtDateTime = ts => {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "3 phút trước" cho mốc gần, ngày tháng đầy đủ cho mốc xa */
export const fmtRelative = ts => {
  if (!ts) return '—'
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1)  return 'Vừa xong'
  if (min < 60) return `${min} phút trước`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} giờ trước`
  const day = Math.floor(hour / 24)
  if (day < 7) return `${day} ngày trước`
  return fmtDateTime(ts)
}

/** Tách "Báo cáo.xlsx" → { base: 'Báo cáo', ext: 'xlsx' } để ô nhập tên chỉ sửa phần gốc */
export const splitName = name => {
  const ext = extOf(name)
  return ext
    ? { base: name.slice(0, name.length - ext.length - 1), ext }
    : { base: name, ext: '' }
}

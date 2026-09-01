import * as XLSX from 'xlsx-js-style'
import { colToLetter, cellKey, addressOf, Engine, formatValue, isError } from './formulaEngine'

/**
 * Đọc / ghi bảng tính.
 *
 * Dùng xlsx-js-style thay vì gói `xlsx` cộng đồng: bản gốc ĐỌC được định dạng
 * ô nhưng khi GHI thì vứt hết đi, nên người dùng tô màu, in đậm rồi lưu lại là
 * mất sạch. xlsx-js-style là bản fork MIT giữ nguyên style lúc ghi.
 *
 * Mô hình dữ liệu trong bộ nhớ — cố ý phẳng để React so sánh nhanh:
 *   sheet = { name, rows, cols, cells: { 'r,c': { v, s } }, colWidths: { c: px } }
 *   v = chuỗi người dùng gõ (bắt đầu bằng '=' là công thức)
 *   s = { bold, italic, underline, align, color, bg, fontSize, numFmt }
 */

export const DEFAULT_ROWS = 60
export const DEFAULT_COLS = 20
export const DEFAULT_COL_WIDTH = 112

export const emptySheet = (name = 'Trang 1') => ({
  name,
  rows: DEFAULT_ROWS,
  cols: DEFAULT_COLS,
  cells: {},
  colWidths: {},
})

// ═══════════════════════════════════════════════════════════════════
// Đọc
// ═══════════════════════════════════════════════════════════════════

/** @returns [{ name, rows, cols, cells, colWidths }] */
export function readWorkbook(arrayBuffer, ext = 'xlsx') {
  const wb = XLSX.read(arrayBuffer, {
    type: 'array',
    cellStyles: true,
    cellFormula: true,
    cellNF: true,
    cellDates: true,
    // CSV do Excel Việt Nam xuất ra hay là UTF-8 có BOM; SheetJS tự nhận BOM,
    // còn windows-1258 thì phải chỉ định — hiếm nên chấp nhận đọc UTF-8.
    codepage: ext === 'csv' || ext === 'tsv' ? 65001 : undefined,
  })

  return wb.SheetNames.map(name => readSheet(wb.Sheets[name], name))
}

function readSheet(ws, name) {
  const ref = ws['!ref'] || 'A1'
  const range = XLSX.utils.decode_range(ref)

  const cells = {}
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[addr]
      if (!cell) continue

      const v = rawOf(cell)
      const s = styleOf(cell)
      if (v === '' && !s) continue

      cells[cellKey(r, c)] = s ? { v, s } : { v }
    }
  }

  const colWidths = {}
  ;(ws['!cols'] || []).forEach((col, i) => {
    // SheetJS đo cột bằng "ký tự"; ~7px một ký tự là tỉ lệ khớp mắt thường nhất
    if (col?.wpx) colWidths[i] = Math.round(col.wpx)
    else if (col?.wch) colWidths[i] = Math.round(col.wch * 7 + 12)
  })

  return {
    name,
    // Chừa sẵn vài dòng/cột trống để gõ tiếp mà không phải bấm "thêm dòng"
    rows: Math.max(DEFAULT_ROWS, range.e.r + 8),
    cols: Math.max(DEFAULT_COLS, range.e.c + 4),
    cells,
    colWidths,
  }
}

/** Ô trong file → chuỗi thô như người dùng đã gõ */
function rawOf(cell) {
  if (cell.f) return '=' + cell.f
  if (cell.v == null) return ''
  if (cell.t === 'd' && cell.v instanceof Date) {
    return cell.v.toISOString().slice(0, 10)
  }
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE'
  return String(cell.v)
}

/** Style của SheetJS → mô hình gọn của mình. Trả null nếu ô không có định dạng. */
function styleOf(cell) {
  const s = cell.s
  if (!s) return null

  const out = {}
  if (s.font?.bold)      out.bold = true
  if (s.font?.italic)    out.italic = true
  if (s.font?.underline) out.underline = true
  if (s.font?.sz)        out.fontSize = s.font.sz
  if (s.font?.color?.rgb) out.color = '#' + String(s.font.color.rgb).slice(-6)

  // fgColor chứ không phải bgColor: với pattern "solid" thì SheetJS đặt màu nền
  // vào fgColor — đây là chỗ rất dễ nhầm khiến nền luôn ra trắng.
  if (s.fill?.fgColor?.rgb) {
    const rgb = String(s.fill.fgColor.rgb).slice(-6)
    if (rgb.toUpperCase() !== 'FFFFFF') out.bg = '#' + rgb
  }

  if (s.alignment?.horizontal) out.align = s.alignment.horizontal
  if (s.numFmt && /%/.test(s.numFmt)) out.numFmt = 'percent'

  return Object.keys(out).length ? out : null
}

// ═══════════════════════════════════════════════════════════════════
// Ghi
// ═══════════════════════════════════════════════════════════════════

/**
 * Xuất ra .xlsx, GIỮ NGUYÊN công thức và định dạng.
 *
 * Công thức được ghi lại dưới dạng công thức (không phải kết quả) để file mở
 * bằng Excel vẫn tính lại được — nhưng đồng thời ghi kèm giá trị đã tính, vì
 * Excel/LibreOffice hiện ô trống cho tới lần tính lại đầu tiên nếu thiếu nó.
 */
export function writeWorkbook(sheets) {
  const wb = XLSX.utils.book_new()

  for (const sheet of sheets) {
    const engine = new Engine((r, c) => sheet.cells[cellKey(r, c)]?.v ?? null)
    const ws = {}
    let maxR = 0, maxC = 0

    for (const [key, cell] of Object.entries(sheet.cells)) {
      if (cell?.v == null || cell.v === '') {
        if (!cell?.s) continue
      }
      const [r, c] = key.split(',').map(Number)
      maxR = Math.max(maxR, r)
      maxC = Math.max(maxC, c)

      const addr = XLSX.utils.encode_cell({ r, c })
      ws[addr] = toXlsxCell(cell, engine, r, c)
    }

    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } })
    ws['!cols'] = Array.from({ length: maxC + 1 }, (_, i) => ({
      wpx: sheet.colWidths[i] || DEFAULT_COL_WIDTH,
    }))

    // Excel giới hạn tên trang 31 ký tự và cấm : \ / ? * [ ]
    const safeName = (sheet.name || 'Trang').replace(/[:\\/?*[\]]/g, '').slice(0, 31) || 'Trang'
    XLSX.utils.book_append_sheet(wb, ws, safeName)
  }

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

function toXlsxCell(cell, engine, r, c) {
  const raw = cell.v ?? ''
  const out = {}

  if (typeof raw === 'string' && raw.startsWith('=')) {
    out.f = raw.slice(1)
    const computed = engine.value(r, c)
    if (!isError(computed) && computed !== '') {
      out.v = computed
      out.t = typeof computed === 'number' ? 'n' : typeof computed === 'boolean' ? 'b' : 's'
    } else {
      out.v = ''
      out.t = 's'
    }
  } else {
    const computed = engine.value(r, c)
    out.v = computed === '' ? '' : computed
    out.t = typeof computed === 'number' ? 'n' : typeof computed === 'boolean' ? 'b' : 's'
  }

  const s = cell.s
  if (s) {
    out.s = {}
    if (s.bold || s.italic || s.underline || s.color || s.fontSize) {
      out.s.font = {}
      if (s.bold)      out.s.font.bold = true
      if (s.italic)    out.s.font.italic = true
      if (s.underline) out.s.font.underline = true
      if (s.fontSize)  out.s.font.sz = s.fontSize
      if (s.color)     out.s.font.color = { rgb: s.color.replace('#', '').toUpperCase() }
    }
    if (s.bg) {
      // patternType phải là "solid", thiếu nó thì Excel bỏ qua màu nền
      out.s.fill = { patternType: 'solid', fgColor: { rgb: s.bg.replace('#', '').toUpperCase() } }
    }
    if (s.align) out.s.alignment = { horizontal: s.align }
    if (s.numFmt === 'percent')  out.z = '0.00%'
    if (s.numFmt === 'currency') out.z = '#,##0" ₫"'
    if (s.numFmt === 'number')   out.z = '#,##0.##'
  }
  return out
}

/**
 * Xuất CSV — chỉ GIÁ TRỊ, không công thức và không định dạng.
 * Đó là giới hạn của chính định dạng CSV chứ không phải thiếu sót; giao diện
 * nói rõ điều này trước khi người dùng bấm xuất.
 */
export function writeCsv(sheet) {
  const engine = new Engine((r, c) => sheet.cells[cellKey(r, c)]?.v ?? null)

  let maxR = -1, maxC = -1
  for (const key of Object.keys(sheet.cells)) {
    const [r, c] = key.split(',').map(Number)
    if (sheet.cells[key]?.v !== '' && sheet.cells[key]?.v != null) {
      maxR = Math.max(maxR, r)
      maxC = Math.max(maxC, c)
    }
  }
  if (maxR < 0) return new Blob([''], { type: 'text/csv;charset=utf-8' })

  const lines = []
  for (let r = 0; r <= maxR; r++) {
    const row = []
    for (let c = 0; c <= maxC; c++) {
      const cell = sheet.cells[cellKey(r, c)]
      const value = engine.value(r, c)
      row.push(escapeCsv(formatValue(value, cell?.s?.numFmt)))
    }
    lines.push(row.join(','))
  }

  // BOM ở đầu: thiếu nó thì Excel trên Windows mở CSV tiếng Việt ra toàn ký tự lỗi
  return new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
}

const escapeCsv = s => {
  const t = String(s ?? '')
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

// ═══════════════════════════════════════════════════════════════════
// Tiện ích
// ═══════════════════════════════════════════════════════════════════

export { colToLetter, cellKey, addressOf }

/** Nhãn ô để hiện trên thanh công thức ("B7") đến từ formulaEngine — xem ở trên */

/**
 * Dán dữ liệu từ clipboard. Excel và Google Sheets đều đặt bảng vào clipboard
 * dưới dạng TSV, nên tách theo tab là đủ cho cả hai.
 */
export function parseClipboardTable(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n$/, '')
    .split('\n')
    .map(line => line.split('\t'))
}
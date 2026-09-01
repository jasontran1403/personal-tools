import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import {
  Engine, cellKey, cellLabel, colToLetter, formatValue, isError, addressOf,
} from '../../lib/formulaEngine'
import { parseClipboardTable, DEFAULT_COL_WIDTH } from '../../lib/sheetIO'

/**
 * Lưới bảng tính sửa được — kiểu Google Sheets.
 *
 * Có: gõ nội dung, công thức (SUM/IF/VLOOKUP/HLOOKUP/COUNTIF...), chọn vùng,
 * sao chép–dán cả bảng, định dạng cơ bản, kéo giãn cột, thêm dòng/cột.
 *
 * VỀ HIỆU NĂNG — lý do lưới tự viết chứ không phải <table> thường:
 * chỉ vẽ những ô ĐANG NHÌN THẤY cộng một vùng đệm. Bảng 60 × 20 thì không khác
 * gì, nhưng file thật hay có vài nghìn dòng — vẽ hết là 100 nghìn nút DOM và
 * trình duyệt đứng hình. Đây gọi là windowing, tự làm để khỏi kéo thêm thư viện.
 */

const ROW_H = 30
const HEADER_H = 30
const ROW_LABEL_W = 52
const OVERSCAN = 6          // số dòng vẽ dư trên/dưới khung nhìn

const PALETTE = [
  '#ffffff', '#fef2f2', '#fff7ed', '#fefce8', '#f0fdf4',
  '#eff6ff', '#faf5ff', '#fdf2f8', '#f1f5f9', '#e2e8f0',
]

const TEXT_COLORS = [
  '#111827', '#dc2626', '#ea580c', '#ca8a04', '#16a34a',
  '#2563eb', '#7c3aed', '#db2777', '#64748b',
]

export default function SheetEditor({
  sheet,               // { name, rows, cols, cells, colWidths }
  onChange,            // (nextSheet) => void
  readOnly = false,
  className = '',
}) {
  const [sel, setSel] = useState({ r: 0, c: 0, r2: 0, c2: 0 })
  const [editing, setEditing] = useState(null)   // { r, c, draft }
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(600)
  const [showColors, setShowColors] = useState(false)

  const scrollRef = useRef(null)
  const editRef   = useRef(null)
  const barRef    = useRef(null)      // ô nhập trên thanh công thức
  const dragRef   = useRef(null)      // đang kéo chọn vùng
  /**
   * Đang "chỉ ô" cho công thức: người dùng gõ =SUM( rồi bấm/kéo trên lưới để
   * chọn vùng. Lưu lại vị trí ký tự bắt đầu tham chiếu trong chuỗi đang gõ,
   * để mỗi lần rê chuột chỉ thay đúng đoạn đó chứ không nối thêm liên tục.
   */
  const pointRef  = useRef(null)      // { start, anchor:{r,c} }
  /** Tham chiếu chèn gần nhất — giữ lại để Shift + bấm còn biết mở rộng từ đâu */
  const lastPointRef = useRef(null)
  const resizeRef = useRef(null)      // đang kéo giãn cột

  // ── Tính lại toàn bộ khi dữ liệu đổi ────────────────────────────
  // Engine mới mỗi lần cells đổi; nó tự nhớ kết quả từng ô nên một lượt vẽ
  // chỉ tính mỗi công thức đúng một lần dù nhiều ô cùng tham chiếu tới.
  const engine = useMemo(
    () => new Engine((r, c) => sheet.cells[cellKey(r, c)]?.v ?? null),
    [sheet.cells]
  )

  const widthOf = useCallback(
    c => sheet.colWidths[c] || DEFAULT_COL_WIDTH,
    [sheet.colWidths]
  )

  const colOffsets = useMemo(() => {
    const out = [0]
    for (let c = 0; c < sheet.cols; c++) out.push(out[c] + widthOf(c))
    return out
  }, [sheet.cols, widthOf])

  const totalWidth = colOffsets[sheet.cols]

  // ── Chỉ vẽ phần đang nhìn thấy ──────────────────────────────────
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const lastRow  = Math.min(sheet.rows - 1,
    Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setViewportH(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Đọc / ghi ô ─────────────────────────────────────────────────

  const rawAt = (r, c) => sheet.cells[cellKey(r, c)]?.v ?? ''
  const styleAt = (r, c) => sheet.cells[cellKey(r, c)]?.s


  /** Ghi nhiều ô một lượt — dán bảng lớn mà set từng ô thì React vẽ lại N lần */
  const patchCells = useCallback((updates, extra = {}) => {
    if (readOnly) return
    const cells = { ...sheet.cells }
    let maxR = sheet.rows - 1
    let maxC = sheet.cols - 1

    for (const { r, c, v, s } of updates) {
      const key = cellKey(r, c)
      const prev = cells[key] || {}
      const next = { ...prev }

      if (v !== undefined) next.v = v
      if (s !== undefined) next.s = s === null ? undefined : { ...(prev.s || {}), ...s }

      // Ô trống hoàn toàn thì xoá hẳn khỏi object, giữ cho state nhẹ
      if ((next.v == null || next.v === '') && !next.s) delete cells[key]
      else cells[key] = next

      maxR = Math.max(maxR, r)
      maxC = Math.max(maxC, c)
    }

    onChange({
      ...sheet,
      ...extra,
      cells,
      // Dán dữ liệu vượt khỏi bảng thì tự nới, không bắt người dùng thêm dòng tay
      rows: Math.max(sheet.rows, maxR + 1),
      cols: Math.max(sheet.cols, maxC + 1),
    })
  }, [sheet, onChange, readOnly])

  const setCell = (r, c, v) => patchCells([{ r, c, v }])

  // ── Vùng chọn ───────────────────────────────────────────────────

  const bounds = useMemo(() => ({
    r1: Math.min(sel.r, sel.r2), r2: Math.max(sel.r, sel.r2),
    c1: Math.min(sel.c, sel.c2), c2: Math.max(sel.c, sel.c2),
  }), [sel])

  const inSelection = (r, c) =>
    r >= bounds.r1 && r <= bounds.r2 && c >= bounds.c1 && c <= bounds.c2

  const selectedCount = (bounds.r2 - bounds.r1 + 1) * (bounds.c2 - bounds.c1 + 1)

  /** Tổng nhanh của vùng đang chọn, hiện ở thanh dưới như Excel */
  const quickStats = useMemo(() => {
    if (selectedCount < 2) return null
    let sum = 0, count = 0
    for (let r = bounds.r1; r <= bounds.r2; r++) {
      for (let c = bounds.c1; c <= bounds.c2; c++) {
        const v = engine.value(r, c)
        if (typeof v === 'number' && Number.isFinite(v)) { sum += v; count++ }
      }
    }
    return count ? { sum, count, avg: sum / count } : null
  }, [bounds, selectedCount, engine])

  // ── Bắt đầu / kết thúc sửa ô ────────────────────────────────────

  const beginEdit = (r, c, initial) => {
    if (readOnly) return
    pointRef.current = null
    lastPointRef.current = null
    setEditing({ r, c, draft: initial !== undefined ? initial : String(rawAt(r, c)) })
  }

  const commitEdit = (move = 'down') => {
    if (!editing) return
    pointRef.current = null
    lastPointRef.current = null
    const { r, c, draft } = editing
    setEditing(null)
    if (draft !== String(rawAt(r, c))) setCell(r, c, draft)

    if (move === 'down')  selectCell(Math.min(r + 1, sheet.rows - 1), c)
    if (move === 'right') selectCell(r, Math.min(c + 1, sheet.cols - 1))
  }

  const cancelEdit = () => { pointRef.current = null; setEditing(null) }

  // ══════════════════════════════════════════════════════════════
  // Nhập công thức
  // ══════════════════════════════════════════════════════════════

  const isFormula = editing != null && String(editing.draft).startsWith('=')

  /**
   * Đang ở vị trí CHỜ MỘT THAM CHIẾU hay chưa.
   *
   * Sau dấu `(`, dấu phẩy hoặc một toán tử thì thứ tiếp theo phải là ô/vùng —
   * lúc đó bấm chuột lên lưới nghĩa là "chèn địa chỉ ô này", không phải "chuyển
   * sang ô đó". Còn sau một con số hay dấu `)` thì công thức đã trọn vẹn, bấm
   * chuột là muốn rời đi thật.
   */
  const awaitingRef = draft => {
    if (!String(draft).startsWith('=')) return false
    const before = String(draft).slice(0, caretOf()).replace(/\s+$/, '')
    if (before === '=') return true
    return /[=+\-*/^&(,<>%:]$/.test(before)
  }

  /** Vị trí con trỏ trong ô nhập đang hoạt động */
  const activeInput = () => (editRef.current || barRef.current)
  const caretOf = () => {
    const el = activeInput()
    return el ? (el.selectionStart ?? String(editing?.draft ?? '').length)
              : String(editing?.draft ?? '').length
  }

  /** Đặt lại nội dung và con trỏ, giữ nguyên tiêu điểm ở ô nhập */
  const setDraftWithCaret = (draft, caret) => {
    setEditing(prev => prev && { ...prev, draft })
    requestAnimationFrame(() => {
      const el = activeInput()
      if (!el) return
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  /**
   * Phím tắt riêng cho ô nhập: tự đóng ngoặc.
   *
   * Gõ `(` → thành `()` với con trỏ nằm GIỮA, đúng như Excel và mọi IDE.
   * Gõ `)` khi ngay bên phải đã có `)` → chỉ nhảy qua nó, không sinh ra `))`.
   */
  const onEditKeyDown = e => {
    const el = e.currentTarget
    const draft = String(editing?.draft ?? '')
    const start = el.selectionStart
    const end = el.selectionEnd

    if (e.key === '(') {
      e.preventDefault()
      // Có bôi đen sẵn thì bọc phần đó vào trong ngoặc
      const inner = draft.slice(start, end)
      const next = draft.slice(0, start) + '(' + inner + ')' + draft.slice(end)
      setDraftWithCaret(next, start + 1 + inner.length)
      return true
    }

    if (e.key === ')' && draft[start] === ')' && start === end) {
      e.preventDefault()
      setDraftWithCaret(draft, start + 1)
      return true
    }
    return false
  }

  /**
   * Bấm/kéo trên lưới trong lúc đang chờ tham chiếu → chèn địa chỉ ô.
   *
   * e.preventDefault() ở sự kiện mousedown là mấu chốt: nó chặn trình duyệt
   * chuyển tiêu điểm, nhờ vậy ô nhập KHÔNG bị blur và không kích hoạt
   * commitEdit. Đây chính là lỗi bạn gặp — thiếu dòng này thì vừa bấm ô là
   * công thức bị chốt lại giữa chừng.
   */
  const insertRefFromGrid = (e, r, c) => {
    e.preventDefault()

    // Shift + bấm → mở rộng tham chiếu vừa chèn thành vùng, thay vì chèn thêm
    // một tham chiếu thứ hai dính liền nhau
    if (e.shiftKey && lastPointRef.current) {
      pointRef.current = lastPointRef.current
      extendRefFromGrid(r, c)
      pointRef.current = null
      return
    }

    const draft = String(editing.draft)
    const start = caretOf()
    pointRef.current = { start, anchor: { r, c } }
    lastPointRef.current = { start, anchor: { r, c } }

    const ref = cellLabel(r, c)
    const next = draft.slice(0, start) + ref + draft.slice(start)
    setDraftWithCaret(next, start + ref.length)
    setSel({ r, c, r2: r, c2: c })
  }

  /** Rê chuột trong lúc chỉ ô → mở rộng thành vùng A1:B5 */
  const extendRefFromGrid = (r, c) => {
    const p = pointRef.current
    if (!p) return
    const a = p.anchor
    const ref = (a.r === r && a.c === c)
      ? cellLabel(r, c)
      : `${cellLabel(a.r, a.c)}:${cellLabel(r, c)}`

    // Thay đúng đoạn tham chiếu đã chèn lần trước, tính từ vị trí đã ghi nhớ
    const draft = String(editing.draft)
    const tail = draft.slice(p.start).replace(/^\$?[A-Za-z]{1,3}\$?\d+(:\$?[A-Za-z]{1,3}\$?\d+)?/, '')
    const next = draft.slice(0, p.start) + ref + tail
    setDraftWithCaret(next, p.start + ref.length)
    setSel(prev => ({ ...prev, r2: r, c2: c }))
  }

  const selectCell = (r, c, extend = false) => {
    setSel(prev => extend ? { ...prev, r2: r, c2: c } : { r, c, r2: r, c2: c })
    scrollIntoView(r, c)
  }

  const scrollIntoView = (r, c) => {
    const el = scrollRef.current
    if (!el) return
    const top = r * ROW_H
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_H > el.scrollTop + el.clientHeight - HEADER_H) {
      el.scrollTop = top + ROW_H - el.clientHeight + HEADER_H
    }
    const left = colOffsets[c]
    if (left < el.scrollLeft) el.scrollLeft = left
    else if (left + widthOf(c) > el.scrollLeft + el.clientWidth - ROW_LABEL_W) {
      el.scrollLeft = left + widthOf(c) - el.clientWidth + ROW_LABEL_W
    }
  }

  /**
   * Chỉ phụ thuộc vào TOẠ ĐỘ ô đang sửa, không phụ thuộc vào nội dung đang gõ.
   * Trước đây đặt cả `editing` vào mảng phụ thuộc: object này đổi sau mỗi ký
   * tự, nên effect chạy lại và đẩy con trỏ về cuối — sửa chèn vào giữa chuỗi
   * là không thể, và chế độ chỉ ô cũng bị phá.
   */
  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus()
      const len = editRef.current.value.length
      editRef.current.setSelectionRange(len, len)
    }
  }, [editing?.r, editing?.c])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Bàn phím ────────────────────────────────────────────────────

  const onKeyDown = e => {
    if (editing) {
      if (e.key === 'Enter')  { e.preventDefault(); commitEdit('down') }
      if (e.key === 'Tab')    { e.preventDefault(); commitEdit('right') }
      if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
      return
    }

    const { r, c } = sel
    const shift = e.shiftKey
    const move = (dr, dc) => {
      e.preventDefault()
      selectCell(
        Math.max(0, Math.min(sheet.rows - 1, (shift ? sel.r2 : r) + dr)),
        Math.max(0, Math.min(sheet.cols - 1, (shift ? sel.c2 : c) + dc)),
        shift
      )
    }

    switch (e.key) {
      case 'ArrowUp':    return move(-1, 0)
      case 'ArrowDown':  return move(1, 0)
      case 'ArrowLeft':  return move(0, -1)
      case 'ArrowRight': return move(0, 1)
      case 'Tab':        e.preventDefault(); return selectCell(r, Math.min(sheet.cols - 1, c + 1))
      case 'Enter':      e.preventDefault(); return beginEdit(r, c)
      case 'F2':         e.preventDefault(); return beginEdit(r, c)
      case 'Home':       e.preventDefault(); return selectCell(r, 0)
      case 'Delete':
      case 'Backspace': {
        e.preventDefault()
        const updates = []
        for (let rr = bounds.r1; rr <= bounds.r2; rr++)
          for (let cc = bounds.c1; cc <= bounds.c2; cc++)
            updates.push({ r: rr, c: cc, v: '' })
        return patchCells(updates)
      }
      default: break
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'c') { e.preventDefault(); return copySelection() }
      if (e.key === 'b') { e.preventDefault(); return toggleStyle('bold') }
      if (e.key === 'i') { e.preventDefault(); return toggleStyle('italic') }
      if (e.key === 'u') { e.preventDefault(); return toggleStyle('underline') }
      return
    }

    // Gõ ký tự thường → vào thẳng chế độ sửa, thay nội dung cũ
    if (e.key.length === 1 && !e.altKey) {
      e.preventDefault()
      beginEdit(r, c, e.key)
    }
  }

  // ── Sao chép / dán ──────────────────────────────────────────────

  const copySelection = () => {
    const lines = []
    for (let r = bounds.r1; r <= bounds.r2; r++) {
      const row = []
      for (let c = bounds.c1; c <= bounds.c2; c++) {
        const v = engine.value(r, c)
        row.push(isError(v) ? v : formatValue(v, styleAt(r, c)?.numFmt))
      }
      lines.push(row.join('\t'))
    }
    navigator.clipboard?.writeText(lines.join('\n')).catch(() => {})
  }

  const onPaste = e => {
    if (readOnly || editing) return
    const text = e.clipboardData?.getData('text/plain')
    if (!text) return
    e.preventDefault()

    const table = parseClipboardTable(text)
    const updates = []
    table.forEach((row, dr) => {
      row.forEach((value, dc) => {
        updates.push({ r: bounds.r1 + dr, c: bounds.c1 + dc, v: value })
      })
    })
    patchCells(updates)
    setSel({
      r: bounds.r1, c: bounds.c1,
      r2: bounds.r1 + table.length - 1,
      c2: bounds.c1 + Math.max(...table.map(r => r.length)) - 1,
    })
  }

  // ── Định dạng ───────────────────────────────────────────────────

  const applyStyle = patch => {
    const updates = []
    for (let r = bounds.r1; r <= bounds.r2; r++)
      for (let c = bounds.c1; c <= bounds.c2; c++)
        updates.push({ r, c, s: patch })
    patchCells(updates)
  }

  const toggleStyle = key => {
    const current = styleAt(sel.r, sel.c)?.[key]
    applyStyle({ [key]: current ? undefined : true })
  }

  const clearStyle = () => {
    const updates = []
    for (let r = bounds.r1; r <= bounds.r2; r++)
      for (let c = bounds.c1; c <= bounds.c2; c++)
        updates.push({ r, c, s: null })
    patchCells(updates)
  }

  // ── Kéo giãn cột ────────────────────────────────────────────────

  const startResize = (e, c) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = { c, startX: e.clientX, startW: widthOf(c) }

    const onMove = ev => {
      const { c: col, startX, startW } = resizeRef.current
      const next = Math.max(48, startW + (ev.clientX - startX))
      onChange({ ...sheet, colWidths: { ...sheet.colWidths, [col]: next } })
    }
    const onUp = () => {
      resizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── Kéo chọn vùng ───────────────────────────────────────────────

  const onCellMouseDown = (e, r, c) => {
    if (e.button !== 0) return

    // Đang gõ công thức và đang chờ tham chiếu → chèn địa chỉ, KHÔNG chốt ô
    if (editing && awaitingRef(editing.draft)) {
      insertRefFromGrid(e, r, c)
      return
    }

    if (editing) commitEdit(null)
    pointRef.current = null
    dragRef.current = true
    setSel({ r, c, r2: r, c2: c })
  }

  const onCellMouseEnter = (r, c) => {
    if (pointRef.current) { extendRefFromGrid(r, c); return }
    if (!dragRef.current) return
    setSel(prev => ({ ...prev, r2: r, c2: c }))
  }

  useEffect(() => {
    const stop = () => {
      dragRef.current = false
      // Kết thúc kéo chỉ ô nhưng GIỮ chế độ nhập: người dùng còn phải gõ tiếp
      // dấu `)` hoặc dấu phẩy cho đối số sau
      if (pointRef.current) {
        pointRef.current = null
        requestAnimationFrame(() => activeInput()?.focus())
      }
    }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Thanh công thức ─────────────────────────────────────────────

  const activeRaw = rawAt(sel.r, sel.c)
  const activeStyle = styleAt(sel.r, sel.c) || {}

  const rows = []
  for (let r = firstRow; r <= lastRow; r++) rows.push(r)

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col min-h-0 bg-white ${className}`}>

      {/* Thanh định dạng */}
      {!readOnly && (
        <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 overflow-x-auto">
          <FmtBtn active={activeStyle.bold}      onClick={() => toggleStyle('bold')}      title="Đậm (Ctrl+B)"><b>B</b></FmtBtn>
          <FmtBtn active={activeStyle.italic}    onClick={() => toggleStyle('italic')}    title="Nghiêng (Ctrl+I)"><i>I</i></FmtBtn>
          <FmtBtn active={activeStyle.underline} onClick={() => toggleStyle('underline')} title="Gạch chân (Ctrl+U)"><u>U</u></FmtBtn>

          <Divider />

          <FmtBtn active={activeStyle.align === 'left'}   onClick={() => applyStyle({ align: 'left' })}   title="Căn trái">⬅</FmtBtn>
          <FmtBtn active={activeStyle.align === 'center'} onClick={() => applyStyle({ align: 'center' })} title="Căn giữa">↔</FmtBtn>
          <FmtBtn active={activeStyle.align === 'right'}  onClick={() => applyStyle({ align: 'right' })}  title="Căn phải">➡</FmtBtn>

          <Divider />

          <FmtBtn active={activeStyle.numFmt === 'number'}   onClick={() => applyStyle({ numFmt: activeStyle.numFmt === 'number' ? undefined : 'number' })}     title="Phân cách nghìn">1.000</FmtBtn>
          <FmtBtn active={activeStyle.numFmt === 'percent'}  onClick={() => applyStyle({ numFmt: activeStyle.numFmt === 'percent' ? undefined : 'percent' })}   title="Phần trăm">%</FmtBtn>
          <FmtBtn active={activeStyle.numFmt === 'currency'} onClick={() => applyStyle({ numFmt: activeStyle.numFmt === 'currency' ? undefined : 'currency' })} title="Tiền tệ">₫</FmtBtn>

          <Divider />

          <div className="relative">
            <FmtBtn active={showColors} onClick={() => setShowColors(v => !v)} title="Màu">🎨</FmtBtn>
            {showColors && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowColors(false)} />
                <div className="absolute z-40 top-9 left-0 w-52 bg-white rounded-xl shadow-xl border border-gray-200 p-3 space-y-3">
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Màu nền</p>
                    <div className="grid grid-cols-5 gap-1.5">
                      {PALETTE.map(hex => (
                        <button key={hex}
                          onClick={() => applyStyle({ bg: hex === '#ffffff' ? undefined : hex })}
                          style={{ background: hex }}
                          className="w-8 h-8 rounded-lg border border-gray-200 hover:ring-2 ring-blue-400 transition" />
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Màu chữ</p>
                    <div className="grid grid-cols-5 gap-1.5">
                      {TEXT_COLORS.map(hex => (
                        <button key={hex}
                          onClick={() => applyStyle({ color: hex === '#111827' ? undefined : hex })}
                          style={{ background: hex }}
                          className="w-8 h-8 rounded-lg border border-gray-200 hover:ring-2 ring-blue-400 transition" />
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <FmtBtn onClick={clearStyle} title="Xoá định dạng">⌫</FmtBtn>

          <Divider />

          <button
            onClick={() => onChange({ ...sheet, rows: sheet.rows + 20 })}
            className="h-8 px-2.5 rounded-lg text-xs font-semibold text-gray-500 hover:bg-gray-100 whitespace-nowrap">
            + Dòng
          </button>
          <button
            onClick={() => onChange({ ...sheet, cols: sheet.cols + 5 })}
            className="h-8 px-2.5 rounded-lg text-xs font-semibold text-gray-500 hover:bg-gray-100 whitespace-nowrap">
            + Cột
          </button>
        </div>
      )}

      {/* Thanh công thức */}
      <div className="shrink-0 flex items-stretch border-b border-gray-200 bg-gray-50/60">
        <div className="w-[70px] shrink-0 flex items-center justify-center text-xs font-bold text-gray-600 border-r border-gray-200 tabular-nums">
          {addressOf(sel.r, sel.c)}
        </div>
        <span className="w-8 shrink-0 flex items-center justify-center text-gray-300 text-sm border-r border-gray-200">fx</span>
        <input
          ref={barRef}
          value={editing ? editing.draft : String(activeRaw)}
          readOnly={readOnly}
          onChange={e => setEditing({ r: sel.r, c: sel.c, draft: e.target.value })}
          onFocus={() => !readOnly && !editing && setEditing({ r: sel.r, c: sel.c, draft: String(activeRaw) })}
          onKeyDown={e => {
            if (onEditKeyDown(e)) return
            if (e.key === 'Enter')  { e.preventDefault(); commitEdit('down') }
            if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
          }}
          placeholder="Nhập giá trị hoặc công thức, ví dụ =SUM(A1:A10)"
          className="flex-1 min-w-0 px-3 py-1.5 text-sm bg-transparent outline-none placeholder:text-gray-300 font-mono"
        />
      </div>

      {/* Lưới */}
      <div
        ref={scrollRef}
        tabIndex={0}
        onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        className="flex-1 min-h-0 overflow-auto outline-none select-none"
      >
        <div style={{ width: totalWidth + ROW_LABEL_W, minWidth: '100%' }}>

          {/* Đầu cột — dính trên khi cuộn dọc */}
          <div className="sticky top-0 z-20 flex bg-gray-100 border-b border-gray-300"
            style={{ height: HEADER_H }}>
            <div className="sticky left-0 z-10 shrink-0 bg-gray-200 border-r border-gray-300"
              style={{ width: ROW_LABEL_W }} />
            {Array.from({ length: sheet.cols }).map((_, c) => (
              <div key={c}
                onClick={() => setSel({ r: 0, c, r2: sheet.rows - 1, c2: c })}
                className={`relative shrink-0 flex items-center justify-center text-xs font-semibold
                  border-r border-gray-300 cursor-pointer
                  ${c >= bounds.c1 && c <= bounds.c2 ? 'bg-blue-100 text-blue-700' : 'text-gray-500'}`}
                style={{ width: widthOf(c) }}>
                {colToLetter(c)}
                {/* Tay nắm kéo giãn — rộng 5px cho dễ trúng chuột */}
                <span
                  onMouseDown={e => startResize(e, c)}
                  className="absolute right-0 top-0 h-full w-[5px] cursor-col-resize hover:bg-blue-400" />
              </div>
            ))}
          </div>

          {/* Thân — dùng padding thay vì vẽ hết, giữ đúng chiều cao thanh cuộn */}
          <div style={{ height: sheet.rows * ROW_H, position: 'relative' }}>
            {rows.map(r => (
              <div key={r} className="absolute left-0 flex"
                style={{ top: r * ROW_H, height: ROW_H }}>

                {/* Số dòng — dính trái khi cuộn ngang */}
                <div
                  onClick={() => setSel({ r, c: 0, r2: r, c2: sheet.cols - 1 })}
                  className={`sticky left-0 z-10 shrink-0 flex items-center justify-center text-xs
                    border-r border-b border-gray-300 cursor-pointer tabular-nums
                    ${r >= bounds.r1 && r <= bounds.r2 ? 'bg-blue-100 text-blue-700 font-semibold' : 'bg-gray-100 text-gray-400'}`}
                  style={{ width: ROW_LABEL_W }}>
                  {r + 1}
                </div>

                {Array.from({ length: sheet.cols }).map((_, c) => {
                  const isActive = sel.r === r && sel.c === c
                  const isEditing = editing?.r === r && editing?.c === c
                  const st = styleAt(r, c) || {}
                  const value = engine.value(r, c)
                  const text = formatValue(value, st.numFmt)
                  const err = isError(value)

                  return (
                    <div key={c}
                      onMouseDown={e => onCellMouseDown(e, r, c)}
                      onMouseEnter={() => onCellMouseEnter(r, c)}
                      onDoubleClick={() => beginEdit(r, c)}
                      className={`relative shrink-0 border-r border-b border-gray-200 overflow-hidden
                        ${inSelection(r, c) && !isActive ? 'bg-blue-50/70' : ''}
                        ${isActive ? 'ring-2 ring-blue-500 ring-inset z-10' : ''}`}
                      style={{
                        width: widthOf(c),
                        height: ROW_H,
                        background: isActive ? '#fff' : (st.bg || undefined),
                      }}>

                      {isEditing ? (
                        <input
                          ref={editRef}
                          value={editing.draft}
                          onChange={e => setEditing({ ...editing, draft: e.target.value })}
                          onKeyDown={e => {
                            // Chặn nổi bọt lên lưới: lưới cũng bắt Enter/Tab và
                            // sẽ chốt ô lần thứ hai, làm con trỏ nhảy hai bước
                            e.stopPropagation()
                            if (onEditKeyDown(e)) return
                            if (e.key === 'Enter')  { e.preventDefault(); commitEdit('down') }
                            if (e.key === 'Tab')    { e.preventDefault(); commitEdit('right') }
                            if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
                          }}
                          // Đang chỉ ô thì blur là do bấm lên lưới, không phải
                          // do người dùng bỏ đi — chốt lúc này sẽ cắt ngang công thức
                          onBlur={() => { if (!pointRef.current) commitEdit(null) }}
                          className="absolute inset-0 w-full h-full px-1.5 text-sm outline-none
                            bg-white font-mono z-20"
                        />
                      ) : (
                        <div
                          className={`w-full h-full px-1.5 flex items-center text-sm whitespace-nowrap
                            ${err ? 'text-red-600 font-semibold' : ''}`}
                          style={{
                            fontWeight: st.bold ? 700 : undefined,
                            fontStyle: st.italic ? 'italic' : undefined,
                            textDecoration: st.underline ? 'underline' : undefined,
                            color: err ? undefined : st.color,
                            fontSize: st.fontSize ? `${st.fontSize}px` : undefined,
                            justifyContent:
                              st.align === 'center' ? 'center'
                              : st.align === 'right' ? 'flex-end'
                              : typeof value === 'number' ? 'flex-end' : 'flex-start',
                          }}>
                          {text}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Thanh trạng thái */}
      <div className="shrink-0 flex items-center gap-4 px-3 py-1.5 border-t border-gray-200
        bg-gray-50 text-xs text-gray-500 tabular-nums overflow-x-auto">
        <span className="shrink-0">
          {selectedCount > 1 ? `${selectedCount} ô đã chọn` : addressOf(sel.r, sel.c)}
        </span>
        {isFormula && (
          <span className="shrink-0 text-blue-600 font-medium">
            Đang nhập công thức — bấm hoặc kéo trên lưới để chọn ô
          </span>
        )}
        {quickStats && (
          <>
            <span className="shrink-0">Tổng: <b className="text-gray-700">{fmtNum(quickStats.sum)}</b></span>
            <span className="shrink-0">TB: <b className="text-gray-700">{fmtNum(quickStats.avg)}</b></span>
            <span className="shrink-0">Đếm số: <b className="text-gray-700">{quickStats.count}</b></span>
          </>
        )}
        {readOnly && <span className="ml-auto shrink-0 text-gray-400">Chỉ xem</span>}
      </div>
    </div>
  )
}

/* ── Thành phần nhỏ ──────────────────────────────────────────────── */

function FmtBtn({ active, onClick, title, children }) {
  return (
    <button onClick={onClick} title={title}
      className={`w-8 h-8 shrink-0 rounded-lg text-sm flex items-center justify-center transition-colors
        ${active ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}>
      {children}
    </button>
  )
}

const Divider = () => <span className="w-px h-5 bg-gray-200 mx-1 shrink-0" />

const fmtNum = n =>
  Math.abs(n) >= 1000
    ? n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })
    : String(Math.round(n * 100) / 100)
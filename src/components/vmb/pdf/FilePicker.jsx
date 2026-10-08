import { useRef, useState } from 'react'

/**
 * FilePicker — khung drop-zone kiêm placeholder, dùng chung cho 3 tab
 * con trong Pdf: Sửa PDF / Scan ảnh / Sửa ảnh.
 *
 * ── Chức năng ──────────────────────────────────────────────
 *   1. Click vào khung → mở file dialog.
 *   2. Drag file vào → đổi style (viền + nền + icon) báo "đang detect".
 *   3. Drop file → gọi onPick(File).
 *
 * ── Thiết kế ───────────────────────────────────────────────
 *   fill parent với h-full → component cha chỉ cần cho khung này nằm
 *   trong 1 vùng flex-1 là tự giãn hết viewport. Đồng nhất kích thước
 *   giữa 3 tab PDF.
 *
 * ── Props ──────────────────────────────────────────────────
 *   icon        — emoji hoặc React node ở giữa khung
 *   title       — dòng chữ to đậm
 *   description — mô tả 1-2 câu
 *   accept      — chuỗi `accept` của <input type="file">
 *   onPick      — callback(File)
 *   dropLabel   — chữ to khi đang kéo file vào (default "Thả file vào đây")
 */
export default function FilePicker({
  icon = '📄',
  title,
  description,
  accept = '',
  onPick,
  dropLabel = 'Thả file vào đây',
  className = '',
}) {
  const [dragOver, setDragOver] = useState(false)
  const [dragInvalid, setDragInvalid] = useState(false)
  const ref = useRef(null)
  const dragDepth = useRef(0)   // tracking enter/leave để tránh flicker

  const openDialog = () => ref.current?.click()

  const onInput = (e) => {
    const f = e.target.files?.[0]
    if (f) onPick?.(f)
    e.target.value = ''   // cho phép pick lại cùng file
  }

  // Kiểm tra loại file hợp lệ theo accept
  const isAccepted = (file) => {
    if (!accept) return true
    const list = accept.split(',').map(s => s.trim().toLowerCase())
    const name = (file.name || '').toLowerCase()
    const type = (file.type || '').toLowerCase()
    return list.some(a => {
      if (!a) return true
      if (a.startsWith('.'))      return name.endsWith(a)
      if (a.endsWith('/*'))       return type.startsWith(a.slice(0, -1))
      return type === a
    })
  }

  const onDragEnter = (e) => {
    e.preventDefault()
    dragDepth.current += 1
    const items = e.dataTransfer?.items
    const invalid = items && items.length > 0 && items[0].kind === 'file'
      ? !isAcceptedByItem(items[0], accept)
      : false
    setDragInvalid(invalid)
    setDragOver(true)
  }
  const onDragOver = (e) => { e.preventDefault() }
  const onDragLeave = (e) => {
    e.preventDefault()
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setDragOver(false); setDragInvalid(false)
    }
  }
  const onDrop = (e) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragOver(false); setDragInvalid(false)
    const f = e.dataTransfer?.files?.[0]
    if (!f) return
    if (!isAccepted(f)) return
    onPick?.(f)
  }

  const bg = dragInvalid
    ? 'border-rose-400 bg-rose-50/70 text-rose-700'
    : dragOver
      ? 'border-blue-500 bg-blue-50/80 text-blue-700 shadow-lg'
      : 'border-gray-300 bg-gray-50/60 text-gray-500 hover:border-blue-400 hover:bg-blue-50/40 hover:text-blue-600'

  return (
    <>
      <input ref={ref} type="file" accept={accept} hidden onChange={onInput} />
      <div
        role="button" tabIndex={0}
        onClick={openDialog}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDialog() } }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        className={`relative w-full h-full cursor-pointer rounded-xl border-2 border-dashed
          flex flex-col items-center justify-center text-center p-6 transition-all
          select-none ${bg} ${className}`}
        style={{ minHeight: 240 }}
      >
        <div className="text-6xl mb-3 transition-transform"
          style={{ transform: dragOver ? 'scale(1.15)' : 'none' }}>
          {dragInvalid ? '🚫' : (dragOver ? '📥' : icon)}
        </div>
        <div className="text-base font-semibold mb-1">
          {dragInvalid ? 'File không hợp lệ' : (dragOver ? dropLabel : title)}
        </div>
        <div className="text-xs max-w-md opacity-80 leading-relaxed whitespace-pre-line">
          {dragInvalid
            ? `Chỉ nhận: ${accept || 'bất kỳ'}`
            : description}
        </div>
        {!dragOver && (
          <div className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-600">
            <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="currentColor">
              <path d="M10 2a1 1 0 0 1 1 1v8.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L9 11.586V3a1 1 0 0 1 1-1z"/>
            </svg>
            Click vùng này hoặc kéo thả file vào
          </div>
        )}
      </div>
    </>
  )
}

// DataTransferItem.type là MIME, name không có → chỉ check được bằng type.
function isAcceptedByItem(item, accept) {
  if (!accept) return true
  const list = accept.split(',').map(s => s.trim().toLowerCase())
  const type = (item.type || '').toLowerCase()
  return list.some(a => {
    if (!a) return true
    if (a.startsWith('.')) return true   // không biết tên file từ item, để qua
    if (a.endsWith('/*'))  return type.startsWith(a.slice(0, -1))
    return type === a
  })
}
import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { getPdfjs } from './pdfjsLoader'
import useContainerSize from './useContainerSize'
import ZoomBar from './ZoomBar'

/**
 * PdfEditor — upload PDF → sửa (whiteout vùng + xoá trang) → lưu file mới.
 *
 * ── Luồng ──────────────────────────────────────────────────
 *   1. User chọn file PDF. Giữ ArrayBuffer gốc để pass sang pdf-lib khi save.
 *   2. pdfjs-dist render từng trang ra <canvas> ở độ phân giải vừa đủ cho
 *      màn hình (scale 1.5).
 *   3. Mỗi canvas được bọc 1 overlay <div> absolute cùng kích thước. User
 *      click-drag trên overlay để tạo "hộp trắng" (white rect). Click vào
 *      hộp đã vẽ để xoá.
 *   4. Mỗi trang có nút "Xoá trang" toggle. Trang bị xoá sẽ bị bỏ qua khi
 *      save.
 *   5. Save: dùng pdf-lib
 *      - load lại từ ArrayBuffer gốc
 *      - với mỗi trang không xoá: vẽ rect màu trắng ở toạ độ user đã chọn
 *        (convert từ CSS px → PDF point theo scale)
 *      - với mỗi trang bị xoá: removePage(index) (đi ngược từ cuối tránh
 *        shift index)
 *      - trả về Uint8Array → tạo Blob và trigger download.
 *
 * Toạ độ:
 *   - Canvas pdfjs: Y chạy TOP → BOTTOM
 *   - PDF point: Y chạy BOTTOM → TOP (origin bottom-left)
 *   → khi vẽ rect PDF cần đổi Y: pdfY = pageHeight - overlayY - rectH
 */
export default function PdfEditor() {
  const [fileBuf, setFileBuf] = useState(null)         // ArrayBuffer gốc
  const [fileName, setFileName] = useState('')
  const [pages, setPages] = useState([])               // [{ index, viewport, canvasEl, deleted, rects: [{x,y,w,h}] }]
  const [busy, setBusy] = useState(false)
  const [renderedCount, setRenderedCount] = useState(0)
  const [saving, setSaving] = useState(false)
  // zoom = 1 → fit page (mỗi trang fit WIDTH viewport, giữ aspect). > 1 phóng
  // to, viewport scroll. Nhiều trang stack dọc → fit page có nghĩa fit chiều
  // ngang viewport cho mỗi trang.
  const [zoom, setZoom] = useState(1)

  const fileInputRef = useRef(null)
  // callback-ref API — xem useContainerSize.js
  const [vpRef, vp] = useContainerSize()

  // Chiều rộng render của mỗi trang (fit page = fit WIDTH viewport, trừ chút
  // padding). Zoom > 1 → nhân thẳng.
  const pageRenderW = useMemo(() => {
    if (!vp.w) return 0
    // Trừ 32px cho padding + scrollbar reserve
    return Math.max(100, (vp.w - 32) * zoom)
  }, [vp.w, zoom])

  const openFile = (f) => {
    if (!f) return
    if (!f.type.includes('pdf') && !f.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Chỉ nhận file PDF')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setFileBuf(reader.result)
      setFileName(f.name)
      setPages([])
      setRenderedCount(0)
    }
    reader.onerror = () => toast.error('Không đọc được file')
    reader.readAsArrayBuffer(f)
  }

  // Render tất cả trang khi fileBuf thay đổi
  useEffect(() => {
    if (!fileBuf) return
    let cancelled = false
    ;(async () => {
      setBusy(true)
      try {
        const pdfjs = await getPdfjs()
        // Clone buffer vì pdfjs sẽ transfer / neuter nó
        const doc = await pdfjs.getDocument({ data: fileBuf.slice(0) }).promise
        const next = []
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return
          const page = await doc.getPage(i)
          const viewport = page.getViewport({ scale: 1.5 })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          const ctx = canvas.getContext('2d')
          await page.render({ canvasContext: ctx, viewport }).promise
          next.push({
            index: i - 1,
            width: viewport.width,
            height: viewport.height,
            pageWidthPt: page.view[2] - page.view[0],   // PDF point W
            pageHeightPt: page.view[3] - page.view[1],  // PDF point H
            canvasDataUrl: canvas.toDataURL('image/png'),
            deleted: false,
            rects: [],
          })
          setRenderedCount(i)
        }
        if (!cancelled) setPages(next)
      } catch (e) {
        console.error(e)
        toast.error('Không mở được PDF: ' + (e?.message || e))
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => { cancelled = true }
  }, [fileBuf])

  const toggleDelete = (idx) => {
    setPages(ps => ps.map(p => p.index === idx ? { ...p, deleted: !p.deleted } : p))
  }

  const addRect = (idx, rect) => {
    setPages(ps => ps.map(p => p.index === idx ? { ...p, rects: [...p.rects, rect] } : p))
  }

  const removeRect = (idx, rectIdx) => {
    setPages(ps => ps.map(p => p.index === idx
      ? { ...p, rects: p.rects.filter((_, i) => i !== rectIdx) }
      : p))
  }

  const save = async () => {
    if (!fileBuf) return
    const kept = pages.filter(p => !p.deleted)
    if (kept.length === 0) {
      toast.error('Phải giữ lại ít nhất 1 trang')
      return
    }
    setSaving(true)
    try {
      const { PDFDocument, rgb } = await import('pdf-lib')
      const doc = await PDFDocument.load(fileBuf.slice(0))

      // Vẽ hộp trắng trên các trang GIỮ LẠI (dùng index gốc)
      for (const p of pages) {
        if (p.deleted) continue
        if (!p.rects || p.rects.length === 0) continue
        const page = doc.getPage(p.index)
        const { width: pw, height: ph } = page.getSize()
        const sx = pw / p.width
        const sy = ph / p.height
        for (const r of p.rects) {
          const x = r.x * sx
          const w = r.w * sx
          const h = r.h * sy
          // Đổi Y: trong overlay Y chạy từ top xuống, PDF chạy từ bottom lên
          const y = ph - (r.y * sy) - h
          page.drawRectangle({
            x, y, width: w, height: h,
            color: rgb(1, 1, 1),
            borderWidth: 0,
          })
        }
      }

      // Xoá trang — đi NGƯỢC từ cuối để index không shift
      const toRemove = pages.filter(p => p.deleted).map(p => p.index).sort((a, b) => b - a)
      for (const idx of toRemove) doc.removePage(idx)

      const bytes = await doc.save()
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = suggestOutputName(fileName)
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success('Đã lưu PDF')
    } catch (e) {
      console.error(e)
      toast.error('Lưu PDF thất bại: ' + (e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setFileBuf(null)
    setFileName('')
    setPages([])
    setRenderedCount(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="bg-white rounded-2xl shadow border border-gray-100 p-3 sm:p-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-gray-100">
        <input ref={fileInputRef} type="file" accept="application/pdf,.pdf"
          hidden onChange={e => openFile(e.target.files?.[0])} />
        <button type="button" onClick={() => fileInputRef.current?.click()}
          className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700">
          📂 Chọn PDF…
        </button>
        {fileName && (
          <span className="text-xs text-gray-600 truncate max-w-[260px]" title={fileName}>
            📄 {fileName}
          </span>
        )}
        <div className="flex-1" />
        {pages.length > 0 && (
          <>
            <span className="text-[11px] text-gray-500">
              Giữ lại {pages.filter(p => !p.deleted).length}/{pages.length} trang
            </span>
            <ZoomBar zoom={zoom} onZoom={setZoom} />
            <button type="button" onClick={reset}
              className="px-3 py-1.5 text-sm font-semibold rounded-lg text-gray-600 hover:bg-gray-100">
              Huỷ
            </button>
            <button type="button" onClick={save} disabled={saving}
              className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-emerald-600 text-white
                hover:bg-emerald-700 disabled:opacity-50">
              {saving ? 'Đang lưu…' : '💾 Lưu PDF'}
            </button>
          </>
        )}
      </div>

      {/* Viewport chính: cố định chiều cao = 100dvh - header-tabs-toolbar,
          scroll dọc. Mỗi trang được render ở width = (viewportW - 32) * zoom
          → zoom 1 đúng là fit page. */}
      <div ref={vpRef}
        className="relative bg-slate-50 rounded-lg border border-gray-200 overflow-auto"
        style={{ height: 'calc(100dvh - 230px)', minHeight: 300 }}>
        {!fileBuf && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 text-sm px-4 text-center">
            <div className="text-4xl mb-2">📄</div>
            <div>Chọn 1 file PDF để bắt đầu chỉnh sửa.</div>
            <div className="mt-1 text-[11px]">Có thể vẽ hộp trắng che thông tin + xoá bớt trang. Mọi xử lý local.</div>
          </div>
        )}

        {fileBuf && pages.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
            Đang render trang… ({renderedCount})
          </div>
        )}

        {pages.length > 0 && (
          <div className="p-4 space-y-4 flex flex-col items-center">
            {pages.map(p => (
              <PageEditor key={p.index} page={p} renderWidth={pageRenderW}
                onToggleDelete={() => toggleDelete(p.index)}
                onAddRect={(r) => addRect(p.index, r)}
                onRemoveRect={(ri) => removeRect(p.index, ri)}
              />
            ))}
          </div>
        )}

        {busy && pages.length > 0 && (
          <div className="text-center text-xs text-gray-400 mt-2">Đang render…</div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  PageEditor — 1 trang: thumbnail + overlay vẽ hộp
// ═══════════════════════════════════════════════════════════════

function PageEditor({ page, renderWidth, onToggleDelete, onAddRect, onRemoveRect }) {
  const [drag, setDrag] = useState(null)  // { x0, y0, x1, y1 } đang vẽ
  const wrapRef = useRef(null)

  const relCoords = (e) => {
    const rect = wrapRef.current.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    // Tính theo coords CSS px của chính overlay (bằng với kích thước render canvas đã scale theo max-width)
    // Để map đúng về PDF point, ta normalize ratio theo canvas natural (page.width/height),
    // vì CSS size có thể bị fit-container.
    const ratioX = page.width / rect.width
    const ratioY = page.height / rect.height
    return {
      x: (clientX - rect.left) * ratioX,
      y: (clientY - rect.top) * ratioY,
    }
  }

  const onPointerDown = (e) => {
    if (page.deleted) return
    // Ignore if clicking on an existing rect (handled by rect's own click)
    if (e.target.dataset.rectIdx !== undefined) return
    e.preventDefault()
    const { x, y } = relCoords(e)
    setDrag({ x0: x, y0: y, x1: x, y1: y })
  }
  const onPointerMove = (e) => {
    if (!drag) return
    e.preventDefault()
    const { x, y } = relCoords(e)
    setDrag(d => ({ ...d, x1: x, y1: y }))
  }
  const onPointerUp = () => {
    if (!drag) return
    const x = Math.min(drag.x0, drag.x1)
    const y = Math.min(drag.y0, drag.y1)
    const w = Math.abs(drag.x1 - drag.x0)
    const h = Math.abs(drag.y1 - drag.y0)
    if (w > 4 && h > 4) onAddRect({ x, y, w, h })
    setDrag(null)
  }

  // Preview hộp đang vẽ
  const previewRect = drag && {
    x: Math.min(drag.x0, drag.x1),
    y: Math.min(drag.y0, drag.y1),
    w: Math.abs(drag.x1 - drag.x0),
    h: Math.abs(drag.y1 - drag.y0),
  }

  // Chiều cao thực tế = width × tỷ lệ gốc (giữ aspect page)
  const renderHeight = renderWidth && page.width
    ? Math.round(renderWidth * (page.height / page.width))
    : 0

  return (
    <div className={`rounded-xl border ${page.deleted ? 'border-rose-300 bg-rose-50' : 'border-gray-200 bg-white'} p-2`}
      style={{ width: renderWidth || 'auto' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold text-gray-700">Trang {page.index + 1}</span>
        {page.deleted && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-rose-600 text-white">
            SẼ BỊ XOÁ
          </span>
        )}
        {page.rects.length > 0 && !page.deleted && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-blue-100 text-blue-700">
            {page.rects.length} hộp trắng
          </span>
        )}
        <div className="flex-1" />
        <button type="button" onClick={onToggleDelete}
          className={`text-xs px-2.5 py-1 rounded-md font-semibold
            ${page.deleted
              ? 'bg-white border border-rose-300 text-rose-700 hover:bg-rose-100'
              : 'bg-white border border-gray-300 text-gray-700 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300'}`}>
          {page.deleted ? '↩ Giữ lại' : '🗑 Xoá trang này'}
        </button>
      </div>

      <div className="flex justify-center">
        <div ref={wrapRef}
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onMouseLeave={() => drag && onPointerUp()}
          onTouchStart={onPointerDown}
          onTouchMove={onPointerMove}
          onTouchEnd={onPointerUp}
          style={{
            position: 'relative',
            width: renderWidth || page.width,
            height: renderHeight || 'auto',
            cursor: page.deleted ? 'not-allowed' : 'crosshair',
            userSelect: 'none',
            touchAction: 'none',
          }}>
          <img src={page.canvasDataUrl} alt=""
            style={{
              display: 'block', width: '100%', height: '100%',
              filter: page.deleted ? 'grayscale(0.8) opacity(0.5)' : 'none',
              border: '1px solid #e5e7eb',
            }} draggable={false} />

          {/* rects đã vẽ */}
          {page.rects.map((r, i) => (
            <div key={i} data-rect-idx={i}
              onClick={(e) => { e.stopPropagation(); onRemoveRect(i) }}
              title="Click để xoá hộp này"
              style={{
                position: 'absolute',
                left:   `${(r.x / page.width) * 100}%`,
                top:    `${(r.y / page.height) * 100}%`,
                width:  `${(r.w / page.width) * 100}%`,
                height: `${(r.h / page.height) * 100}%`,
                background: 'white',
                border: '1.5px dashed #2563EB',
                cursor: 'pointer',
                boxSizing: 'border-box',
              }}
            />
          ))}

          {/* rect đang vẽ (preview) */}
          {previewRect && (
            <div style={{
              position: 'absolute',
              left:   `${(previewRect.x / page.width) * 100}%`,
              top:    `${(previewRect.y / page.height) * 100}%`,
              width:  `${(previewRect.w / page.width) * 100}%`,
              height: `${(previewRect.h / page.height) * 100}%`,
              background: 'rgba(255,255,255,0.9)',
              border: '1.5px dashed #10B981',
              pointerEvents: 'none',
              boxSizing: 'border-box',
            }} />
          )}
        </div>
      </div>
      {!page.deleted && (
        <div className="text-[10px] text-gray-500 text-center mt-1">
          Kéo chuột để vẽ hộp trắng che thông tin · click hộp để xoá
        </div>
      )}
    </div>
  )
}

function suggestOutputName(name) {
  if (!name) return 'edited.pdf'
  return name.replace(/\.pdf$/i, '') + '_edited.pdf'
}
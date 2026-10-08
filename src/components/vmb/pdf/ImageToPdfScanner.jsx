import { useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { warpPerspective, removeShadow } from './imageProcess'
import useContainerSize, { fitBox } from './useContainerSize'
import ZoomBar from './ZoomBar'

/**
 * ImageToPdfScanner — upload ảnh văn bản chụp nghiêng, có bóng → PDF A4 đẹp.
 *
 * ── UX ─────────────────────────────────────────────────────
 *   1. User chọn ảnh. Ảnh hiển thị ở panel trái.
 *   2. 4 chấm tròn (handles) có thể kéo bằng chuột / cảm ứng. Mặc định đặt
 *      cách mép 10% — user kéo khớp 4 mép giấy.
 *   3. Nút "Xem trước": warp phối cảnh + xoá bóng, hiển thị panel phải.
 *   4. "Lưu PDF": xuất file PDF 1 trang A4-ratio với ảnh đã xử lý.
 *
 * ── Kỹ thuật ────────────────────────────────────────────────
 *   - Perspective: 4 góc nguồn → hình chữ nhật đích (tính kích thước theo
 *     tỷ lệ trung bình chiều dài 2 cặp cạnh đối, có cap theo A4 1:√2).
 *   - Shadow removal: xem imageProcess.js — "divide by blur" sau khi warp,
 *     để đồng đều hoá nền sáng rồi normalize sang trắng.
 */
export default function ImageToPdfScanner() {
  const [imgEl, setImgEl] = useState(null)       // HTMLImageElement đã load
  const [imgData, setImgData] = useState(null)   // ImageData đọc 1 lần
  const [fileName, setFileName] = useState('')
  const [corners, setCorners] = useState(null)   // [{x,y}] theo px gốc ảnh
  const [preview, setPreview] = useState(null)   // dataUrl output
  const [busy, setBusy] = useState(false)
  const [options, setOptions] = useState({ shadowStrength: 1, flatten: 0.6 })

  // ── 2026-10-08: magnetic + zoom ────────────────────────
  // magnetic = khung 4 góc luôn là HÌNH CHỮ NHẬT (axis-aligned). Khi kéo
  //            1 góc, góc đối diện (diagonal) giữ nguyên; 2 góc kề điều
  //            chỉnh theo để hình vẫn vuông. Tránh warp làm méo tài liệu
  //            khi mép chụp cũng vốn thẳng.
  // zoom    = 1 → fit page (ảnh vừa khít viewport box). > 1 phóng to,
  //            viewport scroll. < 1 thu nhỏ.
  const [magnetic, setMagnetic] = useState(false)
  // 2026-10-08 chiều: góc xoay (độ) khi magnetic ON. Cho phép align rect
  // với mép văn bản bị nghiêng do góc chụp — nếu rect axis-aligned thì
  // phải crop lố để bao hết → mất chữ hoặc warp xấu.
  const [magneticAngle, setMagneticAngle] = useState(0)
  const [zoomSrc, setZoomSrc]   = useState(1)
  const [zoomDst, setZoomDst]   = useState(1)

  const fileInputRef = useRef(null)
  const stageRef = useRef(null)
  const dragging = useRef(null)  // index handle đang kéo

  // Viewport ref + size cho 2 panel — callback-ref API để size cập nhật
  // được ngay cả khi div viewport được mount có điều kiện (sau khi chọn ảnh).
  const [vpSrcRef, vpSrc] = useContainerSize()
  const [vpDstRef, vpDst] = useContainerSize()

  // Fit size × zoom
  const srcFit = useMemo(
    () => imgEl ? fitBox(imgEl.naturalWidth, imgEl.naturalHeight, vpSrc.w, vpSrc.h) : null,
    [imgEl, vpSrc.w, vpSrc.h]
  )
  const srcRender = srcFit ? { w: srcFit.w * zoomSrc, h: srcFit.h * zoomSrc } : null
  const dstFit = useMemo(
    () => preview ? fitBox(preview.w, preview.h, vpDst.w, vpDst.h) : null,
    [preview, vpDst.w, vpDst.h]
  )
  const dstRender = dstFit ? { w: dstFit.w * zoomDst, h: dstFit.h * zoomDst } : null

  const onPick = (f) => {
    if (!f) return
    if (!f.type.startsWith('image/')) {
      toast.error('Chỉ nhận ảnh')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        // Đọc ImageData 1 lần qua offscreen canvas
        const c = document.createElement('canvas')
        c.width = img.naturalWidth; c.height = img.naturalHeight
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0)
        setImgData(ctx.getImageData(0, 0, c.width, c.height))
        setImgEl(img)
        setFileName(f.name)
        // Khởi tạo 4 góc cách mép 8%
        const w = img.naturalWidth, h = img.naturalHeight
        setCorners([
          { x: w * 0.08, y: h * 0.08 },
          { x: w * 0.92, y: h * 0.08 },
          { x: w * 0.92, y: h * 0.92 },
          { x: w * 0.08, y: h * 0.92 },
        ])
        setPreview(null)
      }
      img.onerror = () => toast.error('Không mở được ảnh')
      img.src = reader.result
    }
    reader.onerror = () => toast.error('Không đọc được file')
    reader.readAsDataURL(f)
  }

  // ── Drag handles ─────────────────────────────────────────
  const stageToImg = (e) => {
    const rect = stageRef.current.getBoundingClientRect()
    const cx = e.touches ? e.touches[0].clientX : e.clientX
    const cy = e.touches ? e.touches[0].clientY : e.clientY
    const ratioX = imgEl.naturalWidth / rect.width
    const ratioY = imgEl.naturalHeight / rect.height
    return { x: (cx - rect.left) * ratioX, y: (cy - rect.top) * ratioY }
  }
  const onHandleDown = (i) => (e) => { e.preventDefault(); e.stopPropagation(); dragging.current = i }
  const onStageMove = (e) => {
    if (dragging.current == null || !imgEl) return
    const { x, y } = stageToImg(e)
    const w = imgEl.naturalWidth, h = imgEl.naturalHeight
    const clamped = { x: Math.max(0, Math.min(w - 1, x)), y: Math.max(0, Math.min(h - 1, y)) }
    const i = dragging.current

    if (!magnetic) {
      // Chế độ tự do — chỉ cập nhật 1 góc đang kéo
      setCorners(cs => cs.map((c, idx) => idx === i ? clamped : c))
      return
    }

    // Chế độ magnetic — giữ 4 góc là HÌNH CHỮ NHẬT (có thể xoay theo
    // magneticAngle). Diagonal (i+2) % 4 đứng yên, dragged = clamped, 2
    // góc kề tính qua trục rect:
    //   trục u = (cos a, sin a) hướng TL→TR
    //   trục v = (-sin a, cos a) hướng TL→BL
    //   vec d = clamped − opp
    //   u = d·uhat,  v = d·vhat (signed)
    //   adj1(index 3−i) = opp + u·uhat   (cùng cạnh u-direction với opp)
    //   adj2(index i^1) = opp + v·vhat   (cùng cạnh v-direction với opp)
    // Khi a = 0 trùng với logic axis-aligned trước đây.
    setCorners(cs => {
      const idxOpp  = (i + 2) % 4
      const idxAdj1 = 3 - i          // (0→3, 1→2, 2→1, 3→0)
      const idxAdj2 = i ^ 1          // (0→1, 1→0, 2→3, 3→2)
      const opp = cs[idxOpp]
      const a   = magneticAngle * Math.PI / 180
      const ux  = Math.cos(a), uy = Math.sin(a)
      const vx  = -uy,         vy = ux
      const dx  = clamped.x - opp.x
      const dy  = clamped.y - opp.y
      const u   = dx * ux + dy * uy
      const v   = dx * vx + dy * vy
      const newCs = cs.slice()
      newCs[idxOpp]  = opp
      newCs[i]       = clamped
      newCs[idxAdj1] = { x: opp.x + u * ux, y: opp.y + u * uy }
      newCs[idxAdj2] = { x: opp.x + v * vx, y: opp.y + v * vy }
      return newCs
    })
  }

  // Khi bật magnetic lần đầu, snap tứ giác hiện tại về hình chữ nhật
  // AXIS-ALIGNED bao ngoài (bounding box) + reset angle về 0 để không
  // bị nhảy khi vừa toggle. User có thể xoay sau bằng rotation controls.
  const toggleMagnetic = () => {
    setMagnetic(m => {
      const next = !m
      if (next && corners) {
        const xs = corners.map(c => c.x), ys = corners.map(c => c.y)
        const x1 = Math.min(...xs), x2 = Math.max(...xs)
        const y1 = Math.min(...ys), y2 = Math.max(...ys)
        setCorners([
          { x: x1, y: y1 }, { x: x2, y: y1 },
          { x: x2, y: y2 }, { x: x1, y: y2 },
        ])
        setMagneticAngle(0)
      }
      return next
    })
  }

  // Xoay rect quanh centroid của 4 góc hiện tại. Dùng cho các nút ↶/↷.
  // Chỉ hoạt động khi magnetic ON. deltaDeg có thể âm.
  const rotateRect = (deltaDeg) => {
    if (!magnetic || !corners) return
    const cx = corners.reduce((s, c) => s + c.x, 0) / 4
    const cy = corners.reduce((s, c) => s + c.y, 0) / 4
    const d = deltaDeg * Math.PI / 180
    const cos = Math.cos(d), sin = Math.sin(d)
    setCorners(cs => cs.map(c => ({
      x: cx + (c.x - cx) * cos - (c.y - cy) * sin,
      y: cy + (c.x - cx) * sin + (c.y - cy) * cos,
    })))
    setMagneticAngle(a => normalizeAngle(a + deltaDeg))
  }

  // Reset về 0° — xoay ngược magneticAngle hiện tại.
  const resetRotation = () => {
    if (!magnetic || magneticAngle === 0) return
    rotateRect(-magneticAngle)
  }
  const onStageUp = () => { dragging.current = null }

  // ── Preview / Process ───────────────────────────────────
  const process = async () => {
    if (!imgData || !corners) return
    setBusy(true)
    try {
      // Chạy trong setTimeout để UI kịp render spinner
      await new Promise(r => setTimeout(r, 10))
      // 1) Tính kích thước output: chọn w,h sao cho giữ tỉ lệ trung bình
      //    của quad. Cap chiều dài > về A4 (1 : √2) nếu lệch quá xa.
      const [TL, TR, BR, BL] = corners
      const topW = dist(TL, TR)
      const botW = dist(BL, BR)
      const leftH = dist(TL, BL)
      const rightH = dist(TR, BR)
      let outW = Math.round((topW + botW) / 2)
      let outH = Math.round((leftH + rightH) / 2)
      // Giới hạn tổng pixel để tránh hang trình duyệt
      const MAX = 2000
      if (outW > MAX || outH > MAX) {
        const s = MAX / Math.max(outW, outH)
        outW = Math.round(outW * s); outH = Math.round(outH * s)
      }
      outW = Math.max(300, outW); outH = Math.max(300, outH)

      // 2) Warp
      const warped = warpPerspective(imgData, [TL, TR, BR, BL], outW, outH)

      // 3) Shadow removal + làm phẳng nhăn
      const noShadow = removeShadow(warped, {
        strength: options.shadowStrength,
        flatten: options.flatten,
      })

      // 4) Render ra canvas → dataURL
      const c = document.createElement('canvas')
      c.width = outW; c.height = outH
      c.getContext('2d').putImageData(noShadow, 0, 0)
      setPreview({ dataUrl: c.toDataURL('image/jpeg', 0.92), w: outW, h: outH })
    } catch (e) {
      console.error(e)
      toast.error('Xử lý ảnh lỗi: ' + (e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const savePdf = async () => {
    if (!preview) return
    setBusy(true)
    try {
      const { PDFDocument } = await import('pdf-lib')
      const doc = await PDFDocument.create()
      // A4: 595 × 842 pt. Fit ảnh vào trang, giữ tỉ lệ, giữa trang.
      const A4W = 595, A4H = 842
      // Xoay trang nếu ảnh ngang
      const landscape = preview.w > preview.h
      const pageW = landscape ? A4H : A4W
      const pageH = landscape ? A4W : A4H

      // Lấy bytes jpeg
      const jpegBytes = dataUrlToBytes(preview.dataUrl)
      const image = await doc.embedJpg(jpegBytes)
      const scale = Math.min(pageW / preview.w, pageH / preview.h)
      const drawW = preview.w * scale
      const drawH = preview.h * scale
      const page = doc.addPage([pageW, pageH])
      page.drawImage(image, {
        x: (pageW - drawW) / 2,
        y: (pageH - drawH) / 2,
        width: drawW, height: drawH,
      })
      const bytes = await doc.save()
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = (fileName || 'scan').replace(/\.[^.]+$/, '') + '_scanned.pdf'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success('Đã lưu PDF')
    } catch (e) {
      console.error(e)
      toast.error('Lưu PDF lỗi: ' + (e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setImgEl(null); setImgData(null); setFileName('')
    setCorners(null); setPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const autoCornersFromMargin = (marginPct) => {
    if (!imgEl) return
    const w = imgEl.naturalWidth, h = imgEl.naturalHeight
    const m = marginPct / 100
    setCorners([
      { x: w * m,       y: h * m       },
      { x: w * (1 - m), y: h * m       },
      { x: w * (1 - m), y: h * (1 - m) },
      { x: w * m,       y: h * (1 - m) },
    ])
    setPreview(null)
  }

  return (
    <div className="bg-white rounded-2xl shadow border border-gray-100 p-3 sm:p-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-gray-100">
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
          hidden onChange={e => onPick(e.target.files?.[0])} />
        <button type="button" onClick={() => fileInputRef.current?.click()}
          className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700">
          📷 Chọn ảnh…
        </button>
        {fileName && (
          <span className="text-xs text-gray-600 truncate max-w-[240px]" title={fileName}>
            🖼 {fileName}
          </span>
        )}
        {imgEl && (
          <>
            <div className="flex items-center gap-1 ml-2">
              <span className="text-[11px] text-gray-500">Khung mặc định:</span>
              {[0, 5, 10].map(m => (
                <button key={m} type="button" onClick={() => autoCornersFromMargin(m)}
                  className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 hover:bg-gray-200">
                  {m}%
                </button>
              ))}
            </div>
            <button type="button" onClick={toggleMagnetic}
              title="Khi bật, 4 góc luôn là hình chữ nhật — kéo 1 góc, 2 góc kề scale theo. Tránh warp làm méo."
              className={`text-[11px] px-2 py-1 rounded-md font-semibold border transition
                ${magnetic
                  ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
              🧲 Magnetic {magnetic ? 'ON' : 'OFF'}
            </button>

            {/* Rotation controls — chỉ hiện khi magnetic ON. Giúp xoay rect
                khớp mép văn bản nghiêng do góc chụp. */}
            {magnetic && (
              <div className="inline-flex items-center gap-0.5 rounded-md bg-white border border-gray-300 overflow-hidden">
                <button type="button" onClick={() => rotateRect(-5)}
                  title="Xoay ngược chiều kim đồng hồ 5°"
                  className="px-2 py-1 text-sm text-gray-700 hover:bg-gray-100">↶</button>
                <button type="button" onClick={() => rotateRect(-1)}
                  title="Xoay ngược 1°"
                  className="px-1.5 py-1 text-[10px] text-gray-500 hover:bg-gray-100 border-l border-gray-200">
                  −1°
                </button>
                <button type="button" onClick={resetRotation}
                  title="Reset về 0°"
                  className="px-2 py-1 text-[11px] font-mono tabular-nums text-gray-700 hover:bg-gray-100
                    min-w-[42px] border-x border-gray-200 text-center">
                  {Math.round(magneticAngle)}°
                </button>
                <button type="button" onClick={() => rotateRect(1)}
                  title="Xoay xuôi 1°"
                  className="px-1.5 py-1 text-[10px] text-gray-500 hover:bg-gray-100 border-r border-gray-200">
                  +1°
                </button>
                <button type="button" onClick={() => rotateRect(5)}
                  title="Xoay xuôi chiều kim đồng hồ 5°"
                  className="px-2 py-1 text-sm text-gray-700 hover:bg-gray-100">↷</button>
              </div>
            )}
          </>
        )}
        <div className="flex-1" />
        {imgEl && (
          <>
            <label className="flex items-center gap-1 text-[11px] text-gray-600">
              Xoá bóng
              <input type="range" min="0" max="1" step="0.05"
                value={options.shadowStrength}
                onChange={e => setOptions(o => ({ ...o, shadowStrength: Number(e.target.value) }))}
                className="w-20" />
              <span className="w-8 tabular-nums font-mono">{options.shadowStrength.toFixed(2)}</span>
            </label>
            <label className="flex items-center gap-1 text-[11px] text-gray-600"
              title="Làm phẳng vết nhăn / vệt xám nhẹ. Cao quá sẽ mất chi tiết mờ.">
              Làm phẳng
              <input type="range" min="0" max="1" step="0.05"
                value={options.flatten}
                onChange={e => setOptions(o => ({ ...o, flatten: Number(e.target.value) }))}
                className="w-20" />
              <span className="w-8 tabular-nums font-mono">{options.flatten.toFixed(2)}</span>
            </label>
            <button type="button" onClick={reset}
              className="px-3 py-1.5 text-sm font-semibold rounded-lg text-gray-600 hover:bg-gray-100">
              Huỷ
            </button>
            <button type="button" onClick={process} disabled={busy}
              className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-indigo-600 text-white
                hover:bg-indigo-700 disabled:opacity-50">
              {busy ? 'Đang xử lý…' : '🔍 Xem trước'}
            </button>
            <button type="button" onClick={savePdf} disabled={busy || !preview}
              className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-emerald-600 text-white
                hover:bg-emerald-700 disabled:opacity-50">
              💾 Lưu PDF
            </button>
          </>
        )}
      </div>

      {!imgEl && (
        <div className="py-16 text-center text-gray-400 text-sm">
          <div className="text-4xl mb-2">📸</div>
          <div>Chụp hoặc chọn 1 ảnh văn bản. Kéo 4 góc theo mép giấy để warp &amp; xoá bóng.</div>
        </div>
      )}

      {imgEl && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Panel trái: ảnh gốc + 4 handle. Viewport fit theo 100dvh trừ
              header/tabs/toolbar (~ 230px).
              ── Zoom = 1 (fit) → dùng CSS thuần (max-width/max-height) để
                 ảnh tự fit, không cần đo viewport. Stage là inline-block
                 bọc sát image → handles align đúng.
              ── Zoom ≠ 1 → cần đo viewport × zoom. Dùng useContainerSize. */}
          <div className="flex flex-col" style={{ minHeight: 0 }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold text-gray-700 flex-1">
                Ảnh gốc · kéo 4 chấm theo mép giấy
              </span>
              <ZoomBar zoom={zoomSrc} onZoom={setZoomSrc} />
            </div>
            <div ref={vpSrcRef}
              className="relative bg-slate-100 rounded-lg border border-gray-200 overflow-auto"
              style={{ height: 'calc(100dvh - 230px)', minHeight: 300 }}>
              {zoomSrc === 1 ? (
                /* Fit mode — CSS thuần, không depend vào đo đạc */
                <div className="absolute inset-0 flex items-center justify-center p-2">
                  <div ref={stageRef}
                    onMouseMove={onStageMove} onMouseUp={onStageUp} onMouseLeave={onStageUp}
                    onTouchMove={onStageMove} onTouchEnd={onStageUp}
                    style={{
                      position: 'relative',
                      display: 'inline-block',
                      maxWidth: '100%', maxHeight: '100%',
                      userSelect: 'none', touchAction: 'none',
                      lineHeight: 0,  // bỏ gap mặc định dưới img
                    }}>
                    <img src={imgEl.src} alt=""
                      style={{
                        display: 'block',
                        maxWidth: '100%',
                        maxHeight: 'calc(100dvh - 250px)',
                        width: 'auto', height: 'auto',
                        border: '1px solid #e5e7eb',
                      }}
                      draggable={false} />
                    {corners && (
                      <QuadOverlay corners={corners} imgW={imgEl.naturalWidth} imgH={imgEl.naturalHeight}
                        onHandleDown={onHandleDown} />
                    )}
                  </div>
                </div>
              ) : (
                /* Zoom mode — explicit pixel size dựa trên measured viewport */
                <div className="inline-block p-2">
                  {srcRender && srcRender.w > 0 && (
                    <div ref={stageRef}
                      onMouseMove={onStageMove} onMouseUp={onStageUp} onMouseLeave={onStageUp}
                      onTouchMove={onStageMove} onTouchEnd={onStageUp}
                      style={{
                        position: 'relative',
                        width: srcRender.w, height: srcRender.h,
                        userSelect: 'none', touchAction: 'none',
                      }}>
                      <img src={imgEl.src} alt=""
                        style={{
                          display: 'block',
                          width: '100%', height: '100%',
                          border: '1px solid #e5e7eb',
                        }}
                        draggable={false} />
                      {corners && (
                        <QuadOverlay corners={corners} imgW={imgEl.naturalWidth} imgH={imgEl.naturalHeight}
                          onHandleDown={onHandleDown} />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="text-[10px] text-gray-500 mt-1">
              Mỗi chấm là 1 góc văn bản.
              {magnetic
                ? ` Magnetic ON · ${Math.round(magneticAngle)}° — kéo 1 góc để scale, dùng ↶/↷ để nghiêng khung theo mép giấy.`
                : ' Kéo cho sát mép — bật Magnetic nếu muốn giữ hình chữ nhật.'}
            </div>
          </div>

          {/* Panel phải: preview */}
          <div className="flex flex-col" style={{ minHeight: 0 }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold text-gray-700 flex-1">
                Kết quả (warp + xoá bóng + làm phẳng)
              </span>
              {preview && <ZoomBar zoom={zoomDst} onZoom={setZoomDst} />}
            </div>
            <div ref={vpDstRef}
              className="relative bg-gray-50 rounded-lg border border-gray-200 overflow-auto"
              style={{ height: 'calc(100dvh - 230px)', minHeight: 300 }}>
              {preview ? (
                zoomDst === 1 ? (
                  <div className="absolute inset-0 flex items-center justify-center p-2">
                    <img src={preview.dataUrl} alt="preview"
                      style={{
                        display: 'block',
                        maxWidth: '100%',
                        maxHeight: 'calc(100dvh - 250px)',
                        width: 'auto', height: 'auto',
                      }} />
                  </div>
                ) : (
                  <div className="inline-block p-2">
                    {dstRender && dstRender.w > 0 && (
                      <img src={preview.dataUrl} alt="preview"
                        style={{
                          display: 'block',
                          width: dstRender.w, height: dstRender.h,
                        }} />
                    )}
                  </div>
                )
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400 px-2 text-center">
                  Bấm <span className="font-semibold mx-1">"Xem trước"</span> để xử lý ảnh.
                </div>
              )}
            </div>
            {preview && (
              <div className="text-[10px] text-gray-500 mt-1 tabular-nums">
                Output: {preview.w} × {preview.h} px
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  Overlay 4 chấm + đường nối tứ giác
// ═══════════════════════════════════════════════════════════════

function QuadOverlay({ corners, imgW, imgH, onHandleDown }) {
  const pts = corners.map(c => `${(c.x / imgW) * 100},${(c.y / imgH) * 100}`).join(' ')
  const labels = ['TL', 'TR', 'BR', 'BL']
  return (
    <>
      <svg
        viewBox="0 0 100 100" preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        <polygon points={pts}
          fill="rgba(59,130,246,0.15)" stroke="#2563EB" strokeWidth="0.3"
          vectorEffect="non-scaling-stroke" />
      </svg>
      {corners.map((c, i) => (
        <div key={i}
          onMouseDown={onHandleDown(i)} onTouchStart={onHandleDown(i)}
          title={labels[i]}
          style={{
            position: 'absolute',
            left: `${(c.x / imgW) * 100}%`, top: `${(c.y / imgH) * 100}%`,
            width: 22, height: 22, marginLeft: -11, marginTop: -11,
            borderRadius: '50%',
            background: '#2563EB', border: '3px solid white',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            cursor: 'grab', zIndex: 2,
          }} />
      ))}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

// Normalize angle về khoảng (-180, 180] cho hiển thị gọn.
function normalizeAngle(deg) {
  let a = deg % 360
  if (a > 180)  a -= 360
  if (a <= -180) a += 360
  return a
}

function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(',')
  const b64 = dataUrl.slice(comma + 1)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
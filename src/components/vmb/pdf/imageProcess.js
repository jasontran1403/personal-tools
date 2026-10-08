/**
 * Thuật toán xử lý ảnh dùng chung cho scanner.
 *
 *   - solveHomography(src4, dst4)
 *       Giải ma trận homography 3×3 H sao cho H·src = dst, bằng cách lập hệ
 *       8 phương trình tuyến tính (DLT đơn giản) và giải bằng khử Gauss.
 *
 *   - warpPerspective(srcCanvas, dstW, dstH, quadInSrc)
 *       Trả về ImageData kích thước dstW×dstH, mỗi điểm sample bằng bilinear
 *       từ srcCanvas. Dùng H ngược (dst → src) để scan output grid.
 *
 *   - removeShadow(imageData)
 *       Thuật "divide by blur" (box-blur xấp xỉ Gaussian) — ước lượng ánh
 *       sáng nền bằng blur rất lớn, chia pixel gốc cho background → chuẩn
 *       hoá văn bản-trên-nền-trắng, triệt bóng mềm.
 */

// ────────────────────────────────────────────────────────────
//  Homography (DLT 8-param)
// ────────────────────────────────────────────────────────────

/**
 * src, dst: array 4 điểm [{x,y}, ...], theo thứ tự TL, TR, BR, BL.
 * Trả về ma trận 3×3 (array 9 phần tử row-major) H.
 */
export function solveHomography(src, dst) {
  // Hệ 8 pt: với mỗi điểm, 2 pt về u, v theo công thức homography.
  // Biến: h11 h12 h13 h21 h22 h23 h31 h32 (h33 = 1).
  const A = []  // 8×8
  const b = []  // 8
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i]
    const { x: dx, y: dy } = dst[i]
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]); b.push(dx)
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]); b.push(dy)
  }
  const h = solveLinear(A, b)
  return [h[0], h[1], h[2],
          h[3], h[4], h[5],
          h[6], h[7], 1]
}

/** Giải Ax = b bằng khử Gauss cột-pivot. A: N×N, b: N. */
function solveLinear(Ain, bin) {
  const n = Ain.length
  const A = Ain.map(r => r.slice())
  const b = bin.slice()
  for (let i = 0; i < n; i++) {
    // pivot
    let maxRow = i, maxVal = Math.abs(A[i][i])
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(A[r][i]) > maxVal) { maxVal = Math.abs(A[r][i]); maxRow = r }
    }
    if (maxVal < 1e-12) throw new Error('Hệ suy biến — chọn 4 góc khác')
    if (maxRow !== i) { [A[i], A[maxRow]] = [A[maxRow], A[i]];[b[i], b[maxRow]] = [b[maxRow], b[i]] }
    // eliminate
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i]
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]
      b[r] -= f * b[i]
    }
  }
  // back-substitute
  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]
    x[i] = s / A[i][i]
  }
  return x
}

/** Nhân H ngược: cho (dx, dy) → (sx, sy) tương ứng trong ảnh gốc. */
function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8]
  const u = (H[0] * x + H[1] * y + H[2]) / w
  const v = (H[3] * x + H[4] * y + H[5]) / w
  return [u, v]
}

/** Nghịch đảo ma trận 3×3 (array row-major 9 phần tử). */
function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m
  const A =   e * i - f * h
  const B = -(d * i - f * g)
  const C =   d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) throw new Error('Ma trận suy biến')
  const invDet = 1 / det
  return [
     A * invDet,                 -(b * i - c * h) * invDet,  (b * f - c * e) * invDet,
     B * invDet,                  (a * i - c * g) * invDet, -(a * f - c * d) * invDet,
     C * invDet,                 -(a * h - b * g) * invDet,  (a * e - b * d) * invDet,
  ]
}

/**
 * Warp phối cảnh.
 *   srcImageData: ImageData gốc (có .data, .width, .height)
 *   quadInSrc:    4 điểm [TL,TR,BR,BL] trong ảnh gốc (px gốc, không scale)
 *   dstW, dstH:   kích thước ảnh ra
 *
 * Trả ImageData dstW×dstH đã sample bilinear.
 */
export function warpPerspective(srcImageData, quadInSrc, dstW, dstH) {
  const dstQuad = [
    { x: 0,         y: 0 },
    { x: dstW - 1,  y: 0 },
    { x: dstW - 1,  y: dstH - 1 },
    { x: 0,         y: dstH - 1 },
  ]
  // H: dst → src (map điểm output về điểm input để sample)
  const Hforward = solveHomography(quadInSrc, dstQuad)   // src → dst
  const Hinv = invert3(Hforward)                          // dst → src

  const { data: sd, width: sw, height: sh } = srcImageData
  const out = new ImageData(dstW, dstH)
  const od = out.data

  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const [u, v] = applyH(Hinv, x, y)
      const idx = (y * dstW + x) * 4
      if (u < 0 || v < 0 || u >= sw - 1 || v >= sh - 1) {
        od[idx] = 255; od[idx + 1] = 255; od[idx + 2] = 255; od[idx + 3] = 255
        continue
      }
      // Bilinear
      const u0 = Math.floor(u), v0 = Math.floor(v)
      const du = u - u0, dv = v - v0
      const i00 = (v0 * sw + u0) * 4
      const i10 = (v0 * sw + (u0 + 1)) * 4
      const i01 = ((v0 + 1) * sw + u0) * 4
      const i11 = ((v0 + 1) * sw + (u0 + 1)) * 4
      for (let c = 0; c < 3; c++) {
        const v00 = sd[i00 + c], v10 = sd[i10 + c], v01 = sd[i01 + c], v11 = sd[i11 + c]
        const top = v00 * (1 - du) + v10 * du
        const bot = v01 * (1 - du) + v11 * du
        od[idx + c] = Math.round(top * (1 - dv) + bot * dv)
      }
      od[idx + 3] = 255
    }
  }
  return out
}

// ────────────────────────────────────────────────────────────
//  Shadow removal: divide-by-blur
// ────────────────────────────────────────────────────────────

/**
 * Triệt bóng mềm + làm phẳng nhăn giấy trên văn bản-trên-nền-trắng.
 *
 * Thuật:
 *   1. Dilate (ước lượng background sáng) bằng box-max kernel size k.
 *   2. Blur mạnh bằng box-blur 2 chiều → ánh sáng nền trơn.
 *   3. Với mỗi kênh: normalized = min(255, pixel / bg * 255).
 *   4. (Nếu flatten > 0) contrast stretch: ép mid-tones sáng lên,
 *      đẩy pixel > whitePoint về 255 — triệt nhăn/vệt nhẹ còn sót.
 *
 * ── Vì sao thêm bước 4 ────────────────────────────────────
 * Divide-by-blur chỉ loại gradient CHẬM (bóng cả vùng). Vết nhăn giấy có
 * cạnh sắc hơn kernel blur → sau khi normalize vẫn còn vệt xám nhẹ. Bước
 * contrast-stretch (piecewise linear) kéo vệt xám > blackPoint về trắng,
 * giữ text đen vì text đã rất tối.
 *
 * options:
 *   dilateRadius (auto từ kích thước, min 7)
 *   blurRadius   (auto từ kích thước)
 *   strength     (0..1) — pha trộn kết quả normalize với ảnh gốc. Default 1.
 *   flatten      (0..1) — mức làm phẳng nhăn / contrast stretch. 0 = tắt,
 *                1 = max (threshold mạnh, trông như scan trắng-đen).
 *                Default 0.5.
 */
export function removeShadow(img, options = {}) {
  const w = img.width, h = img.height
  const minSide = Math.min(w, h)
  const dilateR = options.dilateRadius ?? Math.max(7, Math.round(minSide * 0.012))
  const blurR   = options.blurRadius   ?? Math.max(12, Math.round(minSide * 0.03))
  const strength = options.strength ?? 1
  const flatten  = Math.max(0, Math.min(1, options.flatten ?? 0.5))

  const src = img.data
  // Downsample ảnh để tính background nhanh (hệ số 4). Dilate/blur trên bản
  // nhỏ, rồi upsample lại — vẫn mượt vì bg đổi chậm.
  const DS = 4
  const sw = Math.max(1, Math.floor(w / DS))
  const sh = Math.max(1, Math.floor(h / DS))
  const small = downsample(src, w, h, sw, sh)

  const dilated = dilateBoxMax(small, sw, sh, Math.max(1, Math.round(dilateR / DS)))
  const blurred = boxBlur(dilated, sw, sh, Math.max(1, Math.round(blurR / DS)))

  // Bảng lookup cho contrast stretch (bước 4). Thay vì tính per-pixel,
  // precompute 256 giá trị.
  //
  // Mô hình piecewise linear:
  //   p < blackPoint → p (giữ nguyên text đen)
  //   p ≥ whitePoint → 255
  //   giữa          → scale (p - blackPoint) / (whitePoint - blackPoint) * 255
  //
  // flatten 0 → whitePoint = 255 (không stretch),
  // flatten 1 → blackPoint = 60, whitePoint = 190 (rất mạnh — gần threshold).
  const blackPoint = Math.round(0 + 60 * flatten)        // 0..60
  const whitePoint = Math.round(255 - 65 * flatten)      // 255..190
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) {
    if (v <= blackPoint) lut[v] = v
    else if (v >= whitePoint) lut[v] = 255
    else {
      const t = (v - blackPoint) / (whitePoint - blackPoint)
      // Pha trộn: khi flatten=0 giữ nguyên, flatten=1 dùng t * 255
      const stretched = blackPoint + t * (255 - blackPoint)
      lut[v] = Math.round(v * (1 - flatten) + stretched * flatten)
    }
  }

  // Giờ cho mỗi pixel ảnh gốc: lookup bg từ `blurred` (bilinear) → chia →
  // (nếu flatten > 0) qua LUT contrast-stretch.
  const out = new ImageData(w, h)
  const od = out.data
  for (let y = 0; y < h; y++) {
    const yy = Math.min(sh - 1, y / DS)
    const yy0 = Math.floor(yy), yy1 = Math.min(sh - 1, yy0 + 1)
    const dy = yy - yy0
    for (let x = 0; x < w; x++) {
      const xx = Math.min(sw - 1, x / DS)
      const xx0 = Math.floor(xx), xx1 = Math.min(sw - 1, xx0 + 1)
      const dx = xx - xx0
      const i00 = (yy0 * sw + xx0) * 4
      const i10 = (yy0 * sw + xx1) * 4
      const i01 = (yy1 * sw + xx0) * 4
      const i11 = (yy1 * sw + xx1) * 4
      const idx = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const b00 = blurred[i00 + c], b10 = blurred[i10 + c]
        const b01 = blurred[i01 + c], b11 = blurred[i11 + c]
        const btop = b00 * (1 - dx) + b10 * dx
        const bbot = b01 * (1 - dx) + b11 * dx
        const bg = Math.max(1, btop * (1 - dy) + bbot * dy)
        const orig = src[idx + c]
        const norm = Math.min(255, (orig / bg) * 255)
        const blended = Math.round(orig * (1 - strength) + norm * strength)
        od[idx + c] = flatten > 0 ? lut[blended] : blended
      }
      od[idx + 3] = 255
    }
  }
  return out
}

function downsample(src, w, h, sw, sh) {
  const out = new Uint8ClampedArray(sw * sh * 4)
  const sx = w / sw, sy = h / sh
  for (let y = 0; y < sh; y++) {
    const yy = Math.min(h - 1, Math.floor(y * sy))
    for (let x = 0; x < sw; x++) {
      const xx = Math.min(w - 1, Math.floor(x * sx))
      const si = (yy * w + xx) * 4
      const oi = (y * sw + x) * 4
      out[oi]     = src[si]
      out[oi + 1] = src[si + 1]
      out[oi + 2] = src[si + 2]
      out[oi + 3] = 255
    }
  }
  return out
}

/** Dilate box-max radius r: mỗi pixel = max trong hình vuông (2r+1). */
function dilateBoxMax(buf, w, h, r) {
  // Separable: max theo hàng rồi theo cột, bằng sliding deque.
  const tmp = new Uint8ClampedArray(buf.length)
  const out = new Uint8ClampedArray(buf.length)
  for (let c = 0; c < 3; c++) {
    // Hàng
    for (let y = 0; y < h; y++) {
      slidingMax(buf, tmp, y * w, 1, w, r, c, 4)
    }
    // Cột
    for (let x = 0; x < w; x++) {
      slidingMax(tmp, out, x, w, h, r, c, 4)
    }
  }
  // alpha
  for (let i = 3; i < out.length; i += 4) out[i] = 255
  return out
}

/**
 * Sliding max 1D với bước stride và offset channel.
 *   src/dst: Uint8ClampedArray
 *   start: index pixel đầu tiên
 *   stride: 1 (hàng) hoặc w (cột) — tính theo pixel
 *   len: số pixel
 *   r: bán kính
 *   c: channel offset (0,1,2)
 *   pxBytes: 4
 */
function slidingMax(src, dst, start, stride, len, r, c, pxBytes) {
  const q = []  // deque chứa index pixel trong [0..len-1]
  const get = (i) => src[(start + i * stride) * pxBytes + c]
  for (let i = 0; i < len + r; i++) {
    if (i < len) {
      while (q.length && get(q[q.length - 1]) <= get(i)) q.pop()
      q.push(i)
    }
    while (q.length && q[0] < i - r) q.shift()
    const outI = i - r
    if (outI >= 0) {
      dst[(start + outI * stride) * pxBytes + c] = get(q[0])
    }
  }
}

/** Box blur radius r áp 2 lần (xấp xỉ Gaussian). Separable. */
function boxBlur(buf, w, h, r) {
  let a = buf
  let b = new Uint8ClampedArray(buf.length)
  for (let pass = 0; pass < 2; pass++) {
    boxBlurH(a, b, w, h, r)
    boxBlurV(b, a, w, h, r)
  }
  // alpha
  for (let i = 3; i < a.length; i += 4) a[i] = 255
  return a
}

function boxBlurH(src, dst, w, h, r) {
  const win = r * 2 + 1
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0
      // init window: pad với giá trị đầu
      for (let i = -r; i <= r; i++) {
        const x = Math.min(w - 1, Math.max(0, i))
        sum += src[(y * w + x) * 4 + c]
      }
      for (let x = 0; x < w; x++) {
        dst[(y * w + x) * 4 + c] = Math.round(sum / win)
        const xRemove = Math.min(w - 1, Math.max(0, x - r))
        const xAdd    = Math.min(w - 1, Math.max(0, x + r + 1))
        sum += src[(y * w + xAdd) * 4 + c] - src[(y * w + xRemove) * 4 + c]
      }
    }
  }
}

function boxBlurV(src, dst, w, h, r) {
  const win = r * 2 + 1
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0
      for (let i = -r; i <= r; i++) {
        const y = Math.min(h - 1, Math.max(0, i))
        sum += src[(y * w + x) * 4 + c]
      }
      for (let y = 0; y < h; y++) {
        dst[(y * w + x) * 4 + c] = Math.round(sum / win)
        const yRemove = Math.min(h - 1, Math.max(0, y - r))
        const yAdd    = Math.min(h - 1, Math.max(0, y + r + 1))
        sum += src[(yAdd * w + x) * 4 + c] - src[(yRemove * w + x) * 4 + c]
      }
    }
  }
}
/**
 * 2026-11-12: Sinh mã TOTP (RFC 6238) ngay trên trình duyệt bằng Web Crypto.
 *
 * Dùng cho tab 2FA trong "Tra cứu" — giống Google Authenticator. Secret được
 * lưu LOCAL trên thiết bị (localStorage), KHÔNG gửi lên server.
 *
 * Hỗ trợ: base32 secret, digits 6/8, period tuỳ chỉnh, SHA-1/256/512.
 */

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Mã hoá bytes → chuỗi base32 (RFC 4648, không padding). */
export function base32Encode(bytes) {
  let bits = 0, value = 0, out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) { out += B32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/** Giải mã base32 (RFC 4648, bỏ qua khoảng trắng & padding) → Uint8Array. */
export function base32Decode(input) {
  if (!input) return new Uint8Array(0)
  const clean = String(input).toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '')
  let bits = 0, value = 0
  const out = []
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

const HASH_NAME = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }

async function hmac(algorithm, keyBytes, msgBytes) {
  const hash = HASH_NAME[(algorithm || 'SHA1').toUpperCase()] || 'SHA-1'
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, msgBytes)
  return new Uint8Array(sig)
}

/**
 * Sinh mã TOTP. Trả về chuỗi số (vd "492013") hoặc null nếu secret không hợp lệ.
 */
export async function generateTOTP(secret, opts = {}) {
  const { period = 30, digits = 6, algorithm = 'SHA1', timeMs = Date.now() } = opts
  const key = base32Decode(secret)
  if (!key.length) return null
  let counter = Math.floor(timeMs / 1000 / period)
  const msg = new Uint8Array(8)
  for (let i = 7; i >= 0; i--) { msg[i] = counter & 0xff; counter = Math.floor(counter / 256) }
  let h
  try { h = await hmac(algorithm, key, msg) } catch { return null }
  const offset = h[h.length - 1] & 0x0f
  const bin = ((h[offset] & 0x7f) << 24) | ((h[offset + 1] & 0xff) << 16)
            | ((h[offset + 2] & 0xff) << 8) | (h[offset + 3] & 0xff)
  const mod = 10 ** digits
  return String(bin % mod).padStart(digits, '0')
}

/**
 * Parse URI otpauth://totp/Issuer:account?secret=...&issuer=...&digits=...&period=...&algorithm=...
 * Trả về { secret, name, issuer, digits, period, algorithm } hoặc null.
 */
export function parseOtpauth(uri) {
  try {
    if (!uri || !/^otpauth:\/\//i.test(uri.trim())) return null
    const u = new URL(uri.trim())
    const secret = u.searchParams.get('secret')
    if (!secret) return null
    const label = decodeURIComponent(u.pathname.replace(/^\/+/, ''))
    const issuerQ = u.searchParams.get('issuer') || ''
    let issuerLabel = '', account = label
    if (label.includes(':')) { [issuerLabel, account] = label.split(':') }
    return {
      secret: secret.replace(/\s/g, ''),
      name: (account || label || '').trim(),
      issuer: (issuerQ || issuerLabel || '').trim(),
      digits: Number(u.searchParams.get('digits')) || 6,
      period: Number(u.searchParams.get('period')) || 30,
      algorithm: (u.searchParams.get('algorithm') || 'SHA1').toUpperCase(),
    }
  } catch { return null }
}

// ── Google Authenticator export (otpauth-migration://offline?data=...) ──────
//   data = base64(protobuf MigrationPayload). Chứa NHIỀU tài khoản.

function b64ToBytes(b64) {
  let s = String(b64).replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Đọc 1 varint protobuf từ buf tại pos → [value, newPos]. */
function readVarint(buf, pos) {
  let result = 0, shift = 0, b
  do { b = buf[pos++]; result += (b & 0x7f) * (2 ** shift); shift += 7 } while (b & 0x80)
  return [result, pos]
}

/** Đọc các field protobuf trong [start, end) → [{fieldNo, wire, value?, bytes?}]. */
function readFields(buf, start, end) {
  const fields = []
  let pos = start
  while (pos < end) {
    let tag;[tag, pos] = readVarint(buf, pos)
    const fieldNo = tag >>> 3
    const wire = tag & 7
    if (wire === 0) { let v;[v, pos] = readVarint(buf, pos); fields.push({ fieldNo, wire, value: v }) }
    else if (wire === 2) { let len;[len, pos] = readVarint(buf, pos); fields.push({ fieldNo, wire, bytes: buf.subarray(pos, pos + len) }); pos += len }
    else if (wire === 5) { pos += 4 }
    else if (wire === 1) { pos += 8 }
    else break
  }
  return fields
}

/**
 * Parse QR export của Google Authenticator. Trả về MẢNG tài khoản TOTP
 * [{ secret(base32), name, issuer, digits, period, algorithm }] hoặc null.
 */
export function parseMigration(uri) {
  try {
    if (!/^otpauth-migration:/i.test(String(uri).trim())) return null
    const m = String(uri).match(/[?&]data=([^&]+)/)
    if (!m) return null
    const bytes = b64ToBytes(decodeURIComponent(m[1]))
    const dec = new TextDecoder()
    const out = []
    for (const f of readFields(bytes, 0, bytes.length)) {
      if (f.fieldNo !== 1 || f.wire !== 2) continue // repeated otp_parameters
      let secret = null, name = '', issuer = '', algo = 1, digits = 1, type = 2
      for (const g of readFields(f.bytes, 0, f.bytes.length)) {
        if (g.fieldNo === 1 && g.wire === 2) secret = g.bytes
        else if (g.fieldNo === 2 && g.wire === 2) name = dec.decode(g.bytes)
        else if (g.fieldNo === 3 && g.wire === 2) issuer = dec.decode(g.bytes)
        else if (g.fieldNo === 4) algo = g.value
        else if (g.fieldNo === 5) digits = g.value
        else if (g.fieldNo === 6) type = g.value
      }
      if (!secret || type !== 2) continue // chỉ lấy TOTP (bỏ HOTP)
      out.push({
        secret: base32Encode(secret),
        name: name || 'Không tên',
        issuer: issuer || '',
        digits: digits === 2 ? 8 : 6,
        period: 30,
        algorithm: algo === 2 ? 'SHA256' : algo === 3 ? 'SHA512' : 'SHA1',
      })
    }
    return out
  } catch { return null }
}

/**
 * Đọc mã QR từ 1 file ảnh bằng BarcodeDetector (Chrome/Android). Trả về chuỗi
 * rawValue. Ném lỗi (message tiếng Việt) nếu trình duyệt không hỗ trợ hoặc
 * không tìm thấy QR — khi đó user nhập chuỗi bí mật thủ công.
 */
export async function decodeQrFromImage(file) {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) {
    throw new Error('Trình duyệt không hỗ trợ quét QR. Vui lòng nhập chuỗi bí mật thủ công.')
  }
  const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
  const bitmap = await createImageBitmap(file)
  const codes = await detector.detect(bitmap)
  if (!codes || !codes.length) throw new Error('Không tìm thấy mã QR trong ảnh.')
  return codes[0].rawValue
}
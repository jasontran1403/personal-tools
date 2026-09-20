import { useMemo, useState } from 'react'
import Modal from '../common/Modal'
import { vmbFileUrl } from '../../services/api'

/**
 * Modal "Xuất trình" — hiển thị 3 lựa chọn để tải file gửi khách.
 *
 * Vào modal này khi click Mã booking ở bảng.
 *
 * 3 lựa chọn (2026-09-19 điều chỉnh):
 *   1) Thông tin booking  — BookingProof (bằng chứng)
 *   2) Mặt vé             — TicketFile (bookingFace hoặc ticketFace)
 *   3) Hóa đơn (GỘP)      — Ưu tiên issuedUrl nếu có, fallback draftUrl.
 *                           Nếu không có cả 2 thì không khả dụng.
 *
 * Cơ chế nhóm & tải giữ nguyên:
 *   Với mỗi lựa chọn, xác định mỗi khách sẽ tải NHỮNG FILE NÀO. Sau đó
 *   gom các khách có "cùng tập file" thành 1 group.
 *     - 1 group → tải thẳng.
 *     - N group → hiện list group. Click group → tải.
 *
 * Đặt tên file khi tải (yêu cầu):
 *   hh:mm:ss dd/MM/yy
 *   • Cá nhân     : "<Type>-<PassengerName>-<time>.<ext>"
 *   • Chung/subset: "<Type>-<BookingCode>-<time>.<ext>"
 *   Type: Booking-info | Itinerary | Invoice
 */
export default function PresentationModal({ open, booking, onClose }) {
  const [option, setOption] = useState(null) // null | 'proof' | 'face' | 'invoice'

  if (!open || !booking) return null

  // Xác định độ khả dụng của mỗi option
  const cap = useMemo(() => computeCapabilities(booking), [booking])

  const back = () => setOption(null)

  return (
    <Modal open onClose={onClose}
      title={option ? renderOptionTitle(option) : `Xuất trình — ${booking.bookingCode || '(chưa có mã)'}`}
      size="lg">
      {option == null ? (
        <OptionGrid cap={cap} onPick={setOption} />
      ) : (
        <OptionDetail
          option={option}
          booking={booking}
          cap={cap}
          onBack={back}
        />
      )}

      {option == null && (
        <div className="mt-4 flex justify-end">
          <button onClick={onClose}
            className="px-4 py-2 rounded-md bg-gray-100 hover:bg-gray-200 text-sm font-semibold">
            Đóng
          </button>
        </div>
      )}
    </Modal>
  )
}

function renderOptionTitle(opt) {
  switch (opt) {
    case 'proof':   return 'Thông tin booking'
    case 'face':    return 'Mặt vé'
    case 'invoice': return 'Hóa đơn'
    default: return 'Xuất trình'
  }
}

// ══════════════════════════════════════════════════════════════
//  OPTION GRID
// ══════════════════════════════════════════════════════════════

function OptionGrid({ cap, onPick }) {
  const opts = [
    { key: 'proof',   label: 'Thông tin booking', icon: '📋', hint: 'File bằng chứng đặt chỗ' },
    { key: 'face',    label: 'Mặt vé',            icon: '🎫', hint: 'Ảnh mặt vé hành khách' },
    { key: 'invoice', label: 'Hóa đơn',           icon: '🧾', hint: 'Ưu tiên đã phát hành; nếu chưa có thì lấy nháp' },
  ]
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {opts.map(o => {
        const info = cap[o.key]
        const disabled = !info.available
        return (
          <button key={o.key} type="button"
            disabled={disabled}
            onClick={() => onPick(o.key)}
            className={`text-left p-4 rounded-lg border transition ${
              disabled
                ? 'bg-gray-50 border-gray-200 cursor-not-allowed opacity-60'
                : 'bg-white border-gray-300 hover:border-blue-500 hover:shadow-md'
            }`}>
            <div className="flex items-start gap-3">
              <span className="text-2xl">{o.icon}</span>
              <div className="flex-1">
                <div className="text-sm font-bold text-gray-800">{o.label}</div>
                <div className="text-[11px] text-gray-500">{o.hint}</div>
                <div className="text-[11px] mt-1 font-semibold">
                  {info.available ? (
                    <span className="text-emerald-700">
                      {info.groupCount === 1 ? 'Tải trực tiếp' : `${info.groupCount} nhóm hành khách`}
                    </span>
                  ) : (
                    <span className="text-gray-400">Chưa có file</span>
                  )}
                </div>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  OPTION DETAIL — hoặc auto-download (1 group) hoặc list groups
// ══════════════════════════════════════════════════════════════

function OptionDetail({ option, booking, cap, onBack }) {
  const info = cap[option]

  if (!info.available) {
    return (
      <div className="p-4 text-sm text-gray-600">
        Không có file để xuất trình cho mục này.
        <div className="mt-4">
          <button onClick={onBack} className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-sm">
            ← Quay lại
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {info.groupCount > 1 && (
        <div className="text-xs text-gray-600 mb-2">
          Các hành khách có file khác nhau — được gộp thành <b>{info.groupCount}</b> nhóm.
        </div>
      )}
      {info.groups.map((g, i) => (
        <GroupBlock key={i} option={option} booking={booking} group={g} index={i + 1}
                    showIndex={info.groupCount > 1} />
      ))}
      <div className="pt-1">
        <button onClick={onBack} className="px-3 py-2 rounded-md bg-gray-100 hover:bg-gray-200 text-sm">
          ← Quay lại
        </button>
      </div>
    </div>
  )
}

/**
 * Card cho 1 group: header (danh sách khách + nút tải tất cả) và list file
 * bên dưới. Mỗi file có preview inline (ảnh) hoặc icon (PDF/khác), tên gốc,
 * badge nhãn (Nháp / Đã PH …) nếu là hóa đơn, và 2 nút Xem trước + Tải.
 */
function GroupBlock({ option, booking, group, index, showIndex }) {
  const isAllBooking = group.passengers.length === (booking.tickets?.length || 0)
  const passengersLabel = isAllBooking
    ? 'Toàn bộ booking'
    : group.passengers.map(p => p.passengerName || `#${p.id}`).join(', ')

  return (
    <div className="p-3 rounded-lg border border-gray-300 bg-white">
      <div className="flex items-start gap-2 mb-2">
        {showIndex && (
          <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
            {index}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-800 break-words">{passengersLabel}</div>
          <div className="text-[11px] text-gray-500">{group.files.length} file</div>
        </div>
        {group.files.length > 1 && (
          <button onClick={() => downloadGroup(option, booking, group)}
            className="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold flex-shrink-0">
            📥 Tải tất cả
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        {group.files.map((f, i) => (
          <FileRow key={i} file={f} option={option} booking={booking} group={group} indexInGroup={i} />
        ))}
      </div>
    </div>
  )
}

/**
 * Một dòng file: preview thumbnail (ảnh) / icon (PDF), tên + label,
 * và 2 nút xem trước / tải.
 */
function FileRow({ file, option, booking, group, indexInGroup }) {
  const absUrl = vmbFileUrl(file.url)
  const isImage = isImageFile(file.originalName, file.url)

  return (
    <div className="flex items-center gap-2 p-2 rounded-md bg-gray-50 hover:bg-gray-100 border border-gray-200">
      {/* Thumbnail / icon */}
      <a href={absUrl} target="_blank" rel="noopener noreferrer"
         className="flex-shrink-0"
         title="Mở trong tab mới">
        {isImage ? (
          <img src={absUrl} alt={file.originalName || 'file'}
               className="w-12 h-12 rounded object-cover border border-gray-300 bg-white" />
        ) : (
          <div className="w-12 h-12 rounded border border-gray-300 bg-white flex items-center justify-center text-2xl">
            📄
          </div>
        )}
      </a>

      {/* Meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
          {file.label && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${labelStyle(file.label)}`}>
              {file.label}
            </span>
          )}
          <span className="text-xs text-gray-800 truncate">{file.originalName || file.url.split('/').pop()}</span>
        </div>
        <div className="text-[10px] text-gray-500">Click ảnh/tên để xem trước</div>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-1 flex-shrink-0">
        <a href={absUrl} target="_blank" rel="noopener noreferrer"
          className="px-2 py-1 rounded-md bg-white hover:bg-gray-100 border border-gray-300 text-[11px] font-semibold text-gray-700 flex items-center justify-center gap-1"
          title="Xem trong tab mới">
          👁 <span className="hidden sm:inline">Xem</span>
        </a>
        <button onClick={() => downloadSingle(option, booking, group, file, indexInGroup)}
          className="px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold flex items-center gap-1"
          title="Tải với tên theo quy ước">
          📥 <span className="hidden sm:inline">Tải</span>
        </button>
      </div>
    </div>
  )
}

function labelStyle(label) {
  switch (label) {
    case 'Nháp':          return 'bg-amber-100 text-amber-800'
    case 'Đã phát hành':  return 'bg-emerald-100 text-emerald-800'
    case 'Điều chỉnh':    return 'bg-purple-100 text-purple-800'
    case 'Biên bản đã ký':return 'bg-indigo-100 text-indigo-800'
    default:              return 'bg-gray-100 text-gray-700'
  }
}

function isImageFile(originalName, url) {
  const src = (originalName || url || '').toLowerCase()
  return /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)(\?|#|$)/.test(src)
}

// ══════════════════════════════════════════════════════════════
//  COMPUTE CAPABILITIES
// ══════════════════════════════════════════════════════════════
//
// Với mỗi option, xây map ticket → files[] rồi nhóm ticket có cùng tập file.

function computeCapabilities(booking) {
  return {
    proof:   buildCap(booking, 'proof',   filesForProof),
    face:    buildCap(booking, 'face',    filesForFace),
    invoice: buildCap(booking, 'invoice', filesForInvoice),
  }
}

function buildCap(booking, key, extractor) {
  // Xây perTicket: ticketId → file[] (mỗi file object có {url, originalName, contentType})
  const perTicket = new Map()
  for (const t of (booking.tickets || [])) {
    const files = extractor(booking, t)
    perTicket.set(t.id, files)
  }

  // Nếu tất cả rỗng → không khả dụng
  const anyHasFiles = [...perTicket.values()].some(a => a.length > 0)
  if (!anyHasFiles) return { available: false, groupCount: 0, groups: [] }

  // Nhóm ticket theo dấu vân của tập file
  //   fingerprint = sort urls và join (thứ tự file trong tập không quan trọng)
  const groups = new Map() // fp → { files, tickets:[] }
  for (const t of (booking.tickets || [])) {
    const files = perTicket.get(t.id) || []
    if (files.length === 0) continue // khách không có file thì bỏ ra khỏi mọi nhóm
    const fp = files.map(f => f.url).sort().join('|')
    if (!groups.has(fp)) groups.set(fp, { files, passengers: [] })
    groups.get(fp).passengers.push(t)
  }

  const arr = [...groups.values()]
  return {
    available: arr.length > 0,
    groupCount: arr.length,
    groups: arr,
  }
}

// ── Extractors: trả về file[] cho 1 ticket ────────────────

function filesForProof(booking, ticket) {
  // BookingProof: shared (ticketId=null) + của riêng ticket này
  const all = booking.bookingProofs || []
  return all.filter(p => p.ticketId == null || p.ticketId === ticket.id)
    .map(p => ({ url: p.url, originalName: p.originalName, contentType: p.contentType }))
}

function filesForFace(booking, ticket) {
  // TicketFile theo cờ sharedTicketFace
  if (booking.sharedTicketFace) {
    return booking.bookingFace
      ? [{ url: booking.bookingFace.url, originalName: booking.bookingFace.originalName, contentType: booking.bookingFace.contentType }]
      : []
  }
  return ticket.ticketFace
    ? [{ url: ticket.ticketFace.url, originalName: ticket.ticketFace.originalName, contentType: ticket.ticketFace.contentType }]
    : []
}

/**
 * Xuất trình Hóa đơn — GỘP draft + issued:
 *   Với mỗi invoice áp cho ticket này:
 *     - Nếu status=ADJUSTED → dùng issued + adjustment + record (final)
 *     - Ngược lại nếu có issuedUrl → dùng issuedUrl (ưu tiên)
 *     - Ngược lại nếu có draftUrl → dùng draftUrl (fallback)
 *     - Không có gì → skip invoice này
 *
 * Mỗi file gắn kèm {@code label} để FE hiển thị badge "Nháp / Đã phát hành /
 * Điều chỉnh / Biên bản đã ký" ngay trên preview.
 */
function filesForInvoice(booking, ticket) {
  const invs = booking.invoices || []
  const out = []
  for (const inv of invs) {
    const applies = !inv.ticketIds || inv.ticketIds.length === 0 || inv.ticketIds.includes(ticket.id)
    if (!applies) continue
    if (inv.status === 'ADJUSTED') {
      if (inv.issuedUrl)            out.push({ url: inv.issuedUrl,           originalName: inv.issuedOriginal,           contentType: null, label: 'Đã phát hành' })
      if (inv.adjustmentUrl)        out.push({ url: inv.adjustmentUrl,       originalName: inv.adjustmentOriginal,       contentType: null, label: 'Điều chỉnh' })
      if (inv.adjustmentRecordUrl)  out.push({ url: inv.adjustmentRecordUrl, originalName: inv.adjustmentRecordOriginal, contentType: null, label: 'Biên bản đã ký' })
    } else if (inv.issuedUrl) {
      out.push({ url: inv.issuedUrl, originalName: inv.issuedOriginal, contentType: null, label: 'Đã phát hành' })
    } else if (inv.draftUrl) {
      out.push({ url: inv.draftUrl, originalName: inv.draftOriginal, contentType: null, label: 'Nháp' })
    }
  }
  return out
}

// ══════════════════════════════════════════════════════════════
//  DOWNLOAD
// ══════════════════════════════════════════════════════════════

function typePrefix(option) {
  switch (option) {
    case 'proof':   return 'Booking-info'
    case 'face':    return 'Itinerary'
    case 'invoice': return 'Invoice'
    default: return 'File'
  }
}

/**
 * Tải 1 file duy nhất (không tải cả group). Tên vẫn theo convention:
 *   Group 1 khách → nameBase = passengerName
 *   Group >1 khách → nameBase = bookingCode
 * Thêm suffix theo vị trí trong group để tránh trùng khi group nhiều file cùng loại.
 */
async function downloadSingle(option, booking, group, file, indexInGroup) {
  const prefix = typePrefix(option)
  const time   = fmtTime(new Date())
  const nameBase = group.passengers.length === 1
    ? sanitize(group.passengers[0].passengerName || 'khach')
    : sanitize(booking.bookingCode || `booking-${booking.id}`)
  const suffix = group.files.length > 1 ? `-${indexInGroup + 1}` : ''
  const ext = extOf(file.originalName, file.url) || 'bin'
  const filename = `${prefix}-${nameBase}${suffix}-${time}.${ext}`
  try {
    await triggerDownload(file.url, filename)
  } catch (e) {
    console.error('Tải file thất bại:', file.url, e)
    alert(`Tải file thất bại: ${file.originalName || file.url}`)
  }
}

/**
 * Tải file cho 1 group.
 *   Group 1 khách → tên = <Prefix>-<PassengerName>-<time>.<ext>
 *   Group nhiều khách hoặc toàn bộ booking → tên = <Prefix>-<BookingCode>-<time>.<ext>
 */
async function downloadGroup(option, booking, group) {
  const prefix = typePrefix(option)
  const time   = fmtTime(new Date())
  const nameBase = group.passengers.length === 1
    ? sanitize(group.passengers[0].passengerName || 'khach')
    : sanitize(booking.bookingCode || `booking-${booking.id}`)

  // Với mỗi file trong group, tải xuống với tên custom.
  // Nếu chỉ 1 file → tên gốc dùng ext file. Nếu nhiều file → thêm -1, -2...
  const singleFile = group.files.length === 1
  let i = 0
  for (const f of group.files) {
    i++
    const ext = extOf(f.originalName, f.url) || 'bin'
    const suffix = singleFile ? '' : `-${i}`
    const filename = `${prefix}-${nameBase}${suffix}-${time}.${ext}`
    try {
      await triggerDownload(f.url, filename)
    } catch (e) {
      console.error('Tải file thất bại:', f.url, e)
      alert(`Tải file thất bại: ${f.originalName || f.url}`)
    }
  }
}

async function triggerDownload(url, filename) {
  // ── Fix 2026-09-20 ──────────────────────────────────────────
  // URL từ BE là relative (/vmb-files/xxx). Nếu fetch thẳng, dev-mode sẽ
  // đâm vào Vite (port 5174) → Vite SPA-fallback trả index.html → file rác.
  // vmbFileUrl() prefix BASE (localhost:9009 hay VITE_API_URL) để trỏ đúng BE.
  const absUrl = vmbFileUrl(url)
  const res = await fetch(absUrl, { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  const objUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(objUrl), 1000)
}

// ── Helpers ──────────────────────────────────────────────────

function fmtTime(d) {
  // "hh:mm:ss dd/MM/yy"
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} `
       + `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${String(d.getFullYear()).slice(-2)}`
}

function sanitize(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'file'
}

function extOf(originalName, url) {
  const src = originalName || url || ''
  const m = /\.([a-zA-Z0-9]+)(?:\?|#|$)/.exec(src)
  return m ? m[1].toLowerCase() : ''
}
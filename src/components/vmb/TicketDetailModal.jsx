import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import Badge from '../common/Badge'
import ConfirmModal from '../common/ConfirmModal'
import { listBookings, uploadTicketFile, deleteTicketFile, replaceTicketFile } from '../../services/vmbApi'
import { formatMoney, sumAmounts, toVnd } from '../../lib/money'
import { formatDepart } from '../../lib/airportTz'
import ZoomablePreview from './ZoomablePreview'

/**
 * Modal xem chi tiết 1 vé + quản lý danh sách "mặt vé" (file PDF/ảnh).
 *
 * ── Vì sao load qua bookingId thay vì ticketId? ─────────────
 * BE không có endpoint /tickets/{id} — vé nằm trong Booking. Cách rẻ nhất là
 * load booking rồi tìm ticket theo id. Tránh phải thêm endpoint mới ở BE và
 * đảm bảo có sẵn segments để hiển thị đầy đủ hành trình.
 * → Ta cần biết bookingId từ đâu? Ticket detail được mở từ TicketsTab, ở đó
 * đã có sẵn full data. Tuy nhiên để modal độc lập (có thể dùng ở nơi khác),
 * ta accept ticketId + tìm bookingId qua endpoint list nhẹ tay (rẻ hơn tạo
 * endpoint mới).
 * → Đơn giản hơn nữa: TicketsTab đã có full row, chỉ cần truyền cả booking
 * xuống. Nhưng để giữ interface gọn (chỉ ticketId), ta re-fetch — làm 1
 * lần khi mở, chi phí thấp.
 *
 * File preview dùng ZoomablePreview — có zoom (ảnh + PDF) và rotate,
 * fetch file kèm Bearer token qua axios (endpoint /vmb-files/* protected).
 */
export default function TicketDetailModal({ ticketId, onClose, onDirty }) {
  const [booking, setBooking] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)   // {url, name, type}
  const [confirmDel, setConfirmDel] = useState(null)
  const fileInputRef = useRef(null)

  // Fetch: dùng endpoint /bookings mà truyền q = ticketId? Không — dùng list
  // với filter theo ticketId không hỗ trợ. Cách rẻ: dùng q = ticketId (nếu
  // ticketId có số vé) — không đủ chắc. Ta thêm endpoint mới thì mất thời gian.
  //
  // Giải pháp thực dụng: TicketsTab pass sẵn booking cùng ticketId qua context
  // qua sự kiện tùy chỉnh — nhưng đơn giản nhất là để component tự tìm bằng
  // cách quét TẤT CẢ booking. Số lượng nhỏ (vài trăm), thao tác này chỉ chạy
  // khi mở modal, chi phí có thể chấp nhận.
  //
  // Để tối ưu: TicketsTab truyền cả object ticket + booking vào modal thay vì
  // chỉ id. Chỉ khi thao tác mutate xong mới reload. Dưới đây giả định
  // TicketsTab đang truyền chỉ ticketId — nếu muốn tối ưu, sửa TicketsTab và
  // props signature này.
  //
  // Ở đây ta viết vòng qua endpoint list-1 để tìm booking chứa ticket này.
  const findAndLoad = useCallback(async () => {
    setLoading(true)
    try {
      // Đơn giản: gọi listBookings với q = "" và page 0 size lớn để lấy tất cả
      // (số booking dự kiến < 500). Nếu vượt, chuyển sang endpoint by-ticket
      // riêng ở BE sau.
      const res = await listBookings({ size: 500, page: 0 })
      const list = res.data?.data?.content || []
      for (const b of list) {
        const t = (b.tickets || []).find(x => x.id === ticketId)
        if (t) { setBooking(b); return }
      }
      throw new Error('Không tìm thấy vé')
    } catch (e) {
      toast.error(e?.message || 'Không tải được vé')
      onClose()
    } finally {
      setLoading(false)
    }
  }, [ticketId, onClose])

  useEffect(() => { findAndLoad() }, [findAndLoad])

  const ticket = booking?.tickets?.find(t => t.id === ticketId)

  const handleUpload = async (files) => {
    if (!files?.length) return
    setBusy(true)
    try {
      for (const f of files) {
        await uploadTicketFile(ticketId, f)
      }
      toast.success(`Đã tải ${files.length} file`)
      await findAndLoad()
      onDirty?.()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Tải file thất bại')
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <>
      <Modal
        open
        onClose={busy ? undefined : onClose}
        title="Chi tiết vé"
        size="lg"
        closeOnBackdrop={!busy}
      >
        {loading ? (
          <div className="py-10 text-center text-gray-400 text-sm">Đang tải…</div>
        ) : !ticket ? (
          <div className="py-10 text-center text-gray-400 text-sm">Không tìm thấy vé.</div>
        ) : (
          <>
            {/* Thông tin ngắn gọn */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <InfoBox label="Khách hàng" value={ticket.passengerName || '—'} />
              <InfoBox label="Số vé" value={ticket.ticketNumber || 'chưa có'} mono />
              <InfoBox label="Booking" value={booking.bookingCode || '—'} mono />
              <InfoBox label="Loại / Hãng" value={`${kindLabel(booking.kind)} · ${booking.airlineCode || '?'}`} />
            </div>

            {/* Hành trình */}
            <div className="mb-4">
              <div className="text-xs font-semibold text-gray-600 mb-1">Hành trình</div>
              <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 space-y-1">
                {(booking.segments || []).length === 0 ? (
                  <span className="text-sm text-gray-400">Chưa có chặng bay</span>
                ) : (booking.segments || []).map((s, i) => (
                  <div key={i} className="text-sm flex items-center gap-2">
                    <span className="font-bold text-gray-900">{s.fromCode}</span>
                    <span className="text-gray-400">→</span>
                    <span className="font-bold text-gray-900">{s.toCode}</span>
                    <span className="text-gray-400 mx-1">·</span>
                    <span className="tabular-nums text-gray-700">
                      {formatDepart(s.departLocalMs, s.fromCode)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Giá tiền */}
            <div className="mb-4">
              <div className="text-xs font-semibold text-gray-600 mb-1">Giá tiền</div>
              <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                <PriceRow label="Giá gốc"                      value={ticket.basePrice}                    currency={booking.currency} />
                <PriceRow label="Phí thu hộ"                    value={ticket.collectionFee}                currency={booking.currency} />
                <PriceRow label="= Đã có phí thu hộ"            value={sumAmounts(ticket.basePrice, ticket.collectionFee)}  currency={booking.currency} bold />
                <PriceRow label="Phí dịch vụ / hoàn / đổi"      value={ticket.serviceFee}                   currency={booking.currency} />
                <PriceRow label="= Thành tiền vé"               value={sumAmounts(ticket.basePrice, ticket.collectionFee, ticket.serviceFee)} currency={booking.currency} bold />
                <PriceRow label="Phí xuất vé"                   value={ticket.issuanceFee}                  currency={booking.currency} />
                <PriceRow label="= Giá bán cho khách"           value={sumAmounts(ticket.basePrice, ticket.collectionFee, ticket.serviceFee, ticket.issuanceFee)} currency={booking.currency} bold highlight />
                {booking.currency === 'USD' && (
                  <div className="mt-2 pt-2 border-t border-gray-200 flex justify-between text-xs text-gray-500">
                    <span>Quy đổi VND (1 USD = {booking.exchangeRate || '—'})</span>
                    <span className="font-mono tabular-nums font-bold text-gray-900">
                      {formatMoney(toVnd(sumAmounts(ticket.basePrice, ticket.collectionFee, ticket.serviceFee, ticket.issuanceFee), booking.currency, booking.exchangeRate), 'VND')}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Trạng thái */}
            <div className="mb-4 flex items-center gap-2">
              {ticket.paidStatus === 'PAID'
                ? <Badge color="green" dot>Đã thanh toán</Badge>
                : <Badge color="gray" dot>Chưa thanh toán</Badge>}
              <span className="text-xs text-gray-500">
                {(ticket.invoices?.length || 0)} hóa đơn · {(ticket.files?.length || 0)} mặt vé
              </span>
            </div>

            {/* Note */}
            {ticket.note && (
              <div className="mb-4">
                <div className="text-xs font-semibold text-gray-600 mb-1">Ghi chú</div>
                <div className="p-2 rounded-md bg-yellow-50 border border-yellow-200 text-xs text-gray-800">
                  {ticket.note}
                </div>
              </div>
            )}

            {/* Mặt vé */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-gray-600">
                  Mặt vé ({ticket.files?.length || 0})
                </div>
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-50">
                  + Thêm file
                </button>
                <input
                  ref={fileInputRef} type="file" multiple hidden
                  accept="image/*,application/pdf"
                  onChange={e => handleUpload(Array.from(e.target.files || []))}
                />
              </div>
              {(ticket.files?.length || 0) === 0 ? (
                <div className="p-4 rounded-lg border-2 border-dashed border-gray-200 text-center text-xs text-gray-400">
                  Chưa có mặt vé — tải lên PDF hoặc ảnh
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {ticket.files.map(f => (
                    <FileCard key={f.id} file={f}
                      onPreview={() => setPreview({ path: f.url, name: f.originalName })}
                      onReplace={async (newFile) => {
                        setBusy(true)
                        try {
                          await replaceTicketFile(f.id, newFile)
                          toast.success('Đã thay file')
                          await findAndLoad()
                          onDirty?.()
                        } catch (e) {
                          toast.error(e?.response?.data?.message || 'Thay file thất bại')
                        } finally { setBusy(false) }
                      }}
                      onDelete={() => setConfirmDel(f)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </Modal>

      {preview && (
        <ZoomablePreview
          filePath={preview.path}
          fileName={preview.name}
          title={preview.name}
          onClose={() => setPreview(null)}
        />
      )}

      {confirmDel && (
        <ConfirmModal
          open
          title="Xóa mặt vé"
          message={`Xóa file "${confirmDel.originalName}"?`}
          confirmLabel="Xóa"
          danger
          onConfirm={async () => {
            try {
              await deleteTicketFile(confirmDel.id)
              toast.success('Đã xóa')
              setConfirmDel(null)
              await findAndLoad()
              onDirty?.()
            } catch (e) {
              toast.error(e?.response?.data?.message || 'Xóa thất bại')
            }
          }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </>
  )
}

// ── Helpers ─────────────────────────────────────────────

function InfoBox({ label, value, mono }) {
  return (
    <div className="p-2 rounded-md bg-gray-50 border border-gray-100">
      <div className="text-[10px] font-semibold text-gray-500 uppercase mb-0.5">{label}</div>
      <div className={`text-sm font-medium text-gray-900 truncate ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}

function PriceRow({ label, value, currency, bold, highlight }) {
  const cls = highlight
    ? 'text-blue-700 font-bold'
    : bold ? 'text-gray-900 font-semibold' : 'text-gray-700'
  return (
    <div className={`flex justify-between text-sm py-0.5 ${highlight ? 'mt-1 pt-1 border-t border-gray-200' : ''}`}>
      <span className={bold ? 'text-gray-700' : 'text-gray-500'}>{label}</span>
      <span className={`font-mono tabular-nums ${cls}`}>{formatMoney(value, currency)}</span>
    </div>
  )
}

function kindLabel(k) {
  return { NEW: 'Mua mới', EXCHANGE: 'Đổi', REFUND: 'Hoàn', SERVICE: 'Dịch vụ' }[k] || k
}

/**
 * Card 1 mặt vé: preview (click nội dung) + Thay (input file ẩn) + Xóa.
 * Nút Thay & Xóa hiện khi hover thẻ, giấu khi bình thường để card gọn.
 */
function FileCard({ file: f, onPreview, onReplace, onDelete }) {
  const inputRef = useRef(null)
  return (
    <div className="relative group p-2 rounded-lg border border-gray-200 bg-white hover:border-blue-300">
      <button type="button" onClick={onPreview} className="w-full text-left">
        <div className="text-2xl mb-1">
          {(f.contentType || '').startsWith('image/') ? '🖼️' : '📄'}
        </div>
        <div className="text-[11px] font-medium text-gray-900 truncate">{f.originalName}</div>
        <div className="text-[10px] text-gray-400">{formatSize(f.sizeBytes)}</div>
      </button>
      <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition">
        <button type="button" onClick={() => inputRef.current?.click()}
          title="Thay file mới"
          className="w-6 h-6 rounded-md bg-white/90 text-blue-600 hover:bg-blue-50 flex items-center justify-center text-xs shadow-sm">
          ↻
        </button>
        <button type="button" onClick={onDelete}
          title="Xóa"
          className="w-6 h-6 rounded-md bg-white/90 text-rose-600 hover:bg-rose-50 flex items-center justify-center text-sm shadow-sm">
          ×
        </button>
      </div>
      <input ref={inputRef} type="file" hidden accept="image/*,application/pdf"
        onChange={e => {
          const nf = e.target.files?.[0]
          if (nf) onReplace(nf)
          e.target.value = ''
        }} />
    </div>
  )
}

function formatSize(n) {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

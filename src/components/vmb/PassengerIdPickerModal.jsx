import { useMemo, useState } from 'react'
import Modal from '../common/Modal'
import { formatDateVn } from '../../lib/expiry'
import ZoomablePreview from './ZoomablePreview'   // 2026-11-19: preview CCCD/PP (zoom + rotate)

/**
 * ── 2026-10-16 ─────────────────────────────────────────────
 * PassengerIdPickerModal — modal GỌN để xác nhận chọn khách + chọn giấy tờ
 * (CCCD/HC) khi gán khách vào vé booking. KHÔNG preview ảnh — chỉ hiển thị
 * các field cơ bản (họ tên, số giấy tờ, ngày hết hạn) + warning expiry < 6
 * tháng tính từ chặng khởi hành đầu tiên.
 *
 * ── Auto-pick ──────────────────────────────────────────────
 * - Hành trình quốc tế                               → mặc định PP
 * - Quốc nội + khách VN (nationality = VNM/VN/null)  → chọn (nếu có cả 2),
 *                                                       hoặc cái đang có.
 * - Quốc nội + khách nước ngoài                      → mặc định PP
 * - Chỉ có 1 giấy tờ → mặc định cái đó
 *
 * Props:
 *   passenger            — object từ /passengers/{id} (có .documents)
 *   isInternational      — boolean (từ segments)
 *   earliestDepartMs     — epoch ms chặng đầu
 *   onConfirm({type, doc})
 *   onCancel()
 */
export default function PassengerIdPickerModal({
  passenger, isInternational, earliestDepartMs,
  onConfirm, onCancel,
}) {
  const docs = passenger?.documents || []
  const cccdDoc = docs.find(d => d.type === 'CCCD') || null
  const ppDoc = docs.find(d => d.type === 'PASSPORT') || null
  const hasCccd = !!cccdDoc
  const hasPp = !!ppDoc

  // Nationality (lấy từ PP nếu có, không có coi như VN)
  const nationality = (ppDoc?.nationality || '').toUpperCase()
  const isForeign = nationality && !['VNM', 'VN'].includes(nationality)

  // Auto-pick default
  const defaultPick = useMemo(() => {
    if (!hasCccd && !hasPp) return null
    if (!hasCccd) return 'pp'
    if (!hasPp) return 'cccd'
    if (isInternational) return 'pp'
    if (isForeign) return 'pp'
    return null // Quốc nội + VN + có cả 2 → ép user chọn
  }, [hasCccd, hasPp, isInternational, isForeign])

  const [pick, setPick] = useState(defaultPick)

  // ── Không có giấy tờ nào ──────────────────────────────────
  //   2026-11-11: Trước đây chỉ có nút Hủy → không thể gán khách chưa có giấy
  //   tờ vào vé. Khi backfill dữ liệu cũ (khách chỉ có mỗi tên) thì cần gán
  //   được, nên thêm nút "Vẫn chọn khách này". Vé lưu passengerId bình thường,
  //   passengerDocumentType = null (nghĩa là chưa gắn loại giấy tờ nào).
  if (!hasCccd && !hasPp) {
    return (
      <Modal open onClose={onCancel} title={`Xác nhận chọn — ${passenger?.fullName || ''}`}
        size="sm" closeOnBackdrop={false}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={onCancel}
              className="px-4 py-2 text-sm rounded-lg bg-gray-200 hover:bg-gray-300">Hủy</button>
            <button onClick={() => onConfirm({ type: null, doc: null })}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700">
              Vẫn chọn khách này
            </button>
          </div>
        }>
        <div className="text-center py-4">
          <div className="text-4xl mb-2">📭</div>
          <div className="text-sm text-rose-600 font-semibold">
            Khách này chưa có CCCD hoặc Hộ chiếu.
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Vào trang "Thông tin khách" để bổ sung giấy tờ, hoặc bấm
            <b> Vẫn chọn khách này</b> để gán vào vé mà chưa cần giấy tờ.
          </div>
        </div>
      </Modal>
    )
  }

  // Chọn 1 trong 2
  if (!pick) {
    return (
      <Modal open onClose={onCancel} title={`Chọn giấy tờ — ${passenger?.fullName}`}
        size="sm" closeOnBackdrop={false}
        footer={
          <div className="flex justify-end">
            <button onClick={onCancel}
              className="px-4 py-2 text-sm rounded-lg bg-gray-200 hover:bg-gray-300">Hủy</button>
          </div>
        }>
        <div className="py-2">
          <div className="text-xs text-gray-600 mb-3 text-center">
            Chọn giấy tờ muốn gán cho vé:
          </div>
          <div className="grid grid-cols-2 gap-3">
            <IdChoiceButton icon="🪪" label="CCCD" hint={cccdDoc.docNumber}
              onClick={() => setPick('cccd')} />
            <IdChoiceButton icon="📘" label="Hộ chiếu" hint={ppDoc.docNumber}
              onClick={() => setPick('pp')} />
          </div>
          {/* 2026-11-19: tùy chọn không gắn giấy tờ nào. */}
          <button type="button" onClick={() => onConfirm({ type: null, doc: null })}
            className="mt-3 w-full px-4 py-2 text-sm rounded-lg border border-gray-300 bg-white
              text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition">
            Không gắn giấy tờ — vẫn chọn khách này
          </button>
        </div>
      </Modal>
    )
  }

  const doc = pick === 'cccd' ? cccdDoc : ppDoc
  const docLabel = pick === 'cccd' ? 'CCCD' : 'Hộ chiếu'
  const hasFile = !!doc?.fileUrl   // 2026-11-19: có ảnh/PDF để preview không
  const expiresTooSoon = earliestDepartMs && doc?.expiryDate
    ? isWithin6MonthsBeforeDepart(doc.expiryDate, earliestDepartMs)
    : false

  return (
    // 2026-11-19: mở rộng sang 2 panel — trái preview (zoom/rotate), phải thông tin.
    <Modal open onClose={onCancel} title={`${docLabel} — ${passenger?.fullName}`}
      size="xl" closeOnBackdrop={false}
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          {hasCccd && hasPp ? (
            <div className="flex gap-1 bg-gray-100 p-1 rounded-md">
              <TabBtn active={pick === 'cccd'} onClick={() => setPick('cccd')}>🪪 CCCD</TabBtn>
              <TabBtn active={pick === 'pp'} onClick={() => setPick('pp')}>📘 HC</TabBtn>
            </div>
          ) : <div />}
          <div className="flex items-center gap-2">
            {/* 2026-11-19: không gắn giấy tờ nào, vẫn chọn khách. */}
            <button onClick={() => onConfirm({ type: null, doc: null })}
              className="px-3 py-1.5 text-sm rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100">
              Không gắn giấy tờ
            </button>
            <button onClick={onCancel}
              className="px-3 py-1.5 text-sm rounded-lg bg-gray-200 hover:bg-gray-300">Hủy</button>
            <button
              onClick={() => onConfirm({ type: pick === 'cccd' ? 'CCCD' : 'PASSPORT', doc })}
              disabled={expiresTooSoon}
              className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
              Xác nhận chọn
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col lg:grid lg:grid-cols-5 gap-4 lg:h-full lg:min-h-0">
        {/* Panel trái: preview giấy tờ — zoom + rotate như các preview khác */}
        <div className="lg:col-span-3 min-h-[45vh] lg:min-h-0 lg:h-full">
          <div className="rounded-xl overflow-hidden border border-gray-200 bg-gray-100 w-full h-full min-h-[45vh]">
            {hasFile ? (
              <ZoomablePreview
                filePath={doc.fileUrl}
                fileName={doc.fileOriginal}
                title={`${docLabel} — ${passenger?.fullName || ''}`}
                embedded
              />
            ) : (
              <div className="w-full h-full min-h-[45vh] flex flex-col items-center justify-center text-gray-400">
                <div className="text-6xl mb-2">📭</div>
                <div className="text-sm">Chưa có ảnh {docLabel}</div>
              </div>
            )}
          </div>
        </div>

        {/* Panel phải: thông tin */}
        <div className="lg:col-span-2 space-y-2 py-1 lg:h-full lg:overflow-y-auto lg:pr-1">
          <InfoRow label="Họ tên" value={passenger?.fullName} />
          <InfoRow label={pick === 'cccd' ? 'Số CCCD' : 'Số hộ chiếu'} value={doc?.docNumber} mono />
          {pick === 'pp' && doc?.nationality && (
            <InfoRow label="Quốc tịch (ISO-3)" value={doc.nationality} mono />
          )}
          <InfoRow label="Ngày sinh" value={formatDateVn(passenger?.dob) || '—'} mono />
          {doc?.issueDate && (
            <InfoRow label="Ngày cấp" value={formatDateVn(doc.issueDate)} mono />
          )}
          <InfoRow label="Ngày hết hạn"
            value={formatDateVn(doc?.expiryDate) || '—'}
            mono
            highlight={expiresTooSoon ? 'danger' : null}
          />
          {expiresTooSoon && (
            <div className="mt-2 p-2 rounded-md bg-rose-50 border border-rose-200 text-xs text-rose-700">
              ⚠ <b>Giấy tờ hết hạn &lt; 6 tháng</b> trước ngày khởi hành chặng đầu tiên —
              vui lòng bỏ khách này khỏi vé.
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function TabBtn({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-2.5 py-1 text-xs font-semibold rounded transition
        ${active ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
      {children}
    </button>
  )
}

function IdChoiceButton({ label, icon, hint, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="p-4 rounded-xl border-2 border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 hover:border-blue-400 transition text-center">
      <div className="text-3xl mb-1">{icon}</div>
      <div className="font-bold text-sm">{label}</div>
      {hint && <div className="text-[10px] text-blue-600/80 mt-0.5 font-mono truncate">{hint}</div>}
    </button>
  )
}

/**
 * ── 2026-11-11: màu theo LIGHT mode ──
 *   Trước đây dùng text-slate-200 / text-rose-200 (tông sáng, vốn cho nền
 *   tối) nên ở giao diện sáng chữ gần như chìm vào nền. Giờ dùng chữ đậm
 *   trên nền nhạt; dark mode đã được darkmode.css remap sẵn các class này.
 */
function InfoRow({ label, value, mono, highlight }) {
  const cls = highlight === 'danger'
    ? 'bg-rose-50 border-rose-200 text-rose-700'
    : 'bg-slate-50 border-gray-200 text-slate-800'
  return (
    <div className={`p-2 rounded-md border ${cls}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</div>
      <div className={`text-sm font-semibold ${mono ? 'font-mono' : ''}`}>{value || '—'}</div>
    </div>
  )
}

/**
 * Check expiry < 6 tháng trước ngày khởi hành đầu tiên.
 * Return TRUE nếu (expiryMs - departMs) < 183 ngày.
 */
function isWithin6MonthsBeforeDepart(expiryDateStr, departMs) {
  if (!expiryDateStr || !departMs) return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(expiryDateStr).trim())
  if (!m) return false
  const [, y, mo, d] = m
  const expiry = new Date(Number(y), Number(mo) - 1, Number(d))
  if (isNaN(expiry.getTime())) return false
  const SIX_MONTHS_MS = 183 * 86400 * 1000
  return (expiry.getTime() - departMs) < SIX_MONTHS_MS
}
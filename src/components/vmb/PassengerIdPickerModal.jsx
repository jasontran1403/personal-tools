import { useMemo, useState } from 'react'
import Modal from '../common/Modal'
import { formatDateVn } from '../../lib/expiry'

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

  // Nếu không có giấy tờ nào
  if (!hasCccd && !hasPp) {
    return (
      <Modal open onClose={onCancel} title={`Xác nhận chọn — ${passenger?.fullName || ''}`}
        size="sm" closeOnBackdrop={false}
        footer={
          <div className="flex justify-end">
            <button onClick={onCancel}
              className="px-4 py-2 text-sm rounded-lg bg-gray-200 hover:bg-gray-300">Hủy</button>
          </div>
        }>
        <div className="text-center py-4">
          <div className="text-4xl mb-2">📭</div>
          <div className="text-sm text-rose-600 font-semibold">
            Khách này chưa có CCCD hoặc Hộ chiếu.
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Vào trang "Thông tin khách" để bổ sung giấy tờ.
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
            Hành trình quốc nội — chọn giấy tờ muốn gán cho vé:
          </div>
          <div className="grid grid-cols-2 gap-3">
            <IdChoiceButton icon="🪪" label="CCCD" hint={cccdDoc.docNumber}
              onClick={() => setPick('cccd')} />
            <IdChoiceButton icon="📘" label="Hộ chiếu" hint={ppDoc.docNumber}
              onClick={() => setPick('pp')} />
          </div>
        </div>
      </Modal>
    )
  }

  const doc = pick === 'cccd' ? cccdDoc : ppDoc
  const docLabel = pick === 'cccd' ? 'CCCD' : 'Hộ chiếu'
  const expiresTooSoon = earliestDepartMs && doc?.expiryDate
    ? isWithin6MonthsBeforeDepart(doc.expiryDate, earliestDepartMs)
    : false

  return (
    <Modal open onClose={onCancel} title={`${docLabel} — ${passenger?.fullName}`}
      size="sm" closeOnBackdrop={false}
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          {hasCccd && hasPp ? (
            <div className="flex gap-1 bg-gray-100 p-1 rounded-md">
              <TabBtn active={pick === 'cccd'} onClick={() => setPick('cccd')}>🪪 CCCD</TabBtn>
              <TabBtn active={pick === 'pp'} onClick={() => setPick('pp')}>📘 HC</TabBtn>
            </div>
          ) : <div />}
          <div className="flex gap-2">
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
      <div className="space-y-2 py-1">
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
          <div className="mt-2 p-2 rounded-md bg-rose-500/10 border border-rose-400/50 text-xs text-rose-300">
            ⚠ <b>Giấy tờ hết hạn &lt; 6 tháng</b> trước ngày khởi hành chặng đầu tiên —
            vui lòng bỏ khách này khỏi vé.
          </div>
        )}
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

function InfoRow({ label, value, mono, highlight }) {
  const cls = highlight === 'danger'
    ? 'bg-rose-500/10 border-rose-400/40 text-rose-200'
    : 'bg-slate-500/10 border-slate-400/20 text-slate-200'
  return (
    <div className={`p-2 rounded-md border ${cls}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60">{label}</div>
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

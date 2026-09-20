import { useState } from 'react'
import Modal from '../common/Modal'
import ZoomablePreview from './ZoomablePreview'
import CopyableField from './CopyableField'
import { formatDateVn } from '../../lib/expiry'

/**
 * Xuất trình giấy tờ hành khách — dùng cho quầy check-in / kiểm tra nhanh.
 *
 * ── Layout mới (2026-09-15) ───────────────────────────────
 * Panel trái: preview ảnh/PDF (ZoomablePreview embedded).
 * Panel phải: các field click-to-copy (số CCCD/PP, họ tên, giới tính, ngày sinh,
 *              ngày cấp, ngày hết hạn + badge "còn lại", + quốc tịch cho PP).
 *
 * ── Thứ tự field (2026-09-15) ─────────────────────────────
 * Ngày cấp TRƯỚC ngày hết hạn (đúng thứ tự thời gian).
 * Cạnh Ngày hết hạn có badge hiển thị thời gian còn lại dạng
 * "x năm y tháng z ngày", tô màu theo ngưỡng:
 *   < 6 tháng  → đỏ
 *   < 9 tháng  → cam
 *   còn lại    → xanh
 *
 * ── Data source ──────────────────────────────────────────
 * passenger.documents (list) — mỗi phần tử là { type, docNumber, nationality,
 * issueDate, expiryDate, fileUrl, fileOriginal }. Nhân thân (fullName, gender,
 * dob) đọc trực tiếp từ passenger.
 */
export default function IdPresentationModal({ passenger, onClose }) {
  const docs = passenger?.documents || []
  const cccdDoc = docs.find(d => d.type === 'CCCD') || null
  const ppDoc = docs.find(d => d.type === 'PASSPORT') || null
  const hasCccd = !!cccdDoc
  const hasPp = !!ppDoc

  const [pick, setPick] = useState(() => {
    if (hasCccd && !hasPp) return 'cccd'
    if (hasPp && !hasCccd) return 'pp'
    return null   // yêu cầu chọn
  })

  // ── Không có giấy tờ nào ─────────────────────────────────
  if (!hasCccd && !hasPp) {
    return (
      <Modal open onClose={onClose} title="Xuất trình giấy tờ" size="sm" closeOnBackdrop
        footer={
          <div className="flex justify-end">
            <button onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-gray-200 hover:bg-gray-300">Đóng</button>
          </div>
        }>
        <div className="text-center py-6">
          <div className="text-5xl mb-3">📭</div>
          <div className="text-sm text-gray-600">
            Khách <b>{passenger?.fullName}</b> chưa có ảnh CCCD hoặc Hộ chiếu.
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Vào modal sửa hành khách để tải file lên.
          </div>
        </div>
      </Modal>
    )
  }

  // ── Có cả 2 nhưng chưa chọn → hỏi ────────────────────────
  if (!pick) {
    return (
      <Modal open onClose={onClose} title="Chọn giấy tờ" size="sm" closeOnBackdrop>
        <div className="text-center py-2">
          <div className="text-sm text-gray-700 mb-4">
            Xuất trình giấy tờ của <b>{passenger?.fullName}</b>:
          </div>
          <div className="grid grid-cols-2 gap-3">
            <IdChoiceButton
              label="CCCD" icon="🪪" disabled={!hasCccd}
              onClick={() => setPick('cccd')}
              hint={hasCccd ? 'Có sẵn' : 'Chưa upload'}
            />
            <IdChoiceButton
              label="Hộ chiếu" icon="📘" disabled={!hasPp}
              onClick={() => setPick('pp')}
              hint={hasPp ? 'Có sẵn' : 'Chưa upload'}
            />
          </div>
        </div>
      </Modal>
    )
  }

  // ── Panel layout ─────────────────────────────────────────
  const doc = pick === 'cccd' ? cccdDoc : ppDoc
  const docLabel = pick === 'cccd' ? 'CCCD' : 'Hộ chiếu'
  const hasFile = !!doc?.fileUrl

  // Thời gian còn lại tính từ hôm nay đến expiryDate
  const remaining = remainingTime(doc?.expiryDate)

  return (
    <Modal open onClose={onClose} title={`${docLabel} — ${passenger?.fullName || ''}`} size="xl" closeOnBackdrop
      footer={
        <div className="flex justify-between items-center w-full">
          {hasCccd && hasPp ? (
            <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
              <TabBtn active={pick === 'cccd'} onClick={() => setPick('cccd')}>🪪 CCCD</TabBtn>
              <TabBtn active={pick === 'pp'} onClick={() => setPick('pp')}>📘 Hộ chiếu</TabBtn>
            </div>
          ) : <div />}
          <button onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg bg-gray-200 hover:bg-gray-300">Đóng</button>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Panel trái: preview */}
        <div className="lg:col-span-3">
          <div className="rounded-xl overflow-hidden border border-gray-200 bg-gray-100" style={{ height: '60vh' }}>
            {hasFile ? (
              <ZoomablePreview
                filePath={doc.fileUrl}
                fileName={doc.fileOriginal}
                title={docLabel}
                embedded
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                <div className="text-6xl mb-2">📭</div>
                <div className="text-sm">Chưa có ảnh {docLabel}</div>
              </div>
            )}
          </div>
        </div>

        {/* Panel phải: các field click-to-copy */}
        <div className="lg:col-span-2 space-y-2">
          <div className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">
            Thông tin — bấm để copy
          </div>

          <CopyableField label="Họ tên" value={passenger?.fullName} />

          {pick === 'cccd' ? (
            <>
              <CopyableField label="Số CCCD" value={doc?.docNumber} mono />
              <CopyableField label="Giới tính" value={genderLabel(passenger?.gender)}
                copyLabel="Đã copy giới tính" />
              <CopyableField label="Ngày sinh" value={passenger?.dob}
                display={formatDateVn(passenger?.dob) || '—'} mono />

              {/* Ngày cấp TRƯỚC ngày hết hạn */}
              {doc?.issueDate && (
                <CopyableField label="Ngày cấp" value={doc?.issueDate}
                  display={formatDateVn(doc?.issueDate)} mono />
              )}

              {/* Ngày hết hạn + badge còn lại */}
              <CopyableField label="Ngày hết hạn" value={doc?.expiryDate}
                display={formatDateVn(doc?.expiryDate) || '—'} mono
                suffix={remaining && <ExpiryBadge remaining={remaining} />} />
            </>
          ) : (
            <>
              <CopyableField label="Giới tính" value={genderLabel(passenger?.gender)}
                copyLabel="Đã copy giới tính" />
              <CopyableField label="Mã quốc tịch (ISO-3)" value={doc?.nationality} mono />
              <CopyableField label="Số hộ chiếu" value={doc?.docNumber} mono />
              <CopyableField label="Ngày sinh" value={passenger?.dob}
                display={formatDateVn(passenger?.dob) || '—'} mono />

              {/* Ngày cấp TRƯỚC ngày hết hạn */}
              {doc?.issueDate && (
                <CopyableField label="Ngày cấp" value={doc?.issueDate}
                  display={formatDateVn(doc?.issueDate)} mono />
              )}

              {/* Ngày hết hạn + badge còn lại */}
              <CopyableField label="Ngày hết hạn" value={doc?.expiryDate}
                display={formatDateVn(doc?.expiryDate) || '—'} mono
                suffix={remaining && <ExpiryBadge remaining={remaining} />} />
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function TabBtn({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition
        ${active ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
      {children}
    </button>
  )
}

function IdChoiceButton({ label, icon, disabled, onClick, hint }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`p-5 rounded-xl border-2 transition text-center
        ${disabled
          ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
          : 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 hover:border-blue-400'}`}>
      <div className="text-4xl mb-1">{icon}</div>
      <div className="font-bold text-sm">{label}</div>
      <div className="text-[10px] opacity-70 mt-0.5">{hint}</div>
    </button>
  )
}

function genderLabel(g) {
  return { MALE: 'Nam', FEMALE: 'Nữ', OTHER: 'Khác' }[g] || ''
}

/* ─────────────────────────────────────────────────────────
 * Badge "còn lại" — hiển thị thời gian từ hôm nay đến expiryDate.
 * Màu:
 *   - Hết hạn hoặc <= 0 ngày       → đỏ đậm
 *   - Còn < 6 tháng (~183 ngày)    → đỏ
 *   - Còn < 9 tháng (~274 ngày)    → cam
 *   - Còn >= 9 tháng               → xanh
 * ───────────────────────────────────────────────────────── */
function ExpiryBadge({ remaining }) {
  const cls = expiryBadgeClass(remaining)
  return (
    <span
      title="Thời gian còn lại đến ngày hết hạn"
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${cls}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {remaining.text}
    </span>
  )
}

function expiryBadgeClass(remaining) {
  if (remaining.expired) return 'bg-rose-100 text-rose-700 ring-1 ring-rose-200'
  if (remaining.days < 183) return 'bg-rose-100 text-rose-700 ring-1 ring-rose-200'
  if (remaining.days < 274) return 'bg-amber-100 text-amber-700 ring-1 ring-amber-200'
  return 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200'
}

/* ─────────────────────────────────────────────────────────
 * Tính khoảng thời gian từ hôm nay (00:00 local) đến expiryDate
 * (chuỗi "YYYY-MM-DD"). Trả về:
 *   { days, years, months, remDays, text, expired }
 * hoặc null nếu input không hợp lệ.
 *
 * Format text: "x năm y tháng z ngày" — bỏ đơn vị = 0.
 *   - Nếu 0 năm, 0 tháng, còn z ngày → "z ngày"
 *   - Nếu quá hạn → "Quá hạn x ngày"
 * ───────────────────────────────────────────────────────── */
function remainingTime(expiryDateStr) {
  if (!expiryDateStr) return null

  const expiry = parseYmd(expiryDateStr)
  if (!expiry) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const diffMs = expiry.getTime() - today.getTime()
  const expired = diffMs < 0
  const totalDays = Math.floor(Math.abs(diffMs) / 86400000)

  const [from, to] = expired ? [expiry, today] : [today, expiry]
  const { years, months, days } = diffYmd(from, to)

  const text = expired
    ? 'Đã hết hạn'
    : `Còn ${formatYmd(years, months, days)}`

  return { days: totalDays, years, months, remDays: days, text, expired }
}

function diffYmd(from, to) {
  let years = to.getFullYear() - from.getFullYear()
  let months = to.getMonth() - from.getMonth()
  let days = to.getDate() - from.getDate()

  if (days < 0) {
    months -= 1
    const prevMonth = new Date(to.getFullYear(), to.getMonth(), 0)
    days += prevMonth.getDate()
  }
  if (months < 0) {
    years -= 1
    months += 12
  }
  return { years, months, days }
}

function formatYmd(y, m, d) {
  const parts = []
  if (y > 0) parts.push(`${y} năm`)
  if (m > 0) parts.push(`${m} tháng`)
  if (d > 0 || parts.length === 0) parts.push(`${d} ngày`)
  return parts.join(' ')
}

function parseYmd(s) {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim())
  if (!m) return null
  const [, y, mo, d] = m
  const dt = new Date(Number(y), Number(mo) - 1, Number(d))
  return isNaN(dt.getTime()) ? null : dt
}
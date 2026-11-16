import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import CompanySearchSelect, { companyOptions } from '../common/CompanySearchSelect'
import { getPassenger, listPassengers, createPassenger, upsertPassengerDocument } from '../../services/vmbApi'

/**
 * ── CopyPassengerModal — 2026-11-11 ────────────────────────────────────
 * Sao chép một hành khách sang công ty khác (hoặc sang mục Khách lẻ).
 *
 * Vì sao cần: cùng một người có thể bay cho nhiều công ty. Hệ thống lưu mỗi
 * (người × công ty) thành một bản ghi riêng, nên thay vì gõ lại thông tin thì
 * copy sang cho nhanh.
 *
 * ── Lọc công ty đã có ──────────────────────────────────────────────────
 * Nhận diện "cùng một người" bằng SỐ CCCD / SỐ HỘ CHIẾU, không dùng tên (tên
 * dễ trùng và dễ sai chính tả). Các công ty đã có người mang đúng số giấy tờ
 * đó sẽ không hiện trong danh sách chọn.
 *
 * Khách chưa có giấy tờ nào thì không lọc được — modal báo rõ và vẫn cho copy,
 * chỉ loại trừ công ty hiện tại của khách.
 *
 * ── Chép những gì ──────────────────────────────────────────────────────
 * Họ tên, ngày sinh, giới tính, và cả CCCD / hộ chiếu kèm ảnh giấy tờ (tải
 * ảnh về rồi upload sang bản ghi mới). Nếu tải ảnh lỗi thì vẫn chép phần số
 * và ngày, chỉ thiếu ảnh — modal sẽ báo.
 * KHÔNG chép thẻ thành viên và người giới thiệu.
 *
 * Props:
 *   passenger  — hành khách nguồn (cần .id)
 *   companies  — danh sách công ty (từ listCompanies)
 *   onClose()
 *   onDone()   — gọi sau khi copy xong để màn hình cha load lại
 */
export default function CopyPassengerModal({ passenger, companies, onClose, onDone }) {
  const [full, setFull]       = useState(null)   // bản đầy đủ (có documents)
  const [usedIds, setUsedIds] = useState([])     // companyId đã có người này
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [targetId, setTargetId] = useState(null)

  // Tải thông tin đầy đủ + dò các công ty đã có người mang số giấy tờ này.
  useEffect(() => {
    let cancel = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await getPassenger(passenger.id)
        const p = res.data?.data
        if (cancel) return
        setFull(p)

        const numbers = (p?.documents || [])
          .map(d => (d.docNumber || '').trim())
          .filter(Boolean)
        const ids = new Set()
        for (const num of numbers) {
          try {
            const r = await listPassengers({ q: num, size: 200 })
            for (const other of (r.data?.data?.content || [])) {
              // BE search theo LIKE nên phải đối chiếu lại cho khớp tuyệt đối.
              const hit = (other.documents || []).some(
                d => (d.docNumber || '').trim().toLowerCase() === num.toLowerCase())
              if (hit && other.companyId != null) ids.add(other.companyId)
            }
          } catch { /* bỏ qua, coi như không tìm thấy */ }
        }
        if (p?.companyId != null) ids.add(p.companyId)
        if (!cancel) setUsedIds([...ids])
      } catch (e) {
        if (!cancel) toast.error(e?.response?.data?.message || 'Không tải được thông tin khách')
      } finally {
        if (!cancel) setLoading(false)
      }
    })()
    return () => { cancel = true }
  }, [passenger.id])

  const docs = full?.documents || []
  const hasDoc = docs.some(d => (d.docNumber || '').trim())

  const options = useMemo(() => {
    const used = new Set(usedIds)
    return companyOptions(companies || []).filter(o => !used.has(o.id))
  }, [companies, usedIds])

  const usedNames = useMemo(() => {
    const byId = new Map((companies || []).map(c => [c.id, c.name]))
    return usedIds.map(id => byId.get(id) || `#${id}`)
  }, [usedIds, companies])

  const doCopy = async () => {
    if (targetId == null) return toast.error('Chọn công ty cần copy sang')
    setBusy(true)
    const tid = toast.loading('Đang copy khách…')
    try {
      const res = await createPassenger({
        companyId: Number(targetId),
        fullName: (full.fullName || '').toUpperCase(),
        dob: full.dob || '',
        gender: full.gender || '',
      })
      const newId = res.data?.data?.id
      if (!newId) throw new Error('Không nhận được id khách mới')

      let fileFailed = 0
      for (const d of docs) {
        if (!(d.docNumber || '').trim() && !d.fileUrl) continue
        let file = null
        if (d.fileUrl) {
          try {
            const r = await fetch(resolveUrl(d.fileUrl))
            if (r.ok) {
              const blob = await r.blob()
              file = new File([blob], d.fileOriginal || fileNameOf(d.fileUrl),
                { type: blob.type || 'application/octet-stream' })
            } else fileFailed++
          } catch { fileFailed++ }
        }
        await upsertPassengerDocument(
          newId,
          d.type === 'PASSPORT' ? 'passport' : 'cccd',
          {
            docNumber: d.docNumber || '',
            nationality: d.nationality || '',
            issueDate: d.issueDate || '',
            expiryDate: d.expiryDate || '',
          },
          file,
        )
      }
      toast.success(
        fileFailed > 0
          ? `Đã copy khách (không tải được ${fileFailed} ảnh giấy tờ)`
          : 'Đã copy khách sang công ty mới',
        { id: tid, duration: fileFailed ? 5000 : 2500 })
      onDone?.()
      onClose()
    } catch (e) {
      toast.error(e?.response?.data?.message || e?.message || 'Copy thất bại', { id: tid })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={busy ? undefined : onClose}
      title={`Copy khách — ${(passenger.fullName || '').toUpperCase()}`}
      size="md" closeOnBackdrop={!busy}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-200 disabled:opacity-50">
            Huỷ
          </button>
          <button type="button" onClick={doCopy}
            disabled={busy || loading || targetId == null}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white
              hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Đang copy…' : 'Copy sang công ty này'}
          </button>
        </div>
      }>
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500 italic">Đang tải…</div>
      ) : (
        <div className="space-y-3">
          {/* Thông tin sẽ được chép */}
          <div className="p-3 rounded-xl bg-slate-50 border border-gray-200">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
              Thông tin sẽ được chép
            </div>
            <div className="text-sm font-bold text-gray-900 uppercase">{full?.fullName}</div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
              {docs.filter(d => (d.docNumber || '').trim()).map(d => (
                <span key={d.type}
                  className="px-2 py-0.5 rounded bg-white border border-gray-200 font-mono text-gray-700">
                  {d.type === 'PASSPORT' ? 'HC' : 'CCCD'} {d.docNumber}
                  {d.fileUrl && ' 📎'}
                </span>
              ))}
              {!hasDoc && (
                <span className="text-gray-400 italic font-sans">Chưa có CCCD / hộ chiếu</span>
              )}
            </div>
          </div>

          {!hasDoc && (
            <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              Khách này chưa có số CCCD / hộ chiếu nên không kiểm tra được công ty nào
              đã có sẵn người này. Danh sách bên dưới chỉ bỏ công ty hiện tại.
            </div>
          )}

          {usedNames.length > 0 && (
            <div className="text-[11px] text-gray-500">
              Đã có ở: {usedNames.map((n, i) => (
                <span key={i}
                  className="inline-block mr-1 mb-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                  {n}
                </span>
              ))}
            </div>
          )}

          <div>
            <div className="text-[11px] font-semibold text-gray-600 mb-1">
              Copy sang công ty / mục
            </div>
            {options.length === 0 ? (
              <div className="text-xs text-gray-500 italic py-3 text-center border border-dashed border-gray-300 rounded-lg">
                Khách này đã có ở tất cả công ty hiện có.
              </div>
            ) : (
              <CompanySearchSelect
                value={targetId}
                options={options}
                onChange={setTargetId}
                allowNone={false}
                placeholder="— Chọn công ty / Khách lẻ —"
                portal
              />
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

function resolveUrl(u) {
  if (!u) return u
  if (/^https?:\/\//i.test(u)) return u
  const BASE = import.meta.env.VITE_API_URL || 'http://localhost:9009'
  return BASE + (u.startsWith('/') ? u : '/' + u)
}

function fileNameOf(u) {
  const s = String(u || '').split('/').pop() || 'giay-to'
  return s.split('?')[0]
}
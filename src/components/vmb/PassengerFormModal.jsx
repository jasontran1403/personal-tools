import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import ConfirmModal from '../common/ConfirmModal'
import ZoomablePreview from './ZoomablePreview'
import {
  getPassenger, createPassenger, updatePassenger,
  upsertPassengerDocument, deletePassengerDocument,
} from '../../services/vmbApi'

/**
 * Form thêm / sửa 1 hành khách.
 *
 * ── Cấu trúc (2026-09-15) ───────────────────────────────────
 * Section 1 (Nhân thân): công ty, họ tên, giới tính, ngày sinh.
 * Section 2 (Giấy tờ):   2 tab CCCD | Hộ chiếu. Mỗi tab có riêng số, ngày cấp,
 *                        ngày hết hạn (+ mã quốc tịch cho PP), file ảnh/PDF.
 *
 * ── Buffer vs upsert-ngay ──────────────────────────────────
 * Create mode: buffer text + file client-side, submit tạo passenger xong
 *              rồi mới upsert từng document.
 * Edit mode:   upsert từng document ngay khi bấm nút "Lưu giấy tờ" trong tab
 *              (không phải chờ submit) — thao tác gọn hơn cho user.
 */
export default function PassengerFormModal({ mode: initialMode = 'create', passengerId, companies, onClose, onSaved }) {
  const [mode] = useState(initialMode)
  const [id, setId] = useState(passengerId || null)
  const [loading, setLoading] = useState(mode === 'edit')
  const [busy, setBusy] = useState(false)

  const [companyPickMode, setCompanyPickMode] = useState('existing')
  const [form, setForm] = useState({
    companyId: '',
    newCompanyName: '',
    fullName: '',
    dob: '',
    gender: 'MALE',
  })

  // Documents state — edit mode load từ server; create mode buffer client
  const [cccdDoc, setCccdDoc] = useState(emptyDoc('CCCD'))
  const [ppDoc,   setPpDoc]   = useState(emptyDoc('PASSPORT'))
  // Buffer file cho create mode (chưa có passenger.id)
  const [cccdBufFile, setCccdBufFile] = useState(null)
  const [ppBufFile,   setPpBufFile]   = useState(null)

  const [activeTab, setActiveTab] = useState('cccd')
  const [preview, setPreview] = useState(null)   // { url, name }
  const [confirmDelDoc, setConfirmDelDoc] = useState(null)   // 'cccd' | 'passport'

  // ── Load edit ─────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'edit' || !id) return
    ;(async () => {
      setLoading(true)
      try {
        const res = await getPassenger(id)
        const p = res.data?.data
        if (!p) throw new Error('Không tìm thấy')
        setForm({
          companyId: p.companyId ? String(p.companyId) : '',
          newCompanyName: '',
          fullName: p.fullName || '',
          dob: p.dob || '',
          gender: p.gender || 'MALE',
        })
        const docs = p.documents || []
        const c = docs.find(d => d.type === 'CCCD')
        const pp = docs.find(d => d.type === 'PASSPORT')
        if (c)  setCccdDoc({ ...emptyDoc('CCCD'), ...c })
        if (pp) setPpDoc({ ...emptyDoc('PASSPORT'), ...pp })
      } catch (e) {
        toast.error(e?.response?.data?.message || 'Không tải được hành khách')
        onClose()
      } finally {
        setLoading(false)
      }
    })()
    // KHÔNG đưa onClose vào deps: parent (PassengersTab) re-render mỗi giây do
    // VmbPage tick countdown → onClose là arrow inline nên đổi ref mỗi giây,
    // sẽ khiến effect này chạy lại → set loading=true → hiện "Đang tải…" →
    // fetch → hiện form → 1 giây sau lặp lại → user không kịp sửa gì.
    // onClose ở đây chỉ dùng trong nhánh lỗi fallback → dùng ref hơi cũ vẫn OK.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, id])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // ── Submit nhân thân ──────────────────────────────────────
  const submit = async (e) => {
    e.preventDefault()
    if (!form.fullName.trim()) return toast.error('Tên khách không được để trống')
    if (companyPickMode === 'new' && !form.newCompanyName.trim())
      return toast.error('Gõ tên công ty mới')

    const body = {
      companyId: companyPickMode === 'existing' && form.companyId ? Number(form.companyId) : null,
      newCompanyName: companyPickMode === 'new' ? form.newCompanyName : null,
      fullName: form.fullName,
      dob: form.dob,
      gender: form.gender,
    }

    setBusy(true)
    try {
      if (mode === 'edit') {
        await updatePassenger(id, body)
        toast.success('Đã cập nhật nhân thân')
        onSaved()
      } else {
        // 1) Tạo passenger
        const res = await createPassenger(body)
        const saved = res.data?.data
        const newId = saved?.id
        if (!newId) throw new Error('Không nhận được passenger.id')
        // 2) Upsert từng document đã có dữ liệu
        try {
          if (isDocFilled(cccdDoc) || cccdBufFile) {
            await upsertPassengerDocument(newId, 'cccd', extractFields(cccdDoc), cccdBufFile)
          }
          if (isDocFilled(ppDoc) || ppBufFile) {
            await upsertPassengerDocument(newId, 'passport', extractFields(ppDoc), ppBufFile)
          }
        } catch (docErr) {
          toast.error('Đã tạo khách nhưng lưu giấy tờ lỗi: ' + (docErr?.response?.data?.message || docErr?.message))
        }
        toast.success('Đã tạo hành khách')
        onSaved()
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Lưu thất bại')
    } finally {
      setBusy(false)
    }
  }

  // ── Upsert document (edit mode) — save NGAY ────────────────
  const saveDoc = async (type, doc, bufFile) => {
    if (mode === 'create') {
      // Create mode: chỉ update state, sẽ upload cùng submit passenger
      toast.success(`Đã lưu tạm ${type === 'cccd' ? 'CCCD' : 'hộ chiếu'} — sẽ upload khi tạo khách`)
      return
    }
    setBusy(true)
    try {
      const res = await upsertPassengerDocument(id, type, extractFields(doc), bufFile)
      const savedDoc = res.data?.data
      if (savedDoc) {
        if (type === 'cccd') { setCccdDoc({ ...emptyDoc('CCCD'), ...savedDoc }); setCccdBufFile(null) }
        else                 { setPpDoc({ ...emptyDoc('PASSPORT'), ...savedDoc }); setPpBufFile(null) }
      }
      toast.success(`Đã lưu ${type === 'cccd' ? 'CCCD' : 'hộ chiếu'}`)
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Lưu giấy tờ thất bại')
    } finally {
      setBusy(false)
    }
  }

  const doDeleteDoc = async (type) => {
    if (mode === 'create') {
      if (type === 'cccd') { setCccdDoc(emptyDoc('CCCD')); setCccdBufFile(null) }
      else                 { setPpDoc(emptyDoc('PASSPORT')); setPpBufFile(null) }
      setConfirmDelDoc(null)
      return
    }
    setBusy(true)
    try {
      await deletePassengerDocument(id, type)
      if (type === 'cccd') { setCccdDoc(emptyDoc('CCCD')); setCccdBufFile(null) }
      else                 { setPpDoc(emptyDoc('PASSPORT')); setPpBufFile(null) }
      toast.success('Đã xóa giấy tờ')
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Xóa thất bại')
    } finally {
      setBusy(false)
      setConfirmDelDoc(null)
    }
  }

  const isEditMode = mode === 'edit' && id

  return (
    <>
      <Modal
        open
        onClose={busy ? undefined : onClose}
        title={isEditMode ? 'Sửa hành khách' : 'Thêm hành khách mới'}
        size="xl"
        closeOnBackdrop={!busy}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy}
              className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-200 disabled:opacity-50">
              Đóng
            </button>
            <button type="submit" form="pax-form" disabled={busy || loading}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white
                         hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'Đang lưu…' : (isEditMode ? 'Lưu nhân thân' : 'Tạo hành khách')}
            </button>
          </div>
        }
      >
        {loading ? (
          <div className="py-10 text-center text-gray-400 text-sm">Đang tải…</div>
        ) : (
          <>
            {/* SECTION 1: Nhân thân */}
            <form id="pax-form" onSubmit={submit} className="space-y-3">
              <div className="text-xs font-bold text-gray-700 uppercase tracking-wide">Nhân thân</div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-gray-600">Công ty</label>
                  <button type="button"
                    onClick={() => setCompanyPickMode(m => m === 'existing' ? 'new' : 'existing')}
                    className="text-[10px] font-semibold text-blue-600 hover:text-blue-800">
                    {companyPickMode === 'existing' ? '+ Gõ công ty mới' : '← Chọn có sẵn'}
                  </button>
                </div>
                {companyPickMode === 'existing' ? (
                  <select value={form.companyId}
                    onChange={e => setField('companyId', e.target.value)}
                    className="input">
                    <option value="">— Khách lẻ (mặc định) —</option>
                    {companies.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                ) : (
                  <input type="text" value={form.newCompanyName}
                    onChange={e => setField('newCompanyName', e.target.value)}
                    placeholder="Tên công ty mới…" className="input" />
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Họ tên" span={2}>
                  <input type="text" value={form.fullName}
                    onChange={e => setField('fullName', e.target.value)}
                    placeholder="NGUYEN VAN A" className="input uppercase" />
                </Field>
                <Field label="Giới tính">
                  <select value={form.gender}
                    onChange={e => setField('gender', e.target.value)}
                    className="input">
                    <option value="MALE">Nam</option>
                    <option value="FEMALE">Nữ</option>
                    <option value="OTHER">Khác</option>
                  </select>
                </Field>
              </div>

              <Field label="Ngày sinh">
                <input type="date" value={form.dob}
                  onChange={e => setField('dob', e.target.value)} className="input" />
              </Field>
            </form>

            {/* SECTION 2: Giấy tờ */}
            <div className="mt-6 pt-4 border-t border-gray-200">
              <div className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">Giấy tờ</div>

              {/* Tab switch */}
              <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-3 w-fit">
                <TabBtn active={activeTab === 'cccd'} onClick={() => setActiveTab('cccd')}>🪪 CCCD</TabBtn>
                <TabBtn active={activeTab === 'pp'}   onClick={() => setActiveTab('pp')}>📘 Hộ chiếu</TabBtn>
              </div>

              {activeTab === 'cccd' ? (
                <DocForm
                  type="cccd"
                  doc={cccdDoc} setDoc={setCccdDoc}
                  bufFile={cccdBufFile} setBufFile={setCccdBufFile}
                  onSave={() => saveDoc('cccd', cccdDoc, cccdBufFile)}
                  onDelete={() => setConfirmDelDoc('cccd')}
                  onPreview={setPreview}
                  busy={busy}
                  isEditMode={isEditMode}
                />
              ) : (
                <DocForm
                  type="passport"
                  doc={ppDoc} setDoc={setPpDoc}
                  bufFile={ppBufFile} setBufFile={setPpBufFile}
                  onSave={() => saveDoc('passport', ppDoc, ppBufFile)}
                  onDelete={() => setConfirmDelDoc('passport')}
                  onPreview={setPreview}
                  busy={busy}
                  isEditMode={isEditMode}
                />
              )}
            </div>

            <style>{`
              .input {
                width: 100%; padding: 0.5rem 0.75rem;
                border-radius: 0.5rem;
                border: 1px solid #d1d5db; background: #fff;
                font-size: 0.875rem; outline: none;
                transition: border-color .15s, box-shadow .15s;
              }
              .input:focus {
                border-color: #3b82f6;
                box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
              }
            `}</style>
          </>
        )}
      </Modal>

      {preview && (
        <ZoomablePreview
          filePath={preview.url?.startsWith('/vmb-files/') ? preview.url : null}
          fileName={preview.name}
          title={preview.name}
          onClose={() => setPreview(null)}
        />
      )}

      {confirmDelDoc && (
        <ConfirmModal
          open
          title={`Xóa ${confirmDelDoc === 'cccd' ? 'CCCD' : 'hộ chiếu'}`}
          message={`Xóa toàn bộ thông tin ${confirmDelDoc === 'cccd' ? 'CCCD' : 'hộ chiếu'} của khách?`}
          confirmLabel="Xóa" danger
          onConfirm={() => doDeleteDoc(confirmDelDoc)}
          onCancel={() => setConfirmDelDoc(null)}
        />
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════

function DocForm({ type, doc, setDoc, bufFile, setBufFile, onSave, onDelete, onPreview, busy, isEditMode }) {
  const fileInputRef = useRef(null)
  const isPassport = type === 'passport'
  const hasServerFile = !!doc?.fileUrl
  const hasBufFile = !!bufFile

  const setDocField = (k, v) => setDoc(d => ({ ...d, [k]: v }))

  return (
    <div className="p-3 rounded-xl bg-gray-50 border border-gray-200">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={isPassport ? 'Số hộ chiếu' : 'Số CCCD'}>
          <input type="text" value={doc.docNumber || ''}
            onChange={e => setDocField('docNumber', e.target.value)}
            className="input font-mono uppercase"
            placeholder={isPassport ? 'B1234567' : '12 số'} />
        </Field>
        {isPassport && (
          <Field label="Mã quốc tịch (ISO-3)">
            <input type="text" value={doc.nationality || ''}
              onChange={e => setDocField('nationality', e.target.value.toUpperCase().slice(0, 3))}
              className="input font-mono uppercase"
              placeholder="VNM · JPN · USA" maxLength={3} />
          </Field>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <Field label="Ngày cấp">
          <input type="date" value={doc.issueDate || ''}
            onChange={e => setDocField('issueDate', e.target.value)} className="input" />
        </Field>
        <Field label="Ngày hết hạn">
          <input type="date" value={doc.expiryDate || ''}
            onChange={e => setDocField('expiryDate', e.target.value)} className="input" />
        </Field>
      </div>

      <div className="mt-3">
        <div className="text-[11px] font-semibold text-gray-600 mb-1">
          Ảnh / PDF giấy tờ
          {!isEditMode && hasBufFile && (
            <span className="ml-2 text-[10px] text-blue-600 font-semibold normal-case">
              (sẽ upload khi tạo khách)
            </span>
          )}
        </div>
        {(hasServerFile || hasBufFile) ? (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-white border border-gray-200">
            <button type="button" disabled={!hasServerFile}
              onClick={() => hasServerFile && onPreview({ url: doc.fileUrl, name: doc.fileOriginal })}
              className="flex-1 min-w-0 text-left text-sm text-blue-700 hover:text-blue-900 truncate disabled:text-gray-500 disabled:cursor-default">
              📄 {hasBufFile ? bufFile.name : (doc.fileOriginal || 'file')}
              {hasBufFile && <span className="ml-1 text-[10px] text-gray-400">(chưa upload)</span>}
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="text-[10px] font-semibold px-2 py-1 rounded-md bg-white border border-gray-300 hover:bg-gray-100">
              Thay
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => fileInputRef.current?.click()}
            className="w-full py-3 rounded-lg border-2 border-dashed border-gray-300 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600">
            + Tải ảnh / PDF
          </button>
        )}
        <input ref={fileInputRef} type="file" hidden accept="image/*,application/pdf"
          onChange={e => { const f = e.target.files?.[0]; if (f) setBufFile(f); e.target.value = '' }} />
      </div>

      <div className="mt-3 flex justify-end gap-2">
        {(hasServerFile || hasBufFile || doc.docNumber) && (
          <button type="button" onClick={onDelete} disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-50">
            Xóa giấy tờ
          </button>
        )}
        {isEditMode && (
          <button type="button" onClick={onSave} disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Đang lưu…' : `Lưu ${isPassport ? 'hộ chiếu' : 'CCCD'}`}
          </button>
        )}
      </div>
    </div>
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

function Field({ label, span, children }) {
  const cls = span === 2 ? 'sm:col-span-2' : span === 3 ? 'sm:col-span-3' : ''
  return (
    <label className={`block ${cls}`}>
      <div className="text-[11px] font-semibold text-gray-600 mb-1">{label}</div>
      {children}
    </label>
  )
}

function emptyDoc(type) {
  return { type, docNumber: '', nationality: '', issueDate: '', expiryDate: '', fileUrl: null, fileOriginal: null }
}

function isDocFilled(d) {
  return !!(d.docNumber || d.issueDate || d.expiryDate || d.nationality)
}

function extractFields(d) {
  return {
    docNumber:   d.docNumber   || '',
    nationality: d.nationality || '',
    issueDate:   d.issueDate   || '',
    expiryDate:  d.expiryDate  || '',
  }
}
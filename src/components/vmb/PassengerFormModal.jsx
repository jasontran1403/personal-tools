import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import ConfirmModal from '../common/ConfirmModal'
import ZoomablePreview from './ZoomablePreview'
import DateInputVN from '../common/DateInputVN'
import CompanySearchSelect, { companyOptions, walkInCompanyId } from '../common/CompanySearchSelect'
import { formatDateVn } from '../../lib/expiry'   // 2026-11-19: hiển thị ngày sinh trên card batch
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
  // 2026-11-11: Mặc định chọn công ty "Khách lẻ" thật trong DB (thường id 1)
  //   thay vì để trống / null. Dropdown giờ chỉ còn một mục Khách lẻ, và BE
  //   lưu ổn hơn khi nhận trực tiếp id thay vì để null rồi tự ghép.
  const [form, setForm] = useState(() => ({
    companyId: String(walkInCompanyId(companies)),
    newCompanyName: '',
    fullName: '',
    dob: '',
    gender: 'MALE',
    referrerName: '',   // 2026-11-08: Người giới thiệu (walk-in only)
  }))

  // Documents state — edit mode load từ server; create mode buffer client
  const [cccdDoc, setCccdDoc] = useState(emptyDoc('CCCD'))
  const [ppDoc,   setPpDoc]   = useState(emptyDoc('PASSPORT'))
  // Buffer file cho create mode (chưa có passenger.id)
  const [cccdBufFile, setCccdBufFile] = useState(null)
  const [ppBufFile,   setPpBufFile]   = useState(null)

  const [activeTab, setActiveTab] = useState('cccd')
  const [preview, setPreview] = useState(null)   // { url, name }
  const [confirmDelDoc, setConfirmDelDoc] = useState(null)   // 'cccd' | 'passport'

  // ── 2026-11-19: Thêm BATCH khách (chỉ create mode) ──────────
  //   Mỗi khách đã nhập được "đẩy" vào danh sách chờ (card bên phải). Khi bấm
  //   "Tạo hành khách" → tạo TẤT CẢ (danh sách chờ + khách đang nhập dở nếu có)
  //   vào cùng 1 công ty / khách lẻ đang chọn.
  const [batch, setBatch] = useState([])

  const snapshotCurrent = () => ({
    key: Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    fullName: (form.fullName || '').toUpperCase().trim(),
    dob: form.dob,
    gender: form.gender,
    referrerName: (form.referrerName || '').trim() || null,
    cccd: { ...cccdDoc }, cccdFile: cccdBufFile,
    pp: { ...ppDoc }, ppFile: ppBufFile,
  })

  const resetPersonalForNext = () => {
    setForm(f => ({ ...f, fullName: '', dob: '', gender: 'MALE', referrerName: '' }))
    setCccdDoc(emptyDoc('CCCD')); setCccdBufFile(null)
    setPpDoc(emptyDoc('PASSPORT')); setPpBufFile(null)
    setActiveTab('cccd')
  }

  const addToBatch = () => {
    if (!form.fullName.trim()) return toast.error('Nhập tên khách trước khi thêm vào danh sách')
    setBatch(b => [...b, snapshotCurrent()])
    resetPersonalForNext()
    toast.success('Đã thêm vào danh sách — nhập khách tiếp theo')
  }

  const removeFromBatch = (key) => setBatch(b => b.filter(x => x.key !== key))

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
          referrerName: p.referrerName || '',
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

  // Flatten tree công ty (có parent/branch) cho combobox search
  const flatCompanies = useMemo(() => companyOptions(companies || []), [companies])

  // Nếu danh sách công ty load muộn hơn, chốt lại id Khách lẻ khi tạo mới
  useEffect(() => {
    if (mode !== 'create') return
    if (!companies || companies.length === 0) return
    const wid = walkInCompanyId(companies)
    setForm(f => (f.companyId === '' || Number(f.companyId) === wid
      ? { ...f, companyId: String(wid) }
      : f))
  }, [companies, mode])

  // ── Submit nhân thân ──────────────────────────────────────
  const submit = async (e) => {
    e.preventDefault()
    if (companyPickMode === 'new' && !form.newCompanyName.trim())
      return toast.error('Gõ tên công ty mới')

    // ── EDIT mode: giữ nguyên hành vi cũ (1 khách) ──
    if (mode === 'edit') {
      if (!form.fullName.trim()) return toast.error('Tên khách không được để trống')
      const body = {
        companyId: companyPickMode === 'existing' && form.companyId ? Number(form.companyId) : null,
        newCompanyName: companyPickMode === 'new' ? form.newCompanyName : null,
        fullName: (form.fullName || '').toUpperCase(),
        dob: form.dob, gender: form.gender,
        referrerName: (form.referrerName || '').trim() || null,
      }
      setBusy(true)
      try {
        await updatePassenger(id, body)
        toast.success('Đã cập nhật nhân thân')
        onSaved({ mode: 'edit', id })
      } catch (err) {
        toast.error(err?.response?.data?.message || 'Lưu thất bại')
      } finally { setBusy(false) }
      return
    }

    // ── CREATE mode: tạo CẢ BATCH (danh sách chờ + khách đang nhập dở) ──
    const entries = [...batch]
    if (form.fullName.trim()) entries.push(snapshotCurrent())
    if (entries.length === 0)
      return toast.error('Chưa có khách nào — nhập tên khách hoặc thêm vào danh sách')

    // Công ty dùng CHUNG cho mọi khách trong batch.
    let sharedCompanyId = companyPickMode === 'existing' && form.companyId ? Number(form.companyId) : null
    let pendingNewName = companyPickMode === 'new' ? form.newCompanyName : null

    setBusy(true)
    let okCount = 0, lastId = null
    try {
      for (let idx = 0; idx < entries.length; idx++) {
        const en = entries[idx]
        const body = {
          companyId: sharedCompanyId,
          // Chỉ khách ĐẦU TIÊN tạo công ty mới; các khách sau tái dùng id vừa tạo.
          newCompanyName: sharedCompanyId == null ? pendingNewName : null,
          fullName: en.fullName,
          dob: en.dob,
          gender: en.gender,
          referrerName: en.referrerName,
        }
        const res = await createPassenger(body)
        const saved = res.data?.data
        const newId = saved?.id
        if (!newId) throw new Error('Không nhận được passenger.id')
        lastId = newId
        // Khóa công ty cho các khách còn lại (dù chọn sẵn hay vừa tạo mới).
        if (sharedCompanyId == null && saved?.companyId) { sharedCompanyId = saved.companyId; pendingNewName = null }

        try {
          if (isDocFilled(en.cccd) || en.cccdFile)
            await upsertPassengerDocument(newId, 'cccd', extractFields(en.cccd), en.cccdFile)
          if (isDocFilled(en.pp) || en.ppFile)
            await upsertPassengerDocument(newId, 'passport', extractFields(en.pp), en.ppFile)
        } catch (docErr) {
          toast.error(`Khách "${en.fullName}": tạo OK nhưng lưu giấy tờ lỗi`)
        }
        okCount++
      }
      toast.success(entries.length > 1 ? `Đã tạo ${okCount} hành khách` : 'Đã tạo hành khách')
      onSaved({ mode: 'create', id: lastId })
    } catch (err) {
      toast.error((okCount > 0 ? `Đã tạo ${okCount} khách, dừng vì lỗi: ` : '') +
        (err?.response?.data?.message || 'Lưu thất bại'))
      if (okCount > 0) onSaved({ mode: 'create', id: lastId })
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
  // 2026-11-19: batch chỉ dành cho create mode.
  const batchActive = !isEditMode && batch.length > 0
  const totalToCreate = batch.length + (form.fullName.trim() ? 1 : 0)

  return (
    <>
      <Modal
        open
        onClose={busy ? undefined : onClose}
        title={isEditMode ? 'Sửa hành khách' : 'Thêm hành khách mới'}
        size={batchActive ? 'batch' : 'xl'}
        closeOnBackdrop={!busy}
        footer={
          <div className="flex items-center justify-between w-full gap-2">
            {/* 2026-11-19: Thêm khách nữa vào danh sách (chỉ create mode) */}
            {!isEditMode ? (
              <button type="button" onClick={addToBatch} disabled={busy || loading}
                className="px-3 py-2 text-sm font-semibold rounded-lg border border-blue-300
                  text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50">
                ➕ Thêm khách nữa
              </button>
            ) : <div />}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy}
                className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-200 disabled:opacity-50">
                Đóng
              </button>
              <button type="submit" form="pax-form" disabled={busy || loading}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white
                           hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'Đang lưu…'
                  : isEditMode ? 'Lưu nhân thân'
                  : totalToCreate > 1 ? `Tạo ${totalToCreate} hành khách`
                  : 'Tạo hành khách'}
              </button>
            </div>
          </div>
        }
      >
        {loading ? (
          <div className="py-10 text-center text-gray-400 text-sm">Đang tải…</div>
        ) : (
          <>
            {/* 2026-11-19: khi batch bật → 2 cột (form trái · danh sách khách phải). */}
            <div className={batchActive ? 'flex gap-4 items-start' : ''}>
            <div className={batchActive ? 'flex-1 min-w-0' : ''}>
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
                  <CompanySearchSelect
                    value={form.companyId ? Number(form.companyId) : null}
                    options={flatCompanies}
                    onChange={(id) => setField('companyId', id == null ? '' : String(id))}
                    placeholder="— Chọn công ty / Khách lẻ —"
                  />
                ) : (
                  <input type="text" value={form.newCompanyName}
                    onChange={e => setField('newCompanyName', e.target.value)}
                    placeholder="Tên công ty mới…" className="input" />
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Họ tên" span={2}>
                  {/* 2026-11-19: KHÔNG UPPERCASE khi đang gõ — làm hỏng bỏ dấu Telex.
                      Lưu raw; hiển thị HOA bằng CSS; chuẩn hóa (HOA + gộp "/") khi blur. */}
                  <input type="text" value={form.fullName}
                    onChange={e => setField('fullName', e.target.value)}
                    onBlur={e => setField('fullName', formatPaxName(e.target.value))}
                    onPaste={e => {
                      // 2026-10-10: KUWABATA/YOSHIRO → KUWABATA YOSHIRO
                      e.preventDefault()
                      const raw = (e.clipboardData || window.clipboardData).getData('text')
                      setField('fullName', formatPaxName(raw))
                    }}
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
                <DateInputVN value={form.dob} onChange={v => setField('dob', v)} />
              </Field>

              {/* 2026-11-08: Người giới thiệu — free text. Chỉ có ý nghĩa với
                  khách lẻ (BE chỉ dùng cho walk-in trong UI customers); vẫn
                  hiển thị cho mọi passenger, BE lưu nếu không rỗng. */}
              <Field label={
                <span>Người giới thiệu <span className="text-[10px] font-normal text-gray-500">(cho khách lẻ, rỗng = Khách mới)</span></span>
              }>
                <input type="text" value={form.referrerName}
                  onChange={e => setField('referrerName', e.target.value)}
                  className="input"
                  placeholder='VD: "Tiểu Hà (Zalo) thuộc Create Medic"' />
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
            </div>{/* /cột trái */}

            {/* 2026-11-19: Cột phải — danh sách khách đã thêm vào batch */}
            {batchActive && (
              <div className="w-[240px] shrink-0 self-stretch border-l border-gray-200 pl-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                    Danh sách ({batch.length})
                  </div>
                  <button type="button" onClick={() => setBatch([])}
                    className="text-[10px] font-semibold text-rose-500 hover:text-rose-700">
                    Xóa hết
                  </button>
                </div>
                <div className="space-y-2 max-h-[62vh] overflow-y-auto pr-1">
                  {batch.map((en, idx) => (
                    <BatchCard key={en.key} en={en} idx={idx}
                      onRemove={() => removeFromBatch(en.key)} />
                  ))}
                  {form.fullName.trim() && (
                    <div className="p-2 rounded-lg border border-dashed border-blue-300 bg-blue-50/50 text-[11px] text-blue-700">
                      <b>{form.fullName.toUpperCase()}</b> đang nhập — sẽ được tạo cùng khi bấm “Tạo”.
                    </div>
                  )}
                </div>
                <div className="mt-2 text-[10px] text-gray-400 leading-snug">
                  Tất cả khách sẽ được tạo vào cùng công ty / khách lẻ đang chọn bên trái.
                </div>
              </div>
            )}
            </div>{/* /flex 2 cột */}

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
          <DateInputVN value={doc.issueDate || ''} onChange={v => setDocField('issueDate', v)} />
        </Field>
        <Field label="Ngày hết hạn">
          <DateInputVN value={doc.expiryDate || ''} onChange={v => setDocField('expiryDate', v)} />
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

// 2026-11-19: Card tóm tắt 1 khách trong batch — tên, ngày sinh, giới tính, số CCCD/PP.
function BatchCard({ en, idx, onRemove }) {
  const genderLabel = en.gender === 'FEMALE' ? 'Nữ' : en.gender === 'OTHER' ? 'Khác' : 'Nam'
  const cccdNo = en.cccd?.docNumber || (en.cccdFile ? '(có ảnh)' : '')
  const ppNo = en.pp?.docNumber || (en.ppFile ? '(có ảnh)' : '')
  return (
    <div className="relative p-2 rounded-lg border border-gray-200 bg-white shadow-sm">
      <button type="button" onClick={onRemove}
        className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-full
          text-gray-400 hover:text-rose-600 hover:bg-rose-50 text-sm leading-none"
        title="Bỏ khỏi danh sách">×</button>
      <div className="flex items-center gap-1.5 pr-5">
        <span className="shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center">
          {idx + 1}
        </span>
        <div className="font-semibold text-sm text-gray-900 uppercase truncate">{en.fullName}</div>
      </div>
      <div className="mt-1 text-[11px] text-gray-500 flex flex-wrap gap-x-2 gap-y-0.5">
        <span>{genderLabel}</span>
        {en.dob && <span>· {formatDateVn(en.dob)}</span>}
      </div>
      {(cccdNo || ppNo) && (
        <div className="mt-1 space-y-0.5 text-[11px] font-mono">
          {cccdNo && <div className="text-gray-700">🪪 {cccdNo}</div>}
          {ppNo && <div className="text-gray-700">📘 {ppNo}</div>}
        </div>
      )}
    </div>
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
/**
 * ── 2026-10-10 ─────────────────────────────────────────
 * Chuẩn hóa họ tên khách: "/" → space, gộp space, trim.
 * Ví dụ: "KUWABATA/YOSHIRO" → "KUWABATA YOSHIRO"
 */
function formatPaxName(raw) {
  if (!raw) return ''
  return String(raw)
    // 2026-11-07: hỗ trợ "/", "," và ";" làm delimiter.
    .replace(/[/,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s+/, '')
    // 2026-11-08: Tự động viết HOA toàn bộ.
    .toUpperCase()
}
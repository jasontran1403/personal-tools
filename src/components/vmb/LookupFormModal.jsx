import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import { createLookup, updateLookup } from '../../services/vmbApi'

/**
 * Form thêm / sửa mục tra cứu.
 *
 * Chọn TYPE (PLAIN / ACCOUNT) trước → các field bên dưới đổi theo:
 *   PLAIN   : keyword + details (textarea)
 *   ACCOUNT : keyword + loginUrl + loginUsername + password
 *
 * Password:
 *   - Khi tạo mới ACCOUNT: bắt buộc.
 *   - Khi sửa: để trống = giữ password cũ. Chỉ khi user gõ vào ô thì BE mới
 *     cập nhật (theo yêu cầu "không đổi pass tình cờ").
 */
export default function LookupFormModal({ mode = 'create', row, onClose, onSaved }) {
  const isEdit = mode === 'edit'
  const [busy, setBusy] = useState(false)
  const [showPw, setShowPw] = useState(false)

  const [form, setForm] = useState(() => ({
    type: row?.type || 'PLAIN',
    keyword: row?.keyword || '',
    details: row?.details || '',
    loginUrl: row?.loginUrl || '',
    loginUsername: row?.loginUsername || '',
    agencyCode: row?.agencyCode || '',
    password: '',
  }))

  useEffect(() => {
    if (row) {
      setForm({
        type: row.type,
        keyword: row.keyword || '',
        details: row.details || '',
        loginUrl: row.loginUrl || '',
        loginUsername: row.loginUsername || '',
        agencyCode: row.agencyCode || '',
        password: '',
      })
    }
  }, [row])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.keyword.trim()) return toast.error('Từ khóa không được để trống')
    if (form.type === 'ACCOUNT') {
      if (!form.loginUsername.trim()) return toast.error('Tài khoản đăng nhập không được để trống')
      if (!isEdit && !form.password) return toast.error('Mật khẩu không được để trống')
    }

    setBusy(true)
    try {
      if (isEdit) await updateLookup(row.id, form)
      else        await createLookup(form)
      toast.success(isEdit ? 'Đã cập nhật' : 'Đã tạo')
      onSaved()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Lưu thất bại')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      title={isEdit ? 'Sửa mục' : 'Thêm mục tra cứu'}
      size="md"
      closeOnBackdrop={!busy}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-200 disabled:opacity-50">
            Hủy
          </button>
          <button type="submit" form="lookup-form" disabled={busy}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white
              hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Đang lưu…' : (isEdit ? 'Lưu' : 'Tạo')}
          </button>
        </div>
      }
    >
      <form id="lookup-form" onSubmit={submit} className="space-y-3">
        {/* Type radio */}
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">Loại</div>
          <div className="flex gap-2">
            {[
              { key: 'PLAIN',   label: '📄 Thông tin (từ khóa + chi tiết)' },
              { key: 'ACCOUNT', label: '🔐 Tài khoản (URL + user + pass)' },
            ].map(t => (
              <label key={t.key}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium cursor-pointer transition ${
                  form.type === t.key
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}>
                <input type="radio" name="type" checked={form.type === t.key}
                  onChange={() => setField('type', t.key)} className="hidden" />
                {t.label}
              </label>
            ))}
          </div>
        </div>

        <Field label="Từ khóa">
          <input type="text" value={form.keyword} autoFocus
            onChange={e => setField('keyword', e.target.value)}
            placeholder="Ví dụ: Điều kiện vé VJ / Tài khoản Amadeus"
            className="input" />
        </Field>

        {form.type === 'PLAIN' && (
          <Field label="Chi tiết">
            <textarea rows={5} value={form.details}
              onChange={e => setField('details', e.target.value)}
              placeholder="Nội dung / hướng dẫn / thông tin cần tra cứu"
              className="input resize-y" />
          </Field>
        )}

        {form.type === 'ACCOUNT' && (
          <>
            <Field label="URL đăng nhập">
              <input type="text" value={form.loginUrl}
                onChange={e => setField('loginUrl', e.target.value)}
                placeholder="https://…" className="input" />
            </Field>
            <Field label="Tài khoản đăng nhập">
              <input type="text" value={form.loginUsername}
                onChange={e => setField('loginUsername', e.target.value)}
                placeholder="user@example.com" className="input" />
            </Field>
            <Field label="Mã đại lý (tùy chọn)">
              <input type="text" value={form.agencyCode}
                onChange={e => setField('agencyCode', e.target.value)}
                placeholder="VD: 12345678" className="input font-mono" />
            </Field>
            <Field label={isEdit ? 'Mật khẩu mới (để trống = giữ nguyên)' : 'Mật khẩu'}>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={form.password}
                  onChange={e => setField('password', e.target.value)}
                  placeholder={isEdit ? '(không đổi)' : 'Mật khẩu'}
                  className="input pr-16 font-mono" />
                <button type="button" onClick={() => setShowPw(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-blue-600 hover:text-blue-800">
                  {showPw ? 'Ẩn' : 'Hiện'}
                </button>
              </div>
            </Field>
            <div className="p-2 rounded-md bg-blue-50 border border-blue-100 text-[11px] text-blue-800">
              🔒 Mật khẩu được mã hóa AES-GCM ở máy chủ, xem lại cần 2FA (mã Google Authenticator 6 số).
            </div>
          </>
        )}

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
      </form>
    </Modal>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-[11px] font-semibold text-gray-600 mb-1">{label}</div>
      {children}
    </label>
  )
}

import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import { createLookup, updateLookup } from '../../services/vmbApi'
import { generateTOTP, parseOtpauth, parseMigration, decodeQrFromImage } from '../../lib/totp'
import { add2fa, addMany2fa } from '../../lib/twoFaStore'

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
  // 2026-11-12: state cho loại 2FA (lưu local, không gọi backend)
  const [twoFaTab, setTwoFaTab] = useState('secret') // 'secret' | 'qr'
  const [qrErr, setQrErr] = useState('')
  const fileRef = useRef(null)

  const [form, setForm] = useState(() => ({
    type: row?.type || 'PLAIN',
    keyword: row?.keyword || '',
    details: row?.details || '',
    loginUrl: row?.loginUrl || '',
    loginUsername: row?.loginUsername || '',
    agencyCode: row?.agencyCode || '',
    password: '',
    issuer: '',
    secret: '',
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
    if (!form.keyword.trim()) return toast.error('Tên / từ khóa không được để trống')

    // ── 2026-11-12: Loại 2FA — lưu LOCAL (localStorage), không gọi backend ──
    if (form.type === '2FA') {
      const s = (form.secret || '').replace(/\s/g, '')
      if (!s) return toast.error('Nhập chuỗi bí mật hoặc quét QR')
      setBusy(true)
      try {
        const code = await generateTOTP(s, {})
        if (!code) { toast.error('Chuỗi bí mật không hợp lệ (base32)'); return }
        add2fa({ name: form.keyword.trim(), issuer: form.issuer.trim(), secret: s, digits: 6, period: 30, algorithm: 'SHA1' })
        toast.success('Đã thêm 2FA')
        onSaved()
      } finally { setBusy(false) }
      return
    }

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

  // Quét/chụp ảnh QR → nhập 2FA (hỗ trợ cả QR export nhiều tài khoản).
  const onPickQr = async (file) => {
    if (!file) return
    setQrErr('')
    try {
      const raw = await decodeQrFromImage(file)
      if (/^otpauth-migration:/i.test(raw)) {
        const accounts = parseMigration(raw)
        if (accounts && accounts.length) {
          const n = addMany2fa(accounts)
          toast.success(`Đã nhập ${n} tài khoản 2FA`)
          onSaved(); return
        }
        setQrErr('Không đọc được dữ liệu export (otpauth-migration).'); return
      }
      const parsed = parseOtpauth(raw)
      if (parsed) {
        add2fa({
          name: form.keyword.trim() || parsed.name, issuer: form.issuer.trim() || parsed.issuer,
          secret: parsed.secret, digits: parsed.digits, period: parsed.period, algorithm: parsed.algorithm,
        })
        toast.success('Đã thêm 2FA'); onSaved(); return
      }
      setField('secret', raw.replace(/\s/g, '')); setTwoFaTab('secret')
      setQrErr('QR không theo chuẩn otpauth — đã điền vào ô chuỗi bí mật, kiểm tra & lưu.')
    } catch (err) {
      setQrErr(err.message || 'Không đọc được QR.'); setTwoFaTab('secret')
    } finally { if (fileRef.current) fileRef.current.value = '' }
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
              { key: 'PLAIN',   label: '📄 Thông tin' },
              { key: 'ACCOUNT', label: '🔐 Tài khoản' },
              // 2FA chỉ cho TẠO mới (entry 2FA lưu local, không sửa qua form này)
              ...(!isEdit ? [{ key: '2FA', label: '🔑 2FA' }] : []),
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

        <Field label={form.type === '2FA' ? 'Tên' : 'Từ khóa'}>
          <input type="text" value={form.keyword} autoFocus
            onChange={e => setField('keyword', e.target.value)}
            placeholder={form.type === '2FA'
              ? 'VD: Gmail công ty, Amadeus…'
              : 'Ví dụ: Điều kiện vé VJ / Tài khoản Amadeus'}
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
              🔒 Mật khẩu được mã hóa AES-GCM ở máy chủ, xem lại cần nhập mã PIN 6 số.
            </div>
          </>
        )}

        {form.type === '2FA' && (
          <>
            <Field label="Nhà cung cấp (tùy chọn)">
              <input type="text" value={form.issuer}
                onChange={e => setField('issuer', e.target.value)}
                placeholder="VD: Google, Microsoft…" className="input" />
            </Field>

            <div className="flex gap-1 p-0.5 rounded-lg bg-gray-100 border border-gray-200">
              <button type="button" onClick={() => setTwoFaTab('secret')}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold ${twoFaTab === 'secret' ? 'bg-white shadow text-blue-700' : 'text-gray-600'}`}>
                🔑 Chuỗi bí mật
              </button>
              <button type="button" onClick={() => setTwoFaTab('qr')}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold ${twoFaTab === 'qr' ? 'bg-white shadow text-blue-700' : 'text-gray-600'}`}>
                📷 Mã QR
              </button>
            </div>

            {twoFaTab === 'secret' ? (
              <Field label="Chuỗi bí mật (base32)">
                <input type="text" value={form.secret}
                  onChange={e => setField('secret', e.target.value)}
                  placeholder="VD: JBSWY3DPEHPK3PXP" className="input font-mono" />
              </Field>
            ) : (
              <div>
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="w-full px-3 py-3 rounded-lg border-2 border-dashed border-blue-300 text-blue-700 text-sm font-semibold hover:bg-blue-50">
                  📷 Chụp / chọn ảnh mã QR
                </button>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={e => onPickQr(e.target.files?.[0])} />
                <div className="text-[11px] text-gray-400 mt-1">
                  Hỗ trợ QR otpauth lẻ và QR export nhiều tài khoản của Google Authenticator (Chrome/Android).
                </div>
              </div>
            )}

            {qrErr && <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{qrErr}</div>}

            <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-700">
              🔒 Secret chỉ lưu trên thiết bị này (không đồng bộ lên máy chủ).
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
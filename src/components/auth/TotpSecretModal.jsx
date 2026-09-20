import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import ConfirmModal from '../common/ConfirmModal'
import api from '../../services/api'
import { copyText } from '../../lib/clipboard'

/**
 * Xem / xoay TOTP secret của 1 tài khoản tools.
 *
 * Dùng bởi admin từ UserManagerModal.
 *
 * ── Cách người dùng nhận secret ────────────────────────────
 * Chuỗi base32 (VD "JBSWY3DPEHPK3PXP...") hiện ở đây kèm nút Copy. User mở
 * app authenticator → "Thêm tài khoản" → "Nhập khóa thiết lập" → paste chuỗi.
 * Cũng hiển thị otpauth:// URI để ai dùng QR extension trong browser có thể
 * copy nhanh — nhưng không render QR (tránh phụ thuộc thư viện QR).
 *
 * ── Xoay secret ────────────────────────────────────────────
 * Sinh chuỗi mới → secret cũ hết tác dụng ngay. User buộc cấu hình lại app.
 * Có ConfirmModal để tránh bấm nhầm.
 */
export default function TotpSecretModal({ user, onClose }) {
  const [secret, setSecret] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmRegen, setConfirmRegen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get(`/api/tools/users/${user.id}/totp-secret`)
      setSecret(res.data?.data?.secret || '')
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Không lấy được secret')
    } finally {
      setLoading(false)
    }
  }, [user.id])

  useEffect(() => { load() }, [load])

  const doRegen = async () => {
    setBusy(true)
    try {
      const res = await api.post(`/api/tools/users/${user.id}/totp-secret/regenerate`)
      setSecret(res.data?.data?.secret || '')
      toast.success('Đã sinh secret mới — cấu hình lại app authenticator ngay')
      setConfirmRegen(false)
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Xoay secret thất bại')
    } finally {
      setBusy(false)
    }
  }

  const doCopy = async () => {
    const ok = await copyText(secret)
    if (ok) toast.success('Đã copy secret')
  }

  const otpauth = secret
    ? `otpauth://totp/NhatNamTools:${encodeURIComponent(user.username)}?secret=${secret}&issuer=NhatNamTools`
    : ''

  const doCopyUri = async () => {
    const ok = await copyText(otpauth)
    if (ok) toast.success('Đã copy URI')
  }

  return (
    <>
      <Modal
        open
        onClose={busy ? undefined : onClose}
        title={`Mã 2FA — ${user.username}`}
        size="md"
        closeOnBackdrop={!busy}
      >
        {loading ? (
          <div className="py-8 text-center text-gray-400 text-sm">Đang tải…</div>
        ) : !secret ? (
          <div className="py-6 text-center">
            <div className="text-4xl mb-2">🔑</div>
            <p className="text-sm text-gray-600 mb-4">
              Tài khoản này chưa có secret. Sinh secret để bật 2FA.
            </p>
            <button type="button" onClick={() => setConfirmRegen(true)}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
              🎲 Sinh secret
            </button>
          </div>
        ) : (
          <>
            <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 mb-3">
              <div className="text-[10px] font-bold text-blue-800 uppercase mb-1">
                Setup key (base32)
              </div>
              <div className="flex items-center gap-2">
                <span className="flex-1 font-mono text-sm text-gray-900 tracking-wider break-all select-all">
                  {secret}
                </span>
                <button type="button" onClick={doCopy}
                  className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shrink-0">
                  📋 Copy
                </button>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 mb-3">
              <div className="text-[10px] font-bold text-gray-600 uppercase mb-1">
                otpauth:// URI (cho QR scanner)
              </div>
              <div className="flex items-center gap-2">
                <span className="flex-1 font-mono text-[11px] text-gray-700 truncate">
                  {otpauth}
                </span>
                <button type="button" onClick={doCopyUri}
                  className="px-2 py-1 rounded-md bg-white border border-gray-300 text-xs hover:bg-gray-100 shrink-0">
                  Copy
                </button>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
              <div className="font-bold">📱 Cách cài Google Authenticator</div>
              <ol className="list-decimal list-inside space-y-0.5 ml-1">
                <li>Mở app → dấu <b>+</b> → chọn <b>"Nhập khóa thiết lập"</b></li>
                <li>Tên tài khoản: <b>{user.username}</b> (hoặc tự đặt)</li>
                <li>Khóa: dán chuỗi phía trên</li>
                <li>Loại: <b>Dựa trên thời gian (TOTP)</b></li>
              </ol>
            </div>

            <div className="mt-4 pt-3 border-t border-gray-200 flex justify-between items-center">
              <button type="button" onClick={() => setConfirmRegen(true)} disabled={busy}
                className="text-xs font-semibold text-rose-600 hover:text-rose-800 disabled:opacity-50">
                🔄 Xoay secret (hủy secret cũ)
              </button>
              <button type="button" onClick={onClose} disabled={busy}
                className="px-3 py-1.5 rounded-md bg-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-300">
                Đóng
              </button>
            </div>
          </>
        )}
      </Modal>

      {confirmRegen && (
        <ConfirmModal
          isOpen
          title="Xoay secret mới?"
          message={
            secret
              ? `Secret cũ của "${user.username}" sẽ hết tác dụng ngay lập tức. User cần cấu hình lại app authenticator bằng secret mới. Tiếp tục?`
              : `Sinh secret mới cho "${user.username}"?`
          }
          confirmText="Xoay"
          type="danger"
          onConfirm={doRegen}
          onClose={() => setConfirmRegen(false)}
        />
      )}
    </>
  )
}

import { useEffect, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import Badge from '../common/Badge'
import ConfirmModal from '../common/ConfirmModal'
import TotpSecretModal from './TotpSecretModal'
import { useToolsAuth } from '../../hooks/useToolsAuth'
import {
  listToolsUsers, createToolsUser, updateToolsUser, deleteToolsUser,
} from '../../services/api'

/**
 * Danh sách + thêm/sửa/xóa tài khoản. Chỉ admin mới thấy nút mở.
 *
 * KHÔNG cho tự vô hiệu / tự xoá / tự tước quyền admin — quy tắc này BE cũng
 * enforce (an toàn kép), UI ẩn nút tương ứng ở dòng của chính mình để đỡ phải
 * nhìn nút bị lỗi.
 */
export default function UserManagerModal({ onClose }) {
  const { auth } = useToolsAuth()
  const me = auth?.username

  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(null) // null | 'new' | user object
  const [showTotp, setShowTotp] = useState(null) // user object đang xem 2FA secret
  const [confirmDelete, setConfirmDelete] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listToolsUsers()
      setUsers(res.data?.data || [])
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Không tải được danh sách người dùng')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="Quản lý người dùng"
        size="lg"
        footer={
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500">
              {users.length} tài khoản
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-200">
                Đóng
              </button>
              <button type="button" onClick={() => setShowForm('new')}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                + Thêm người dùng
              </button>
            </div>
          </div>
        }
      >
        {loading ? (
          <div className="py-8 text-center text-gray-400 text-sm">Đang tải…</div>
        ) : users.length === 0 ? (
          <div className="py-8 text-center text-gray-400 text-sm">Chưa có tài khoản.</div>
        ) : (
          <div className="overflow-x-auto -mx-5 sm:-mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-200 text-xs uppercase text-gray-500">
                  <th className="px-5 sm:px-6 py-2 font-semibold">Tài khoản</th>
                  <th className="px-3 py-2 font-semibold">Tên hiển thị</th>
                  <th className="px-3 py-2 font-semibold">Vai trò</th>
                  <th className="px-3 py-2 font-semibold">Trạng thái</th>
                  <th className="px-5 sm:px-6 py-2 font-semibold text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const isMe = u.username === me
                  return (
                    <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-5 sm:px-6 py-3">
                        <div className="font-mono text-gray-800">
                          {u.username}
                          {isMe && <span className="ml-2 text-[10px] font-bold text-blue-600">(BẠN)</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-gray-700">{u.displayName || '—'}</td>
                      <td className="px-3 py-3">
                        {u.admin
                          ? <Badge color="purple">Admin</Badge>
                          : <Badge color="gray">Người dùng</Badge>}
                      </td>
                      <td className="px-3 py-3">
                        {u.active
                          ? <Badge color="green" dot>Đang hoạt động</Badge>
                          : <Badge color="red" dot>Đã vô hiệu</Badge>}
                      </td>
                      <td className="px-5 sm:px-6 py-3 text-right">
                        <button type="button" onClick={() => setShowForm(u)}
                          className="px-2.5 py-1 text-xs rounded-md text-blue-600 hover:bg-blue-50 font-semibold">
                          Sửa
                        </button>
                        <button type="button" onClick={() => setShowTotp(u)}
                          title="Xem / xoay mã 2FA (Google Authenticator)"
                          className="ml-1 px-2.5 py-1 text-xs rounded-md text-amber-600 hover:bg-amber-50 font-semibold">
                          🔑 2FA
                        </button>
                        {!isMe && (
                          <button type="button" onClick={() => setConfirmDelete(u)}
                            className="ml-1 px-2.5 py-1 text-xs rounded-md text-rose-600 hover:bg-rose-50 font-semibold">
                            Xóa
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {showForm && (
        <UserFormModal
          user={showForm === 'new' ? null : showForm}
          onClose={() => setShowForm(null)}
          onSaved={() => { setShowForm(null); load() }}
        />
      )}

      {showTotp && (
        <TotpSecretModal
          user={showTotp}
          onClose={() => setShowTotp(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          isOpen
          title="Xóa tài khoản"
          message={`Xóa "${confirmDelete.username}"? Dữ liệu (ảnh/tệp/todo) người này đã tạo VẪN GIỮ LẠI trên hệ thống — nếu muốn giữ chủ sở hữu cũ, hãy vô hiệu hóa thay vì xóa.`}
          confirmText="Xóa"
          type="danger"
          onConfirm={async () => {
            try {
              await deleteToolsUser(confirmDelete.id)
              toast.success('Đã xóa tài khoản')
              setConfirmDelete(null)
              load()
            } catch (e) {
              toast.error(e?.response?.data?.message || 'Xóa thất bại')
            }
          }}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </>
  )
}

// ── Form thêm/sửa ──────────────────────────────────────────────

function UserFormModal({ user, onClose, onSaved }) {
  const { auth } = useToolsAuth()
  const me = auth?.username
  const isEdit = !!user
  const isSelf = isEdit && user.username === me

  const [username, setUsername]       = useState(user?.username || '')
  const [displayName, setDisplayName] = useState(user?.displayName || '')
  const [admin, setAdmin]             = useState(user?.admin || false)
  const [active, setActive]           = useState(user?.active !== false)
  const [password, setPassword]       = useState('')
  const [busy, setBusy]               = useState(false)

  const submit = async e => {
    e.preventDefault()
    if (!isEdit && !password) return toast.error('Nhập mật khẩu ban đầu')
    setBusy(true)
    try {
      if (isEdit) {
        const body = { displayName, admin, active }
        if (password) body.newPassword = password
        // Không gửi field mà BE sẽ từ chối cho chính mình
        if (isSelf) { delete body.admin; delete body.active }
        await updateToolsUser(user.id, body)
        toast.success('Đã cập nhật')
      } else {
        await createToolsUser({ username, displayName, admin, password })
        toast.success('Đã tạo tài khoản')
      }
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
      title={isEdit ? `Sửa: ${user.username}` : 'Thêm người dùng'}
      size="sm"
      closeOnBackdrop={!busy}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-200 disabled:opacity-50">
            Hủy
          </button>
          <button type="submit" form="uf-form" disabled={busy}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white
                       hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Đang lưu…' : (isEdit ? 'Lưu thay đổi' : 'Tạo tài khoản')}
          </button>
        </div>
      }
    >
      <form id="uf-form" onSubmit={submit} className="space-y-3">
        <Field label="Tên đăng nhập">
          <input
            type="text" required autoFocus={!isEdit}
            disabled={isEdit}
            value={username}
            onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
            className={`w-full px-3 py-2 rounded-lg border border-gray-300 text-sm font-mono
              focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none
              ${isEdit ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-white'}`}
            placeholder="vd: nguyenhai"
          />
          {!isEdit && (
            <div className="text-[11px] text-gray-500 mt-1">
              Chữ thường, số, dấu chấm/gạch dưới/gạch ngang. Không đổi được sau khi tạo.
            </div>
          )}
        </Field>

        <Field label="Tên hiển thị">
          <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm
              focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
            placeholder="Nguyễn Văn A" />
        </Field>

        <Field label={isEdit ? 'Mật khẩu mới (để trống nếu không đổi)' : 'Mật khẩu ban đầu'}>
          <input type="password" required={!isEdit}
            value={password} onChange={e => setPassword(e.target.value)}
            autoComplete="new-password"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm
              focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
            placeholder="Ít nhất 4 ký tự" />
        </Field>

        {!isSelf && (
          <>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={admin} onChange={e => setAdmin(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <span>Quản trị viên (thấy được trang quản lý người dùng)</span>
            </label>

            {isEdit && (
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <span>Đang hoạt động (bỏ chọn để tạm khóa đăng nhập)</span>
              </label>
            )}
          </>
        )}

        {isSelf && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
            Bạn đang sửa chính tài khoản của mình — không thể bỏ quyền quản trị hay tự vô hiệu hoá.
          </div>
        )}
      </form>
    </Modal>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-gray-600 mb-1">{label}</div>
      {children}
    </label>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import ConfirmModal from '../common/ConfirmModal'
import {
  listMembershipCards, createMembershipCard, updateMembershipCard, deleteMembershipCard,
} from '../../services/vmbApi'

/**
 * Quản lý thẻ thành viên (frequent flyer) của một hành khách.
 *
 * Cấu trúc đơn giản: bảng liệt kê + inline row edit.
 *   - Dòng có id → view mode + nút "Sửa" / "Xóa"
 *   - Dòng đang edit hoặc dòng mới → 3 ô input (tên, số thẻ, hãng) + "Lưu"/"Hủy"
 *
 * Field {@code passengerName} lưu riêng chứ không đồng bộ với Passenger.fullName
 * vì tên in trên thẻ FF không đổi được sau khi phát hành — có thể khác chút so
 * với hộ chiếu.
 *
 * ── Copy số thẻ (2026-09-15) ─────────────────────────────
 * Ở view mode, click vào số thẻ → copy vào clipboard + hiện feedback "Đã copy"
 * trong ~1.2s. Có fallback execCommand cho trình duyệt cũ / non-HTTPS.
 */
export default function MembershipCardsModal({ passenger, onClose, onDirty }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // Editing state
  const [editingId, setEditingId] = useState(null)                       // id đang sửa
  const [editBuf, setEditBuf]     = useState(blankCard(passenger))       // form buffer
  const [adding, setAdding]       = useState(false)
  const [addBuf, setAddBuf]       = useState(blankCard(passenger))

  const [confirmDel, setConfirmDel] = useState(null)

  // Copy feedback: id của card vừa được copy (null = không hiện gì)
  const [copiedId, setCopiedId] = useState(null)
  const copyTimerRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listMembershipCards(passenger.id)
      setRows(res.data?.data || [])
    } catch (e) {
      toast.error('Không tải được thẻ')
    } finally {
      setLoading(false)
    }
  }, [passenger.id])

  useEffect(() => { load() }, [load])

  // Clear timer khi unmount
  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current) }, [])

  const startEdit = (c) => {
    setEditingId(c.id)
    setEditBuf({ passengerName: c.passengerName, cardNumber: c.cardNumber, airlineCode: c.airlineCode })
  }
  const cancelEdit = () => { setEditingId(null); setEditBuf(blankCard(passenger)) }

  const saveEdit = async () => {
    if (!validate(editBuf)) return
    setBusy(true)
    try {
      await updateMembershipCard(editingId, editBuf)
      toast.success('Đã lưu')
      cancelEdit()
      await load()
      onDirty?.()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Lưu thất bại')
    } finally {
      setBusy(false)
    }
  }

  const saveAdd = async () => {
    if (!validate(addBuf)) return
    setBusy(true)
    try {
      await createMembershipCard(passenger.id, addBuf)
      toast.success('Đã thêm thẻ')
      setAdding(false)
      setAddBuf(blankCard(passenger))
      await load()
      onDirty?.()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Thêm thẻ thất bại')
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    setBusy(true)
    try {
      await deleteMembershipCard(confirmDel.id)
      toast.success('Đã xóa')
      setConfirmDel(null)
      await load()
      onDirty?.()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Xóa thất bại')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyCardNumber = async (c) => {
    const ok = await copyToClipboard(c.cardNumber)
    if (!ok) {
      toast.error('Không copy được — hãy copy thủ công')
      return
    }
    setCopiedId(c.id)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopiedId(null), 1200)
  }

  return (
    <>
      <Modal
        open
        onClose={busy ? undefined : onClose}
        title={`Thẻ thành viên — ${passenger.fullName}`}
        size="lg"
        closeOnBackdrop={!busy}
      >
        {loading ? (
          <div className="py-8 text-center text-gray-400 text-sm">Đang tải…</div>
        ) : (
          <>
            {rows.length === 0 && !adding ? (
              <div className="p-6 rounded-xl border-2 border-dashed border-gray-200 text-center">
                <div className="text-3xl mb-2">💳</div>
                <div className="text-sm text-gray-500 mb-3">Chưa có thẻ nào</div>
                <button type="button" onClick={() => setAdding(true)}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
                  + Thêm thẻ thành viên
                </button>
              </div>
            ) : (
              <>
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase text-[10px]">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold">Tên trên thẻ</th>
                        <th className="text-left px-3 py-2 font-semibold">Số thẻ</th>
                        <th className="text-left px-3 py-2 font-semibold">Hãng bay</th>
                        <th className="text-right px-3 py-2 font-semibold w-32">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(c => (
                        <tr key={c.id} className="border-b border-gray-100 last:border-none hover:bg-blue-50/40">
                          {editingId === c.id ? (
                            <EditRow buf={editBuf} setBuf={setEditBuf}
                              onSave={saveEdit} onCancel={cancelEdit} busy={busy} />
                          ) : (
                            <>
                              <td className="px-3 py-2 uppercase font-medium text-gray-900">{c.passengerName}</td>
                              <td className="px-3 py-2">
                                <CardNumberButton
                                  value={c.cardNumber}
                                  copied={copiedId === c.id}
                                  onClick={() => handleCopyCardNumber(c)}
                                />
                              </td>
                              <td className="px-3 py-2 font-mono uppercase text-xs text-gray-900">{c.airlineCode}</td>
                              <td className="px-3 py-2">
                                <div className="flex justify-end gap-1">
                                  <button onClick={() => startEdit(c)}
                                    className="w-7 h-7 rounded-md text-gray-600 hover:bg-gray-200 flex items-center justify-center">✎</button>
                                  <button onClick={() => setConfirmDel(c)}
                                    className="w-7 h-7 rounded-md text-gray-600 hover:bg-rose-100 hover:text-rose-700 flex items-center justify-center">🗑</button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                      {adding && (
                        <tr className="border-t border-blue-200 bg-blue-50/40">
                          <EditRow buf={addBuf} setBuf={setAddBuf}
                            onSave={saveAdd} onCancel={() => { setAdding(false); setAddBuf(blankCard(passenger)) }}
                            busy={busy} isAdd />
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {!adding && (
                  <div className="mt-3 flex justify-end">
                    <button type="button" onClick={() => setAdding(true)}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-800">
                      + Thêm thẻ khác
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Modal>

      {confirmDel && (
        <ConfirmModal
          isOpen
          title="Xóa thẻ"
          message={`Xóa thẻ "${confirmDel.cardNumber}" (${confirmDel.airlineCode})?`}
          confirmText="Xóa"
          type="danger"
          onConfirm={doDelete}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </>
  )
}

/**
 * Nút hiển thị số thẻ — click để copy. Khi `copied=true` đổi màu xanh + đổi
 * icon thành dấu ✓ và label "Đã copy" trong ~1.2s.
 */
function CardNumberButton({ value, copied, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Click để copy số thẻ"
      className={[
        'group inline-flex items-center gap-1.5 px-2 py-1 -mx-1 rounded-md',
        'font-mono text-xs transition-colors',
        copied
          ? 'bg-emerald-50 text-emerald-700'
          : 'text-gray-900 hover:bg-gray-100 active:bg-gray-200',
      ].join(' ')}
    >
      <span>{value}</span>
      <span className={[
        'text-[11px] leading-none',
        copied ? 'text-emerald-600' : 'text-gray-400 group-hover:text-gray-600',
      ].join(' ')}>
        {copied ? '✓' : '⧉'}
      </span>
    </button>
  )
}

function EditRow({ buf, setBuf, onSave, onCancel, busy, isAdd }) {
  const set = (k, v) => setBuf(b => ({ ...b, [k]: v }))
  return (
    <>
      <td className="px-2 py-1.5">
        <input type="text" value={buf.passengerName}
          onChange={e => set('passengerName', e.target.value.toUpperCase())}
          placeholder="NGUYEN VAN A"
          className="w-full px-2 py-1 rounded-md border border-gray-300 text-xs uppercase focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none" />
      </td>
      <td className="px-2 py-1.5">
        <input type="text" value={buf.cardNumber}
          onChange={e => set('cardNumber', e.target.value)}
          placeholder="Số thẻ"
          className="w-full px-2 py-1 rounded-md border border-gray-300 text-xs font-mono focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none" />
      </td>
      <td className="px-2 py-1.5">
        <input type="text" value={buf.airlineCode}
          onChange={e => set('airlineCode', e.target.value.toUpperCase())}
          placeholder="VN, VJ, JL…"
          className="w-full px-2 py-1 rounded-md border border-gray-300 text-xs font-mono uppercase focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none" />
      </td>
      <td className="px-2 py-1.5">
        <div className="flex justify-end gap-1">
          <button type="button" onClick={onSave} disabled={busy}
            className="px-2 py-1 rounded-md bg-blue-600 text-white text-[11px] font-semibold hover:bg-blue-700 disabled:opacity-50">
            {isAdd ? 'Thêm' : 'Lưu'}
          </button>
          <button type="button" onClick={onCancel} disabled={busy}
            className="px-2 py-1 rounded-md bg-gray-100 text-gray-700 text-[11px] hover:bg-gray-200 disabled:opacity-50">
            Hủy
          </button>
        </div>
      </td>
    </>
  )
}

function blankCard(passenger) {
  return {
    passengerName: passenger?.fullName?.toUpperCase() || '',
    cardNumber: '',
    airlineCode: '',
  }
}

function validate(c) {
  if (!c.passengerName?.trim()) { toast.error('Nhập tên trên thẻ'); return false }
  if (!c.cardNumber?.trim())    { toast.error('Nhập số thẻ');       return false }
  if (!c.airlineCode?.trim())   { toast.error('Nhập hãng bay');     return false }
  return true
}

/**
 * Copy text vào clipboard. Trả về true nếu thành công.
 * Ưu tiên navigator.clipboard (cần HTTPS hoặc localhost); fallback
 * execCommand cho môi trường không có / trình duyệt cũ.
 */
async function copyToClipboard(text) {
  if (text == null) return false
  const value = String(text)

  // Cách 1: Clipboard API hiện đại
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch (_) {
      // rơi xuống fallback
    }
  }

  // Cách 2: fallback bằng textarea ẩn
  try {
    const ta = document.createElement('textarea')
    ta.value = value
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, ta.value.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch (_) {
    return false
  }
}
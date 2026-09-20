import { useState, useRef, useEffect } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import DateTimePicker from './DateTimePicker'
import { vmbFileUrl } from '../../services/api'
import { completeTodo, extendTodo, cancelTodo, createTodo, updateTodo } from '../../services/todoApi'

/**
 * Gom các modal thao tác task vào 1 file cho gọn:
 *   TaskFormModal    — tạo/sửa task (unitName, description, deadline, note)
 *   TaskCompleteModal — hoàn thành (bắt buộc upload ảnh/pdf + note)
 *   TaskExtendModal   — gia hạn (chọn deadline mới + note)
 *   TaskCancelModal   — hủy (note bắt buộc)
 *   TaskDetailModal   — xem chi tiết task đã hoàn thành/hủy (readonly)
 *
 * Mỗi modal đều có confirm bước cuối trước khi gọi API.
 */

// ══════════════════════════════════════════════════════════════
//  FORM (create / edit)
// ══════════════════════════════════════════════════════════════

export function TaskFormModal({ open, initial, onClose, onSaved }) {
  const isEdit = !!initial?.id
  const [unitName, setUnitName] = useState(initial?.unitName || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [deadline, setDeadline] = useState(() => initial?.deadline ? new Date(initial.deadline) : new Date(Date.now() + 60 * 60 * 1000))
  const [note, setNote] = useState(initial?.note || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (open) {
      setUnitName(initial?.unitName || '')
      setDescription(initial?.description || '')
      setDeadline(initial?.deadline ? new Date(initial.deadline) : new Date(Date.now() + 60 * 60 * 1000))
      setNote(initial?.note || '')
      setErr('')
    }
  }, [open, initial])

  if (!open) return null

  const submit = async () => {
    setErr('')
    if (!unitName.trim()) { setErr('Nhập tên đơn vị.'); return }
    if (!deadline)        { setErr('Chọn deadline.'); return }
    setBusy(true)
    try {
      const body = {
        unitName: unitName.trim(),
        description: description.trim(),
        deadline: deadline.getTime(),
        note: note.trim(),
      }
      const res = isEdit ? await updateTodo(initial.id, body) : await createTodo(body)
      if (res.data?.error) throw new Error(res.data.message || 'Lỗi')
      toast.success(isEdit ? 'Đã cập nhật task' : 'Đã tạo task')
      onSaved?.(res.data.data)
      onClose()
    } catch (e) {
      setErr(e.message || 'Thao tác thất bại')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Sửa task' : 'Tạo task mới'} size="lg">
      {err && <ErrorBanner text={err} />}
      <div className="space-y-3">
        <div>
          <Label>Tên đơn vị *</Label>
          <input type="text" value={unitName} onChange={e => setUnitName(e.target.value)}
            placeholder="VD: Công ty A" className={inputCls} autoFocus />
        </div>
        <div>
          <Label>Mô tả công việc</Label>
          <textarea value={description} onChange={e => setDescription(e.target.value)}
            rows={2} placeholder="VD: Gửi báo cáo Q3, ký hợp đồng…" className={inputCls} />
        </div>
        <div>
          <Label>Deadline *</Label>
          <DateTimePicker value={deadline} onChange={setDeadline} minDate={new Date()} />
        </div>
        <div>
          <Label>Ghi chú (tùy chọn)</Label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder="VD: liên hệ chị Lan trước 5h" className={inputCls} />
        </div>
      </div>
      <FooterActions onCancel={onClose} onOk={submit} okLabel={isEdit ? 'Lưu' : 'Tạo task'} busy={busy} />
    </Modal>
  )
}

// ══════════════════════════════════════════════════════════════
//  COMPLETE
// ══════════════════════════════════════════════════════════════

export function TaskCompleteModal({ open, task, onClose, onDone }) {
  const [file, setFile] = useState(null)
  const [note, setNote] = useState('')
  const [confirmMode, setConfirmMode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef()

  useEffect(() => {
    if (open) { setFile(null); setNote(''); setConfirmMode(false); setErr('') }
  }, [open])

  if (!open || !task) return null

  const submit = async () => {
    setErr('')
    if (!file) { setErr('Cần chọn ảnh/PDF minh chứng.'); return }
    if (!confirmMode) { setConfirmMode(true); return }
    setBusy(true)
    try {
      const res = await completeTodo(task.id, file, note)
      if (res.data?.error) throw new Error(res.data.message || 'Lỗi')
      toast.success('Đã hoàn thành task ✓')
      onDone?.(res.data.data)
      onClose()
    } catch (e) {
      setErr(e.message || 'Thao tác thất bại')
      toast.error(e.message || 'Thất bại')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Hoàn thành task" size="md">
      {err && <ErrorBanner text={err} />}
      <div className="mb-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
        <div className="text-sm font-bold text-emerald-900">{task.unitName}</div>
        {task.description && <div className="text-xs text-emerald-700 mt-0.5">{task.description}</div>}
      </div>

      <Label>Ảnh/PDF minh chứng *</Label>
      <input ref={fileRef} type="file" className="hidden"
        accept="image/*,application/pdf"
        onChange={e => setFile(e.target.files?.[0] || null)} />
      <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
        className="w-full px-3 py-2 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-40">
        {file ? `📎 ${file.name}` : '+ Chọn file'}
      </button>

      <div className="mt-3">
        <Label>Ghi chú (tùy chọn)</Label>
        <input type="text" value={note} onChange={e => setNote(e.target.value)}
          placeholder="VD: Đã gửi mail xác nhận" className={inputCls} />
      </div>

      {confirmMode && (
        <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-300 text-sm text-amber-900">
          Xác nhận hoàn thành task này? Trạng thái sẽ chuyển sang <b>Đã hoàn thành</b> và không thể thay đổi.
        </div>
      )}

      <FooterActions onCancel={onClose} onOk={submit}
        okLabel={confirmMode ? 'Xác nhận' : 'Hoàn thành'} okColor="emerald" busy={busy} />
    </Modal>
  )
}

// ══════════════════════════════════════════════════════════════
//  EXTEND
// ══════════════════════════════════════════════════════════════

export function TaskExtendModal({ open, task, onClose, onDone }) {
  const [deadline, setDeadline] = useState(() => task ? new Date(task.deadline) : new Date())
  const [note, setNote] = useState('')
  const [confirmMode, setConfirmMode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (open && task) { setDeadline(new Date(task.deadline)); setNote(''); setConfirmMode(false); setErr('') }
  }, [open, task])

  if (!open || !task) return null

  const submit = async () => {
    setErr('')
    if (!deadline) { setErr('Chọn deadline mới.'); return }
    if (deadline.getTime() <= Date.now()) { setErr('Deadline phải lớn hơn thời điểm hiện tại.'); return }
    if (!confirmMode) { setConfirmMode(true); return }
    setBusy(true)
    try {
      const res = await extendTodo(task.id, deadline.getTime(), note)
      if (res.data?.error) throw new Error(res.data.message || 'Lỗi')
      toast.success('Đã gia hạn task')
      onDone?.(res.data.data)
      onClose()
    } catch (e) {
      setErr(e.message || 'Thao tác thất bại')
      toast.error(e.message || 'Thất bại')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Gia hạn task" size="lg">
      {err && <ErrorBanner text={err} />}
      <div className="mb-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
        <div className="text-sm font-bold text-blue-900">{task.unitName}</div>
        <div className="text-xs text-blue-700 mt-0.5">
          Deadline hiện tại: <b>{fmtDeadline(task.deadline)}</b>
        </div>
      </div>

      <Label>Deadline mới *</Label>
      <DateTimePicker value={deadline} onChange={setDeadline} minDate={new Date()} />

      <div className="mt-3">
        <Label>Lý do / ghi chú (tùy chọn)</Label>
        <input type="text" value={note} onChange={e => setNote(e.target.value)}
          placeholder="VD: Khách xin dời qua tuần sau" className={inputCls} />
      </div>

      {confirmMode && (
        <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-300 text-sm text-amber-900">
          Xác nhận gia hạn task này đến <b>{fmtDeadline(deadline.getTime())}</b>?
        </div>
      )}

      <FooterActions onCancel={onClose} onOk={submit}
        okLabel={confirmMode ? 'Xác nhận' : 'Gia hạn'} okColor="blue" busy={busy} />
    </Modal>
  )
}

// ══════════════════════════════════════════════════════════════
//  CANCEL
// ══════════════════════════════════════════════════════════════

export function TaskCancelModal({ open, task, onClose, onDone }) {
  const [note, setNote] = useState('')
  const [confirmMode, setConfirmMode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (open) { setNote(''); setConfirmMode(false); setErr('') }
  }, [open])

  if (!open || !task) return null

  const submit = async () => {
    setErr('')
    if (!note.trim()) { setErr('Cần nhập lý do hủy.'); return }
    if (!confirmMode) { setConfirmMode(true); return }
    setBusy(true)
    try {
      const res = await cancelTodo(task.id, note.trim())
      if (res.data?.error) throw new Error(res.data.message || 'Lỗi')
      toast.success('Đã hủy task')
      onDone?.(res.data.data)
      onClose()
    } catch (e) {
      setErr(e.message || 'Thao tác thất bại')
      toast.error(e.message || 'Thất bại')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Hủy task" size="md">
      {err && <ErrorBanner text={err} />}
      <div className="mb-3 p-3 rounded-lg bg-rose-50 border border-rose-200">
        <div className="text-sm font-bold text-rose-900">{task.unitName}</div>
        {task.description && <div className="text-xs text-rose-700 mt-0.5">{task.description}</div>}
      </div>

      <Label>Lý do hủy *</Label>
      <textarea value={note} onChange={e => setNote(e.target.value)}
        rows={3} placeholder="VD: Khách đã hủy hợp đồng, không cần xử lý…" className={inputCls} />

      {confirmMode && (
        <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-300 text-sm text-amber-900">
          Xác nhận hủy task này? Trạng thái sẽ chuyển sang <b>Đã hủy</b> và không thể khôi phục.
        </div>
      )}

      <FooterActions onCancel={onClose} onOk={submit}
        okLabel={confirmMode ? 'Xác nhận' : 'Hủy task'} okColor="rose" busy={busy} />
    </Modal>
  )
}

// ══════════════════════════════════════════════════════════════
//  DETAIL (readonly cho task đã hoàn thành / hủy)
// ══════════════════════════════════════════════════════════════

export function TaskDetailModal({ open, task, onClose }) {
  if (!open || !task) return null
  const isCompleted = task.status === 'COMPLETED'
  const isCancelled = task.status === 'CANCELLED'
  const statusBadge = isCompleted
    ? { cls: 'bg-emerald-100 text-emerald-800', label: '✓ Đã hoàn thành' }
    : isCancelled
      ? { cls: 'bg-gray-200 text-gray-700', label: '✕ Đã hủy' }
      : { cls: 'bg-blue-100 text-blue-800', label: '⏳ Đang thực hiện' }

  const isImage = task.confirmationOriginal && /\.(jpg|jpeg|png|gif|webp)$/i.test(task.confirmationOriginal)

  return (
    <Modal open onClose={onClose} title="Chi tiết task" size="md">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className={`text-xs font-bold px-2 py-1 rounded ${statusBadge.cls}`}>
            {statusBadge.label}
          </span>
          <div className="text-[11px] text-gray-500">
            Cập nhật: {fmtDeadline(task.updatedAt)}
          </div>
        </div>

        <div>
          <Label>Tên đơn vị</Label>
          <div className="text-sm font-semibold text-gray-800">{task.unitName}</div>
        </div>

        {task.description && (
          <div>
            <Label>Mô tả công việc</Label>
            <div className="text-sm text-gray-700 whitespace-pre-line">{task.description}</div>
          </div>
        )}

        <div>
          <Label>Deadline</Label>
          <div className="text-sm text-gray-700">{fmtDeadline(task.deadline)}</div>
        </div>

        {task.note && (
          <div>
            <Label>Ghi chú</Label>
            <div className="text-sm text-gray-700 whitespace-pre-line">{task.note}</div>
          </div>
        )}

        {task.confirmationUrl && (
          <div>
            <Label>File minh chứng</Label>
            {isImage ? (
              <a href={vmbFileUrl(task.confirmationUrl)} target="_blank" rel="noopener noreferrer">
                <img src={vmbFileUrl(task.confirmationUrl)} alt="minh chứng"
                  className="mt-1 max-h-64 w-auto rounded-lg border border-gray-200" />
              </a>
            ) : (
              <a href={vmbFileUrl(task.confirmationUrl)} target="_blank" rel="noopener noreferrer"
                className="mt-1 inline-block px-3 py-2 rounded bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100">
                📄 {task.confirmationOriginal || 'Xem file'}
              </a>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <button onClick={onClose}
          className="px-4 py-2 rounded-md bg-gray-100 hover:bg-gray-200 text-sm font-semibold">
          Đóng
        </button>
      </div>
    </Modal>
  )
}

// ══════════════════════════════════════════════════════════════
//  Helpers UI
// ══════════════════════════════════════════════════════════════

const inputCls = 'w-full px-3 py-2 rounded-md border border-gray-300 bg-white text-sm outline-none focus:border-blue-500'

function Label({ children }) {
  return <div className="text-[11px] font-semibold text-gray-600 mb-1">{children}</div>
}

function ErrorBanner({ text }) {
  return (
    <div className="mb-3 p-2 rounded-md bg-rose-50 text-rose-700 text-xs border border-rose-200">{text}</div>
  )
}

function FooterActions({ onCancel, onOk, okLabel, okColor = 'blue', busy }) {
  const cls = {
    blue: 'bg-blue-600 hover:bg-blue-700',
    emerald: 'bg-emerald-600 hover:bg-emerald-700',
    rose: 'bg-rose-600 hover:bg-rose-700',
  }[okColor]
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button type="button" onClick={onCancel} disabled={busy}
        className="px-4 py-2 rounded-md bg-gray-100 hover:bg-gray-200 text-sm font-semibold disabled:opacity-40">
        Hủy
      </button>
      <button type="button" onClick={onOk} disabled={busy}
        className={`px-4 py-2 rounded-md text-white text-sm font-semibold disabled:opacity-40 ${cls}`}>
        {busy ? 'Đang xử lý…' : okLabel}
      </button>
    </div>
  )
}

function fmtDeadline(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}
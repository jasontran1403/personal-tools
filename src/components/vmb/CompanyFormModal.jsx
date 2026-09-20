import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import { createCompany, createCompanyBranch, updateCompany } from '../../services/vmbApi'

/**
 * Form tạo / sửa 1 công ty hoặc chi nhánh.
 *
 * ── 3 chế độ (props) ─────────────────────────────────────
 *   mode='create-root'      — tạo công ty gốc (parent = null)
 *   mode='create-branch'    — tạo chi nhánh của {parent} (parent = công ty gốc)
 *   mode='edit'             — sửa 1 công ty đã có (row = company hiện tại)
 *
 * ── Smart defaults khi tạo chi nhánh ─────────────────────
 * User bấm "+ Chi nhánh" ở 1 công ty đã có → form mở ra với các field
 * pre-fill để user chỉ cần confirm hoặc sửa nhẹ:
 *
 *   name       "{tên mẹ} - Chi nhánh {N+1}"   (N = số chi nhánh hiện có)
 *   shortName  "{shortName mẹ}-CN{N+1}"       (nếu mẹ có shortName)
 *   taxId      "{mst mẹ}-{N+1 pad 3}"         (nếu mẹ có mst)
 *   address    "" placeholder = mẹ.address
 *   phone      "" placeholder = mẹ.phone
 *   email      "" placeholder = mẹ.email
 *
 * User có thể sửa TẤT CẢ (không lock). Địa chỉ/SĐT/email để trống thì BE
 * lưu null — FE khi hiển thị sẽ auto-fallback về của công ty mẹ nếu cần.
 */
export default function CompanyFormModal({
  mode = 'create-root',
  parent = null,        // company gốc khi mode='create-branch'
  existingBranchCount = 0,
  row = null,           // company hiện tại khi mode='edit'
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState(() => initForm(mode, parent, row, existingBranchCount))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setForm(initForm(mode, parent, row, existingBranchCount))
  }, [mode, parent, row, existingBranchCount])

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name?.trim()) return toast.error('Tên công ty không được để trống.')

    setBusy(true)
    try {
      const body = {
        name: form.name.trim(),
        shortName: nz(form.shortName),
        address: nz(form.address),
        taxId: nz(form.taxId),
        phone: nz(form.phone),
        email: nz(form.email),
      }
      if (mode === 'create-root')        await createCompany(body)
      else if (mode === 'create-branch') await createCompanyBranch(parent.id, body)
      else                               await updateCompany(row.id, body)

      toast.success(mode === 'edit' ? 'Đã cập nhật' : 'Đã tạo')
      onSaved?.()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Lưu thất bại')
    } finally {
      setBusy(false)
    }
  }

  const title =
    mode === 'edit'          ? `Sửa: ${row?.name || ''}`
  : mode === 'create-branch' ? `Chi nhánh của "${parent?.name || ''}"`
  :                            'Công ty mới'

  return (
    <Modal open onClose={busy ? undefined : onClose} title={title} size="md"
      closeOnBackdrop={!busy}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-200 disabled:opacity-50">
            Hủy
          </button>
          <button type="submit" form="company-form" disabled={busy}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white
              hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Đang lưu…' : (mode === 'edit' ? 'Lưu' : 'Tạo')}
          </button>
        </div>
      }
    >
      <form id="company-form" onSubmit={submit} className="space-y-3">
        <Field label="Tên công ty *">
          <input type="text" value={form.name}
            onChange={e => setF('name', e.target.value)}
            placeholder="VD: Công ty TNHH ABC"
            className="input" required />
        </Field>

        <Field label="Tên viết tắt (hiển thị bảng vé)">
          <input type="text" value={form.shortName}
            onChange={e => setF('shortName', e.target.value)}
            placeholder="VD: ABC" maxLength={30}
            className="input" />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Mã số thuế">
            <input type="text" value={form.taxId}
              onChange={e => setF('taxId', e.target.value)}
              placeholder={placeholderFrom(parent?.taxId, mode)}
              className="input font-mono" />
          </Field>
          <Field label="Số điện thoại">
            <input type="tel" value={form.phone}
              onChange={e => setF('phone', e.target.value)}
              placeholder={placeholderFrom(parent?.phone, mode)}
              className="input tabular-nums" />
          </Field>
        </div>

        <Field label="Email">
          <input type="email" value={form.email}
            onChange={e => setF('email', e.target.value)}
            placeholder={placeholderFrom(parent?.email, mode)}
            className="input" />
        </Field>

        <Field label="Địa chỉ">
          <textarea rows={2} value={form.address}
            onChange={e => setF('address', e.target.value)}
            placeholder={placeholderFrom(parent?.address, mode)}
            className="input resize-none" />
        </Field>

        {mode === 'create-branch' && (
          <div className="text-[11px] text-gray-500 bg-amber-50 border border-amber-200
            rounded-lg p-2 leading-snug">
            💡 Các trường có placeholder in mờ là thông tin của <b>công ty mẹ</b>.
            Để trống nếu chi nhánh dùng chung, hoặc nhập giá trị mới nếu khác.
          </div>
        )}
      </form>

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

function nz(s) {
  if (!s) return null
  const t = s.trim()
  return t.length ? t : null
}

/** Placeholder chỉ hiện khi tạo chi nhánh (để hint field của mẹ). */
function placeholderFrom(v, mode) {
  if (mode !== 'create-branch' || !v) return ''
  return v
}

/**
 * Build initial form state theo mode. Với create-branch: pre-fill tên +
 * tên viết tắt + mst với hậu tố "Chi nhánh N+1" / "-001".
 */
function initForm(mode, parent, row, existingBranchCount) {
  if (mode === 'edit' && row) {
    return {
      name: row.name || '',
      shortName: row.shortName || '',
      address: row.address || '',
      taxId: row.taxId || '',
      phone: row.phone || '',
      email: row.email || '',
    }
  }
  if (mode === 'create-branch' && parent) {
    const n = (existingBranchCount || 0) + 1
    return {
      name: `${parent.name} - Chi nhánh ${n}`,
      shortName: parent.shortName ? `${parent.shortName}-CN${n}` : '',
      // KHÔNG pre-fill address/phone/email — dùng làm placeholder mờ
      address: '',
      taxId: parent.taxId ? `${parent.taxId}-${String(n).padStart(3, '0')}` : '',
      phone: '',
      email: '',
    }
  }
  return { name: '', shortName: '', address: '', taxId: '', phone: '', email: '' }
}

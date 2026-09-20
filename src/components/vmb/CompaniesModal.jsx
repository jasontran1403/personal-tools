import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../common/Modal'
import ConfirmModal from '../common/ConfirmModal'
import CompanyFormModal from './CompanyFormModal'
import { listCompanies, deleteCompany } from '../../services/vmbApi'

/**
 * Quản lý công ty — cây 2 tầng (Phase G).
 *
 * ── Cấu trúc dữ liệu ────────────────────────────────────
 * BE trả về danh sách PHẲNG (có {@code parentId}). FE tự dựng cây:
 *   companies gốc = parentId == null
 *   với mỗi gốc, đính chi nhánh (parentId === gốc.id)
 *
 * ── Layout ──────────────────────────────────────────────
 * Mỗi công ty gốc là 1 "card":
 *   - Header: tên + shortName + counts + nút Sửa / Xóa / + Chi nhánh
 *   - Chi nhánh: rows thụt vào 24px, mỗi row có Sửa / Xóa riêng
 *
 * Xóa công ty gốc → warning: sẽ xóa cả chi nhánh. Nếu có passenger/ticket
 * tham chiếu, BE chặn — FE hiển thị message từ server.
 */
export default function CompaniesModal({ onClose, onDirty }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const [form, setForm] = useState(null)          // { mode, parent?, row?, existingBranchCount? }
  const [confirmDel, setConfirmDel] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listCompanies()
      setRows(res.data?.data || [])
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Không tải được danh sách công ty')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const tree = useMemo(() => buildTree(rows), [rows])

  const doDelete = async () => {
    if (!confirmDel) return
    try {
      await deleteCompany(confirmDel.id)
      toast.success('Đã xóa')
      setConfirmDel(null)
      onDirty?.()
      load()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Xóa thất bại')
    }
  }

  return (
    <>
      <Modal open onClose={onClose} title="Quản lý công ty" size="xl" closeOnBackdrop>
        <div className="mb-3 flex items-center gap-2">
          <div className="flex-1 text-xs text-gray-500">
            {loading ? 'Đang tải…' : `${rows.length} bản ghi (bao gồm chi nhánh)`}
          </div>
          <button type="button"
            onClick={() => setForm({ mode: 'create-root' })}
            className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">
            + Thêm công ty
          </button>
        </div>

        {tree.length === 0 && !loading ? (
          <div className="py-12 text-center text-sm text-gray-400">
            Chưa có công ty nào. Bấm "+ Thêm công ty" để tạo.
          </div>
        ) : (
          <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
            {tree.map(node => (
              <CompanyCard key={node.root.id} node={node}
                onEdit={(c) => setForm({ mode: 'edit', row: c })}
                onAddBranch={() => setForm({
                  mode: 'create-branch', parent: node.root, existingBranchCount: node.branches.length,
                })}
                onDelete={(c) => setConfirmDel(c)}
              />
            ))}
          </div>
        )}
      </Modal>

      {form && (
        <CompanyFormModal
          mode={form.mode}
          parent={form.parent}
          row={form.row}
          existingBranchCount={form.existingBranchCount}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); onDirty?.(); load() }}
        />
      )}

      {confirmDel && (
        <ConfirmModal
          open
          title={confirmDel.parentId ? 'Xóa chi nhánh' : 'Xóa công ty'}
          message={buildDeleteMessage(confirmDel, tree)}
          confirmLabel="Xóa"
          danger
          onConfirm={doDelete}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────

function CompanyCard({ node, onEdit, onAddBranch, onDelete }) {
  const { root, branches } = node
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="p-3 flex items-start gap-3 border-b border-gray-100 bg-gradient-to-r from-slate-50 to-blue-50/60">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-bold text-gray-900">{root.name}</span>
            {root.shortName && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                {root.shortName}
              </span>
            )}
            {branches.length > 0 && (
              <span className="text-[10px] text-gray-500">· {branches.length} chi nhánh</span>
            )}
          </div>
          <CompanyMeta c={root} />
        </div>
        <div className="flex gap-1 shrink-0">
          <button type="button" onClick={onAddBranch}
            className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-green-100 text-green-700 hover:bg-green-200">
            + Chi nhánh
          </button>
          <button type="button" onClick={() => onEdit(root)}
            className="px-2.5 py-1 text-[11px] font-semibold rounded-md text-blue-600 hover:bg-blue-50">
            Sửa
          </button>
          <button type="button" onClick={() => onDelete(root)}
            className="px-2.5 py-1 text-[11px] font-semibold rounded-md text-rose-600 hover:bg-rose-50">
            Xóa
          </button>
        </div>
      </div>

      {branches.length > 0 && (
        <div className="divide-y divide-gray-100">
          {branches.map(b => (
            <div key={b.id} className="p-2.5 pl-8 flex items-start gap-3 bg-gray-50/50">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-gray-400">⌞</span>
                  <span className="text-sm text-gray-800">{b.name}</span>
                  {b.shortName && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                      {b.shortName}
                    </span>
                  )}
                </div>
                <CompanyMeta c={b} inheritFrom={root} />
              </div>
              <div className="flex gap-1 shrink-0">
                <button type="button" onClick={() => onEdit(b)}
                  className="px-2 py-1 text-[10px] font-semibold rounded-md text-blue-600 hover:bg-blue-50">
                  Sửa
                </button>
                <button type="button" onClick={() => onDelete(b)}
                  className="px-2 py-1 text-[10px] font-semibold rounded-md text-rose-600 hover:bg-rose-50">
                  Xóa
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Hiển thị MST / SĐT / email / address gọn 1 dòng. Nếu là chi nhánh và
 * field null, hiển thị "(theo mẹ)" mờ để user biết đang thừa hưởng.
 */
function CompanyMeta({ c, inheritFrom }) {
  const items = [
    { label: 'MST', v: c.taxId,   inh: inheritFrom?.taxId,   mono: true  },
    { label: 'ĐT',  v: c.phone,   inh: inheritFrom?.phone,   mono: true  },
    { label: 'Email', v: c.email, inh: inheritFrom?.email,   mono: false },
  ].filter(x => x.v || x.inh)

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
      {items.map((x, i) => (
        <span key={i} className="text-gray-500">
          <span className="text-gray-400">{x.label}:</span>{' '}
          {x.v ? (
            <span className={`${x.mono ? 'font-mono' : ''} text-gray-700`}>{x.v}</span>
          ) : (
            <span className="italic text-gray-400" title={x.inh}>(theo mẹ)</span>
          )}
        </span>
      ))}
      {(c.address || inheritFrom?.address) && (
        <span className="text-gray-500 basis-full">
          <span className="text-gray-400">Đ/c:</span>{' '}
          {c.address
            ? <span className="text-gray-700">{c.address}</span>
            : <span className="italic text-gray-400" title={inheritFrom.address}>(theo mẹ)</span>}
        </span>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────

function buildTree(rows) {
  const roots = rows.filter(r => !r.parentId)
  const byParent = new Map()
  for (const r of rows) {
    if (r.parentId) {
      if (!byParent.has(r.parentId)) byParent.set(r.parentId, [])
      byParent.get(r.parentId).push(r)
    }
  }
  return roots.map(root => ({
    root,
    branches: (byParent.get(root.id) || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
  }))
}

function buildDeleteMessage(c, tree) {
  if (!c.parentId) {
    const node = tree.find(n => n.root.id === c.id)
    const nBranches = node?.branches?.length || 0
    if (nBranches > 0) {
      return `Xóa "${c.name}" và ${nBranches} chi nhánh của nó? Chỉ xóa được nếu không có hành khách/vé nào tham chiếu.`
    }
    return `Xóa "${c.name}"? Chỉ xóa được nếu không có hành khách/vé nào tham chiếu.`
  }
  return `Xóa chi nhánh "${c.name}"? Chỉ xóa được nếu không có hành khách/vé nào tham chiếu.`
}

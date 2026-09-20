import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import ConfirmModal from '../common/ConfirmModal'
import LookupFormModal from './LookupFormModal'
import TotpModal from './TotpModal'
import { listLookup, deleteLookup } from '../../services/vmbApi'
import { copyText } from '../../lib/clipboard'

/**
 * Tab Tra cứu.
 *
 * 2 dạng mục:
 *   PLAIN   — chỉ có keyword + details; hiển thị dạng bảng 2 cột, click-to-copy
 *             cho cả 2 cột.
 *   ACCOUNT — có URL đăng nhập + username + password; hiển thị dạng card, mỗi
 *             field có nút copy riêng. Password mặc định ẩn, bấm 👁 mở modal
 *             nhập TOTP để reveal.
 *
 * Filter: search theo keyword/username/details + tab lọc theo type (All/PLAIN/ACCOUNT).
 */
export default function LookupTab() {
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ]           = useState('')
  const [type, setType]     = useState('')     // '' | 'PLAIN' | 'ACCOUNT'
  const [page, setPage]     = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal]   = useState(0)

  const [form, setForm]         = useState(null)   // null | {mode:'create'} | {mode:'edit', row}
  const [confirmDel, setConfirmDel] = useState(null)
  const [reveal, setReveal]     = useState(null)   // row đang reveal password

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listLookup({
        q: q || undefined,
        type: type || undefined,
        page, size: 100,
      })
      const d = res.data?.data
      setRows(d?.content || [])
      setTotalPages(d?.totalPages || 1)
      setTotal(d?.totalElements || 0)
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Không tải được danh sách')
    } finally {
      setLoading(false)
    }
  }, [q, type, page])

  useEffect(() => { load() }, [load])

  const qTimer = useRef(null)
  const onSearch = (v) => {
    if (qTimer.current) clearTimeout(qTimer.current)
    qTimer.current = setTimeout(() => { setPage(0); setQ(v) }, 300)
  }

  const doCopy = async (text, label) => {
    const ok = await copyText(text)
    if (ok) toast.success(`Đã copy ${label}`)
    else    toast.error('Copy thất bại')
  }

  // Nhóm cho hiển thị: PLAIN vào bảng, ACCOUNT ra card grid
  const plainRows   = rows.filter(r => r.type === 'PLAIN')
  const accountRows = rows.filter(r => r.type === 'ACCOUNT')

  return (
    <div className="w-full">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <input
          defaultValue={q}
          onChange={e => onSearch(e.target.value)}
          placeholder="Tìm theo từ khóa, tài khoản, mô tả…"
          className="flex-1 min-w-0 px-3.5 py-2 rounded-lg border border-gray-300 bg-white text-sm
            focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
        />
        <div className="flex gap-1 shrink-0 p-0.5 rounded-lg bg-gray-100">
          {[
            { key: '',        label: 'Tất cả' },
            { key: 'PLAIN',   label: 'Thông tin' },
            { key: 'ACCOUNT', label: 'Tài khoản' },
          ].map(t => (
            <button key={t.key} type="button"
              onClick={() => { setPage(0); setType(t.key) }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                type === t.key ? 'bg-white shadow text-blue-700' : 'text-gray-600 hover:text-gray-900'
              }`}>{t.label}</button>
          ))}
        </div>
        <button type="button" onClick={() => setForm({ mode: 'create' })}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white
            text-sm font-semibold shadow-md shadow-blue-500/20 hover:from-blue-700 hover:to-indigo-700 shrink-0">
          + Thêm
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl shadow border border-gray-100 py-16 text-center text-gray-400 text-sm">
          Đang tải…
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl shadow border border-gray-100 py-16 text-center text-gray-400 text-sm">
          {q ? 'Không tìm thấy' : 'Chưa có mục nào. Bấm "Thêm" để tạo.'}
        </div>
      ) : (
        <div className="space-y-4">
          {/* PLAIN — bảng 2 cột */}
          {(type === '' || type === 'PLAIN') && plainRows.length > 0 && (
            <div className="bg-white rounded-2xl shadow border border-gray-100 overflow-hidden">
              <div className="px-4 py-2 bg-gradient-to-r from-slate-50 to-blue-50 border-b border-gray-100">
                <span className="text-xs font-bold text-gray-700 uppercase">📄 Thông tin ({plainRows.length})</span>
              </div>
              <div className="divide-y divide-gray-100">
                {plainRows.map(r => (
                  <div key={r.id} className="p-3 hover:bg-blue-50/40 group">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <button type="button" onClick={() => doCopy(r.keyword, 'từ khóa')}
                          className="text-left font-bold text-gray-900 hover:text-blue-700 text-sm cursor-copy">
                          🔑 {r.keyword}
                        </button>
                        {r.details && (
                          <button type="button" onClick={() => doCopy(r.details, 'nội dung')}
                            className="w-full text-left mt-1 text-sm text-gray-700 hover:bg-blue-50 rounded p-1 cursor-copy whitespace-pre-wrap break-words">
                            {r.details}
                          </button>
                        )}
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 flex gap-1 shrink-0">
                        <button onClick={() => setForm({ mode: 'edit', row: r })}
                          className="w-7 h-7 rounded-md text-gray-600 hover:bg-gray-200 flex items-center justify-center">✎</button>
                        <button onClick={() => setConfirmDel(r)}
                          className="w-7 h-7 rounded-md text-gray-600 hover:bg-rose-100 hover:text-rose-700 flex items-center justify-center">🗑</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ACCOUNT — grid card */}
          {(type === '' || type === 'ACCOUNT') && accountRows.length > 0 && (
            <div>
              <div className="px-1 mb-2 text-xs font-bold text-gray-700 uppercase">
                🔐 Tài khoản ({accountRows.length})
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {accountRows.map(r => (
                  <AccountCard key={r.id} row={r}
                    onCopy={doCopy}
                    onReveal={() => setReveal(r)}
                    onEdit={() => setForm({ mode: 'edit', row: r })}
                    onDelete={() => setConfirmDel(r)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} total={total} onPage={setPage} />

      {form && (
        <LookupFormModal
          mode={form.mode}
          row={form.row}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); load() }}
        />
      )}

      {reveal && (
        <TotpModal
          entry={reveal}
          onClose={() => setReveal(null)}
        />
      )}

      {confirmDel && (
        <ConfirmModal
          isOpen
          title="Xóa mục"
          message={`Xóa "${confirmDel.keyword}"?`}
          confirmText="Xóa"
          type="danger"
          onConfirm={async () => {
            try {
              await deleteLookup(confirmDel.id)
              toast.success('Đã xóa')
              setConfirmDel(null)
              load()
            } catch (e) {
              toast.error(e?.response?.data?.message || 'Xóa thất bại')
            }
          }}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

function AccountCard({ row, onCopy, onReveal, onEdit, onDelete }) {
  return (
    <div className="bg-white rounded-2xl shadow border border-gray-100 p-3 group hover:border-blue-300 transition">
      <div className="flex items-start gap-2 mb-2">
        <button type="button" onClick={() => onCopy(row.keyword, 'từ khóa')}
          className="flex-1 min-w-0 text-left font-bold text-gray-900 hover:text-blue-700 cursor-copy truncate">
          🔑 {row.keyword}
        </button>
        <div className="opacity-0 group-hover:opacity-100 flex gap-1 shrink-0">
          <button onClick={onEdit}
            className="w-7 h-7 rounded-md text-gray-600 hover:bg-gray-200 flex items-center justify-center">✎</button>
          <button onClick={onDelete}
            className="w-7 h-7 rounded-md text-gray-600 hover:bg-rose-100 hover:text-rose-700 flex items-center justify-center">🗑</button>
        </div>
      </div>

      <div className="space-y-1.5">
        {row.loginUrl && (
          <FieldRow label="URL" copyable={row.loginUrl} onCopy={onCopy}>
            <a href={row.loginUrl} target="_blank" rel="noreferrer"
              className="text-xs text-blue-600 hover:underline truncate block">
              {row.loginUrl}
            </a>
          </FieldRow>
        )}
        <FieldRow label="Username" copyable={row.loginUsername} onCopy={onCopy}>
          <span className="text-xs font-mono text-gray-900 truncate block">{row.loginUsername}</span>
        </FieldRow>
        {row.agencyCode && (
          <FieldRow label="Mã ĐL" copyable={row.agencyCode} onCopy={onCopy}>
            <span className="text-xs font-mono text-gray-900 truncate block">{row.agencyCode}</span>
          </FieldRow>
        )}
        <FieldRow label="Password">
          <div className="flex items-center gap-2">
            <span className="flex-1 font-mono text-gray-400 tracking-widest select-none">••••••••</span>
            <button type="button" onClick={onReveal}
              title="Xem mật khẩu (cần 2FA)"
              className="px-2 py-1 rounded-md bg-blue-600 text-white text-[10px] font-bold hover:bg-blue-700 shrink-0">
              👁 Xem
            </button>
          </div>
        </FieldRow>
      </div>
    </div>
  )
}

function FieldRow({ label, copyable, onCopy, children }) {
  return (
    <div className="flex items-center gap-2 group/row">
      <span className="text-[10px] font-bold text-gray-400 uppercase w-16 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
      {copyable && (
        <button type="button" onClick={() => onCopy(copyable, label.toLowerCase())}
          className="opacity-0 group-hover/row:opacity-100 w-6 h-6 rounded-md bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-700 flex items-center justify-center text-[10px] shrink-0">
          📋
        </button>
      )}
    </div>
  )
}

function Pagination({ page, totalPages, total, onPage }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between px-4 py-2 mt-3 bg-white rounded-lg border border-gray-100 text-xs">
      <span className="text-gray-500">{total} mục · trang {page + 1}/{totalPages}</span>
      <div className="flex gap-1">
        <button onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0}
          className="px-2.5 py-1 rounded-md bg-white border border-gray-200 disabled:opacity-40 hover:bg-gray-100">←</button>
        <button onClick={() => onPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
          className="px-2.5 py-1 rounded-md bg-white border border-gray-200 disabled:opacity-40 hover:bg-gray-100">→</button>
      </div>
    </div>
  )
}

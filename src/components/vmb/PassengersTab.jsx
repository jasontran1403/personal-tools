import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import ConfirmModal from '../common/ConfirmModal'
import PassengerFormModal from './PassengerFormModal'
import MembershipCardsModal from './MembershipCardsModal'
import CompaniesModal from './CompaniesModal'
import IdPresentationModal from './IdPresentationModal'
import { listPassengers, listCompanies, deletePassenger } from '../../services/vmbApi'
import { expiryStatus, monthsUntil, formatDateVn } from '../../lib/expiry'

/**
 * Tab Thông tin khách.
 *
 * ── 2026-09-15 ──────────────────────────────────────────────
 * Chuyển sang data model mới:
 *   - passenger.documents (list) thay cho các cột phẳng cccdNo/passportNo/...
 *   - passenger.nearestExpiry (BE tính sẵn) thay cho passenger.expiryDate
 *     — dùng cho màu dòng cảnh báo hạn.
 */
export default function PassengersTab() {
  const [rows, setRows]           = useState([])
  const [companies, setCompanies] = useState([])
  const [loading, setLoading]     = useState(true)

  const [q, setQ]                 = useState('')
  const [companyId, setCompanyId] = useState('')
  const [page, setPage]           = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal]         = useState(0)

  const [collapsedCompanies, setCollapsedCompanies] = useState(new Set())

  const [form, setForm]           = useState(null)
  const [cardsFor, setCardsFor]   = useState(null)
  const [presenting, setPresenting] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [showCompanies, setShowCompanies] = useState(false)

  const loadCompanies = useCallback(async () => {
    try {
      const res = await listCompanies()
      setCompanies(res.data?.data || [])
    } catch (e) {
      toast.error('Không tải được danh sách công ty')
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listPassengers({
        q: q || undefined,
        companyId: companyId || undefined,
        page, size: 100,
      })
      const d = res.data?.data
      setRows(d?.content || [])
      setTotalPages(d?.totalPages || 1)
      setTotal(d?.totalElements || 0)
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Không tải được danh sách khách')
    } finally {
      setLoading(false)
    }
  }, [q, companyId, page])

  useEffect(() => { loadCompanies() }, [loadCompanies])
  useEffect(() => { load() }, [load])

  const qTimer = useRef(null)
  const onSearch = (v) => {
    if (qTimer.current) clearTimeout(qTimer.current)
    qTimer.current = setTimeout(() => { setPage(0); setQ(v) }, 300)
  }

  const groups = useMemo(() => {
    if (companyId) return null
    const map = new Map()
    for (const p of rows) {
      const key = p.companyId || 'none'
      if (!map.has(key)) map.set(key, { companyName: p.companyName || '—', companyId: p.companyId, items: [] })
      map.get(key).items.push(p)
    }
    return Array.from(map.values())
  }, [rows, companyId])

  const toggleCompany = (id) => {
    setCollapsedCompanies(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <input
          defaultValue={q}
          onChange={e => onSearch(e.target.value)}
          placeholder="Tìm theo tên, số CCCD, hộ chiếu…"
          className="flex-1 min-w-0 px-3.5 py-2 rounded-lg border border-gray-300 bg-white text-sm
            focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
        />
        <select
          value={companyId}
          onChange={e => { setPage(0); setCompanyId(e.target.value) }}
          className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm min-w-[180px]
            focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
        >
          <option value="">— Tất cả công ty —</option>
          {companies.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button type="button" onClick={() => setShowCompanies(true)}
          className="px-3 py-2 rounded-lg bg-white border border-gray-300 text-sm text-gray-700
            hover:bg-gray-50 shrink-0 font-medium">
          🏢 Công ty
        </button>
        <button type="button" onClick={() => setForm({ mode: 'create' })}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white
            text-sm font-semibold shadow-md shadow-blue-500/20 hover:from-blue-700 hover:to-indigo-700 shrink-0">
          + Thêm khách
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl shadow border border-gray-100 py-16 text-center text-gray-400 text-sm">
          Đang tải…
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl shadow border border-gray-100 py-16 text-center text-gray-400 text-sm">
          {q || companyId ? 'Không tìm thấy khách phù hợp' : 'Chưa có hành khách nào. Bấm "Thêm khách" để tạo.'}
        </div>
      ) : groups ? (
        <div className="space-y-3">
          {groups.map(g => {
            const collapsed = collapsedCompanies.has(g.companyId || 'none')
            return (
              <div key={g.companyId || 'none'} className="bg-white rounded-2xl shadow border border-gray-100 overflow-hidden">
                <button type="button" onClick={() => toggleCompany(g.companyId || 'none')}
                  className="w-full flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-slate-50 to-blue-50
                    hover:from-slate-100 hover:to-blue-100 transition text-left">
                  <span className="text-gray-500 text-sm">{collapsed ? '▶' : '▼'}</span>
                  <span className="font-bold text-gray-900 text-sm">{g.companyName}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white text-gray-600 font-semibold border border-gray-200">
                    {g.items.length} khách
                  </span>
                </button>
                {!collapsed && (
                  <PassengerList
                    items={g.items}
                    onEdit={p => setForm({ mode: 'edit', passengerId: p.id })}
                    onCards={setCardsFor}
                    onPresent={setPresenting}
                    onDelete={setConfirmDel}
                  />
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow border border-gray-100 overflow-hidden">
          <PassengerList
            items={rows}
            onEdit={p => setForm({ mode: 'edit', passengerId: p.id })}
            onCards={setCardsFor}
            onPresent={setPresenting}
            onDelete={setConfirmDel}
          />
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} total={total} onPage={setPage} />

      {form && (
        <PassengerFormModal
          mode={form.mode}
          passengerId={form.passengerId}
          companies={companies}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); load(); loadCompanies() }}
        />
      )}

      {cardsFor && (
        <MembershipCardsModal
          passenger={cardsFor}
          onClose={() => setCardsFor(null)}
          onDirty={load}
        />
      )}

      {presenting && (
        <IdPresentationModal
          passenger={presenting}
          onClose={() => setPresenting(null)}
        />
      )}

      {showCompanies && (
        <CompaniesModal
          onClose={() => setShowCompanies(false)}
          onDirty={() => { loadCompanies(); load() }}
        />
      )}

      {confirmDel && (
        <ConfirmModal
          open
          title="Xóa hành khách"
          message={`Xóa "${confirmDel.fullName}" và toàn bộ thẻ thành viên, file giấy tờ đính kèm?`}
          confirmLabel="Xóa"
          danger
          onConfirm={async () => {
            try {
              await deletePassenger(confirmDel.id)
              toast.success('Đã xóa')
              setConfirmDel(null)
              load()
            } catch (e) {
              toast.error(e?.response?.data?.message || 'Xóa thất bại')
            }
          }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════

function PassengerList({ items, onEdit, onCards, onPresent, onDelete }) {
  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase text-[10px]">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Họ tên</th>
              <th className="text-center px-3 py-2 font-semibold">Thẻ thành viên</th>
              <th className="text-right px-3 py-2 font-semibold">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {items.map(p => {
              const cccd = findDoc(p, 'CCCD')
              const pp   = findDoc(p, 'PASSPORT')
              const st = expiryStatus(p.nearestExpiry)
              const rowCls =
                  st === 'expired' ? 'bg-rose-50 hover:bg-rose-100'
                : st === 'soon'    ? 'bg-amber-50 hover:bg-amber-100'
                : 'hover:bg-blue-50/40'
              return (
                <tr key={p.id} className={`${rowCls} border-b border-gray-100 transition-colors`}>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-gray-900">{p.fullName}</div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button type="button" onClick={() => onCards(p)}
                      title="Thẻ thành viên"
                      className="w-20 h-7 rounded-md bg-gray-100 hover:bg-blue-100 hover:text-blue-700
                        text-xs font-bold flex items-center justify-center mx-auto">
                      Xuất trình
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => onPresent(p)}
                        title="Xuất trình giấy tờ (CCCD / Hộ chiếu)"
                        className="w-7 h-7 rounded-md text-gray-600 hover:bg-amber-100 hover:text-amber-700 flex items-center justify-center">
                        🪪
                      </button>
                      <button type="button" onClick={() => onEdit(p)}
                        title="Sửa" className="w-7 h-7 rounded-md text-gray-600 hover:bg-gray-200 flex items-center justify-center">
                        ✎
                      </button>
                      <button type="button" onClick={() => onDelete(p)}
                        title="Xóa" className="w-7 h-7 rounded-md text-gray-600 hover:bg-rose-100 hover:text-rose-700 flex items-center justify-center">
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-gray-100">
        {items.map(p => {
          const cccd = findDoc(p, 'CCCD')
          const pp   = findDoc(p, 'PASSPORT')
          const st = expiryStatus(p.nearestExpiry)
          const bg =
              st === 'expired' ? 'bg-rose-50'
            : st === 'soon'    ? 'bg-amber-50'
            : 'bg-white'
          return (
            <div key={p.id} className={`p-3 ${bg}`}>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900 truncate">{p.fullName}</div>
                  <div className="text-[11px] text-gray-500">
                    {genderLabel(p.gender)}{p.dob && ` · ${formatDateVn(p.dob)}`}
                  </div>
                </div>
                <button onClick={() => onCards(p)}
                  className="text-xs px-2 py-1 rounded-md bg-gray-100 font-semibold text-gray-700 shrink-0">
                  {p.membershipCount || 0} thẻ
                </button>
              </div>
              {(cccd?.docNumber || pp?.docNumber) && (
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {cccd?.docNumber && (
                    <span className="px-2 py-0.5 rounded bg-gray-100 font-mono">
                      CCCD {cccd.docNumber} {cccd.fileUrl && '📎'}
                    </span>
                  )}
                  {pp?.docNumber && (
                    <span className="px-2 py-0.5 rounded bg-gray-100 font-mono">
                      PP {pp.docNumber} {pp.nationality && `[${pp.nationality}]`} {pp.fileUrl && '📎'}
                    </span>
                  )}
                </div>
              )}
              {p.nearestExpiry && (
                <div className="mt-2"><ExpiryLabel status={st} date={p.nearestExpiry} /></div>
              )}
              <div className="mt-2 flex gap-1">
                <button onClick={() => onPresent(p)}
                  title="Xuất trình giấy tờ"
                  className="h-8 px-2 rounded-md text-xs font-semibold bg-amber-100 text-amber-700 hover:bg-amber-200">
                  🪪
                </button>
                <button onClick={() => onEdit(p)}
                  className="flex-1 h-8 rounded-md text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200">
                  ✎ Sửa
                </button>
                <button onClick={() => onDelete(p)}
                  className="flex-1 h-8 rounded-md text-xs font-semibold bg-rose-100 text-rose-700 hover:bg-rose-200">
                  🗑 Xóa
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function findDoc(p, type) {
  return (p?.documents || []).find(d => d.type === type) || null
}

function ExpiryLabel({ status, date }) {
  const months = monthsUntil(date)
  if (status === 'expired') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-600 text-white text-[11px] font-bold">
        ⚠ Hết hạn · {formatDateVn(date)}
      </span>
    )
  }
  if (status === 'soon') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500 text-white text-[11px] font-bold">
        ⚠ Còn {months} tháng · {formatDateVn(date)}
      </span>
    )
  }
  return <span className="text-xs tabular-nums text-gray-700">{formatDateVn(date)}</span>
}

function FileIcon() {
  return <span title="Có file đính kèm" className="text-[10px] text-blue-600">📎</span>
}

function genderLabel(g) {
  return { MALE: 'Nam', FEMALE: 'Nữ', OTHER: 'Khác' }[g] || '—'
}

function Pagination({ page, totalPages, total, onPage }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between px-4 py-2 mt-2 bg-white rounded-lg border border-gray-100 text-xs">
      <span className="text-gray-500">{total} khách · trang {page + 1}/{totalPages}</span>
      <div className="flex gap-1">
        <button onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0}
          className="px-2.5 py-1 rounded-md bg-white border border-gray-200 disabled:opacity-40 hover:bg-gray-100">←</button>
        <button onClick={() => onPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
          className="px-2.5 py-1 rounded-md bg-white border border-gray-200 disabled:opacity-40 hover:bg-gray-100">→</button>
      </div>
    </div>
  )
}
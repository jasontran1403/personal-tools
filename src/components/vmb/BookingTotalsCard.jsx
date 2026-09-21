export default function BookingTotalsCard({ totals = [], loading = false }) {
  // Đảm bảo có đúng 2 dòng (VND + USD) — BE đã bảo đảm nhưng defensive
  const vnd = totals.find(t => t.currency === 'VND') || emptyTotal('VND')
  const usd = totals.find(t => t.currency === 'USD') || emptyTotal('USD')

  const cols = [
    { label: 'Thành tiền',   vnd: vnd.subTotal,    usd: usd.subTotal    },
    { label: 'Phí xuất vé',  vnd: vnd.issuanceFee, usd: usd.issuanceFee },
    { label: 'Tổng booking', vnd: vnd.grandTotal,  usd: usd.grandTotal, hi: true },
  ]

  return (
    <div className="mb-3 bg-white rounded-2xl shadow border border-gray-100 overflow-hidden">
      <div className="px-3 py-2 bg-gradient-to-r from-slate-50 to-blue-50 border-b border-gray-100
        flex items-center gap-2">
        <span className="text-xs font-bold text-gray-700 uppercase">Σ Tổng</span>
        <span className="text-[10px] text-gray-500">
          VND: {vnd.ticketCount || 0} vé · USD: {usd.ticketCount || 0} vé
        </span>
        {loading && <span className="text-[10px] text-gray-400 animate-pulse">đang tính…</span>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
        {cols.map((c, i) => (
          <div key={i} className={`p-3 ${c.hi ? 'bg-blue-50/50' : ''}`}>
            <div className="text-[10px] font-bold text-gray-500 uppercase mb-1.5 text-right">
              {c.label}
            </div>
            {/* VND row */}
            <div className="flex items-baseline justify-end gap-1 mb-0.5 rounded px-1.5 py-0.5 bg-blue-50">
              <span className={`font-mono tabular-nums text-sm ${c.hi ? 'font-bold text-blue-800' : 'font-semibold text-blue-700'}`}>
                {c.vnd || '0'}
              </span>
              <span className="text-[10px] font-bold text-blue-500">VND</span>
            </div>
            {/* USD row */}
            <div className="flex items-baseline justify-end gap-1 rounded px-1.5 py-0.5 bg-violet-50">
              <span className={`font-mono tabular-nums text-sm ${c.hi ? 'font-bold text-violet-800' : 'font-semibold text-violet-700'}`}>
                {c.usd || '0'}
              </span>
              <span className="text-[10px] font-bold text-violet-500">USD</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function emptyTotal(currency) {
  return {
    currency,
    withCollection: '0', serviceFee: '0', subTotal: '0',
    issuanceFee: '0', grandTotal: '0', ticketCount: 0,
  }
}


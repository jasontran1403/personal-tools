/**
 * ── Báo cáo DOANH THU theo khách hàng — 2026-11-11 ─────────────
 * PDF A4 NGANG, xuất từ tab "Khách hàng" theo khoảng ngày UI đang chọn.
 *
 * Cột:
 *   STT · Tên công ty / khách hàng · Tổng tiền vé đã mua · Tổng phí xuất vé
 *   đã thu · Tổng số vé đã mua · Công nợ hiện tại chưa thanh toán · Số ngày
 *   công nợ của hoá đơn lâu nhất · Ghi chú
 *
 * 3 cột "đã mua / đã thu" tính trong khoảng ngày; 2 cột công nợ là số HIỆN
 * TẠI (không phụ thuộc khoảng ngày).
 *
 * Tách 2 phần để test được ngoài trình duyệt:
 *   {@link buildRevenueReportDoc} — thuần dữ liệu → docDefinition của pdfmake
 *   {@link exportRevenueReport}   — nạp pdfmake + tải file
 */
import { formatMoney } from './money'

const C = {
  ink: '#0f172a', sub: '#475569', mute: '#94a3b8', line: '#e2e8f0',
  head: '#1e293b', zebra: '#f8fafc',
  company: '#1d4ed8', companyBg: '#eff6ff',
  walkin: '#b45309', walkinBg: '#fffbeb',
  money: '#047857', debt: '#be123c', totalBg: '#0f172a',
}

const p2 = (n) => String(n).padStart(2, '0')
/** dd/MM/yyyy */
export function fmtDay(d) {
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`
}
/** hh:mm:ss dd/MM/yyyy (giờ 24h) */
export function fmtStamp(d) {
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${fmtDay(d)}`
}
const vnd = (n) => formatMoney(Math.round(n || 0), 'VND', { withUnit: false })

/**
 * @param opts.rows       [{ name, isWalkIn, revenue, iss, ticketCount, debt,
 *                           debtDays (number|null), note }]
 * @param opts.fromDate   Date — ngày bắt đầu kỳ báo cáo
 * @param opts.toDate     Date — ngày kết thúc kỳ báo cáo
 * @param opts.exportedAt Date — thời điểm xuất (default: now)
 * @param opts.sortLabel  string — mô tả cách sắp xếp user chọn (in dưới tiêu đề).
 *                        `rows` phải được caller sắp xếp sẵn; hàm này giữ nguyên
 *                        thứ tự trong từng nhóm công ty / khách lẻ.
 */
export function buildRevenueReportDoc({ rows, fromDate, toDate, exportedAt = new Date(), sortLabel = '' }) {
  const companies = rows.filter(r => !r.isWalkIn)
  const walkins   = rows.filter(r => r.isWalkIn)
  const sum = (list) => list.reduce((a, r) => ({
    revenue: a.revenue + (r.revenue || 0),
    iss: a.iss + (r.iss || 0),
    ticketCount: a.ticketCount + (r.ticketCount || 0),
    debt: a.debt + (r.debt || 0),
    debtDays: Math.max(a.debtDays, r.debtDays ?? -1),
  }), { revenue: 0, iss: 0, ticketCount: 0, debt: 0, debtDays: -1 })
  const total = sum(rows)

  // Usable 842 - 2×28 = 786pt. Mỗi cột chịu thêm 12pt padding.
  const widths = [22, '*', 82, 86, 48, 92, 76, 96]
  const N = widths.length

  const th = (text, alignment = 'left') => ({
    text, alignment, bold: true, fontSize: 8, color: '#ffffff', fillColor: C.head,
    margin: [0, 3, 0, 3],
  })
  const header = [
    th('STT', 'center'),
    th('Tên công ty / khách hàng'),
    th('Tổng tiền vé\nđã mua', 'right'),
    th('Tổng phí xuất vé\nđã thu', 'right'),
    th('Tổng số vé\nđã mua', 'right'),
    th('Công nợ hiện tại\nchưa thanh toán', 'right'),
    th('Số ngày công nợ\n(HĐ lâu nhất)', 'right'),
    th('Ghi chú'),
  ]

  const body = [header]
  /** Dòng tiêu đề nhóm, trải hết chiều ngang bảng. */
  const band = (label, count, color, fill) => {
    const row = [{
      colSpan: N, fillColor: fill, margin: [0, 2, 0, 2],
      text: [
        { text: label, bold: true, color, fontSize: 8.5 },
        { text: `   ${count} khách hàng`, color: C.sub, fontSize: 8 },
      ],
    }]
    while (row.length < N) row.push({})
    return row
  }
  const dataRow = (r, idx) => {
    const fill = idx % 2 === 1 ? C.zebra : null
    const cell = (text, extra = {}) => ({ text, fontSize: 8.5, fillColor: fill, color: C.ink, ...extra })
    const hasDebt = (r.debt || 0) > 0.5
    return [
      cell(String(idx + 1), { alignment: 'center', color: C.sub }),
      cell(r.name || '—', { bold: true }),
      cell(vnd(r.revenue), { alignment: 'right', bold: true, color: C.money }),
      cell(vnd(r.iss), { alignment: 'right' }),
      cell(String(r.ticketCount || 0), { alignment: 'right' }),
      cell(hasDebt ? vnd(r.debt) : '—', {
        alignment: 'right', bold: hasDebt, color: hasDebt ? C.debt : C.mute }),
      cell(hasDebt && r.debtDays != null ? `${r.debtDays} ngày` : '—', {
        alignment: 'right', color: hasDebt && r.debtDays != null ? C.debt : C.mute }),
      cell(r.note || '', { color: C.sub, fontSize: 8 }),
    ]
  }
  const sumRow = (label, s, { fill, color, big }) => {
    const fs = big ? 9.5 : 8.5
    const cell = (text, extra = {}) => ({
      text, bold: true, fontSize: fs, fillColor: fill, color,
      margin: [0, big ? 3 : 1, 0, big ? 3 : 1], ...extra,
    })
    return [
      cell(label, { colSpan: 2, alignment: 'right' }), {},
      cell(vnd(s.revenue), { alignment: 'right' }),
      cell(vnd(s.iss), { alignment: 'right' }),
      cell(String(s.ticketCount), { alignment: 'right' }),
      cell(s.debt > 0.5 ? vnd(s.debt) : '—', { alignment: 'right' }),
      cell(s.debt > 0.5 && s.debtDays >= 0 ? `${s.debtDays} ngày` : '—', { alignment: 'right' }),
      cell(''),
    ]
  }

  // STT chạy liên tục qua 2 nhóm.
  let stt = 0
  const section = (list, label, color, fill, sumLabel) => {
    if (!list.length) return
    body.push(band(label, list.length, color, fill))
    for (const r of list) body.push(dataRow(r, stt++))
    body.push(sumRow(sumLabel, sum(list), { fill, color }))
  }
  section(companies, 'KHÁCH HÀNG CÔNG TY', C.company, C.companyBg, 'Cộng công ty')
  section(walkins,   'KHÁCH LẺ',           C.walkin,  C.walkinBg,  'Cộng khách lẻ')
  if (!rows.length) {
    const row = [{ colSpan: N, text: 'Không có dữ liệu trong khoảng thời gian này.',
      italics: true, color: C.mute, alignment: 'center', margin: [0, 12, 0, 12] }]
    while (row.length < N) row.push({})
    body.push(row)
  }
  // 2026-11-11 (rev3): bỏ dòng TỔNG CỘNG cuối bảng — số tổng đã có ở 4 ô phía trên.

  // 4 ô số liệu tổng quan phía trên bảng.
  const tile = (label, value, color) => ({
    stack: [
      { text: label, fontSize: 7.5, color: C.sub, characterSpacing: 0.3 },
      { text: value, fontSize: 14, bold: true, color, margin: [0, 3, 0, 0] },
    ],
    margin: [10, 8, 10, 8],
  })
  const tiles = {
    table: {
      widths: ['*', '*', '*', '*'],
      body: [[
        tile('TỔNG TIỀN VÉ ĐÃ MUA', vnd(total.revenue), C.money),
        tile('TỔNG PHÍ XUẤT VÉ ĐÃ THU', vnd(total.iss), C.ink),
        // Công nợ kèm số ngày của hoá đơn nợ lâu nhất: "232.931.747 (14 ngày)".
        tile('CÔNG NỢ HIỆN TẠI (VND)',
          vnd(total.debt) + (total.debt > 0.5 && total.debtDays >= 0 ? ` (${total.debtDays} ngày)` : ''),
          total.debt > 0.5 ? C.debt : C.ink),
        tile('TỔNG SỐ VÉ ĐÃ MUA', String(total.ticketCount), C.ink),
      ]],
    },
    layout: {
      hLineWidth: () => 0.7, vLineWidth: () => 0.7,
      hLineColor: () => C.line, vLineColor: () => C.line,
      fillColor: () => C.zebra,
      paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
    },
    margin: [0, 0, 0, 12],
  }

  const stamp = fmtStamp(exportedAt)
  return {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [28, 28, 28, 34],
    info: { title: `Báo cáo doanh thu ${fmtDay(fromDate)} - ${fmtDay(toDate)}` },
    footer: (page, pages) => ({
      margin: [28, 12, 28, 0], fontSize: 7, color: C.mute,
      columns: [
        { text: `Báo cáo doanh thu · ${fmtDay(fromDate)} – ${fmtDay(toDate)} · Xuất lúc ${stamp}` },
        { text: `Trang ${page}/${pages}`, alignment: 'right' },
      ],
    }),
    content: [
      { text: 'BÁO CÁO DOANH THU', fontSize: 18, bold: true, color: C.ink, alignment: 'center',
        characterSpacing: 1 },
      { text: `Từ ngày ${fmtDay(fromDate)} đến ngày ${fmtDay(toDate)}`,
        fontSize: 11, color: C.company, bold: true, alignment: 'center', margin: [0, 4, 0, 0] },
      { text: `Ngày giờ xuất báo cáo: ${stamp}`,
        fontSize: 8.5, color: C.sub, alignment: 'center', margin: [0, 3, 0, sortLabel ? 0 : 12] },
      ...(sortLabel ? [{
        text: `Sắp xếp theo: ${sortLabel} — riêng từng nhóm công ty / khách lẻ`,
        fontSize: 8.5, color: C.sub, alignment: 'center', margin: [0, 2, 0, 12],
      }] : []),
      tiles,
      {
        table: { headerRows: 1, widths, body, dontBreakRows: true },
        layout: {
          hLineWidth: (i, node) => (i === 0 || i === node.table.body.length) ? 0 : 0.5,
          vLineWidth: () => 0,
          hLineColor: () => C.line,
          paddingLeft: () => 6, paddingRight: () => 6,
          paddingTop: () => 4, paddingBottom: () => 4,
        },
      },
      { text: 'Tổng tiền vé, phí xuất vé và số vé tính trên các booking bán trong khoảng thời gian báo cáo. '
          + 'Công nợ và số ngày công nợ là số hiện tại tại thời điểm xuất, không phụ thuộc khoảng thời gian. '
          + 'Đơn vị tiền: VND.',
        fontSize: 7.5, italics: true, color: C.mute, margin: [0, 8, 0, 0] },
    ],
    defaultStyle: { fontSize: 8.5 },
  }
}

/** Build + tải PDF. Tên file: Bao_cao_doanh_thu_<ddMMyyyy>_<ddMMyyyy>.pdf */
export async function exportRevenueReport(opts) {
  const doc = buildRevenueReportDoc(opts)
  const pdfMakeMod = await import('pdfmake/build/pdfmake')
  const vfsMod = await import('pdfmake/build/vfs_fonts')
  const pdfMake = pdfMakeMod.default || pdfMakeMod
  const vfs = vfsMod?.pdfMake?.vfs ?? vfsMod?.default?.pdfMake?.vfs
    ?? vfsMod?.default?.vfs ?? vfsMod?.vfs ?? vfsMod?.default ?? vfsMod
  pdfMake.vfs = vfs
  const tag = (d) => fmtDay(d).replace(/\//g, '')
  pdfMake.createPdf(doc).download(`Bao_cao_doanh_thu_${tag(opts.fromDate)}_${tag(opts.toDate)}.pdf`)
}
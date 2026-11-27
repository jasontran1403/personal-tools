import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../../common/Modal'
import { createFinanceExpense } from '../../../services/vmbApi'
import { parseAmount, formatMoney } from '../../../lib/money'

/**
 * Modal tạo phiếu chi.
 *
 * Luồng:
 *   1. Chọn tài khoản nguồn (Tiền mặt / HD / VCB).
 *   2. Chọn người thụ hưởng:
 *       • "Khác" → nhập tên tự do. Số dư nguồn giảm đúng số tiền.
 *       • "Công nợ HNH" → nguồn giảm, HNH_DEBT giảm (trả bớt công nợ).
 *       • "Ký quỹ VJ"   → nguồn giảm, VJ_DEPOSIT tăng (nạp thêm ký quỹ).
 *   3. Nhập số tiền, nhấn Xác nhận.
 */
export default function ExpenseModal({ accounts, onClose, onSaved }) {
  const spendable = (accounts || []).filter(a => !a.isVirtual)

  const [sourceCode, setSourceCode] = useState(spendable[0]?.code || 'CASH')
  const [beneficiaryKind, setBeneficiaryKind] = useState('FREE') // FREE | HNH_DEBT | VJ_DEPOSIT
  const [beneficiary, setBeneficiary] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [overpay, setOverpay] = useState(null)

  const source = spendable.find(a => a.code === sourceCode)
  const bal = parseAmount(source?.balance) || 0

  const hnh = (accounts || []).find(a => a.code === 'HNH_DEBT')
  const hnhBal = parseAmount(hnh?.balance) || 0
  const hnhDebt = hnhBal < 0 ? -hnhBal : 0
  const fmtVn = (n) => Math.round(n).toLocaleString('vi-VN').replace(/,/g, '.')

  const autoFilled = useRef(false)
  const pickBeneficiary = (k) => {
    setBeneficiaryKind(k)
    if (k === 'HNH_DEBT') {
      if (hnhDebt > 0 && (!amount || autoFilled.current)) {
        setAmount(fmtVn(hnhDebt))
        autoFilled.current = true
      }
    } else if (autoFilled.current) {
      setAmount('')
      autoFilled.current = false
    }
  }

  const submit = async (e) => {
    e?.preventDefault?.()
    const n = parseAmount(amount)
    if (!(n > 0)) return toast.error('Số tiền phải > 0')
    if (!sourceCode) return toast.error('Chưa chọn tài khoản chi')

    if (beneficiaryKind === 'HNH_DEBT' && n > hnhDebt + 0.5) {
      setOverpay({ amount: n, debt: hnhDebt })
      return
    }
    await doSubmit()
  }

  const doSubmit = async () => {
    let beneficiaryCode = null
    let beneficiaryName = beneficiary.trim()
    if (beneficiaryKind === 'HNH_DEBT') {
      beneficiaryCode = 'HNH_DEBT'
      if (!beneficiaryName) beneficiaryName = 'Thanh toán công nợ HNH'
    } else if (beneficiaryKind === 'VJ_DEPOSIT') {
      beneficiaryCode = 'VJ_DEPOSIT'
      if (!beneficiaryName) beneficiaryName = 'Nạp ký quỹ VJ'
    } else {
      if (!beneficiaryName) return toast.error('Chưa nhập người thụ hưởng')
    }

    setBusy(true)
    try {
      await createFinanceExpense({
        sourceCode,
        amount,
        beneficiary: beneficiaryName,
        beneficiaryCode,
        note,
      })
      toast.success('Đã lưu phiếu chi')
      onSaved?.()
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Thất bại')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={busy ? undefined : onClose} title="Phiếu chi" size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-200">Hủy</button>
          <button type="submit" form="expense-form" disabled={busy}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
            {busy ? 'Đang lưu…' : 'Xác nhận chi'}
          </button>
        </div>
      }>
      <form id="expense-form" onSubmit={submit} className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Chi từ</label>
          <div className="grid grid-cols-3 gap-2">
            {spendable.map(a => (
              <button key={a.id} type="button"
                onClick={() => setSourceCode(a.code)}
                className={`px-2 py-2 rounded-lg text-xs font-semibold border transition
                  ${sourceCode === a.code
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-rose-300'}`}>
                {a.name}
                <div className="mt-0.5 font-mono text-[10px] opacity-80">{a.balance || '0'}</div>
              </button>
            ))}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">
            Số dư hiện tại: <b className="font-mono">{source?.balance || '0'}</b>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Chi cho</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { k: 'FREE',        label: 'Khác (nhập tên)' },
              { k: 'HNH_DEBT',    label: 'Công nợ HNH' },
              { k: 'VJ_DEPOSIT',  label: 'Ký quỹ VJ' },
            ].map(opt => (
              <button key={opt.k} type="button"
                onClick={() => pickBeneficiary(opt.k)}
                className={`px-2 py-2 rounded-lg text-xs font-semibold border transition
                  ${beneficiaryKind === opt.k
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">
            {beneficiaryKind === 'FREE' ? 'Tên người thụ hưởng' : 'Diễn giải (tùy chọn)'}
          </label>
          <input type="text" value={beneficiary}
            onChange={e => setBeneficiary(e.target.value)}
            placeholder={beneficiaryKind === 'FREE' ? 'Nguyễn Văn A' : 'VD: nạp bổ sung tháng 11'}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Số tiền (VND)</label>
          <input type="text" inputMode="numeric"
            value={amount}
            onChange={e => {
              // 2026-11-17: Format NGAY khi gõ (thêm/bớt ký tự) — chỉ giữ chữ số
              //   rồi chèn dấu chấm phân cách nghìn, không chờ blur.
              const digits = e.target.value.replace(/[^\d]/g, '')
              autoFilled.current = false
              setAmount(digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '')
            }}
            placeholder={beneficiaryKind === 'HNH_DEBT' && hnhDebt > 0 ? fmtVn(hnhDebt) : 'VD: 500.000'}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 font-mono text-lg" required />
          {beneficiaryKind === 'HNH_DEBT' && (
            <div className="mt-1 text-[11px] text-gray-500">
              {hnhDebt > 0 ? (
                <>
                  Công nợ HNH hiện tại: <b className="font-mono text-rose-600">{fmtVn(hnhDebt)}</b>
                  {parseAmount(amount) > 0 && parseAmount(amount) < hnhDebt - 0.5 && (
                    <> · còn lại sau chi: <b className="font-mono">{fmtVn(hnhDebt - parseAmount(amount))}</b></>
                  )}
                </>
              ) : 'Hiện không còn công nợ HNH.'}
            </div>
          )}
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Ghi chú</label>
          <input type="text" value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Tùy chọn"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
        </div>
      </form>

      {overpay && (
        <OverpayWarning
          amount={overpay.amount} debt={overpay.debt} fmt={fmtVn} busy={busy}
          onCancel={() => setOverpay(null)}
          onConfirm={async () => { setOverpay(null); await doSubmit() }} />
      )}
    </Modal>
  )
}

function OverpayWarning({ amount, debt, fmt, busy, onCancel, onConfirm }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, busy])

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 200 }}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={busy ? undefined : onCancel} />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-xl shrink-0">
            ⚠️
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-900">Số tiền thanh toán lớn hơn công nợ</h3>
            <p className="mt-1 text-xs text-gray-600 leading-relaxed">
              Bạn đang chi nhiều hơn số đang nợ HNH. Nếu xác nhận, phần dư sẽ thành
              số dư dương (HNH nợ lại mình).
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-1.5 text-xs">
          <Line label="Công nợ hiện tại" value={fmt(debt)} />
          <Line label="Số tiền chi" value={fmt(amount)} tone="text-rose-600" />
          <div className="pt-1.5 border-t border-dashed border-gray-300">
            <Line label="Chi dư" value={fmt(amount - debt)} tone="text-amber-700" bold />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-50">
            Hủy để sửa lại
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
            {busy ? 'Đang lưu…' : 'Vẫn xác nhận chi'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Line({ label, value, tone = 'text-gray-800', bold = false }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono tabular-nums ${tone} ${bold ? 'font-bold' : 'font-semibold'}`}>{value}</span>
    </div>
  )
}
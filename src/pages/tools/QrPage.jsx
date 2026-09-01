import { useState } from 'react'
import ToolShell from '../../components/ToolShell'
import { generateQr } from '../../services/api'

const TYPES = [
  { key: 'url',     icon: '🔗', label: 'URL' },
  { key: 'text',    icon: '📝', label: 'Văn bản' },
  { key: 'product', icon: '📦', label: 'Sản phẩm' },
]

const PRODUCT_FIELDS = [
  { key: 'productName',    label: 'Tên sản phẩm',           type: 'text', ph: 'VD: Cheddar' },
  { key: 'productionDate', label: 'Ngày sản xuất',          type: 'date' },
  { key: 'expiryDate',     label: 'Hạn sử dụng',            type: 'date' },
  { key: 'packageWeight',  label: 'Khối lượng gói',         type: 'text', ph: 'VD: 500gr' },
  { key: 'batchWeight',    label: 'Khối lượng mẻ sản xuất', type: 'text', ph: 'VD: 30 kg' },
]

export default function QrPage() {
  const [type, setType]   = useState('url')
  const [form, setForm]   = useState({
    content: '', productName: '', productionDate: '',
    expiryDate: '', packageWeight: '', batchWeight: '',
  })
  const [qr, setQr]           = useState(null)
  const [qrContent, setQrContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setError('') }

  const switchType = t => {
    setType(t); setQr(null); setError('')
  }

  const validate = () => {
    if (type === 'url' || type === 'text') {
      if (!form.content.trim()) return type === 'url' ? 'Vui lòng nhập URL' : 'Vui lòng nhập nội dung'
      return ''
    }
    for (const f of PRODUCT_FIELDS) {
      if (!form[f.key]?.trim()) return `Vui lòng nhập ${f.label.toLowerCase()}`
    }
    if (new Date(form.expiryDate) <= new Date(form.productionDate)) {
      return 'Hạn sử dụng phải sau ngày sản xuất'
    }
    return ''
  }

  const submit = async e => {
    e.preventDefault()
    const v = validate()
    if (v) { setError(v); return }

    setLoading(true); setError(''); setQr(null)
    try {
      const params = type === 'product'
        ? { type, ...PRODUCT_FIELDS.reduce((a, f) => ({ ...a, [f.key]: form[f.key] }), {}) }
        : { type, content: form.content }

      const res = await generateQr(params)
      const env = res.data
      if (env && typeof env.code === 'number' && !(env.code >= 900 && env.code < 1000)) {
        throw new Error(env.message || 'Không tạo được mã QR')
      }
      const data = env?.data ?? env
      setQr(data.qrImage)
      setQrContent(data.content || '')
    } catch (err) {
      setError(err.response?.data?.message || err.message)
    } finally {
      setLoading(false)
    }
  }

  const download = () => {
    if (!qr) return
    const a = document.createElement('a')
    a.href = qr
    a.download = `qr_${Date.now()}.png`
    a.click()
  }

  return (
    <ToolShell icon="🔳" title="Tạo mã QR" subtitle="URL, văn bản hoặc thông tin sản phẩm">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 lg:gap-6">

        {/* ── Form ── */}
        <div className="lg:col-span-3">
          <div className="card p-4 sm:p-6">
            {/* Chọn loại */}
            <div className="flex gap-2 mb-5 overflow-x-auto">
              {TYPES.map(t => (
                <button
                  key={t.key}
                  onClick={() => switchType(t.key)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap border transition-colors
                    ${type === t.key
                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                >
                  <span>{t.icon}</span>{t.label}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="space-y-4" noValidate>
              {type === 'url' && (
                <Field label="URL">
                  <input className="input" type="url" placeholder="https://example.com"
                    value={form.content} onChange={e => set('content', e.target.value)} />
                </Field>
              )}

              {type === 'text' && (
                <Field label="Nội dung">
                  <textarea className="input min-h-[120px] resize-y"
                    placeholder="Nhập văn bản, số điện thoại, địa chỉ..."
                    value={form.content} onChange={e => set('content', e.target.value)} />
                </Field>
              )}

              {type === 'product' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {PRODUCT_FIELDS.map(f => (
                    <Field key={f.key} label={f.label}
                      className={f.key === 'productName' ? 'sm:col-span-2' : ''}>
                      <input
                        className="input"
                        type={f.type}
                        placeholder={f.ph}
                        min={f.key === 'expiryDate' ? form.productionDate || undefined : undefined}
                        value={form[f.key]}
                        onChange={e => set(f.key, e.target.value)}
                      />
                    </Field>
                  ))}
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 flex gap-2">
                  <span className="shrink-0">⚠️</span>{error}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full sm:w-auto justify-center">
                {loading ? 'Đang tạo...' : '🔳 Tạo mã QR'}
              </button>
            </form>
          </div>
        </div>

        {/* ── Kết quả ── */}
        <div className="lg:col-span-2">
          <div className="card p-4 sm:p-6 lg:sticky lg:top-20">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Kết quả</p>

            {!qr ? (
              <div className="py-16 text-center text-gray-300">
                <div className="text-5xl mb-3">🔳</div>
                <p className="text-sm">Mã QR sẽ hiện ở đây</p>
              </div>
            ) : (
              <>
                <div className="bg-white border border-gray-100 rounded-xl p-3 flex items-center justify-center">
                  <img src={qr} alt="QR code" className="w-full max-w-[260px] aspect-square object-contain" />
                </div>

                {qrContent && (
                  <pre className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 whitespace-pre-wrap break-words max-h-40 overflow-y-auto font-sans">
                    {qrContent}
                  </pre>
                )}

                <button onClick={download} className="btn-primary w-full justify-center mt-4">
                  ⬇ Tải ảnh PNG
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </ToolShell>
  )
}

function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

# Invoice Admin — Vite + React + Tailwind CSS

## Cài đặt
```bash
npm install
npm run dev      # dev server port 3000
npm run build    # production build
```

## Cấu hình
Sửa `.env`:
```
VITE_API_URL=http://localhost:9009
```

## Routes
| Route | Mô tả | Yêu cầu |
|-------|-------|---------|
| `/?orderCode=<code>` | Public — khách quét QR nhập thông tin xuất HĐ | Không cần login |
| `/login` | Đăng nhập | — |
| `/orders` | Danh sách đơn hàng POS | ACCOUNTANT |
| `/invoice-test` | Test API Viettel | ACCOUNTANT |
| Mọi route khác | 404 | — |

## QR Code
Tạo QR trỏ tới: `https://your-domain/?orderCode={posOrderCode}`

## Màu sắc dòng (trang /orders)
- 🟢 Xanh lá: Đã xuất hóa đơn thành công
- 🟠 Cam: Khách đã nhập thông tin xuất HĐ
- 🟡 Vàng: Hết hạn 12h mà chưa nhập
- ⬜ Trắng: Bình thường

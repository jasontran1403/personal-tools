/**
 * Giữ trạng thái "đang tải" hiện đủ lâu để mắt kịp thấy.
 *
 * Khi mạng nhanh, dòng "Đang tải thêm..." chớp lên rồi tắt trong 40ms — kết quả
 * là danh sách tự nhiên dài ra mà không rõ vì sao, cảm giác giật cục. Ép tối
 * thiểu 600ms thì nhịp cuộn có điểm nghỉ rõ ràng và animation chèn thêm kịp chạy.
 *
 * Chờ SONG SONG với request, không phải nối tiếp: mạng chậm hơn 600ms thì không
 * mất thêm giây nào.
 */
export const MIN_LOADING_MS = 600

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function withMinDelay(promise, ms = MIN_LOADING_MS) {
  const [result] = await Promise.all([promise, delay(ms)])
  return result
}

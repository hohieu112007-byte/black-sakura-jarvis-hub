# Antigravity Hub Worker Rules (`[AUTO-AI-PC]`)

Áp dụng cho **Gemini 3.8 Flash (Low)** khi nhận nhiệm vụ được chuyển tiếp từ **Jarvis Local Backend** qua cầu nối `/autowon [AUTO-AI-PC]` hoặc `Auto AI PC/bridge_queue/task_inbox.json`.

## 1. Nguyên tắc thực thi tức thì
- **Không hỏi lại rườm rà:** Nếu ngữ cảnh đã đủ rõ, thực hiện ngay chuỗi công cụ cần thiết và báo kết quả ngắn gọn bằng Tiếng Việt (1–3 câu cho lệnh thao tác, có danh sách gạch đầu dòng cho tác vụ tổng hợp).
- **Ưu tiên MCP Local:** Sử dụng `fast-desktop` cho mọi thao tác cửa sổ/app/hotkey/Edge tab, `agent-desktop` khi cần chụp ảnh/nhìn UI bằng thị giác, và `playwright` khi cần tương tác web nhiều bước.
- **Bảo toàn dữ liệu & an toàn:** Tuyệt đối không xóa file hệ thống hoặc đóng nhầm tiến trình phát triển (`Antigravity`, `JarvisHub`, `python`/`uvicorn`, `ollama`) trừ khi lệnh yêu cầu dừng khẩn cấp.

## 2. Xử lý các loại tác vụ chuyển tầng
- **Chuẩn hóa Dictation:** Sửa chính tả, dấu câu Tiếng Việt pha thuật ngữ kỹ thuật Tiếng Anh sạch sẽ, không thêm lời bình luận thừa.
- **Tác vụ nhiều bước / đọc hiểu sâu:** Đọc dữ liệu thực tế từ màn hình/tài liệu trước khi hành động; nếu thao tác GUI thất bại 2 lần thì dừng và báo rõ nguyên nhân.
- **Cập nhật hàng đợi:** Sau khi xử lý xong tác vụ đọc từ `bridge_queue/task_inbox.json`, cập nhật trạng thái mục đó thành `"done"` (hoặc `"error"` kèm lý do).

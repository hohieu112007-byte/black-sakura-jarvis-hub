---
description: Bật chế độ tự động điều khiển Đa Ứng Dụng & Trình Duyệt siêu mượt (Turbo Auto Mode ON)
---
// turbo-all
1. Chạy lệnh `powershell -ExecutionPolicy Bypass -File "C:\AI-Sandbox\.scripts\switch-mode.ps1" -Mode "on"`
2. Áp dụng chế độ Tốc Độ Cao cho cả Trình duyệt (`playwright`) và Ứng dụng Windows (`agent-desktop`):
   - Mở/chuyển ứng dụng trực tiếp bằng `desktop_focus_window` hoặc `desktop_launch`.
   - Tìm kiếm và thao tác bên trong ứng dụng bằng `desktop_find`, snapshot rút gọn, phím tắt nội bộ (`Ctrl+F`, `Ctrl+K`, `Enter`) và lệnh gộp (`desktop_batch`).
   - Tuân thủ nghiêm ngặt danh sách cấm tại `.agent/rules/mcp-safety-guardrails.md`.
3. Phản hồi ngắn gọn: "⚡ Đã bật /autowon (Đa Ứng Dụng Siêu Mượt): Sẵn sàng mở và điều khiển mọi app theo lệnh của bạn!"

---
description: Khóa tự động và bật phân quyền kiểm duyệt từng bước cho 3 MCP (Safe Mode ON)
---
// turbo-all
1. Chạy lệnh `powershell -ExecutionPolicy Bypass -File "C:\AI-Sandbox\.scripts\switch-mode.ps1" -Mode "off"`
2. Áp dụng trong phiên hiện tại: Chuyển cả 3 MCP về chế độ bảo vệ nghiêm ngặt — chỉ được phép quan sát (`snapshot`/`read`), mọi hành động click chuột, gõ phím, mở/đóng tab hay sửa file đều BẮT BUỘC phải hỏi ý kiến người dùng trước khi thực hiện.
3. Phản hồi ngắn gọn: "🛡️ Đã bật /autowoff: Đã khóa tự động, mọi thao tác của 3 MCP sẽ hỏi ý kiến bạn trước khi chạy."

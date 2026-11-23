# Contributing to Black Sakura Jarvis-Hub

Cảm ơn bạn đã quan tâm và đóng góp cho **Black Sakura Jarvis-Hub**!

## Quy tắc bảo mật bắt buộc trước khi tạo Pull Request

1. **Không bao giờ commit bí mật hoặc dữ liệu cá nhân:**
   - Kiểm tra `git status` để chắc chắn không có `.env`, `backend/.session_token`, `backend/config.json`, `jarvis-hub/state.json`, `bridge_queue/task_inbox.json`, hay file `*.log`.
2. **Không hardcode đường dẫn cá nhân hoặc phần cứng cố định:**
   - Sử dụng `get_sandbox_root()` / `JARVIS_SANDBOX_DIR`, đường dẫn tương đối theo `PROJECT_ROOT`, và tự động phát hiện GPU/Python/Ollama.
3. **Giữ nguyên các lớp bảo vệ an toàn:**
   - Không gỡ bỏ cơ chế kiểm tra `Host`/`Origin`/`X-Jarvis-Token` trong `backend/server.py`.
   - Không nội suy chuỗi trực tiếp vào lệnh PowerShell/shell; luôn truyền qua biến môi trường hoặc mảng tham số (`execFile` / `subprocess.run([...])`).
   - Không gỡ bỏ danh sách chặn tiến trình/cửa sổ/file nhạy cảm (`BLOCKED_PROCESSES`, `BLOCKED_TITLE_SUBSTRINGS`, `SENSITIVE_FILE_NAMES`).

## Kiểm thử trước khi gửi PR

```bash
# Kiểm tra cú pháp Python
python -m py_compile backend/*.py

# Build giao diện React HUD
cd jarvis-hub && npm run build
```

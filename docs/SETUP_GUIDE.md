# Hướng Dẫn Cài Đặt & Sử Dụng — Black Sakura Jarvis-Hub

Tài liệu này hướng dẫn chi tiết cách cài đặt và tối ưu **Black Sakura Jarvis-Hub** trên nhiều loại máy tính khác nhau (có GPU NVIDIA, chỉ có CPU, chưa cài Ollama, hoặc dùng model Ollama khác).

---

## 1. Chọn kịch bản phù hợp với máy của bạn

### Kịch bản A: Máy CHƯA cài Ollama (hoặc không muốn tải model nặng)
Bạn vẫn sử dụng được ngay:
- **Tầng 1 Fast-Path (`<50ms`, `0 MB VRAM`):** Mở/đóng ứng dụng, quản lý tab Edge/Chrome/Brave/Firefox, chuyển cửa sổ giữa các màn hình, phóng to/thu nhỏ, tăng giảm âm lượng/độ sáng, tìm YouTube/Google, tua video...
- **Tầng 3 Cloud Gemini API (tùy chọn):** Mở Settings trên HUD -> tab **AI & VRAM** -> bật **Cloud Gemini API** và dán API Key miễn phí từ Google AI Studio (hoặc ghi vào file `.env`).

### Kịch bản B: Máy có GPU NVIDIA (4GB / 6GB / 8GB / 12GB+)
1. Tải và cài đặt Ollama tại [https://ollama.com](https://ollama.com).
2. Tải model theo dung lượng VRAM:
   - **GPU 4 GB VRAM:** `ollama pull qwen3:1.7b` hoặc `ollama pull qwen3:0.6b`
   - **GPU 6–8 GB VRAM:** `ollama pull qwen3.5:4b` (khuyến nghị, hỗ trợ cả Vision nhìn màn hình)
   - **GPU 12 GB+ VRAM:** có thể dùng `qwen3.5:4b`, `qwen2.5:7b`, `gemma3:12b`, `llama3.2`...
3. Mở **Settings -> AI & VRAM**: ứng dụng tự nhận tên GPU thật, dung lượng VRAM thật và liệt kê toàn bộ model đã cài trên Ollama của bạn để chọn bằng 1 click (hoặc gõ tên model bất kỳ vào ô nhập model).

### Kịch bản C: Máy chỉ có CPU / Card Onboard (không có NVIDIA GPU)
- Ứng dụng tự chuyển sang **CPU Mode** (`Faster-Whisper` và Ollama chạy CPU mà không lỗi).
- Khuyến nghị chọn model nhẹ như `qwen3:0.6b` hoặc `qwen3:1.7b` (hoặc dùng `keep_alive = 1m` / `0s`) kết hợp Tầng 1 Fast-Path để phản hồi nhanh.

---

## 2. Cài đặt môi trường từ đầu

1. **Cài Python 3.10+** (khi cài trên Windows nhớ tích chọn **Add python.exe to PATH**) và **Node.js 18+**.
2. Clone dự án & cài gói Python:
   ```bash
   git clone https://github.com/hohieu112007-byte/black-sakura-jarvis-hub.git
   cd black-sakura-jarvis-hub
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```
3. Cài gói Node & build giao diện HUD:
   ```bash
   cd jarvis-hub
   npm install
   npm run build
   cd ..
   ```
4. *(Tùy chọn)* Tạo file cấu hình `.env` từ mẫu:
   ```bash
   copy .env.example .env
   ```
   > **Lưu ý bảo mật:** Tuyệt đối không chia sẻ hay đẩy file `.env` và `backend/.session_token` lên GitHub. File `.gitignore` đã chặn sẵn các file này.

---

## 3. Đóng gói thành file `.exe` Portable (`BlackSakuraJarvisHub.exe`)

Để tiện mở app bằng 1 cú click đúp mà không cần gõ `npm start`:

```bat
build_exe.bat
```

Script sẽ tự động:
1. Build giao diện React HUD (`jarvis-hub/src/renderer/dist`).
2. Tạo gói portable hoàn chỉnh tại `dist-exe\Black-Sakura-Jarvis-Hub\BlackSakuraJarvisHub.exe` kèm icon, `JarvisWakeHelper.exe`, `backend/`, `fast-desktop-mcp/` — và **tự động loại bỏ sạch** `.env`, `.session_token`, `config.json`, `state.json`, log cá nhân.
3. Khi chia sẻ thư mục `dist-exe\Black-Sakura-Jarvis-Hub\` sang máy Windows khác, máy đó chỉ cần có Python + các gói trong `requirements.txt` (và Node.js nếu dùng `fast-desktop-mcp`) rồi bấm đúp **`BlackSakuraJarvisHub.exe`**.

---

## 4. Tùy chọn nâng cao (Không bắt buộc)

- **OmniParser V2 (Tầng 2.5 nhận diện icon bằng ảnh):**
  Chỉ cần cài thêm khi bạn hay điều khiển app có icon không chữ / Canvas / WebGL:
  ```bash
  pip install torch ultralytics huggingface-hub
  ```
  Sau đó bật công tắc **OmniParser V2** trong Settings (mặc định tắt để tiết kiệm ~1.6 GB VRAM và dùng lưới 10×10 miễn phí).
- **Dual-STT kết hợp `VietNote-ASR` (0 MB VRAM) + `Faster-Whisper`:**
  Trong **Cài đặt -> AI & VRAM -> Nhận diện giọng nói (Dual STT)**, bạn có thể bấm **"Cài VietNote ASR"** để dùng model `Kaisye/VietNote-Zipformer-78M-Streaming` (nền `sherpa-onnx` trên CPU, **0 MB VRAM**) kết hợp danh sách từ khóa tiếng Anh (`hotwords` lấy tự động từ app đã cài + Từ điển riêng) cho lệnh Việt-Anh & chép lời, trong khi vẫn giữ **Faster-Whisper** cho chế độ tiếng Anh thuần hoặc làm dự phòng.
  *(Lưu ý giấy phép: trọng số model `VietNote-Zipformer-78M-Streaming` được tải tách rời từ Hugging Face theo điều khoản của tác giả `kaisye/vietnote-asr`, không đóng gói chung trong mã nguồn MIT).*
- **Đổi thư mục Sandbox:**
  Mặc định dữ liệu xuất Word/CSV và cache nằm ở `C:\AI-Sandbox` (nếu đã có) hoặc `./sandbox` trong thư mục dự án. Bạn có thể đặt biến môi trường `JARVIS_SANDBOX_DIR` trong `.env` để đổi vị trí lưu.

---

## 5. Khắc phục sự cố nhanh

- **Windows SmartScreen cảnh báo hoặc chặn file sau khi giải nén từ `.zip`:**  
  Khi tải `.zip` từ GitHub và giải nén bằng Windows Explorer, Windows có thể gắn cờ `Zone.Identifier`. Ngoài việc `BlackSakuraJarvisHub.exe` đã tự dự phòng `hotkey-helper.ps1` nếu `JarvisWakeHelper.exe` không khởi chạy được, bạn có thể bỏ chặn toàn bộ thư mục vừa giải nén bằng PowerShell:
  ```powershell
  Get-ChildItem -Path "D:\ThuMuc\Black-Sakura-Jarvis-Hub" -Recurse | Unblock-File
  ```
- **Máy chưa cài Node.js:** Bản Portable dùng trực tiếp runtime Node tích hợp sẵn trong `BlackSakuraJarvisHub.exe` (`ELECTRON_RUN_AS_NODE=1`) để chạy `fast-desktop-mcp` mà không cần cài Node.js riêng.
- **HUD báo chưa kết nối Backend (`:8765`):** Chạy `start_backend.bat` để xem log trực tiếp, kiểm tra xem Python thật (không phải stub `WindowsApps`) đã cài đủ `requirements.txt` chưa. Nếu cổng `8765` đang bị app khác chiếm, Hub tự chuyển sang cổng trống (`18765–18769`).
- **Lỗi `401 Unauthorized` khi gọi API thủ công:** Backend yêu cầu header `X-Jarvis-Token` lấy từ file `backend/.session_token` để chống website bên ngoài điều khiển trộm PC. Khởi động lại cả Backend và HUD để đồng bộ token phiên mới.
- **Máy báo chưa có Ollama:** Không ảnh hưởng đến Tầng 1. Cài Ollama ngay trong Setup Wizard (1 chạm) hoặc bật Cloud Gemini API trong Settings nếu cần AI suy luận phức tạp.

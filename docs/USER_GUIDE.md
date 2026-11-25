# Hướng Dẫn Sử Dụng — Black Sakura Jarvis-Hub

> Tài liệu này hướng dẫn đầy đủ **cách điều khiển Mini HUD** và **tất cả các tác vụ hàng ngày** mà **Black Sakura Jarvis-Hub** thực hiện được ngay trên Windows 10/11.  
> Xem hướng dẫn cài đặt & chọn cấu hình phần cứng tại **[SETUP_GUIDE.md](SETUP_GUIDE.md)**.

---

## 1. Cách gọi và sử dụng Mini HUD hàng ngày

| Thao tác | Cách thực hiện | Ghi chú |
| --- | --- | --- |
| **Gọi bằng giọng nói (rảnh tay)** | Nói **`"Hey Luna"`** hoặc **`"OK Luna"`** | Nhận diện nội bộ 100% (có thể đổi sang `Nova`, `Alpha`, `Sora`, `Milo`, `Jarvis` hoặc tên bất kỳ trong Cài đặt) |
| **Gọi bằng phím tắt** | Mặc định **`Ctrl + Alt + Space`** (hoặc `F9`, `Alt + Space`) | **Bấm nháy** để mở ô gõ chữ · **Nhấn giữ** để nói rồi thả ra gửi ngay |
| **Gửi ảnh / tài liệu cho AI** | Kéo-thả file vào HUD, bấm icon **kẹp giấy (`📎`)**, hoặc bấm **`Ctrl + V`** | Hỗ trợ ảnh (`PNG`, `JPG`, `WebP`) và tài liệu (`PDF`, `DOCX`, `XLSX`, `CSV`, `TXT`, `MD`, mã nguồn) |
| **Chép lời nhanh (Dictation)** | Giữ phím tắt ở chế độ đọc chép hoặc nói trực tiếp | Tự gõ tiếng Việt/Anh chuẩn dấu vào ô đang đặt con trỏ |
| **Ẩn HUD xuống khay** | Bấm nút **`X`** trên thanh HUD hoặc nói **`"Luna sleep now"`** / **`"ẩn hub"`** | Vẫn chạy nhẹ dưới System Tray, sẵn sàng nghe wake-word |
| **Thoát hẳn ứng dụng** | **`Shift + Click X`**, **chuột phải nút `X`**, hoặc **Cài đặt -> Thoát hẳn App** | Tắt sạch cả HUD lẫn Backend & giải phóng VRAM |
| **Đổi ngôn ngữ giao diện** | Bấm **`VI \| EN`** ở góc phải Cài đặt / Setup Wizard hoặc chuột phải System Tray | Chuyển tức thì giữa **Tiếng Việt** và **English** |
| **Chế độ an toàn** | Chuyển nút **`Safe` / `Turbo`** ở góc trái HUD | **Safe:** hỏi duyệt trước lệnh quan trọng · **Turbo:** chạy ngay (vẫn khóa cửa sổ nhạy cảm) |
| **Dual STT (`VietNote` + `Whisper`)** | **Cài đặt -> AI & VRAM -> Nhận diện giọng nói** | **Hybrid** tự dùng `VietNote ASR` (`0 MB VRAM` + English hotwords) khi nói Việt-Anh/chép lời/chơi game và dùng `Faster-Whisper` cho tiếng Anh tự do |

---

## 2. Hub làm được gì trong các tác vụ hàng ngày?

### A. Mở, đóng & quản lý ứng dụng / đa nhiệm nhiều màn hình (`<50ms`, 0 MB VRAM)
- **Mở bất kỳ ứng dụng nào trên máy:**  
  `mở Discord`, `mở Zalo`, `bật Spotify`, `mở VS Code`, `mở Steam`, `mở Notepad`, `mở Calculator`, `mở trình duyệt`... *(tự quét Start Menu & Get-StartApps của Windows)*.
- **Mở app đặt thẳng lên màn hình mong muốn:**  
  `mở Discord trên màn phụ`, `mở YouTube trên màn chính`, `mở Steam sang màn còn lại`.
- **Điều khiển cửa sổ đang focus hoặc chỉ định tên app:**  
  `phóng to cửa sổ đang mở`, `thu nhỏ Discord`, `chia đôi màn hình trái`, `chia đôi màn hình phải`, `chuyển cửa sổ sang màn 2`, `chuyển trình duyệt sang màn nhỏ hơn / lớn hơn`.
- **Lệnh ghép tự nhiên nhiều vế (`"và"`, `"rồi"`):**  
  `mở Discord trên màn phụ và mở YouTube tìm nhạc lofi`, `mở Steam rồi chuyển sang màn 2`.

### B. Quản lý trình duyệt & Tab thông minh (Edge, Chrome, Brave, Cốc Cốc, Firefox, Opera)
- **Mở website nhanh bằng tên quen thuộc:**  
  `mở Facebook`, `vào YouTube`, `mở Gmail`, `vào GitHub`, `mở Google`...
- **Đóng chính xác Tab hay App — kể cả khi mở song song cả hai:**  
  - `đóng tab facebook` -> chỉ đóng tab Facebook trong trình duyệt (không làm tắt các tab làm việc khác).  
  - `đóng app facebook` -> chỉ đóng app Facebook desktop.  
  - `đóng cả hai cái facebook mới mở` -> **đóng cả app lẫn tab Facebook** cùng lúc.  
  - `đóng cái vừa mở` / `tắt nó đi` -> tự nhớ lại app hoặc tab bạn vừa bảo Hub mở trong 10 phút gần nhất để đóng đúng mục tiêu.  
  - **Chống đóng nhầm cả trình duyệt:** Nếu trình duyệt chỉ còn 1 tab cuối, Hub báo rõ thay vì âm thầm tắt mất cửa sổ; chỉ khi bạn nói `tắt trình duyệt` mới đóng toàn bộ.
- **Dọn dẹp & chuyển tab nhanh:**  
  `mở tab mới`, `chuyển sang tab YouTube`, `giữ lại tab Facebook đóng các tab khác`, `tìm chữ "bảo hành" trên trang` (`Ctrl+F`).

### C. Giải trí, YouTube, Nhạc & Điều khiển Windows tức thì
- **Tìm & phát video / nhạc YouTube rảnh tay:**  
  `mở YouTube tìm nhạc lofi`, `mở Google tìm cách nấu phở bò`, `chọn video đầu tiên`, `chọn video thứ 3`, `mở video của kênh Trúc Nhân`, `mở video về AI mới nhất`.
- **Điều khiển trình phát Video / Nhạc:**  
  `tua thêm 2 phút`, `tua lại 30 giây`, `tua đến phút thứ 5`, `tạm dừng video`, `toàn màn hình` (`F`), `bật phụ đề` (`C`), `tắt tiếng video` (`M`), `bài tiếp theo`.
- **Âm lượng & Độ sáng Windows:**  
  `tăng âm lượng`, `giảm âm lượng`, `tắt tiếng`, `đặt độ sáng 60%`, `tăng độ sáng`, `giảm độ sáng`.

### D. Discord & Chế độ Gaming (`Party Mode` + `Game Guard`)
- **Điều khiển Discord không cần Alt+Tab khi đang chơi game:**  
  - `tắt mic Discord` / `bật mic Discord`  
  - `tắt tai nghe Discord` / `bật loa Discord`  
  - `share màn hình 1 trên Discord` / `stream màn hình 2 lên Discord` (tự focus Discord, chọn tab Screens và màn hình cần stream).
- **Party Mode 1 câu lệnh:**  
  Nói **`"Party mode"`** -> tự mở combo **Steam + Trình duyệt + Discord** bung toàn màn hình sang **màn phụ** (nếu có).
- **Tự quét Game & Xả VRAM thông minh:**  
  Khi phát hiện các game nặng đang chạy (`CS2`, `FC25`, `Forza Horizon 5`, `Star Citizen`, `Minecraft`, `ARC Raiders`...), Hub **tự xả model Ollama & Whisper khỏi VRAM** để nhường tối đa GPU cho game và tự tắt hiệu ứng VFX (0% GPU).

### E. Tác vụ AI thông minh: Đọc màn hình, Tài liệu, Tự động hóa UI & Xuất Word
- **Hỏi đáp về ảnh / màn hình đang mở:**  
  - `trên màn hình đang mở gì?`, `đọc trang này`, `tóm tắt video YouTube đang mở`  
  - Hoặc `Ctrl + V` ảnh chụp màn hình / kéo file `PDF`, `Word`, `Excel`, code vào HUD rồi hỏi trực tiếp: `tóm tắt file này thành 5 gạch đầu dòng`, `giải thích lỗi trong ảnh`, `dịch đoạn này sang tiếng Việt`.
- **Trích xuất nội dung & Xuất file Word (`.docx`):**  
  - `copy nội dung trên trang này` -> trích text gọn từ trang đang mở và đưa thẳng vào Clipboard.  
  - `xuất file word <nội dung>` hoặc bấm nút **Word** trên bảng **Chi tiết** -> tự tạo file `.docx` chuyên nghiệp trong thư mục `Exports` và mở lên xem ngay.
- **Tự động bấm / nhập vào bất kỳ ứng dụng nào (Tầng 2 AI + Tầng 2.5 Vision + Tầng 3 API):**  
  - `gõ <nội dung> vào <tên app>`, `bấm nút <tên nút> trên <tên app>`  
  - Với giao diện có icon không chữ (game launcher, app Canvas/WebGL), có thể bật **OmniParser V2** trong *Cài đặt -> AI & VRAM* để AI khoanh khung và bấm chính xác.
  - Khi máy chưa cài Ollama hoặc gặp tác vụ suy luận phức tạp nhiều bước, Hub tự chuyển mượt sang **Tầng 3 Cloud Gemini API Key** (nếu bạn đã nhập key & bật trong Cài đặt).

---

## 3. Các lớp bảo vệ & Chống xung đột khi dùng hàng ngày

1. **Chống xung đột với các app AI local khác (ví dụ app dịch / Stable Diffusion / LLM khác):**
   - Nếu cổng `8765` đã có ứng dụng khác sử dụng, Hub tự nhận diện dấu vân tay ứng dụng và **tự chuyển sang cổng trống** (`18765–18769` hoặc cổng rảnh bất kỳ).
   - Theo dõi riêng model của Jarvis trong Ollama (`_owned_ollama_models`) — **không bao giờ xả nhầm model của app AI khác** khỏi VRAM.
   - Nếu GPU còn dưới `2.0 GB` VRAM trống vì app khác đang chiếm, Hub **tự chuyển sang chạy CPU an toàn (`num_gpu=0`)** thay vì báo lỗi `CUDA OOM`.
2. **Bảo vệ quyền riêng tư & hệ thống:**
   - Tự động từ chối điều khiển các cửa sổ hệ thống nhạy cảm (`Taskmgr`, `regedit`, `powershell`, `cmd`, trình quản lý mật khẩu, trang ngân hàng/ví tiền ảo).
   - Tự động chặn đọc file `.env`, private key (`.ssh`, `.pem`), dữ liệu đăng nhập trình duyệt.
   - Backend chỉ nhận kết nối từ `127.0.0.1` kèm mã phiên `X-Jarvis-Token` ngẫu nhiên chống mọi website bên ngoài truy cập trái phép.

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Extension">
  <img src="https://img.shields.io/badge/Manifest-V3-34A853?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Version-2.1-00E5FF?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="License">
</p>

<h1 align="center">🛡️ FB Alive Extension</h1>

<p align="center">
  <strong>Chrome Extension (MV3) giữ session Facebook luôn sống — mô phỏng hành vi duyệt web thật, theo dõi cookie, xoay tab, cảnh báo Telegram.</strong>
</p>

<p align="center">
  <em>Dành cho QA / monitoring — không phải tool spam hay automation vi phạm ToS.</em>
</p>

---

## 📋 Mục lục

- [Tính năng](#-tính-năng)
- [Kiến trúc](#-kiến-trúc)
- [Cài đặt](#-cài-đặt)
- [Cấu hình](#-cấu-hình)
- [Telegram Bot Setup](#-telegram-bot-setup)
- [Giao diện](#-giao-diện)
- [Chi tiết kỹ thuật](#-chi-tiết-kỹ-thuật)
- [Cấu trúc thư mục](#-cấu-trúc-thư-mục)
- [Changelog](#-changelog)
- [License](#-license)

---

## ✨ Tính năng

### 🔄 Mô phỏng duyệt web thực (Browse Mode)
- **Cuộn trang** — scroll lên/xuống ngẫu nhiên với jitter ±20%
- **Story scroll** — lướt ngang stories Facebook
- **Post hover** — di chuột qua bài viết, mô phỏng đọc bài
- **Post click** — click vào bài viết rồi tự quay lại feed
- **Profile visit** — ghé thăm `/me` rồi quay về
- **Friends browse** — vào `/friends/`, click xem profile bạn bè ngẫu nhiên
- **Reel scroll** — lướt reel bằng ArrowDown hoặc click nút next
- **Rest periods** — nghỉ ngơi 5–20 phút sau mỗi 15–50 hành động (như người thật)

### 🍪 Cookie Tracker
- Snapshot toàn bộ cookie Facebook khi bắt đầu session
- Theo dõi thay đổi mỗi 5 phút (thêm / xoá / thay đổi giá trị)
- Hiển thị cookie trong popup, hỗ trợ **Copy String** & **Copy JSON**

### 🔀 Multi-Tab Rotation
- Xoay vòng qua nhiều URL Facebook (feed, groups, friends, reel...)
- Dwell time cấu hình được (mặc định 90s mỗi trang)
- Mô phỏng hành vi duyệt đa trang tự nhiên

### 📱 Telegram Alerts
- Gửi cảnh báo: bắt đầu/dừng session, thay đổi cookie, lỗi
- **Batched action log** — gom log mỗi 30s gửi 1 tin nhắn (tránh rate limit)
- Hỗ trợ 2 chế độ: **Group/Topic** hoặc **Private Chat**
- Nút **Test Message** ngay trong popup

### 📊 Chi tiết Log
- Mọi hành động đều ghi log kèm: `[pageType] /path/ — nội dung`
- Trích xuất post ID, reel ID từ URL
- Gửi **toàn bộ** log chi tiết qua Telegram để phân tích từ xa
- Hiển thị 50 entries gần nhất trong tab Logs, color-coded theo loại

### 🛡️ An toàn
- **Safe Mode** — tự dừng khi phát hiện checkpoint / login / security page
- Không bao giờ click nút action (Add Friend, Like, Share...)
- Chỉ thao tác đọc & cuộn — hoàn toàn passive

---

## 🏗 Kiến trúc

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Extension (MV3)                │
│                                                         │
│  ┌──────────┐    message     ┌──────────────────────┐   │
│  │ popup.js │ ◄────────────► │   background.js      │   │
│  │ popup.html│               │   (Service Worker)    │   │
│  │ styles.css│               │                      │   │
│  └──────────┘               │  • Session manager    │   │
│                              │  • Cookie tracker     │   │
│  ┌──────────────┐  message  │  • Tab rotation       │   │
│  │  content.js  │ ◄───────► │  • Telegram reporter  │   │
│  │  (injected)  │           │  • Batched log queue  │   │
│  │              │           └──────────────────────┘   │
│  │ • Scroll     │                     │                 │
│  │ • Browse     │                     ▼                 │
│  │ • Rest cycle │            ┌────────────────┐         │
│  └──────────────┘            │  Telegram Bot  │         │
│                              │  API           │         │
│  ┌──────────────┐            └────────────────┘         │
│  │ utils/       │                                       │
│  │  random.js   │  ← Crypto-safe PRNG utilities         │
│  └──────────────┘                                       │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 Cài đặt

### Yêu cầu
- Google Chrome 116+ (hoặc Chromium-based browser)
- Manifest V3 compatible

### Các bước

1. **Clone repo**
   ```bash
   git clone https://github.com/monasprox/fb-alive-extension.git
   ```

2. **Mở Chrome Extensions**
   ```
   chrome://extensions/
   ```

3. **Bật Developer mode** (góc trên bên phải)

4. **Load unpacked** → chọn thư mục `fb-alive-extension`

5. **Mở Facebook** → click icon extension → nhấn nút Power để bắt đầu

---

## ⚙️ Cấu hình

| Setting | Default | Mô tả |
|---------|---------|-------|
| `intervalMin` | `15s` | Khoảng cách tối thiểu giữa 2 hành động |
| `intervalMax` | `90s` | Khoảng cách tối đa giữa 2 hành động |
| `scrollMin` | `100px` | Khoảng cuộn tối thiểu mỗi lần |
| `scrollMax` | `350px` | Khoảng cuộn tối đa mỗi lần |
| `jitter` | `true` | ±20% noise trên mọi timing |
| `safeMode` | `true` | Tự dừng khi gặp checkpoint/login |
| `browseMode` | `false` | Bật mô phỏng duyệt web nâng cao |
| `browseFreq` | `15%` | Tỷ lệ thực hiện browse action thay vì scroll |
| `tabRotation` | `true` | Xoay tab qua nhiều trang Facebook |
| `tabRotateDwell` | `90s` | Thời gian ở lại mỗi trang khi xoay |
| `cookieTracking` | `true` | Theo dõi thay đổi cookie |

---

## 📱 Telegram Bot Setup

### 1. Tạo Bot
1. Chat với [@BotFather](https://t.me/BotFather) trên Telegram
2. Gửi `/newbot` → đặt tên → nhận **Bot Token**
3. Dán token vào ô "Bot Token" trong extension popup

### 2. Chế độ Group/Topic
- Thêm bot vào group → lấy **Group Chat ID** (dạng `-100...`)
- Nếu dùng topic (forum), điền thêm **Topic ID** (`message_thread_id`)

### 3. Chế độ Private Chat
- Chat 1 tin nhắn với bot → gọi API `getUpdates` để lấy **Private Chat ID**

### 4. Test
- Nhấn nút **"Send Test Message"** trong tab Settings để kiểm tra

---

## 🎨 Giao diện

Extension popup "Frosted Terminal" với 4 tab:

<table>
  <tr>
    <td align="center"><strong>Settings</strong></td>
    <td align="center"><strong>Cookies</strong></td>
    <td align="center"><strong>Rotation</strong></td>
    <td align="center"><strong>Logs</strong></td>
  </tr>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/833854c6-619b-42dc-a18a-219eed850128" width="200" alt="Settings tab"></td>
    <td><img src="https://github.com/user-attachments/assets/b4f44d46-61d6-4353-a7db-51d24074b57e" width="200" alt="Cookies tab"></td>
    <td><img src="https://github.com/user-attachments/assets/5208ea56-8259-4aba-9e5a-8d459166a508" width="200" alt="Rotation tab"></td>
    <td><img src="https://github.com/user-attachments/assets/0b182122-47ef-4463-af35-f9a9a77cd320" width="200" alt="Logs tab"></td>
  </tr>
</table>

| Tab | Chức năng |
|-----|-----------|
| **Settings** | Scroll timing, toggles, browse mode, Telegram config |
| **Cookies** | Danh sách cookie Facebook, copy string/JSON, theo dõi thay đổi |
| **Rotation** | Quản lý URL xoay tab, dwell time |
| **Logs** | 50 log entries gần nhất, color-coded, auto-scroll |

**Design:** Dark theme · Accent `#00E5FF` · Font: Roboto Slab + JetBrains Mono

---

## 🔧 Chi tiết kỹ thuật

### Timing (optimize cho hành vi thực)
| Parameter | Giá trị | Mục đích |
|-----------|---------|----------|
| Heartbeat | 1 phút | Kiểm tra service worker còn sống |
| Cookie check | 5 phút | So sánh cookie snapshot |
| Tab rotate | 5 phút | Chuyển sang trang FB tiếp theo |
| Anti-discard | 4 phút | Ngăn Chrome discard tab |
| Rest period | 5–20 phút | Nghỉ sau 15–50 hành động |

### Telegram Batching
- Buffer log trong 30 giây hoặc tối đa 20 entries
- Gom thành 1 tin nhắn → gửi 1 lần
- Tránh rate limit Telegram (20 msg/min cho group)

### Log Format
```
📋 Action Log (8 entries)

[14/04/2026 - 10:30:05] [feed] / — Scroll ↓245px @ 1200px (35%)
[14/04/2026 - 10:30:22] [feed] / — Post hover id:123456 — 5 post(s) in view
[14/04/2026 - 10:30:45] [feed] / — Browse → post /user/posts/789 id:789 | 3 unvisited
[14/04/2026 - 10:31:10] [reel] /reel/456 — Reel → next | /reel/456
[14/04/2026 - 10:35:00] [friends] /friends/ — Friends → profile /username | 8 unvisited
```

### Crypto-safe Random
- `utils/random.js` sử dụng `crypto.getRandomValues()` cho mọi random number
- Fisher-Yates shuffle để chọn ngẫu nhiên không thiên vị
- Jitter ±20% trên mọi timing parameter

---

## 📁 Cấu trúc thư mục

```
fb-alive-extension/
├── manifest.json          # Chrome Extension manifest v3
├── background.js          # Service Worker — session, cookie, Telegram
├── content.js             # Action engine — inject vào facebook.com
├── popup.html             # Giao diện popup chính
├── popup.js               # Logic popup: tabs, settings, cookie display
├── styles.css             # "Frosted Terminal" dark theme
├── utils/
│   └── random.js          # Crypto-safe PRNG utilities
├── CHECKLIST.md           # Development checklist
├── LICENSE                # MIT License
└── README.md
```

---

## 📝 Changelog

### v2.1 (Current)
- 📋 **Detailed Telegram logging** — mọi action kèm pageType, path, post ID
- 📦 **Batched Telegram sender** — gom log 30s/20 entries, gửi 1 lần
- 🕐 **Vietnam timezone** — format DD/MM/YYYY - HH:MM:SS (UTC+7)
- ⏱️ **Optimized timing** — interval 15–90s, scroll 100–350px
- 🎨 **Responsive tabbed UI** — color-coded logs, cookie copy
- 📱 **Telegram Group/Private mode** — radio selector, topic support

### v2.0
- 🍪 Cookie tracker — snapshot & diff monitoring
- 🔀 Multi-tab rotation — xoay vòng URL Facebook
- 📱 Telegram alerts — session, cookie, error notifications
- 🔄 Continuous running — không dừng khi tab bị hidden
- 🗄️ Visited tracking — không revisit cùng post/profile

### v1.1
- 🌐 Browse mode — story, hover, profile, post click
- 🛡️ Safe mode — auto-stop on unsafe URLs
- ⏰ Anti-discard alarms

### v1.0
- ✅ Basic scroll simulation
- ✅ Random interval & jitter

---

## 📄 License

MIT © [monasprox](https://github.com/monasprox)

---

<p align="center">
  <sub>Built with ☕ for QA monitoring purposes only</sub>
</p>

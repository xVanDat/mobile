# Mobile Plugins for Kettu / Vendetta / Bunny / Revenge

Bộ sưu tập các plugin dành cho client mod Discord trên Android (Kettu, Vendetta, Bunny, Revenge).

## Danh sách Plugins:

1. **FakeUserLocallyMobile**: Giả mạo giao diện tài khoản cá nhân hiện tại thành tài khoản mục tiêu khác (Target User ID) trên thiết bị của bạn.
2. **ReplaceUserLocallyMobile**: Giả mạo một tài khoản bất kỳ trên Discord (Replaced User ID) thành tài khoản mục tiêu (Target User ID).

## Hướng dẫn Build:

Yêu cầu: Đã cài đặt [Bun](https://bun.sh/).

```bash
# Cài đặt thư viện
bun install

# Build tất cả các plugins ra thư mục /dist
bun run build

# Chế độ phát triển (watch & live reload)
bun run build:dev
```

## Hướng dẫn Cài đặt vào Kettu / Mobile Client Mod:

1. Đưa repo này lên GitHub.
2. Bật GitHub Pages hoặc dùng link raw của thư mục `dist/<PluginName>` (VD: `https://raw.githubusercontent.com/<username>/<repo>/main/dist/FakeUserLocallyMobile`).
3. Dán đường dẫn trên vào mục **Plugins -> Install Plugin** trong ứng dụng Kettu / Vendetta.

# 城巴到站顯示板 · Citybus ETA Board

一個純前端的城巴（Citybus）實時到站時間顯示板，採用香港政府開放資料 API。

## 功能

- **顯示板模式**：預設顯示 B3X 路線、紅橋站、往深圳灣口岸，列出未來三班到站時間與剩餘分鐘，每 30 秒自動刷新。可透過設定切換任何路線 / 方向 / 車站。
- **附近車站模式**：使用瀏覽器 GPS 定位，列出最近 12 個城巴站（依直線距離排序），點選車站可查看該站所有途經路線的到站時間。

## 資料來源

- [城巴實時抵站時間及相關資料](https://data.gov.hk/tc-data/dataset/ctb-eta-transport-realtime-eta)（data.gov.hk）
- 即時 ETA：`https://rt.data.gov.hk/v2/transport/citybus/eta/ctb/{stop_id}/{route}`
- 單站全部路線 ETA：`https://rt.data.gov.hk/v1/transport/batch/stop-eta/ctb/{stop_id}`

## 技術

- 純靜態站（HTML / CSS / JS），無後端
- 官方 API 已啟用 CORS（`Access-Control-Allow-Origin: *`），瀏覽器可直接呼叫
- `stops_db.json`：全港 2,584 個城巴站座標資料庫（由官方路線 API 彙整），供 GPS 模式計算附近車站
- `routes_dest.json`：路線 → 目的地中文名稱對照表
- 時間全部固定顯示香港時間（UTC+8）

## 本地執行

直接用任意靜態伺服器開啟此目錄即可（GPS 定位需在 HTTPS 環境下才能使用）：

```bash
# 例如用 Python
python3 -m http.server 8000
# 或用 npx
npx serve
```

## 重新生成站點資料庫

如城巴新增或調整車站，可重新生成 `stops_db.json` 與 `routes_dest.json`：

```bash
python3 build_stops.py   # 會讀取官方 API，產生 stops_db.json
# routes_dest.json 由 build_stops.py 一併產出
```

## GitHub Pages 部署

1. 推送此目錄到 GitHub repo
2. 進入 **Settings → Pages → Deploy from a branch**
3. 選擇 `main` 分支、根目錄
4. 幾秒後即可透過 `https://<帳號>.github.io/<repo>/` 存取

## 授權

資料來源為香港政府開放資料，依其授權條款使用。程式碼可自由使用。

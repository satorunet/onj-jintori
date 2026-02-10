# サーバー分離計画 (4モジュール構成)

**作成日:** 2026-01-06
**対象ファイル:** `server.v3.js` (2662行, 112KB)
**目標:** 4つのモジュールに分離

---

## 分離構成

```
server.v3.js (メイン: ~200行)
    ↓ require
├── modules/config.js      ← ✅ Step 1: 完了済み (設定)
├── modules/game-logic.js  ← Step 2: ゲームロジック (~800行)
├── modules/network.js     ← Step 3: WebSocket・ブロードキャスト (~700行)
└── modules/api.js         ← Step 4: HTTP API・DB (~500行)
```

---

## Step 1: ✅ 完了 - 設定モジュール
**ファイル:** `modules/config.js`
**状態:** 既に分離済み

---

## Step 2: ゲームロジックモジュール
**ファイル:** `modules/game-logic.js` (~800行)

| 関数/セクション | 行範囲 | 内容 |
|----------------|--------|------|
| ゲーム状態変数 | 420-500 | players, worldGrid, territoryRects 等 |
| initGrid() | 502-564 | グリッド初期化 |
| ヘルパー関数 | 567-630 | generateId, getUniqueColor, toGrid 等 |
| rebuildTerritoryRects() | 632-727 | テリトリー再構築 |
| attemptCapture() | 729-1063 | 領地獲得ロジック (BFS) |
| ゲームループ | 1067-1271 | 50msメインループ |
| respawnPlayer() | 1275-1427 | リスポーン処理 |
| killPlayer() | 1429-1476 | キル処理 |
| endRound() | 1781-1930 | ラウンド終了 |
| getTeamStats() | 1950-1961 | チーム統計 |

---

## Step 3: ネットワークモジュール
**ファイル:** `modules/network.js` (~700行)

| 関数/セクション | 行範囲 | 内容 |
|----------------|--------|------|
| broadcast() | 1933-1948 | 全クライアント配信 |
| generateMinimapBitmap() | 1963-2021 | ミニマップ生成 |
| Short ID管理 | 2022-2038 | ID生成・管理 |
| WebSocket接続ハンドラ | 2041-2238 | on('connection'), on('message') |
| ブロードキャストループ | 2243-2580 | 150ms配信ループ |
| bandwidthStats | 441-482 | 転送量監視 |

---

## Step 4: API・データベースモジュール
**ファイル:** `modules/api.js` (~500行)

| 関数/セクション | 行範囲 | 内容 |
|----------------|--------|------|
| handleHttpRequest() | 38-398 | HTTP REST API |
| initDB() | 1522-1539 | DB初期化 |
| saveRankingsToDB() | 1478-1520 | ランキング保存 |
| saveRoundMinimap() | 1541-1555 | ミニマップ保存 |
| saveStatsToDB() | 1557-1628 | 統計保存 |
| printRoundStats() | 1630-1777 | 統計出力 |

---

## 最終構成イメージ

```javascript
// server.v3.js - メインエントリポイント (~200行)
const config = require('./modules/config');
const game = require('./modules/game-logic');
const network = require('./modules/network');
const api = require('./modules/api');

// サーバー作成
const server = config.createServer(api.handleHttpRequest);
const wss = new WebSocket.Server({ server, ... });

// ゲーム初期化
game.init(config);

// ネットワーク設定
network.setup(wss, game.state);
network.startBroadcastLoop();

// API設定
api.setGameState(game.state);

// サーバー起動
server.listen(config.PORT);
```

---

## 進捗状況

| Step | ファイル | 内容 | 行数 | 状態 |
|------|----------|------|------|------|
| 1 | config.js | 設定・定数・DB接続 | ~200 | ✅ 完了 |
| 2 | game-logic.js | ゲームループ・テリトリー | ~700 | ✅ 完了 |
| 3 | network.js | WebSocket・ブロードキャスト | ~600 | ✅ 完了 |
| 4 | api.js | HTTP API・DB保存 | ~550 | ✅ 完了 |

---

## 次のアクション

**統合作業:** 新しい `server.v4.js` を作成し、4つのモジュールを統合する。

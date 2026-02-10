# Game Project Specification v8

**更新日:** 2026-01-11  
**バージョン:** 8.0.0  
**サーバー:** Node.js + WebSocket (ws) + HTTP/2 (https)  
**クライアント:** HTML5 Canvas + WebSocket  
**データベース:** MySQL (ランキング・統計用)

---

## 📋 v8の主な変更点

### 🎯 新機能
1. **ブースト機能** - 移動速度1.5倍、5秒持続、30秒クールダウン
2. **ミニマップ履歴再生** - スコア画面でゲーム進行をパラパラ漫画で確認
3. **CPU協調AI** - チーム戦でCPU同士が協力

### 📊 プロトコル追加
- **移動コマンド2バイト目**: ブーストリクエスト
- **プレイヤーデータ**: `bs`(ブースト残り), `bc`(クールダウン残り)
- **round_end**: `minimapHistory`(マップ履歴)

---

## 1. 通信プロトコル概要

### 1.1 基本仕様

| 項目 | 値 |
|:-----|:---|
| **形式** | MessagePack (サーバー→クライアント状態更新) |
| **JSON** | サーバー→クライアント(init, round_end等), クライアント→サーバー(join, chat等) |
| **バイナリ** | クライアント→サーバー(移動コマンド 1-2バイト) |
| **圧縮** | WebSocket perMessageDeflate (gzip) |
| **状態更新間隔** | 150ms (6.7回/秒) |

### 1.2 送信頻度一覧

| データ | 頻度 | 間隔 | 形式 | 備考 |
|:-------|:-----|:-----|:-----|:-----|
| プレイヤー位置・軌跡 | 毎フレーム | 150ms | MessagePack | 差分送信 |
| テリトリー差分 | 変更時 | リアルタイム | バイナリ | `tb` |
| チーム統計 | 20フレーム毎 | 3秒 | MessagePack | TEAMモードのみ |
| ミニマップ | 33フレーム毎 | 5秒 | MessagePack | 圧縮ビットマップ |
| スコアボード | 33フレーム毎 | 5秒 | MessagePack | id, score, kills |
| ミニマップ履歴保存 | - | 20秒 | サーバー内部 | round_endで送信 |

---

## 2. クライアント → サーバー

### 2.1 移動コマンド (1-2バイト バイナリ)

**最頻出メッセージ**: 秒間10-30回送信

#### 1バイト目: 移動方向

| バイト値 | 意味 |
|:---------|:-----|
| `0-254` | 移動方向（角度エンコード） |
| `255` | 停止 |

**角度エンコーディング:**
```
バイト値 = (角度 + π) / (2π) × 254
```

| 方向 | 角度 | バイト値 |
|:-----|:-----|:---------|
| → 右 | 0° | 127 |
| ↗ 右上 | 45° | 159 |
| ↑ 上 | 90° | 191 |
| ← 左 | 180° | 0 or 254 |
| ↓ 下 | 270° (-90°) | 64 |
| 停止 | - | 255 |

#### 2バイト目: ブーストリクエスト（オプション）

| バイト値 | 意味 |
|:---------|:-----|
| `1` | ブースト発動リクエスト |
| `0` or 省略 | ブーストなし |

**サンプル:**
```javascript
// 右方向に移動
new Uint8Array([127])  // 1バイト

// 右方向に移動 + ブースト発動
new Uint8Array([127, 1])  // 2バイト
```

### 2.2 参加リクエスト (JSON)

```json
{
  "type": "join",
  "name": "プレイヤー名",
  "team": "🇯🇵ONJ"
}
```

### 2.3 チーム更新 (JSON)

```json
{
  "type": "update_team",
  "team": "🇯🇵NEW"
}
```

### 2.4 チャット (JSON)

```json
{
  "type": "chat",
  "text": "こんにちは！"
}
```

---

## 3. サーバー → クライアント

### 3.1 初期化メッセージ (`init`) - JSON

接続直後に1回送信。

```json
{
  "type": "init",
  "id": "abc123def456",
  "si": 42,
  "color": "#ff5733",
  "emoji": "😀",
  "world": {"width": 4000, "height": 3000},
  "mode": "TEAM",
  "obstacles": [],
  "tf": [
    {"x": 100, "y": 100, "w": 7, "h": 7, "o": "abc123def456", "c": "#ff5733"}
  ],
  "tv": 1,
  "teams": [
    {"name": "🇯🇵ONJ", "count": 3},
    {"name": "🇺🇸USA", "count": 2}
  ],
  "pc": 8
}
```

| フィールド | 型 | 説明 |
|:-----------|:---|:-----|
| `id` | string | プレイヤーID（長いID） |
| `si` | int | 短縮ID (shortId) |
| `color` | string | 自分の色 |
| `emoji` | string | 自分の絵文字 |
| `world` | object | ワールドサイズ |
| `mode` | string | `"SOLO"` or `"TEAM"` |
| `tf` | array | 初期テリトリー |
| `tv` | int | テリトリーバージョン |
| `teams` | array | チーム統計 |
| `pc` | int | 接続プレイヤー数 |

### 3.2 プレイヤーマスタ (`pm`) - JSON

新規プレイヤー参加時にブロードキャスト。

```json
{
  "type": "pm",
  "players": [
    {
      "i": "abc123def456",
      "si": 42,
      "n": "[🇯🇵ONJ] プレイヤー",
      "c": "#ff5733",
      "e": "😀",
      "t": "🇯🇵ONJ"
    }
  ]
}
```

### 3.3 状態更新 (`s`) - MessagePack

150ms毎に送信。

```javascript
{
  type: 's',
  tm: 175,           // 残り時間（秒）
  pc: 8,             // 接続プレイヤー数
  te: [{name: "🇯🇵ONJ", count: 3}],  // チーム統計（3秒毎）
  tb: <Buffer>,      // テリトリー差分（変更時のみ）
  tv: 1234,          // テリトリーバージョン
  mm: {...},         // ミニマップ（5秒毎）
  sb: [...],         // スコアボード（5秒毎）
  p: [...]           // プレイヤーデータ（AOIフィルタ済み）
}
```

#### プレイヤーオブジェクト (`p` 配列)

```javascript
{
  i: 42,           // shortId
  x: 1200,         // X座標
  y: 800,          // Y座標
  st: 1,           // 状態 (省略時=1)
  rb: <Buffer>,    // 軌跡バイナリ
  ft: 1,           // フル軌跡フラグ（オプション）
  tc: 1,           // 軌跡クリアフラグ（オプション）
  bs: 50,          // ブースト残り（100ms単位、自分のみ詳細）
  bc: 25           // クールダウン残り（秒、自分のみ）
}
```

| フィールド | 型 | 説明 |
|:-----------|:---|:-----|
| `i` | int | 短縮ID (shortId) |
| `x`, `y` | int | 位置座標 |
| `st` | int | 状態: 0=dead, 1=active, 2=waiting, 3-7=無敵(残り秒) |
| `rb` | Buffer | 軌跡バイナリ（差分 or フル） |
| `ft` | int | 1=フル軌跡（rb解釈用） |
| `tc` | int | 1=軌跡クリア済み |
| `bs` | int | ブースト残り時間（自分:100ms単位, 他者:1=ブースト中） |
| `bc` | int | クールダウン残り（秒、自分のみ） |

#### 軌跡バイナリフォーマット

**フル軌跡 (`ft=1`):**
```
Offset | Size | Description
-------|------|------------
0      | 2    | 始点X座標（グリッド単位, Little Endian）
2      | 2    | 始点Y座標（グリッド単位, Little Endian）
4      | 2    | ポイント1の差分（dx, dy各1バイト符号付き）
6      | 2    | ポイント2の差分
...    | ...  | 以降同様
```

**差分軌跡 (`ft`なし):**
```
Offset | Size | Description
-------|------|------------
0      | 2    | 新ポイント1の差分（dx, dy各1バイト符号付き）
2      | 2    | 新ポイント2の差分
...    | ...  | 以降同様
```

#### ミニマップデータ (`mm`)

```javascript
{
  tb: {
    bm: <Base64 gzip>,  // 圧縮ビットマップ (40x40)
    cp: {1: "#ff0000", 2: "#00ff00"},  // カラーパレット
    sz: 40,              // サイズ
    flags: [             // 国旗位置（チーム戦のみ）
      {f: "🇯🇵", x: 1200, y: 800},
      {f: "🇺🇸", x: 2400, y: 1600}
    ]
  },
  pl: [                  // プレイヤー位置 [x, y, colorIndex]
    [1200, 800, 1],
    [2400, 1600, 2]
  ]
}
```

### 3.4 ラウンド終了 (`round_end`) - JSON

```json
{
  "type": "round_end",
  "rankings": [
    {"name": "[🇯🇵ONJ] プレイヤー", "score": 12.5, "emoji": "😀", "color": "#ff5733", "kills": 3, "team": "🇯🇵ONJ"}
  ],
  "teamRankings": [
    {"name": "🇯🇵ONJ", "score": 45.6, "kills": 12, "members": 4}
  ],
  "winner": {"name": "[🇯🇵ONJ] プレイヤー", "score": 12.5},
  "nextMode": "SOLO",
  "allTeams": [{"name": "🇯🇵ONJ", "count": 4}],
  "totalPlayers": 8,
  "mapFlags": [
    {"f": "🇯🇵", "x": 1200, "y": 800}
  ],
  "minimapHistory": [
    {
      "time": 0,
      "bm": "<Base64 gzip>",
      "cp": {"1": "#ff0000"},
      "sz": 40,
      "flags": []
    },
    {
      "time": 20,
      "bm": "<Base64 gzip>",
      "cp": {"1": "#ff0000", "2": "#00ff00"},
      "sz": 40,
      "flags": [{"f": "🇯🇵", "x": 1200, "y": 800}]
    }
  ],
  "secondsUntilNext": 15
}
```

| フィールド | 型 | 説明 |
|:-----------|:---|:-----|
| `rankings` | array | プレイヤーランキング（上位10人） |
| `teamRankings` | array | チームランキング（上位5チーム） |
| `winner` | object | 1位プレイヤー |
| `nextMode` | string | 次のゲームモード |
| `mapFlags` | array | スコア画面用国旗位置 |
| `minimapHistory` | array | ミニマップ履歴（20秒毎のスナップショット） |
| `secondsUntilNext` | int | 次ラウンドまでの秒数 |

#### minimapHistory 配列

```javascript
[
  {
    time: 0,           // 経過秒数
    bm: "<Base64>",    // 圧縮ビットマップ
    cp: {...},         // カラーパレット
    sz: 40,            // サイズ
    flags: [...]       // 国旗位置
  },
  // 20秒毎のスナップショット...
  {
    time: 240,         // 最終状態
    bm: "<Base64>",
    cp: {...},
    sz: 40,
    flags: [...]
  }
]
```

### 3.5 プレイヤー死亡 (`player_death`) - JSON

```json
{
  "type": "player_death",
  "id": "abc123def456",
  "reason": "キル: 敵プレイヤー名"
}
```

### 3.6 ラウンド開始 (`round_start`) - JSON

```json
{
  "type": "round_start",
  "mode": "TEAM",
  "world": {"width": 4000, "height": 3000},
  "obstacles": [],
  "tf": [...],
  "tv": 0
}
```

### 3.7 チャット (`chat`) - JSON

```json
{
  "type": "chat",
  "text": "こんにちは！",
  "color": "#ff5733",
  "name": "[🇯🇵ONJ] プレイヤー"
}
```

---

## 4. 時系列フロー

### 4.1 接続〜ゲーム開始

```
Time    | Event                    | Client → Server | Server → Client
--------|--------------------------|-----------------|------------------
0.00s   | WebSocket接続            | -               | -
0.05s   | 初期データ受信           | -               | init (JSON)
0.10s   | 既存プレイヤー情報       | -               | pm (JSON)
0.15s   | ログイン画面表示         | -               | -
3.00s   | プレイヤー参加           | join (JSON)     | -
3.05s   | 参加承認                 | -               | pm (JSON, 全員へ)
3.10s   | 状態更新開始             | -               | s (MessagePack)
```

### 4.2 通常プレイ中

```
Time    | Event                    | Client → Server | Server → Client
--------|--------------------------|-----------------|------------------
0.00s   | 移動入力                 | [127] (1byte)   | -
0.15s   | 状態更新                 | -               | s {p:[{rb:差分}]}
0.20s   | 移動継続                 | [127] (1byte)   | -
0.30s   | 状態更新                 | -               | s {p:[{rb:差分}]}
0.50s   | ブースト発動             | [127, 1] (2byte)| -
0.60s   | 状態更新                 | -               | s {p:[{bs:50}]}
3.00s   | チーム統計更新           | -               | s {te:[...]}
5.00s   | ミニマップ更新           | -               | s {mm:{...}}
5.00s   | フル軌跡同期             | -               | s {p:[{ft:1, rb:フル}]}
```

### 4.3 軌跡操作

```
Time    | Event                    | Server → Client (プレイヤーA)
--------|--------------------------|--------------------------------
0.00s   | 軌跡開始                 | {i:42, ft:1, rb:[始点+差分]}
0.15s   | 1歩移動                  | {i:42, rb:[+1差分]}
0.30s   | 2歩移動                  | {i:42, rb:[+2差分]}
1.00s   | 陣地化成功               | {i:42, tc:1}
1.15s   | 新しい軌跡開始           | {i:42, ft:1, rb:[新始点]}
5.00s   | 定期フル同期             | {i:42, ft:1, rb:[全軌跡]}
```

### 4.4 ラウンド終了

```
Time    | Event                    | Client → Server | Server → Client
--------|--------------------------|-----------------|------------------
240.0s  | 時間切れ                 | -               | round_end (JSON)
240.1s  | スコア画面表示           | -               | -
245.0s  | チャット送信             | chat (JSON)     | chat (JSON, 全員へ)
255.0s  | 次ラウンド開始           | -               | round_start (JSON)
255.5s  | 状態更新再開             | -               | s (MessagePack)
```

---

## 5. ブースト機能

### 5.1 仕様

| 項目 | 値 |
|:-----|:---|
| **速度倍率** | 1.5倍 |
| **持続時間** | 5秒 (5000ms) |
| **クールダウン** | 30秒 |
| **発動条件** | クールダウン完了時 |

### 5.2 クライアント側の処理

```javascript
// 移動コマンド送信時
const buffer = new Uint8Array(wantBoost ? 2 : 1);
buffer[0] = angleByte;
if (wantBoost) buffer[1] = 1;
socket.send(buffer);

// 状態更新受信時
if (data.bs) {
  boostRemainingMs = data.bs * 100;  // 100ms単位
}
if (data.bc) {
  boostCooldownSec = data.bc;  // 秒単位
}
```

### 5.3 サーバー側の処理

```javascript
// network.js: 移動コマンド受信
if (msg.length === 2 && msg[1] === 1) {
    const now = Date.now();
    const canBoost = !p.boostCooldownUntil || now >= p.boostCooldownUntil;
    if (canBoost) {
        p.boostUntil = now + BOOST_DURATION;      // 5000ms
        p.boostCooldownUntil = now + BOOST_COOLDOWN;  // 30000ms
    }
}
```

---

## 6. ミニマップ履歴再生

### 6.1 サーバー側

```javascript
// game.js: 20秒毎にスナップショット保存
function saveMinimapSnapshot() {
    const minimapData = generateMinimapBitmap();
    state.minimapHistory.push({
        time: elapsedSeconds,
        bm: minimapData.bm.toString('base64'),
        cp: minimapData.cp,
        sz: minimapData.sz,
        flags: minimapData.flags || []
    });
}

// server.v5.js: round_endで送信
const resultMsg = {
    type: 'round_end',
    minimapHistory: game.getMinimapHistory(),
    // ...
};
```

### 6.2 クライアント側

```javascript
// client-ui.js: スコア画面で再生
window.minimapHistoryTimer = setInterval(() => {
    window.minimapHistoryIndex += window.minimapHistoryDirection;
    
    // 端で方向反転（往復再生）
    if (window.minimapHistoryIndex >= history.length - 1) {
        window.minimapHistoryDirection = -1;
    } else if (window.minimapHistoryIndex <= 0) {
        window.minimapHistoryDirection = 1;
    }
    
    renderMinimapHistoryFrame(window.minimapHistoryIndex);
}, 400);  // 400ms間隔
```

---

## 7. AOI (Area of Interest)

### 7.1 仕様

| 項目 | 値 |
|:-----|:---|
| **可視範囲** | 2500px |
| **判定** | プレイヤー位置間の距離 |
| **適用対象** | プレイヤーデータ (`p` 配列) |
| **除外** | ミニマップ、テリトリー（全員に送信） |

### 7.2 実装

```javascript
// network.js
const VISIBLE_DIST_SQ = 2500 * 2500;

activePlayers.forEach(p => {
    const isMe = myPlayer && p.shortId === myPlayer.shortId;
    const distSq = (p.x - myX) ** 2 + (p.y - myY) ** 2;
    
    if (!isMe && distSq >= VISIBLE_DIST_SQ) {
        // 視界外 → 送信しない & 軌跡状態リセット
        delete trailState[p.id];
        return;
    }
    
    // 視界内 → 送信対象に追加
    visiblePlayers.push(createPlayerData(p));
});
```

---

## 8. パフォーマンス統計

### 8.1 帯域使用量

| 項目 | v7 | v8 | 備考 |
|:-----|:---|:---|:-----|
| 1人あたり帯域 | 1.21 KB/s | 1.25 KB/s | ブーストデータ追加分 |
| round_end サイズ | ~5 KB | ~20 KB | minimapHistory追加分 |
| 月間帯域（1人） | 3.1 GB | 3.2 GB | |

### 8.2 統計レポート例

```
┌────────────────────────────────────────────────────────────┐
│            ⚡ ラウンド終了 - 転送量＆負荷統計レポート       │
├────────────────────────────────────────────────────────────┤
│ ⏱ 稼働: 4分0秒 | ラウンド: 4分0秒                          │
│ 💻 CPU: 2.7% | LA: 0.08 | ラグ: 0.4ms (Max: 17ms)          │
│ 📊 モード: TEAM | 接続: 6人 (アクティブ: 5人)              │
├────────────────────────────────────────────────────────────┤
│ 📡 ラウンド送信: 1.2 MB (5.0 KB/s)                         │
│ 📥 1人あたり: 200 KB (0.83 KB/s)                           │
├────────────────────────────────────────────────────────────┤
│ 【送信内訳】                                               │
│   🎮 プレイヤーデータ: 50 KB (25%)                         │
│   🗺 ミニマップ: 60 KB (30%)                               │
│   🏭 テリトリー差分: 30 KB (15%)                           │
│   👥 チーム統計: 20 KB (10%)                               │
│   📦 テリトリー全量: 5 KB (2.5%)                           │
│   📜 ミニマップ履歴: 35 KB (17.5%)                         │
└────────────────────────────────────────────────────────────┘
```

---

## 9. 実装ファイル

### 9.1 サーバー側

| ファイル | 役割 |
|:---------|:-----|
| `server.v5.js` | メインサーバー、ゲームループ |
| `modules/network.js` | WebSocket通信、差分軌跡送信 |
| `modules/game.js` | ゲームロジック、ミニマップ履歴 |
| `modules/config.js` | 設定、定数、状態管理 |
| `modules/cpu.js` | CPU AI、協調ロジック |
| `modules/stats.js` | 統計レポート |
| `modules/api.js` | HTTP API |

### 9.2 クライアント側

| ファイル | 役割 |
|:---------|:-----|
| `client-config.js` | グローバル変数、設定 |
| `client-network.js` | WebSocket通信、差分軌跡デコード |
| `client-game.js` | 描画、ゲームループ |
| `client-ui.js` | UI、スコア画面、履歴再生 |
| `index.html` | HTML構造 |
| `style.css` | スタイル |

---

## 10. v7からの変更点まとめ

| 変更項目 | v7 | v8 |
|:---------|:---|:---|
| **ブースト機能** | なし | 移動コマンド2バイト対応 |
| **ブースト状態送信** | なし | `bs`, `bc` フィールド追加 |
| **ミニマップ履歴** | なし | `minimapHistory` 追加 |
| **履歴保存間隔** | - | 20秒毎 |
| **履歴再生方式** | - | 往復再生、400ms間隔 |
| **round_endサイズ** | ~5KB | ~20KB |

---

**End of Document v8.0.0**

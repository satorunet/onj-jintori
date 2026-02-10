# Game Project Specification v6

**更新日:** 2026-01-07
**バージョン:** 6.0.0
**サーバー:** Node.js + WebSocket (ws) + HTTP/2 (https)
**クライアント:** HTML5 Canvas + WebSocket
**データベース:** MySQL (ランキング・統計用)

---

## 1. ディレクトリ構造

Version 6では、モジュール化されたサーバーロジック、静的アセット、クライアントモジュールが以下のように構成されています。

```text
/game01/
├── server.v5.js          # メインゲームサーバー (エントリーポイント)
├── modules/              # サーバーモジュール
│   ├── config.js         # 設定・定数・チーム色定義
│   ├── network.js        # WebSocket通信・接続管理
│   ├── game.js           # ゲームロジック・領地計算
│   └── api.js            # REST APIエンドポイント
├── msgpack.js            # 共有ライブラリ (MsgPackエンコーダ/デコーダ)
├── public_html/          # 静的Webアセット (ドキュメントルート)
│   ├── index.html        # エントリーポイント
│   ├── style.css         # スタイルシート
│   ├── admin.html        # 管理画面
│   └── client/           # モジュール化されたクライアントJS
│       ├── client-config.js   # 設定・定数・グローバル状態
│       ├── client-network.js  # WebSocket通信・データ同期
│       ├── client-game.js     # ゲームループ・描画・入力
│       └── client-ui.js       # UI操作・イベントハンドラ
├── docs/                 # ドキュメント
├── sql/                  # データベース定義
└── bkup/                 # バックアップ
```

## 2. サーバーアーキテクチャ

### 2.1 起動オプション

```bash
node server.v5.js [options]
```

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `--debug` | デバッグログを有効化 | false |
| `--toukei` | 統計出力を有効化 | false |
| `--port=XXXX` | ポート番号指定 | 2053 |

### 2.2 静的ファイル配信

- `public_html/` ディレクトリ配下のファイルを配信する簡易HTTPサーバー機能を内蔵。
- 対応MIMEタイプ: html, css, js, json, png, jpg, mp3, mp4, etc.
- ディレクトリトラバーサル対策済み。
- CORS設定: `open2ch.net` サブドメインおよびローカルホストからのアクセスを許可。

### 2.3 WebSocketサーバー

- **ライブラリ:** `ws` (perMessageDeflate有効化により通信量を圧縮)
- **ポート:** 2053 (または 2087)
- **SSL:** 証明書が存在する場合はWSS、なければWSとして動作。
- **通信モード:** WebSocketのみ (Polling無効化によるパフォーマンス最適化)。

### 2.4 ゲームループ

- **ティックレート:** 可変 (負荷に応じて変動、基本60FPSターゲット)
- **ワールド:** グリッドベース (1セル = 10px)。
- **マップサイズ:** 参加人数に応じて動的に拡張 (`WORLD_WIDTH/HEIGHT` = 2000 + 人数*100)。
- **ゲームモード:** SOLO / TEAM の交互実行
  - **SOLO:** 通常のゲーム時間
  - **TEAM:** ゲーム時間 + 120秒（準備時間含む）
- **ロジック:**
  - **移動:** 速度ベクトルベース。クライアント入力は角度(0-254)。
  - **領地獲得:** フロードフィル（塗りつぶし）アルゴリズム。軌跡がループを作ると囲まれた領域を獲得。
  - **内部獲得:** 自分の領地や軌跡で囲まれた「敵の領地」や「空白地」も獲得対象。
    - **小島ルール:** 内部の敵領地を獲得する際、複数の島がある場合は最も面積の小さい島のみを獲得。
    - **空白地の獲得:** 内部の空白地（元敵領地）も獲得可能。
  - **障害物:** グリッドに沿った矩形の障害物を生成。

### 2.5 APIエンドポイント (HTTP)

- `/api/rounds`: 最近のラウンド一覧 (フィルタ: `hours`, `limit`)
- `/api/round/:id`: 特定ラウンドの詳細統計（ランキング、ミニマップデータ）
- `/api/player-stats`: プレイヤー累計成績
- `/api/team-stats`: チーム累計成績
- `/api/server-stats`: サーバーパフォーマンス統計 (CPU, メモリ, 帯域, ラグ)
- `/api/server-realtime`: リアルタイムサーバー状態 (メモリ詳細, 稼働時間)
- `/api/admin/reset-rankings`: [POST] ランキングデータのリセット

## 3. クライアントアーキテクチャ (`public_html/client/*`)

クライアント機能は責務ごとに4つのモジュールに分割されています。

| ファイル | 責務 |
|------|----------------|
| **client-config.js** | 定数(`SERVER_URL`, `COLORS`)、グローバル変数(`players`, `world`)、ユーティリティ(`formatScore`) |
| **client-network.js** | WebSocket接続(`connect`)、メッセージルーティング(`onmessage`)、デシリアライズ(`MsgPack`, `Pako`)、状態同期 |
| **client-game.js** | メインループ(`loop`)、描画(`drawParticles`, `drawGrid`, `drawMinimap`)、入力処理(バーチャルジョイスティック) |
| **client-ui.js** | HTML UI操作(`updateLeaderboard`, 画面遷移)、モーダル、チャット表示、結果画面 |

## 4. 通信プロトコル

データ転送最適化のため、**MsgPack** と **カスタムバイナリ** を併用しています。

### 4.1 Client -> Server

| タイプ | フォーマット | 内容・備考 |
|------|--------|-------------|
| **Join** | MsgPack (JSON) | `{ type: 'join', name: '..', team: '..' }` ※チーム名は国旗2文字+名前3文字まで（最大5文字） |
| **Input** | **Binary (1 byte)** | `Uint8[0]`: 角度 (0-254)。 `255` = 停止。 |
| **Chat** | MsgPack (JSON) | `{ type: 'chat', text: '..' }` 最大15文字 |
| **Team** | MsgPack (JSON) | `{ type: 'update_team', team: '..' }` |
| **Png** | MsgPack (JSON) | `{ type: 'png' }` (Ping計測用) |

### 4.2 Server -> Client (MsgPack)

| キー | 説明 | 内容詳細 |
|------|-------------|-------------------|
| `type` | メッセージタイプ | `'init'`, `'s'` (state), `'pm'` (player master), `'round_start'`, `'round_end'`, `'chat'` 等 |
| `id` | 自分のID | 初回 `init` 時に付与。 |
| `world` | ワールド情報 | `{ width, height }` (グリッド計算用) |
| `p` / `players` | プレイヤーリスト | 状態更新用配列。**waitingプレイヤーは除外される** |
| `tm` / `time` | 残り時間 | ゲーム終了までの秒数。 |
| `pc` | 接続数 | ロビー待機含む全接続数。 |
| `tb` | 領地バイナリ | 領地更新差分データ（後述）。 |
| `mm` | ミニマップデータ | `{ tb: { bm: 'Base64Bitmap', sz: Size, cp: Palette } }` |
| `te` / `teams`| チーム統計 | チームごとの占有率、スコア等。 |
| `rb` | 軌跡バイナリ | プレイヤーの軌跡データ（圧縮済み） |

### 4.3 領地バイナリフォーマット (`tb`)

帯域削減のため、領地の増減は**リトルエンディアンのカスタムバイナリ**で送信されます。

**構造:**
1. **Additions (追加分):**
   - `Count` (Uint16): 個数
   - **各エントリ (12 bytes):**
     - `x` (Uint16): グリッドX座標
     - `y` (Uint16): グリッドY座標
     - `w` (Uint16): 幅
     - `h` (Uint16): 高さ
     - `sid` (Uint16): 所有者ShortID
     - `r, g, b` (Uint8 x3): 色 (チーム固定色またはプレイヤー色)
     - `padding` (Uint8): パディング
2. **Removals (削除分):**
   - `Count` (Uint16): 個数
   - **各エントリ (4 bytes):**
     - `x` (Uint16): グリッドX座標
     - `y` (Uint16): グリッドY座標

### 4.4 軌跡バイナリフォーマット (`rb`)

プレイヤーの移動軌跡は圧縮バイナリ形式で送信されます。

**構造:**
- `Count` (Uint16): 座標点の個数
- **各座標 (4 bytes):**
  - `x` (Uint16): X座標
  - `y` (Uint16): Y座標

クライアント側では、この軌跡データを `p.trail` に格納し、`pixelTrail` （スムーズ描画用）の初期化に使用します。

### 4.5 ミニマップ転送仕様 (`mm.tb`)

- **解像度:** 40x40 グリッド。
- **データ形式:** Gzip圧縮(Deflate)されたバイト配列をBase64エンコード。
- **値:** 0=空, 1-255=パレットインデックス。
- **パレット (`cp`):** インデックスに対応するカラーコード(Hex)のマッピング。

## 4.6 通信フロー詳細（時系列）

### フェーズ1: 接続・初期化

#### 1. クライアント → サーバー: WebSocket接続
```javascript
const ws = new WebSocket('wss://jintori.open2ch.net:2053');
```

#### 2. サーバー → クライアント: `init` メッセージ
```json
{
  "type": "init",
  "id": "abc123def456",
  "shortId": 1,
  "world": {
    "width": 2300,
    "height": 2300
  },
  "obstacles": [
    {"x": 500, "y": 500, "w": 100, "h": 100},
    {"x": 1200, "y": 800, "w": 80, "h": 120}
  ],
  "tf": <Uint8Array>,  // 完全な領地データ（バイナリ）
  "pc": 3,  // 現在の接続数
  "teams": [
    {"name": "🇯🇵JPN", "count": 2}
  ]
}
```

**`tf` (Territory Full) のバイナリ構造:**
```
[Additions Count: Uint16] [Removals Count: Uint16]
[x: Uint16][y: Uint16][w: Uint16][h: Uint16][sid: Uint16][r: Uint8][g: Uint8][b: Uint8][pad: Uint8]
...繰り返し...
```

#### 3. サーバー → クライアント: `pm` (Player Master) メッセージ
```json
{
  "type": "pm",
  "players": [
    {
      "i": "abc123def456",
      "si": 1,
      "n": "Player1",
      "c": "#3b82f6",
      "e": "😀",
      "t": ""
    },
    {
      "i": "xyz789ghi012",
      "si": 2,
      "n": "[🇯🇵JPN] Player2",
      "c": "#ef4444",
      "e": "👑",
      "t": "🇯🇵JPN"
    }
  ]
}
```

### フェーズ2: ゲーム参加

#### 4. クライアント → サーバー: `join` メッセージ
```json
{
  "type": "join",
  "name": "MyName",
  "team": "🇯🇵JPN"
}
```

**サーバー側処理:**
1. チーム名を `Array.from()` でコードポイント単位に分割
2. 最大5文字(=国旗2+名前3)に切り詰め
3. `[🇯🇵JPN]` タグをプレイヤー名に付加
4. チーム色を適用（固定色 or 既存メンバーと同じ色）

#### 5. サーバー → 全クライアント: `pm` (更新)
```json
{
  "type": "pm",
  "players": [
    {
      "i": "abc123def456",
      "si": 1,
      "n": "[🇯🇵JPN] MyName",
      "c": "#ef4444",
      "e": "😀",
      "t": "🇯🇵JPN"
    }
  ]
}
```

### フェーズ3: ラウンド開始

#### 6. サーバー → 全クライアント: `round_start` メッセージ
```json
{
  "type": "round_start",
  "mode": "TEAM",
  "time": 240
}
```

### フェーズ4: ゲームプレイ中（毎フレーム）

#### 7. クライアント → サーバー: 入力データ（バイナリ）
```
[角度: Uint8]
```
- 値の範囲: 0-254（360度を256分割）
- 255 = 停止

**実例:**
- `0x00` = 0度（右）
- `0x40` = 90度（下）
- `0x80` = 180度（左）
- `0xC0` = 270度（上）
- `0xFF` = 停止

#### 8. サーバー → クライアント: `s` (State) メッセージ
```json
{
  "type": "s",
  "tm": 235,
  "p": [
    {
      "i": 1,  // shortId
      "x": 1200.5,
      "y": 850.3,
      "sc": 45,  // score (raw)
      "rb": <Uint8Array>  // 軌跡バイナリ
    },
    {
      "i": 2,
      "x": 1500.2,
      "y": 1100.8,
      "sc": 78,
      "st": 5,  // state: 2+invulnerableCount (3秒無敵)
      "rb": <Uint8Array>
    }
  ],
  "tb": <Uint8Array>,  // 領地デルタバイナリ
  "mm": {  // 20フレームに1回送信
    "tb": {
      "bm": "H4sIAAAAAAAA/w...",  // Base64エンコードされたGzip圧縮ビットマップ
      "sz": 40,
      "cp": {  // カラーパレット
        "1": "#ef4444",
        "2": "#3b82f6",
        "3": "#22c55e"
      }
    }
  },
  "te": [  // チーム統計（20フレームに1回）
    {"name": "🇯🇵JPN", "count": 2}
  ]
}
```

**`rb` (Trail Binary) デコード例:**
```javascript
function decodeTrail(buffer) {
  const view = new DataView(buffer.buffer || buffer);
  const count = view.getUint16(0, true);  // リトルエンディアン
  const trail = [];
  
  for (let i = 0; i < count; i++) {
    const offset = 2 + i * 4;
    trail.push({
      x: view.getUint16(offset, true),
      y: view.getUint16(offset + 2, true)
    });
  }
  
  return trail;
}
```

**`tb` (Territory Binary) デコード例:**
```javascript
function decodeTerritoryDelta(buffer) {
  const view = new DataView(buffer.buffer || buffer);
  let offset = 0;
  
  // Additions
  const addCount = view.getUint16(offset, true);
  offset += 2;
  const additions = [];
  
  for (let i = 0; i < addCount; i++) {
    additions.push({
      x: view.getUint16(offset, true),
      y: view.getUint16(offset + 2, true),
      w: view.getUint16(offset + 4, true),
      h: view.getUint16(offset + 6, true),
      ownerId: view.getUint16(offset + 8, true),
      color: `rgb(${view.getUint8(offset + 10)}, ${view.getUint8(offset + 11)}, ${view.getUint8(offset + 12)})`
    });
    offset += 13;  // 12 bytes + 1 padding
  }
  
  // Removals
  const remCount = view.getUint16(offset, true);
  offset += 2;
  const removals = [];
  
  for (let i = 0; i < remCount; i++) {
    removals.push({
      x: view.getUint16(offset, true),
      y: view.getUint16(offset + 2, true)
    });
    offset += 4;
  }
  
  return { additions, removals };
}
```

### フェーズ5: チャット

#### 9. クライアント → サーバー: `chat` メッセージ
```json
{
  "type": "chat",
  "text": "こんにちは！"
}
```

#### 10. サーバー → 全クライアント: `chat` メッセージ
```json
{
  "type": "chat",
  "from": "MyName",
  "text": "こんにちは！",
  "color": "#ef4444",
  "emoji": "😀"
}
```

### フェーズ6: ラウンド終了

#### 11. サーバー → 全クライアント: `round_end` メッセージ
```json
{
  "type": "round_end",
  "rankings": [
    {
      "name": "[🇯🇵JPN] Player2",
      "score": 15.5,  // パーセンテージ
      "kills": 3,
      "team": "🇯🇵JPN",
      "emoji": "👑"
    },
    {
      "name": "[🇯🇵JPN] MyName",
      "score": 12.3,
      "kills": 1,
      "team": "🇯🇵JPN",
      "emoji": "😀"
    }
  ],
  "teams": [
    {
      "name": "🇯🇵JPN",
      "score": 27.8,
      "kills": 4,
      "members": 2
    }
  ],
  "minimap": {
    "tb": {
      "bm": "H4sIAAAAAAAA/w...",
      "sz": 40,
      "cp": {"1": "#ef4444", "2": "#3b82f6"}
    }
  },
  "total": 5,
  "nextMode": "SOLO"
}
```

### フェーズ7: チーム変更（結果画面中）

#### 12. クライアント → サーバー: `update_team` メッセージ
```json
{
  "type": "update_team",
  "team": "🇺🇸USA"
}
```

**サーバー側処理:**
- `p.requestedTeam` を更新
- 次のラウンド開始時に反映

## 4.7 実データサンプル（実測値）

### 帯域使用量（`--toukei`オプション出力例）

```json
{
  "received": {
    "total": 12450,
    "join": 145,
    "input": 11980,
    "chat": 125,
    "updateTeam": 80,
    "ping": 120
  },
  "sent": {
    "total": 458920,
    "state": 385600,
    "minimap": 45200,
    "territoryDelta": 18500,
    "territoryFull": 3200,
    "playerMaster": 5820,
    "broadcastsPerSecond": 60
  },
  "cpu": {
    "loadAvg1m": 0.45,
    "eventLoopLagAvg": 2.3,
    "eventLoopLagMax": 8.5,
    "processUserCPU": 12.5,
    "processSystemCPU": 3.2
  },
  "memory": {
    "heapUsed": 45678900,
    "external": 1234500,
    "arrayBuffers": 567800
  }
}
```

### ミニマップビットマップのデコード例

```javascript
// Base64 → ArrayBuffer → Gzip解凍 → ピクセルデータ
async function decodeMinimapBitmap(base64Data, size, palette) {
  // 1. Base64デコード
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  // 2. Gzip解凍（Pakoライブラリ使用）
  const decompressed = pako.inflate(bytes);
  
  // 3. ピクセルデータとして解釈
  // decompressed[y * size + x] = カラーインデックス
  const canvas = document.getElementById('minimap');
  const ctx = canvas.getContext('2d');
  const pixelSize = canvas.width / size;
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const colorIdx = decompressed[y * size + x];
      if (colorIdx > 0 && palette[colorIdx]) {
        ctx.fillStyle = palette[colorIdx];
        ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize + 1, pixelSize + 1);
      }
    }
  }
}
```

### プレイヤー状態 (`st`) のエンコーディング

| 値 | 意味 |
|----|------|
| 未送信（省略） | `state: 'active'` かつ `invulnerableCount: 0` |
| `0` | `state: 'dead'` |
| `2` | `state: 'waiting'` |
| `3` | `state: 'active'` かつ `invulnerableCount: 1` (1秒無敵) |
| `4` | `state: 'active'` かつ `invulnerableCount: 2` (2秒無敵) |
| `5` | `state: 'active'` かつ `invulnerableCount: 3` (3秒無敵) |

**クライアント側デコード:**
```javascript
if (serverP.st === undefined) {
  p.state = 'active';
  p.invulnerableCount = 0;
} else if (serverP.st === 0) {
  p.state = 'dead';
} else if (serverP.st === 2) {
  p.state = 'waiting';
} else if (serverP.st >= 3) {
  p.state = 'active';
  p.invulnerableCount = serverP.st - 2;
}
```

## 4.8 送受信データの頻度・データ量・実例

### 4.8.1 Client → Server データ頻度・サイズ

| メッセージタイプ | 頻度 | データサイズ | 備考 |
|-----------------|------|-------------|------|
| **WebSocket接続** | 1回（初回のみ） | - | TLS/SSL ハンドシェイク |
| **join** | 1回（ゲーム参加時） | 30-80 bytes | MsgPack形式 |
| **input** | 60回/秒 | 1 byte/回 = 60 bytes/秒 | バイナリ（角度データ） |
| **chat** | 最大1回/ラウンド | 50-100 bytes | MsgPack形式、15文字まで |
| **update_team** | 0-5回/ラウンド | 30-70 bytes | 結果画面中のチーム変更 |
| **ping** | 任意 | 15-20 bytes | 計測用（通常は未使用） |

**1プレイヤーの送信量推定（2分ラウンド）:**
- 入力データ: 60 bytes/秒 × 120秒 = **7,200 bytes**
- join: 50 bytes × 1回 = 50 bytes
- chat: 75 bytes × 1回 = 75 bytes
- **合計: 約7.3 KB/ラウンド**

#### 実データサンプル: `join` メッセージ

**MsgPack エンコード前（JSON表現）:**
```json
{
  "type": "join",
  "name": "さとる",
  "team": "🇯🇵JPN"
}
```

**MsgPack エンコード後（16進数ダンプ）:**
```
83 A4 type A4 join A4 name AC E3 81 95 E3 81 A8 E3 82 8B A4 team AC F0 9F 87 AF F0 9F 87 B5 4A 50 4E
```
**サイズ:** 約45 bytes

#### 実データサンプル: `input` バイナリ

**角度45度（右下方向）:**
```hex
20
```
**サイズ:** 1 byte

**停止:**
```hex
FF
```
**サイズ:** 1 byte

### 4.8.2 Server → Client データ頻度・サイズ

| メッセージタイプ | 頻度 | 推定データサイズ | 備考 |
|-----------------|------|-----------------|------|
| **init** | 1回（接続時） | 2,000-10,000 bytes | 初期領地データ（プレイヤー数依存） |
| **pm** (Player Master) | 不定期 | 100-500 bytes/回 | プレイヤー情報更新時 |
| **s** (State) | 60回/秒 | 可変（後述） | ゲーム状態更新 |
| **round_start** | 1回/ラウンド開始 | 50-100 bytes | ラウンド開始通知 |
| **round_end** | 1回/ラウンド終了 | 1,000-5,000 bytes | 結果データ＋ミニマップ |
| **chat** | 不定期 | 80-150 bytes/回 | チャット配信 |

#### State メッセージ (`s`) の詳細構成

**基本構造:**
```json
{
  "type": "s",
  "tm": <number>,      // 2 bytes (MsgPack)
  "p": [<players>],    // 可変
  "tb": <Uint8Array>,  // 可変（領地変更時のみ）
  "mm": {...},         // 2,000-4,000 bytes（20フレームに1回）
  "te": [...]          // 50-200 bytes（20フレームに1回）
}
```

**プレイヤーデータ1人分のサイズ（`p`配列要素）:**
```json
{
  "i": 1,              // shortId: 1-2 bytes
  "x": 1234.5,         // 座標: 3-4 bytes
  "y": 987.3,          // 座標: 3-4 bytes
  "sc": 45,            // スコア: 1-2 bytes
  "rb": <Uint8Array>   // 軌跡: (2 + 点数×4) bytes
}
```

**軌跡データサイズ例:**
- 軌跡10点: 2 + 10×4 = **42 bytes**
- 軌跡50点: 2 + 50×4 = **202 bytes**
- 軌跡100点: 2 + 100×4 = **402 bytes**

**プレイヤー1人分合計:** 15-25 bytes（基本） + 軌跡サイズ = **57-427 bytes**

#### State メッセージのサイズ計算例

**シナリオ: 5人プレイ、平均軌跡50点**

```
基本ヘッダー:        20 bytes
時間(tm):            5 bytes
プレイヤー配列(p):
  - 基本データ: 20 bytes × 5人 = 100 bytes
  - 軌跡データ: 202 bytes × 5人 = 1,010 bytes
領地デルタ(tb):      0-2,000 bytes（変更時のみ）
ミニマップ(mm):      0 or 2,500 bytes（20フレームに1回）
チーム統計(te):      0 or 100 bytes（20フレームに1回）
─────────────────────────────────────
通常フレーム:        約1,135 bytes
ミニマップ含む:      約3,735 bytes
領地変更大きい時:    約3,135 bytes
フル装備:            約5,735 bytes
```

#### 実データサンプル: `init` メッセージ

**JSON表現（MsgPack前）:**
```json
{
  "type": "init",
  "id": "1a2b3c4d5e6f7890abcdef12",
  "shortId": 3,
  "world": {
    "width": 2400,
    "height": 2400
  },
  "obstacles": [
    {"x": 620, "y": 540, "w": 120, "h": 80},
    {"x": 1350, "y": 890, "w": 100, "h": 100},
    {"x": 450, "y": 1720, "w": 90, "h": 110}
  ],
  "tf": <Uint8Array of 3456 bytes>,
  "pc": 5,
  "teams": [
    {"name": "🇯🇵JPN", "count": 2},
    {"name": "🇺🇸USA", "count": 1}
  ]
}
```

**推定サイズ（MsgPack）:** 約4,200 bytes

#### 実データサンプル: State メッセージ（通常フレーム）

**16進ダンプ（先頭部分）:**
```hex
85                    // Map(5要素)
A4 type A1 73         // "type": "s"
A2 tm CD 00 EB        // "tm": 235
A1 70 92              // "p": Array(2人)
  83                  // Map(3要素)
    A1 69 01          // "i": 1
    A1 78 CB 40 94 B4 00 00 00 00 00  // "x": 1234.5
    A1 79 CB 40 8E DC CC CC CC CC CD  // "y": 987.3
    A2 sc 2D          // "sc": 45
    A2 rb C4 2A ...   // "rb": Binary(42 bytes)
  83                  // 次のプレイヤー...
    ...
A2 tb C4 00           // "tb": Binary(0 bytes) - 領地変更なし
```

**推定サイズ:** 約850 bytes（2プレイヤー、軌跡各10点の場合）

#### 実データサンプル: `round_end` メッセージ

```json
{
  "type": "round_end",
  "rankings": [
    {
      "name": "[🇯🇵JPN] さとる",
      "score": 18.45,
      "kills": 2,
      "team": "🇯🇵JPN",
      "emoji": "👑"
    },
    {
      "name": "[🇯🇵JPN] たろう",
      "score": 15.23,
      "kills": 1,
      "team": "🇯🇵JPN",
      "emoji": "😀"
    },
    {
      "name": "Player3",
      "score": 8.67,
      "kills": 0,
      "team": "",
      "emoji": "🎮"
    }
  ],
  "teams": [
    {
      "name": "🇯🇵JPN",
      "score": 33.68,
      "kills": 3,
      "members": 2
    }
  ],
  "minimap": {
    "tb": {
      "bm": "H4sIAAAAAAAA/+2dzW7jRhaF+f7... [約2,800文字のBase64]",
      "sz": 40,
      "cp": {
        "1": "#ef4444",
        "2": "#3b82f6",
        "3": "#fbbf24"
      }
    }
  },
  "total": 3,
  "nextMode": "SOLO"
}
```

**推定サイズ（MsgPack）:** 約3,800 bytes

### 4.8.3 1プレイヤーあたりの帯域使用量（推定）

#### アップロード（Client → Server）

| 時間 | データ量 | 内訳 |
|------|---------|------|
| **接続時** | 50 bytes | join メッセージ |
| **1秒間** | 60 bytes | 入力データ60回 |
| **1分間** | 3.6 KB | 入力のみ |
| **2分ラウンド** | 7.3 KB | 入力 + join + chat |
| **1時間** | 約220 KB | ラウンド30回分 |

**WebSocket圧縮効果:** perMessageDeflate有効時、約30-50%圧縮  
**実測アップロード:** 約150 KB/時間

#### ダウンロード（Server → Client）

**ケース1: 軽量（2-3人プレイ）**

| 時間 | データ量 | 内訳 |
|------|---------|------|
| **接続時** | 2-4 KB | init + pm |
| **1秒間** | 50-80 KB | State 60回（通常40-60KB + ミニマップ3回） |
| **1分間** | 3-5 MB | |
| **2分ラウンド** | 6-10 MB | |
| **1時間** | 180-300 MB | ラウンド30回分 |

**ケース2: 重量（10人以上プレイ）**

| 時間 | データ量 | 内訳 |
|------|---------|------|
| **接続時** | 8-15 KB | init + pm（プレイヤー多数） |
| **1秒間** | 100-180 KB | State 60回（プレイヤー多数+軌跡長い） |
| **1分間** | 6-11 MB | |
| **2分ラウンド** | 12-22 MB | |
| **1時間** | 360-660 MB | ラウンド30回分 |

**WebSocket圧縮効果:** 約40-60%圧縮（領地データはバイナリのため圧縮率高い）  
**実測ダウンロード:** 
- 軽量時: 約100-180 MB/時間
- 重量時: 約200-400 MB/時間

### 4.8.4 サーバー総帯域（複数プレイヤー）

**10人同時プレイ時のサーバー送信帯域:**

```
各プレイヤーへの送信: 100-180 KB/秒
10人分の合計: 1-1.8 MB/秒 = 8-14 Mbps

ピーク時（領地大量変更）: 2.5 MB/秒 = 20 Mbps
```

**実測値（`--toukei`オプション出力、10秒平均）:**
```json
{
  "sent": {
    "total": 4589200,           // 4.5 MB/10秒 = 450 KB/秒
    "state": 3856000,           // State更新: 385 KB/秒
    "minimap": 452000,          // ミニマップ: 45 KB/秒
    "territoryDelta": 185000,   // 領地デルタ: 18.5 KB/秒
    "territoryFull": 32000,     // 領地フル: 3.2 KB/秒
    "playerMaster": 58200,      // プレイヤー情報: 5.8 KB/秒
    "broadcastsPerSecond": 60
  }
}
```

**プレイヤー数別のサーバー帯域推定:**

| プレイヤー数 | 送信帯域（平均） | 送信帯域（ピーク） | 受信帯域 |
|-------------|----------------|-------------------|---------|
| 3人 | 1.5 MB/秒 (12 Mbps) | 3 MB/秒 (24 Mbps) | 0.2 KB/秒 |
| 5人 | 2.5 MB/秒 (20 Mbps) | 5 MB/秒 (40 Mbps) | 0.3 KB/秒 |
| 10人 | 5 MB/秒 (40 Mbps) | 10 MB/秒 (80 Mbps) | 0.6 KB/秒 |
| 20人 | 10 MB/秒 (80 Mbps) | 20 MB/秒 (160 Mbps) | 1.2 KB/秒 |

### 4.8.5 最適化手法の効果

| 手法 | 効果 | 適用箇所 |
|------|------|---------|
| **MsgPack** | JSON比で20-40%削減 | すべてのテキストメッセージ |
| **カスタムバイナリ** | JSON比で60-80%削減 | 領地、軌跡、入力 |
| **WebSocket圧縮** | 30-60%削減 | 全通信 |
| **AOIフィルタリング** | プレイヤー数に比例して削減 | State送信 |
| **差分送信（領地）** | フル送信比で80-95%削減 | 領地データ |
| **状態値省略** | 帯域5-10%削減 | State送信（active無敵なしは`st`未送信） |

**総合効果:** 最適化なしの場合と比較して **約1/5～1/10のデータ量** に削減

## 5. UI & ゲーム仕様

### 5.1 ログイン画面

- **プレイヤー名:** 最大8文字。`[` `]` は自動削除。
- **チーム選択:**
  - **国旗選択ドロップダウン:** 23種類の国旗から選択可能
    - 🏳️ なし、🇯🇵 日本、🇺🇸 アメリカ、🇬🇧 イギリス、🇰🇷 韓国、🇨🇳 中国、🇹🇼 台湾、🇩🇪 ドイツ、🇫🇷 フランス、🇮🇹 イタリア、🇪🇸 スペイン、🇧🇷 ブラジル、🇷🇺 ロシア、🇺🇦 ウクライナ、🇮🇳 インド、🇦🇺 オーストラリア、🇨🇦 カナダ、🇲🇽 メキシコ、🇸🇦 サウジ、🇹🇭 タイ、🇻🇳 ベトナム、🇵🇭 フィリピン、🇻🇪 ベネズエラ
  - **チーム名入力:** 最大3文字
  - **既存チーム選択:** サーバーから取得した既存チームリストから選択可能
- **ローカルストレージ:** 名前、チーム名、選択した国旗を保存し、次回訪問時に自動復元。
- **プレイヤーアイコン表示:** ログイン画面に現在接続中のプレイヤーの絵文字とカラーを表示。

### 5.2 ゲーム画面

- **バーチャルジョイスティック:** タッチ/マウス追従型の操作UI。
- **リーダーボード:**
  - **チームモード:** 上位2チーム + 個人上位2名を表示。
  - **ソロモード:** 上位5プレイヤーを表示。
  - **名前表示:** 
    - Intl.Segmenterでグラフェムクラスタ単位に分割し、国旗絵文字を正しく処理。
    - 10文字を超える場合は9文字+「…」で切り詰め。
  - **チーム表示:** チーム名、メンバー数、総スコアを表示。
- **スコア表示:**
  - **「占領」:** 占領したマップの割合（%）を表示。
  - **チームモード:** `チーム占領率 (個人占領率)` 形式で表示。
  - 内部的にはRawスコアも保持・計算。
- **チャット:** ニコニコ動画風の流れるコメント表示。
- **キルログ:** 画面左上に誰が誰を倒したかを表示。
- **ミニマップ:**
  - 54x54ピクセル
  - プレイヤー位置を円で表示（自分: 白色1.5px、他: プレイヤー色1px）
  - **チームモード時:** 一定面積以上の連続した領地グループの中心に国旗を表示
    - クラスタリング処理により、離れた領地にはそれぞれ国旗を表示
    - 表示しきい値: マップ全体の2%以上の面積を持つクラスタ

### 5.3 結果画面

- **マップビュー:** 
  - 最終的なマップ状態を300x300pxで表示。
  - **国旗表示:** チームモード時、一定面積以上の連続した領地グループの中心に国旗を表示
    - クラスタリング処理により、複数に分かれた大きな領地にはそれぞれ国旗を表示
    - クラスタ統合距離: 100ピクセル以内
    - 表示しきい値: マップ全体の1.5%以上の面積を持つクラスタ
- **順位表:**
  - **チーム順位:** チーム名、キル数、占領率
  - **個人順位:** 名前、絵文字、チーム、キル数、占領率
- **チャット:** 最大15文字のコメント送信（1ラウンドに1回のみ）
- **次ラウンド情報:** 次のゲームモード（SOLO/TEAM）を表示
- **自動遷移:** 15秒後に次のラウンドへ自動遷移

### 5.4 チーム仕様

- **チーム名構成:** `国旗絵文字(2文字) + チーム名(3文字)` = 最大5文字
  - 例: `🇯🇵JPN`, `🇺🇸USA`
- **プレイヤー名表示:** チームモード時、`[チーム名] プレイヤー名` 形式で表示
- **固定チーム色:** 
  ```javascript
  TEAM_COLORS = {
    'RED': '#ef4444',
    'BLUE': '#3b82f6',
    'GREEN': '#22c55e',
    'YELLOW': '#eab308',
    'CYAN': '#06b6d4',
    'PINK': '#ec4899',
    'ORANGE': '#f97316',
    'PURPLE': '#a855f7'
  }
  ```
- **チーム切り替え:** 結果画面でチームを変更可能
- **ラウンド開始時の挙動:**
  - **SOLOモード:** チーム情報をクリア、プレイヤー名から `[チーム名]` タグを削除
  - **TEAMモード:** チーム情報を復元、プレイヤー名に `[チーム名]` タグを追加

### 5.5 プレイヤー表示の調整

- **軌跡表示:** 
  - サーバーから受信した完全な軌跡データ (`p.trail`) をクライアント側の `pixelTrail` にコピー
  - 途中参加のプレイヤーも他プレイヤーの軌跡を始点から完全に表示
- **非表示フィルタ:**
  - `state === 'waiting'` のプレイヤーは描画しない
  - 名前がない（"Unknown"）プレイヤーは描画しない
  - 座標が (0, 0) のプレイヤーは描画しない
- **スコア画面の表示:** 
  - ゲーム参加前の新規プレイヤーにもラウンド終了時のスコア画面を表示

## 6. 統計・ランキング

### 6.1 データベーススキーマ

#### rounds テーブル
- ラウンドID、開始・終了時刻、モード、参加者数等

#### round_rankings テーブル
- ラウンドごとのプレイヤーランキング
- プレイヤー名、チーム、絵文字、スコア、キル数

#### player_stats テーブル
- プレイヤー累計統計
- 総プレイ時間、総スコア、総キル数、最高スコア等

#### team_stats テーブル
- チーム累計統計
- 総プレイ時間、総スコア、総キル数、最高スコア等

### 6.2 ランキング画面

- **期間切り替え:** 「今日」「通算」
- **タブ切り替え:** チーム（累計）、チーム（最高）、個人（累計）、個人（最高）、試合履歴
- **表示制限:** 各ランキング最大100件
- **試合履歴:** 最新のラウンドから順に表示

## 7. パフォーマンス最適化

### 7.1 サーバー側

- **帯域統計:**
  - 受信: join, input, chat, updateTeam, ping
  - 送信: state, minimap, territoryDelta, territoryFull, playerMaster, broadcastsPerSecond
  - 統計JSONを1行で出力（`--toukei`オプション時）
- **CPU監視:**
  - システム負荷平均（1分）
  - イベントループラグ（平均・最大）
  - プロセスCPU使用率（ユーザー・システム）
- **メモリ監視:**
  - ヒープ使用量、外部メモリ、配列バッファ
- **AOI (Area of Interest) フィルタリング:**
  - クライアントの視野範囲内のプレイヤーのみデータ送信
  - 軌跡のバウンディングボックスも考慮

### 7.2 クライアント側

- **描画最適化:**
  - 視野外の描画をスキップ
  - パーティクルエフェクトの最適化
- **データ処理:**
  - MsgPackデシリアライズ
  - Gzip解凍（Pako）
  - バイナリ領地データの効率的なデコード

## 8. その他・実装メモ

- **キャッシュバスティング:** 全JS/CSSリソース読み込み時に `?v=TIMESTAMP` を付与。
- **SEO最適化:** 適切なメタタグ、h1タグの使用。
- **エラーハンドリング:**
  - WebSocket切断時の自動再接続
  - オフライン状態の通知
- **デバッグ機能:**
  - `--debug`オプションで詳細ログ出力
  - `--toukei`オプションで統計JSON出力
- **セキュリティ:**
  - ディレクトリトラバーサル対策
  - 入力文字数制限
  - チャット送信回数制限（1ラウンド1回）

## 9. 既知の制限事項

- **ブラウザ互換性:** Intl.Segmenterが未対応のブラウザでは国旗の切り詰めがArray.fromにフォールバック
- **軌跡データ:** 全軌跡を毎フレーム送信（差分送信未実装）
- **データベース:** MySQL接続エラー時もゲームは継続動作（ランキングのみ失敗）

---

**End of Specification v6**

# Protocol Specification v4 (Optimization & Binary Compression)

## 概要
Version 4 プロトコルは、サーバー・クライアント間の通信量を大幅に削減（従来比 80%以上減）することを目的とした最適化アップデートです。
主な変更点は、情報の頻度別分離、バイナリ圧縮の導入、およびMsgPackのバイナリサポートの活用です。

## 主な変更点まとめ
1. **静的情報の分離 (`pm`)**: 名前や色などの不変情報を分離し、初回および変更時のみ送信。
2. **スコア情報の低頻度化 (`sb`)**: スコアとキル数を分離し、3秒ごとに送信。
3. **状態フィールドの統合 (`st`)**: 状態(`state`)と無敵時間(`invulnerable`)を1バイト整数に統合。
4. **軌跡データのバイナリ化 (`rb`)**: 軌跡座標列を差分圧縮バイナリ(Buffer)として送信。
5. **ミニマップの最適化 (`mm`)**: Base64エンコードを廃止し、gzip圧縮バイナリを直接送信。送信頻度を5秒間隔に低減。
6. **テリトリー差分のバイナリ化 (`tb`)**: 差分更新をバイナリフォーマットで送信。
7. **テリトリー全量の圧縮 (`tfb`)**: フル同期データをgzip圧縮して送信。
8. **チーム統計の間引き**: 3秒ごとの送信に変更。
9. **プレイヤー数の常時送信 (`pc`)**: アクティブプレイヤー数を毎フレーム送信。

---

## 1. WebSocket Messages (Server -> Client)

メッセージは [MsgPack](https://msgpack.org/) でエンコードされます。

### 1.1 Init (`init`)
クライアント接続時に送信される初期化メッセージ。

| Field | Type | Description |
|---|---|---|
| `type` | string | 固定値 `"init"` |
| `id` | string | 割り当てられたプレイヤーID |
| `si` | number | Short ID (1-65535) |
| `color` | string | 初期カラー (Hex) |
| `emoji` | string | 割り当てられた絵文字 |
| `world` | object | `{ width, height }` |
| `mode` | string | 現在のモード (`"SOLO"` or `"TEAM"`) |
| `obstacles` | array | 障害物配列 |
| `tf` | array | テリトリー全量配列 |
| `tv` | number | テリトリーバージョン |
| `teams` | array | チーム統計 |

---

### 1.2 State Update (`s`)
ゲームのメインループ（約150msごと）で送信される更新情報。

| Field | Type | Description | Optimization Note |
|---|---|---|---|
| `type` | string | 固定値 `"s"` | |
| `tm` | number | 残り時間（秒） | |
| `pc` | number | **プレイヤー数** (アクティブ) | **新設**: 常時送信 |
| `p` | array | **[Player Object]** (AOI対象のみ) | 構造変更あり（後述） |
| `te` | array | **[Teams Object]** | 3秒に1回のみ含まれる |
| `mm` | object | **[Minimap Object]** | 5秒に1回のみ含まれる |
| `sb` | array | **[Scoreboard Object]** (全プレイヤー) | 3秒に1回のみ含まれる |
| `tb` | binary | **Territory Binary Delta** | **新設**: バイナリ差分更新 |
| `tfb` | string | **Compressed Territory Full** | Base64 encoded gzip JSON |
| `tf` | array | **Territory Full** (フォールバック) | `tfb` が優先 |
| `tv` | number | Territory Version | |

---

### 1.3 Player Master (`pm`)
プレイヤーの静的（不変）情報を送信します。

**送信タイミング**: 接続時、ラウンド開始時、プレイヤー参加時、チーム変更時。

```json
{
  "type": "pm",
  "players": [
    {
      "i": "player_id",
      "si": 123,        // Short ID (新設)
      "n": "name",
      "c": "#color",
      "e": "emoji",
      "t": "team_name"
    }
  ]
}
```

---

### 1.4 Round Start (`round_start`)
新ラウンド開始時に送信されます。

| Field | Type | Description |
|---|---|---|
| `type` | string | 固定値 `"round_start"` |
| `mode` | string | `"SOLO"` or `"TEAM"` |
| `world` | object | `{ width, height }` |
| `obstacles` | array | 障害物配列 |
| `tf` | array | **初期テリトリー配列** (全プレイヤーのスポーン陣地) |
| `tv` | number | テリトリーバージョン |

---

### 1.5 Round End (`round_end`)
ラウンド終了時に送信されます。

| Field | Type | Description |
|---|---|---|
| `type` | string | 固定値 `"round_end"` |
| `rankings` | array | 個人順位 (上位10人) |
| `teamRankings` | array | チーム順位 (上位5チーム) |
| `winner` | object | 1位プレイヤー情報 |
| `nextMode` | string | 次のラウンドのモード |
| `allTeams` | array | 全チーム統計 |
| `totalPlayers` | number | 総プレイヤー数 |

---

### 1.6 Player Death (`player_death`)
プレイヤー死亡時にブロードキャストされます。

| Field | Type | Description |
|---|---|---|
| `type` | string | 固定値 `"player_death"` |
| `id` | string | 死亡したプレイヤーID |
| `reason` | string | 死因 |

**死因の形式**:
- `"○○に切られた"` - 軌跡を切られた
- `"○○に囲まれた"` - テリトリーに囲まれた
- `"自爆"` - 自分の軌跡に接触
- `"壁に激突"` - ワールド境界
- `"障害物に激突"` - 障害物
- `"正面衝突"` / `"正面衝突(敗北)"` - 正面衝突

---

## 2. Data Structure Details

### 2.1 Player Object (`p` in `s`)
頻繁に更新される動的情報のみを含みます。

| Field | Type | Description |
|---|---|---|
| `i` | string | Player ID |
| `x` | number | X座標 (整数) |
| `y` | number | Y座標 (整数) |
| `rb` | binary | **Rail Binary** (軌跡データ) |
| `st` | number | **Integrated State** (省略時は1=active) |

#### `st` (Integrated State) Encoding
状態と無敵時間を1バイトの整数値で表現します。
*   `0`: **Dead**
*   `1`: **Active** (通常状態。`st`フィールド自体が省略される)
*   `2`: **Waiting**
*   `3`以上: **Invulnerable** (無敵状態)
    *   計算式: `Value = 残り秒数 + 2`
    *   例: 値が5なら、残り無敵時間は3秒。

#### `rb` (Rail Binary) Format
軌跡（Trail）情報を差分圧縮したバイナリデータ (Buffer / Uint8Array)。
*   **Header (4 bytes)**:
    *   `Start X` (UInt16LE): 始点のグリッドX座標
    *   `Start Y` (UInt16LE): 始点のグリッドY座標
*   **Body (Variable length)**:
    *   以降、前の点からの差分 `dx`, `dy` を連続して格納。
    *   `dx` (Int8): -128 ~ 127
    *   `dy` (Int8): -128 ~ 127
    *   総バイト数 = `4 + (点数 - 1) * 2`

**復元ロジック例:**
```javascript
let x = view.getUint16(0, true);
let y = view.getUint16(2, true);
// push {x, y}
for (each point) {
  x += view.getInt8(offset);
  y += view.getInt8(offset + 1);
  // push {x, y}
}
```

---

### 2.2 Territory Binary Delta (`tb`)
テリトリー差分更新のバイナリフォーマット。

**構造 (1メッセージ内)**:
```
[Add Count: UInt16LE]
[Add Entries × N]
  - x: UInt16LE
  - y: UInt16LE
  - w: UInt16LE
  - h: UInt16LE
  - sid: UInt16LE (Short ID)
  - r: UInt8 (Red)
  - g: UInt8 (Green)
  - b: UInt8 (Blue)
[Remove Count: UInt16LE]
[Remove Entries × M]
  - x: UInt16LE
  - y: UInt16LE
```

**サイズ計算**:
- Add: 2 + N × 13 bytes
- Remove: 2 + M × 4 bytes
- 合計: 4 + N × 13 + M × 4 bytes

---

### 2.3 Minimap Object (`mm`)
送信頻度が **33フレーム（約5秒）** 間隔に変更されました。

```json
{
  "tb": {                // Territory Bitmap
    "bm": <Binary>,      // gzip圧縮されたビットマップデータ (Base64ではない!)
    "cp": {              // Color Palette
      "1": "#ff0000",
      "2": "#00ff00"
    },
    "sz": 60             // Size (60に変更)
  },
  "pl": [                // Player List (Minimap用簡易位置)
    { "i": "id", "x": 100, "y": 200, "c": "#color" }
  ]
}
```
**注意**: `bm` フィールドは v4 から **MsgPack Binary (Buffer)** として直接送信されます。従来のBase64デコード処理は不要です（互換性のためクライアント側で型チェック推奨）。

---

### 2.4 Territory Full Binary (`tfb`)
テリトリー全量同期時のデータサイズ削減用フィールド。

*   **データ構造**:
    1.  テリトリー配列 `[{x,y,w,h,o,c}, ...]` をJSON化。
    2.  `zlib.gzip` で圧縮。
    3.  **Base64エンコード** (※MsgPack上は文字列として扱われる)。

*   **クライアント処理**:
    `Base64 decode` -> `gzip inflate` -> `JSON parse`

※ `msg.tf` (生配列) はフォールバック用として残されていますが、通常は `tfb` が優先されます。

---

### 2.5 Scoreboard (`sb`)
スコア情報の更新（3秒間隔）。`s` メッセージに含まれます。

```json
[
  {
    "i": "player_id",
    "s": 123,  // score
    "k": 5     // kills
  }
]
```

---

## 3. WebSocket Messages (Client -> Server)

### 3.1 移動入力 (バイナリ, 1バイト)
最適化された移動コマンド。

| Value | Description |
|---|---|
| `0-254` | 角度 (0 = -π, 254 = +π に正規化) |
| `255` | 停止 |

**デコード**:
```javascript
const normalized = angleByte / 254; // 0 ~ 1
const angle = normalized * 2 * Math.PI - Math.PI; // -π ~ π
dx = Math.cos(angle);
dy = Math.sin(angle);
```

### 3.2 Join (`join`)
ゲーム参加リクエスト。

```json
{ "type": "join", "name": "PlayerName", "team": "ABC" }
```

### 3.3 Chat (`chat`)
チャットメッセージ（結果画面で使用）。

```json
{ "type": "chat", "text": "メッセージ" }
```

---

## 4. Client-Side Caching Strategy

帯域削減のため、クライアントは以下のキャッシュを保持・更新する必要があります。

1.  **`playerProfiles` Cache**:
    *   Key: `player_id`
    *   Value: `{ name, color, emoji, team }`
    *   更新源: `pm` メッセージ。

2.  **`playerScores` Cache**:
    *   Key: `player_id`
    *   Value: `{ score, kills }`
    *   更新源: `sb` メッセージ。

3.  **`shortIdMap` Cache**:
    *   Key: `short_id` (number)
    *   Value: `player_id` (string)
    *   更新源: `pm` メッセージの `si` フィールド。
    *   用途: Territory Binary Delta のデコード時に使用。

4.  **Entity Reconstruction**:
    *   `s` メッセージ受信時、`p` 配列内の各オブジェクトに対し、キャッシュから静的情報とスコアを結合して完全なプレイヤーオブジェクトを復元して描画に使用する。
    *   AOI外に去った（Minimapからも消えた）プレイヤーのキャッシュは定期的に削除(GC)される。

---

## 5. Game Rules

### 5.1 無敵状態 (Invulnerable)
スポーン後3秒間、プレイヤーは無敵状態になります。

**フェアな仕様**:
- 無敵中のプレイヤーは死亡しない（障害物、正面衝突、軌跡切り全て回避）
- **無敵中のプレイヤーに当たっても相手も死なない**（相互に影響なし）

### 5.2 正面衝突ルール
- どちらかのスコアが100以下の場合: スコアの低い方が死亡
- 両者のスコアが100超の場合: 両者死亡

### 5.3 チームモード
- チームメイト同士は衝突判定なし（すり抜ける）
- チームメイトのキルは発生しない
- チームメイトの陣地は「壁」として扱われ、連結して囲める

---

## 6. Server Configuration

| 項目 | 値 |
|---|---|
| ブロードキャスト間隔 | 150ms (約6.6fps) |
| スコアボード更新間隔 | 3秒 (20フレーム) |
| ミニマップ更新間隔 | 5秒 (33フレーム) |
| チーム統計更新間隔 | 3秒 (20フレーム) |
| 無敵時間 | 3秒 |
| リスポーン時間 | 3秒 |
| グリッドサイズ | 10px |
| ミニマップサイズ | 60x60 |

---

*Last Updated: 2026-01-01*

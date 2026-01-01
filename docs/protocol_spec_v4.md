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
6. **テリトリー全量の圧縮 (`tfb`)**: フル同期データをgzip圧縮して送信。
7. **チーム統計の間引き**: 3秒ごとの送信に変更。

---

## 1. WebSocket Messages (Server -> Client)

メッセージは引き続き [MsgPack](https://msgpack.org/) でエンコードされます。

### 1.1 State Update (`s`)
ゲームのメインループ（約150msごと）で送信される更新情報。

| Field | Type | Description | Optimization Note |
|---|---|---|---|
| `type` | string | 固定値 `"s"` | |
| `tm` | number | 残り時間（秒） | |
| `p` | array | **[Player Object]** (AOI対象のみ) | 構造変更あり（後述） |
| `te` | object | **[Teams Object]** | **変更**: 3秒に1回のみ含まれる |
| `mm` | object | **[Minimap Object]** | **変更**: 5秒に1回のみ含まれる |
| `sb` | array | **[Scoreboard Object]** (全プレイヤー) | **新設**: 3秒に1回のみ含まれる |
| `tfb` | string | **Compressed Territory Full** | **新設**: Base64 encoded gzip JSON |
| `td` | object | **Territory Delta** | 差分更新 |
| `tv` | number | Territory Version | |

---

### 1.2 New Messages

#### Player Master (`pm`)
プレイヤーの静的（不変）情報を送信します。
*   送信タイミング: 接続時、ラウンド開始時、プレイヤー参加時、チーム変更時。

```json
{
  "type": "pm",
  "players": [
    {
      "i": "player_id",
      "n": "name",
      "c": "#color",
      "e": "emoji",
      "t": "team_name"
    }
  ]
}
```

#### Scoreboard (`sb`)
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

### 2.2 Minimap Object (`mm`)
送信頻度が **33フレーム（約5秒）** 間隔に変更されました。

```json
{
  "tb": {                // Territory Bitmap
    "bm": <Binary>,      // gzip圧縮されたビットマップデータ (Base64ではない!)
    "cp": {              // Color Palette
      "1": "#ff0000",
      "2": "#00ff00"
    },
    "sz": 80             // Size (Deprecated, always 80)
  },
  "pl": [                // Player List (Minimap用簡易位置)
    { "i": "id", "x": 100, "y": 200, "c": "#color" }
  ]
}
```
**注意**: `bm` フィールドは v4 から **MsgPack Binary (Buffer)** として直接送信されます。従来のBase64デコード処理は不要です（互換性のためクライアント側で型チェック推奨）。

---

### 2.3 Territory Full Binary (`tfb`)
テリトリー全量同期時のデータサイズ削減用フィールド。

*   **データ構造**:
    1.  テリトリー配列 `[{x,y,w,h,o,c}, ...]` をJSON化。
    2.  `zlib.gzip` で圧縮。
    3.  **Base64エンコード** (※MsgPack上は文字列として扱われる)。

*   **クライアント処理**:
    `Base64 decode` -> `gzip inflate` -> `JSON parse`

※ `msg.tf` (生配列) はフォールバック用として残されていますが、通常は `tfb` が優先されます。

---

## 3. Client-Side Caching Strategy

帯域削減のため、クライアントは以下のキャッシュを保持・更新する必要があります。

1.  **`playerProfiles` Cache**:
    *   Key: `player_id`
    *   Value: `{ name, color, emoji, team }`
    *   更新源: `pm` メッセージ。

2.  **`playerScores` Cache**:
    *   Key: `player_id`
    *   Value: `{ score, kills }`
    *   更新源: `sb` メッセージ。

3.  **Entity Reconstruction**:
    *   `s` メッセージ受信時、`p` 配列内の各オブジェクトに対し、キャッシュから静的情報とスコアを結合して完全なプレイヤーオブジェクトを復元して描画に使用する。
    *   AOI外に去った（Minimapからも消えた）プレイヤーのキャッシュは定期的に削除(GC)される。

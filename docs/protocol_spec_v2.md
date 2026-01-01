# MessagePack Protocol Specification v2

本ドキュメントは `game01` プロジェクトの通信プロトコル仕様書の **v2** 版です。
v1 からの主な変更点は以下の通りです：

- **ミニマップ用データ (`mm`)** の追加
- **チーム統計 (`te`)** フィールドの明確化
- **AOI (Area Of Interest)** によるフィルタリングの説明追加
- 初期化メッセージへの **`teams`** フィールド追加
- **起動オプション** の追加 (debug, toukei, stage=team, mugen)
- **陣地キャプチャロジック** の説明追加
- サンプルデータの更新

---

## 共通仕様
- **形式**: MessagePack (msgpack-lite)
- **圧縮**: WebSocket の `perMessageDeflate` (gzip) が適用される場合があります
- **送信間隔**: 状態更新は約150ms間隔（6.7回/秒）

---

## 1. サーバー送信 (Server -> Client)

### 1.1 状態更新 (State Update)
ゲームのメインループで定期的に送信される頻出パケット。  
**AOI (Area Of Interest)** により、各クライアントには視界範囲内のプレイヤーのみが送信されます。

| キー | 型 | 内容 | 備考 |
| :--- | :--- | :--- | :--- |
| `type` | string | 固定値 `"s"` | "state" の短縮 |
| `tm` | int | 残り時間 (秒) | "time" |
| `p` | array | プレイヤーリスト (AOI適用後) | "players" |
| `te` | array | チーム統計 | "teams" (チームごとの人数) |
| `td` | object | 領土**差分**データ | "territory delta" (差分がある時のみ) |
| `tf` | array | 領土**全量**データ | "territory full" (フル同期時のみ) |
| `tv` | int | 領土バージョン | "territory version" |
| `mm` | array | ミニマップ用データ | 3秒に1回送信 (軽量版プレイヤー位置) |

#### プレイヤーオブジェクト (`p` 配列の中身)
| キー | 型 | 内容 | 備考 |
| :--- | :--- | :--- | :--- |
| `i` | string | プレイヤーID | "id" |
| `x` | int | X座標 | 整数に丸め |
| `y` | int | Y座標 | 整数に丸め |
| `c` | string | 色コード (Hex) | "color" |
| `n` | string | 名前 | "name" |
| `e` | string | 絵文字 | "emoji" |
| `t` | string | チーム名 | "team" (空文字の場合はソロ) |
| `r` | array | 軌跡 (Trail) | "route/trail", `[[x,y],...]` |
| `s` | int | スコア | "score" |
| `k` | int | キル数 | "kills" |
| `st` | int | 状態 | 1=active, 0=dead, 2=waiting |
| `iv` | int | 無敵残り時間 (秒) | "invulnerable" (0の場合は無敵なし) |

#### チーム統計オブジェクト (`te` 配列の中身)
| キー | 型 | 内容 | 備考 |
| :--- | :--- | :--- | :--- |
| `name` | string | チーム名 | |
| `count` | int | 所属人数 | |

#### 領土差分オブジェクト (`td`)
| キー | 型 | 内容 |
| :--- | :--- | :--- |
| `v` | int | 更新後のバージョン番号 |
| `a` | array | 追加されたRect (`[{x,y,w,h,o,c}, ...]`) |
| `r` | array | 削除されたRect (`[{x,y}, ...]`) |

#### 領土Rectオブジェクト (`tf` 配列 / `td.a` の中身)
| キー | 型 | 内容 |
| :--- | :--- | :--- |
| `x` | int | 左上X座標 |
| `y` | int | 左上Y座標 |
| `w` | int | 幅 (セル数) |
| `h` | int | 高さ (セル数) |
| `o` | string | 所有者プレイヤーID |
| `c` | string | 色コード (Hex) |

#### ミニマップオブジェクト (`mm` 配列の中身)
| キー | 型 | 内容 | 備考 |
| :--- | :--- | :--- | :--- |
| `i` | string | プレイヤーID | "id" |
| `x` | int | X座標 | |
| `y` | int | Y座標 | |
| `c` | string | 色コード | "color" |

---

### 1.2 初期化 (Initialization)
接続確立時に一度だけ送信される **JSON形式** のメッセージ。

| キー | 型 | 内容 | 備考 |
| :--- | :--- | :--- | :--- |
| `type` | string | 固定値 `"init"` | |
| `id` | string | 自分のプレイヤーID | |
| `color` | string | 自分の色コード | |
| `emoji` | string | 自分の絵文字 | |
| `world` | object | `{ width, height }` | ワールドサイズ |
| `mode` | string | `"SOLO"` or `"TEAM"` | 現在のゲームモード |
| `tf` | array | 初期の全領土データ | |
| `tv` | int | 初期の領土バージョン | |
| `obstacles` | array | 障害物リスト | |
| `teams` | array | 現在のチーム統計 | `[{name, count}, ...]` |

---

### 1.3 その他イベント
| type | 内容 | 構造 |
| :--- | :--- | :--- |
| `round_start` | ラウンド開始 | `{ type, mode, obstacles, world }` |
| `round_end` | ラウンド終了 | `{ type, rankings, teamRankings, winner, nextMode, allTeams, totalPlayers }` |
| `player_death` | 死亡通知 | `{ type, id, reason }` |
| `chat` | チャット | `{ type, text, color, name }` |

#### ラウンド終了時のランキングオブジェクト (`rankings` 配列の中身)
| キー | 型 | 内容 |
| :--- | :--- | :--- |
| `name` | string | プレイヤー名 |
| `score` | int | スコア |
| `emoji` | string | 絵文字 |
| `color` | string | 色コード |
| `kills` | int | キル数 |
| `team` | string | 所属チーム名 |

#### チームランキングオブジェクト (`teamRankings` 配列の中身)
| キー | 型 | 内容 |
| :--- | :--- | :--- |
| `name` | string | チーム名 |
| `score` | int | チーム合計スコア |
| `kills` | int | チーム合計キル数 |

---

## 2. クライアント送信 (Client -> Server)

クライアントからサーバーへのメッセージは **JSON形式** で送信されます。

### 2.1 操作入力 (Input)
**最軽量化**: 移動コマンドは配列形式 `[dx, dy]` のみで送信されます。

| インデックス | 型 | 内容 | 備考 |
| :--- | :--- | :--- | :--- |
| `[0]` | float | X方向ベクトル (-1.0 ~ 1.0) | dx |
| `[1]` | float | Y方向ベクトル (-1.0 ~ 1.0) | dy |

**サンプル**:
```json
[0.707, 0.707]
```

> **💡 最適化**: 移動コマンドは最も頻繁に送信されるため（秒間10〜30回）、
> JSONオブジェクト形式から配列形式に変更することで **約70%のバイト削減** を実現。
> - v1: `{"type":"input","dx":0.707,"dy":0.707,"drawing":true}` (約45バイト)
> - v2: `[0.707,0.707]` (約13バイト)

### 2.2 参加リクエスト (Join)
| キー | 型 | 内容 |
| :--- | :--- | :--- |
| `type` | string | 固定値 `"join"` |
| `name` | string | プレイヤー名 |
| `team` | string | 希望チーム名 (3文字まで) |

### 2.3 チーム更新 (Update Team)
| キー | 型 | 内容 |
| :--- | :--- | :--- |
| `type` | string | 固定値 `"update_team"` |
| `team` | string | 新しい希望チーム名 (3文字まで) |

### 2.4 チャット (Chat)
| キー | 型 | 内容 |
| :--- | :--- | :--- |
| `type` | string | 固定値 `"chat"` |
| `text` | string | チャットメッセージ (50文字まで) |

---

## 3. 最適化機能

### 3.1 AOI (Area Of Interest)
各クライアントには、自分の位置から **2500px** 以内のプレイヤーのみが送信されます。  
これにより、大人数時のデータ量を大幅に削減します。

### 3.2 差分同期
領土データはバージョン管理されており、通常は差分(`td`)のみが送信されます。  
バージョンが50以上離れた場合は、フル同期(`tf`)が行われます。

### 3.3 ミニマップインターリーブ
ミニマップ用データ(`mm`)は **3秒に1回** のみ送信されます（通常の状態更新20回に1回）。  
AOIの影響を受けず、全プレイヤーの位置が含まれます。

### 3.4 サーバーループ
サーバーは2つの独立したループで動作します：

| ループ | 間隔 | 処理内容 |
| :--- | :--- | :--- |
| ゲームループ | 50ms (20 FPS) | プレイヤー移動、衝突判定、陣地キャプチャ |
| ブロードキャストループ | 150ms (6.7 FPS) | 状態更新の送信、AOIフィルタリング |

### 3.5 陣地キャプチャロジック

#### 基本ルール
1. 自陣から出発し、線（トレイル）を引いて自陣に戻ると、**囲んだ領域がキャプチャ**される
2. Flood Fill アルゴリズムで「内側」を判定

#### 敵陣地分断
- 敵陣地を線で横断すると、分断された部分を**連結成分 (Island)** として検出
- **最大の Island** はメイン陣地として残り、**それ以外の小さい Island** がキャプチャ対象
- これにより「敵陣地の一部だけを削り取る」ことが可能

#### グリッド補間
- トレイルは **4連結** で補間される（斜め移動時は中間点を挿入）
- これにより Flood Fill での「斜め抜け」を防止し、分断判定を正確化

---

## 4. データサンプル

### 4.1 State Update (サーバー -> クライアント)
- **頻度**: 約 6.7回/秒 (150ms間隔)
- **サイズ目安**: 1KB ~ 5KB (MessagePack適用済)

```json
{
  "type": "s",
  "tm": 118,
  "te": [
    { "name": "RED", "count": 3 },
    { "name": "BLU", "count": 2 }
  ],
  "p": [
    {
      "i": "a1b2",
      "x": 1250,
      "y": 890,
      "c": "#ff0000",
      "n": "[RED] Player1",
      "e": "🔥",
      "t": "RED",
      "r": [[1250, 890], [1260, 890]],
      "s": 500,
      "st": 1,
      "iv": 0
    },
    {
      "i": "c3d4",
      "x": 1500,
      "y": 1200,
      "c": "#0000ff",
      "n": "[BLU] Player2",
      "e": "💎",
      "t": "BLU",
      "r": [],
      "s": 320,
      "st": 1,
      "iv": 2
    }
  ],
  "td": {
    "v": 125,
    "a": [
      { "x": 100, "y": 200, "w": 30, "h": 10, "o": "a1b2", "c": "#ff0000" }
    ],
    "r": [
      { "x": 100, "y": 200 }
    ]
  },
  "tv": 125
}
```

### 4.2 State Update with Minimap (3秒ごと)
```json
{
  "type": "s",
  "tm": 115,
  "te": [
    { "name": "RED", "count": 3 }
  ],
  "p": [
    {
      "i": "a1b2",
      "x": 1300,
      "y": 920,
      "c": "#ff0000",
      "n": "[RED] Player1",
      "e": "🔥",
      "t": "RED",
      "r": [[1250, 890], [1300, 920]],
      "s": 550,
      "st": 1,
      "iv": 0
    }
  ],
  "mm": [
    { "i": "a1b2", "x": 1300, "y": 920, "c": "#ff0000" },
    { "i": "c3d4", "x": 5000, "y": 4500, "c": "#0000ff" },
    { "i": "e5f6", "x": 200, "y": 300, "c": "#00ff00" }
  ],
  "tv": 126
}
```

### 4.3 Initialization (サーバー -> クライアント)
```json
{
  "type": "init",
  "id": "a1b2",
  "color": "#ff0000",
  "emoji": "🔥",
  "world": { "width": 6000, "height": 6000 },
  "mode": "TEAM",
  "obstacles": [],
  "tf": [
    { "x": 100, "y": 100, "w": 7, "h": 7, "o": "a1b2", "c": "#ff0000" }
  ],
  "tv": 1,
  "teams": [
    { "name": "RED", "count": 2 },
    { "name": "BLU", "count": 1 }
  ]
}
```

### 4.4 Input (クライアント -> サーバー)
- **頻度**: ユーザー操作時 (秒間 10~30回程度)
- **サイズ目安**: 約 13 Bytes

```json
[0.707, 0.707]
```

> サーバーは `Array.isArray(data) && data.length === 2` で移動コマンドを判定します。

### 4.5 Join Request (クライアント -> サーバー)
```json
{
  "type": "join",
  "name": "Player1",
  "team": "RED"
}
```

### 4.6 Round End (サーバー -> クライアント)
```json
{
  "type": "round_end",
  "rankings": [
    { "name": "[RED] Player1", "score": 1500, "emoji": "🔥", "color": "#ff0000", "kills": 3, "team": "RED" },
    { "name": "[BLU] Player2", "score": 1200, "emoji": "💎", "color": "#0000ff", "kills": 2, "team": "BLU" }
  ],
  "teamRankings": [
    { "name": "RED", "score": 2500, "kills": 5 },
    { "name": "BLU", "score": 1800, "kills": 3 }
  ],
  "winner": { "name": "[RED] Player1", "score": 1500, "emoji": "🔥", "color": "#ff0000", "kills": 3, "team": "RED" },
  "nextMode": "SOLO",
  "allTeams": [
    { "name": "RED", "count": 3 },
    { "name": "BLU", "count": 2 }
  ],
  "totalPlayers": 5
}
```

### 4.7 Player Death (サーバー -> クライアント)
```json
{
  "type": "player_death",
  "id": "a1b2",
  "reason": "壁に激突"
}
```

### 4.8 Chat (双方向)
```json
{
  "type": "chat",
  "text": "こんにちは！",
  "color": "#ff0000",
  "name": "[RED] Player1"
}
```

---

## 5. v1からの変更点まとめ

| 変更項目 | v1 | v2 |
| :--- | :--- | :--- |
| **移動コマンド最適化** | `{"type":"input",...}` (45B) | `[dx,dy]` 配列形式 (13B, 約70%削減) |
| ミニマップデータ | なし | `mm` (3秒ごと) |
| チーム統計 | `te` (未ドキュメント化) | `te` (正式対応) |
| 初期化時のチーム情報 | なし | `teams` |
| AOI説明 | なし | 2500px範囲フィルタリング |
| クライアント→サーバ形式 | 記載なし | JSON形式 |
| `update_team` メッセージ | なし | 追加 |
| `chat` メッセージ | 簡易記載 | 詳細構造追加 |
| `round_end` 詳細 | 簡易記載 | 完全構造追加 |
| プレイヤー `k` (kills) | なし | 追加 |

---

## 6. 起動オプション

サーバーは以下のコマンドライン引数をサポートします：

```bash
node server.js [options...]
```

| オプション | 説明 |
| :--- | :--- |
| `debug` | デバッグモード。ゲーム時間が無限に |
| `inner_debug` | 内側デバッグ。プレイヤー近くに自陣30x30と敵陣10x10を自動生成 |
| `stage=team` | 強制チーム戦モード。ラウンド終了時もモード変更なし |
| `mugen` | 無限時間モード。制限時間なし |
| `toukei` | 統計モード。ラウンド終了時に転送量統計を出力 |

### 組み合わせ例

```bash
# チーム戦 + 無限時間 + 統計出力
node server.js stage=team mugen toukei

# デバッグ + 統計
node server.js debug toukei
```

### 統計出力 (toukei)

ラウンド終了時に以下の形式で出力されます：

1. **整形済みレポート**: 罫線付きの人間可読形式
2. **JSON形式**: `[STATS_JSON]{...}` プレフィックス付きの1行JSON（コピペ用）


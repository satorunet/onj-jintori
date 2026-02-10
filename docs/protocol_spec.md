# MessagePack Protocol Specification

本プロジェクト (`game01`) では、通信の軽量化と高速化のために **MessagePack** を採用しています。
データ構造は従来のJSONを踏襲しつつ、プロパティ名を短縮形（Minified Keys）にすることでサイズ削減を図っています。

## 共通仕様
- **形式**: MessagePack (msgpack-lite)
- **圧縮**: データによっては WebSocket の `perMessageDeflate` (gzip) が適用されます。

---

## 1. サーバー送信 (Server -> Client)

### 状態更新 (State Update)
ゲームのメインループ（約150ms間隔）で送信される頻出パケット。

| キー | 型 | 内容 | 備考 |
| :--- | :--- | :--- | :--- |
| `type` | string | 固定値 `"s"` | "state" の短縮 |
| `tm` | int | 残り時間 (秒) | "time" |
| `p` | array | プレイヤーリスト | "players" |
| `te` | array | チーム統計 | "teams" |
| `td` | object | 領土**差分**データ | "territory delta" (差分がある時のみ) |
| `tf` | array | 領土**全量**データ | "territory full" (フル同期時のみ) |
| `tv` | int | 領土バージョン | "territory version" |

#### プレイヤーオブジェクト (`p` 配列の中身)
| キー | 型 | 内容 | 備考 |
| :--- | :--- | :--- | :--- |
| `i` | string | プレイヤーID | "id" |
| `x` | int | X座標 | 整数に丸め |
| `y` | int | Y座標 | 整数に丸め |
| `c` | string | 色コード (Hex) | "color" |
| `n` | string | 名前 | "name" |
| `e` | string | 絵文字 | "emoji" |
| `t` | string | チーム名 | "team" |
| `r` | array | 軌跡 (Trail) | "route/trail", `[[x,y],...]` |
| `s` | int | スコア | "score" |
| `st` | int | 状態 | 1=active, 0=dead, 2=waiting |
| `iv` | int | 無敵残り時間 (秒) | "invulnerable" |

#### 領土差分オブジェクト (`td`)
| キー | 型 | 内容 |
| :--- | :--- | :--- |
| `v` | int | 更新後のバージョン番号 |
| `a` | array | 追加されたRect (`[{x,y,w,h,o,c}, ...]`) |
| `r` | array | 削除されたRect (`[{x,y}, ...]`) |

---

### 初期化 (Initialization)
接続確立時に一度だけ送信される。

| キー | 型 | 内容 |
| :--- | :--- | :--- |
| `type` | string | 固定値 `"init"` |
| `id` | string | 自分のプレイヤーID |
| `world` | object | `{ width, height }` |
| `mode` | string | `"SOLO"` or `"TEAM"` |
| `tf` | array | 初期の全領土データ |
| `tv` | int | 初期の領土バージョン |
| `obstacles` | array | 障害物リスト |

---

### その他イベント
| type | 内容 | 構造 |
| :--- | :--- | :--- |
| `round_start` | ラウンド開始 | `{ type, mode, obstacles, world }` |
| `round_end` | ラウンド終了 | `{ type, rankings, winner, ... }` |
| `player_death` | 死亡通知 | `{ type, id, reason }` |
| `chat` | チャット | `{ type, text, color, name }` |

---

## 2. クライアント送信 (Client -> Server)

### 操作入力 (Input)
| キー | 型 | 内容 |
| :--- | :--- | :--- |
| `type` | string | 固定値 `"input"` |
| `dx` | float | X方向ベクトル (-1.0 ~ 1.0) |
| `dy` | float | Y方向ベクトル (-1.0 ~ 1.0) |
| `drawing` | bool | 囲い込みアクション中か |

### 参加リクエスト (Join)
| キー | 型 | 内容 |
| :--- | :--- | :--- |
| `type` | string | 固定値 `"join"` |
| `name` | string | プレイヤー名 |
| `team` | string | 希望チーム名 |

---

## 3. データサンプル (JSON表現)

### State Update (サーバー -> クライアント)
- **頻度**: 約 6.7回/秒 (150ms間隔)
- **サイズ目安**: 1KB ~ 5KB (MessagePack適用済)

```json
{
  "type": "s",
  "tm": 118,
  "p": [
    {
      "i": "a1b2",
      "x": 1250,
      "y": 890,
      "c": "#ff0000",
      "t": "RED",
      "r": [[1250, 890], [1260, 890]], 
      "s": 500,
      "st": 1
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
  }
}
```

### Input (クライアント -> サーバー)
- **頻度**: ユーザー操作時 (秒間 10~30回程度)
- **サイズ目安**: 約 40 Bytes

```json
{
  "type": "input",
  "dx": 0.707,
  "dy": 0.707,
  "drawing": true
}
```

# Game Project Specification v7

**更新日:** 2026-01-07  
**バージョン:** 7.0.0  
**サーバー:** Node.js + WebSocket (ws) + HTTP/2 (https)  
**クライアント:** HTML5 Canvas + WebSocket  
**データベース:** MySQL (ランキング・統計用)

---

## 📋 v7の主な変更点

### 🎯 パフォーマンス最適化
1. **プレイヤー軌跡の差分送信** - 帯域を約60%削減
2. **国旗位置のサーバー計算** - クライアント側のO(n³)計算を削除
3. **統計モジュールの分離** - リアルタイムパフォーマンス監視

### 📊 効果
- 1人あたり帯域: **61%削減** (3.10 KB/s → 1.21 KB/s)
- クライアント側フリーズ: **解消**
- 14人同時接続: **安定稼働**

---

## 1. プレイヤー軌跡の差分送信

### 1.1 概要

v7では、プレイヤーの軌跡（trail）データを効率的に送信するため、差分送信方式を採用しています。

**Before (v6):**
- 毎フレーム全軌跡を送信
- 50ポイントの軌跡 = 約100 bytes/フレーム

**After (v7):**
- 新しいポイントのみを送信
- 通常は1ポイント = 約2 bytes/フレーム
- **削減率: 約98%**

### 1.2 データ形式

#### フル軌跡送信（`ft=1`）

**条件:**
- プレイヤーが新しく視界に入った
- 5秒に1回の定期同期
- 軌跡がリセットされた後の新しい軌跡
- 前回送信時の軌跡が空だった

**データ構造:**
```javascript
{
  i: 123,        // プレイヤーID (shortId)
  x: 1200,       // 現在位置X
  y: 800,        // 現在位置Y
  rb: <Buffer>,  // 軌跡バイナリ（フル）
  ft: 1,         // フル軌跡フラグ
  st: 1          // 状態 (省略可能)
}
```

**`rb` フォーマット（フル）:**
```
Offset | Size | Description
-------|------|------------
0      | 2    | 始点X座標（グリッド単位）
2      | 2    | 始点Y座標（グリッド単位）
4      | 2    | ポイント1の差分（dx, dy各1バイト）
6      | 2    | ポイント2の差分
...    | ...  | 以降同様
```

**例:**
```
軌跡: [(50, 30), (51, 30), (52, 31)]

バイナリ:
[0x32, 0x00, 0x1E, 0x00,  // 始点: 50, 30
 0x01, 0x00,              // dx=+1, dy=0
 0x01, 0x01]              // dx=+1, dy=+1
```

#### 差分軌跡送信（`ft`なし）

**条件:**
- 既知のプレイヤーの軌跡が伸びた
- 前回送信から新しいポイントが追加された

**データ構造:**
```javascript
{
  i: 123,        // プレイヤーID
  x: 1250,       // 現在位置X
  y: 850,        // 現在位置Y
  rb: <Buffer>   // 差分バイナリ（ftフラグなし）
}
```

**`rb` フォーマット（差分）:**
```
Offset | Size | Description
-------|------|------------
0      | 2    | 新ポイント1の差分（dx, dy各1バイト）
2      | 2    | 新ポイント2の差分
...    | ...  | 以降同様
```

**例:**
```
既存軌跡: [(50, 30), (51, 30)]
新ポイント: [(52, 31), (53, 31)]

差分バイナリ:
[0x01, 0x01,  // dx=+1, dy=+1 (from 51,30)
 0x01, 0x00]  // dx=+1, dy=0 (from 52,31)
```

#### 軌跡クリア（`tc=1`）

**条件:**
- プレイヤーが陣地化に成功し、軌跡がクリアされた

**データ構造:**
```javascript
{
  i: 123,    // プレイヤーID
  x: 1200,   // 現在位置X
  y: 800,    // 現在位置Y
  tc: 1      // 軌跡クリアフラグ
}
```

### 1.3 クライアント側の処理

```javascript
// client-network.js での処理

if (serverP.rb) {
    const isFullTrail = serverP.ft === 1;
    
    if (isFullTrail) {
        // 全軌跡で置き換え
        trail = decodeFullTrail(serverP.rb);
    } else {
        // 既存の軌跡に差分を追加
        const existingTrail = player.trail || [];
        const deltaPoints = decodeDeltaTrail(serverP.rb, existingTrail);
        trail = [...existingTrail, ...deltaPoints];
    }
} else if (serverP.tc === 1) {
    // 軌跡をクリア
    trail = [];
} else {
    // 変化なし - 既存の軌跡を維持
    trail = player.trail || [];
}
```

### 1.4 時系列の動作例

#### シナリオ: プレイヤーAが軌跡を描く

```
Time | Action                    | Server→Client (Player A)
-----|---------------------------|---------------------------
0秒  | プレイヤーA参加           | ft=1, rb=[始点]
0.15 | 1歩移動                  | rb=[+1差分]
0.30 | 2歩移動                  | rb=[+2差分]
0.45 | 3歩移動                  | rb=[+3差分]
1.00 | 陣地化成功                | tc=1 (軌跡クリア)
1.15 | 新しい軌跡開始            | ft=1, rb=[新始点]
1.30 | 1歩移動                  | rb=[+1差分]
5.00 | 定期フル同期              | ft=1, rb=[全軌跡]
```

---

## 2. ミニマップ国旗位置のサーバー計算

### 2.1 概要

v7では、チーム戦モード時にミニマップ上に表示する国旗の位置計算をサーバー側で実行します。

**Before (v6):**
- クライアント側で領地をクラスタリング（O(n³)計算）
- territories数 × クラスタリング = 毎フレーム数億回のループ
- 定期的なフリーズの原因

**After (v7):**
- サーバー側で5秒に1回計算
- クライアントは受信データを描画するだけ

### 2.2 データ形式

#### ミニマップデータ（`mm`）

```javascript
{
  type: 's',
  mm: {
    tb: {                    // テリトリービットマップ
      bm: <compressed>,      // 圧縮ビットマップ
      cp: {1: "#ff0000", ...}, // カラーパレット
      sz: 40,                // サイズ
      flags: [               // 国旗位置（NEW in v7）
        {f: "🇯🇵", x: 1200, y: 800},
        {f: "🇺🇸", x: 2400, y: 1600}
      ]
    },
    pl: [                    // プレイヤー位置（配列形式）
      [1200, 800, 1],        // [x, y, colorIndex]
      [2400, 1600, 2]
    ]
  }
}
```

#### 国旗位置データ（`flags`）

```javascript
[
  {
    f: "🇯🇵",    // 国旗絵文字
    x: 1200,     // ゲーム座標X
    y: 800       // ゲーム座標Y
  },
  {
    f: "🇺🇸",
    x: 2400,
    y: 1600
  }
]
```

### 2.3 クライアント側の描画

```javascript
// client-game.js: drawMinimap()

if (minimapBitmapData && minimapBitmapData.flags) {
    const scale = canvasSize / world.width;
    
    minimapBitmapData.flags.forEach(flagData => {
        const centerX = flagData.x * scale;
        const centerY = flagData.y * scale;
        
        minimapCtx.font = '8px sans-serif';
        minimapCtx.textAlign = 'center';
        minimapCtx.textBaseline = 'middle';
        minimapCtx.fillText(flagData.f, centerX, centerY);
    });
}
```

---

## 3. スコア画面国旗位置のサーバー計算

### 3.1 概要

ラウンド終了時のスコア画面に表示する国旗位置も、サーバー側で計算します。

### 3.2 データ形式

#### ラウンド終了メッセージ（`round_end`）

```javascript
{
  type: 'round_end',
  rankings: [...],         // プレイヤーランキング
  teamRankings: [...],     // チームランキング
  winner: {...},           // 勝者
  nextMode: 'SOLO',        // 次のモード
  allTeams: [...],         // 全チーム統計
  totalPlayers: 12,        // 参加者数
  mapFlags: [              // スコア画面用国旗位置（NEW in v7）
    {f: "🇯🇵", x: 1200, y: 800},
    {f: "🇺🇸", x: 2400, y: 1600}
  ]
}
```

### 3.3 クライアント側の描画

```javascript
// client-ui.js: drawResultMapFrame()

function drawResultMapFrame(ctx, rects, w, h, mapFlags) {
    // 領地を描画
    rects.forEach(r => {
        ctx.fillStyle = r.color;
        ctx.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
    });
    
    // サーバーから受信した国旗位置を描画
    if (mapFlags && mapFlags.length > 0) {
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        mapFlags.forEach(flagData => {
            const centerX = flagData.x * scale;
            const centerY = flagData.y * scale;
            ctx.fillText(flagData.f, centerX, centerY);
        });
    }
}
```

---

## 4. 通信プロトコル詳細

### 4.1 ブロードキャスト頻度

| データ | 頻度 | 間隔 | 備考 |
|--------|------|------|------|
| プレイヤー位置・軌跡 | 毎フレーム | 150ms | 差分送信 |
| テリトリー差分 | 変更時 | リアルタイム | バイナリ形式 |
| チーム統計 | 20フレーム毎 | 3秒 | TEAMモードのみ |
| ミニマップ | 33フレーム毎 | 5秒 | ビットマップ+国旗位置 |
| スコアボード | 33フレーム毎 | 5秒 | id, score, kills |

### 4.2 State同期メッセージ（`s`）

```javascript
{
  type: 's',
  tm: 180,           // 残り時間（秒）
  pc: 14,            // 総プレイヤー数
  te: {...},         // チーム統計（3秒毎）
  tb: <Buffer>,      // テリトリー差分バイナリ
  tv: 1234,          // テリトリーバージョン
  mm: {...},         // ミニマップ（5秒毎、国旗位置含む）
  sb: [...],         // スコアボード（5秒毎）
  p: [               // プレイヤーデータ（AOIフィルタ済み）
    {
      i: 123,        // shortId
      x: 1200,       // 位置X
      y: 800,        // 位置Y
      rb: <Buffer>,  // 軌跡バイナリ
      ft: 1,         // フル軌跡フラグ（オプション）
      tc: 1,         // 軌跡クリアフラグ（オプション）
      st: 3          // 状態（dead=0, active=1, waiting=2, invulnerable=3-7）
    }
  ]
}
```

### 4.3 実際の送受信サンプル

#### 接続直後（初期同期）

**Server → Client (init):**
```javascript
{
  type: 'init',
  id: 'abc123def456',
  shortId: 42,
  world: {width: 4000, height: 3000},
  mode: 'TEAM',
  timeRemaining: 240,
  pc: 8
}
```

**Client → Server (join):**
```javascript
{
  a: 'j',  // action: join
  n: '🇯🇵プレイヤー',
  e: '😀',
  c: '#ff5733',
  t: '🇯🇵チームA'
}
```

#### 通常プレイ中（150ms毎）

**Client → Server (move):**
```javascript
// 実際には1バイトのバイナリ（角度エンコード）
new Uint8Array([127])  // 127 = 右方向（0度）
```

**角度エンコーディング:**
- 0-254: 移動方向（0度～360度を255段階）
- 255: 停止

**例:**
```
方向    | 角度 | バイト値
--------|------|----------
→ 右    | 0°   | 127
↗ 右上  | 45°  | 159
↑ 上    | 90°  | 191
← 左    | 180° | 0 or 254
↓ 下    | 270° | 64
停止    | -    | 255
```

**Server → Client (state):**
```javascript
{
  type: 's',
  tm: 175,
  pc: 8,
  p: [
    {i: 42, x: 1205, y: 800, rb: Buffer([0x01, 0x00])},      // 差分
    {i: 43, x: 2400, y: 1600, ft: 1, rb: Buffer([...])},     // フル
    {i: 44, x: 1800, y: 1200, tc: 1}                         // クリア
  ]
}
```

#### ミニマップ更新（5秒毎）

**Server → Client (with minimap):**
```javascript
{
  type: 's',
  tm: 170,
  pc: 8,
  mm: {
    tb: {
      bm: <compressed_bitmap>,
      cp: {1: "#ff0000", 2: "#00ff00"},
      sz: 40,
      flags: [
        {f: "🇯🇵", x: 1200, y: 800},
        {f: "🇺🇸", x: 2400, y: 1600}
      ]
    },
    pl: [
      [1205, 800, 1],
      [2405, 1600, 2]
    ]
  },
  p: [...]
}
```

#### ラウンド終了

**Server → Client (round_end):**
```javascript
{
  type: 'round_end',
  rankings: [
    {id: 'abc123', name: '🇯🇵プレイヤー', score: 12.5, kills: 3},
    {id: 'def456', name: '🇺🇸Player2', score: 10.2, kills: 2}
  ],
  teamRankings: [
    {name: '🇯🇵チームA', score: 45.6, kills: 12, members: 4},
    {name: '🇺🇸TeamB', score: 32.1, kills: 8, members: 4}
  ],
  winner: {id: 'abc123', name: '🇯🇵プレイヤー'},
  nextMode: 'SOLO',
  allTeams: [...],
  totalPlayers: 8,
  mapFlags: [
    {f: "🇯🇵", x: 1200, y: 800},
    {f: "🇺🇸", x: 2400, y: 1600}
  ]
}
```

---

## 5. 時系列フロー

### 5.1 ゲーム開始から終了まで

```
Time  | Event                  | Client → Server | Server → Client
------|------------------------|-----------------|------------------
0.00  | ページ読込完了         | -               | -
0.10  | WebSocket接続          | -               | -
0.15  | 初期データ受信         | -               | init
0.20  | ログイン画面表示       | -               | -
5.00  | プレイヤー参加         | join (JSON)     | -
5.05  | プレイヤー承認         | -               | player_master
5.10  | ゲーム開始             | -               | state (s)
5.25  | 移動入力               | 1byte (angle)   | -
5.40  | 状態更新               | -               | s (差分軌跡)
5.55  | 移動継続               | 1byte           | -
6.00  | 状態更新               | -               | s (差分軌跡)
10.10 | ミニマップ更新         | -               | s (mm with flags)
15.10 | 2回目ミニマップ        | -               | s (mm with flags)
...   | ゲームプレイ継続       | 1byte (角度)    | s (150ms毎)
240.0 | ラウンド終了           | -               | round_end (mapFlags)
240.5 | スコア画面表示         | -               | -
255.0 | 次ラウンド開始         | -               | s
```

### 5.2 途中参加プレイヤーの視点

```
Time  | Event                  | Server → Client (新参加者)
------|------------------------|-----------------------------
0.00  | 接続                   | init
0.05  | 参加                   | -
0.10  | 初回state受信          | s (全プレイヤーのft=1軌跡)
0.25  | 2回目state             | s (差分軌跡 or 変化なし)
0.40  | 3回目state             | s (差分軌跡)
5.00  | ミニマップ受信         | s (mm with flags)
```

---

## 6. パフォーマンス統計

### 6.1 統計レポート例

```
┌────────────────────────────────────────────────────────────┐
│            ⚡ ラウンド終了 - 転送量＆負荷統計レポート       │
├────────────────────────────────────────────────────────────┤
│ ⏱ 稼働: 1分59秒 | ラウンド: 2分0秒                         │
│ 💻 CPU: 2.7% | LA: 0.08 | ラグ: 0.4ms (Max: 17ms)         │
│ 📊 モード: TEAM | 接続: 6人 (アクティブ: 5人)               │
├────────────────────────────────────────────────────────────┤
│ 📡 ラウンド送信: 873 KB (7.28 KB/s)                        │
│ 📥 1人あたり: 145 KB (1.21 KB/s)                           │
├────────────────────────────────────────────────────────────┤
│ 【送信内訳】                                                │
│   🎮 プレイヤーデータ: 38.41 KB (31.1%)                    │
│   🗺 ミニマップ: 39.48 KB (32.0%)                          │
│   🏭 テリトリー差分: 19.07 KB (15.5%)                      │
│   👥 チーム統計: 18.01 KB (14.6%)                          │
│   📦 テリトリー全量: 2.94 KB (2.4%)                        │
├────────────────────────────────────────────────────────────┤
│ 🔮 予測 このペースで1日: 614 MB | 1月: 18 GB              │
└────────────────────────────────────────────────────────────┘
```

### 6.2 最適化効果

| 項目 | v6 | v7 | 削減率 |
|------|----|----|--------|
| 1人あたり帯域 | 3.10 KB/s | 1.21 KB/s | **61%** |
| プレイヤーデータ | 65.7% | 31.1% | **53%** |
| 月間帯域（1人） | 7.8 GB | 3.1 GB | **60%** |
| クライアントフリーズ | あり | なし | **100%** |

---

## 7. 実装ファイル

### 7.1 サーバー側

| ファイル | 主な変更 |
|----------|----------|
| `modules/network.js` | 差分軌跡送信ロジック実装 |
| `modules/game.js` | 国旗位置計算（ミニマップ＆スコア画面） |
| `modules/stats.js` | 統計モジュール（新規） |
| `server.v5.js` | round_endにmapFlags追加 |

### 7.2 クライアント側

| ファイル | 主な変更 |
|----------|----------|
| `client-network.js` | 差分軌跡デコード、flags受信 |
| `client-game.js` | 国旗描画（サーバーデータ使用） |
| `client-ui.js` | スコア画面国旗描画 |
| `index.html` | カウントダウン固定表示 |

---

## 8. トラブルシューティング

### 8.1 軌跡が表示されない

**原因:** 差分軌跡の同期ロス

**確認:**
```javascript
// デバッグログを確認
console.log('Trail data:', serverP.rb, 'ft:', serverP.ft, 'tc:', serverP.tc);
```

**対策:**
- サーバー側で5秒に1回フル同期が実行される
- クライアント側で既存軌跡がない場合は空のまま次のフル同期を待つ

### 8.2 国旗が表示されない

**原因:** チーム名に国旗絵文字がない

**確認:**
```javascript
// チーム名の先頭2文字が国旗判定範囲内か確認
const first = teamName.codePointAt(0);
const second = teamName.codePointAt(1);
console.log('First:', first, 'Second:', second);
// 範囲: 0x1F1E6 - 0x1F1FF
```

---

## 9. スコア画面表示の仕様【重要】

### 9.1 概要

ラウンド終了時のスコア画面表示には複雑な条件があります。
**この仕様を変更する際は十分注意してください。**

### 9.2 要件

| シナリオ | スコア画面 |
|----------|-----------|
| プレイ中にラウンド終了 | ✅ 表示する |
| 観戦中（wait状態）にラウンド終了 | ❌ 表示しない |
| wait状態で接続 → ラウンド終了 → Join | ✅ 表示する |
| wait状態で接続 → ゲーム開始後にJoin | ❌ 表示しない |

### 9.3 グローバル変数

**client-config.js:**
```javascript
// スコア画面の遅延表示（wait状態で受信した場合用）
let pendingResultScreen = null;

// スコア画面期間中フラグ
let isScoreScreenPeriod = false;
```

### 9.4 フラグの状態遷移

```
[ゲーム中]
  isScoreScreenPeriod = false
  pendingResultScreen = null
        ↓
  ラウンド終了（round_end受信）
        ↓
[スコア画面期間]
  isScoreScreenPeriod = true
  pendingResultScreen = (wait状態なら保存)
        ↓
  次ラウンド開始（state受信, tm >= 200）
        ↓
[ゲーム中]
  isScoreScreenPeriod = false
  pendingResultScreen = null（クリア）
```

### 9.5 処理フロー

#### フロー1: プレイ中にラウンド終了

```
1. round_end受信
2. isScoreScreenPeriod = true
3. プレイヤーのstate確認 → active
4. → すぐにスコア画面表示 ✅
```

**実装箇所:** `client-network.js` round_end処理

```javascript
if (hasPlayedThisRound) {
    showResultScreen(...);
}
```

#### フロー2: wait状態でラウンド終了

```
1. round_end受信
2. isScoreScreenPeriod = true
3. プレイヤーのstate確認 → waiting
4. → pendingResultScreenに保存（表示しない）
```

**実装箇所:** `client-network.js` round_end処理

```javascript
} else {
    pendingResultScreen = { ... };
}
```

#### フロー3: スコア画面期間中にJoin

```
1. Joinボタン押下
2. joinGame()実行
3. isGameReady = true
4. isScoreScreenPeriod && pendingResultScreen をチェック
5. → スコア画面表示 ✅
6. pendingResultScreen = null
```

**実装箇所:** `client-ui.js` joinGame()

```javascript
isGameReady = true;

// スコア画面期間中であれば、pending結果を表示
// （サーバーはroundActive=falseの間はstateメッセージを送信しないため）
if (isScoreScreenPeriod && pendingResultScreen) {
    showResultScreen(...);
    pendingResultScreen = null;
}
```

#### フロー4: ゲーム中にJoin

```
1. state受信（tm >= 200）
2. isScoreScreenPeriod = false
3. pendingResultScreen = null（クリア）
4. Joinボタン押下
5. isScoreScreenPeriod = false なので表示しない ✅
```

**実装箇所:** `client-network.js` state処理

```javascript
if (data.tm !== undefined && data.tm >= 200) {
    isScoreScreenPeriod = false;
    if (pendingResultScreen) {
        pendingResultScreen = null;
    }
}
```

### 9.6 重要な注意点

#### ⚠️ サーバーはスコア画面期間中にstateを送信しない

```javascript
// modules/network.js
if (!state.roundActive) return;  // スコア画面期間中は早期リターン
```

このため、wait→activeの状態変更はstateメッセージで検出できません。
**joinGame()内でスコア画面を表示する必要があります。**

#### ⚠️ 接続時に残り時間を再計算

```javascript
// modules/network.js - 新規接続時
const now = Date.now();
const timeLeft = state.nextRoundStartTime 
    ? Math.max(0, Math.ceil((state.nextRoundStartTime - now) / 1000)) 
    : 15;

const updatedMsg = {
    ...state.lastResultMsg,
    secondsUntilNext: timeLeft  // 正確な残り時間
};
ws.send(JSON.stringify(updatedMsg));
```

#### ⚠️ 次ラウンド開始の判定

`data.tm >= 200` でラウンド開始と判定しています。
ラウンド時間を変更する場合は、この閾値も調整が必要です。

### 9.7 関連ファイル

| ファイル | 役割 |
|----------|------|
| `client-config.js` | `pendingResultScreen`, `isScoreScreenPeriod` 定義 |
| `client-network.js` | round_end受信、state受信、フラグ管理 |
| `client-ui.js` | joinGame()でのスコア画面表示 |
| `modules/network.js` | 新規接続時のround_end送信 |
| `server.v5.js` | round_end生成、nextRoundStartTime記録 |

---

**End of Document v7.0.0**


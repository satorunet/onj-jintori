# ミニマップ プレイヤー位置データ最適化案

**作成日:** 2026-01-07  
**対象:** `mm.pl` (Minimap Player Positions)  

---

## 現状分析

### 現在のデータ構造

```javascript
"pl": [
  {"i": "abc123def456", "x": 1200, "y": 800, "c": "#ef4444"},
  {"i": "xyz789ghi012", "x": 1500, "y": 1100, "c": "#3b82f6"}
]
```

### データサイズ計算（5プレイヤー）

**JSON形式（MsgPack前）:**
```javascript
[
  {"i": "abc123def456", "x": 1200, "y": 800, "c": "#ef4444"},
  {"i": "xyz789ghi012", "x": 1500, "y": 1100, "c": "#3b82f6"},
  {"i": "def456abc123", "x": 1800, "y": 950, "c": "#22c55e"},
  {"i": "ghi012xyz789", "x": 950,  "y": 1250, "c": "#fbbf24"},
  {"i": "jkl345mno678", "x": 1350, "y": 1450, "c": "#a855f7"}
]

// 1エントリあたり:
// - キー ("i", "x", "y", "c"): 8 bytes
// - ID値: 24 bytes
// - x座標: 4-5 bytes
// - y座標: 4-5 bytes
// - カラーコード: 7 bytes
// - JSON構造: 10 bytes
// 合計: 約57-59 bytes/人

// 5人合計: 285-295 bytes (MsgPack前)
// MsgPack後: 約210-230 bytes
```

---

## 問題点の詳細分析

### 1. ID (`"i"`) の必要性

**現在の使用箇所:**

```javascript
// client-network.js: 221-250行
const minimapIds = new Set(playerList.map(m => m.i));

playerList.forEach(m => {
    if (detailsIds.has(m.i)) return;  // ← ID使用
    
    let existing = players.find(p => p.id === m.i);  // ← ID使用
    if (existing) {
        existing.targetX = m.x;
        existing.targetY = m.y;
        existing.color = m.c;
    } else {
        players.push({
            id: m.i,  // ← ID使用
            x: m.x,
            y: m.y,
            color: m.c,
            // ...
        });
    }
});
```

**問題点:**
- **ミニマップ描画には不要**: `client-game.js`のミニマップ描画では`p.i`を自分判定にのみ使用
- **プレイヤー同期に使用**: 既存プレイヤーとの照合に使っているが、これは`s`メッセージ（State）で既に送信されている
- **重複データ**: `s`メッセージでプレイヤー詳細が送られているのに、ミニマップでもIDを送っている

### 2. カラーコードの非効率性

**現在:** `"#ef4444"` = 7 bytes  
**最適化後:** `1` (パレットインデックス) = 1 byte  
**削減:** 85%

### 3. オブジェクト構造のオーバーヘッド

**現在:** `{"i": "...", "x": 1200, "y": 800, "c": "#ef4444"}`  
**MsgPack後:** 約42-46 bytes

**配列化:** `[1200, 800, 1]`  
**MsgPack後:** 約6-8 bytes

**削減:** 82-85%

---

## 最適化案

### 案1: ID削除 + カラーインデックス + 配列化（推奨）

#### サーバー側実装

```javascript
// modules/network.js
if (frameCount % 33 === 0) {
    const territoryBitmap = game.generateMinimapBitmap();
    
    // プレイヤーIDをカラーインデックスにマッピング（領地ビットマップと同じパレット使用）
    const palette = territoryBitmap.cp;  // {"1": "#ef4444", "2": "#3b82f6", ...}
    const idToPaletteIndex = {};
    
    Object.keys(palette).forEach(idx => {
        const color = palette[idx];
        const player = Object.values(state.players).find(p => p.color === color);
        if (player) {
            idToPaletteIndex[player.id] = parseInt(idx);
        }
    });
    
    // プレイヤー位置を配列形式で送信
    const playerPositions = Object.values(state.players)
        .filter(p => p.state !== 'waiting')
        .map(p => [
            Math.round(p.x),              // x座標
            Math.round(p.y),              // y座標
            idToPaletteIndex[p.id] || 0   // カラーインデックス
        ]);
    
    minimapData = { tb: territoryBitmap, pl: playerPositions };
}
```

#### クライアント側実装

```javascript
// client-network.js
const playerList = minimapData.pl || [];

// 配列形式からオブジェクト形式に変換
minimapPlayerPositions = playerList.map(p => ({
    x: p[0],
    y: p[1],
    colorIndex: p[2]
}));

// プレイヤー同期は不要（sメッセージで既に同期されている）
```

```javascript
// client-game.js: drawMinimap()
const playerSource = minimapPlayerPositions.length > 0 ? minimapPlayerPositions : players;

playerSource.forEach(p => {
    const px = p.x;
    const py = p.y;
    
    // ミニマップ用データの場合
    if (p.colorIndex !== undefined) {
        const color = minimapBitmapData.palette[p.colorIndex];
        minimapCtx.fillStyle = color || '#888888';
    } else {
        // 通常のplayersデータの場合
        minimapCtx.fillStyle = p.color;
    }
    
    minimapCtx.beginPath();
    minimapCtx.arc(px * s + ox, py * s + oy, 1, 0, Math.PI * 2);
    minimapCtx.fill();
});
```

#### データサイズ比較

**現在（5プレイヤー）:**
```javascript
[
  {"i": "abc123", "x": 1200, "y": 800, "c": "#ef4444"},  // 約46 bytes
  {"i": "xyz789", "x": 1500, "y": 1100, "c": "#3b82f6"}, // 約46 bytes
  ...
]
// MsgPack後: 約210-230 bytes
```

**最適化後:**
```javascript
[
  [1200, 800, 1],   // 約7 bytes
  [1500, 1100, 2],  // 約7 bytes
  ...
]
// MsgPack後: 約35-40 bytes
```

**削減率: 82-85% → 約170-190 bytes削減**

---

### 案2: ID保持 + カラーインデックス + 配列化

プレイヤー同期に絶対にIDが必要な場合（現在の実装を保持）:

```javascript
// サーバー側: shortIdを使用してサイズ削減
const playerPositions = Object.values(state.players)
    .filter(p => p.state !== 'waiting')
    .map(p => [
        p.shortId,                     // 1-2 bytes (数値)
        Math.round(p.x),               // 2-4 bytes
        Math.round(p.y),               // 2-4 bytes
        idToPaletteIndex[p.id] || 0    // 1 byte
    ]);

// クライアント側
minimapPlayerPositions = playerList.map(p => ({
    shortId: p[0],
    x: p[1],
    y: p[2],
    colorIndex: p[3]
}));
```

**データサイズ（5プレイヤー）:**
- MsgPack後: 約60-70 bytes
- **削減率: 67-70% → 約140-160 bytes削減**

---

### 案3: 自分のIDだけ送信

ミニマップで自分を白く表示するために、自分のIDだけ別で送信:

```javascript
// サーバー側
const playerPositions = Object.values(state.players)
    .filter(p => p.state !== 'waiting')
    .map(p => [
        Math.round(p.x),
        Math.round(p.y),
        idToPaletteIndex[p.id] || 0
    ]);

minimapData = { 
    tb: territoryBitmap, 
    pl: playerPositions,
    // 各クライアントには送らず、ブロードキャスト時にクライアントごとに設定
};

// client送信時
Object.values(state.clients).forEach(c => {
    const player = state.players[c.playerId];
    if (player && player.state !== 'waiting') {
        const myIndex = playerPositions.findIndex(p => 
            p[0] === Math.round(player.x) && p[1] === Math.round(player.y)
        );
        msg.mm.myIdx = myIndex;  // 自分のインデックス
    }
});

// クライアント側
const myIndex = minimapData.myIdx;
minimapPlayerPositions = playerList.map((p, idx) => ({
    x: p[0],
    y: p[1],
    colorIndex: p[2],
    isMe: idx === myIndex
}));
```

**データサイズ（5プレイヤー）:**
- MsgPack後: 約40-45 bytes
- **削減率: 80-82% → 約165-185 bytes削減**

---

## 実装推奨案

### 最終推奨: **案1（ID完全削除）**

**理由:**
1. **最大削減率**: 82-85%削減
2. **シンプル**: 実装が最もシンプル
3. **ID不要**: ミニマップのプレイヤー位置は描画のみで、同期は`s`メッセージで十分
4. **自分判定**: クライアント側で`myId`とプレイヤーリストを照合すれば判定可能

**修正が必要な箇所:**
1. `modules/network.js` (247-250行): プレイヤー位置データ生成
2. `client-network.js` (218-247行): プレイヤー位置データ受信処理
3. `client-game.js` (567-581行): ミニマップ描画

**実装時間:** 約2時間

---

## 実装コード（完全版）

### サーバー側 (`modules/network.js`)

```javascript
// 既存のコード（245-252行）を以下に置き換え
if (frameCount % 33 === 0) {
    const territoryBitmap = game.generateMinimapBitmap();
    
    // カラーパレットからIDへのマッピング構築
    const colorToIndex = {};
    Object.entries(territoryBitmap.cp).forEach(([idx, color]) => {
        colorToIndex[color] = parseInt(idx);
    });
    
    // プレイヤー位置を配列形式で生成
    const playerPositions = Object.values(state.players)
        .filter(p => p.state !== 'waiting')
        .map(p => [
            Math.round(p.x),
            Math.round(p.y),
            colorToIndex[p.color] || 0
        ]);
    
    minimapData = { tb: territoryBitmap, pl: playerPositions };
    scoreboardData = Object.values(state.players).map(p => ({ i: p.id, s: p.score, k: p.kills || 0 }));
}
```

### クライアント側 (`client-network.js`)

```javascript
// 既存のコード（218-247行）を以下に置き換え
const playerList = minimapData.pl || [];

// 配列をそのまま保存（変換不要）
minimapPlayerPositions = playerList;

// プレイヤー同期処理は削除（sメッセージで既に同期されている）
```

### クライアント側 (`client-game.js`)

```javascript
// drawMinimap() 関数内のプレイヤー描画部分（567-581行）を修正
const playerSource = minimapPlayerPositions.length > 0 ? minimapPlayerPositions : players;

playerSource.forEach(p => {
    let px, py, pcolor;
    
    // ミニマップデータ（配列形式）
    if (Array.isArray(p)) {
        px = p[0];
        py = p[1];
        const colorIdx = p[2];
        pcolor = (minimapBitmapData && minimapBitmapData.palette) 
            ? minimapBitmapData.palette[colorIdx] 
            : '#888888';
    } 
    // 通常のplayersデータ（オブジェクト形式）
    else {
        px = p.x;
        py = p.y;
        pcolor = p.color;
    }
    
    if (p.state && p.state !== 'active') return;
    
    // 自分判定: 座標が近い場合（±5ピクセル以内）
    const isMe = myPlayer && 
        Math.abs(px - myPlayer.x) < 5 && 
        Math.abs(py - myPlayer.y) < 5;
    
    minimapCtx.fillStyle = isMe ? '#fff' : pcolor;
    minimapCtx.beginPath();
    minimapCtx.arc(px * s + ox, py * s + oy, isMe ? 1.5 : 1, 0, Math.PI * 2);
    minimapCtx.fill();
});
```

---

## 効果測定

### データサイズ削減

| プレイヤー数 | 現在 | 最適化後 | 削減量 | 削減率 |
|-------------|------|---------|--------|--------|
| 3人 | 126-138 bytes | 21-24 bytes | 102-117 bytes | 81-85% |
| 5人 | 210-230 bytes | 35-40 bytes | 170-195 bytes | 81-85% |
| 10人 | 420-460 bytes | 70-80 bytes | 340-390 bytes | 81-85% |
| 20人 | 840-920 bytes | 140-160 bytes | 680-770 bytes | 81-84% |

### 帯域使用量削減（2秒に1回送信）

**10プレイヤー、2分ラウンド:**
```
送信回数: 60回（2分÷2秒）

現在: 420 bytes × 60回 × 10クライアント = 252 KB
最適化後: 70 bytes × 60回 × 10クライアント = 42 KB

削減: 210 KB (83%削減)
```

---

## まとめ

**推奨実装: 案1（ID完全削除）**

✅ **削減効果:** 81-85% のデータサイズ削減  
✅ **実装コスト:** 約2時間  
✅ **リスク:** 低（既存の`s`メッセージで同期済み）  
✅ **副次効果:** CPU負荷も若干削減（データ処理が簡略化）  

**実装優先度: 高**（即座に実装可能、大きな効果）

---

**End of Document**

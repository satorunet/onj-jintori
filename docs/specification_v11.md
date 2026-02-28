# Zinti ゲーム仕様書 v11

**更新日:** 2026-02-27
**サーバーバージョン:** 5.1.0
**サーバー:** Node.js + WebSocket (ws) + HTTPS
**クライアント:** HTML5 Canvas + WebSocket
**データベース:** MySQL2 (ランキング・統計用)

---

## 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [ファイル構成](#2-ファイル構成)
3. [ゲーム定数・設定](#3-ゲーム定数設定)
4. [ゲームモード・ラウンド](#4-ゲームモードラウンド)
5. [プレイヤー](#5-プレイヤー)
6. [移動・入力](#6-移動入力)
7. [ブースト](#7-ブースト)
8. [テリトリーシステム](#8-テリトリーシステム)
9. [軌跡（トレイル）](#9-軌跡トレイル)
10. [衝突判定・死亡](#10-衝突判定死亡)
11. [障害物・ギア](#11-障害物ギア)
12. [スコアリング](#12-スコアリング)
13. [AFK・ボット認証](#13-afkボット認証)
14. [CPU AI](#14-cpu-ai)
15. [チーム連結（チェーン）](#15-チーム連結チェーン)
16. [チームチャット](#16-チームチャット)
17. [スウォームモード](#17-スウォームモード)
18. [通信プロトコル](#18-通信プロトコル)
19. [AOI (Area of Interest)](#19-aoi-area-of-interest)
20. [ミニマップ](#20-ミニマップ)
21. [クライアント描画](#21-クライアント描画)
22. [パフォーマンス制御](#22-パフォーマンス制御)
23. [UI・画面構成](#23-ui画面構成)
24. [HTTP API](#24-http-api)
25. [管理パネル](#25-管理パネル)
26. [データベーススキーマ](#26-データベーススキーマ)
27. [パフォーマンス最適化](#27-パフォーマンス最適化)

---

## 1. プロジェクト概要

Paper.io風のマルチプレイヤー陣取りゲーム。プレイヤーはグリッド上を移動し、軌跡でエリアを囲んでテリトリーを拡大する。他プレイヤーの軌跡を切断してキルが可能。

**主な特徴:**
- リアルタイムマルチプレイヤー（WebSocket）
- SOLOモード / TEAMモードの自動切替
- msgpackバイナリプロトコルによる低帯域通信
- CPU AIボットによるゲーム活性化
- CAPTCHA式ボット認証 + Cookie認証セッション（24時間有効）
- 回転ギア障害物（占領可能）
- ブースト機能
- チーム連結（チェーン）システム
- チームチャット・戦歴ログ
- ミニマップ履歴再生
- スウォームモード（50体ボット連携攻撃）

---

## 2. ファイル構成

### サーバー側

| ファイル | 役割 |
|:---------|:-----|
| `server.v5.js` | メインエントリ、ゲームループ、ラウンド管理 |
| `modules/config.js` | 定数、共有ステート、DB接続、起動オプション |
| `modules/game.js` | ゲームロジック、テリトリー管理、衝突判定、DB保存 |
| `modules/network.js` | WebSocket通信、差分軌跡エンコード、AOIフィルタ |
| `modules/cpu.js` | CPU AI、フェーズ管理、チーム協調、スウォーム |
| `modules/stats.js` | 帯域・CPU・メモリ統計レポート |
| `modules/bot-auth.js` | CAPTCHA生成・検証、AFK管理、Cookie認証セッション |
| `modules/api.js` | REST API、静的ファイル配信、管理者認証 |
| `modules/admin-auth.js` | 管理者セッション・パスワード管理 |
| `modules/bench-monitor.js` | ベンチマーク計測（ゲームループ/ブロードキャスト） |
| `msgpack.js` | カスタムmsgpackシリアライザ |
| `bench/load-test.js` | 負荷テストスクリプト |

### クライアント側 (`public_html/`)

| ファイル | 役割 |
|:---------|:-----|
| `index.html` | ページ構造、モーダル、UIレイアウト、チームチャットパネル |
| `style.css` | スタイル定義、パフォーマンスモード対応 |
| `client/client-config.js` | クライアント定数、グローバル変数、ヘルパー |
| `client/client-network.js` | WebSocket接続、メッセージデコード |
| `client/client-game.js` | Canvas描画、入力処理、パーティクル、チェーン描画 |
| `client/client-ui.js` | UI更新、モーダル制御、ランキング表示、チームチャット |

---

## 3. ゲーム定数・設定

### サーバー定数 (config.js)

| 定数 | 値 | 説明 |
|:-----|:---|:-----|
| `PORT` | 2053 | WebSocket/HTTPSポート |
| `GAME_DURATION` | 120秒 | ラウンド時間（debug時: 999999） |
| `RESPAWN_TIME` | 3秒 | リスポーン待ち時間 |
| `PLAYER_SPEED` | 130 px/tick | 基本移動速度 |
| `GRID_SIZE` | 10 px | テリトリーグリッド単位 |
| `BOOST_DURATION` | 2000 ms | ブースト持続時間 |
| `BOOST_COOLDOWN` | 5000 ms | ブーストクールダウン |
| `BOOST_SPEED_MULTIPLIER` | 1.8倍 | ブースト時の速度倍率 |
| `AFK_DEATH_LIMIT` | 2回 | AFK切断までの死亡回数 |
| `MINIMAP_SIZE` | 30 px | ミニマップビットマップ解像度 |
| `INVULNERABILITY_DURATION` | 3000 ms | スポーン後の無敵時間 |
| `NO_SUICIDE` | true | 自己ライン接触死亡を無効化 |

### チーム連結定数

| 定数 | 値 | 説明 |
|:-----|:---|:-----|
| `CHAIN_SPACING` | 30 px | チェーンメンバー間の距離 |
| `CHAIN_MAX_LENGTH` | Infinity | チェーン最大人数 |
| `CHAIN_PATH_HISTORY_SIZE` | 500 | リーダー経路履歴バッファ |

### スウォーム定数

| 定数 | 値 | 説明 |
|:-----|:---|:-----|
| `SWARM_BOT_COUNT` | 50 | スウォームボット数 |
| `SWARM_CHAIN_SPACING` | 20 px | スウォームメンバー間距離 |
| `SWARM_TEAM_NAME` | `🤖SWARM` | スウォームチーム名 |
| `SWARM_TEAM_COLOR` | `#ef4444` | スウォームチーム色 |
| `SWARM_ATTACK_RANGE` | 200 px | スウォーム攻撃検知距離 |
| `SWARM_REJOIN_TIMEOUT` | 10000 ms | 離脱後の再合流タイムアウト |

### ワールドサイズ（動的）

| プレイヤー数 | ワールドサイズ |
|:-------------|:--------------|
| 少数 | 1500 px |
| 中程度 | 〜3000 px |
| 多数 | 最大 5000 px |

### ループ間隔

| ループ | 間隔 | 説明 |
|:-------|:-----|:-----|
| ゲームループ | 50 ms | 移動・衝突・キャプチャ処理 |
| ブロードキャスト | 25 ms (40fps) | クライアントへの状態送信 |
| CPU AIループ | 100 ms | ボットの意思決定 |

### クライアント定数 (client-config.js)

| 定数 | 値 | 説明 |
|:-----|:---|:-----|
| `ZOOM_LEVEL` | 0.8 | カメラズーム |
| `MAX_PARTICLES` | 500 | 最大パーティクル数 |
| `FORCE_SEND_INTERVAL` | 1000 ms | 入力強制再送間隔 |
| `ANGLE_STOP` | 255 | 停止用角度バイト |
| `ANGLE_THRESHOLD` | 3° | 入力変化閾値 |
| `FPS_THRESHOLD` | 35 | 低パフォーマンスモード切替FPS |
| `FORCE_LOW_PERF_PLAYER_COUNT` | 10 | 強制低パフォーマンスモード人数 |

### 起動オプション

| フラグ | 効果 |
|:-------|:-----|
| `debug` / `--debug` | デバッグモード（無限ゲーム時間） |
| `team` | TEAMモード固定 |
| `mugen` | 無限ゲーム時間 |
| `toukei` | 統計モード（JSON出力） |
| `bench` | ベンチマーク計測モード |
| `vsbot` | 人間 vs BOTモード |

### フィーチャーフラグ

| フラグ | デフォルト | 説明 |
|:-------|:-----------|:-----|
| `HUMAN_VS_BOT` | false | 人間 vs AI チーム対戦モード |
| `HELL_OBSTACLES` | false | 高難度モード（障害物80個 + 巨大ギア） |
| `GEAR_ENABLED` | false | 回転ギア占領システム |
| `NO_SUICIDE` | true | 自己ライン接触での死亡無効化 |
| `FORCE_TEAM` | false | TEAMモード固定 |

---

## 4. ゲームモード・ラウンド

### モード

| モード | 説明 |
|:-------|:-----|
| `SOLO` | 個人戦。全員が敵 |
| `TEAM` | チーム戦。チームカラー付き |

**チームカラー:**
| チーム | カラーコード |
|:-------|:------------|
| RED | `#ef4444` |
| BLUE | `#3b82f6` |
| GREEN | `#22c55e` |
| YELLOW | `#eab308` |
| HUMAN | `#3b82f6` |

### ラウンドライフサイクル

```
1. ラウンド開始 (roundActive = true)
   └→ グリッド初期化、障害物生成、ギア生成、CPU生成
2. ゲーム進行 (120秒)
   └→ プレイヤー移動、テリトリー管理、衝突判定、チェーン物理
3. 時間切れ (timeRemaining = 0)
   └→ ランキング計算、DB保存、round_end送信
4. リザルト画面 (15秒)
   └→ スコア表示、チャット、ミニマップ再生
5. 次ラウンド準備
   └→ モード切替 (SOLO ↔ TEAM)、全プレイヤーリスポーン
```

**モード切替:** `FORCE_TEAM`フラグがない場合、毎ラウンドSOLO/TEAMを交互に切替

### 特殊モード

| モード | 説明 |
|:-------|:-----|
| HUMAN vs BOT | 人間=HUMANチーム(青)、CPU=BOTチーム(赤) |
| Hell Mode | 障害物80個 + 通常ギア5個 + メガギア2個 |
| Swarm Mode | 管理者トグルで50体ボット連携攻撃 |

---

## 5. プレイヤー

### プレイヤー属性

| 属性 | 型 | 説明 |
|:-----|:---|:-----|
| `id` | int (16bit) | 一意のプレイヤーID（shortId） |
| `name` | string | 表示名（最大8文字） |
| `team` | string | チーム名（最大5文字、絵文字対応） |
| `color` | string | HEXカラーコード |
| `emoji` | string | プレイヤー絵文字 |
| `x`, `y` | number | ピクセル座標 |
| `dx`, `dy` | number | 正規化方向ベクトル |
| `score` | number | 占有セル数 |
| `kills` | number | キル数 |
| `state` | string | 'dead' / 'active' / 'waiting' |
| `gridTrail` | array | グリッド座標の軌跡 |
| `trail` | array | ピクセル座標の軌跡 |
| `boostUntil` | number | ブースト終了時刻 |
| `boostCooldownUntil` | number | クールダウン終了時刻 |
| `hasBeenActive` | bool | 一度でもアクティブになったか |
| `hasMovedSinceSpawn` | bool | スポーン後に移動したか |
| `invulnerableUntil` | number | 無敵終了時刻 |
| `scale` | number | 描画スケール（ボス: 2.5） |
| `ip` | string | クライアントIPアドレス |
| `pendingAuth` | bool | CAPTCHA認証待ちフラグ |
| `chainRole` | string | 'none' / 'leader' / 'follower' |
| `chainLeaderId` | int | フォロワー時のリーダーID |
| `chainFollowers` | array | リーダーの直接フォロワーリスト |
| `chainPathHistory` | array | リーダーの経路履歴 |
| `chainIndex` | int | 連結内の位置 (0=リーダー) |
| `perfMode` | string | パフォーマンスモード ('auto'/'high'/'low') |

### プレイヤー名ルール
- 最大8 Unicodeコードポイント
- チーム名: 最大5 Unicodeコードポイント（国旗絵文字対応）
- 表示形式: `[チーム名] プレイヤー名`
- 制御文字 (0x00-0x1F, 0x7F) 禁止
- 未入力時: 「名無し」+ ランダム英数字2文字
- 名前「BOT」は自動でロボット絵文字に変更

---

## 6. 移動・入力

### 入力方式

| 方式 | デバイス | 説明 |
|:-----|:---------|:-----|
| タッチジョイスティック | モバイル | 仮想ジョイスティック（35px） |
| マウス | PC | クリック位置への方向 |
| キーボード | PC | 矢印キー（←↑→↓） |

### 角度エンコーディング

クライアントからサーバーへ1バイトで送信:

```
バイト値 = (角度 + π) / (2π) × 254
```

| 方向 | 角度 | バイト値 |
|:-----|:-----|:---------|
| → 右 | 0° | 127 |
| ↗ 右上 | 45° | 159 |
| ↑ 上 | 90° | 191 |
| ← 左 | 180° | 0 or 254 |
| ↓ 下 | -90° | 64 |
| 停止 | - | 255 |

### 送信条件
- 角度変化 ≥ 3° (ANGLE_THRESHOLD)
- ブーストリクエスト時
- 1000ms毎の強制再送 (FORCE_SEND_INTERVAL)

### サーバー側の移動処理
- 50msゲームティックでdt計算
- `x += dx * PLAYER_SPEED * dt * boostMultiplier`
- `y += dy * PLAYER_SPEED * dt * boostMultiplier`
- ブースト時はサブステップ分割（グリッドセル飛ばし防止）

### フォロワー移動制限
- チェーンフォロワーは方向入力を無視
- ブーストボタンで離脱（離脱後は入力方向で自由移動）

---

## 7. ブースト

| 項目 | 値 |
|:-----|:---|
| 速度倍率 | 1.8倍 |
| 持続時間 | 2000 ms |
| クールダウン | 5000 ms |
| 発動条件 | クールダウン完了 + 移動中 |

### 入力

```javascript
// 通常移動: 1バイト
new Uint8Array([angleByte])

// ブースト付き移動: 2バイト
new Uint8Array([angleByte, 1])
```

### サーバー処理

```javascript
if (msg.length === 2 && msg[1] === 1) {
    if (!p.boostCooldownUntil || now >= p.boostCooldownUntil) {
        p.boostUntil = now + BOOST_DURATION;        // 2000ms
        p.boostCooldownUntil = now + BOOST_COOLDOWN; // 5000ms
    }
}
```

### クライアント表示
- **利用可能:** 緑グラデーションボタン「⚡BOOST」
- **発動中:** レインボーグラデーション + グロー + スピードライン
- **クールダウン:** グレーボタン + プログレスバー

---

## 8. テリトリーシステム

### データ構造

- **worldGrid[y][x]:** 2Dグリッド、各セルに所有者ID / null / 'obstacle' / 'obstacle_gear'
- **territoryRects[]:** ランレングス圧縮矩形（行ごとの連結セル）
  - 形式: `{ o: ownerId, c: color, x, y, w, h }`

### キャプチャアルゴリズム (attemptCapture)

プレイヤーが軌跡を持った状態で自分のテリトリーに戻ると発動:

```
1. ベースグリッド構築: 自陣 + チームメイト陣 + 障害物 = 壁
2. BFS 1 (軌跡あり): 軌跡を壁として到達可能セルを取得
3. BFS 2 (軌跡なし): 軌跡なしの到達可能セルを取得
4. 差分 = BFS2 ∩ ¬BFS1 = 新たに囲まれたセル
5. 敵アイランド処理:
   - 複数アイランド: 小さいアイランドのみキャプチャ
   - 最大アイランド ≤ 10セル: 全てキャプチャ
6. 空白アイランド: 同様のロジック
7. 所有権変更 + スコア更新
8. territoryRects再構築
```

### テリトリー没収
- キルされたプレイヤーのテリトリーは攻撃者に移転（全消去ではない）
- トレイルカットキル時: 被害者のテリトリー所有権が攻撃者に変更

### 最適化
- BFS: インラインBFS、1D Uint8Arrayフラグ、インデックスベースキュー（shift()不使用）
- territoryRects再構築: 1D Uint8Arrayで処理済みフラグ、数値キーのMap
- テリトリーワイプ: territoryRectsベーススキャン（全グリッドスキャン不要）

---

## 9. 軌跡（トレイル）

### サーバー側

- `gridTrail[]`: グリッド座標の配列
- `trail[]`: ピクセル座標の配列
- `_trailCache`: プレイヤーごとにフルトレイルバイナリをキャッシュ

### バイナリエンコーディング

**フルトレイル (`ft=1`):**
```
Offset | Size | 説明
-------|------|------
0      | 2    | 始点X (UInt16LE, グリッド単位)
2      | 2    | 始点Y (UInt16LE, グリッド単位)
4+     | 2×N  | 各ポイントの差分 (dx: Int8, dy: Int8)
```

**差分トレイル (`ft`なし):**
```
Offset | Size | 説明
-------|------|------
0+     | 2×N  | 新ポイントの差分のみ (dx: Int8, dy: Int8)
```

### 差分範囲
- dx, dy: [-128, 127] にクランプ

### クリア
- キャプチャ成功時: `tc: 1` フラグで軌跡クリア通知

---

## 10. 衝突判定・死亡

### 正面衝突
- **条件:** 同一グリッドセル上
- **判定:** スコアが低い方が死亡、同点は両方死亡
- **結果:** 被害者のテリトリーが攻撃者に移転

### トレイルカット
- **条件:** 敵トレイルセグメントとの距離 < 15px
- **結果:**
  - 被害者死亡、テリトリー攻撃者に移転
  - キル数 +1

### 自爆
- `NO_SUICIDE = true` の場合は自己トレイル接触で死亡しない
- `NO_SUICIDE = false` の場合: 自分のトレイルとの距離 < 8px で即死（直近10ポイント除外）

### 障害物衝突
- **条件:** 'obstacle' または 'obstacle_gear' セル上
- **例外:** 自チームが占有中のギアは通過可能
- **結果:** 即死

### 無敵
- スポーン後3秒間（移動開始で解除）
- 表示: 点滅エフェクト + 残り秒数

### 死亡後の処理
1. `state = 'dead'`
2. テリトリー移転（トレイルカット時）またはワイプ
3. クライアントに `player_death` メッセージ送信
4. 3秒後にリスポーン（死亡位置から500px以上離れた場所を優先）

---

## 11. 障害物・ギア

### 通常障害物
- 1ラウンドあたり15個生成（HELL_OBSTACLES有効時: 80個）
- グリッドサイズの矩形

### Hell Mode障害物
- 短い壁（2-3セル）、長い壁（4-6セル）、ランダムサイズ混合
- 通常ギア5個（半径150-300px）
- メガギア2個（半径400-600px、超低速回転）

### 回転ギア（GEAR_ENABLED時）

| 属性 | 値 |
|:-----|:---|
| 半径 | 500 px |
| 位置 | マップ中央 |
| 回転速度 | ゆっくり |
| 歯数 | 3-7 |
| 歯幅 | 0.08-0.1（円周の割合） |
| 占有条件 | 内周35%エリアに滞在 |

**ギアの状態:**
- **未占有:** 薄い点線の円
- **占有中:** プログレス表示（円弧ゲージ） + 占有者名
- **占有完了:** 塗りつぶし + 占有チーム色 + チーム名

**特殊ルール:**
- 占有チームのプレイヤーはギアを通過可能
- ギア衝突でダメージ判定（歯車部分）
- ギア占有状態は変更時のみクライアントに送信

---

## 12. スコアリング

### スコア計算
- 占有セル数 = スコア
- パーセンテージ表示: `(占有セル / 全セル) × 100`

### キルボーナス
- トレイルカットキル: キル数 +1
- 被害者テリトリーが攻撃者に移転（スコア増加）

### ランキング
- ラウンド終了時に上位10名を記録
- DB保存: `player_rankings`テーブル
- チームランキング: 上位5チーム（`team_rankings`テーブル）

---

## 13. AFK・ボット認証

### AFKシステム

```
1. スポーン後1秒未操作 → オートラン開始
2. 2回以上の無操作死亡（hasBeenActive=true条件下）
   └→ AFKタイムアウト発動（ソケット close code: 4000）
3. IPをDBに記録
4. 次回接続時にCAPTCHA要求
```

### CAPTCHA生成

| 項目 | 値 |
|:-----|:---|
| 形式 | SVG (120×50 px) |
| コード | 3桁ランダム数字 (100-999) |
| 背景 | ランダム明色 |
| 文字 | ランダム暗色、回転・位置ズレ |
| ノイズ | ランダム線5本 |
| 有効期限 | 3分 |

### 認証フロー

```
1. 同一IPから再接続（5分以内）
2. サーバー: Cookie認証セッションをチェック
   └→ 有効なセッションあり → 認証スキップ
3. サーバー: captchaVerifiedIPs をチェック（1時間有効）
   └→ 検証済みIP → 認証スキップ
4. サーバー: pendingAuth = true を設定
5. クライアント: join送信
6. サーバー: bot_auth_required + CAPTCHA画像送信
7. クライアント: bot_auth_response + コード送信
8. 成功:
   - bot_auth_success + sessionToken 送信
   - クライアントがCookieを設定（24時間有効）
   - IPを captchaVerifiedIPs に登録（1時間有効）
   - join実行
9. 失敗: bot_auth_failed → 新CAPTCHA送信
```

### Cookie認証セッション

| 項目 | 値 |
|:-----|:---|
| Cookie名 | `bot_auth_session` |
| トークン | crypto.randomBytes(32).toString('hex')（64文字hex） |
| 有効期限 | 24時間 |
| サーバー保存 | `state.botAuthSessions` Map（token → {ip, createdAt}） |
| SameSite | Strict |

**動作:**
- CAPTCHA認証成功時にサーバーがトークンを生成
- `bot_auth_success` メッセージでトークンをクライアントに送信
- クライアントが `document.cookie` でセッションCookieを設定
- 次回WebSocket接続時、HTTP Upgrade リクエストのCookieヘッダーから検証
- 有効なセッションがあればCAPTCHAをスキップ

### WebSocket切断コード

| コード | 意味 |
|:-------|:-----|
| `4000` | AFKによる切断 |
| `4001` | 名前長超過 |
| `4002` | チーム名長超過 |
| `4003` | 不正な制御文字 |
| `4010` | ビューポートサイズ超過 |

---

## 14. CPU AI

### 設定

| 項目 | 値 |
|:-----|:---|
| CPU数 (SOLO) | 1 |
| CPU数 (TEAM) | 1 |
| 更新間隔 | 100 ms |
| 方向変更最小間隔 | 500 ms |

### 難易度レベル

| パラメータ | WEAK | MEDIUM | STRONG |
|:-----------|:-----|:-------|:-------|
| maxTrailLength | 12 | 16 | 20 |
| captureSize | 6 | 7 | 8 |
| chaseChance | 0.1 | 0.3 | 0.6 |
| reactionDistance | 80 | 100 | 120 |
| aggressiveness | 0.3 | 0.5 | 0.7 |
| attackRange | 150 | 200 | 300 |
| attackProbability | 0.3 | 0.5 | 0.8 |
| boostUsage | 0.1 | 0.3 | 0.6 |
| feintChance | 0 | 0.1 | 0.3 |

### AIフェーズ

| フェーズ | 説明 |
|:---------|:-----|
| `idle` | 自陣内、脅威なし |
| `expanding` | テリトリー拡大中（軌跡作成中） |
| `returning` | 自陣に帰還中 |
| `attacking` | 敵トレイルを追跡 |
| `supporting` | 味方を援護（TEAM） |
| `emergency_return` | ブースト使用の緊急帰還 |
| `patrolling` | 自陣防衛パトロール |
| `formation` | ボス周辺に集合（TEAM） |

### 意思決定優先度

```
1. 緊急回避（障害物/壁/トレイルが3歩以内）
2. 方向変更クールダウン（500ms）
3. 脅威検知（250px半径内の敵）
4. チーム援護（味方が展開中 + 近くに敵）
5. 攻撃（attackRange内に敵トレイル発見）
6. 拡大（自陣内で安全、aggressiveness確率）
7. 帰還（トレイルが長い場合強制）
8. 安全チェック（壁回避、自爆回避、5歩先読み）
```

### CPUチーム

| 項目 | 値 |
|:-----|:---|
| チーム名 | `🇯🇵ONJ` |
| カラー | `#f97316`（オレンジ） |
| 予約名 | 人間プレイヤー参加不可 |

### ボスモード

| 項目 | 値 |
|:-----|:---|
| スケール | 2.5倍 |
| 難易度 | STRONG |
| ブースト | 常時発動 |
| 特殊行動 | チームメンバーがボス周辺に集合 |

---

## 15. チーム連結（チェーン）

### 概要

TEAMモードで同じチームのプレイヤーがリーダー・フォロワーの関係で物理的に連結できるシステム。

### 接続条件

| 条件 | 値 |
|:-----|:---|
| 同一チーム | 必須 |
| 距離 | 100px以内 |
| 両者の状態 | active（移動中） |
| 操作 | タップ/クリック（近接チームメイトをタップ） |

### 動作

| 項目 | 説明 |
|:-----|:-----|
| リーダー | 自由に移動、経路履歴を記録 |
| フォロワー | リーダーの経路履歴に追従 (CHAIN_SPACING=30px間隔) |
| 離脱 | フォロワーがブーストボタンを押すと離脱 |

### クライアント表示

- **連結候補:** 緑色の脈動リング + 🔗 アイコン（100px以内のチームメイト）
- **リーダー:** チーム色の円アウトライン
- **フォロワー:** リーダーへの白い破線接続ライン + 🔗 絵文字

### プロトコル

```javascript
// クライアント → サーバー
{ type: 'chain_attach', targetId: 123 }

// サーバー → クライアント（状態更新 p 配列内）
{
    cr: 1,        // chainRole: 1=leader, 2=follower
    cl: 123,      // chainLeaderId (follower時)
    cax: 1234,    // chainAnchorX (描画用)
    cay: 5678,    // chainAnchorY
    cn: [456, 789] // 近接チームメイトID（連結候補、自分のみ）
}
```

---

## 16. チームチャット

### 概要

TEAMモードで同じチームのメンバー間でリアルタイムチャットが可能。3タブ構成のパネルUI。

### 初期状態

- チーム戦参加時: **アイコン（バッジ）状態**で開始
- ユーザーがバッジをタップすると展開

### UI構成

```
┌─────────────────────────┐
│ 🚩 チーム名         ✕   │ ← ヘッダー（ドラッグ可能）
├─────────────────────────┤
│ 💬 Chat | 👥 Team | ⚔️ Log │ ← タブ
├─────────────────────────┤
│                         │
│  メッセージ一覧         │ ← 各タブのコンテンツ
│                         │
├─────────────────────────┤
│ [入力欄] [送信]          │ ← チャットタブ時のみ
└─────────────────────────┘
```

### タブ

| タブ | 内容 |
|:-----|:-----|
| 💬 Chat | チームメンバー間のチャット（20文字制限） |
| 👥 Team | チームメンバーリスト（名前、スコア） |
| ⚔️ Log | 戦歴ログ（味方の死亡/キルを自動記録） |

### バッジ（アイコン状態）

- 44px丸ボタン + 💬 アイコン
- 未読メッセージ数を赤バッジで表示
- 青色のパルスグロー

### プロトコル

```javascript
// クライアント → サーバー
{ type: 'team_chat', text: 'メッセージ' }

// サーバー → 同一チーム全員
{ type: 'team_chat', text: '...', name: 'プレイヤー名', color: '#ff5733' }

// リスポーン時のログ同期
{ type: 'team_log_sync', chat: [...], battle: [...] }
```

### 制限

| 項目 | 値 |
|:-----|:---|
| メッセージ長 | 最大20文字 |
| ログ保持 | チーム毎に最新50件 |
| 制御文字 | 禁止 (0x00-0x1F, 0x7F) |

---

## 17. スウォームモード

### 概要

管理者がトグルで有効化できる50体ボット連携攻撃モード。全ボットがチェーンで連結し、単一のフォーメーションとして行動する。

### 設定

| 項目 | 値 |
|:-----|:---|
| ボット数 | 50体 |
| チーム名 | `🤖SWARM` |
| チーム色 | `#ef4444`（赤） |
| 間隔 | 20px (SWARM_CHAIN_SPACING) |
| 攻撃検知距離 | 200px |
| 再合流タイムアウト | 10秒 |

### 動作

```
1. 管理者が /api/admin/swarm-toggle でON
2. 50体のボットが生成され、チェーンで連結
3. リーダーが移動 → フォロワーが経路追従
4. 200px以内に敵を検知 → 一斉攻撃
5. 離脱メンバーは10秒以内に自動再合流
```

### 管理API

```
POST /api/admin/swarm-toggle
→ { "success": true, "swarmMode": true/false }
```

---

## 18. 通信プロトコル

### 基本仕様

| 項目 | 値 |
|:-----|:---|
| サーバー→クライアント（状態更新） | MessagePack |
| サーバー→クライアント（イベント） | JSON |
| クライアント→サーバー（移動） | バイナリ (1-2バイト) |
| クライアント→サーバー（コマンド） | JSON |
| WebSocket圧縮 | perMessageDeflate (level 4, windowBits 15, threshold 512B) |
| 状態更新間隔 | 25 ms (40fps) |

### 送信頻度一覧

| データ | 頻度 | 間隔 | 形式 |
|:-------|:-----|:-----|:-----|
| プレイヤー位置・軌跡 | 毎フレーム | 25 ms | MessagePack |
| テリトリー差分 | 変更時 | リアルタイム | バイナリ (`tb`) |
| スコアボード | 120フレーム毎 | 3秒 | MessagePack |
| チーム統計 | 変更時 | リアルタイム | MessagePack |
| ミニマップ | 動的 | 5-15秒 | MessagePack |
| ギア占有 | 変更時 | リアルタイム | MessagePack |
| ベンチマーク | 1200フレーム毎 | 30秒 | JSON |

### クライアント → サーバー

#### 移動コマンド (バイナリ 1-2バイト)

```javascript
// 通常移動
new Uint8Array([angleByte])

// ブースト付き移動
new Uint8Array([angleByte, 1])
```

#### JSONメッセージ

| type | ペイロード | 説明 |
|:-----|:-----------|:-----|
| `join` | `{ name, team, emoji }` | ゲーム参加 |
| `update_team` | `{ team }` | チーム変更 |
| `chat` | `{ text }` | チャット（1ラウンド1回、15文字） |
| `team_chat` | `{ text }` | チームチャット（20文字） |
| `perf` | `{ mode }` | パフォーマンスモード変更 |
| `viewport` | `{ w, h }` | ビューポートサイズ通知 |
| `bot_auth_response` | `{ code }` | CAPTCHA回答 |
| `chain_attach` | `{ targetId }` | チーム連結リクエスト |

### サーバー → クライアント

#### 初期化 (`init`) - JSON

```json
{
  "type": "init",
  "id": 42,
  "color": "#ff5733",
  "emoji": "😀",
  "world": { "width": 4000, "height": 3000, "gs": 10 },
  "mode": "TEAM",
  "obstacles": [],
  "gears": [],
  "tf": [{ "x": 10, "y": 10, "w": 7, "h": 7, "o": 42, "c": "#ff5733" }],
  "tv": 1,
  "teams": [{ "name": "🇯🇵ONJ", "count": 3 }],
  "pc": 8
}
```

#### プレイヤーマスタ (`pm`) - JSON

```json
{
  "type": "pm",
  "players": [
    {
      "i": 42,
      "n": "[🇯🇵ONJ] プレイヤー",
      "c": "#ff5733",
      "e": "😀",
      "t": "🇯🇵ONJ",
      "sc": 1.0
    }
  ]
}
```

#### 状態更新 (`s`) - MessagePack

25ms毎に送信。含まれるフィールドはフレームにより異なる。

```javascript
{
  type: 's',
  tm: 120,              // 残り時間（秒）
  pc: 8,                // プレイヤー数（アクティブのみ）
  p: [...],             // プレイヤー配列（AOIフィルタ済み）
  mm: {...},            // ミニマップ（動的頻度）
  sb: [...],            // スコアボード（3秒毎）
  te: [...],            // チーム統計（変更時）
  gc: [{...}],          // ギア占有状態（変更時）
  tb: <Buffer>,         // テリトリー差分バイナリ
  tfb: <Base64>,        // テリトリー全量（gzip、Base64）
  tf: [...],            // テリトリー全量（JSON）
  tv: 1234              // テリトリーバージョン
}
```

#### プレイヤーオブジェクト (`p` 配列要素)

| フィールド | 型 | 説明 |
|:-----------|:---|:-----|
| `i` | int | 短縮ID (shortId) |
| `x` | int | X座標（ピクセル、丸め済み） |
| `y` | int | Y座標 |
| `st` | int | 状態: 0=dead, 1=active(省略), 2=waiting, 3=無敵 |
| `rb` | Buffer | 軌跡バイナリ（差分 or フル） |
| `ft` | 1 | フル軌跡フラグ（省略時は差分） |
| `tc` | 1 | 軌跡クリア済みフラグ |
| `bs` | int | ブースト残り（自分:100ms単位, 他:1=発動中） |
| `bc` | int | クールダウン残り秒（自分のみ） |
| `cr` | int | チェーン役割 (1=leader, 2=follower) |
| `cl` | int | チェーンリーダーID（follower時） |
| `cax` | int | チェーンアンカーX（follower描画用） |
| `cay` | int | チェーンアンカーY |
| `cn` | array | 近接チームメイトID（連結候補、自分のみ） |

#### テリトリーバイナリ (`tb`) フォーマット

```
[追加セクション]
UInt16LE: 追加矩形数
各矩形 (13バイト):
  UInt16LE: x
  UInt16LE: y
  UInt16LE: w
  UInt16LE: h
  UInt16LE: ownerID (shortId)
  UInt8: R
  UInt8: G
  UInt8: B

[削除セクション]
UInt16LE: 削除矩形数
各矩形 (4バイト):
  UInt16LE: x
  UInt16LE: y
```

#### テリトリー全量圧縮 (`tfb`)

- gzip圧縮されたJSON文字列（Base64エンコード）
- テリトリーバージョンジャンプ > 1000 または新規クライアント時に送信
- キャッシュ: バージョン未変更ならキャッシュ利用

#### ラウンド終了 (`round_end`) - JSON

```json
{
  "type": "round_end",
  "rankings": [
    {
      "name": "[🇯🇵ONJ] プレイヤー",
      "score": 12.5,
      "emoji": "😀",
      "color": "#ff5733",
      "kills": 3,
      "team": "🇯🇵ONJ"
    }
  ],
  "teamRankings": [
    { "name": "🇯🇵ONJ", "score": 45.6, "kills": 12, "members": 4 }
  ],
  "winner": { "name": "[🇯🇵ONJ] プレイヤー", "score": 12.5 },
  "nextMode": "SOLO",
  "allTeams": [{ "name": "🇯🇵ONJ", "count": 4 }],
  "totalPlayers": 8,
  "mapFlags": [{ "f": "🇯🇵", "x": 1200, "y": 800 }],
  "minimapHistory": [
    {
      "time": 0,
      "bm": "<Base64 gzip>",
      "cp": { "1": "#ff0000" },
      "sz": 30,
      "flags": []
    }
  ],
  "secondsUntilNext": 15
}
```

#### ラウンド開始 (`round_start`) - JSON

```json
{
  "type": "round_start",
  "mode": "TEAM",
  "world": { "width": 4000, "height": 3000 },
  "obstacles": [],
  "gears": [],
  "tf": [...],
  "tv": 0
}
```

#### プレイヤー死亡 (`player_death`) - JSON

```json
{
  "type": "player_death",
  "id": 42,
  "reason": "キル: 敵プレイヤー名",
  "team": "🇯🇵ONJ"
}
```

#### ギア占有 (`gear_captured`) - JSON

```json
{
  "type": "gear_captured",
  "gearIndex": 0,
  "capturedBy": "チーム名",
  "color": "#ff5733",
  "name": "プレイヤー名"
}
```

#### チャット (`chat`) - JSON

```json
{
  "type": "chat",
  "text": "メッセージ",
  "color": "#ff5733",
  "name": "[🇯🇵ONJ] プレイヤー"
}
```

#### ボット認証 - JSON

```json
// 認証要求
{ "type": "bot_auth_required", "captchaImage": "<Base64 SVG>", "message": "..." }

// 認証成功（sessionToken付き）
{ "type": "bot_auth_success", "message": "認証に成功しました", "sessionToken": "<64文字hex>" }

// 認証失敗
{ "type": "bot_auth_failed", "message": "...", "captchaImage": "<新Base64 SVG>" }
```

---

## 19. AOI (Area of Interest)

### 方式

矩形AOI（ビューポートベース）:

| 項目 | 値 |
|:-----|:---|
| デフォルトビューポート | 480×920 px |
| AOIマージン | 200 px |
| 最大ビューポート | 540×1020 px（超過でキック） |
| 最小AOI | 800×800 px |
| 低パフォーマンス時最大 | 1500×1500 px |

### 動作
- クライアントがビューポートサイズを`viewport`メッセージで通知
- サーバーがAOI矩形を計算（ビューポート×0.6 + マージン200px）
- AOI外のプレイヤーは`p`配列から除外
- AOI外→内に移動したプレイヤーはフルトレイル(`ft=1`)で同期
- ミニマップ・テリトリーはAOI無関係（全員に送信）

---

## 20. ミニマップ

### ビットマップ

| 項目 | 値 |
|:-----|:---|
| サイズ | 30×30 px |
| 形式 | パレットインデックス (1バイト/ピクセル) |
| 圧縮 | zlib deflate (level 6) |
| 送信形式 | Base64エンコード |

### 送信頻度（動的）

| プレイヤー数 | フレーム間隔 | 約時間 |
|:-------------|:------------|:-------|
| ≤5人 | 200フレーム | 約5秒 |
| 6-15人 | 400フレーム | 約10秒 |
| 16人+ | 600フレーム | 約15秒 |

### ミニマップデータ構造

```javascript
{
  tb: {
    bm: "<Base64 gzip bitmap>",
    cp: { "1": "#ff0000", "2": "#00ff00" },  // カラーパレット
    sz: 30,
    flags: [{ f: "🇯🇵", x: 1200, y: 800 }]  // チーム旗位置
  },
  pl: [[1200, 800, 1], [2400, 1600, 2]]  // [x, y, colorIndex]
}
```

### 履歴

- 20秒毎にスナップショット保存
- ラウンド終了時に`minimapHistory`として全履歴を送信
- クライアントでパラパラ漫画再生（400ms間隔、往復）

### チーム旗

- テリトリー占有率 ≥ 2%のチームに旗を配置
- 位置: テリトリークラスタの重心

---

## 21. クライアント描画

### レンダリングパイプライン

```
1. FPS監視 → パフォーマンスモード自動切替
2. プレイヤー位置補間 (lerp @ 12px/s)
3. カメラ追従（ZOOMレベル 0.8）
4. パーティクル更新
5. Canvas描画（ワールド座標系、0.8倍スケール）
```

### 描画順序

```
1. 背景 (#0f172a)
2. グリッド線 (50px間隔、rgba(255,255,255,0.03))
3. 障害物 (#475569)
4. ギア（回転 + 3D歯車エフェクト + 占領ゲージ）
5. テリトリー（色別バッチ、0.3 alpha + shadow blur）
   - 自分の領地: ピンク (#ff69b4) で表示（SOLO時）
6. トレイル（Catmull-Romスプライン or 直線）
7. プレイヤー本体（円 + 絵文字 + 名前）
   - チェーン候補: 緑色パルスリング + 🔗 アイコン
   - チェーン接続線: 白い破線
8. パーティクル
9. ミニマップ（右上54×54px）
10. HUD（スコア、リーダーボード、キルフィード）
11. チームチャットパネル / バッジ
```

### トレイル描画

**高パフォーマンス:**
- Catmull-Romスプライン（4セグメント/カーブ）
- 3層レンダリング: 影(黒0.3) → メイン(プレイヤー色) → ハイライト(白0.4-0.7)
- シャドウブラー有効
- ブースト時: レインボーグラデーション + 脈動オーラ + スピードライン

**低パフォーマンス:**
- 直線lineTo
- 単色描画
- シャドウブラー無効
- ブースト時: 黄色単色

### パーティクルシステム

| 項目 | 値 |
|:-----|:---|
| 最大数 | 500 |
| 種類 | トレイルパーティクル、インパクトバースト |
| 物理 | 速度、重力、減衰（ライフフェードアウト） |
| 低パフォーマンス時 | 無効 |
| 描画最適化 | バッチ save/restore（ループ外で1回） |

### 死亡演出
- 2秒かけてフェードアウト
- 6πラジアン回転
- ドクロ絵文字表示

### ギア描画

```javascript
drawGear(gear) {
  // 回転アニメーション
  gear.angle += gear.speed * dt

  // 本体: 円 + 歯車の歯（三角形）
  // 占領中: 円弧ゲージ（capturePercent）
  // 占領完了: チーム色で塗りつぶし + チーム名
}
```

---

## 22. パフォーマンス制御

### モード

| モード | 条件 | 効果 |
|:-------|:-----|:-----|
| `high` | 手動選択 | フルエフェクト |
| `low` | 手動 or FPS<35 or 10人+ | エフェクト削減 |
| `auto` | デフォルト | FPSに応じて自動切替 |

### 低パフォーマンスモードの変更点

| 項目 | 高 | 低 |
|:-----|:---|:---|
| トレイル描画 | Catmull-Romスプライン | 直線 |
| シャドウブラー | あり | なし |
| パーティクル | あり（最大500） | なし |
| backdrop-filter | blur(5px) | なし |
| ミニマップ更新 | 1000ms | 2500ms |
| ブーストエフェクト | レインボー + オーラ | 黄色単色 |
| AOI最大サイズ | 無制限 | 1500×1500px |
| フォント | Yomogi | sans-serif |
| ミニマップ履歴再生 | あり | なし |
| CSSクラス | - | `low-perf` をbodyに追加 |

### 自動切替ロジック

```javascript
if (avgFPS < 35) isLowPerformance = true;
if (avgFPS > 45) isLowPerformance = false;
if (playerCount >= 10) forceLowPerformance = true;
```

---

## 23. UI・画面構成

### 画面一覧

| 画面 | ID | 説明 |
|:-----|:---|:-----|
| ログイン | `#login-modal` | 名前入力、絵文字選択、チーム設定 |
| ゲーム | `#gameCanvas` + `#ui-layer` | メインゲーム画面 |
| 設定 | `#settings-modal` | パフォーマンスモード選択 |
| ランキング | `#history-modal` | 過去のランキング閲覧 |
| リザルト | `#result-modal` | ラウンド結果表示 |
| ボット認証 | `#bot-auth-modal` | CAPTCHA入力（動的生成） |
| 死亡 | `#death-screen` | 死因表示 + カウントダウン |
| AFK通知 | `#afk-notice` | AFK切断通知（5秒自動消去） |
| チームチャット | `#team-chat` | チームチャットパネル（展開/折畳） |
| チームチャットバッジ | `#team-chat-badge` | 折畳時のアイコンボタン |

### HUD要素

| 要素 | 位置 | 内容 |
|:-----|:-----|:-----|
| スコアパネル | 左上 | プレイヤー数、テリトリー%、タイマー |
| リーダーボード | 右上 | 上位5名(SOLO) or 上位2名(TEAM) |
| チームリーダーボード | 右上下 | 上位5チーム（TEAM時） |
| キルフィード | 下中央 | 直近2件の死亡/キャプチャメッセージ |
| モード表示 | 上中央 | SOLO / TEAM |
| ブーストゲージ | 下中央 | ブーストボタン + クールダウン |
| ミニマップ | 右上 | 54×54pxキャンバス |
| チームチャット | 左下 | 220px幅パネル or 44px丸バッジ |

### ログイン画面

- プレイヤー名入力（8文字制限）
- 国旗絵文字セレクタ（30ヶ国）
- チーム名入力（5文字制限、コードポイント単位）
- 既存チームドロップダウン
- アクティブプレイヤーアイコン表示
- 現在プレイ中人数表示

### リザルト画面

- タイトル: 「勝利！」(勝者) / 「ラウンド終了」(その他)
- ミニマップ履歴再生（スライダー + 再生/一時停止）
- ランキングテーブル（金/銀/銅 for 1-3位）
- チャット入力（15文字制限、1ラウンド1回）
- 次ラウンドモード表示 + チーム選択UI

### ニコニコ風コメント

- 右から左へスクロール（5秒）
- ランダム垂直位置
- プレイヤー色 + 名前表示
- 5秒後に自動削除

---

## 24. HTTP API

### 公開API

#### GET /api/rounds
過去のラウンド一覧取得。

**パラメータ:** `?hours=X` (過去X時間) or `?limit=N`

**レスポンス:**
```json
[
  {
    "id": 1,
    "mode": "SOLO",
    "played_at": "2026-02-23T12:00:00Z",
    "player_count": 8,
    "winner": "プレイヤー名"
  }
]
```

#### GET /api/round/:id
ラウンド詳細取得。

**レスポンス:** プレイヤーランキング、チームランキング、ミニマップビットマップ

#### GET /api/player-stats
プレイヤー統計取得。

**パラメータ:** `?sort=best|total` & `?period=today|all`

**レスポンス:** 上位50名（ゲーム数、勝利数、合計スコア、キル数、平均値）

#### GET /api/team-stats
チーム統計取得。

**パラメータ:** `?sort=best|total` & `?period=today|all`

**レスポンス:** 上位50チーム

### 管理者API（認証必須）

| エンドポイント | メソッド | 説明 |
|:---------------|:---------|:-----|
| `/api/admin/login` | POST | ログイン（Cookie設定） |
| `/api/admin/logout` | POST | ログアウト |
| `/api/admin/check-session` | GET | セッション有効確認 |
| `/api/server-stats` | GET | 過去50ラウンド + 30日集計 |
| `/api/server-realtime` | GET | リアルタイムサーバー状態 |
| `/api/admin/reset-rankings` | POST | ランキング全削除 |
| `/api/admin/change-password` | POST | パスワード変更 |
| `/api/admin/swarm-toggle` | POST | スウォームモードON/OFF |
| `/api/docs` | GET | ドキュメントファイル一覧 |
| `/api/docs/:filename` | GET | マークダウンファイル取得 |

### 管理者認証

| 項目 | 値 |
|:-----|:---|
| 認証情報 | `admin-credentials.json` |
| セッション | メモリ内Map (24時間TTL) |
| ロックアウト | 15分内5回失敗でIPロック |
| Cookie | HttpOnly, SameSite=Strict |
| パスワードハッシュ | SHA256 |

### 静的ファイル配信

| 項目 | 値 |
|:-----|:---|
| ルート | `public_html/` |
| JS/CSSキャッシュ | 300秒 |
| セキュリティ | path.resolve()でディレクトリトラバーサル防止 |
| admin.html | セッション認証必須 |

---

## 25. 管理パネル

**アクセス:** `/admin.html`（未認証時はログインにリダイレクト）

### リアルタイムダッシュボード

- プレイヤー数（総数 + アクティブ）
- ラウンド状態 + 残り時間
- テリトリー数 + バージョン
- CPU使用率 + ロードアベレージ
- メモリ（ヒープ + システム）+ ラグ統計
- 帯域（送信/受信、レート）
- スウォームモード状態

### 統計ページ

- 直近50ラウンド（勝者付き）
- ラウンド詳細（プレイヤー/チームランキング、ミニマップ）
- プレイヤー集計統計
- チーム集計統計
- サーバー負荷履歴（30日間日次集計）

### 管理操作

- 全ランキングリセット（テーブルtruncate）
- 管理者パスワード変更
- スウォームモードトグル
- ドキュメント閲覧

---

## 26. データベーススキーマ

### rounds

```sql
CREATE TABLE rounds (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mode VARCHAR(20),
  played_at TIMESTAMP,
  player_count INT
);
```

### player_rankings

```sql
CREATE TABLE player_rankings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  round_id INT,
  rank_position INT,
  player_name VARCHAR(255),
  team VARCHAR(255),
  emoji VARCHAR(10),
  score DECIMAL(10,2),
  kills INT,
  FOREIGN KEY (round_id) REFERENCES rounds(id)
);
```

### team_rankings

```sql
CREATE TABLE team_rankings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  round_id INT,
  rank_position INT,
  team_name VARCHAR(255),
  score DECIMAL(10,2),
  kills INT,
  FOREIGN KEY (round_id) REFERENCES rounds(id)
);
```

### round_minimaps

```sql
CREATE TABLE round_minimaps (
  round_id INT PRIMARY KEY,
  minimap_data MEDIUMBLOB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (round_id) REFERENCES rounds(id)
);
```

### afk_timeouts

```sql
CREATE TABLE afk_timeouts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ip_address VARCHAR(45),
  cf_country VARCHAR(5),
  cf_ray VARCHAR(50),
  timeout_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ip (ip_address),
  INDEX idx_timeout (timeout_at),
  INDEX idx_country (cf_country)
);
```

### round_stats

```sql
CREATE TABLE round_stats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mode VARCHAR(20),
  round_duration_sec INT,
  player_count INT,
  active_player_count INT,
  bytes_sent BIGINT,
  send_rate_bps INT,
  cpu_percent DECIMAL(5,2),
  avg_lag_ms DECIMAL(8,2),
  -- 内訳フィールド (players, territory, minimap, teams, base)
  -- メモリフィールド (heap, rss, external)
  -- システムメモリフィールド
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 27. パフォーマンス最適化

### 適用済み最適化一覧

#### 高優先度

| # | 最適化 | 効果 |
|:--|:-------|:-----|
| 1 | WebSocket圧縮: windowBits 15, threshold 512B, level 4 | 帯域削減 |
| 2 | html2canvas CDN削除 | 200+KB静的ロード削減 |
| 3 | パーティクル: ctx.save/restoreをバッチ処理 | CPU削減 |
| 4 | ギア衝突: Math.sqrt排除（distSq比較）、定数キャッシュ | CPU削減 |
| 5 | トレイルエンコード: プレイヤー毎にフルバイナリキャッシュ | CPU削減 |
| 6 | テリトリーワイプ: territoryRectsベーススキャン | O(n²)→O(n) |
| 7 | rebuildTerritoryRects: 1D Uint8Array、数値キーMap | メモリ/GC改善 |
| 8 | attemptCapture: インラインBFS、Uint8Array、インデックスキュー | CPU/GC改善 (30-40%高速化) |
| 9 | 衝突判定の空間分割: 30pxセル空間ハッシュグリッド | O(N²)→O(N)、4.75-5.5倍高速化 |

#### 中優先度

| # | 最適化 | 効果 |
|:--|:-------|:-----|
| 10 | DocumentFragment: ログインアイコンバッチDOM更新 | DOM操作削減 |
| 11 | pixelTrailバッチ圧縮: slice()でshift()排除 | 50%高速化 |
| 12 | playerScoresインクリメンタル更新 | フルリビルド排除 |
| 13 | backdrop-filter: 低パフォーマンス時無効化 | GPU負荷削減 |
| 14 | スコアボード: 静的フィールドサーバー側除外 | 帯域約55%削減 |
| 15 | ミニマップ動的頻度: プレイヤー数に応じて変更 | 帯域削減 |
| 16 | レインボーグラデーション: 事前計算hue値 | 文字列生成削減 |

#### 低優先度

| # | 最適化 | 効果 |
|:--|:-------|:-----|
| 17 | findNearbyEnemies: ティックキャッシュ + distSq | CPU削減 |
| 18 | buildTerritoryBinary: 数値キー (y*100000+x) | 文字列生成削減 |
| 19 | 空関数削除 + getUniqueColor: Setで O(1) | コード整理 |
| 20 | Intl.Segmenterキャッシュ + HSL事前計算 | 初期化最適化 |
| 21 | ピンク色予約: hue 320-340除外（自領地表示用） | 色衝突防止 |

### ベンチマークモジュール (bench-monitor.js)

`node server.v5.js bench` で有効化。

| 計測項目 | ターゲット |
|:---------|:-----------|
| ゲームループ処理時間 | < 50ms |
| ブロードキャスト処理時間 | < 25ms |
| 内訳: playerUpdate, collision, capture | 個別計測 |
| avg, max, P95, P99 | 統計値 |
| tick超過回数 | 0を目標 |
| メモリ使用量 | heap, RSS, external |

---

## 時系列フロー

### 接続〜ゲーム開始

```
Time    | Event              | C→S          | S→C
--------|--------------------|--------------|-----------------
0.00s   | WebSocket接続      | -            | -
0.01s   | Cookie検証         | (Cookie)     | -
0.05s   | 初期データ受信     | -            | init (JSON)
0.10s   | 既存プレイヤー情報 | -            | pm (JSON)
0.15s   | ログイン画面表示   | -            | -
3.00s   | ゲーム参加         | join (JSON)  | -
        | [認証要の場合]     | -            | bot_auth_required
        | CAPTCHA回答        | bot_auth_response | bot_auth_success + sessionToken
3.05s   | 参加承認           | -            | pm (JSON, 全員へ)
3.10s   | 状態更新開始       | -            | s (MessagePack)
```

### 通常プレイ中

```
Time    | Event              | C→S              | S→C
--------|--------------------|------------------|-----------------
0.00s   | 移動入力           | [127] (1byte)    | -
0.025s  | 状態更新           | -                | s {p:[{rb:差分}]}
0.50s   | ブースト発動       | [127, 1] (2byte) | -
0.525s  | 状態更新           | -                | s {p:[{bs:20}]}
3.00s   | スコアボード更新   | -                | s {sb:[...]}
5.00s   | ミニマップ更新     | -                | s {mm:{...}}
```

### チーム連結

```
Time    | Event              | C→S                          | S→C
--------|--------------------|---------|---------------------------------
0.00s   | 候補表示           | -                            | s {p:[{cn:[456]}]}
0.50s   | 連結タップ         | chain_attach {targetId:456}  | -
0.55s   | 連結確認           | -                            | s {p:[{cr:1},{cr:2,cl:42}]}
5.00s   | 離脱               | [127, 1] (boost)             | -
```

### ラウンド終了

```
Time    | Event              | C→S          | S→C
--------|--------------------|--------------|-----------------
120.0s  | 時間切れ           | -            | round_end (JSON)
120.1s  | リザルト画面表示   | -            | -
125.0s  | チャット送信       | chat (JSON)  | chat (JSON, 全員)
135.0s  | 次ラウンド開始     | -            | round_start (JSON)
```

---

## 既知の制限事項

| 項目 | 制限 |
|:-----|:-----|
| 最大プレイヤー数 | ハードリミットなし（100人で安定動作確認済み） |
| ミニマップ解像度 | 固定30×30px |
| トレイル差分精度 | ±128px（Int8） |
| ボット認証有効期間 | Cookie: 24時間、IP検証: 1時間、AFK検知窓: 5分 |
| CAPTCHAコード | 3桁 (100-999) |
| チーム名 | 最大5 Unicodeコードポイント |
| プレイヤー名 | 最大8 Unicodeコードポイント |
| チャット | 1ラウンド1回、15文字制限 |
| チームチャット | 20文字制限、50件保持 |
| ビューポート | 最大540×1020px（超過でキック） |
| スケーリング | シングルサーバー（水平スケーリング非対応） |

---

## v11 変更履歴 (v10 → v11)

### 新機能

- **Cookie認証セッション**: CAPTCHA認証成功時にcrypto.randomBytesで64文字hexトークンを生成し、`bot_auth_session` Cookieとして24時間有効で発行。次回接続時にWebSocket Upgradeリクエストのcookieヘッダーから検証し、有効ならCAPTCHAをスキップ
- **チームチャットデフォルト状態変更**: チーム戦参加時にチャットパネルがアイコン（バッジ）状態で開始するよう変更。従来は自動展開だった

### セクション追加

- **チーム連結（チェーン）**: TEAMモードでのリーダー・フォロワー連結メカニクスを独立セクションとして記載（15章）
- **チームチャット**: 3タブ構成のチームチャットシステムを独立セクションとして記載（16章）
- **スウォームモード**: 50体ボット連携攻撃モードを独立セクションとして記載（17章）

### 仕様の明確化

- プレイヤーIDをint (16bit shortId)に統一（UUID/フルID廃止の反映）
- initメッセージの`gs`フィールド（GridSize）を明記
- `bot_auth_success`メッセージに`sessionToken`フィールドを追加
- `player_death`メッセージに`team`フィールドを追加
- WebSocket切断コード一覧を拡充（4001, 4002, 4003を追加）
- ブロードキャスト間隔の表記を正しく25ms (40fps)に統一
- ミニマップ送信頻度をフレーム数ベースに修正（200/400/600フレーム）
- フィーチャーフラグ一覧を追加（HUMAN_VS_BOT, HELL_OBSTACLES, GEAR_ENABLED, NO_SUICIDE）
- ベンチマークモジュールの計測項目を記載

---

**End of Document v11.0.0**

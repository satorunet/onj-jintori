/**
 * server.js - メインエントリーポイント
 * モジュール統合・サーバー起動
 * 
 * Version: 5.0.0
 * Date: 2026-01-06
 */

const fs = require('fs');
const https = require('https');
const WebSocket = require('ws');

// モジュール読み込み
const config = require('./modules/config');
const api = require('./modules/api');
const game = require('./modules/game');
const network = require('./modules/network');
const stats = require('./modules/stats');
const cpu = require('./modules/cpu');
const botAuth = require('./modules/bot-auth');
const msgpack = require('./msgpack.js');
const bench = require('./modules/bench-monitor');

const {
    PORT, SSL_KEY_PATH, SSL_CERT_PATH, SERVER_VERSION,
    GAME_DURATION, PLAYER_SPEED, BOOST_SPEED_MULTIPLIER, BOOST_DURATION, BOOST_COOLDOWN, JET_CHARGE_TIME,
    GRID_SIZE, NO_SUICIDE, RESPAWN_TIME, AFK_DEATH_LIMIT,
    CHAIN_SPACING, CHAIN_MAX_LENGTH, CHAIN_PATH_HISTORY_SIZE,
    SWARM_BOT_COUNT, SWARM_CHAIN_SPACING, SWARM_TEAM_NAME, SWARM_TEAM_COLOR,
    SWARM_ATTACK_RANGE, SWARM_REJOIN_TIMEOUT,
    GAME_MODES, FORCE_TEAM, HUMAN_VS_BOT, DEBUG_MODE, STATS_MODE, TEAM_COLORS, TANUKI_TEAM_NAME,
    state, bandwidthStats, dbPool
} = config;

// ============================================================
// サーバー初期化
// ============================================================
let server;
try {
    const options = {
        key: fs.readFileSync(SSL_KEY_PATH),
        cert: fs.readFileSync(SSL_CERT_PATH)
    };
    server = https.createServer(options, api.handleHttpRequest);
    console.log('[SERVER] SSL enabled');
} catch (e) {
    console.warn('[SERVER] SSL Certs not found, falling back to HTTP');
    const http = require('http');
    server = http.createServer(api.handleHttpRequest);
}

// WebSocketサーバー
const wss = new WebSocket.Server({
    server,
    perMessageDeflate: {
        zlibDeflateOptions: { chunkSize: 1024, memLevel: 7, level: 4 },
        zlibInflateOptions: { chunkSize: 10 * 1024 },
        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        serverMaxWindowBits: 15,
        concurrencyLimit: 10,
        threshold: 512
    }
});

// モジュール間依存関係を設定
game.setWss(wss);
game.setMsgpack(msgpack);
network.setDependencies(game, msgpack, wss);
stats.setup({ config, state, bandwidthStats, dbPool });
cpu.setDependencies(game);

// WebSocket接続維持のためのping送信（30秒毎）
// waiting状態のプレイヤーの接続が切れるのを防ぐ
setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        }
    });
}, 30000);

// サーバー起動時刻を記録
const serverStartTime = Date.now();

// ============================================================
// ゲームループ（50ms間隔）
// ============================================================
let lastTime = Date.now();
let gearCaptureFrame = 0;  // 歯車占領チェック用フレームカウンタ
setInterval(() => {
    const tickStart = bench.startTimer();
    const now = Date.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    if (!state.roundActive) return;

    // 時間経過
    if (Math.floor(now / 1000) > Math.floor((now - dt * 1000) / 1000)) {
        state.timeRemaining--;
        if (state.timeRemaining <= 0) endRound();
        
    }

    // 回転歯車の更新
    if (state.gears && state.gears.length > 0) {
        // 前フレームの歯車セルをクリア
        if (state._gearCells) {
            state._gearCells.forEach(({x, y}) => {
                if (y >= 0 && y < state.GRID_ROWS && x >= 0 && x < state.GRID_COLS) {
                    if (state.worldGrid[y][x] === 'obstacle_gear') state.worldGrid[y][x] = null;
                }
            });
        }
        state._gearCells = [];

        state.gears.forEach(g => {
            g.angle += g.speed * dt;

            // 定数をキャッシュ（初回のみ計算）
            if (!g._cached) {
                g._gridR = Math.ceil(g.radius / GRID_SIZE);
                g._innerSq = (g.radius * 0.45) ** 2;
                g._outerSq = (g.radius * 1.1) ** 2;
                g._tw = g.toothWidth || 0.2;
                g._toothAngle = (2 * Math.PI) / g.teeth;
                g._cached = true;
            }

            const gridR = g._gridR;
            const gcx = Math.round(g.cx / GRID_SIZE);
            const gcy = Math.round(g.cy / GRID_SIZE);
            const innerSq = g._innerSq;
            const outerSq = g._outerSq;
            const toothAngle = g._toothAngle;
            const twThreshold = toothAngle * g._tw;

            for (let dy = -gridR - 2; dy <= gridR + 2; dy++) {
                const gy = gcy + dy;
                if (gy < 0 || gy >= state.GRID_ROWS) continue;
                for (let dx = -gridR - 2; dx <= gridR + 2; dx++) {
                    const gx = gcx + dx;
                    if (gx < 0 || gx >= state.GRID_COLS) continue;

                    const px = gx * GRID_SIZE + GRID_SIZE / 2 - g.cx;
                    const py = gy * GRID_SIZE + GRID_SIZE / 2 - g.cy;
                    const distSq = px * px + py * py;

                    // 距離二乗比較で中心ハブと外側を除外
                    if (distSq < innerSq || distSq >= outerSq) continue;

                    // 歯の部分のみ当たり判定あり
                    const angle = Math.atan2(py, px) - g.angle;
                    const mod = ((angle % toothAngle) + toothAngle) % toothAngle;
                    if (mod < twThreshold) {
                        if (!state.worldGrid[gy][gx] || state.worldGrid[gy][gx] === null) {
                            state.worldGrid[gy][gx] = 'obstacle_gear';
                            state._gearCells.push({x: gx, y: gy});
                        }
                    }
                }
            }
        });
    }

    // 歯車占領チェック（10フレームに1回 = 約500ms間隔）
    gearCaptureFrame++;
    if (state.gears && state.gears.length > 0 && gearCaptureFrame % 10 === 0) {
        const isTeamMode = GAME_MODES[state.currentModeIdx] === 'TEAM';
        state.gears.forEach((g, gi) => {
            const safeR = g.radius * 0.35;  // 占領判定は内側の円で（確実に100%到達可能に）
            const gridR = Math.ceil(safeR / GRID_SIZE);
            const gcx = Math.round(g.cx / GRID_SIZE);
            const gcy = Math.round(g.cy / GRID_SIZE);
            const ownerCounts = {};  // key: ownerId or teamName → count
            const ownerColors = {};  // key → color
            const ownerNames = {};   // key → display name
            let totalCells = 0;

            for (let dy = -gridR; dy <= gridR; dy++) {
                for (let dx = -gridR; dx <= gridR; dx++) {
                    const gx = gcx + dx;
                    const gy = gcy + dy;
                    if (gy < 0 || gy >= state.GRID_ROWS || gx < 0 || gx >= state.GRID_COLS) continue;
                    const px = gx * GRID_SIZE + GRID_SIZE / 2 - g.cx;
                    const py = gy * GRID_SIZE + GRID_SIZE / 2 - g.cy;
                    const dist = Math.sqrt(px * px + py * py);
                    if (dist >= safeR) continue;

                    totalCells++;
                    const cellVal = state.worldGrid[gy][gx];
                    if (!cellVal || cellVal === 'obstacle' || cellVal === 'obstacle_gear') continue;

                    const owner = state.players[cellVal];
                    if (!owner) continue;

                    // チーム戦: チーム名で集計、個人戦: プレイヤーIDで集計
                    const key = (isTeamMode && owner.team) ? owner.team : cellVal;
                    ownerCounts[key] = (ownerCounts[key] || 0) + 1;
                    if (!ownerColors[key]) ownerColors[key] = owner.color;
                    if (!ownerNames[key]) {
                        ownerNames[key] = (isTeamMode && owner.team) ? owner.team : owner.name;
                    }
                }
            }

            // 最多占有者を算出
            let topKey = null, topCount = 0;
            for (const key in ownerCounts) {
                if (ownerCounts[key] > topCount) {
                    topCount = ownerCounts[key];
                    topKey = key;
                }
            }

            const topPercent = totalCells > 0 ? Math.floor((topCount / totalCells) * 100) : 0;

            // captureInfo更新
            if (topKey && topPercent > 0) {
                g.captureInfo = {
                    topOwner: topKey,
                    topColor: ownerColors[topKey],
                    topName: ownerNames[topKey],
                    topPercent
                };
            } else {
                g.captureInfo = null;
            }

            // 100%占領チェック
            if (topPercent === 100 && topKey) {
                const prevCapturedBy = g.capturedBy;
                if (prevCapturedBy !== topKey) {
                    g.capturedBy = topKey;
                    g.capturedColor = ownerColors[topKey];
                    g.capturedName = ownerNames[topKey];
                    game.broadcast({
                        type: 'gear_captured',
                        gi: gi,
                        name: ownerNames[topKey],
                        color: ownerColors[topKey]
                    });
                }
            } else if (topPercent < 100) {
                // 100%未満なら占領解除
                if (g.capturedBy) {
                    g.capturedBy = null;
                    g.capturedColor = null;
                    g.capturedName = null;
                }
            }
        });
    }

    // ===== 空間グリッド構築（軌跡カット判定 O(N²) → O(N) 最適化） =====
    const TRAIL_CELL = 30;
    const trailCellCols = Math.ceil(state.WORLD_WIDTH / TRAIL_CELL) + 1;
    const trailSpatial = new Map();

    Object.values(state.players).forEach(tp => {
        if (tp.state !== 'active' || tp.trail.length === 0) return;
        // 各trailセグメントを空間セルに登録
        for (let i = 0; i < tp.trail.length - 1; i++) {
            const x1 = tp.trail[i].x, y1 = tp.trail[i].y;
            const x2 = tp.trail[i + 1].x, y2 = tp.trail[i + 1].y;
            const minCx = Math.floor(Math.min(x1, x2) / TRAIL_CELL);
            const maxCx = Math.floor(Math.max(x1, x2) / TRAIL_CELL);
            const minCy = Math.floor(Math.min(y1, y2) / TRAIL_CELL);
            const maxCy = Math.floor(Math.max(y1, y2) / TRAIL_CELL);
            for (let cy = minCy; cy <= maxCy; cy++) {
                for (let cx = minCx; cx <= maxCx; cx++) {
                    const key = cy * trailCellCols + cx;
                    let cell = trailSpatial.get(key);
                    if (!cell) { cell = []; trailSpatial.set(key, cell); }
                    cell.push({ tp, x1, y1, x2, y2 });
                }
            }
        }
        // 最終セグメント: trail末尾 → 現在位置
        const last = tp.trail[tp.trail.length - 1];
        const lx1 = last.x, ly1 = last.y, lx2 = tp.x, ly2 = tp.y;
        const lMinCx = Math.floor(Math.min(lx1, lx2) / TRAIL_CELL);
        const lMaxCx = Math.floor(Math.max(lx1, lx2) / TRAIL_CELL);
        const lMinCy = Math.floor(Math.min(ly1, ly2) / TRAIL_CELL);
        const lMaxCy = Math.floor(Math.max(ly1, ly2) / TRAIL_CELL);
        for (let cy = lMinCy; cy <= lMaxCy; cy++) {
            for (let cx = lMinCx; cx <= lMaxCx; cx++) {
                const key = cy * trailCellCols + cx;
                let cell = trailSpatial.get(key);
                if (!cell) { cell = []; trailSpatial.set(key, cell); }
                cell.push({ tp, x1: lx1, y1: ly1, x2: lx2, y2: ly2 });
            }
        }
    });

    // ===== チェーン物理プレパス（リーダー→末尾の順で処理） =====
    Object.values(state.players).forEach(leader => {
        if (leader.state !== 'active' || leader.chainRole !== 'leader') return;
        // チェーンをリーダーから末尾まで順に辿り、物理演算を適用
        let anchor = leader;
        let current = anchor;
        while (current.chainFollowers && current.chainFollowers.length > 0) {
            const followerId = current.chainFollowers[0];
            const follower = state.players[followerId];
            if (!follower || follower.state !== 'active') break;
            moveChainFollower(follower, anchor, dt);
            anchor = follower;
            current = follower;
        }
    });

    // プレイヤー更新
    const playerUpdateStart = bench.startTimer();
    Object.values(state.players).forEach(p => {
        if (p.state !== 'active') return;
        if (p.id === 'DEBUG_FULL_OWNER' || p.id === 'DEBUG_ENEMY') return;

        const prevGx = game.toGrid(p.x);
        const prevGy = game.toGrid(p.y);
        let gx, gy;

        // チェーンフォロワー: 物理演算は上のプレパスで処理済み
        if (p.chainRole === 'follower') {
            const leader = state.players[p.chainLeaderId];
            if (!leader || leader.state !== 'active' || leader.chainRole === 'none') {
                detachFromChain(p);
            } else {
                // 位置はプレパスで更新済み、ここではgx/gyの計算のみ
                gx = game.toGrid(p.x);
                gy = game.toGrid(p.y);

                // フォロワーの壁チェック（スウォームBOTは壁免除）
                if (!p.isSwarmBot && (p.x < 0 || p.x >= state.WORLD_WIDTH || p.y < 0 || p.y >= state.WORLD_HEIGHT)) {
                    killPlayer(p.id, "壁に激突");
                    return;
                }
                // フォロワーの障害物チェック（スウォームBOTは障害物免除）
                if (!p.isSwarmBot) {
                    const cellVal = state.worldGrid[gy] && state.worldGrid[gy][gx];
                    if (cellVal === 'obstacle') {
                        killPlayer(p.id, "障害物に激突");
                        return;
                    }
                    if (cellVal === 'obstacle_gear') {
                        const isTeamMode = GAME_MODES[state.currentModeIdx] === 'TEAM';
                        const myKey = (isTeamMode && p.team) ? p.team : p.id;
                        const ownedGear = state.gears && state.gears.some(g => g.capturedBy === myKey);
                        if (!ownedGear) {
                            killPlayer(p.id, "歯車に巻き込まれた");
                            return;
                        }
                    }
                }
            }
        }

        if (p.chainRole !== 'follower') {
        // AFK自動移動（hasMovedSinceSpawnは変更しない＝AFK判定に影響しない）
        if (!p.hasMovedSinceSpawn && !p.autoRun && p.spawnTime && (now - p.spawnTime > 1000)) {
            const angle = Math.random() * Math.PI * 2;
            p.dx = Math.cos(angle);
            p.dy = Math.sin(angle);
            p.autoRun = true;
        }

        // ブースト/ジェット状態の判定
        const personalBoosting = p.boostUntil && now < p.boostUntil;
        const isJetting = p.jetUntil && now < p.jetUntil;
        const isBoosting = state.highSpeedEvent || personalBoosting || isJetting;
        let currentSpeed;
        if (isJetting) {
            currentSpeed = PLAYER_SPEED * BOOST_SPEED_MULTIPLIER * 2;  // ジェット（超高速）
        } else if (state.highSpeedEvent && personalBoosting) {
            currentSpeed = PLAYER_SPEED * BOOST_SPEED_MULTIPLIER * 2;  // マッハブースト（イベント時）
        } else if (isBoosting) {
            currentSpeed = PLAYER_SPEED * BOOST_SPEED_MULTIPLIER;
        } else {
            currentSpeed = PLAYER_SPEED;
        }
        p.boosting = isBoosting;
        p.jetting = isJetting;
        p.machBoosting = isJetting || (state.highSpeedEvent && personalBoosting);  // ジェット/マッハ状態フラグ

        // ジェットチャージ追跡: ブースト使用可能状態の継続時間
        const boostReady = !personalBoosting && !isJetting && (!p.boostCooldownUntil || now >= p.boostCooldownUntil);
        if (boostReady) {
            if (!p.boostReadySince) p.boostReadySince = now;
        } else {
            p.boostReadySince = 0;
        }

        let nextX = p.x + p.dx * currentSpeed * dt;
        let nextY = p.y + p.dy * currentSpeed * dt;

        // CPU緊急方向転換: 移動先で自分の軌跡と交差しそうなら別方向に曲がる（停止はしない）
        if (p.isCpu && p.trail && p.trail.length > 3) {
            const checkSelfHit = (px, py) => {
                for (let i = 0; i < p.trail.length - 3; i++) {
                    if (game.getDistSq(px, py, p.trail[i].x, p.trail[i].y, p.trail[i + 1].x, p.trail[i + 1].y) < 144) {
                        return true;
                    }
                }
                return false;
            };
            if (checkSelfHit(nextX, nextY)) {
                // 緊急方向転換: 複数方向を試す（必ずどれかの方向に動き続ける）
                const candidates = [
                    { dx: -p.dy, dy: p.dx },   // 90度左
                    { dx: p.dy, dy: -p.dx },    // 90度右
                    { dx: -p.dx, dy: -p.dy },   // 180度反転
                ];
                for (const c of candidates) {
                    const tryX = p.x + c.dx * currentSpeed * dt;
                    const tryY = p.y + c.dy * currentSpeed * dt;
                    if (!checkSelfHit(tryX, tryY) &&
                        tryX >= 0 && tryX < state.WORLD_WIDTH &&
                        tryY >= 0 && tryY < state.WORLD_HEIGHT) {
                        p.dx = c.dx;
                        p.dy = c.dy;
                        nextX = tryX;
                        nextY = tryY;
                        break;
                    }
                }
                // どの方向も危険な場合はそのまま進む（人間と同じ条件）
            }
        }

        // 壁チェック
        if (nextX < 0 || nextX >= state.WORLD_WIDTH || nextY < 0 || nextY >= state.WORLD_HEIGHT) {
            // スウォームBOTは壁で死なず方向転換
            if (p.isSwarmBot) {
                if (nextX < 0) p.dx = Math.abs(p.dx) || 0.7;
                if (nextX >= state.WORLD_WIDTH) p.dx = -Math.abs(p.dx) || -0.7;
                if (nextY < 0) p.dy = Math.abs(p.dy) || 0.7;
                if (nextY >= state.WORLD_HEIGHT) p.dy = -Math.abs(p.dy) || -0.7;
                nextX = Math.max(10, Math.min(state.WORLD_WIDTH - 10, nextX));
                nextY = Math.max(10, Math.min(state.WORLD_HEIGHT - 10, nextY));
            } else {
                killPlayer(p.id, "壁に激突");
                return;
            }
        }

        const isInvuln = !p.hasMovedSinceSpawn && !p.autoRun;
        gx = game.toGrid(nextX);
        gy = game.toGrid(nextY);

        // 障害物チェック（通常障害物 + 回転歯車） ※スウォームBOTは障害物無視
        const cellVal = state.worldGrid[gy] && state.worldGrid[gy][gx];
        if (!isInvuln && !p.isSwarmBot && (cellVal === 'obstacle' || cellVal === 'obstacle_gear')) {
            if (cellVal === 'obstacle_gear') {
                // 占領済みの歯車なら死なない
                const isTeamMode = GAME_MODES[state.currentModeIdx] === 'TEAM';
                const myKey = (isTeamMode && p.team) ? p.team : p.id;
                const ownedGear = state.gears && state.gears.some(g => g.capturedBy === myKey);
                if (ownedGear) {
                    // 占領者は歯車を通過可能（何もしない）
                } else {
                    killPlayer(p.id, "歯車に巻き込まれた");
                    return;
                }
            } else {
                killPlayer(p.id, "障害物に激突");
                return;
            }
        }

        p.x = nextX;
        p.y = nextY;

        // チェーンリーダー: 経路記録
        if (p.chainRole === 'leader' && p.chainPathHistory) {
            const last = p.chainPathHistory.length > 0 ? p.chainPathHistory[p.chainPathHistory.length - 1] : null;
            if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 5) {
                p.chainPathHistory.push({ x: p.x, y: p.y });
                if (p.chainPathHistory.length > CHAIN_PATH_HISTORY_SIZE) p.chainPathHistory.shift();
            }
        }

        // 他プレイヤーとの相互作用
        if (!isInvuln) {
            // --- 正面衝突（全activeプレイヤーを走査、整数比較のみで高速） ---
            const allPlayers = Object.values(state.players);
            for (let pi = 0; pi < allPlayers.length; pi++) {
                const target = allPlayers[pi];
                if (target.id === p.id || target.state !== 'active') continue;
                if (p.team && target.team === p.team) {
                    continue;
                }
                const targetInvuln = (target.invulnerableUntil && now < target.invulnerableUntil);
                if (targetInvuln) continue;

                const tgx = game.toGrid(target.x);
                const tgy = game.toGrid(target.y);

                if (gx === tgx && gy === tgy) {
                    if (p.score <= 100 || target.score <= 100) {
                        if (p.score < target.score) { target.kills++; killPlayer(p.id, "正面衝突"); break; }
                        if (target.score < p.score) { p.kills++; killPlayer(target.id, "正面衝突"); continue; }
                    }
                    killPlayer(p.id, "正面衝突");
                    killPlayer(target.id, "正面衝突");
                    break;
                }
            }

            // --- 軌跡カット（空間グリッドで近傍セグメントのみ検索） ---
            if (p.state === 'active') {
                const qcx = Math.floor(p.x / TRAIL_CELL);
                const qcy = Math.floor(p.y / TRAIL_CELL);
                const hitTargets = new Set();

                for (let dcy = -1; dcy <= 1; dcy++) {
                    for (let dcx = -1; dcx <= 1; dcx++) {
                        const key = (qcy + dcy) * trailCellCols + (qcx + dcx);
                        const cell = trailSpatial.get(key);
                        if (!cell) continue;

                        for (let si = 0; si < cell.length; si++) {
                            const seg = cell[si];
                            const target = seg.tp;
                            if (target.id === p.id || target.state !== 'active') continue;
                            if (p.team && target.team === p.team) continue;
                            if (hitTargets.has(target.id)) continue;
                            const targetInvuln = (target.invulnerableUntil && now < target.invulnerableUntil);
                            if (targetInvuln) continue;

                            if (game.getDistSq(p.x, p.y, seg.x1, seg.y1, seg.x2, seg.y2) < 225) {
                                hitTargets.add(target.id);
                                killPlayer(target.id, `${p.name}に切られた`, true);
                                p.kills++;
                            }
                        }
                    }
                }
                // ライン切断kill後の陣地奪取: ループ外で一括処理 + rebuild1回
                if (hitTargets.size > 0) {
                    let totalStolen = 0;
                    for (let sy = 0; sy < state.GRID_ROWS; sy++) {
                        const row = state.worldGrid[sy];
                        for (let sx = 0; sx < state.GRID_COLS; sx++) {
                            if (hitTargets.has(row[sx])) {
                                row[sx] = p.id;
                                totalStolen++;
                            }
                        }
                    }
                    if (totalStolen > 0) p.score += totalStolen;
                    game.rebuildTerritoryRects();  // 1回だけ
                }
            }
        }

        if (p.state === 'dead') return;
        } // end if (p.chainRole !== 'follower')

        if (p.state === 'dead') return;

        // 領地獲得ロジック（セル飛ばし対策: prevGx,prevGy → gx,gy を1セルずつ走査）
        const stepDx = gx - prevGx, stepDy = gy - prevGy;
        const stepCount = Math.max(Math.abs(stepDx), Math.abs(stepDy));
        let captured = false;

        // 1セルずつ順に処理（通常は stepCount=0 or 1、ブースト時に2以上）
        for (let step = (stepCount === 0 ? 0 : 1); step <= Math.max(stepCount, 0); step++) {
            if (p.state === 'dead') break;

            const curGx = stepCount === 0 ? gx : Math.round(prevGx + stepDx * step / stepCount);
            const curGy = stepCount === 0 ? gy : Math.round(prevGy + stepDy * step / stepCount);

            const cellOwnerId = state.worldGrid[curGy] && state.worldGrid[curGy][curGx];
            const cellOwner = state.players[cellOwnerId];
            const isInsideOwn = (cellOwnerId === p.id) || (p.team && cellOwner && cellOwner.team === p.team);

            if (isInsideOwn) {
                if (p.gridTrail.length > 0) {
                    game.attemptCapture(p.id);
                    captured = true;  // 実際にcaptureした後のみフラグ立て
                }
                p.gridTrail = [];
                p.trail = [];
            } else if (!captured) {
                // 軌跡追加（領地を出る時の起点セルを記録）
                if (p.gridTrail.length === 0) {
                    // 直前のセルが自分の領地なら起点として追加
                    const prevStepGx = step <= 1 ? prevGx : Math.round(prevGx + stepDx * (step - 1) / stepCount);
                    const prevStepGy = step <= 1 ? prevGy : Math.round(prevGy + stepDy * (step - 1) / stepCount);
                    if (prevStepGx >= 0 && prevStepGx < state.GRID_COLS && prevStepGy >= 0 && prevStepGy < state.GRID_ROWS) {
                        if (state.worldGrid[prevStepGy][prevStepGx] === p.id ||
                            (p.team && state.players[state.worldGrid[prevStepGy][prevStepGx]]?.team === p.team)) {
                            p.gridTrail.push({ x: prevStepGx, y: prevStepGy });
                            p.trail.push({ x: prevStepGx * GRID_SIZE + GRID_SIZE / 2, y: prevStepGy * GRID_SIZE + GRID_SIZE / 2 });
                        }
                    }
                }

                const lastT = p.gridTrail.length > 0 ? p.gridTrail[p.gridTrail.length - 1] : null;
                if (lastT && (lastT.x !== curGx || lastT.y !== curGy)) {
                    // 自己交差チェック
                    let hitSelf = false;
                    if (!NO_SUICIDE && p.trail.length > 10) {
                        for (let i = 0; i < p.trail.length - 10; i++) {
                            if (game.getDistSq(p.x, p.y, p.trail[i].x, p.trail[i].y, p.trail[i + 1].x, p.trail[i + 1].y) < 64) {
                                hitSelf = true; break;
                            }
                        }
                    }
                    if (hitSelf) {
                        killPlayer(p.id, "自爆");
                    } else {
                        // 補間
                        const dx = curGx - lastT.x, dy = curGy - lastT.y;
                        const interpSteps = Math.max(Math.abs(dx), Math.abs(dy));
                        for (let i = 1; i <= interpSteps; i++) {
                            const igx = Math.round(lastT.x + dx * i / interpSteps);
                            const igy = Math.round(lastT.y + dy * i / interpSteps);
                            let prev = p.gridTrail[p.gridTrail.length - 1];
                            if (prev.x !== igx && prev.y !== igy) {
                                p.gridTrail.push({ x: igx, y: prev.y });
                                prev = p.gridTrail[p.gridTrail.length - 1];
                            }
                            if (prev.x !== igx || prev.y !== igy) p.gridTrail.push({ x: igx, y: igy });
                        }
                        p.trail.push({ x: p.x, y: p.y });
                    }
                } else if (!lastT) {
                    p.gridTrail.push({ x: curGx, y: curGy });
                    p.trail.push({ x: p.x, y: p.y });
                }
            }
        }
    });
    bench.recordBreakdown('playerUpdate', bench.endTimer(playerUpdateStart));
    bench.recordGameLoopTick(bench.endTimer(tickStart));

    // ベンチマークレポート（10秒ごと）
    const activeCount = Object.values(state.players).filter(p => p.state !== 'waiting').length;
    bench.printReport(activeCount);
}, 50);

// ============================================================
// プレイヤー管理関数
// ============================================================
function respawnPlayer(p, fullReset = false) {
    // プレイヤー状態のバリデーション
    if (!p) return;
    
    // 名前が不正な場合はリスポーンを拒否
    if (!p.name || p.name === '' || p.name === 'Unknown' || p.name.trim() === '') {
        console.log(`[REJECT] Invalid player name: "${p.name}" (ID: ${p.id}, IP: ${p.ip || 'unknown'})`);
        
        // プレイヤーを削除（接続も切断）
        if (p.ws && p.ws.readyState === 1 && !p.isCpu) {
            p.ws.close(4010, 'Invalid player state');
        }
        if (p.shortId) state.usedShortIds.delete(p.shortId);
        delete state.players[p.id];
        return;
    }
    
    // 色が設定されていない場合
    if (!p.color) {
        console.log(`[WARN] Player without color: ${p.name}, assigning new color`);
        p.color = game.getUniqueColor();
    }
    
    state.roundParticipants.add(p.id);
    p.state = 'active';
    p.hasBeenActive = true;  // アクティブにプレイした履歴を記録
    p.gridTrail = [];
    p.trail = [];
    p.dx = 0; p.dy = 0;
    p.spawnTime = Date.now();
    p.hasMovedSinceSpawn = false;
    p.autoRun = false;
    p.invulnerableUntil = p.isCpu ? 0 : Date.now() + 3000;
    p.boostCooldownUntil = Date.now() + 5000;  // スポーン後5秒間ブースト使用不可
    p.boostUntil = 0;
    p.jetUntil = 0;
    p.boostReadySince = 0;
    // チェーン状態リセット
    p.chainRole = 'none';
    p.chainLeaderId = null;
    p.chainFollowers = [];
    p.chainPathHistory = [];
    p.chainIndex = 0;
    p.chainHasInput = false;
    p.chainAnchorX = 0;
    p.chainAnchorY = 0;
    p.chainOffsetX = 0;
    p.chainOffsetY = 0;
    p.chainPrevId = null;
    p.chainPrevX = undefined;
    p.chainPrevY = undefined;
    if (fullReset) { p.score = 0; p.afkDeaths = 0; p.kills = 0; p.deaths = 0; }

    // 安全なスポーン位置を探す
    let safe = false;
    let teamCenter = null;
    if (p.team) {
        const teammates = Object.values(state.players).filter(op => op.id !== p.id && op.team === p.team && op.state === 'active');
        if (teammates.length > 0) teamCenter = { x: teammates[0].x, y: teammates[0].y };
    }

    const MIN_DEATH_DIST = 500;  // 死亡位置からの最低距離
    let bestCandidate = null;
    let bestDist = 0;

    for (let i = 0; i < 100; i++) {
        let tx, ty;
        if (teamCenter && i < 50) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 100 + Math.random() * 300;
            tx = Math.max(100, Math.min(state.WORLD_WIDTH - 100, teamCenter.x + Math.cos(angle) * dist));
            ty = Math.max(100, Math.min(state.WORLD_HEIGHT - 100, teamCenter.y + Math.sin(angle) * dist));
        } else {
            tx = Math.floor(Math.random() * (state.WORLD_WIDTH - 200) + 100);
            ty = Math.floor(Math.random() * (state.WORLD_HEIGHT - 200) + 100);
        }
        const gx = game.toGrid(tx), gy = game.toGrid(ty);
        let obs = false;
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                const sv = state.worldGrid[gy + dy] && state.worldGrid[gy + dy][gx + dx];
                if (sv === 'obstacle' || sv === 'obstacle_gear') obs = true;
            }
        }
        if (obs) continue;

        // 死亡位置からの距離をチェック
        const deathDist = (p.deathX !== undefined)
            ? Math.hypot(tx - p.deathX, ty - p.deathY) : Infinity;

        if (deathDist >= MIN_DEATH_DIST) {
            p.x = tx; p.y = ty; safe = true; break;
        }
        // 距離不足でも最良候補として保存
        if (deathDist > bestDist) {
            bestDist = deathDist;
            bestCandidate = { x: tx, y: ty };
        }
    }
    if (!safe && bestCandidate) { p.x = bestCandidate.x; p.y = bestCandidate.y; safe = true; }
    if (!safe) { p.x = 1000; p.y = 1000; }

    // 初期領地（約70px四方を維持）
    const spawnR = Math.max(3, Math.round(35 / GRID_SIZE));
    const startGx = game.toGrid(p.x), startGy = game.toGrid(p.y);
    let initialScore = 0;
    for (let dy = -spawnR; dy <= spawnR; dy++) {
        for (let dx = -spawnR; dx <= spawnR; dx++) {
            const gy = startGy + dy, gx = startGx + dx;
            if (gy >= 0 && gy < state.GRID_ROWS && gx >= 0 && gx < state.GRID_COLS) {
                const oldOwner = state.worldGrid[gy][gx];
                if (oldOwner === 'obstacle' || oldOwner === 'obstacle_gear') continue;
                if (oldOwner !== p.id) {
                    if (oldOwner && state.players[oldOwner]) state.players[oldOwner].score = Math.max(0, state.players[oldOwner].score - 1);
                    state.worldGrid[gy][gx] = p.id;
                    initialScore++;
                } else if (p.score === 0) initialScore++;
            }
        }
    }
    p.score += initialScore;
    game.rebuildTerritoryRects();

    // リスポーン時にチームログ履歴を送信
    if (p.team && p.ws && p.ws.readyState === 1) {
        const chatLog = state.teamChatLog[p.team] || [];
        const battleLog = state.teamBattleLog[p.team] || [];
        if (chatLog.length > 0 || battleLog.length > 0) {
            p.ws.send(JSON.stringify({ type: 'team_log_sync', chat: chatLog, battle: battleLog }));
        }
    }
}

// ============================================================
// チーム連結モード
// ============================================================
function getChainMemberIds(leader) {
    const members = [leader.id];
    let current = leader;
    while (current.chainFollowers && current.chainFollowers.length > 0) {
        const nextId = current.chainFollowers[0];
        const next = state.players[nextId];
        if (!next) break;
        members.push(nextId);
        current = next;
    }
    return members;
}

function breakEntireChain(leader) {
    let current = leader;
    while (current && current.chainFollowers && current.chainFollowers.length > 0) {
        const followerId = current.chainFollowers[0];
        const follower = state.players[followerId];
        current.chainFollowers = [];
        if (follower) {
            follower.chainRole = 'none';
            follower.chainLeaderId = null;
            follower.chainPrevId = null;
            follower.chainIndex = 0;
            follower.chainHasInput = false;
            follower.chainAnchorX = 0;
            follower.chainAnchorY = 0;
            follower.chainOffsetX = 0;
            follower.chainOffsetY = 0;
            follower.chainPrevX = undefined;
            follower.chainPrevY = undefined;
            // dx/dyは維持（切断後もそのまま動き続ける）
            current = follower;
        } else break;
    }
    leader.chainRole = 'none';
    leader.chainFollowers = [];
    leader.chainPathHistory = [];
}

function detachFromChain(player) {
    if (!player || player.chainRole === 'none') return;

    if (player.chainRole === 'leader') {
        breakEntireChain(player);
    } else if (player.chainRole === 'follower') {
        // 前のメンバーからこのフォロワーを外す
        for (const p of Object.values(state.players)) {
            if (p.chainFollowers && p.chainFollowers.includes(player.id)) {
                p.chainFollowers = p.chainFollowers.filter(fid => fid !== player.id);
                // このフォロワーに後続がいたら前のメンバーに繋ぎ直す
                if (player.chainFollowers && player.chainFollowers.length > 0) {
                    p.chainFollowers = [...p.chainFollowers, ...player.chainFollowers];
                    player.chainFollowers.forEach(fid => {
                        const f = state.players[fid];
                        if (f) {
                            f.chainIndex--;
                            f.chainPrevId = p.id;  // 前のメンバーを繋ぎ直し
                        }
                    });
                }
                break;
            }
        }
        // リーダーの連結が1人だけになったら解散
        const leaderId = player.chainLeaderId;
        if (leaderId) {
            const leader = state.players[leaderId];
            if (leader && leader.chainRole === 'leader') {
                const members = getChainMemberIds(leader);
                if (members.length <= 1) {
                    leader.chainRole = 'none';
                    leader.chainFollowers = [];
                    leader.chainPathHistory = [];
                }
            }
        }
    }
    player.chainRole = 'none';
    player.chainLeaderId = null;
    player.chainPrevId = null;
    player.chainFollowers = [];
    player.chainIndex = 0;
    player.chainHasInput = false;
    player.chainAnchorX = 0;
    player.chainAnchorY = 0;
    player.chainOffsetX = 0;
    player.chainOffsetY = 0;
    player.chainPrevX = undefined;
    player.chainPrevY = undefined;
    // dx/dyは維持（切断後もそのまま動き続ける）
}

// リーダーだけがチェーンから離脱し、次のメンバーを新リーダーに昇格
function leaderLeaveChain(leader) {
    if (!leader || leader.chainRole !== 'leader') return;
    if (!leader.chainFollowers || leader.chainFollowers.length === 0) return;

    const nextId = leader.chainFollowers[0];
    const next = state.players[nextId];

    if (!next) {
        // 次がいない場合は全解散
        breakEntireChain(leader);
        return;
    }

    // 次のメンバーを新リーダーに昇格
    next.chainRole = 'leader';
    next.chainLeaderId = null;
    next.chainPrevId = null;
    next.chainIndex = 0;
    next.chainPathHistory = [{ x: next.x, y: next.y }];

    // 残りのフォロワーのchainLeaderIdを新リーダーに更新 & indexを-1
    let current = next;
    while (current.chainFollowers && current.chainFollowers.length > 0) {
        const fid = current.chainFollowers[0];
        const f = state.players[fid];
        if (!f) break;
        f.chainLeaderId = next.id;
        f.chainIndex--;
        current = f;
    }

    // チェーンが新リーダー1人だけなら解散
    const members = getChainMemberIds(next);
    if (members.length <= 1) {
        next.chainRole = 'none';
        next.chainFollowers = [];
        next.chainPathHistory = [];
    }

    // 元リーダーをリセット
    leader.chainRole = 'none';
    leader.chainLeaderId = null;
    leader.chainPrevId = null;
    leader.chainFollowers = [];
    leader.chainIndex = 0;
    leader.chainHasInput = false;
    leader.chainAnchorX = 0;
    leader.chainAnchorY = 0;
    leader.chainOffsetX = 0;
    leader.chainOffsetY = 0;
    leader.chainPathHistory = [];
    leader.chainPrevX = undefined;
    leader.chainPrevY = undefined;
}

function tryChainAttach(joiner, target) {
    // リーダーまたはソロのみ連結を開始できる（フォロワーは不可）
    if (joiner.chainRole === 'follower') return false;
    if (!joiner.hasMovedSinceSpawn || !target.hasMovedSinceSpawn) return false;
    if (!joiner.team || joiner.team !== target.team) return false;
    // 距離チェック(100px以内)
    const dist = Math.hypot(joiner.x - target.x, joiner.y - target.y);
    if (dist > 100) return false;

    // joinerが既にリーダーの場合: チェーンごとtarget側に合流する
    // 例: A(leader)→B→C が D(solo) に連結 → D(leader)→A→B→C
    if (joiner.chainRole === 'leader') {
        // 自分のチェーンメンバーには再連結不要
        if (target.chainRole === 'follower' && target.chainLeaderId === joiner.id) {
            return false; // 既に自分のチェーンのメンバー
        }

        // targetのリーダーを見つける
        let leader = target;
        if (target.chainRole === 'follower' && target.chainLeaderId) {
            leader = state.players[target.chainLeaderId];
            if (!leader || leader.state !== 'active') return false;
        }

        // targetチェーンの末尾と長さを取得
        let targetChainLength = 1;
        let tail = leader;
        while (tail.chainFollowers && tail.chainFollowers.length > 0) {
            targetChainLength++;
            const nextTail = state.players[tail.chainFollowers[0]];
            if (!nextTail) break;
            tail = nextTail;
        }

        // joinerチェーンのメンバーを収集 [joiner, B, C, ...]
        const joinerMembers = getChainMemberIds(joiner);

        // チェーン長上限チェック
        const totalLength = targetChainLength + joinerMembers.length;
        const maxLength = (joiner.isSwarmBot && target.isSwarmBot) ? SWARM_BOT_COUNT : CHAIN_MAX_LENGTH;
        if (totalLength > maxLength) return false;

        // targetがソロならリーダーに昇格
        if (target.chainRole === 'none') {
            target.chainRole = 'leader';
            target.chainFollowers = [];
            target.chainPathHistory = [{ x: target.x, y: target.y }];
            leader = target;
            tail = target;
        }

        // targetチェーンの末尾にjoinerを接続
        tail.chainFollowers = [joiner.id];

        // joinerをリーダーからフォロワーに降格
        joiner.chainRole = 'follower';
        joiner.chainLeaderId = leader.id;
        joiner.chainPrevId = tail.id;
        joiner.chainIndex = targetChainLength;
        joiner.chainPathHistory = [];
        joiner.chainPrevX = joiner.x;
        joiner.chainPrevY = joiner.y;
        joiner.chainOffsetX = joiner.x - leader.x;
        joiner.chainOffsetY = joiner.y - leader.y;
        joiner.gridTrail = [];
        joiner.trail = [];

        // joinerの既存フォロワーのchainLeaderIdを新リーダーに更新、indexをシフト
        for (let i = 1; i < joinerMembers.length; i++) {
            const member = state.players[joinerMembers[i]];
            if (member) {
                member.chainLeaderId = leader.id;
                member.chainIndex = targetChainLength + i;
            }
        }

        console.log(`[CHAIN] ${joiner.name}(leader) がチェーンごと ${leader.name} に合流 (total:${totalLength})`);
        return true;
    }

    // joinerがソロ(none)の場合: 従来通りtargetのチェーンに参加
    // リーダーを見つける
    let leader = target;
    if (target.chainRole === 'follower' && target.chainLeaderId) {
        leader = state.players[target.chainLeaderId];
        if (!leader || leader.state !== 'active') return false;
    } else if (target.chainRole === 'none') {
        leader = target; // targetが新リーダーになる
    }

    // 現在のチェーン長を数える
    let chainLength = 1;
    let tail = leader;
    while (tail.chainFollowers && tail.chainFollowers.length > 0) {
        chainLength++;
        const nextTail = state.players[tail.chainFollowers[0]];
        if (!nextTail) break;
        tail = nextTail;
    }
    // スウォームBOT同士は上限50、通常プレイヤーは上限5
    const maxLength = (joiner.isSwarmBot && (leader.isSwarmBot || target.isSwarmBot)) ? SWARM_BOT_COUNT : CHAIN_MAX_LENGTH;
    if (chainLength >= maxLength) return false;

    // targetがソロならリーダーに昇格
    if (target.chainRole === 'none') {
        target.chainRole = 'leader';
        target.chainFollowers = [];
        target.chainPathHistory = [{ x: target.x, y: target.y }];
        leader = target;
        tail = target;
    }

    // 末尾に接続
    tail.chainFollowers = [joiner.id];
    joiner.chainLeaderId = leader.id;
    joiner.chainPrevId = tail.id;  // 直前のメンバーID（ロープ物理用）
    joiner.chainRole = 'follower';
    joiner.chainIndex = chainLength;
    joiner.gridTrail = [];
    joiner.trail = [];

    // Verlet物理の初期化（現在位置を前回位置として記録）
    joiner.chainPrevX = joiner.x;
    joiner.chainPrevY = joiner.y;
    joiner.chainOffsetX = joiner.x - leader.x;
    joiner.chainOffsetY = joiner.y - leader.y;

    console.log(`[CHAIN] ${joiner.name} → ${leader.name} の連結に参加 (pos:${chainLength})`);
    return true;
}

function moveChainFollower(follower, anchor, dt) {
    // Verlet積分によるロープ物理シミュレーション
    // anchor = このフォロワーの直前のチェーンメンバー
    const damping = 0.92;
    const gravity = 0;  // 横スクロールゲームではなく俯瞰なので重力なし

    // 前フレームの位置（Verlet速度計算用）
    const prevX = follower.chainPrevX !== undefined ? follower.chainPrevX : follower.x;
    const prevY = follower.chainPrevY !== undefined ? follower.chainPrevY : follower.y;

    // Verlet: 速度 = (現在位置 - 前回位置) * 減衰
    let vx = (follower.x - prevX) * damping;
    let vy = (follower.y - prevY) * damping;

    // 前回位置を保存
    follower.chainPrevX = follower.x;
    follower.chainPrevY = follower.y;

    // 速度を適用
    let newX = follower.x + vx;
    let newY = follower.y + vy;

    // ロープ距離制約: anchorからCHAIN_SPACING以内に制限
    const spacing = follower.isSwarmBot ? SWARM_CHAIN_SPACING : CHAIN_SPACING;
    const dx = newX - anchor.x;
    const dy = newY - anchor.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > spacing) {
        // ロープの端まで引っ張る
        const ratio = spacing / dist;
        newX = anchor.x + dx * ratio;
        newY = anchor.y + dy * ratio;
    } else if (dist < 1) {
        // 重なり防止: ランダム方向に少しずらす
        const angle = Math.random() * Math.PI * 2;
        newX = anchor.x + Math.cos(angle) * spacing * 0.5;
        newY = anchor.y + Math.sin(angle) * spacing * 0.5;
    }

    // 壁クランプ
    follower.x = Math.max(0, Math.min(state.WORLD_WIDTH - 1, newX));
    follower.y = Math.max(0, Math.min(state.WORLD_HEIGHT - 1, newY));

    // 方向: 移動ベクトルから算出
    const moveDx = follower.x - follower.chainPrevX;
    const moveDy = follower.y - follower.chainPrevY;
    const moveLen = Math.sqrt(moveDx * moveDx + moveDy * moveDy);
    if (moveLen > 0.5) {
        follower.dx = moveDx / moveLen;
        follower.dy = moveDy / moveLen;
    }
}

function killPlayer(id, reason, skipWipe = false) {
    const p = state.players[id];
    if (p && p.state === 'active') {
        detachFromChain(p);
        console.log(`[DEATH] ${p.name || id} - ${reason}`);
        p.state = 'dead';
        p.deathX = p.x; p.deathY = p.y;
        p.dx = 0; p.dy = 0;
        p.gridTrail = [];
        p.trail = [];
        p.score = 0;

        if (!skipWipe) {
            // territoryRectsベースで対象プレイヤーの領地のみ消去（全グリッドスキャン回避）
            let wiped = false;
            state.territoryRects.forEach(rect => {
                if (rect.o === id) {
                    const gxStart = rect.x / GRID_SIZE;
                    const gy = rect.y / GRID_SIZE;
                    const gw = rect.w / GRID_SIZE;
                    for (let dx = 0; dx < gw; dx++) {
                        const gx = gxStart + dx;
                        if (state.worldGrid[gy] && state.worldGrid[gy][gx] === id) {
                            state.worldGrid[gy][gx] = null;
                            wiped = true;
                        }
                    }
                }
            });
            if (wiped) game.rebuildTerritoryRects();
        }

        p.deaths = (p.deaths || 0) + 1;

        // 戦歴ログをチーム別に蓄積
        const deadName = (p.name || '').replace(/^\[.*?\]\s*/, '');
        let killerName = '';
        let killerTeam = '';
        if (reason.startsWith('キル: ')) {
            killerName = reason.replace('キル: ', '');
            const killer = Object.values(state.players).find(k => k.name === killerName && k.state === 'active');
            if (killer) killerTeam = killer.team || '';
            killerName = killerName.replace(/^\[.*?\]\s*/, '');
        } else if (reason.includes('に切られた')) {
            killerName = reason.replace('に切られた', '');
            const killer = Object.values(state.players).find(k => k.name === killerName);
            if (killer) killerTeam = killer.team || '';
            killerName = killerName.replace(/^\[.*?\]\s*/, '');
        } else if (reason.includes('に囲まれた')) {
            killerName = reason.replace('に囲まれた', '');
            const killer = Object.values(state.players).find(k => k.name === killerName);
            if (killer) killerTeam = killer.team || '';
            killerName = killerName.replace(/^\[.*?\]\s*/, '');
        }

        if (p.team) {
            if (!state.teamBattleLog[p.team]) state.teamBattleLog[p.team] = [];
            if (killerName) {
                state.teamBattleLog[p.team].push(`💀 ${deadName} が ${killerName} に倒された`);
            } else {
                state.teamBattleLog[p.team].push(`💀 ${deadName} が ${reason}`);
            }
            if (state.teamBattleLog[p.team].length > 50) state.teamBattleLog[p.team].shift();
        }
        if (killerTeam && killerTeam !== p.team) {
            if (!state.teamBattleLog[killerTeam]) state.teamBattleLog[killerTeam] = [];
            state.teamBattleLog[killerTeam].push(`⚔️ ${killerName} が ${deadName} を倒した！`);
            if (state.teamBattleLog[killerTeam].length > 50) state.teamBattleLog[killerTeam].shift();
        }

        game.broadcast({ type: 'player_death', id, reason, team: p.team || '', name: p.name || '' });

        // CPUプレイヤーはAFK判定をスキップ（常にリスポーン）
        if (p.isCpu) {
            setTimeout(() => { if (state.players[id]) respawnPlayer(state.players[id]); }, RESPAWN_TIME * 1000);
            return;
        }

        if (!p.hasMovedSinceSpawn) {
            p.afkDeaths++;
            if (p.afkDeaths >= AFK_DEATH_LIMIT) {
                // AFKタイムアウトをIPで記録（再接続時のbot認証用）
                // ただし、実際にアクティブにプレイした履歴があるプレイヤーのみ記録
                if (p.hasBeenActive) {
                    botAuth.recordAfkTimeout(p.ip, p.cfCountry, p.cfRay);
                    console.log(`[AFK] Player ${p.name || id} timed out after ${AFK_DEATH_LIMIT} AFK deaths`);
                } else {
                    console.log(`[AFK] Player ${p.name || id} kicked (never became active)`);
                }
                
                if (p.ws.readyState === WebSocket.OPEN) p.ws.close(4000, "AFK Timeout");
                delete state.players[id];
                return;
            }
        } else p.afkDeaths = 0;

        setTimeout(() => { if (state.players[id]) respawnPlayer(state.players[id]); }, RESPAWN_TIME * 1000);
    }
}

// スコアを占有率に変換
function toExpScore(raw) {
    if (!raw) return 0;
    const totalCells = (state.WORLD_WIDTH / GRID_SIZE) * (state.WORLD_HEIGHT / GRID_SIZE);
    return parseFloat(((raw / totalCells) * 100).toFixed(2));
}

function endRound() {
    state.roundActive = false;
    console.log('[ROUND] Round ended');
    
    // 統計出力
    stats.printRoundStats(serverStartTime, state.currentModeIdx);

    const rankings = Object.values(state.players)
        .filter(p => !p.isCpu && p.state !== 'waiting' && (p.score > 0 || p.kills > 0))
        .sort((a, b) => (b.score - a.score) || ((b.kills || 0) - (a.kills || 0)))
        .slice(0, 10)
        .map(p => ({ name: p.name, score: toExpScore(p.score), emoji: p.emoji, color: p.color, kills: p.kills || 0, team: p.team }));

    const teamScores = {}, teamKills = {}, teamMembers = {};
    Object.values(state.players).forEach(p => {
        // チームに所属していて、アクティブなプレイヤーはすべてカウント（CPUは除外）
        if (!p.isCpu && p.state !== 'waiting' && p.team) {
            if (!teamScores[p.team]) { teamScores[p.team] = 0; teamKills[p.team] = 0; teamMembers[p.team] = 0; }
            teamScores[p.team] += p.score || 0;
            teamKills[p.team] += p.kills || 0;
            teamMembers[p.team] += 1;
        }
    });
    const teamRankings = Object.keys(teamScores).map(t => ({
        name: t, score: toExpScore(teamScores[t]), kills: teamKills[t] || 0, members: teamMembers[t] || 0
    })).sort((a, b) => b.score - a.score).slice(0, 5);

    const nextModeIdx = (FORCE_TEAM || HUMAN_VS_BOT) ? 1 : ((state.currentModeIdx + 1) % GAME_MODES.length);
    const allTeams = game.getTeamStats();
    const totalPlayers = Object.keys(state.players).length;
    
    // 次ラウンド開始時刻を記録
    const nextRoundStartTime = Date.now() + 15000;
    state.nextRoundStartTime = nextRoundStartTime;
    
    // スコア画面用の国旗位置を計算（TEAMモード時のみ）
    const mapFlags = game.calculateMapFlags();
    
    // 最終ミニマップを生成
    const finalMinimap = game.generateMinimapBitmap();

    const resultMsg = {
        type: 'round_end',
        rankings,
        teamRankings,
        winner: rankings[0],
        nextMode: GAME_MODES[nextModeIdx],
        allTeams,
        totalPlayers,
        mapFlags: mapFlags,
        finalMinimap: finalMinimap ? { bm: finalMinimap.bm.toString('base64'), cp: finalMinimap.cp, sz: finalMinimap.sz, flags: finalMinimap.flags || [] } : null,
        secondsUntilNext: 15
    };
    state.lastResultMsg = resultMsg;
    game.broadcast(resultMsg);

    // DB保存
    const mode = GAME_MODES[state.currentModeIdx];
    const activePlayerCount = Object.values(state.players).filter(p => p.state !== 'waiting').length;
    const actualPlayerCount = activePlayerCount || state.roundParticipants.size || totalPlayers;
    game.saveRankingsToDB(mode, rankings, teamRankings, actualPlayerCount);

    setTimeout(() => {
        game.initGrid();
        if (!FORCE_TEAM && !HUMAN_VS_BOT) state.currentModeIdx = (state.currentModeIdx + 1) % GAME_MODES.length;
        state.territoryRects = [];
        state.territoryVersion = 0;
        state.pendingTerritoryUpdates = [];
        state.lastFullSyncVersion = {};
        state.roundActive = true;
        
        const mode = GAME_MODES[state.currentModeIdx];
        // チーム戦は+120秒
        state.timeRemaining = (mode === 'TEAM') ? GAME_DURATION + 120 : GAME_DURATION;
        state.roundParticipants.clear();
        state.teamChatLog = {};
        state.teamBattleLog = {};

        // 統計リセット
        stats.resetRoundStats();
        
        // CPUのラウンドリセット
        cpu.resetCpusForNewRound();

        Object.values(state.players).filter(p => p.ws.readyState === WebSocket.OPEN && p.state !== 'waiting').forEach(p => {
            p.hasChattedInRound = false;
            
            // モードに応じてチーム設定をリセット
            if (mode === 'SOLO') {
                p.team = '';
                // 色を再分配（既存プレイヤーと最大距離の色相を選ぶ）
                p.color = game.getUniqueColor();
                p.originalColor = p.color;
                // 名前からチームタグを削除
                p.name = p.name.replace(/^\[.*?\]\s*/, '');
            } else {
                // TEAM MODE - requestedTeamを復元
                p.team = p.requestedTeam || '';
                if (p.team) {
                    const cleanName = p.name.replace(/^\[.*?\]\s*/, '');
                    p.name = `[${p.team}] ${cleanName}`;
                    // チーム色を適用
                    p.color = game.getTeamColor(p.team);
                    // たぬきチームは絵文字を🥺に強制
                    if (p.team === TANUKI_TEAM_NAME) p.emoji = '🥺';
                }
            }
            
            respawnPlayer(p, true);
        });

        game.broadcast({
            type: 'round_start',
            mode: GAME_MODES[state.currentModeIdx],
            obstacles: state.obstacles,
            gears: state.gears || [],
            world: { width: state.WORLD_WIDTH, height: state.WORLD_HEIGHT },
            tf: state.territoryRects,
            tv: state.territoryVersion
        });

        // ラウンド開始時に全員のマスタ情報（名前・色・チーム）をブロードキャスト
        const activePlayers = Object.values(state.players).filter(p => p.ws.readyState === WebSocket.OPEN && p.state !== 'waiting');
        const allPlayerMaster = activePlayers.map(p => {
            const d = { i: p.id, si: p.shortId, n: p.name, c: p.color, e: p.emoji, t: p.team || '' };
            if (p.scale && p.scale !== 1) d.sc = p.scale;
            return d;
        });
        game.broadcast({
            type: 'pm',
            players: allPlayerMaster
        });

        state.lastResultMsg = null;
    }, 15000);
}

// gameモジュールに依存関数を設定
game.respawnPlayer = respawnPlayer;
game.setKillPlayer(killPlayer);
game.detachFromChain = detachFromChain;
game.leaderLeaveChain = leaderLeaveChain;
game.tryChainAttach = tryChainAttach;
game.getChainMemberIds = getChainMemberIds;

// ============================================================
// 起動
// ============================================================
game.initGrid();
network.setupConnectionHandler();
network.startBroadcastLoop();
cpu.startCpuLoop();
cpu.startDebugChainMode();

// DB初期化後にサーバー起動
game.initDB().then(async () => {
    // AFKタイムアウトデータをDBから読み込み
    await botAuth.loadAfkTimeoutsFromDB();
    
    server.listen(PORT, () => {
        console.log(`[SERVER] Version ${SERVER_VERSION} started on port ${PORT}`);
        if (DEBUG_MODE) console.log('[DEBUG] Debug mode enabled');
        if (STATS_MODE) console.log('[STATS] Stats mode enabled');
    });
});

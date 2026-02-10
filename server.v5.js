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

const {
    PORT, SSL_KEY_PATH, SSL_CERT_PATH, SERVER_VERSION,
    GAME_DURATION, PLAYER_SPEED, BOOST_SPEED_MULTIPLIER, BOOST_DURATION, BOOST_COOLDOWN,
    GRID_SIZE, RESPAWN_TIME, AFK_DEATH_LIMIT,
    GAME_MODES, FORCE_TEAM, DEBUG_MODE, STATS_MODE, TEAM_COLORS,
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
        zlibDeflateOptions: { chunkSize: 1024, memLevel: 7, level: 3 },
        zlibInflateOptions: { chunkSize: 10 * 1024 },
        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        serverMaxWindowBits: 10,
        concurrencyLimit: 10,
        threshold: 1024
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
setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    if (!state.roundActive) return;

    // 時間経過
    if (Math.floor(now / 1000) > Math.floor((now - dt * 1000) / 1000)) {
        state.timeRemaining--;
        if (state.timeRemaining <= 0) endRound();
        
        // 20秒ごとにミニマップ履歴を保存
        game.saveMinimapSnapshot();
    }

    // プレイヤー更新
    Object.values(state.players).forEach(p => {
        if (p.state !== 'active') return;
        if (p.id === 'DEBUG_FULL_OWNER' || p.id === 'DEBUG_ENEMY') return;

        // AFK自動移動
        if (!p.hasMovedSinceSpawn && !p.autoRun && p.spawnTime && (now - p.spawnTime > 5000)) {
            const angle = Math.random() * Math.PI * 2;
            p.dx = Math.cos(angle);
            p.dy = Math.sin(angle);
            p.autoRun = true;
            p.invulnerableUntil = 0;
        }

        const prevGx = game.toGrid(p.x);
        const prevGy = game.toGrid(p.y);

        // ブースト状態の判定
        const isBoosting = p.boostUntil && now < p.boostUntil;
        const currentSpeed = isBoosting ? PLAYER_SPEED * BOOST_SPEED_MULTIPLIER : PLAYER_SPEED;
        p.boosting = isBoosting;  // クライアント通知用

        let nextX = p.x + p.dx * currentSpeed * dt;
        let nextY = p.y + p.dy * currentSpeed * dt;

        // 壁チェック
        if (nextX < 0 || nextX >= state.WORLD_WIDTH || nextY < 0 || nextY >= state.WORLD_HEIGHT) {
            killPlayer(p.id, "壁に激突");
            return;
        }

        const isInvuln = (p.invulnerableUntil && now < p.invulnerableUntil);
        const gx = game.toGrid(nextX);
        const gy = game.toGrid(nextY);

        // 障害物チェック
        if (!isInvuln && state.worldGrid[gy] && state.worldGrid[gy][gx] === 'obstacle') {
            killPlayer(p.id, "障害物に激突");
            return;
        }

        p.x = nextX;
        p.y = nextY;

        // 他プレイヤーとの相互作用
        if (!isInvuln) {
            Object.values(state.players).forEach(target => {
                if (target.id === p.id || target.state !== 'active') return;
                if (p.team && target.team === p.team) return;
                const targetInvuln = (target.invulnerableUntil && now < target.invulnerableUntil);
                if (targetInvuln) return;

                const tgx = game.toGrid(target.x);
                const tgy = game.toGrid(target.y);

                // 正面衝突
                if (gx === tgx && gy === tgy) {
                    if (p.score <= 100 || target.score <= 100) {
                        if (p.score < target.score) { target.kills++; killPlayer(p.id, "正面衝突"); return; }
                        if (target.score < p.score) { p.kills++; killPlayer(target.id, "正面衝突"); return; }
                    }
                    killPlayer(p.id, "正面衝突");
                    killPlayer(target.id, "正面衝突");
                    return;
                }

                // 軌跡カット
                if (target.trail.length > 0) {
                    let hitTrail = false;
                    for (let i = 0; i < target.trail.length - 1; i++) {
                        if (game.getDistSq(p.x, p.y, target.trail[i].x, target.trail[i].y, target.trail[i + 1].x, target.trail[i + 1].y) < 225) {
                            hitTrail = true; break;
                        }
                    }
                    if (!hitTrail) {
                        const last = target.trail[target.trail.length - 1];
                        if (game.getDistSq(p.x, p.y, last.x, last.y, target.x, target.y) < 225) hitTrail = true;
                    }
                    if (hitTrail) {
                        killPlayer(target.id, `${p.name}に切られた`, true);
                        p.kills++;
                        let stolenCount = 0;
                        for (let y = 0; y < state.GRID_ROWS; y++) {
                            for (let x = 0; x < state.GRID_COLS; x++) {
                                if (state.worldGrid[y][x] === target.id) {
                                    state.worldGrid[y][x] = p.id;
                                    stolenCount++;
                                }
                            }
                        }
                        if (stolenCount > 0) { p.score += stolenCount; game.rebuildTerritoryRects(); }
                    }
                }
            });
        }

        if (p.state === 'dead') return;

        // 領地獲得ロジック
        const cellOwnerId = state.worldGrid[gy] && state.worldGrid[gy][gx];
        const cellOwner = state.players[cellOwnerId];
        const isInsideOwn = (cellOwnerId === p.id) || (p.team && cellOwner && cellOwner.team === p.team);

        if (isInsideOwn) {
            if (p.gridTrail.length > 0) game.attemptCapture(p.id);
            p.gridTrail = [];
            p.trail = [];
        } else {
            // 軌跡追加
            if (p.gridTrail.length === 0 && prevGx >= 0 && prevGx < state.GRID_COLS && prevGy >= 0 && prevGy < state.GRID_ROWS) {
                if (state.worldGrid[prevGy][prevGx] === p.id) {
                    p.gridTrail.push({ x: prevGx, y: prevGy });
                    p.trail.push({ x: prevGx * GRID_SIZE + GRID_SIZE / 2, y: prevGy * GRID_SIZE + GRID_SIZE / 2 });
                }
            }

            const lastT = p.gridTrail.length > 0 ? p.gridTrail[p.gridTrail.length - 1] : null;
            if (lastT && (lastT.x !== gx || lastT.y !== gy)) {
                // 自己交差チェック
                let hitSelf = false;
                if (p.trail.length > 10) {
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
                    const dx = gx - lastT.x, dy = gy - lastT.y;
                    const steps = Math.max(Math.abs(dx), Math.abs(dy));
                    for (let i = 1; i <= steps; i++) {
                        const igx = Math.round(lastT.x + dx * i / steps);
                        const igy = Math.round(lastT.y + dy * i / steps);
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
                p.gridTrail.push({ x: gx, y: gy });
                p.trail.push({ x: p.x, y: p.y });
            }
        }
    });
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
    p.hasMovedSinceSpawn = p.isCpu ? true : false;  // CPUは常に移動済み扱い
    p.autoRun = false;
    p.invulnerableUntil = Date.now() + 3000;
    p.boostCooldownUntil = Date.now() + 5000;  // スポーン後5秒間ブースト使用不可
    p.boostUntil = 0;
    if (fullReset) { p.score = 0; p.afkDeaths = 0; p.kills = 0; }

    // 安全なスポーン位置を探す
    let safe = false;
    let teamCenter = null;
    if (p.team) {
        const teammates = Object.values(state.players).filter(op => op.id !== p.id && op.team === p.team && op.state === 'active');
        if (teammates.length > 0) teamCenter = { x: teammates[0].x, y: teammates[0].y };
    }

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
                if (state.worldGrid[gy + dy] && state.worldGrid[gy + dy][gx + dx] === 'obstacle') obs = true;
            }
        }
        if (!obs) { p.x = tx; p.y = ty; safe = true; break; }
    }
    if (!safe) { p.x = 1000; p.y = 1000; }

    // 初期領地
    const startGx = game.toGrid(p.x), startGy = game.toGrid(p.y);
    let initialScore = 0;
    for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
            const gy = startGy + dy, gx = startGx + dx;
            if (gy >= 0 && gy < state.GRID_ROWS && gx >= 0 && gx < state.GRID_COLS) {
                const oldOwner = state.worldGrid[gy][gx];
                if (oldOwner === 'obstacle') continue;
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
}

function killPlayer(id, reason, skipWipe = false) {
    const p = state.players[id];
    if (p && p.state === 'active') {
        console.log(`[DEATH] ${p.name || id} - ${reason}`);
        p.state = 'dead';
        p.dx = 0; p.dy = 0;
        p.gridTrail = [];
        p.trail = [];
        p.score = 0;

        if (!skipWipe) {
            let wiped = false;
            for (let y = 0; y < state.GRID_ROWS; y++) {
                for (let x = 0; x < state.GRID_COLS; x++) {
                    if (state.worldGrid[y][x] === id) { state.worldGrid[y][x] = null; wiped = true; }
                }
            }
            if (wiped) game.rebuildTerritoryRects();
        }

        game.broadcast({ type: 'player_death', id, reason });

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
        .filter(p => p.state !== 'waiting' && (p.score > 0 || p.kills > 0))
        .sort((a, b) => (b.score - a.score) || ((b.kills || 0) - (a.kills || 0)))
        .slice(0, 10)
        .map(p => ({ name: p.name, score: toExpScore(p.score), emoji: p.emoji, color: p.color, kills: p.kills || 0, team: p.team }));

    const teamScores = {}, teamKills = {}, teamMembers = {};
    Object.values(state.players).forEach(p => {
        // チームに所属していて、アクティブなプレイヤーはすべてカウント
        if (p.state !== 'waiting' && p.team) {
            if (!teamScores[p.team]) { teamScores[p.team] = 0; teamKills[p.team] = 0; teamMembers[p.team] = 0; }
            teamScores[p.team] += p.score || 0;
            teamKills[p.team] += p.kills || 0;
            teamMembers[p.team] += 1;
        }
    });
    const teamRankings = Object.keys(teamScores).map(t => ({
        name: t, score: toExpScore(teamScores[t]), kills: teamKills[t] || 0, members: teamMembers[t] || 0
    })).sort((a, b) => b.score - a.score).slice(0, 5);

    const nextModeIdx = FORCE_TEAM ? 1 : ((state.currentModeIdx + 1) % GAME_MODES.length);
    const allTeams = game.getTeamStats();
    const totalPlayers = Object.keys(state.players).length;
    
    // 次ラウンド開始時刻を記録
    const nextRoundStartTime = Date.now() + 15000;
    state.nextRoundStartTime = nextRoundStartTime;
    
    // スコア画面用の国旗位置を計算（TEAMモード時のみ）
    const mapFlags = game.calculateMapFlags();
    
    // ミニマップ履歴を取得
    const minimapHistory = game.getMinimapHistory();
    
    const resultMsg = { 
        type: 'round_end', 
        rankings, 
        teamRankings, 
        winner: rankings[0], 
        nextMode: GAME_MODES[nextModeIdx], 
        allTeams, 
        totalPlayers,
        mapFlags: mapFlags,  // スコア画面用の国旗位置
        minimapHistory: minimapHistory,  // ミニマップ履歴（パラパラ漫画用）
        secondsUntilNext: 15  // 次ラウンドまでの秒数
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
        if (!FORCE_TEAM) state.currentModeIdx = (state.currentModeIdx + 1) % GAME_MODES.length;
        state.territoryRects = [];
        state.territoryVersion = 0;
        state.pendingTerritoryUpdates = [];
        state.lastFullSyncVersion = {};
        state.roundActive = true;
        
        const mode = GAME_MODES[state.currentModeIdx];
        // チーム戦は+120秒
        state.timeRemaining = (mode === 'TEAM') ? GAME_DURATION + 120 : GAME_DURATION;
        state.roundParticipants.clear();
        
        // 統計リセット
        stats.resetRoundStats();
        
        // ミニマップ履歴クリア
        game.clearMinimapHistory();
        
        // CPUのラウンドリセット
        cpu.resetCpusForNewRound();

        Object.values(state.players).filter(p => p.ws.readyState === WebSocket.OPEN).forEach(p => {
            p.hasChattedInRound = false;
            
            // モードに応じてチーム設定をリセット
            if (mode === 'SOLO') {
                p.team = '';
                p.color = p.originalColor;
                // 名前からチームタグを削除
                p.name = p.name.replace(/^\[.*?\]\s*/, '');
            } else {
                // TEAM MODE - requestedTeamを復元
                p.team = p.requestedTeam || '';
                if (p.team) {
                    const cleanName = p.name.replace(/^\[.*?\]\s*/, '');
                    p.name = `[${p.team}] ${cleanName}`;
                    // チーム色を適用
                    if (TEAM_COLORS[p.team]) {
                        p.color = TEAM_COLORS[p.team];
                    } else {
                        // カスタムチーム: チームメイトの色を継承
                        const teammate = Object.values(state.players).find(op => op.id !== p.id && op.team === p.team && op.color);
                        if (teammate) p.color = teammate.color;
                        else p.color = game.getUniqueColor();
                    }
                }
            }
            
            respawnPlayer(p, true);
        });

        game.broadcast({
            type: 'round_start',
            mode: GAME_MODES[state.currentModeIdx],
            obstacles: state.obstacles,
            world: { width: state.WORLD_WIDTH, height: state.WORLD_HEIGHT },
            tf: state.territoryRects,
            tv: state.territoryVersion
        });

        // ラウンド開始時に全員のマスタ情報（名前・色・チーム）をブロードキャスト
        const activePlayers = Object.values(state.players).filter(p => p.ws.readyState === WebSocket.OPEN);
        const allPlayerMaster = activePlayers.map(p => ({
            i: p.id,
            si: p.shortId,
            n: p.name,
            c: p.color,
            e: p.emoji,
            t: p.team || ''
        }));
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

// ============================================================
// 起動
// ============================================================
game.initGrid();
network.setupConnectionHandler();
network.startBroadcastLoop();
cpu.startCpuLoop();

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

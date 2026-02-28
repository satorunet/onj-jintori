/**
 * modules/game.js
 * ゲームロジック・ラウンド管理・DB保存
 */

const crypto = require('crypto');
const zlib = require('zlib');
const WebSocket = require('ws');

const config = require('./config');
const {
    fs, os, dbPool,
    GAME_DURATION, RESPAWN_TIME, PLAYER_SPEED, GRID_SIZE, AFK_DEATH_LIMIT, MINIMAP_SIZE,
    EMOJIS, GAME_MODES, TEAM_COLORS,
    DEBUG_MODE, INNER_DEBUG_MODE, FORCE_TEAM, STATS_MODE, HELL_OBSTACLES, GEAR_ENABLED,
    state, bandwidthStats, resetBandwidthStats
} = config;

// 障害物判定ヘルパー
function isObstacleCell(val) { return val === 'obstacle' || val === 'obstacle_gear'; }

// サーバー起動時刻
const serverStartTime = Date.now();

// wss参照（後から設定）
let wss = null;
function setWss(wssInstance) { wss = wssInstance; }

// ============================================================
// ヘルパー関数
// ============================================================
// generateId は generateShortId のエイリアス（フルID廃止に伴い統一）
function generateId() { return generateShortId(); }

function getHueFromHex(hex) {
    if (!hex || hex.length !== 7) return 0;
    let r = parseInt(hex.substring(1, 3), 16) / 255;
    let g = parseInt(hex.substring(3, 5), 16) / 255;
    let b = parseInt(hex.substring(5, 7), 16) / 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0;
    if (max !== min) {
        let d = max - min;
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return h * 360;
}

// 色相を均等分割した固定パレット（ピンク320-340を除外）
// 色相環を最大距離で巡回する順序: 0°, 180°, 90°, 270°, 45°, 225°, 135°, 315°, ...
const _COLOR_HUES = (function() {
    const hues = [0]; // 赤(0°)を起点に含める
    // ビット反転風の順序で色相を最大分散配置
    // 段階的に分割: 1/2, 1/4, 1/8, ... の位置を順に追加
    for (let step = 2; step <= 32; step *= 2) {
        for (let i = 1; i < step; i += 2) {
            const h = Math.round((i / step) * 360) % 360;
            // ピンク帯(320-340)を除外
            if (h >= 320 && h <= 340) continue;
            if (!hues.includes(h)) hues.push(h);
        }
    }
    return hues;
})();

function getUniqueColor() {
    const playerList = Object.values(state.players);
    if (playerList.length === 0) {
        return _hslToHex(_COLOR_HUES[0], 85, 60);
    }
    const existingHues = playerList
        .filter(p => p.color)
        .map(p => getHueFromHex(p.color));

    // 固定パレットから既存色と最も離れた色相を選ぶ
    let bestHue = _COLOR_HUES[0];
    let maxMinDist = -1;

    for (const h of _COLOR_HUES) {
        let minDist = 360;
        for (const eh of existingHues) {
            let diff = Math.abs(h - eh);
            if (diff > 180) diff = 360 - diff;
            if (diff < minDist) minDist = diff;
        }
        if (minDist > maxMinDist) {
            maxMinDist = minDist;
            bestHue = h;
        }
    }

    // 彩度・明度に少しランダム幅を持たせて単調にならないようにする
    const s = Math.floor(Math.random() * 10) + 80;
    const l = Math.floor(Math.random() * 10) + 55;
    return _hslToHex(bestHue, s, l);
}

function _hslToHex(h, s, l) {
    const aa = s * Math.min(l / 100, 1 - l / 100) / 100;
    const f = n => {
        const k = (n + h / 30) % 12;
        const c = l / 100 - aa * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

function getRandomEmoji() { return EMOJIS[Math.floor(Math.random() * EMOJIS.length)]; }
function toGrid(val) { return Math.floor(val / GRID_SIZE); }

function getDistSq(px, py, vx, vy, wx, wy) {
    const l2 = (vx - wx) ** 2 + (vy - wy) ** 2;
    if (l2 === 0) return (px - vx) ** 2 + (py - vy) ** 2;
    let t = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
    t = Math.max(0, Math.min(1, t));
    return (px - (vx + t * (wx - vx))) ** 2 + (py - (vy + t * (wy - vy))) ** 2;
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes.toFixed(0) + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function formatTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}時間${m}分${s}秒`;
    return `${m}分${s}秒`;
}

// Short ID管理
function generateShortId() {
    let limit = 65535;
    while (limit > 0) {
        const id = state.nextShortId++;
        if (state.nextShortId > 65535) state.nextShortId = 1;
        if (!state.usedShortIds.has(id)) {
            state.usedShortIds.add(id);
            return id;
        }
        limit--;
    }
    return 0;
}

// ============================================================
// Grid初期化
// ============================================================
function initGrid() {
    const pCount = Object.keys(state.players).length;
    const baseSize = 2000;
    const size = Math.min(5000, Math.max(1500, baseSize + pCount * 100));
    state.WORLD_WIDTH = size;
    state.WORLD_HEIGHT = size;
    state.GRID_COLS = Math.ceil(state.WORLD_WIDTH / GRID_SIZE);
    state.GRID_ROWS = Math.ceil(state.WORLD_HEIGHT / GRID_SIZE);

    state.worldGrid = Array(state.GRID_ROWS).fill(null).map(() => Array(state.GRID_COLS).fill(null));
    state.obstacles = [];
    state.gears = [];  // 回転歯車リスト

    // 通常障害物の数
    const normalCount = HELL_OBSTACLES ? 80 : 15;

    for (let i = 0; i < normalCount; i++) {
        let w, h;
        if (HELL_OBSTACLES) {
            // 鬼モード: 多彩なサイズ（細長い壁も含む）
            if (Math.random() < 0.3) {
                // 細長い壁
                w = Math.random() < 0.5 ? Math.floor(1 + Math.random() * 2) : Math.floor(8 + Math.random() * 15);
                h = w > 3 ? Math.floor(1 + Math.random() * 2) : Math.floor(8 + Math.random() * 15);
            } else {
                w = Math.floor(2 + Math.random() * 6);
                h = Math.floor(2 + Math.random() * 6);
            }
        } else {
            w = Math.floor(2 + Math.random() * 5);
            h = Math.floor(2 + Math.random() * 5);
        }
        let gx = Math.floor(Math.random() * (state.GRID_COLS - w));
        let gy = Math.floor(Math.random() * (state.GRID_ROWS - h));

        state.obstacles.push({
            x: gx * GRID_SIZE, y: gy * GRID_SIZE,
            width: w * GRID_SIZE, height: h * GRID_SIZE, type: 'rect'
        });

        for (let y = gy; y < gy + h; y++) {
            for (let x = gx; x < gx + w; x++) {
                if (y >= 0 && y < state.GRID_ROWS && x >= 0 && x < state.GRID_COLS) {
                    state.worldGrid[y][x] = 'obstacle';
                }
            }
        }
    }

    // 鬼モード: 回転歯車（通常 + 超巨大）
    if (HELL_OBSTACLES) {
        // 通常歯車 5個
        for (let i = 0; i < 5; i++) {
            const radius = 150 + Math.random() * 150;
            const cx = radius + 100 + Math.random() * (state.WORLD_WIDTH - radius * 2 - 200);
            const cy = radius + 100 + Math.random() * (state.WORLD_HEIGHT - radius * 2 - 200);
            const speed = (0.15 + Math.random() * 0.35) * (Math.random() < 0.5 ? 1 : -1);
            const teeth = Math.floor(3 + Math.random() * 2);
            const toothWidth = 0.1;
            state.gears.push({ cx, cy, radius, speed, teeth, toothWidth, angle: Math.random() * Math.PI * 2 });
        }
        // 超巨大歯車 2個
        for (let i = 0; i < 2; i++) {
            const radius = 400 + Math.random() * 200;  // 半径400〜600px
            const cx = radius + 50 + Math.random() * (state.WORLD_WIDTH - radius * 2 - 100);
            const cy = radius + 50 + Math.random() * (state.WORLD_HEIGHT - radius * 2 - 100);
            const speed = (0.05 + Math.random() * 0.15) * (Math.random() < 0.5 ? 1 : -1);  // 超ゆっくり
            const teeth = Math.floor(5 + Math.random() * 3);  // 5〜7本（巨大なので歯が多くても隙間広い）
            const toothWidth = 0.08;
            state.gears.push({ cx, cy, radius, speed, teeth, toothWidth, angle: Math.random() * Math.PI * 2 });
        }
    }

    // 常設: 超巨大歯車1個（マップ中央付近）
    if (GEAR_ENABLED) {
        const radius = 500;
        const cx = state.WORLD_WIDTH / 2 + (Math.random() - 0.5) * 200;
        const cy = state.WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 200;
        const speed = 0.1 * (Math.random() < 0.5 ? 1 : -1);
        const teeth = 5;
        const toothWidth = 0.1;
        state.gears.push({ cx, cy, radius, speed, teeth, toothWidth, angle: Math.random() * Math.PI * 2 });
    }

    // 歯車中心エリア内の障害物を除去（占領可能にするため）
    state.gears.forEach(g => {
        const clearR = g.radius * 0.45;  // 中心安全エリア
        const gridR = Math.ceil(clearR / GRID_SIZE);
        const gcx = Math.round(g.cx / GRID_SIZE);
        const gcy = Math.round(g.cy / GRID_SIZE);
        for (let dy = -gridR; dy <= gridR; dy++) {
            for (let dx = -gridR; dx <= gridR; dx++) {
                const gx = gcx + dx;
                const gy = gcy + dy;
                if (gy < 0 || gy >= state.GRID_ROWS || gx < 0 || gx >= state.GRID_COLS) continue;
                const px = gx * GRID_SIZE + GRID_SIZE / 2 - g.cx;
                const py = gy * GRID_SIZE + GRID_SIZE / 2 - g.cy;
                if (Math.sqrt(px * px + py * py) < clearR) {
                    if (state.worldGrid[gy][gx] === 'obstacle') {
                        state.worldGrid[gy][gx] = null;
                    }
                }
            }
        }
        // obstacles配列からも歯車中心と重なるものを除去
        state.obstacles = state.obstacles.filter(o => {
            const ox = o.x + o.width / 2;
            const oy = o.y + o.height / 2;
            const dist = Math.sqrt((ox - g.cx) ** 2 + (oy - g.cy) ** 2);
            return dist > clearR;
        });
    });

    rebuildTerritoryRects();
}

// ============================================================
// テリトリー再構築（差分追跡付き）
// ============================================================
function rebuildTerritoryRects() {
    const GRID_COLS = state.GRID_COLS;
    const GRID_ROWS = state.GRID_ROWS;
    const worldGrid = state.worldGrid;
    const newRects = [];
    // 1D Uint8Arrayで処理済みフラグ（2D配列生成のGCコストを回避）
    const processed = new Uint8Array(GRID_ROWS * GRID_COLS);

    for (let y = 0; y < GRID_ROWS; y++) {
        const row = worldGrid[y];
        for (let x = 0; x < GRID_COLS; x++) {
            if (processed[y * GRID_COLS + x]) continue;
            const cell = row[x];
            if (cell && !isObstacleCell(cell)) {
                let w = 1;
                while (x + w < GRID_COLS && row[x + w] === cell && !processed[y * GRID_COLS + x + w]) w++;
                for (let k = 0; k < w; k++) processed[y * GRID_COLS + x + k] = 1;

                const p = state.players[cell];
                if (p) {
                    newRects.push({ o: cell, c: p.color, x: x * GRID_SIZE, y: y * GRID_SIZE, w: w * GRID_SIZE, h: GRID_SIZE });
                } else {
                    for (let k = 0; k < w; k++) row[x + k] = null;
                }
            }
        }
    }

    // 差分検出（数値キーでMap操作を高速化）
    const oldMap = new Map();
    state.territoryRects.forEach(r => oldMap.set(r.y * 100000 + r.x, r));
    const newMap = new Map();
    newRects.forEach(r => newMap.set(r.y * 100000 + r.x, r));

    const added = [];
    newRects.forEach(r => {
        const old = oldMap.get(r.y * 100000 + r.x);
        if (!old || old.o !== r.o || old.w !== r.w) added.push(r);
    });

    const removed = [];
    state.territoryRects.forEach(r => {
        const newRect = newMap.get(r.y * 100000 + r.x);
        if (!newRect || newRect.o !== r.o || newRect.w !== r.w) removed.push({ x: r.x, y: r.y });
    });

    if (added.length > 0 || removed.length > 0) {
        state.territoryVersion++;
        state.pendingTerritoryUpdates.push({ v: state.territoryVersion, a: added, r: removed });
        if (state.pendingTerritoryUpdates.length > 10) state.pendingTerritoryUpdates.shift();
        state.territoriesChanged = true;
    }
    state.territoryRects = newRects;
}

// ============================================================
// Broadcast (msgpack経由)
// ============================================================
let msgpack = null;
function setMsgpack(mp) { msgpack = mp; }

function broadcast(msg) {
    if (!wss || !msgpack) return;
    const payload = msgpack.encode(msg);
    const byteLen = payload.length;
    let sentCount = 0;
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) { c.send(payload); sentCount++; }
    });
    bandwidthStats.totalBytesSent += byteLen * sentCount;
    bandwidthStats.periodBytesSent += byteLen * sentCount;
    bandwidthStats.msgsSent += sentCount;
    bandwidthStats.periodMsgsSent += sentCount;
}

// ============================================================
// チーム統計
// ============================================================
function getTeamStats() {
    const counts = {};
    Object.values(state.players).forEach(p => {
        const t = p.requestedTeam || p.team;
        if (t) counts[t] = (counts[t] || 0) + 1;
    });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map(name => ({ name, count: counts[name] }));
}

// ============================================================
// ミニマップ生成
// ============================================================
function generateMinimapBitmap() {
    const scale = state.WORLD_WIDTH / MINIMAP_SIZE;
    const gridScale = scale / GRID_SIZE;
    const palette = {}; const colors = {}; let colorIdx = 1;

    Object.values(state.players).forEach(p => {
        if (p.state !== 'waiting' && !palette[p.id]) {
            palette[p.id] = colorIdx; colors[colorIdx] = p.color; colorIdx++;
            if (colorIdx > 255) colorIdx = 255;
        }
    });

    const bitmap = new Uint8Array(MINIMAP_SIZE * MINIMAP_SIZE);
    const usedColors = new Set();

    for (let my = 0; my < MINIMAP_SIZE; my++) {
        for (let mx = 0; mx < MINIMAP_SIZE; mx++) {
            const gx = Math.floor((mx + 0.5) * gridScale);
            const gy = Math.floor((my + 0.5) * gridScale);
            if (gy >= 0 && gy < state.GRID_ROWS && gx >= 0 && gx < state.GRID_COLS) {
                const owner = state.worldGrid[gy][gx];
                if (owner && !isObstacleCell(owner) && palette[owner]) {
                    bitmap[my * MINIMAP_SIZE + mx] = palette[owner];
                    usedColors.add(palette[owner]);
                }
            }
        }
    }

    const usedPalette = {};
    usedColors.forEach(idx => { usedPalette[idx] = colors[idx]; });
    const compressed = zlib.deflateSync(Buffer.from(bitmap), { level: 6 });
    
    // チーム戦モード時: 国旗位置を計算
    const flags = [];
    const mode = GAME_MODES[state.currentModeIdx];
    if (mode === 'TEAM') {
        const teamRectLists = {};
        state.territoryRects.forEach(t => {
            const owner = state.players[t.o];
            if (owner && owner.team) {
                if (!teamRectLists[owner.team]) {
                    teamRectLists[owner.team] = [];
                }
                teamRectLists[owner.team].push(t);
            }
        });

        const minClusterArea = (state.WORLD_WIDTH * state.WORLD_HEIGHT) * 0.02;
        const mergeDistance = 100;

        Object.entries(teamRectLists).forEach(([teamName, rectList]) => {
            // 国旗判定
            const chars = Array.from(teamName);
            if (chars.length < 2) return;
            const first = chars[0].codePointAt(0);
            const second = chars[1].codePointAt(0);
            if (first < 0x1F1E6 || first > 0x1F1FF || second < 0x1F1E6 || second > 0x1F1FF) return;
            const flag = chars[0] + chars[1];

            // クラスタリング
            const clusters = [];
            const used = new Set();

            rectList.forEach((rect, i) => {
                if (used.has(i)) return;

                const cluster = { rects: [rect], totalArea: rect.w * rect.h, sumX: 0, sumY: 0 };
                const area = rect.w * rect.h;
                cluster.sumX = (rect.x + rect.w / 2) * area;
                cluster.sumY = (rect.y + rect.h / 2) * area;
                used.add(i);

                let changed = true;
                while (changed) {
                    changed = false;
                    rectList.forEach((other, j) => {
                        if (used.has(j)) return;
                        for (const cr of cluster.rects) {
                            const dist = Math.hypot(
                                (cr.x + cr.w / 2) - (other.x + other.w / 2),
                                (cr.y + cr.h / 2) - (other.y + other.h / 2)
                            );
                            if (dist < mergeDistance) {
                                cluster.rects.push(other);
                                const otherArea = other.w * other.h;
                                cluster.totalArea += otherArea;
                                cluster.sumX += (other.x + other.w / 2) * otherArea;
                                cluster.sumY += (other.y + other.h / 2) * otherArea;
                                used.add(j);
                                changed = true;
                                break;
                            }
                        }
                    });
                }

                clusters.push(cluster);
            });

            clusters.forEach(cluster => {
                if (cluster.totalArea < minClusterArea) return;

                const centerX = cluster.sumX / cluster.totalArea;
                const centerY = cluster.sumY / cluster.totalArea;

                flags.push({ f: flag, x: centerX, y: centerY });
            });
        });
    }
    
    return { bm: compressed, cp: usedPalette, sz: MINIMAP_SIZE, flags: flags };
}

// ============================================================
// ミニマップ履歴管理
// ============================================================
const MINIMAP_HISTORY_INTERVAL = 20000;  // 20秒ごとにスナップショット保存

/**
 * ミニマップ履歴にスナップショットを追加
 */
function saveMinimapSnapshot() {
    const now = Date.now();
    
    // 最後の保存から20秒以上経過しているか確認
    if (now - state.lastMinimapHistoryTime < MINIMAP_HISTORY_INTERVAL) {
        return;
    }
    
    // ミニマップデータを生成
    const minimapData = generateMinimapBitmap();
    
    // 経過時間を計算（ゲーム開始からの秒数）
    const mode = GAME_MODES[state.currentModeIdx];
    const totalDuration = (mode === 'TEAM') ? GAME_DURATION + 120 : GAME_DURATION;
    const elapsedSeconds = totalDuration - state.timeRemaining;
    
    // 履歴に追加
    state.minimapHistory.push({
        time: elapsedSeconds,
        bm: minimapData.bm.toString('base64'),  // Base64エンコード
        cp: minimapData.cp,
        sz: minimapData.sz,
        flags: minimapData.flags || []
    });
    
    state.lastMinimapHistoryTime = now;
}

/**
 * ミニマップ履歴をクリア（新ラウンド開始時）
 */
function clearMinimapHistory() {
    state.minimapHistory = [];
    state.lastMinimapHistoryTime = 0;
}

/**
 * ミニマップ履歴を取得
 */
function getMinimapHistory() {
    // 最終状態も追加
    const minimapData = generateMinimapBitmap();
    const mode = GAME_MODES[state.currentModeIdx];
    const totalDuration = (mode === 'TEAM') ? GAME_DURATION + 120 : GAME_DURATION;
    const elapsedSeconds = totalDuration - state.timeRemaining;
    
    const history = [...state.minimapHistory];
    history.push({
        time: elapsedSeconds,
        bm: minimapData.bm.toString('base64'),
        cp: minimapData.cp,
        sz: minimapData.sz,
        flags: minimapData.flags || []
    });
    
    return history;
}

// ============================================================
// killPlayer参照（server.jsから設定される）
// ============================================================
let killPlayerFn = null;
function setKillPlayer(fn) { killPlayerFn = fn; }

// ============================================================
// attemptCapture - 完全版フロードフィルロジック
// ============================================================
function attemptCapture(playerId) {
    const p = state.players[playerId];
    if (!p) return;

    const GRID_COLS = state.GRID_COLS;
    const GRID_ROWS = state.GRID_ROWS;
    const totalCells = GRID_COLS * GRID_ROWS;
    const worldGrid = state.worldGrid;
    const players = state.players;

    // 1. Build Base Grid Mask (Existing Territory + Teammates)
    const baseGrid = new Uint8Array(totalCells);
    for (let y = 0; y < GRID_ROWS; y++) {
        const row = worldGrid[y];
        const yOff = y * GRID_COLS;
        for (let x = 0; x < GRID_COLS; x++) {
            const ownerId = row[x];
            if (ownerId === playerId) {
                baseGrid[yOff + x] = 1;
            } else if (isObstacleCell(ownerId)) {
                baseGrid[yOff + x] = 1;
            } else if (p.team && ownerId) {
                const owner = players[ownerId];
                if (owner && owner.team === p.team) {
                    baseGrid[yOff + x] = 1;
                }
            }
        }
    }

    // トレイルセルを収集
    const trailSet = new Uint8Array(totalCells);
    p.gridTrail.forEach(pt => {
        if (pt.x >= 0 && pt.x < GRID_COLS && pt.y >= 0 && pt.y < GRID_ROWS) {
            trailSet[pt.y * GRID_COLS + pt.x] = 1;
        }
    });

    // 統合BFS: baseGrid + trailを壁としたBFSを1回実行
    // trail無しのBFS結果は「baseGridのみを壁とした外部到達性」
    // trail有りのBFS結果は「baseGrid+trailを壁とした外部到達性」
    // 差分 = trailで新たに囲まれた領域
    // 最適化: trailを壁に含めたBFSを実行し、追加でtrailを壁に含めないBFSも実行
    // → 2回のBFSは避けられないが、baseGridの構築は1回で済む

    // BFS with trail as walls (visitedCur)
    const visitedCur = new Uint8Array(totalCells);
    const queue = [];
    let head = 0;

    const tryPushCur = (idx) => {
        if (baseGrid[idx] !== 1 && trailSet[idx] !== 1 && visitedCur[idx] === 0) {
            visitedCur[idx] = 1;
            queue.push(idx);
        }
    };

    for (let x = 0; x < GRID_COLS; x++) { tryPushCur(x); tryPushCur((GRID_ROWS - 1) * GRID_COLS + x); }
    for (let y = 1; y < GRID_ROWS - 1; y++) { tryPushCur(y * GRID_COLS); tryPushCur(y * GRID_COLS + GRID_COLS - 1); }

    while (head < queue.length) {
        const idx = queue[head++];
        const cx = idx % GRID_COLS;
        const cy = (idx - cx) / GRID_COLS;
        if (cx > 0) tryPushCur(idx - 1);
        if (cx < GRID_COLS - 1) tryPushCur(idx + 1);
        if (cy > 0) tryPushCur(idx - GRID_COLS);
        if (cy < GRID_ROWS - 1) tryPushCur(idx + GRID_COLS);
    }

    // BFS without trail (visitedPre) - baseGridのみを壁として
    const visitedPre = new Uint8Array(totalCells);
    const queue2 = [];
    head = 0;

    const tryPushPre = (idx) => {
        if (baseGrid[idx] !== 1 && visitedPre[idx] === 0) {
            visitedPre[idx] = 1;
            queue2.push(idx);
        }
    };

    for (let x = 0; x < GRID_COLS; x++) { tryPushPre(x); tryPushPre((GRID_ROWS - 1) * GRID_COLS + x); }
    for (let y = 1; y < GRID_ROWS - 1; y++) { tryPushPre(y * GRID_COLS); tryPushPre(y * GRID_COLS + GRID_COLS - 1); }

    while (head < queue2.length) {
        const idx = queue2[head++];
        const cx = idx % GRID_COLS;
        const cy = (idx - cx) / GRID_COLS;
        if (cx > 0) tryPushPre(idx - 1);
        if (cx < GRID_COLS - 1) tryPushPre(idx + 1);
        if (cy > 0) tryPushPre(idx - GRID_COLS);
        if (cy < GRID_ROWS - 1) tryPushPre(idx + GRID_COLS);
    }

    // trailSetは既にUint8Arrayで構築済み
    const trailCells = trailSet;  // BFS統合時に構築済みのUint8Arrayを再利用
    const enemyTrailCells = [];
    const blankTrailCells = [];

    p.gridTrail.forEach(pt => {
        if (pt.x >= 0 && pt.x < GRID_COLS && pt.y >= 0 && pt.y < GRID_ROWS) {
            const owner = worldGrid[pt.y][pt.x];
            if (owner && owner !== playerId && !isObstacleCell(owner)) {
                if (p.team) {
                    const ownerPlayer = players[owner];
                    if (ownerPlayer && ownerPlayer.team === p.team) return;
                }
                enemyTrailCells.push({ x: pt.x, y: pt.y, owner });
            } else if (!owner) {
                blankTrailCells.push({ x: pt.x, y: pt.y });
            }
        }
    });

    // 敵陣地Island計算（Uint8Array + index-based BFS）
    const enemyCaptureZone = new Uint8Array(totalCells);
    const processedEnemyCells = new Uint8Array(totalCells);
    const islands = [];

    const nbDirs = [-1, 1, -GRID_COLS, GRID_COLS];

    enemyTrailCells.forEach(startCell => {
        const nbOffsets = [
            startCell.y * GRID_COLS + startCell.x - 1,
            startCell.y * GRID_COLS + startCell.x + 1,
            (startCell.y - 1) * GRID_COLS + startCell.x,
            (startCell.y + 1) * GRID_COLS + startCell.x
        ];
        const nbCoords = [
            { x: startCell.x - 1, y: startCell.y },
            { x: startCell.x + 1, y: startCell.y },
            { x: startCell.x, y: startCell.y - 1 },
            { x: startCell.x, y: startCell.y + 1 }
        ];
        for (let ni = 0; ni < 4; ni++) {
            const nb = nbCoords[ni];
            if (nb.x < 0 || nb.x >= GRID_COLS || nb.y < 0 || nb.y >= GRID_ROWS) continue;
            const nbIdx = nbOffsets[ni];
            const cellOwner = worldGrid[nb.y][nb.x];
            if (!processedEnemyCells[nbIdx] && visitedCur[nbIdx] === 0 && cellOwner === startCell.owner && !trailCells[nbIdx]) {
                const islandCells = [];
                const bfsQueue = [nbIdx];
                let bfsHead = 0;
                processedEnemyCells[nbIdx] = 1;
                islandCells.push(nbIdx);
                while (bfsHead < bfsQueue.length) {
                    const curIdx = bfsQueue[bfsHead++];
                    const cx = curIdx % GRID_COLS;
                    const cy = (curIdx - cx) / GRID_COLS;
                    for (let d = 0; d < 4; d++) {
                        const nIdx = curIdx + nbDirs[d];
                        const nx = cx + (d === 0 ? -1 : d === 1 ? 1 : 0);
                        const ny = cy + (d === 2 ? -1 : d === 3 ? 1 : 0);
                        if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) continue;
                        if (!processedEnemyCells[nIdx]) {
                            const nOwner = worldGrid[ny][nx];
                            if (visitedCur[nIdx] === 0 && nOwner === startCell.owner && !trailCells[nIdx]) {
                                processedEnemyCells[nIdx] = 1;
                                islandCells.push(nIdx);
                                bfsQueue.push(nIdx);
                            }
                        }
                    }
                }
                if (islandCells.length > 0) islands.push({ owner: startCell.owner, cells: islandCells, size: islandCells.length });
            }
        }
    });

    const islandsByOwner = {};
    islands.forEach(island => {
        if (!islandsByOwner[island.owner]) islandsByOwner[island.owner] = [];
        islandsByOwner[island.owner].push(island);
    });

    Object.values(islandsByOwner).forEach(ownerIslands => {
        if (ownerIslands.length > 1) {
            ownerIslands.sort((a, b) => b.size - a.size);
            const maxSize = ownerIslands[0].size;
            if (maxSize <= 10) {
                ownerIslands.forEach(island => island.cells.forEach(idx => { enemyCaptureZone[idx] = 1; }));
            } else {
                for (let i = 1; i < ownerIslands.length; i++) {
                    ownerIslands[i].cells.forEach(idx => { enemyCaptureZone[idx] = 1; });
                }
            }
        }
    });

    // 空白Island計算（Uint8Array + index-based BFS）
    const blankCaptureZone = new Uint8Array(totalCells);
    const processedBlankCells = new Uint8Array(totalCells);
    const blankIslands = [];

    blankTrailCells.forEach(startCell => {
        const nbOffsets = [
            startCell.y * GRID_COLS + startCell.x - 1,
            startCell.y * GRID_COLS + startCell.x + 1,
            (startCell.y - 1) * GRID_COLS + startCell.x,
            (startCell.y + 1) * GRID_COLS + startCell.x
        ];
        const nbCoords = [
            { x: startCell.x - 1, y: startCell.y },
            { x: startCell.x + 1, y: startCell.y },
            { x: startCell.x, y: startCell.y - 1 },
            { x: startCell.x, y: startCell.y + 1 }
        ];
        for (let ni = 0; ni < 4; ni++) {
            const nb = nbCoords[ni];
            if (nb.x < 0 || nb.x >= GRID_COLS || nb.y < 0 || nb.y >= GRID_ROWS) continue;
            const nbIdx = nbOffsets[ni];
            const cellOwner = worldGrid[nb.y][nb.x];
            if (!processedBlankCells[nbIdx] && visitedCur[nbIdx] === 0 && !cellOwner && !trailCells[nbIdx]) {
                const islandCells = [];
                const bfsQueue = [nbIdx];
                let bfsHead = 0;
                processedBlankCells[nbIdx] = 1;
                islandCells.push(nbIdx);
                while (bfsHead < bfsQueue.length) {
                    const curIdx = bfsQueue[bfsHead++];
                    const cx = curIdx % GRID_COLS;
                    const cy = (curIdx - cx) / GRID_COLS;
                    for (let d = 0; d < 4; d++) {
                        const nIdx = curIdx + nbDirs[d];
                        const nx = cx + (d === 0 ? -1 : d === 1 ? 1 : 0);
                        const ny = cy + (d === 2 ? -1 : d === 3 ? 1 : 0);
                        if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) continue;
                        if (!processedBlankCells[nIdx]) {
                            const nOwner = worldGrid[ny][nx];
                            if (visitedCur[nIdx] === 0 && !nOwner && !trailCells[nIdx]) {
                                processedBlankCells[nIdx] = 1;
                                islandCells.push(nIdx);
                                bfsQueue.push(nIdx);
                            }
                        }
                    }
                }
                if (islandCells.length > 0) blankIslands.push({ cells: islandCells, size: islandCells.length });
            }
        }
    });

    if (blankIslands.length > 1) {
        blankIslands.sort((a, b) => b.size - a.size);
        const maxSize = blankIslands[0].size;
        if (maxSize <= 10) {
            blankIslands.forEach(island => island.cells.forEach(idx => { blankCaptureZone[idx] = 1; }));
        } else {
            for (let i = 1; i < blankIslands.length; i++) {
                blankIslands[i].cells.forEach(idx => { blankCaptureZone[idx] = 1; });
            }
        }
    }

    // Capture Step
    let capturedCount = 0;
    let kills = [];

    for (let y = 0; y < GRID_ROWS; y++) {
        for (let x = 0; x < GRID_COLS; x++) {
            const idx = y * GRID_COLS + x;
            const oldOwner = worldGrid[y][x];
            const isNewlyEnclosed = (visitedCur[idx] === 0 && visitedPre[idx] === 1);
            const isEnemyCapturable = enemyCaptureZone[idx] === 1;
            const isBlankCapturable = blankCaptureZone[idx] === 1;

            if ((isNewlyEnclosed || isEnemyCapturable || isBlankCapturable) && !isObstacleCell(oldOwner)) {
                let isTeammate = false;
                if (p.team && oldOwner) {
                    const op = players[oldOwner];
                    if (op && op.team === p.team) isTeammate = true;
                }

                if (oldOwner !== playerId && !isTeammate) {
                    if (oldOwner && players[oldOwner]) {
                        players[oldOwner].score = Math.max(0, (players[oldOwner].score || 0) - 1);
                    }
                    worldGrid[y][x] = playerId;
                    capturedCount++;

                    Object.values(players).forEach(target => {
                        if (target.id !== playerId && target.state === 'active') {
                            if (p.team && target.team === p.team) return;
                            const tgx = toGrid(target.x);
                            const tgy = toGrid(target.y);
                            if (tgx === x && tgy === y) kills.push(target.id);
                        }
                    });
                }
            }
        }
    }

    if (capturedCount > 0) {
        p.score += capturedCount;
        rebuildTerritoryRects();

        if (kills.length > 0 && killPlayerFn) {
            kills.forEach(kid => {
                killPlayerFn(kid, `${p.name}に囲まれた`, true);
                p.kills = (p.kills || 0) + 1;
                // 倒した相手の残り陣地を奪取（ライン切断と同様）
                let stolenCount = 0;
                state.territoryRects.forEach(rect => {
                    if (rect.o === kid) {
                        const gxStart = rect.x / GRID_SIZE;
                        const rgy = rect.y / GRID_SIZE;
                        const gw = rect.w / GRID_SIZE;
                        for (let ddx = 0; ddx < gw; ddx++) {
                            const rgx = gxStart + ddx;
                            if (worldGrid[rgy] && worldGrid[rgy][rgx] === kid) {
                                worldGrid[rgy][rgx] = playerId;
                                stolenCount++;
                            }
                        }
                    }
                });
                if (stolenCount > 0) {
                    p.score += stolenCount;
                    rebuildTerritoryRects();
                }
            });
            rebuildTerritoryRects();
        }
    }

    p.gridTrail = [];
    p.trail = [];
}

// ============================================================
// スコア画面用の国旗位置計算
// ============================================================
function calculateMapFlags() {
    const flags = [];
    const mode = GAME_MODES[state.currentModeIdx];
    
    if (mode !== 'TEAM') return flags;
    
    const teamRectLists = {};
    state.territoryRects.forEach(t => {
        const owner = state.players[t.o];
        if (owner && owner.team) {
            if (!teamRectLists[owner.team]) {
                teamRectLists[owner.team] = [];
            }
            teamRectLists[owner.team].push(t);
        }
    });

    const minClusterArea = (state.WORLD_WIDTH * state.WORLD_HEIGHT) * 0.015;  // 1.5%
    const mergeDistance = 100;

    Object.entries(teamRectLists).forEach(([teamName, rectList]) => {
        // 国旗判定
        const chars = Array.from(teamName);
        if (chars.length < 2) return;
        const first = chars[0].codePointAt(0);
        const second = chars[1].codePointAt(0);
        if (first < 0x1F1E6 || first > 0x1F1FF || second < 0x1F1E6 || second > 0x1F1FF) return;
        const flag = chars[0] + chars[1];

        // クラスタリング
        const clusters = [];
        const used = new Set();

        rectList.forEach((rect, i) => {
            if (used.has(i)) return;

            const cluster = { rects: [rect], totalArea: rect.w * rect.h, sumX: 0, sumY: 0 };
            const area = rect.w * rect.h;
            cluster.sumX = (rect.x + rect.w / 2) * area;
            cluster.sumY = (rect.y + rect.h / 2) * area;
            used.add(i);

            let changed = true;
            while (changed) {
                changed = false;
                rectList.forEach((other, j) => {
                    if (used.has(j)) return;
                    for (const cr of cluster.rects) {
                        const dist = Math.hypot(
                            (cr.x + cr.w / 2) - (other.x + other.w / 2),
                            (cr.y + cr.h / 2) - (other.y + other.h / 2)
                        );
                        if (dist < mergeDistance) {
                            cluster.rects.push(other);
                            const otherArea = other.w * other.h;
                            cluster.totalArea += otherArea;
                            cluster.sumX += (other.x + other.w / 2) * otherArea;
                            cluster.sumY += (other.y + other.h / 2) * otherArea;
                            used.add(j);
                            changed = true;
                            break;
                        }
                    }
                });
            }

            clusters.push(cluster);
        });

        clusters.forEach(cluster => {
            if (cluster.totalArea < minClusterArea) return;

            const centerX = cluster.sumX / cluster.totalArea;
            const centerY = cluster.sumY / cluster.totalArea;

            flags.push({ f: flag, x: centerX, y: centerY });
        });
    });
    
    return flags;
}

// ============================================================
// DB保存関数
// ============================================================
async function saveRankingsToDB(mode, rankings, teamRankings, playerCount) {
    if (!dbPool) return;
    try {
        const conn = await dbPool.getConnection();
        const [roundResult] = await conn.execute(
            'INSERT INTO rounds (mode, played_at, player_count) VALUES (?, ?, ?)',
            [mode, new Date(), playerCount]
        );
        const roundId = roundResult.insertId;

        for (let i = 0; i < rankings.length; i++) {
            const r = rankings[i];
            await conn.execute(
                'INSERT INTO player_rankings (round_id, rank_position, player_name, team, emoji, score, kills) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [roundId, i + 1, r.name || 'Unknown', r.team || '', r.emoji || '', r.score || 0, r.kills || 0]
            );
        }

        for (let i = 0; i < teamRankings.length; i++) {
            const t = teamRankings[i];
            await conn.execute(
                'INSERT INTO team_rankings (round_id, rank_position, team_name, score, kills) VALUES (?, ?, ?, ?, ?)',
                [roundId, i + 1, t.name, t.score || 0, t.kills || 0]
            );
        }

        await saveRoundMinimap(conn, roundId);
        conn.release();
        console.log(`[DB] Saved round #${roundId}`);
    } catch (e) {
        console.error('[DB] Failed to save rankings:', e.message);
    }
}

async function saveRoundMinimap(conn, roundId) {
    try {
        const bm = generateMinimapBitmap();
        const dataToSave = { bm: bm.bm.toString('base64'), cp: bm.cp, sz: bm.sz };
        await conn.execute('INSERT INTO round_minimaps (round_id, minimap_data) VALUES (?, ?)', [roundId, JSON.stringify(dataToSave)]);
    } catch (e) {
        console.error('[DB] Minimap save error:', e.message);
    }
}

async function initDB() {
    if (!dbPool) return;
    try {
        const conn = await dbPool.getConnection();
        
        // ミニマップテーブル
        await conn.query(`
            CREATE TABLE IF NOT EXISTS round_minimaps (
                round_id INT PRIMARY KEY,
                minimap_data MEDIUMBLOB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE
            )
        `);
        
        // AFKタイムアウト記録テーブル
        await conn.query(`
            CREATE TABLE IF NOT EXISTS afk_timeouts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ip_address VARCHAR(45) NOT NULL,
                cf_country VARCHAR(5) DEFAULT NULL,
                cf_ray VARCHAR(50) DEFAULT NULL,
                timeout_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_ip (ip_address),
                INDEX idx_timeout (timeout_at),
                INDEX idx_country (cf_country)
            )
        `);
        
        conn.release();
        console.log('[DB] Tables initialized (minimaps, afk_timeouts)');
    } catch (e) {
        console.error('[DB] Init error:', e);
    }
}

// ============================================================
// exports
// ============================================================
module.exports = {
    // 設定用
    setWss, setMsgpack, setKillPlayer,
    // ヘルパー
    generateId, getUniqueColor, getRandomEmoji, toGrid, getDistSq, formatBytes, formatTime, generateShortId,
    // ゲームロジック
    initGrid, rebuildTerritoryRects, broadcast, getTeamStats, generateMinimapBitmap, calculateMapFlags, attemptCapture,
    // ミニマップ履歴
    saveMinimapSnapshot, clearMinimapHistory, getMinimapHistory,
    // DB
    saveRankingsToDB, initDB,
    // 定数参照
    serverStartTime
};

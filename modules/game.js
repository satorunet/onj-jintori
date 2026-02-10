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
    DEBUG_MODE, INNER_DEBUG_MODE, FORCE_TEAM, STATS_MODE,
    state, bandwidthStats, resetBandwidthStats
} = config;

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

function getUniqueColor() {
    const existingColors = Object.values(state.players).map(p => p.color || '#000000');
    const existingHues = existingColors.map(c => getHueFromHex(c));
    let bestColor = null;
    let maxMinDist = -1;

    for (let i = 0; i < 50; i++) {  // 試行回数を30→50に増加
        const h = Math.floor(Math.random() * 360);
        const s = Math.floor(Math.random() * 20) + 75;  // 彩度を高めに
        const l = Math.floor(Math.random() * 15) + 55;  // 明度を調整

        const aa = s * Math.min(l / 100, 1 - l / 100) / 100;
        const f = n => {
            const k = (n + h / 30) % 12;
            const c = l / 100 - aa * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * c).toString(16).padStart(2, '0');
        };
        const candidateHex = `#${f(0)}${f(8)}${f(4)}`;

        // 既存色と完全一致する場合はスキップ
        if (existingColors.includes(candidateHex)) continue;

        if (existingHues.length === 0) return candidateHex;

        let minDist = 360;
        existingHues.forEach(eh => {
            let diff = Math.abs(h - eh);
            if (diff > 180) diff = 360 - diff;
            if (diff < minDist) minDist = diff;
        });

        // 色相差30度以上なら採用（より厳格に）
        if (minDist > 30) return candidateHex;
        if (minDist > maxMinDist) { maxMinDist = minDist; bestColor = candidateHex; }
    }
    return bestColor || '#88ccff';
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

    for (let i = 0; i < 15; i++) {
        let w = Math.floor(2 + Math.random() * 5);
        let h = Math.floor(2 + Math.random() * 5);
        let gx = Math.floor(Math.random() * (state.GRID_COLS - w));
        let gy = Math.floor(Math.random() * (state.GRID_ROWS - h));

        state.obstacles.push({
            x: gx * GRID_SIZE, y: gy * GRID_SIZE,
            width: w * GRID_SIZE, height: h * GRID_SIZE, type: 'rect'
        });

        for (let y = gy; y < gy + h; y++) {
            for (let x = gx; x < gx + w; x++) {
                state.worldGrid[y][x] = 'obstacle';
            }
        }
    }
    rebuildTerritoryRects();
}

// ============================================================
// テリトリー再構築（差分追跡付き）
// ============================================================
function rebuildTerritoryRects() {
    const newRects = [];
    const processed = Array(state.GRID_ROWS).fill(null).map(() => Array(state.GRID_COLS).fill(false));

    for (let y = 0; y < state.GRID_ROWS; y++) {
        for (let x = 0; x < state.GRID_COLS; x++) {
            if (processed[y][x]) continue;
            const cell = state.worldGrid[y][x];
            if (cell && cell !== 'obstacle') {
                let w = 1;
                while (x + w < state.GRID_COLS && state.worldGrid[y][x + w] === cell && !processed[y][x + w]) w++;
                for (let k = 0; k < w; k++) processed[y][x + k] = true;

                const p = state.players[cell];
                if (p) {
                    newRects.push({ o: cell, c: p.color, x: x * GRID_SIZE, y: y * GRID_SIZE, w: w * GRID_SIZE, h: GRID_SIZE });
                } else {
                    for (let k = 0; k < w; k++) state.worldGrid[y][x + k] = null;
                }
            }
        }
    }

    // 差分検出
    const oldMap = new Map();
    state.territoryRects.forEach(r => oldMap.set(`${r.x},${r.y}`, r));
    const newMap = new Map();
    newRects.forEach(r => newMap.set(`${r.x},${r.y}`, r));

    const added = [];
    newRects.forEach(r => {
        const key = `${r.x},${r.y}`;
        const old = oldMap.get(key);
        if (!old || old.o !== r.o || old.w !== r.w) added.push(r);
    });

    const removed = [];
    state.territoryRects.forEach(r => {
        const key = `${r.x},${r.y}`;
        const newRect = newMap.get(key);
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
                if (owner && owner !== 'obstacle' && palette[owner]) {
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
    const worldGrid = state.worldGrid;
    const players = state.players;

    // 1. Build Base Grid Mask (Existing Territory + Teammates)
    const baseGrid = new Uint8Array(GRID_COLS * GRID_ROWS);
    for (let y = 0; y < GRID_ROWS; y++) {
        for (let x = 0; x < GRID_COLS; x++) {
            const ownerId = worldGrid[y][x];
            if (ownerId === playerId) {
                baseGrid[y * GRID_COLS + x] = 1;
            } else if (p.team && ownerId) {
                const owner = players[ownerId];
                if (owner && owner.team === p.team) {
                    baseGrid[y * GRID_COLS + x] = 1;
                }
            }
        }
    }

    // BFS Helper
    function scan(useTrail) {
        const visited = new Uint8Array(GRID_COLS * GRID_ROWS);
        const queue = [];
        const grid = new Uint8Array(baseGrid);

        if (useTrail) {
            p.gridTrail.forEach(pt => {
                if (pt.x >= 0 && pt.x < GRID_COLS && pt.y >= 0 && pt.y < GRID_ROWS) {
                    grid[pt.y * GRID_COLS + pt.x] = 1;
                }
            });
        }

        const tryPush = (idx) => {
            if (grid[idx] !== 1 && visited[idx] === 0) {
                visited[idx] = 1;
                queue.push(idx);
            }
        };

        for (let x = 0; x < GRID_COLS; x++) { tryPush(x); tryPush((GRID_ROWS - 1) * GRID_COLS + x); }
        for (let y = 1; y < GRID_ROWS - 1; y++) { tryPush(y * GRID_COLS); tryPush(y * GRID_COLS + GRID_COLS - 1); }

        let head = 0;
        while (head < queue.length) {
            const idx = queue[head++];
            const cx = idx % GRID_COLS;
            const cy = Math.floor(idx / GRID_COLS);
            if (cx > 0) tryPush(idx - 1);
            if (cx < GRID_COLS - 1) tryPush(idx + 1);
            if (cy > 0) tryPush(idx - GRID_COLS);
            if (cy < GRID_ROWS - 1) tryPush(idx + GRID_COLS);
        }
        return visited;
    }

    const visitedPre = scan(false);
    const visitedCur = scan(true);

    const trailCells = new Set();
    const enemyTrailCells = [];
    const blankTrailCells = [];

    p.gridTrail.forEach(pt => {
        if (pt.x >= 0 && pt.x < GRID_COLS && pt.y >= 0 && pt.y < GRID_ROWS) {
            trailCells.add(pt.y * GRID_COLS + pt.x);
            const owner = worldGrid[pt.y][pt.x];
            if (owner && owner !== playerId && owner !== 'obstacle') {
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

    // 敵陣地Island計算
    const enemyCaptureZone = new Set();
    const processedEnemyCells = new Set();
    const islands = [];

    enemyTrailCells.forEach(startCell => {
        const neighbors = [
            { x: startCell.x - 1, y: startCell.y }, { x: startCell.x + 1, y: startCell.y },
            { x: startCell.x, y: startCell.y - 1 }, { x: startCell.x, y: startCell.y + 1 }
        ];
        neighbors.forEach(nb => {
            if (nb.x < 0 || nb.x >= GRID_COLS || nb.y < 0 || nb.y >= GRID_ROWS) return;
            const nbIdx = nb.y * GRID_COLS + nb.x;
            const cellOwner = worldGrid[nb.y] && worldGrid[nb.y][nb.x];
            if (!processedEnemyCells.has(nbIdx) && visitedCur[nbIdx] === 0 && cellOwner === startCell.owner && !trailCells.has(nbIdx)) {
                const islandCells = new Set();
                const queue = [nb];
                processedEnemyCells.add(nbIdx);
                islandCells.add(nbIdx);
                while (queue.length > 0) {
                    const { x, y } = queue.shift();
                    [{ x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 }].forEach(n => {
                        if (n.x >= 0 && n.x < GRID_COLS && n.y >= 0 && n.y < GRID_ROWS) {
                            const nIdx = n.y * GRID_COLS + n.x;
                            if (!processedEnemyCells.has(nIdx)) {
                                const nOwner = worldGrid[n.y][n.x];
                                if (visitedCur[nIdx] === 0 && nOwner === startCell.owner && !trailCells.has(nIdx)) {
                                    processedEnemyCells.add(nIdx);
                                    islandCells.add(nIdx);
                                    queue.push(n);
                                }
                            }
                        }
                    });
                }
                if (islandCells.size > 0) islands.push({ owner: startCell.owner, cells: islandCells, size: islandCells.size });
            }
        });
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
                ownerIslands.forEach(island => island.cells.forEach(idx => enemyCaptureZone.add(idx)));
            } else {
                for (let i = 1; i < ownerIslands.length; i++) {
                    ownerIslands[i].cells.forEach(idx => enemyCaptureZone.add(idx));
                }
            }
        }
    });

    // 空白Island計算
    const blankCaptureZone = new Set();
    const processedBlankCells = new Set();
    const blankIslands = [];

    blankTrailCells.forEach(startCell => {
        const neighbors = [
            { x: startCell.x - 1, y: startCell.y }, { x: startCell.x + 1, y: startCell.y },
            { x: startCell.x, y: startCell.y - 1 }, { x: startCell.x, y: startCell.y + 1 }
        ];
        neighbors.forEach(nb => {
            if (nb.x < 0 || nb.x >= GRID_COLS || nb.y < 0 || nb.y >= GRID_ROWS) return;
            const nbIdx = nb.y * GRID_COLS + nb.x;
            const cellOwner = worldGrid[nb.y] && worldGrid[nb.y][nb.x];
            if (!processedBlankCells.has(nbIdx) && visitedCur[nbIdx] === 0 && !cellOwner && !trailCells.has(nbIdx)) {
                const islandCells = new Set();
                const queue = [nb];
                processedBlankCells.add(nbIdx);
                islandCells.add(nbIdx);
                while (queue.length > 0) {
                    const { x, y } = queue.shift();
                    [{ x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 }].forEach(n => {
                        if (n.x >= 0 && n.x < GRID_COLS && n.y >= 0 && n.y < GRID_ROWS) {
                            const nIdx = n.y * GRID_COLS + n.x;
                            if (!processedBlankCells.has(nIdx)) {
                                const nOwner = worldGrid[n.y][n.x];
                                if (visitedCur[nIdx] === 0 && !nOwner && !trailCells.has(nIdx)) {
                                    processedBlankCells.add(nIdx);
                                    islandCells.add(nIdx);
                                    queue.push(n);
                                }
                            }
                        }
                    });
                }
                if (islandCells.size > 0) blankIslands.push({ cells: islandCells, size: islandCells.size });
            }
        });
    });

    if (blankIslands.length > 1) {
        blankIslands.sort((a, b) => b.size - a.size);
        const maxSize = blankIslands[0].size;
        if (maxSize <= 10) {
            blankIslands.forEach(island => island.cells.forEach(idx => blankCaptureZone.add(idx)));
        } else {
            for (let i = 1; i < blankIslands.length; i++) {
                blankIslands[i].cells.forEach(idx => blankCaptureZone.add(idx));
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
            const isEnemyCapturable = enemyCaptureZone.has(idx);
            const isBlankCapturable = blankCaptureZone.has(idx);

            if ((isNewlyEnclosed || isEnemyCapturable || isBlankCapturable) && oldOwner !== 'obstacle') {
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
                killPlayerFn(kid, `${p.name}に囲まれた`);
                p.kills = (p.kills || 0) + 1;
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

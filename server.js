const fs = require('fs');
const https = require('https');
const WebSocket = require('ws');
const crypto = require('crypto');
const zlib = require('zlib');  // 圧縮率計算用
const os = require('os'); // 追加
const msgpack = require('./msgpack.js');

// Debug Mode: node server.js debug または MODE=debug node server.js
const INNER_DEBUG_MODE = process.argv.includes('inner_debug');
const DEBUG_MODE = process.argv.includes('debug') ||
    process.argv.includes('--debug') ||
    process.argv.includes('mode=debug') ||
    process.env.MODE === 'debug' ||
    INNER_DEBUG_MODE;

const FORCE_TEAM = process.argv.includes('stage=team');
const INFINITE_TIME = process.argv.includes('mugen');
const STATS_MODE = process.argv.includes('toukei');

// Configuration
//const PORT = 2087;
const PORT = 2053;
const GAME_DURATION = (DEBUG_MODE || INFINITE_TIME) ? 999999 : 120; // seconds
const RESPAWN_TIME = 3; // seconds
let WORLD_WIDTH = 3000;
let WORLD_HEIGHT = 3000;
const PLAYER_SPEED = 130;
const GRID_SIZE = 10; // Improved solution: Grid-based logic
let GRID_COLS = Math.ceil(WORLD_WIDTH / GRID_SIZE);
let GRID_ROWS = Math.ceil(WORLD_HEIGHT / GRID_SIZE);
const AFK_DEATH_LIMIT = 3;
const SSL_KEY_PATH = '/var/www/sites/nodejs/ssl/node.open2ch.net/pkey.pem';
const SSL_CERT_PATH = '/var/www/sites/nodejs/ssl/node.open2ch.net/cert.pem';

const EMOJIS = ['😀', '😎', '😂', '😍', '🤔', '🤠', '😈', '👻', '👽', '🤖', '💩', '🐱', '🐶', '🦊', '🦁', '🐷', '🦄', '🐲'];
const GAME_MODES = ['SOLO', 'TEAM'];
let currentModeIdx = FORCE_TEAM ? 1 : 0; // 0: Solo, 1: Team

// Server Setup
let server;
try {
    const options = {
        key: fs.readFileSync(SSL_KEY_PATH),
        cert: fs.readFileSync(SSL_CERT_PATH)
    };
    server = https.createServer(options, (req, res) => {
        res.writeHead(200);
        res.end('Game Server Running');
    });
} catch (e) {
    console.warn("SSL Certs not found, falling back to HTTP");
    const http = require('http');
    server = http.createServer((req, res) => res.end('Game Server Running (No SSL)'));
}
const wss = new WebSocket.Server({
    server,
    // gzip圧縮を有効化（転送量30-50%削減）
    perMessageDeflate: {
        zlibDeflateOptions: {
            chunkSize: 1024,
            memLevel: 7,
            level: 3  // 圧縮レベル (1-9, 3は速度と圧縮率のバランス)
        },
        zlibInflateOptions: {
            chunkSize: 10 * 1024
        },
        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        serverMaxWindowBits: 10,
        concurrencyLimit: 10,
        threshold: 1024  // 1KB以上のメッセージのみ圧縮
    }
});

// Game State
let players = {};
// Grid is the source of truth. 
// Values: null (empty), 'obstacle', or ownerId (string)
let worldGrid = [];
// Cached rectangles for client rendering logic: [{ownerId, color, points: [{x,y}...]}, ...]
let territoryRects = [];
let territoriesChanged = true;

// 差分送信用: 追加・削除されたテリトリーを追跡
let territoryVersion = 0;
let pendingTerritoryUpdates = []; // { action: 'add'|'remove', data: rect|{x,y} }
let lastFullSyncVersion = {}; // クライアントごとの最終同期バージョン

// プレイヤー状態キャッシュ（差分検出用）
let lastPlayerStates = {};

// 転送量監視
let bandwidthStats = {
    totalBytesSent: 0,
    totalBytesReceived: 0,
    msgsSent: 0,
    msgsReceived: 0,
    // 直近の統計（リセット可能）
    periodBytesSent: 0,
    periodBytesReceived: 0,
    periodMsgsSent: 0,
    periodMsgsReceived: 0,
    periodFullSyncs: 0,      // フル同期回数
    periodDeltaSyncs: 0,     // 差分同期回数
    // 圧縮率サンプリング
    lastSampleOriginal: 0,   // 最後のサンプル元サイズ
    lastSampleCompressed: 0, // 最後のサンプル圧縮後サイズ
    periodStart: Date.now(),
    // CPU Stats
    lastTickTime: Date.now(),
    cpuUserStart: process.cpuUsage().user,
    cpuSystemStart: process.cpuUsage().system,
    lagSum: 0,
    lagMax: 0,
    ticks: 0,
    // 機能別送信量 (ラウンド単位)
    breakdown: {
        players: 0,         // プレイヤーデータ (p)
        territoryFull: 0,   // テリトリー全量 (tf)
        territoryDelta: 0,  // テリトリー差分 (td)
        minimap: 0,         // ミニマップ (mm)
        teams: 0,           // チーム統計 (te)
        base: 0,            // ベース情報 (type, tm)
        other: 0            // その他 (round_end, chat, death等)
    },
    // 受信機能別
    received: {
        input: 0,           // 移動入力 [dx, dy]
        join: 0,            // 参加リクエスト
        chat: 0,            // チャット
        updateTeam: 0,      // チーム更新
        other: 0            // その他
    }
};

let obstacles = [];
let timeRemaining = GAME_DURATION;
let roundActive = true;
let lastRoundWinner = null;
let lastResultMsg = null;

// ミニマップビットマップ設定
const MINIMAP_SIZE = 80;  // 80x80ピクセル
const MINIMAP_SCALE = WORLD_WIDTH / MINIMAP_SIZE;  // ダウンサンプル比率
let minimapBitmapCache = null;  // 生成されたビットマップキャッシュ
let minimapColorPalette = {};   // プレイヤーID → 色インデックス (1-255, 0は空)

// Initialization
function initGrid() {
    // Dynamic World Size Logic
    const pCount = Object.keys(players).length;
    const baseSize = 2000;
    const size = Math.min(5000, Math.max(1500, baseSize + pCount * 100));
    WORLD_WIDTH = size;
    WORLD_HEIGHT = size;
    GRID_COLS = Math.ceil(WORLD_WIDTH / GRID_SIZE);
    GRID_ROWS = Math.ceil(WORLD_HEIGHT / GRID_SIZE);

    worldGrid = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(null));
    obstacles = [];

    // Generate obstacles aligned to grid
    for (let i = 0; i < 15; i++) {
        let w = Math.floor(2 + Math.random() * 5); // 2-7 cells wide
        let h = Math.floor(2 + Math.random() * 5);
        let gx = Math.floor(Math.random() * (GRID_COLS - w));
        let gy = Math.floor(Math.random() * (GRID_ROWS - h));

        obstacles.push({
            x: gx * GRID_SIZE,
            y: gy * GRID_SIZE,
            width: w * GRID_SIZE,
            height: h * GRID_SIZE,
            type: 'rect'
        });

        for (let y = gy; y < gy + h; y++) {
            for (let x = gx; x < gx + w; x++) {
                worldGrid[y][x] = 'obstacle';
            }
        }
    }

    // DEBUG: Fill World
    /*
    if (INNER_DEBUG_MODE) {
        players['DEBUG_FULL_OWNER'] = {
            id: 'DEBUG_FULL_OWNER',
            color: '#333333',
            name: 'WORLD',
            state: 'active',
            team: 'CPU',
            x: -1, y: -1,
            gridTrail: [],
            trail: [],
            score: 0,
            kills: 0
        };
        for (let y = 0; y < GRID_ROWS; y++) {
            for (let x = 0; x < GRID_COLS; x++) {
                if (worldGrid[y][x] !== 'obstacle') {
                    worldGrid[y][x] = 'DEBUG_FULL_OWNER';
                }
            }
        }
    }
    */

    rebuildTerritoryRects(); // Initial empty
}
initGrid();

// Helpers
function generateId() { return crypto.randomBytes(4).toString('hex'); }
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
    const existingHues = Object.values(players)
        .map(p => getHueFromHex(p.color || '#000000'));

    let bestColor = null;
    let maxMinDist = -1;

    // Try multiple candidates to maximize hue distance
    for (let i = 0; i < 30; i++) {
        const h = Math.floor(Math.random() * 360);
        const s = Math.floor(Math.random() * 30) + 70; // 70-100% Saturation (Vibrant Pastel)
        const l = Math.floor(Math.random() * 20) + 60; // 60-80% Lightness (Bright)

        // HSL to Hex
        const aa = s * Math.min(l / 100, 1 - l / 100) / 100;
        const f = n => {
            const k = (n + h / 30) % 12;
            const c = l / 100 - aa * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * c).toString(16).padStart(2, '0');
        };
        const candidateHex = `#${f(0)}${f(8)}${f(4)}`;

        if (existingHues.length === 0) return candidateHex;

        let minDist = 360;
        existingHues.forEach(eh => {
            let diff = Math.abs(h - eh);
            if (diff > 180) diff = 360 - diff;
            if (diff < minDist) minDist = diff;
        });

        // Optimization: If distance is large enough (> 45 deg), return immediately
        if (minDist > 45) return candidateHex;

        if (minDist > maxMinDist) {
            maxMinDist = minDist;
            bestColor = candidateHex;
        }
    }
    return bestColor || '#88ccff';
}
function getRandomEmoji() { return EMOJIS[Math.floor(Math.random() * EMOJIS.length)]; }
function toGrid(val) { return Math.floor(val / GRID_SIZE); }

// Core Game Logic: Rebuilds the visual rectangles from the grid state
// Merges adjacent horizontal cells to reduce object count
// 差分追跡機能付き
function rebuildTerritoryRects() {
    const newRects = [];

    const processed = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(false));

    for (let y = 0; y < GRID_ROWS; y++) {
        for (let x = 0; x < GRID_COLS; x++) {
            if (processed[y][x]) continue;

            const cell = worldGrid[y][x];
            if (cell && cell !== 'obstacle') {
                let w = 1;
                while (x + w < GRID_COLS && worldGrid[y][x + w] === cell && !processed[y][x + w]) {
                    w++;
                }

                for (let k = 0; k < w; k++) processed[y][x + k] = true;

                const p = players[cell];
                if (p) {
                    newRects.push({
                        o: cell,        // ownerId (短縮)
                        c: p.color,     // color (短縮)
                        x: x * GRID_SIZE,
                        y: y * GRID_SIZE,
                        w: w * GRID_SIZE,
                        h: GRID_SIZE
                        // pointsは削除 - クライアント側で計算
                    });
                } else {
                    for (let k = 0; k < w; k++) worldGrid[y][x + k] = null;
                }
            }
        }
    }

    // 差分検出: 古いrectsと新しいrectsを比較
    const oldMap = new Map();
    territoryRects.forEach(r => {
        const key = `${r.x},${r.y}`;
        oldMap.set(key, r);
    });

    const newMap = new Map();
    newRects.forEach(r => {
        const key = `${r.x},${r.y}`;
        newMap.set(key, r);
    });

    // 追加されたもの（新規 or オーナー/幅が変わったもの）
    const added = [];
    newRects.forEach(r => {
        const key = `${r.x},${r.y}`;
        const old = oldMap.get(key);
        if (!old || old.o !== r.o || old.w !== r.w) {
            added.push(r);
        }
    });

    // 削除されたもの（完全に消えた or オーナー/幅が変わったもの）
    const removed = [];
    territoryRects.forEach(r => {
        const key = `${r.x},${r.y}`;
        const newRect = newMap.get(key);
        // 完全に消えた場合
        if (!newRect) {
            removed.push({ x: r.x, y: r.y });
        }
        // オーナーや幅が変わった場合も「古い方を削除」として通知
        else if (newRect.o !== r.o || newRect.w !== r.w) {
            removed.push({ x: r.x, y: r.y });
        }
    });

    // 変更があった場合のみ更新
    if (added.length > 0 || removed.length > 0) {
        territoryVersion++;
        pendingTerritoryUpdates.push({
            v: territoryVersion,
            a: added,    // added
            r: removed   // removed
        });

        // 古い更新を削除 (最新10件のみ保持)
        if (pendingTerritoryUpdates.length > 10) {
            pendingTerritoryUpdates.shift();
        }

        territoriesChanged = true;
    }

    territoryRects = newRects;
}

// Flood Fill Capture Logic
function attemptCapture(playerId) {
    const p = players[playerId];
    if (!p) return;

    // 1. Build Base Grid Mask (Existing Territory + Teammates)
    const baseGrid = new Uint8Array(GRID_COLS * GRID_ROWS); // 0=Empty, 1=Wall
    for (let y = 0; y < GRID_ROWS; y++) {
        for (let x = 0; x < GRID_COLS; x++) {
            const ownerId = worldGrid[y][x];
            if (ownerId === playerId) {
                baseGrid[y * GRID_COLS + x] = 1;
            } else if (p.team && ownerId) {
                const owner = players[ownerId];
                if (owner && owner.team === p.team) {
                    baseGrid[y * GRID_COLS + x] = 1; // Mark Teammate as Wall
                }
            }
        }
    }

    // BFS Helper
    function scan(useTrail) {
        const visited = new Uint8Array(GRID_COLS * GRID_ROWS); // 0=unvisited(Inside/Wall), 1=visited(Outside)
        const queue = [];

        // Prepare grid with trail if needed
        // Note: 'baseGrid' currently holds (Existing + Teammates)
        // If useTrail, we overlay trail onto a copy (or logically)
        // Optimization: checking trail is expensive? Trail is short.

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

        // Seed edges
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

    // Pass 1: Scan without trail (Identify existing holes)
    const visitedPre = scan(false);

    // Pass 2: Scan with trail (Identify new enclosed areas)
    const visitedCur = scan(true);

    // トレイルで直接通ったセルを記録
    const trailCells = new Set();
    // トレイルで通過した敵陣地のセルを記録（座標とオーナー）
    const enemyTrailCells = [];
    // トレイルで通過した空白セルを記録
    const blankTrailCells = [];

    p.gridTrail.forEach(pt => {
        if (pt.x >= 0 && pt.x < GRID_COLS && pt.y >= 0 && pt.y < GRID_ROWS) {
            trailCells.add(pt.y * GRID_COLS + pt.x);
            // この位置の所有者が敵なら記録
            const owner = worldGrid[pt.y][pt.x];
            if (owner && owner !== playerId && owner !== 'obstacle') {
                // チームメイトは除外
                if (p.team) {
                    const ownerPlayer = players[owner];
                    if (ownerPlayer && ownerPlayer.team === p.team) return;
                }
                enemyTrailCells.push({ x: pt.x, y: pt.y, owner });
            } else if (!owner || owner === null || owner === '') {
                // 空白セルを記録
                blankTrailCells.push({ x: pt.x, y: pt.y });
            }
        }
    });

    // 敵陣地のキャプチャ可能ゾーンを計算
    // トレイルで分断された各領域（連結成分）を特定し、最大の領域以外（囲った部分）をキャプチャする
    const enemyCaptureZone = new Set();
    const processedEnemyCells = new Set();
    const islands = []; // [{ size: number, cells: Set<idx>, owner: id }]

    enemyTrailCells.forEach(startCell => {
        // startCell自体はトレイル上の点なので、その隣接点から探索を開始する
        const neighbors = [
            { x: startCell.x - 1, y: startCell.y },
            { x: startCell.x + 1, y: startCell.y },
            { x: startCell.x, y: startCell.y - 1 },
            { x: startCell.x, y: startCell.y + 1 }
        ];

        neighbors.forEach(nb => {
            if (nb.x < 0 || nb.x >= GRID_COLS || nb.y < 0 || nb.y >= GRID_ROWS) return;
            const nbIdx = nb.y * GRID_COLS + nb.x;

            const cellOwner = worldGrid[nb.y] && worldGrid[nb.y][nb.x];
            // まだ処理していない、かつ「現在の内側」で「同じ敵の陣地」かつ「トレイル上ではない」なら探索開始
            if (!processedEnemyCells.has(nbIdx) && visitedCur[nbIdx] === 0 && cellOwner === startCell.owner && !trailCells.has(nbIdx)) {

                // 新しい連結成分（Island）の探索
                const islandCells = new Set();
                const queue = [nb];
                processedEnemyCells.add(nbIdx);
                islandCells.add(nbIdx);

                while (queue.length > 0) {
                    const { x, y } = queue.shift();

                    const nextNeighbors = [
                        { x: x - 1, y: y }, { x: x + 1, y: y },
                        { x: x, y: y - 1 }, { x: x, y: y + 1 }
                    ];

                    nextNeighbors.forEach(n => {
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

                if (islandCells.size > 0) {
                    islands.push({
                        owner: startCell.owner,
                        cells: islandCells,
                        size: islandCells.size
                    });
                }
            }
        });
    });

    // 各敵IDごとに、最大のIslandを残し、それ以外をキャプチャ対象にする
    const islandsByOwner = {};
    islands.forEach(island => {
        if (!islandsByOwner[island.owner]) islandsByOwner[island.owner] = [];
        islandsByOwner[island.owner].push(island);
    });

    Object.values(islandsByOwner).forEach(ownerIslands => {
        if (ownerIslands.length > 1) {
            // サイズで降順ソート
            ownerIslands.sort((a, b) => b.size - a.size);
            const maxSize = ownerIslands[0].size;

            // 例外処理: 最大のIslandでも10セル以下なら全てキャプチャ（小さい穴は全部埋める）
            if (maxSize <= 10) {
                ownerIslands.forEach(island => {
                    island.cells.forEach(idx => enemyCaptureZone.add(idx));
                });
            } else {
                // 通常処理: 最大のもの（index 0）を除外、それ以外をキャプチャ対象に追加
                for (let i = 1; i < ownerIslands.length; i++) {
                    ownerIslands[i].cells.forEach(idx => enemyCaptureZone.add(idx));
                }
            }
        }
        // 分断されていない（length=1）場合はキャプチャしない
    });

    // 空白地のキャプチャゾーン計算
    // トレイルで分断された空白地をIslandに分割し、最大以外をキャプチャ（敵陣地と同様の処理）
    const blankCaptureZone = new Set();
    const processedBlankCells = new Set();
    const blankIslands = []; // [{ cells: Set<idx>, size: number }]

    blankTrailCells.forEach(startCell => {
        const neighbors = [
            { x: startCell.x - 1, y: startCell.y },
            { x: startCell.x + 1, y: startCell.y },
            { x: startCell.x, y: startCell.y - 1 },
            { x: startCell.x, y: startCell.y + 1 }
        ];

        neighbors.forEach(nb => {
            if (nb.x < 0 || nb.x >= GRID_COLS || nb.y < 0 || nb.y >= GRID_ROWS) return;
            const nbIdx = nb.y * GRID_COLS + nb.x;

            const cellOwner = worldGrid[nb.y] && worldGrid[nb.y][nb.x];
            // まだ処理していない、「内側」で「空白」かつ「トレイル上ではない」なら探索
            if (!processedBlankCells.has(nbIdx) && visitedCur[nbIdx] === 0 && !cellOwner && !trailCells.has(nbIdx)) {
                const islandCells = new Set();
                const queue = [nb];
                processedBlankCells.add(nbIdx);
                islandCells.add(nbIdx);

                while (queue.length > 0) {
                    const { x, y } = queue.shift();
                    const nextNeighbors = [
                        { x: x - 1, y: y }, { x: x + 1, y: y },
                        { x: x, y: y - 1 }, { x: x, y: y + 1 }
                    ];

                    nextNeighbors.forEach(n => {
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

                if (islandCells.size > 0) {
                    blankIslands.push({ cells: islandCells, size: islandCells.size });
                }
            }
        });
    });

    // 空白Islandが複数ある場合（分断された場合）、最大以外をキャプチャ対象に
    // ※敵陣地と同じロジック: 分断されていない（length=1）場合はキャプチャしない
    if (blankIslands.length > 1) {
        blankIslands.sort((a, b) => b.size - a.size);
        const maxSize = blankIslands[0].size;

        // 例外処理: 最大のIslandでも10セル以下なら全てキャプチャ（小さい穴は全部埋める）
        if (maxSize <= 10) {
            blankIslands.forEach(island => {
                island.cells.forEach(idx => blankCaptureZone.add(idx));
            });
        } else {
            // 通常処理: 最大のもの（index 0）を除外、それ以外をキャプチャ対象に追加
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

            // Capture Condition:
            // 1. Must be Inside now (visitedCur == 0)
            // 2. Must be Outside before (visitedPre == 1) -> This excludes existing holes
            // 3. Not an obstacle
            const isNewlyEnclosed = (visitedCur[idx] === 0 && visitedPre[idx] === 1);

            // トレイルから連続している敵陣地のキャプチャ可能ゾーン（分断された小さい方）
            const isEnemyCapturable = enemyCaptureZone.has(idx);

            // トレイルで通過した空白から連続する空白地のキャプチャゾーン
            const isBlankCapturable = blankCaptureZone.has(idx);

            if ((isNewlyEnclosed || isEnemyCapturable || isBlankCapturable) && oldOwner !== 'obstacle') {

                let isTeammate = false;
                if (p.team && oldOwner) {
                    const op = players[oldOwner];
                    if (op && op.team === p.team) isTeammate = true;
                }

                // If not teammate territory, we capture it
                if (oldOwner !== playerId && !isTeammate) {
                    worldGrid[y][x] = playerId;
                    capturedCount++;

                    // Kill check
                    Object.values(players).forEach(target => {
                        if (target.id !== playerId && target.state === 'active') {
                            if (p.team && target.team === p.team) return; // Team safe
                            const tgx = toGrid(target.x);
                            const tgy = toGrid(target.y);
                            if (tgx === x && tgy === y) {
                                kills.push(target.id);
                            }
                        }
                    });
                }
            }
        }
    }

    if (capturedCount > 0) {
        p.score += capturedCount;
        rebuildTerritoryRects();

        // 囲まれたプレイヤーを処理
        if (kills.length > 0) {
            kills.forEach(kid => {
                killPlayer(kid, "囲まれた");
                p.kills = (p.kills || 0) + 1;
            });
            // killPlayerで陣地がワイプされるので、再度rebuildが必要
            rebuildTerritoryRects();
        }
    }

    p.gridTrail = []; // Clear trail
    p.trail = [];
}

// Game Loop
let lastTime = Date.now();
setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    if (!roundActive) return;

    if (Math.floor(now / 1000) > Math.floor((now - dt * 1000) / 1000)) {
        timeRemaining--;



        if (timeRemaining <= 0) endRound();
    }

    Object.values(players).forEach(p => {
        if (p.state !== 'active') return;
        // Skip Debug Dummies
        if (p.id === 'DEBUG_FULL_OWNER' || p.id === 'DEBUG_ENEMY') return;

        // Auto-run if AFK at spawn for 5 seconds
        if (!p.hasMovedSinceSpawn && !p.autoRun && p.spawnTime && (now - p.spawnTime > 5000)) {
            const angle = Math.random() * Math.PI * 2;
            p.dx = Math.cos(angle);
            p.dy = Math.sin(angle);
            p.autoRun = true;
            p.invulnerableUntil = 0;
        }

        // Capture previous grid position for gap-fixing
        const prevGx = toGrid(p.x);
        const prevGy = toGrid(p.y);

        // Move
        let nextX = p.x + p.dx * PLAYER_SPEED * dt;
        let nextY = p.y + p.dy * PLAYER_SPEED * dt;

        // Bounds Check
        if (nextX < 0 || nextX >= WORLD_WIDTH || nextY < 0 || nextY >= WORLD_HEIGHT) {
            killPlayer(p.id, "壁に激突");
            return;
        }

        // Invulnerable
        const isInvuln = (p.invulnerableUntil && now < p.invulnerableUntil);

        // Grid Coords
        const gx = toGrid(nextX);
        const gy = toGrid(nextY);

        // Obstacle Check
        if (!isInvuln && worldGrid[gy][gx] === 'obstacle') {
            killPlayer(p.id, "障害物に激突");
            return;
        }

        // Movement commit
        p.x = nextX;
        p.y = nextY;

        // Interaction with Other Players (Trail Cutting & Head-on)
        if (!isInvuln) {
            Object.values(players).forEach(target => {
                if (target.id === p.id || target.state !== 'active' || (p.team && target.team === p.team)) return;

                // ターゲットが無敵なら相互作用しない（フェアな仕様）
                const targetInvuln = (target.invulnerableUntil && now < target.invulnerableUntil);
                if (targetInvuln) return;

                const tgx = toGrid(target.x);
                const tgy = toGrid(target.y);

                // Head-on Collision
                if (gx === tgx && gy === tgy) {
                    // Kamikaze Prevention: If either player is small (<= 100 status), the smaller one dies.
                    if (p.score <= 100 || target.score <= 100) {
                        if (p.score < target.score) {
                            target.kills = (target.kills || 0) + 1;
                            killPlayer(p.id, "正面衝突(敗北)");
                            return; // Target survives
                        } else if (target.score < p.score) {
                            p.kills = (p.kills || 0) + 1;
                            killPlayer(target.id, "正面衝突(敗北)");
                            return;
                        } else {
                            killPlayer(p.id, "正面衝突");
                            killPlayer(target.id, "正面衝突");
                            return;
                        }
                    } else {
                        killPlayer(p.id, "正面衝突");
                        killPlayer(target.id, "正面衝突");
                        return;
                    }
                }

                // Cut Enemy Trail (Precise Line Segment Check)
                let hitTrail = false;
                if (target.trail.length > 0) {
                    // Check segments in trail
                    for (let i = 0; i < target.trail.length - 1; i++) {
                        if (getDistSq(p.x, p.y, target.trail[i].x, target.trail[i].y, target.trail[i + 1].x, target.trail[i + 1].y) < 225) { // 15^2 radius
                            hitTrail = true; break;
                        }
                    }
                    // Check last segment to current head
                    if (!hitTrail) {
                        const last = target.trail[target.trail.length - 1];
                        if (getDistSq(p.x, p.y, last.x, last.y, target.x, target.y) < 225) hitTrail = true;
                    }
                }

                if (hitTrail) {
                    killPlayer(target.id, `${p.name}に切られた`, true);
                    p.score += 500;
                    p.kills = (p.kills || 0) + 1;

                    let stolen = false;
                    for (let y = 0; y < GRID_ROWS; y++) {
                        for (let x = 0; x < GRID_COLS; x++) {
                            if (worldGrid[y][x] === target.id) {
                                worldGrid[y][x] = p.id;
                                stolen = true;
                            }
                        }
                    }
                    if (stolen) rebuildTerritoryRects();
                }
            });
        }

        if (p.state === 'dead') return;

        // Reading / Capture Logic
        const cellOwnerId = worldGrid[gy][gx];
        const cellOwner = players[cellOwnerId];
        const isInsideOwn = (cellOwnerId === p.id) || (p.team && cellOwner && cellOwner.team === p.team);

        if (isInsideOwn) {
            if (p.gridTrail.length > 0) {
                attemptCapture(p.id);
                p.trail = []; // Clear precise trail on capture
            }
            p.gridTrail = [];
            p.trail = [];
        } else {
            // GAP FIX
            if (p.gridTrail.length === 0) {
                if (prevGx >= 0 && prevGx < GRID_COLS && prevGy >= 0 && prevGy < GRID_ROWS) {
                    if (worldGrid[prevGy][prevGx] === p.id) {
                        p.gridTrail.push({ x: prevGx, y: prevGy });
                        p.trail.push({ x: prevGx * GRID_SIZE + GRID_SIZE / 2, y: prevGy * GRID_SIZE + GRID_SIZE / 2 });
                    }
                }
            }

            // Check if new cell (Grid-based trigger, but precise storage)
            // Check if new cell (Interpolated)
            const lastT = p.gridTrail.length > 0 ? p.gridTrail[p.gridTrail.length - 1] : null;

            if (lastT && (lastT.x !== gx || lastT.y !== gy)) {
                // Self-Intersection Check (Precise)
                let hitSelf = false;
                if (p.trail.length > 10) {
                    for (let i = 0; i < p.trail.length - 10; i++) {
                        if (getDistSq(p.x, p.y, p.trail[i].x, p.trail[i].y, p.trail[i + 1].x, p.trail[i + 1].y) < 64) {
                            hitSelf = true; break;
                        }
                    }
                }

                if (hitSelf) {
                    killPlayer(p.id, "自爆");
                } else {
                    // Interpolate Grid Points to prevent gaps (4-connected)
                    const dx = gx - lastT.x;
                    const dy = gy - lastT.y;
                    const steps = Math.max(Math.abs(dx), Math.abs(dy));
                    for (let i = 1; i <= steps; i++) {
                        const igx = Math.round(lastT.x + dx * i / steps);
                        const igy = Math.round(lastT.y + dy * i / steps);

                        let prev = p.gridTrail[p.gridTrail.length - 1];

                        // Prevent diagonal jumps by inserting corner
                        if (prev.x !== igx && prev.y !== igy) {
                            p.gridTrail.push({ x: igx, y: prev.y });
                            prev = p.gridTrail[p.gridTrail.length - 1]; // Update prev
                        }

                        if (prev.x === igx && prev.y === igy) continue;
                        p.gridTrail.push({ x: igx, y: igy });
                    }
                    p.trail.push({ x: p.x, y: p.y });
                }
            } else if (!lastT) {
                // First point
                p.gridTrail.push({ x: gx, y: gy });
                p.trail.push({ x: p.x, y: p.y });
            }
        }
    });

}, 50);


// Standard Functions
function respawnPlayer(p, fullReset = false) {
    p.state = 'active';
    p.gridTrail = [];
    p.trail = []; // Clear pixel trail
    p.isDrawing = false;
    p.hasMovedSinceSpawn = false; // Reset AFK tracking
    p.autoRun = false; // Reset Auto-Run
    p.dx = 0; p.dy = 0; // Stop movement until input
    p.dx = 0;
    p.dy = 0;
    p.spawnTime = Date.now();
    p.hasMovedSinceSpawn = false;
    p.invulnerableUntil = Date.now() + 3000;
    if (fullReset) { p.score = 0; p.afkDeaths = 0; p.kills = 0; }

    // Safe Spawn Search
    let safe = false;
    // Team Spawn Logic
    let teamCenter = null;
    if (p.team) {
        const teammates = Object.values(players).filter(op => op.id !== p.id && op.team === p.team && op.state === 'active');
        if (teammates.length > 0) {
            const mate = teammates[Math.floor(Math.random() * teammates.length)];
            teamCenter = { x: mate.x, y: mate.y };
        }
    }

    for (let i = 0; i < 100; i++) {
        let tx, ty;

        if (teamCenter && i < 50) { // Try near teammate first 50 attempts
            const angle = Math.random() * Math.PI * 2;
            const dist = 100 + Math.random() * 300; // 100-400px range
            tx = teamCenter.x + Math.cos(angle) * dist;
            ty = teamCenter.y + Math.sin(angle) * dist;
            // Bounds
            tx = Math.max(100, Math.min(WORLD_WIDTH - 100, tx));
            ty = Math.max(100, Math.min(WORLD_HEIGHT - 100, ty));
        } else {
            tx = Math.floor(Math.random() * (WORLD_WIDTH - 200) + 100);
            ty = Math.floor(Math.random() * (WORLD_HEIGHT - 200) + 100);
        }
        const gx = toGrid(tx);
        const gy = toGrid(ty);
        // Check larger area for obstacles due to smaller grid
        let obs = false;
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                if (worldGrid[gy + dy] && worldGrid[gy + dy][gx + dx] === 'obstacle') obs = true;
            }
        }
        if (!obs) {
            p.x = tx; p.y = ty; safe = true; break;
        }
    }
    if (!safe) { p.x = 1000; p.y = 1000; } // Fallback

    // Initial safe zone (Increased to 7x7 grid to match old physical size)
    const startGx = toGrid(p.x);
    const startGy = toGrid(p.y);
    for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
            if (worldGrid[startGy + dy]) worldGrid[startGy + dy][startGx + dx] = p.id;
        }
    }
    rebuildTerritoryRects();

    // DEBUG: Create Enemy Territory INSIDE my territory
    if (INNER_DEBUG_MODE && p.id !== 'DEBUG_FULL_OWNER' && p.id !== 'DEBUG_ENEMY') {
        setTimeout(() => {
            if (p.state !== 'active') return;
            const px = toGrid(p.x);
            const py = toGrid(p.y);

            // 1. 自分の陣地を大きくする (30x30)
            const mySize = 30;
            const myOffset = -15; // プレイヤー中心
            for (let dy = 0; dy < mySize; dy++) {
                for (let dx = 0; dx < mySize; dx++) {
                    const ty = py + myOffset + dy;
                    const tx = px + myOffset + dx;
                    if (ty >= 0 && ty < GRID_ROWS && tx >= 0 && tx < GRID_COLS) {
                        if (worldGrid[ty][tx] !== 'obstacle') {
                            worldGrid[ty][tx] = p.id;
                        }
                    }
                }
            }

            // 2. その中に敵陣地を作る (10x10) - 少し右にずらす
            const enemySize = 10;
            const enemyOffsetX = 2;
            const enemyOffsetY = -5;

            // Create Enemy Player if not exists
            if (!players['DEBUG_ENEMY']) {
                players['DEBUG_ENEMY'] = {
                    id: 'DEBUG_ENEMY',
                    color: '#FF0000',
                    name: 'ENEMY',
                    state: 'active',
                    team: 'CPU2',
                    x: -1, y: -1,
                    gridTrail: [],
                    trail: [],
                    score: 0,
                    kills: 0
                };
            }

            // Draw Enemy Territory
            let changed = false;
            for (let dy = 0; dy < enemySize; dy++) {
                for (let dx = 0; dx < enemySize; dx++) {
                    const ty = py + enemyOffsetY + dy;
                    const tx = px + enemyOffsetX + dx;
                    if (ty >= 0 && ty < GRID_ROWS && tx >= 0 && tx < GRID_COLS) {
                        if (worldGrid[ty][tx] !== 'obstacle') {
                            worldGrid[ty][tx] = 'DEBUG_ENEMY';
                            changed = true;
                        }
                    }
                }
            }
            if (changed) rebuildTerritoryRects();
        }, 1000);
    }
}

function killPlayer(id, reason, skipWipe = false) {
    const p = players[id];
    if (p && p.state === 'active') {
        const deadX = Math.round(p.x);
        const deadY = Math.round(p.y);
        console.log(`[DEATH] Player ${p.name || id} (${id}) DIED. Reason: ${reason} at [${deadX}, ${deadY}]`);

        p.state = 'dead';
        p.dx = 0; p.dy = 0;
        p.gridTrail = [];
        p.trail = [];
        p.score = 0; // Reset score

        // Wipe Territory (unless skipped, e.g. stolen)
        if (!skipWipe) {
            let wiped = false;
            for (let y = 0; y < GRID_ROWS; y++) {
                for (let x = 0; x < GRID_COLS; x++) {
                    if (worldGrid[y][x] === id) {
                        worldGrid[y][x] = null;
                        wiped = true;
                    }
                }
            }
            if (wiped) rebuildTerritoryRects();
        }

        broadcast({ type: 'player_death', id, reason });

        // AFK Logic
        if (!p.hasMovedSinceSpawn) {
            p.afkDeaths++;
            console.log(`[AFK] Player ${id} AFK Count: ${p.afkDeaths}/${AFK_DEATH_LIMIT}`);
            if (p.afkDeaths >= AFK_DEATH_LIMIT) {
                console.log(`[KICK] Player ${id} kicked due to AFK limit.`);
                if (p.ws.readyState === WebSocket.OPEN) {
                    p.ws.close(4000, "AFK Timeout");
                }
                delete players[id];
                return;
            }
        } else {
            p.afkDeaths = 0;
        }

        setTimeout(() => { if (players[id]) respawnPlayer(players[id]); }, RESPAWN_TIME * 1000);
    }
}

function endRound() {
    roundActive = false;

    // ラウンド終了時の転送量統計出力（デバッグモードのみ）
    if (STATS_MODE) printRoundStats();

    // Rank logic
    const rankings = Object.values(players)
        .filter(p => p.state !== 'waiting' && (p.score > 0 || (p.kills && p.kills > 0)))
        .sort((a, b) => (b.score - a.score) || ((b.kills || 0) - (a.kills || 0)))
        .slice(0, 10)
        .map(p => ({
            name: p.name, score: p.score, emoji: p.emoji, color: p.color, kills: p.kills || 0, team: p.team
        }));

    // Team Rank logic
    const teamScores = {};
    const teamKills = {};
    Object.values(players).forEach(p => {
        if (p.state !== 'waiting' && p.team && (p.score > 0 || (p.kills && p.kills > 0))) {
            if (!teamScores[p.team]) { teamScores[p.team] = 0; teamKills[p.team] = 0; }
            teamScores[p.team] += p.score || 0;
            teamKills[p.team] += p.kills || 0;
        }
    });
    const teamRankings = Object.keys(teamScores).map(team => ({
        name: team, score: teamScores[team], kills: teamKills[team] || 0
    })).sort((a, b) => b.score - a.score).slice(0, 5);

    // Determine Next Mode Preview
    const nextModeIdx = FORCE_TEAM ? 1 : ((currentModeIdx + 1) % GAME_MODES.length);
    const nextMode = GAME_MODES[nextModeIdx];

    // Calculate Team Member Counts for Selection UI
    const allTeams = getTeamStats();
    const totalPlayers = Object.keys(players).length;

    const resultMsg = { type: 'round_end', rankings, teamRankings, winner: rankings[0], nextMode: nextMode, allTeams: allTeams, totalPlayers };
    lastResultMsg = resultMsg;
    broadcast(resultMsg);
    setTimeout(() => {
        initGrid();
        // Reset game state
        // Rotate Mode
        if (!FORCE_TEAM) {
            currentModeIdx = (currentModeIdx + 1) % GAME_MODES.length;
        }
        const mode = GAME_MODES[currentModeIdx];

        territoryRects = [];
        territoryVersion = 0;  // バージョンリセット
        pendingTerritoryUpdates = [];  // 差分キューリセット
        lastFullSyncVersion = {};  // 全クライアント再同期
        roundActive = true;
        timeRemaining = (mode === 'TEAM') ? GAME_DURATION + 120 : GAME_DURATION;

        // ラウンド統計リセット
        resetRoundStats();

        console.log(`[ROUND] Starting Round: ${mode}`);

        const activePlayers = Object.values(players).filter(p => p.ws.readyState === WebSocket.OPEN);

        if (mode === 'SOLO') {
            activePlayers.forEach(p => {
                p.team = '';
                // Randomize Color every round
                p.color = getUniqueColor();
                // Ensure unique (redundant if getUniqueColor works well, but safe)
                if (activePlayers.some(op => op.id !== p.id && op.color === p.color)) p.color = getUniqueColor();

                // Clean Name
                p.name = p.name.replace(/^\[.*?\]\s*/, '');
            });
        } else {
            // TEAM - Restore requested
            // First pass: Reset to requested
            activePlayers.forEach(p => {
                p.team = p.requestedTeam || '';
                p.name = p.name.replace(/^\[.*?\]\s*/, ''); // Strip previous tags
                if (p.team) {
                    p.name = `[${p.team}] ${p.name}`;
                }
                // Reset to original color initially
                p.color = p.originalColor || getUniqueColor();
            });
            // Second pass: Unify team colors
            const teamColors = {};
            activePlayers.forEach(p => {
                if (p.team) {
                    if (!teamColors[p.team]) teamColors[p.team] = getUniqueColor(); // Assign new stable color for team
                    p.color = teamColors[p.team];
                }
            });
        }

        // Respawn all connected players
        // Sort by team
        activePlayers.sort((a, b) => (a.team || '').localeCompare(b.team || ''));

        activePlayers.forEach(p => {
            respawnPlayer(p, true);
        });

        broadcast({
            type: 'round_start',
            mode: mode,
            obstacles: obstacles,
            world: { width: WORLD_WIDTH, height: WORLD_HEIGHT }
        });
        lastResultMsg = null;
    }, 15000); // 15 seconds
}


function broadcast(msg) {
    const payload = msgpack.encode(msg);
    const byteLen = payload.length;
    let sentCount = 0;
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) {
            c.send(payload);
            sentCount++;
        }
    });
    // 転送量記録
    bandwidthStats.totalBytesSent += byteLen * sentCount;
    bandwidthStats.periodBytesSent += byteLen * sentCount;
    bandwidthStats.msgsSent += sentCount;
    bandwidthStats.periodMsgsSent += sentCount;
}

function getTeamStats() {
    const counts = {};
    Object.values(players).forEach(p => {
        const t = p.requestedTeam || p.team;
        if (t) {
            counts[t] = (counts[t] || 0) + 1;
        }
    });
    return Object.keys(counts)
        .sort((a, b) => counts[b] - counts[a])
        .map(name => ({ name, count: counts[name] }));
}

// ミニマップビットマップ生成 (80x80ピクセル)
// 返り値: { bm: Base64圧縮ビットマップ, cp: 色パレット配列 }
function generateMinimapBitmap() {
    const scale = WORLD_WIDTH / MINIMAP_SIZE;
    const gridScale = scale / GRID_SIZE;  // 1ミニマップピクセル = 何グリッドセルか

    // 色パレット構築: 現在のプレイヤーID → インデックス (1-255)
    const palette = {};  // id -> index
    const colors = [''];  // index 0 = 空 (透明/背景)
    let colorIdx = 1;

    Object.values(players).forEach(p => {
        if (p.state !== 'waiting' && !palette[p.id]) {
            palette[p.id] = colorIdx;
            colors[colorIdx] = p.color;
            colorIdx++;
            if (colorIdx > 255) colorIdx = 255; // 最大255プレイヤー
        }
    });

    // ビットマップ生成 (80x80 = 6400 bytes)
    const bitmap = new Uint8Array(MINIMAP_SIZE * MINIMAP_SIZE);

    for (let my = 0; my < MINIMAP_SIZE; my++) {
        for (let mx = 0; mx < MINIMAP_SIZE; mx++) {
            // このミニマップピクセルに対応するグリッド中心座標
            const gx = Math.floor((mx + 0.5) * gridScale);
            const gy = Math.floor((my + 0.5) * gridScale);

            // グリッド範囲チェック
            if (gy >= 0 && gy < GRID_ROWS && gx >= 0 && gx < GRID_COLS) {
                const owner = worldGrid[gy][gx];
                if (owner && owner !== 'obstacle' && palette[owner]) {
                    bitmap[my * MINIMAP_SIZE + mx] = palette[owner];
                }
                // 0 = 空 or 障害物
            }
        }
    }

    // gzip圧縮 → Base64エンコード
    const compressed = zlib.deflateSync(Buffer.from(bitmap), { level: 6 });
    const base64 = compressed.toString('base64');

    return {
        bm: base64,      // bitmap (Base64 gzip)
        cp: colors,      // color palette (index -> hex color)
        sz: MINIMAP_SIZE // size (常に80だが互換性のため)
    };
}

// Network
wss.on('connection', ws => {
    const id = generateId();
    const color = getUniqueColor();
    const emoji = getRandomEmoji();

    // WebSocketにplayerIdを記録（差分同期用）
    ws.playerId = id;
    lastFullSyncVersion[id] = territoryVersion;

    players[id] = {
        id, color, emoji, name: id.substr(0, 2),
        x: 0, y: 0, dx: 0, dy: 0,
        gridTrail: [], trail: [],
        score: 0, state: 'waiting',
        ws, invulnerableUntil: 0,
        afkDeaths: 0, hasMovedSinceSpawn: false,
        originalColor: color, requestedTeam: '', kills: 0
    };

    // 初期データ送信（テリトリーバージョン含む）
    ws.send(JSON.stringify({
        type: 'init', id, color, emoji,
        world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
        mode: GAME_MODES[currentModeIdx],
        obstacles,
        tf: territoryRects,  // territories full
        tv: territoryVersion,  // territory version
        teams: getTeamStats()
    }));

    if (!roundActive && lastResultMsg) {
        ws.send(JSON.stringify(lastResultMsg));
    }

    ws.on('message', msg => {
        // 受信量記録
        const byteLen = Buffer.byteLength(msg, 'utf8');
        bandwidthStats.totalBytesReceived += byteLen;
        bandwidthStats.periodBytesReceived += byteLen;
        bandwidthStats.msgsReceived++;
        bandwidthStats.periodMsgsReceived++;

        try {
            const data = JSON.parse(msg);
            const p = players[id];
            if (!p) return;
            if (data.type === 'join') {
                bandwidthStats.received.join += byteLen;
                let name = data.name || 'NoName';
                let team = data.team || '';
                // Sanitize
                name = name.replace(/[\[\]]/g, '');
                team = team.replace(/[\[\]]/g, '').substr(0, 3);

                p.requestedTeam = team;
                const mode = GAME_MODES[currentModeIdx];

                if (mode === 'SOLO') {
                    p.team = '';
                    p.color = p.originalColor;
                    p.name = name;
                } else {
                    // TEAM MODE
                    p.team = team;
                    if (team) {
                        p.name = `[${team}] ${name}`;
                        // Team Color Inheritance
                        const teammate = Object.values(players).find(op => op.id !== p.id && op.team === team);
                        if (teammate) {
                            p.color = teammate.color;
                        } else {
                            // First in team: Check conflict with current color
                            const conflict = Object.values(players).some(op => op.id !== p.id && op.color === p.color);
                            if (conflict) p.color = getUniqueColor();
                        }
                    } else {
                        p.name = name;
                        const conflict = Object.values(players).some(op => op.id !== p.id && op.color === p.color);
                        if (conflict) p.color = getUniqueColor();
                    }
                }

                respawnPlayer(p, true);
            } else if (data.type === 'update_team') {
                bandwidthStats.received.updateTeam += byteLen;
                let team = data.team || '';
                team = team.replace(/[\[\]]/g, '').substr(0, 3);
                p.requestedTeam = team;
            } else if (data.type === 'chat') {
                bandwidthStats.received.chat += byteLen;
                const text = (data.text || '').toString().substring(0, 50);
                if (text.trim().length > 0) {
                    broadcast({ type: 'chat', text: text, color: p.color, name: p.name });
                    bandwidthStats.breakdown.other += 50; // chat送信の概算
                }
            } else if (Array.isArray(data) && data.length === 2 && p.state === 'active') {
                bandwidthStats.received.input += byteLen;
                // 移動コマンド: 配列形式 [dx, dy] で最軽量化
                const dx = data[0];
                const dy = data[1];
                p.hasMovedSinceSpawn = true;
                p.autoRun = false;
                p.afkDeaths = 0;

                const mag = Math.sqrt(dx * dx + dy * dy);
                if (mag > 0) {
                    p.dx = dx / mag;
                    p.dy = dy / mag;
                    p.invulnerableUntil = 0;
                }
            } else {
                bandwidthStats.received.other += byteLen;
            }
        } catch (e) { }
    });
    ws.on('close', (e) => {
        delete players[id];
        delete lastFullSyncVersion[id];  // メモリリーク防止
    });
});

// Broadcast Loop - 最適化版
let frameCount = 0;

setInterval(() => {
    const now = Date.now();
    // ラグ計測 (予定150msに対するズレ)
    const dt = now - bandwidthStats.lastTickTime;
    const lag = Math.max(0, dt - 150);
    bandwidthStats.lagSum += lag;
    bandwidthStats.lagMax = Math.max(bandwidthStats.lagMax, lag);
    bandwidthStats.ticks++;
    bandwidthStats.lastTickTime = now;

    if (!roundActive) return;
    frameCount++;

    // 1. 全プレイヤーデータの準備（ソース）
    const allPlayersData = Object.values(players).map(p => {
        const trail = p.gridTrail.length > 0
            ? p.gridTrail.map(pt => [pt.x * GRID_SIZE + 5, pt.y * GRID_SIZE + 5])
            : [];
        return {
            i: p.id,
            x: Math.round(p.x),
            y: Math.round(p.y),
            c: p.color,
            n: p.name,
            e: p.emoji,
            t: p.team,
            r: trail,
            s: p.score,
            st: p.state === 'active' ? 1 : (p.state === 'dead' ? 0 : 2),
            iv: (p.invulnerableUntil && now < p.invulnerableUntil) ? Math.ceil((p.invulnerableUntil - now) / 1000) : 0
        };
    });

    // 2. ミニマップ用データ（3秒に1回生成）
    // 新方式: ビットマップ + プレイヤー位置 (テリトリーは圧縮ビットマップ、プレイヤーは座標リスト)
    let minimapData = null;
    if (frameCount % 20 === 0) { // 150ms * 20 = 3000ms (3秒)
        // テリトリービットマップ生成
        const territoryBitmap = generateMinimapBitmap();

        // プレイヤー位置（軽量: id, x, y, color のみ）
        const playerPositions = allPlayersData.map(p => ({
            i: p.i,
            x: p.x,
            y: p.y,
            c: p.c
        }));

        minimapData = {
            tb: territoryBitmap,  // territory bitmap { bm, cp, sz }
            pl: playerPositions   // player list
        };
    }

    // 3. 共通ステート（領土情報など）
    const baseStateMsg = {
        type: 's',
        tm: timeRemaining,
        te: getTeamStats()
    };


    // テリトリー差分（複数のrebuildがあった場合はマージして送信）
    if (territoriesChanged) {
        if (pendingTerritoryUpdates.length > 0) {
            // すべての差分をマージ
            const mergedAdded = [];
            const mergedRemoved = [];
            const addedKeys = new Set();
            const removedKeys = new Set();

            pendingTerritoryUpdates.forEach(update => {
                // 追加をマージ（同じ座標は上書き）
                if (update.a) {
                    update.a.forEach(a => {
                        const key = `${a.x},${a.y}`;
                        if (!addedKeys.has(key)) {
                            addedKeys.add(key);
                            mergedAdded.push(a);
                        }
                    });
                }
                // 削除をマージ（重複を避ける）
                if (update.r) {
                    update.r.forEach(r => {
                        const key = `${r.x},${r.y}`;
                        if (!removedKeys.has(key)) {
                            removedKeys.add(key);
                            mergedRemoved.push(r);
                        }
                    });
                }
            });

            baseStateMsg.td = {
                v: territoryVersion,
                a: mergedAdded,
                r: mergedRemoved
            };
            baseStateMsg.tv = territoryVersion;

            // 送信後にクリア
            pendingTerritoryUpdates = [];
        }
        territoriesChanged = false;
    }

    // 4. クライアントごとに個別送信 (AOI計算)
    wss.clients.forEach(c => {
        if (c.readyState !== WebSocket.OPEN) return;

        const myPlayer = players[c.playerId];
        const myX = myPlayer ? myPlayer.x : world.width / 2;
        const myY = myPlayer ? myPlayer.y : world.height / 2;

        // AOIフィルタリング (視界範囲: 画面幅の少し外側まで)
        // 画面幅が最大2000程度と仮定し、2500px以内を送信
        const VISIBLE_DIST_SQ = 2500 * 2500;

        const visiblePlayers = allPlayersData.filter(p => {
            // 自分自身は常に含める
            if (p.i === c.playerId) return true;
            // 距離計算
            const distSq = (p.x - myX) ** 2 + (p.y - myY) ** 2;
            return distSq < VISIBLE_DIST_SQ;
        });

        // メッセージ構築
        const msg = {
            ...baseStateMsg,
            p: visiblePlayers
        };

        // ミニマップデータを添付（該当時のみ）
        if (minimapData) {
            msg.mm = minimapData;
        }

        // フル同期チェック
        const lastVersion = lastFullSyncVersion[c.playerId] || 0;
        if (territoryVersion - lastVersion > 50 || lastVersion === 0) {
            msg.tf = territoryRects;
            msg.tv = territoryVersion;
            delete msg.td;
            lastFullSyncVersion[c.playerId] = territoryVersion;
            bandwidthStats.periodFullSyncs++;
        } else {
            bandwidthStats.periodDeltaSyncs++;
        }

        // 個別エンコード（AOIのため必須）
        const payload = msgpack.encode(msg);
        c.send(payload);

        // 統計更新
        const byteLen = payload.length;
        bandwidthStats.totalBytesSent += byteLen;
        bandwidthStats.periodBytesSent += byteLen;
        bandwidthStats.msgsSent++;
        bandwidthStats.periodMsgsSent++;

        // 機能別サイズ計測（サンプリング: 20回に1回のみ）
        if (frameCount % 20 === 1) {
            try {
                // 各フィールドの推定サイズ（個別エンコード）
                bandwidthStats.breakdown.base += msgpack.encode({ type: msg.type, tm: msg.tm }).length;
                bandwidthStats.breakdown.teams += msgpack.encode({ te: msg.te }).length;
                bandwidthStats.breakdown.players += msgpack.encode({ p: msg.p }).length;
                if (msg.mm) bandwidthStats.breakdown.minimap += msgpack.encode({ mm: msg.mm }).length;
                if (msg.tf) bandwidthStats.breakdown.territoryFull += msgpack.encode({ tf: msg.tf }).length;
                if (msg.td) bandwidthStats.breakdown.territoryDelta += msgpack.encode({ td: msg.td }).length;
            } catch (e) { /* ignore */ }
        }
    });
}, 150);  // 100ms → 150ms に変更（秒間約6.7回、さらに33%削減）

function getDistSq(px, py, vx, vy, wx, wy) {
    const l2 = (vx - wx) ** 2 + (vy - wy) ** 2;
    if (l2 === 0) return (px - vx) ** 2 + (py - vy) ** 2;
    let t = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
    t = Math.max(0, Math.min(1, t));
    return (px - (vx + t * (wx - vx))) ** 2 + (py - (vy + t * (wy - vy))) ** 2;
}

// サーバー起動時刻
const serverStartTime = Date.now();

// 単位変換ヘルパー
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

// ラウンド統計をリセット
function resetRoundStats() {
    bandwidthStats.periodBytesSent = 0;
    bandwidthStats.periodBytesReceived = 0;
    bandwidthStats.periodMsgsSent = 0;
    bandwidthStats.periodMsgsReceived = 0;
    bandwidthStats.periodFullSyncs = 0;
    bandwidthStats.periodDeltaSyncs = 0;
    bandwidthStats.lastSampleOriginal = 0;
    bandwidthStats.lastSampleCompressed = 0;
    bandwidthStats.periodStart = Date.now();
    bandwidthStats.roundPlayerCount = Object.keys(players).length;
    bandwidthStats.roundMode = GAME_MODES[currentModeIdx];

    // 機能別内訳リセット
    bandwidthStats.breakdown = {
        players: 0,
        territoryFull: 0,
        territoryDelta: 0,
        minimap: 0,
        teams: 0,
        base: 0,
        other: 0
    };
    bandwidthStats.received = {
        input: 0,
        join: 0,
        chat: 0,
        updateTeam: 0,
        other: 0
    };
}

// ラウンド終了時の統計出力
// ラウンド終了時の統計出力
function printRoundStats() {
    const now = Date.now();
    const roundDuration = (now - bandwidthStats.periodStart) / 1000;
    const playerCount = bandwidthStats.roundPlayerCount || Object.keys(players).length;
    const activePlayerCount = Object.values(players).filter(p => p.state === 'active').length;
    const uptimeSec = (now - serverStartTime) / 1000;
    const mode = bandwidthStats.roundMode || GAME_MODES[currentModeIdx];

    // CPU Usage Calculation
    let cpuPercent = 0;
    if (process.cpuUsage && bandwidthStats.cpuUserStart !== undefined) {
        const cpuUsage = process.cpuUsage();
        const userDiff = cpuUsage.user - bandwidthStats.cpuUserStart;
        const sysDiff = cpuUsage.system - bandwidthStats.cpuSystemStart;
        const totalCpuTime = (userDiff + sysDiff) / 1000000;
        cpuPercent = (totalCpuTime / roundDuration) * 100;

        // Reset for next round
        bandwidthStats.cpuUserStart = cpuUsage.user;
        bandwidthStats.cpuSystemStart = cpuUsage.system;
    }

    // Load Average
    let loadAvgStr = "N/A";
    try {
        const os = require('os');
        const la = os.loadavg();
        loadAvgStr = la[0].toFixed(2);
    } catch (e) { }

    // Event Loop Lag
    const avgLag = bandwidthStats.ticks > 0 ? (bandwidthStats.lagSum / bandwidthStats.ticks).toFixed(1) : 0;
    const maxLag = bandwidthStats.lagMax || 0;

    // Reset Lag stats for next round
    bandwidthStats.lagSum = 0;
    bandwidthStats.lagMax = 0;
    bandwidthStats.ticks = 0;

    // 転送レート計算
    const sendRate = roundDuration > 0 ? bandwidthStats.periodBytesSent / roundDuration : 0;
    const recvRate = roundDuration > 0 ? bandwidthStats.periodBytesReceived / roundDuration : 0;

    // 1人あたりの転送量
    const perPlayerSent = playerCount > 0 ? bandwidthStats.periodBytesSent / playerCount : 0;
    const perPlayerRate = playerCount > 0 ? sendRate / playerCount : 0;

    // 1メッセージあたりの平均サイズ
    const avgMsgSize = bandwidthStats.periodMsgsSent > 0
        ? bandwidthStats.periodBytesSent / bandwidthStats.periodMsgsSent
        : 0;

    // 圧縮率計算
    let compressionInfo = '計測なし';
    let estimatedCompressed = 0;
    if (bandwidthStats.lastSampleOriginal > 0 && bandwidthStats.lastSampleCompressed > 0) {
        const ratio = (1 - bandwidthStats.lastSampleCompressed / bandwidthStats.lastSampleOriginal) * 100;
        // 推定実転送: 元サイズではなく、圧縮後の推定
        estimatedCompressed = bandwidthStats.periodBytesSent;

        // もし圧縮してなかったら？（逆算）
        const originalEstimated = bandwidthStats.periodBytesSent / (bandwidthStats.lastSampleCompressed / bandwidthStats.lastSampleOriginal);
        compressionInfo = `${ratio.toFixed(1)}%削減 (推定実転送: ${formatBytes(bandwidthStats.periodBytesSent)})`;
    }

    // 1日/1月の予測
    const dailySend = sendRate * 60 * 60 * 24;
    const monthlySend = dailySend * 30;

    // 機能別内訳の計算
    const bd = bandwidthStats.breakdown;
    const totalBreakdown = bd.players + bd.territoryFull + bd.territoryDelta + bd.minimap + bd.teams + bd.base + bd.other;
    const calcPercent = (val) => totalBreakdown > 0 ? ((val / totalBreakdown) * 100).toFixed(1) : '0.0';

    const rv = bandwidthStats.received;
    const totalReceived = rv.input + rv.join + rv.chat + rv.updateTeam + rv.other;
    const calcRecvPercent = (val) => totalReceived > 0 ? ((val / totalReceived) * 100).toFixed(1) : '0.0';

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                📊 ラウンド終了 - 転送量＆負荷統計レポート                     ║');
    console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
    console.log('║ ⚡ 実装中の負荷対策: [MsgPack] [AOI(Distance)] [Minimap Bitmap]              ║');
    console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
    console.log(`║ 🕐 稼働: ${formatTime(uptimeSec).padEnd(15)} | ラウンド: ${formatTime(roundDuration)}`);
    console.log(`║ 💻 CPU使用率: ${cpuPercent.toFixed(1)}% | LA(1m): ${loadAvgStr} | 平均ラグ: ${avgLag}ms (Max: ${maxLag}ms)`);
    console.log(`║ 🎮 モード: ${mode.padEnd(10)} | 接続数: ${playerCount}人 (アクティブ: ${activePlayerCount}人)`);
    console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
    console.log(`║ 🗺️  テリトリー数: ${territoryRects.length} rect | バージョン: ${territoryVersion}`);
    console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
    console.log(`║ 📡 ラウンド送信 (サーバ→クライアント): ${formatBytes(bandwidthStats.periodBytesSent).padEnd(10)} (${formatBytes(sendRate)}/s)`);
    console.log(`║ 📥 ラウンド受信 (クライアント→サーバ): ${formatBytes(bandwidthStats.periodBytesReceived).padEnd(10)} (${formatBytes(recvRate)}/s)`);
    console.log(`║ 👤 1人あたり送信: ${formatBytes(perPlayerSent).padEnd(10)}  (${formatBytes(perPlayerRate)}/s)`);
    console.log(`║ 📦 平均メッセージサイズ: ${formatBytes(avgMsgSize)}`);
    console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
    console.log('║ 📊 【送信内訳 (サンプリング値, Server→Client)】                              ║');
    console.log(`║   👥 プレイヤーデータ (p):  ${formatBytes(bd.players).padEnd(10)} ${calcPercent(bd.players).padStart(5)}%`);
    console.log(`║   🗺️  テリトリー全量 (tf): ${formatBytes(bd.territoryFull).padEnd(10)} ${calcPercent(bd.territoryFull).padStart(5)}%`);
    console.log(`║   📝 テリトリー差分 (td): ${formatBytes(bd.territoryDelta).padEnd(10)} ${calcPercent(bd.territoryDelta).padStart(5)}%`);
    console.log(`║   🔍 ミニマップ (mm):      ${formatBytes(bd.minimap).padEnd(10)} ${calcPercent(bd.minimap).padStart(5)}%`);
    console.log(`║   👯 チーム統計 (te):      ${formatBytes(bd.teams).padEnd(10)} ${calcPercent(bd.teams).padStart(5)}%`);
    console.log(`║   🏷️  ベース情報:          ${formatBytes(bd.base).padEnd(10)} ${calcPercent(bd.base).padStart(5)}%`);
    console.log(`║   📦 その他:              ${formatBytes(bd.other).padEnd(10)} ${calcPercent(bd.other).padStart(5)}%`);
    console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
    console.log('║ 📥 【受信内訳 (Client→Server)】                                              ║');
    console.log(`║   🎮 移動入力:    ${formatBytes(rv.input).padEnd(10)} ${calcRecvPercent(rv.input).padStart(5)}%`);
    console.log(`║   🚀 参加:        ${formatBytes(rv.join).padEnd(10)} ${calcRecvPercent(rv.join).padStart(5)}%`);
    console.log(`║   💬 チャット:    ${formatBytes(rv.chat).padEnd(10)} ${calcRecvPercent(rv.chat).padStart(5)}%`);
    console.log(`║   🏷️  チーム変更:  ${formatBytes(rv.updateTeam).padEnd(10)} ${calcRecvPercent(rv.updateTeam).padStart(5)}%`);
    console.log(`║   📦 その他:      ${formatBytes(rv.other).padEnd(10)} ${calcRecvPercent(rv.other).padStart(5)}%`);
    console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
    console.log(`║ 🔄 同期回数: フル ${bandwidthStats.periodFullSyncs} | 差分 ${bandwidthStats.periodDeltaSyncs}`);
    console.log(`║ 🗜️  gzip圧縮効果: ${compressionInfo}`);
    console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
    console.log(`║ 📊 [累計] 送信(→クライアント): ${formatBytes(bandwidthStats.totalBytesSent).padEnd(10)} | 受信(←クライアント): ${formatBytes(bandwidthStats.totalBytesReceived || 0)}`);
    console.log(`║ 🔮 [予測] このペースで1日: ${formatBytes(dailySend).padEnd(8)} | 1月: ${formatBytes(monthlySend)}`);
    console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
    console.log('');

    // JSON形式でも出力 (コピペ用)
    const statsJson = {
        timestamp: new Date().toISOString(),
        uptimeSec: Math.round(uptimeSec),
        roundDurationSec: Math.round(roundDuration),
        mode: mode,
        playerCount: playerCount,
        activePlayerCount: activePlayerCount,
        territoryRects: territoryRects.length,
        territoryVersion: territoryVersion,
        periodBytesSent: bandwidthStats.periodBytesSent,
        periodBytesReceived: bandwidthStats.periodBytesReceived,
        sendRateBps: Math.round(sendRate),
        recvRateBps: Math.round(recvRate),
        perPlayerSent: Math.round(perPlayerSent),
        perPlayerRateBps: Math.round(perPlayerRate),
        avgMsgSize: Math.round(avgMsgSize),
        fullSyncs: bandwidthStats.periodFullSyncs,
        deltaSyncs: bandwidthStats.periodDeltaSyncs,
        cpuPercent: parseFloat(cpuPercent.toFixed(1)),
        loadAvg1m: parseFloat(loadAvgStr) || 0,
        avgLagMs: parseFloat(avgLag),
        maxLagMs: maxLag,
        totalBytesSent: bandwidthStats.totalBytesSent,
        totalBytesReceived: bandwidthStats.totalBytesReceived || 0,
        // 機能別内訳
        breakdown: {
            players: bd.players,
            territoryFull: bd.territoryFull,
            territoryDelta: bd.territoryDelta,
            minimap: bd.minimap,
            teams: bd.teams,
            base: bd.base,
            other: bd.other
        },
        received: {
            input: rv.input,
            join: rv.join,
            chat: rv.chat,
            updateTeam: rv.updateTeam,
            other: rv.other
        }
    };
    console.log('[STATS_JSON]' + JSON.stringify(statsJson));
}

initGrid();
server.listen(PORT, () => console.log("Server Grid Mode Started " + PORT));

if (DEBUG_MODE) {
    console.log('[DEBUG] デバッグモードで起動しました');
}
if (STATS_MODE) {
    console.log('[STATS] 統計モードで起動しました - ラウンド終了時に転送量統計を出力します');
}

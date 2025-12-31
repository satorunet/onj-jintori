const fs = require('fs');
const https = require('https');
const WebSocket = require('ws');
const crypto = require('crypto');

// Configuration
//const PORT = 2087;
const PORT = 2053;
const GAME_DURATION = 120; // seconds
const RESPAWN_TIME = 3; // seconds
let WORLD_WIDTH = 10000;
let WORLD_HEIGHT = 10000;
const PLAYER_SPEED = 130;
const GRID_SIZE = 10; // Improved solution: Grid-based logic
let GRID_COLS = Math.ceil(WORLD_WIDTH / GRID_SIZE);
let GRID_ROWS = Math.ceil(WORLD_HEIGHT / GRID_SIZE);
const AFK_DEATH_LIMIT = 3;
const SSL_KEY_PATH = '/var/www/sites/nodejs/ssl/node.open2ch.net/pkey.pem';
const SSL_CERT_PATH = '/var/www/sites/nodejs/ssl/node.open2ch.net/cert.pem';

const EMOJIS = ['😀', '😎', '😂', '😍', '🤔', '🤠', '😈', '👻', '👽', '🤖', '💩', '🐱', '🐶', '🦊', '🦁', '🐷', '🦄', '🐲'];
const GAME_MODES = ['SOLO', 'TEAM'];
let currentModeIdx = 0; // 0: Solo, 1: Team

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
const wss = new WebSocket.Server({ server });

// Game State
let players = {};
// Grid is the source of truth. 
// Values: null (empty), 'obstacle', or ownerId (string)
let worldGrid = [];
// Cached rectangles for client rendering logic: [{ownerId, color, points: [{x,y}...]}, ...]
let territoryRects = [];
let territoriesChanged = true;
let obstacles = [];
let timeRemaining = GAME_DURATION;
let roundActive = true;
let lastRoundWinner = null;
let lastResultMsg = null;

// Initialization
function initGrid() {
    // Fixed World Size
    // WORLD_WIDTH/HEIGHT are set globally
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
function rebuildTerritoryRects() {
    const newRects = [];

    // Scan by owner
    // Since we need to group by owner potentially, or just push rects.
    // Pushing raw rects is fine, the client handles grouping via color/ID.

    const processed = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(false));

    for (let y = 0; y < GRID_ROWS; y++) {
        for (let x = 0; x < GRID_COLS; x++) {
            if (processed[y][x]) continue;

            const cell = worldGrid[y][x];
            if (cell && cell !== 'obstacle') {
                // Found a territory cell. Expand horizontally.
                let w = 1;
                while (x + w < GRID_COLS && worldGrid[y][x + w] === cell && !processed[y][x + w]) {
                    w++;
                }

                // Mark processed
                for (let k = 0; k < w; k++) processed[y][x + k] = true;

                // Add Rect
                // Find color from player (if active) or store color in grid? 
                // Grid currently only stores ownerId. We Need color.
                // We'll look up player. If player invalid/gone, maybe we clear territory?
                // For now, look up player.
                const p = players[cell];
                if (p) {
                    newRects.push({
                        ownerId: cell,
                        color: p.color,
                        x: x * GRID_SIZE,
                        y: y * GRID_SIZE,
                        w: w * GRID_SIZE,
                        h: GRID_SIZE,
                        points: [
                            { x: x * GRID_SIZE, y: y * GRID_SIZE },
                            { x: (x + w) * GRID_SIZE, y: y * GRID_SIZE },
                            { x: (x + w) * GRID_SIZE, y: (y + 1) * GRID_SIZE },
                            { x: x * GRID_SIZE, y: (y + 1) * GRID_SIZE }
                        ]
                    });
                } else {
                    // Player left? Clear cell? Or keep as debris?
                    // For simplicity, clear cell if player not found
                    for (let k = 0; k < w; k++) worldGrid[y][x + k] = null;
                }
            }
        }
    }
    territoryRects = newRects;
    territoriesChanged = true;
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

    // Capture Step
    let capturedCount = 0;
    let kills = [];

    for (let y = 0; y < GRID_ROWS; y++) {
        for (let x = 0; x < GRID_COLS; x++) {
            const idx = y * GRID_COLS + x;

            // Capture Condition:
            // 1. Must be Inside now (visitedCur == 0)
            // 2. Must be Outside before (visitedPre == 1) -> This excludes existing holes
            // 3. Not an obstacle
            if (visitedCur[idx] === 0 && visitedPre[idx] === 1 && worldGrid[y][x] !== 'obstacle') {
                const oldOwner = worldGrid[y][x];

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
        kills.forEach(kid => {
            killPlayer(kid, "囲まれた");
            p.kills = (p.kills || 0) + 1;
        });
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
                            killPlayer(target.id, "正面衝突(敗北)", true);
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
                    // Interpolate Grid Points to prevent gaps
                    const dx = gx - lastT.x;
                    const dy = gy - lastT.y;
                    const steps = Math.max(Math.abs(dx), Math.abs(dy));
                    for (let i = 1; i <= steps; i++) {
                        const igx = Math.round(lastT.x + dx * i / steps);
                        const igy = Math.round(lastT.y + dy * i / steps);
                        const prev = p.gridTrail[p.gridTrail.length - 1];
                        // Avoid duplicates logic
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
    const nextModeIdx = (currentModeIdx + 1) % GAME_MODES.length;
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
        currentModeIdx = (currentModeIdx + 1) % GAME_MODES.length;
        const mode = GAME_MODES[currentModeIdx];

        territoryRects = [];
        roundActive = true;
        timeRemaining = (mode === 'TEAM') ? GAME_DURATION + 120 : GAME_DURATION;

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
    const s = JSON.stringify(msg);
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(s); });
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

// Network
wss.on('connection', ws => {
    const id = generateId();
    const color = getUniqueColor();
    const emoji = getRandomEmoji();
    players[id] = {
        id, color, emoji, name: id.substr(0, 2),
        x: 0, y: 0, dx: 0, dy: 0,
        gridTrail: [], trail: [],
        score: 0, state: 'waiting',
        ws, invulnerableUntil: 0,
        afkDeaths: 0, hasMovedSinceSpawn: false,
        originalColor: color, requestedTeam: '', kills: 0
    };

    ws.send(JSON.stringify({
        type: 'init', id, color, emoji,
        world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
        mode: GAME_MODES[currentModeIdx],
        obstacles,
        territories: territoryRects,
        teams: getTeamStats()
    }));

    if (!roundActive && lastResultMsg) {
        ws.send(JSON.stringify(lastResultMsg));
    }

    ws.on('message', msg => {
        try {
            const data = JSON.parse(msg);
            const p = players[id];
            if (!p) return;
            if (data.type === 'join') {
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
            }
            if (data.type === 'update_team') {
                let team = data.team || '';
                team = team.replace(/[\[\]]/g, '').substr(0, 3);
                p.requestedTeam = team;
            }
            if (data.type === 'input' && p.state === 'active') {
                p.hasMovedSinceSpawn = true; // Mark as active (User Input)
                p.autoRun = false;
                p.afkDeaths = 0;

                if (data.dx != null) {
                    const mag = Math.sqrt(data.dx * data.dx + data.dy * data.dy);
                    if (mag > 0) {
                        p.dx = data.dx / mag;
                        p.dy = data.dy / mag;
                        // Cancel invulnerability immediately on move
                        p.invulnerableUntil = 0;
                    }
                }
                if (data.drawing != null) p.isDrawing = data.drawing;
            }
            if (data.type === 'chat') {
                const text = (data.text || '').toString().substring(0, 50);
                if (text.trim().length > 0) {
                    broadcast({ type: 'chat', text: text, color: p.color, name: p.name });
                }
            }
        } catch (e) { }
    });
    ws.on('close', (e) => {
        delete players[id];
        // Clean up territories? No, they stay.
    });
});

// Broadcast Loop
setInterval(() => {
    if (!roundActive) return;
    const now = Date.now();
    const cleanPlayers = Object.values(players).map(p => ({
        id: p.id,
        x: Math.round(p.x),
        y: Math.round(p.y),
        color: p.color,
        name: p.name,
        emoji: p.emoji,
        team: p.team,
        // Visual trail from grid cells
        trail: p.gridTrail.map(pt => ({ x: pt.x * GRID_SIZE + GRID_SIZE / 2, y: pt.y * GRID_SIZE + GRID_SIZE / 2 })),

        score: p.score,
        state: p.state,
        invulnerableCount: (p.invulnerableUntil && now < p.invulnerableUntil) ? Math.ceil((p.invulnerableUntil - now) / 1000) : 0
    }));

    const stateMsg = {
        type: 'state',
        players: cleanPlayers,
        time: timeRemaining,
        teams: getTeamStats()
    };

    if (territoriesChanged) {
        stateMsg.territories = territoryRects;
        territoriesChanged = false;
    }

    broadcast(stateMsg);
}, 50);

initGrid();
server.listen(PORT, () => console.log("Server Grid Mode Started " + PORT));

function getDistSq(px, py, vx, vy, wx, wy) {
    const l2 = (vx - wx) ** 2 + (vy - wy) ** 2;
    if (l2 === 0) return (px - vx) ** 2 + (py - vy) ** 2;
    let t = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
    t = Math.max(0, Math.min(1, t));
    return (px - (vx + t * (wx - vx))) ** 2 + (py - (vy + t * (wy - vy))) ** 2;
}

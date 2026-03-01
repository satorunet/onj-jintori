/**
 * modules/cpu.js
 * CPUプレイヤー管理モジュール
 * 
 * 参加人数が5人以下の場合、2名のCPUを常駐させる
 * 難易度: WEAK（弱）, MEDIUM（中）, STRONG（強）
 */

const config = require('./config');
const { GAME_MODES, TEAM_COLORS, CPU_TEAM_NAME, HUMAN_VS_BOT, GRID_SIZE, BOOST_DURATION, BOOST_COOLDOWN,
    SWARM_BOT_COUNT, SWARM_CHAIN_SPACING, SWARM_TEAM_NAME, SWARM_TEAM_COLOR,
    SWARM_ATTACK_RANGE, SWARM_REJOIN_TIMEOUT, CHAIN_MAX_LENGTH,
    CHAIN_DEBUG,
    TANUKI_TEAM_NAME, TANUKI_TEAM_COLOR,
    state } = config;

// 外部依存（後から設定）
let game = null;

// CPUプレイヤー管理
const cpuPlayers = {};

// CPU設定
const CPU_TARGET_COUNT = 1;          // 常駐させるCPU数（SOLO）
const CPU_TEAM_TARGET_COUNT = 1;     // チーム戦でのCPU数
const CPU_BOSS_COUNT = 0;            // BOSSの数
const PLAYER_THRESHOLD = 10;         // CPU発動の閾値（10名以下で出現）
const CPU_UPDATE_INTERVAL = 100;     // CPUのAI更新間隔 (ms)
const CPU_DIRECTION_CHANGE_MIN = 500;  // 方向変更の最小間隔 (ms)
const CPU_TEAM_COLOR = '#f97316';    // CPUチーム色（オレンジ）
const CPU_MASS_SUICIDE_COOLDOWN = 10 * 60 * 1000;  // CPU全員自滅後のクールダウン (10分)

// CPU全員自滅クールダウン状態
let cpuMassSuicideTime = 0;  // 最後に全員自滅した時刻

// 難易度設定（地道に小さく陣地を取る堅実型）
const AI_SETTINGS = {
    WEAK: {
        name: '弱',
        maxTrailLength: 12,             // 短い軌跡（安全重視）
        captureSize: 6,                 // 小さな領地を確保（自爆しない最小サイズ）
        chaseChance: 0.1,               // 軌跡を見つけたら追う確率
        reactionDistance: 80,           // 障害物検知距離
        aggressiveness: 0.3,            // 領地拡大の積極性
        attackRange: 150,               // 敵ラインを検知する距離
        attackProbability: 0.3,         // 攻撃モードに入る確率
        boostUsage: 0.1,                // ブースト使用率（低め）
        feintChance: 0                  // フェイント動作なし
    },
    MEDIUM: {
        name: '中',
        maxTrailLength: 16,             // 短い軌跡で堅実に
        captureSize: 7,                 // 小さな領地をコツコツ確保
        chaseChance: 0.3,
        reactionDistance: 100,
        aggressiveness: 0.5,
        attackRange: 200,
        attackProbability: 0.5,
        boostUsage: 0.3,
        feintChance: 0.1
    },
    STRONG: {
        name: '強',
        maxTrailLength: 20,             // 控えめな軌跡（隙を見せない）
        captureSize: 8,                 // 小さめの領地を確実に確保
        chaseChance: 0.6,
        reactionDistance: 120,
        aggressiveness: 0.7,
        attackRange: 300,
        attackProbability: 0.8,
        boostUsage: 0.6,
        feintChance: 0.3
    }
};

/**
 * 依存関係設定
 */
function setDependencies(g) {
    game = g;
}

/**
 * ランダムな匿名名を生成（名無し+2文字英数字）
 */
function generateCpuName() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const randomStr = chars.charAt(Math.floor(Math.random() * chars.length)) 
                    + chars.charAt(Math.floor(Math.random() * chars.length));
    return '名無し' + randomStr;
}

/**
 * ランダムな難易度を選択（強以外）
 */
function getRandomDifficulty(excludeStrong = false) {
    if (excludeStrong) {
        const difficulties = ['WEAK', 'MEDIUM'];
        return difficulties[Math.floor(Math.random() * difficulties.length)];
    }
    const difficulties = ['WEAK', 'MEDIUM', 'STRONG'];
    return difficulties[Math.floor(Math.random() * difficulties.length)];
}

/**
 * CPUプレイヤーを生成
 * @param {string} forceDifficulty - 難易度を強制指定（'WEAK', 'MEDIUM', 'STRONG'）
 * @param {boolean} isBoss - ボスBOT（巨大・常時ブースト）
 */
function createCpuPlayer(forceDifficulty = null, isBoss = false) {
    if (!game) return null;

    // shortIdを唯一のプレイヤーIDとして使用（フルID廃止）
    const id = game.generateShortId();
    const color = game.getUniqueColor();
    const emoji = isBoss ? '👹' : '🤖';
    const difficulty = isBoss ? 'STRONG' : (forceDifficulty || getRandomDifficulty());
    const settings = AI_SETTINGS[difficulty];
    const baseName = isBoss ? 'BOSS' : 'BOT';

    const currentMode = GAME_MODES[state.currentModeIdx];

    let team = '';
    let displayName = baseName;
    let finalColor = color;

    // チーム戦ではCPUチームに所属
    if (currentMode === 'TEAM') {
        team = CPU_TEAM_NAME;
        displayName = `[${CPU_TEAM_NAME}] ${baseName}`;
        finalColor = CPU_TEAM_COLOR;
    }
    
    const cpuPlayer = {
        id,
        name: displayName,
        color: finalColor,
        emoji,
        originalColor: color,
        x: 0,
        y: 0,
        dx: 0,
        dy: 0,
        gridTrail: [],
        trail: [],
        score: 0,
        kills: 0,
        state: 'waiting',
        invulnerableUntil: 0,
        afkDeaths: 0,
        hasMovedSinceSpawn: false,
        requestedTeam: team,
        team: team,
        boostUntil: 0,
        boostCooldownUntil: 0,
        autoRun: false,
        spawnTime: 0,
        hasChattedInRound: false,
        
        // CPU専用プロパティ
        isCpu: true,
        isBoss: isBoss,
        scale: isBoss ? 2.5 : 1,
        difficulty,
        settings,
        ws: {
            // ダミーWebSocketオブジェクト
            readyState: 1, // OPEN
            send: () => {},
            close: () => {}
        },
        
        // AI状態
        ai: {
            lastDirectionChange: 0,
            phase: 'idle',           // idle, expanding, returning
            captureDirection: null,  // 領地拡大時の基本方向
            turnCount: 0,            // 曲がった回数
            targetAngle: 0,          // 目標角度
            stepsInDirection: 0      // 現在の方向での移動ステップ数
        }
    };

    state.players[id] = cpuPlayer;
    cpuPlayers[id] = cpuPlayer;


    console.log(`[CPU] Created CPU player: ${displayName} (${settings.name}, team: ${team || 'SOLO'})`);
    
    return cpuPlayer;
}

// たぬきちBOT管理
let tanukichiId = null;

/**
 * たぬきちBOTを生成（常に1体のみ）
 */
function createTanukichi() {
    if (!game) return null;
    if (tanukichiId && cpuPlayers[tanukichiId]) return cpuPlayers[tanukichiId]; // 既に存在

    const id = game.generateShortId();
    const currentMode = GAME_MODES[state.currentModeIdx];
    const isTeam = currentMode === 'TEAM';

    const team = isTeam ? TANUKI_TEAM_NAME : '';
    const displayName = isTeam ? `[${TANUKI_TEAM_NAME}] たぬきち` : 'たぬきち';
    const color = isTeam ? TANUKI_TEAM_COLOR : '#8B4513';
    const difficulty = 'MEDIUM';
    const settings = AI_SETTINGS[difficulty];

    const tanukichi = {
        id,
        name: displayName,
        color: color,
        emoji: '🥺',
        originalColor: '#8B4513',
        x: 0, y: 0, dx: 0, dy: 0,
        gridTrail: [], trail: [],
        score: 0, kills: 0,
        state: 'waiting',
        invulnerableUntil: 0,
        afkDeaths: 0,
        hasMovedSinceSpawn: false,
        requestedTeam: team,
        team: team,
        boostUntil: 0,
        boostCooldownUntil: 0,
        autoRun: false,
        spawnTime: 0,
        hasChattedInRound: false,

        // CPU専用プロパティ
        isCpu: true,
        isBoss: false,
        isTanukichi: true,  // たぬきち識別フラグ
        scale: 1,
        difficulty,
        settings,
        ws: { readyState: 1, send: () => {}, close: () => {} },

        // AI状態
        ai: {
            lastDirectionChange: 0,
            phase: 'idle',
            captureDirection: null,
            turnCount: 0,
            targetAngle: 0,
            stepsInDirection: 0
        }
    };

    state.players[id] = tanukichi;
    cpuPlayers[id] = tanukichi;
    tanukichiId = id;

    console.log(`[CPU] Created たぬきち bot: ${displayName} (team: ${team || 'SOLO'})`);
    return tanukichi;
}

/**
 * CPUプレイヤーを削除
 */
function removeCpuPlayer(id) {
    const cpu = cpuPlayers[id];
    if (!cpu) return;

    // 領地をクリア
    for (let y = 0; y < state.GRID_ROWS; y++) {
        for (let x = 0; x < state.GRID_COLS; x++) {
            if (state.worldGrid[y][x] === id) {
                state.worldGrid[y][x] = null;
            }
        }
    }

    // ID を解放
    if (cpu.id) {
        state.usedShortIds.delete(cpu.id);
    }

    // たぬきちIDをクリア
    if (id === tanukichiId) tanukichiId = null;

    delete state.players[id];
    delete cpuPlayers[id];

    console.log(`[CPU] Removed CPU player: ${cpu.name}`);
}

/**
 * 実プレイヤーの数を取得（CPUを除く）
 */
function getRealPlayerCount() {
    return Object.values(state.players).filter(p => !p.isCpu).length;
}

/**
 * CPUの数を取得
 */
function getCpuCount() {
    return Object.keys(cpuPlayers).length;
}

/**
 * CPUプレイヤー数を調整
 * @param {boolean} force - trueの場合、ラウンド非アクティブ時でも実行
 */
function adjustCpuCount(force = false) {
    if (!force && !state.roundActive) return;

    // たぬきちBOTを常に1体維持（モードに関係なく）
    if (!tanukichiId || !cpuPlayers[tanukichiId]) {
        const tanukichi = createTanukichi();
        if (tanukichi && game.respawnPlayer) {
            game.respawnPlayer(tanukichi, true);
            const pmData = { i: tanukichi.id, n: tanukichi.name, c: tanukichi.color, e: tanukichi.emoji, t: tanukichi.team || '' };
            game.broadcast({ type: 'pm', players: [pmData] });
        }
    }

    const realCount = getRealPlayerCount();
    const cpuCount = getCpuCount();
    const mode = GAME_MODES[state.currentModeIdx];

    // モードに応じた目標CPU数（人間vsBOTモード: 人間×5）
    // たぬきちは別枠なので通常CPUカウントから除外
    const tanukichiCount = (tanukichiId && cpuPlayers[tanukichiId]) ? 1 : 0;
    const normalCpuCount = cpuCount - tanukichiCount;
    const targetCount = HUMAN_VS_BOT ? Math.max(1, realCount * 5)
        : (mode === 'TEAM') ? CPU_TEAM_TARGET_COUNT : CPU_TARGET_COUNT;
    const threshold = (mode === 'TEAM') ? Infinity : PLAYER_THRESHOLD;  // チーム戦は常にCPU出現

    if (realCount <= threshold) {
        // プレイヤーが少ない → CPUを増やす
        const needed = targetCount - normalCpuCount;

        // 現在のBOSS数をチェック
        const currentBossCount = Object.values(cpuPlayers).filter(cpu => cpu.isBoss).length;
        const bossNeeded = (mode === 'TEAM') ? Math.max(0, CPU_BOSS_COUNT - currentBossCount) : 0;
        let bossCreated = 0;

        for (let i = 0; i < needed; i++) {
            const shouldBeBoss = (mode === 'TEAM') && bossCreated < bossNeeded;
            let difficulty = shouldBeBoss ? 'STRONG' : null;
            if (shouldBeBoss) bossCreated++;

            const cpu = createCpuPlayer(difficulty, shouldBeBoss);
            if (cpu && game.respawnPlayer) {
                game.respawnPlayer(cpu, true);

                // プレイヤーマスタ情報をブロードキャスト
                const pmData = { i: cpu.id, n: cpu.name, c: cpu.color, e: cpu.emoji, t: cpu.team || '' };
                if (cpu.scale && cpu.scale !== 1) pmData.sc = cpu.scale;
                game.broadcast({ type: 'pm', players: [pmData] });
            }
        }

        // waitingになっているCPUを復活させる
        Object.values(cpuPlayers).forEach(cpu => {
            if (cpu.state === 'waiting' && game.respawnPlayer) {
                game.respawnPlayer(cpu, true);
            }
        });
    } else if (realCount > threshold && cpuCount > 0) {
        // プレイヤーが増えた → CPUをwaiting状態に（たぬきちは除外）
        Object.values(cpuPlayers).forEach(cpu => {
            if (cpu.isTanukichi) return;  // たぬきちは常にアクティブ
            if (cpu.state === 'active') {
                cpu.state = 'waiting';
                cpu.gridTrail = [];
                cpu.trail = [];
            }
        });
    }
}

/**
 * グリッド座標が安全かチェック（障害物・自分の軌跡がないか）
 */
function isSafePosition(cpu, gx, gy) {
    // 範囲外チェック
    if (gx < 0 || gx >= state.GRID_COLS || gy < 0 || gy >= state.GRID_ROWS) {
        return false;
    }

    // 障害物チェック
    const cellVal = state.worldGrid[gy] && state.worldGrid[gy][gx];
    if (cellVal === 'obstacle' || cellVal === 'obstacle_gear') {
        return false;
    }

    // 自分の軌跡チェック（自爆回避）- グリッド座標の完全一致のみ
    for (const pt of cpu.gridTrail) {
        if (pt.x === gx && pt.y === gy) {
            return false;
        }
    }

    return true;
}

/**
 * ピクセル座標での安全チェック（ピクセル距離ベースの軌跡交差判定含む）
 */
function isSafePixelPosition(cpu, px, py) {
    const gx = game.toGrid(px);
    const gy = game.toGrid(py);
    if (!isSafePosition(cpu, gx, gy)) return false;

    // ピクセル距離ベースの軌跡交差チェック（サーバーの自爆判定と同じロジック）
    if (cpu.trail && cpu.trail.length > 3) {
        for (let i = 0; i < cpu.trail.length - 3; i++) {
            const distSq = game.getDistSq(px, py,
                cpu.trail[i].x, cpu.trail[i].y,
                cpu.trail[i + 1].x, cpu.trail[i + 1].y);
            if (distSq < 100) { // 自爆判定(64)より余裕を持って回避
                return false;
            }
        }
    }

    return true;
}

/**
 * 指定方向にN歩先まで安全かチェック
 */
function isDirectionSafe(cpu, dx, dy, steps = 5) {
    const stepSize = GRID_SIZE;
    for (let i = 1; i <= steps; i++) {
        const checkX = cpu.x + dx * stepSize * i;
        const checkY = cpu.y + dy * stepSize * i;
        if (!isSafePixelPosition(cpu, checkX, checkY)) {
            return false;
        }
    }
    return true;
}

/**
 * 進行方向の壁までの距離を計算（360度対応）
 */
function getWallDistance(cpu, dx, dy) {
    let minDist = Infinity;
    if (dx > 0) minDist = Math.min(minDist, (state.WORLD_WIDTH - cpu.x) / dx);
    else if (dx < 0) minDist = Math.min(minDist, -cpu.x / dx);
    if (dy > 0) minDist = Math.min(minDist, (state.WORLD_HEIGHT - cpu.y) / dy);
    else if (dy < 0) minDist = Math.min(minDist, -cpu.y / dy);
    return minDist;
}

/**
 * 自陣にいるかチェック
 */
function isInOwnTerritory(cpu) {
    const gx = game.toGrid(cpu.x);
    const gy = game.toGrid(cpu.y);
    if (gy >= 0 && gy < state.GRID_ROWS && gx >= 0 && gx < state.GRID_COLS) {
        const owner = state.worldGrid[gy][gx];
        if (owner === cpu.id) return true;
        // チーム戦の場合、チームメイトの領地も自陣扱い
        if (cpu.team && owner) {
            const ownerPlayer = state.players[owner];
            if (ownerPlayer && ownerPlayer.team === cpu.team) return true;
        }
    }
    return false;
}

/**
 * 最寄りの自陣を見つける
 */
function findNearestOwnTerritory(cpu) {
    const gx = game.toGrid(cpu.x);
    const gy = game.toGrid(cpu.y);
    
    let nearest = null;
    let minDist = Infinity;
    
    // 螺旋状に探索
    for (let radius = 1; radius <= 80; radius++) {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                
                const checkX = gx + dx;
                const checkY = gy + dy;
                
                if (checkY >= 0 && checkY < state.GRID_ROWS && 
                    checkX >= 0 && checkX < state.GRID_COLS) {
                    const owner = state.worldGrid[checkY][checkX];
                    let isOwn = owner === cpu.id;
                    if (!isOwn && cpu.team && owner) {
                        const ownerPlayer = state.players[owner];
                        if (ownerPlayer && ownerPlayer.team === cpu.team) isOwn = true;
                    }
                    
                    if (isOwn) {
                        const dist = Math.abs(dx) + Math.abs(dy);
                        if (dist < minDist) {
                            minDist = dist;
                            nearest = {
                                gx: checkX,
                                gy: checkY,
                                x: checkX * GRID_SIZE + GRID_SIZE / 2,
                                y: checkY * GRID_SIZE + GRID_SIZE / 2
                            };
                        }
                    }
                }
            }
        }
        if (nearest) break;
    }
    
    return nearest;
}

/**
 * 360度から方向候補を生成（16方向: 22.5度刻み）
 */
function generateDirections() {
    const dirs = [];
    for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        dirs.push({ dx: Math.cos(angle), dy: Math.sin(angle) });
    }
    return dirs;
}

/**
 * 安全な方向を見つける（現在の進行方向に近い方向を優先）
 */
function findSafeDirection(cpu, preferredDx = null, preferredDy = null) {
    // 基準角度を決定: 優先方向 → 現在の進行方向 → ランダム
    let baseAngle;
    if (preferredDx !== null && preferredDy !== null) {
        baseAngle = Math.atan2(preferredDy, preferredDx);
    } else if (cpu.dx !== 0 || cpu.dy !== 0) {
        baseAngle = Math.atan2(cpu.dy, cpu.dx);
    } else {
        baseAngle = Math.random() * Math.PI * 2;
    }

    // 基準角度から近い順に探索（0°, ±22.5°, ±45°, ... ±180°）
    const offsets = [0, 0.39, -0.39, 0.79, -0.79, 1.18, -1.18, 1.57, -1.57, 1.96, -1.96, 2.36, -2.36, 2.75, -2.75, Math.PI];
    for (const offset of offsets) {
        const a = baseAngle + offset;
        const dx = Math.cos(a), dy = Math.sin(a);
        if (isDirectionSafe(cpu, dx, dy, 5)) {
            return { dx, dy };
        }
    }

    // どこも安全でない場合、短距離チェックで再試行
    for (const offset of offsets) {
        const a = baseAngle + offset;
        const dx = Math.cos(a), dy = Math.sin(a);
        if (isDirectionSafe(cpu, dx, dy, 2)) {
            return { dx, dy };
        }
    }

    return null;
}

/**
 * 敵の軌跡を探す（強CPU用）
 */
function findNearestEnemyTrail(cpu) {
    let nearest = null;
    let minDist = Infinity;

    Object.values(state.players).forEach(p => {
        if (p.id === cpu.id || p.state !== 'active') return;
        if (p.team && p.team === cpu.team) return;
        
        if (p.trail && p.trail.length > 3) {
            // 軌跡の中央付近を狙う
            const midIdx = Math.floor(p.trail.length / 2);
            const point = p.trail[midIdx];
            const dx = point.x - cpu.x;
            const dy = point.y - cpu.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist && dist < 400) {
                minDist = dist;
                nearest = { x: point.x, y: point.y, dist };
            }
        }
    });

    return nearest;
}

/**
 * 近くの敵プレイヤーを検出（キャッシュ付き: 同一AIティック内で再利用）
 * @returns {Array} 敵プレイヤーのリスト（距離順）
 */
let _nearbyEnemiesCache = new Map();  // key: cpuId_maxDist, value: { tick, result }
let _nearbyEnemiesTick = 0;

function findNearbyEnemies(cpu, maxDistance = 300) {
    const cacheKey = cpu.id * 10000 + maxDistance;
    const cached = _nearbyEnemiesCache.get(cacheKey);
    if (cached && cached.tick === _nearbyEnemiesTick) return cached.result;

    const enemies = [];

    Object.values(state.players).forEach(p => {
        if (p.id === cpu.id || p.state !== 'active') return;
        if (p.team && p.team === cpu.team) return;  // チームメイトは除外

        const dx = p.x - cpu.x;
        const dy = p.y - cpu.y;
        const distSq = dx * dx + dy * dy;
        const maxDistSq = maxDistance * maxDistance;

        if (distSq < maxDistSq) {
            const dist = Math.sqrt(distSq);
            // 脅威度を計算（距離が近い + 軌跡がない = 高脅威）
            const hasTrail = p.gridTrail && p.gridTrail.length > 0;
            const threatLevel = (1 - dist / maxDistance) * (hasTrail ? 0.5 : 1.0);

            enemies.push({
                player: p,
                x: p.x,
                y: p.y,
                dx: dx,
                dy: dy,
                dist: dist,
                hasTrail: hasTrail,
                threatLevel: threatLevel
            });
        }
    });

    // 距離順にソート
    enemies.sort((a, b) => a.dist - b.dist);
    _nearbyEnemiesCache.set(cacheKey, { tick: _nearbyEnemiesTick, result: enemies });
    return enemies;
}

/**
 * 敵から逃げる方向を計算
 */
function getEscapeDirection(cpu, enemies) {
    if (enemies.length === 0) return null;
    
    // 全敵の重心から逃げる方向を計算
    let avgDx = 0, avgDy = 0;
    enemies.forEach(e => {
        // 距離が近いほど影響を大きく
        const weight = 1 / (e.dist + 50);
        avgDx += e.dx * weight;
        avgDy += e.dy * weight;
    });
    
    // 逃げる方向（敵の反対方向）
    const mag = Math.sqrt(avgDx * avgDx + avgDy * avgDy);
    if (mag > 0) {
        return { dx: -avgDx / mag, dy: -avgDy / mag };
    }
    return null;
}

/**
 * チームメイトCPUを探す
 */
function findTeammateCpus(cpu) {
    const teammates = [];

    Object.values(cpuPlayers).forEach(other => {
        if (other.id === cpu.id) return;
        if (other.state !== 'active') return;
        if (other.team !== cpu.team) return;  // 同じチームのみ

        const dx = other.x - cpu.x;
        const dy = other.y - cpu.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        teammates.push({
            cpu: other,
            player: other,  // findTeammateNeedingHelp互換
            x: other.x,
            y: other.y,
            dx: dx,
            dy: dy,
            dist: dist,
            isExpanding: other.gridTrail && other.gridTrail.length > 0,
            phase: other.ai ? other.ai.phase : 'idle',
            isCpu: true
        });
    });

    return teammates;
}

/**
 * 全チームメイトを探す（CPU + 人間プレイヤー）
 */
function findAllTeammates(cpu) {
    const teammates = [];
    if (!cpu.team) return teammates;

    Object.values(state.players).forEach(other => {
        if (other.id === cpu.id) return;
        if (other.state !== 'active') return;
        if (other.team !== cpu.team) return;

        const dx = other.x - cpu.x;
        const dy = other.y - cpu.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        teammates.push({
            player: other,
            x: other.x,
            y: other.y,
            dx: dx,
            dy: dy,
            dist: dist,
            isExpanding: other.gridTrail && other.gridTrail.length > 0,
            phase: other.ai ? other.ai.phase : 'unknown',
            isCpu: !!other.isCpu
        });
    });

    return teammates;
}

/**
 * チーム領地の最適拡大方向を探す
 * CPUの現在位置から16方向に扇形スキャンし、未占領/敵占領地が多い方向を返す
 */
function findTeamExpandFrontier(cpu) {
    const gx = game.toGrid(cpu.x);
    const gy = game.toGrid(cpu.y);

    const directions = generateDirections();

    let bestDir = null;
    let bestScore = -1;

    for (const dir of directions) {
        let score = 0;
        // 扇形の範囲でスキャン（3〜15グリッド先）
        for (let r = 3; r <= 15; r++) {
            for (let spread = -3; spread <= 3; spread++) {
                const checkX = Math.round(gx + dir.dx * r + dir.dy * spread);
                const checkY = Math.round(gy + dir.dy * r - dir.dx * spread);

                if (checkY >= 0 && checkY < state.GRID_ROWS &&
                    checkX >= 0 && checkX < state.GRID_COLS) {
                    const owner = state.worldGrid[checkY][checkX];
                    if (!owner) {
                        score += 2; // 未占領は高スコア
                    } else if (owner !== 'obstacle' && owner !== 'obstacle_gear') {
                        const ownerPlayer = state.players[owner];
                        if (!ownerPlayer || ownerPlayer.team !== cpu.team) {
                            score += 1; // 敵領地も拡大対象
                        }
                        // チーム領地は0スコア（既に確保済み）
                    }
                }
            }
        }

        // 安全性チェック
        if (score > bestScore && isDirectionSafe(cpu, dir.dx, dir.dy, 5)) {
            bestScore = score;
            bestDir = dir;
        }
    }

    return bestDir;
}

/**
 * チームメイトと協調した領地拡大方向を計算
 * チーム領地境界から未占領地が多い方向を優先し、チームメイトの拡大方向と被らないよう調整
 */
function getCooperativeExpandDirection(cpu, teammates) {
    // チーム領地境界から最適拡大方向を探す
    const frontier = findTeamExpandFrontier(cpu);

    if (frontier) {
        // チームメイトが拡大中の場合、同じ方向に被らないよう調整
        const expandingTeammates = teammates.filter(t => t.isExpanding && t.isCpu);
        if (expandingTeammates.length > 0) {
            const mate = expandingTeammates[0];
            const mateDx = mate.player ? mate.player.dx : (mate.cpu ? mate.cpu.dx : 0);
            const mateDy = mate.player ? mate.player.dy : (mate.cpu ? mate.cpu.dy : 0);

            // チームメイトと同じ方向の場合、frontierをそのまま使用（分担する）
            const dot = frontier.dx * mateDx + frontier.dy * mateDy;
            if (dot > 0.7) {
                // 方向が被っている → 90度回転して別の方面を担当
                const rotated = { dx: -frontier.dy, dy: frontier.dx };
                if (isDirectionSafe(cpu, rotated.dx, rotated.dy, 5)) {
                    return rotated;
                }
            }
        }
        return frontier;
    }

    // frontierが見つからない場合はチームメイトと反対方向
    if (teammates.length > 0) {
        let avgX = 0, avgY = 0;
        teammates.forEach(t => { avgX += t.x; avgY += t.y; });
        avgX /= teammates.length;
        avgY /= teammates.length;
        const dx = cpu.x - avgX;
        const dy = cpu.y - avgY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) return { dx: dx / dist, dy: dy / dist };
    }

    const angle = Math.random() * Math.PI * 2;
    return { dx: Math.cos(angle), dy: Math.sin(angle) };
}

/**
 * チームメイトが攻撃されているか確認し、援護対象を返す
 * teammates は findAllTeammates() または findTeammateCpus() の結果
 */
function findTeammateNeedingHelp(cpu, teammates) {
    for (const teammate of teammates) {
        // チームメイトがラインを出していて、敵が近くにいる場合
        if (teammate.isExpanding) {
            // cpu or player プロパティからプレイヤーオブジェクトを取得
            const targetPlayer = teammate.player || teammate.cpu;
            if (!targetPlayer) continue;
            const enemies = findNearbyEnemies(targetPlayer, 200);
            if (enemies.length > 0) {
                const targetEnemy = enemies[0];
                if (targetEnemy.hasTrail) {
                    return {
                        teammate: teammate,
                        enemy: targetEnemy,
                        type: 'attack_enemy_trail'
                    };
                } else {
                    return {
                        teammate: teammate,
                        enemy: targetEnemy,
                        type: 'defend_teammate'
                    };
                }
            }
        }
    }
    return null;
}

/**
 * 自陣内での警戒パトロール（穏やかに直線的に移動、たまに方向転換）
 */
function getPatrolDirection(cpu, ai) {
    // 現在の方向を長く維持する（1.5〜3秒ごとに緩やかに転換）
    if (ai.patrolAngle !== undefined && ai.patrolChangeTime &&
        Date.now() - ai.patrolChangeTime < 1500 + Math.random() * 1500) {
        return { dx: Math.cos(ai.patrolAngle), dy: Math.sin(ai.patrolAngle) };
    }

    // 現在の進行方向を基準に、緩やかに角度を変える（±30度）
    const currentAngle = (cpu.dx !== 0 || cpu.dy !== 0)
        ? Math.atan2(cpu.dy, cpu.dx)
        : (ai.patrolAngle || Math.random() * Math.PI * 2);
    ai.patrolAngle = currentAngle + (Math.random() - 0.5) * Math.PI / 3;
    ai.patrolChangeTime = Date.now();

    return { dx: Math.cos(ai.patrolAngle), dy: Math.sin(ai.patrolAngle) };
}


/**
 * ブーストを発動できるかチェックし、発動する
 * @returns {boolean} ブーストを発動したかどうか
 */
function tryActivateBoost(cpu, settings) {
    const now = Date.now();
    
    // クールダウン中はブースト不可
    if (cpu.boostCooldownUntil && now < cpu.boostCooldownUntil) {
        return false;
    }
    
    // 既にブースト中は発動しない
    if (cpu.boostUntil && now < cpu.boostUntil) {
        return false;
    }
    
    // 確率判定
    if (Math.random() > settings.boostUsage) {
        return false;
    }
    
    // ブースト発動！
    cpu.boostUntil = now + BOOST_DURATION;
    cpu.boostCooldownUntil = now + BOOST_COOLDOWN;
    cpu.boosting = true;
    
    return true;
}

/**
 * フェイント動作（急な方向転換で相手を騙す）
 */
function performFeint(cpu, ai, currentDx, currentDy) {
    // フェイントのパターン
    const patterns = [
        // 急な90度ターン
        () => ({ dx: -currentDy, dy: currentDx }),
        // 反対方向へのフェイク
        () => ({ dx: -currentDx * 0.5, dy: -currentDy * 0.5 }),
        // ジグザグ
        () => {
            const zigzag = (ai.feintCount || 0) % 2 === 0 ? 1 : -1;
            ai.feintCount = (ai.feintCount || 0) + 1;
            return { 
                dx: currentDx * 0.7 + currentDy * 0.3 * zigzag, 
                dy: currentDy * 0.7 - currentDx * 0.3 * zigzag 
            };
        }
    ];
    
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    return pattern();
}

/**
 * BOSS BOTを取得
 */
function getBoss() {
    return Object.values(cpuPlayers).find(cpu => cpu.isBoss && cpu.state === 'active') || null;
}

/**
 * 陣形の目標位置を計算（BOSSを中心に円形配置）
 * 各BOTにはインデックスに基づく固定角度が割り当てられ、BOSSの進行方向に合わせて回転する
 */
function getFormationTarget(cpu, boss) {
    if (!boss || !cpu.ai.formationIndex) return null;

    const idx = cpu.ai.formationIndex;
    const total = Object.values(cpuPlayers).filter(c => !c.isBoss && c.state === 'active').length;

    // 2層の円形陣形: 内周（近衛）と外周（前衛）
    const innerCount = Math.min(6, total);
    const isInner = idx <= innerCount;
    const radius = isInner ? 150 : 280;
    const countInRing = isInner ? innerCount : (total - innerCount);
    const idxInRing = isInner ? (idx - 1) : (idx - innerCount - 1);

    // BOSSの進行方向を基準角度にする（停止中はランダム安定）
    let baseAngle = 0;
    if (boss.dx !== 0 || boss.dy !== 0) {
        baseAngle = Math.atan2(boss.dy, boss.dx);
    }

    // 各BOTの配置角度
    const slotAngle = baseAngle + (idxInRing / countInRing) * Math.PI * 2;

    return {
        x: boss.x + Math.cos(slotAngle) * radius,
        y: boss.y + Math.sin(slotAngle) * radius
    };
}

/**
 * CPUのAI更新（メインロジック）
 */
function updateCpuAI() {
    if (!state.roundActive) return;
    if (!game) return;

    const now = Date.now();
    _nearbyEnemiesTick++;  // キャッシュ無効化（新しいティック）
    const boss = getBoss();

    // 陣形インデックスを割り当て（ボス以外のアクティブCPU）
    if (boss) {
        let idx = 1;
        Object.values(cpuPlayers).forEach(cpu => {
            if (cpu.isBoss || cpu.state !== 'active') return;
            if (!cpu.ai.formationIndex) cpu.ai.formationIndex = idx;
            idx++;
        });
    }

    Object.values(cpuPlayers).forEach(cpu => {
        if (cpu.state !== 'active') return;
        if (cpu.isSwarmBot) return;  // スウォームBOTは別AIで管理

        const settings = cpu.settings;
        const ai = cpu.ai;

        // === ボスBOT: 常時ブースト ===
        if (cpu.isBoss) {
            cpu.boostUntil = now + 10000;
            cpu.boosting = true;
        }

        // === 緊急回避（最優先・間隔制限なし）===
        // 壁・障害物・自分の軌跡が近い場合は即座に方向転換
        if (!isDirectionSafe(cpu, cpu.dx, cpu.dy, 3)) {
            const safeDir = findSafeDirection(cpu);
            if (safeDir) {
                cpu.dx = safeDir.dx;
                cpu.dy = safeDir.dy;
                ai.lastDirectionChange = now;
                if (cpu.gridTrail.length > 0) {
                    ai.phase = 'returning';
                }
            }
            return;
        }

        // 方向変更の最小間隔チェック（安全なら方向を維持して安定走行）
        if (now - ai.lastDirectionChange < CPU_DIRECTION_CHANGE_MIN) {
            return;
        }

        // 現在の方向が安全なら不必要な変更を避ける（直進維持）
        const currentDirSafe = isDirectionSafe(cpu, cpu.dx, cpu.dy, 4);

        let newDx = cpu.dx;
        let newDy = cpu.dy;
        let needsChange = false;

        // === 敵プレイヤー検出 ===
        const nearbyEnemies = findNearbyEnemies(cpu, 250);
        const hasNearbyEnemy = nearbyEnemies.length > 0;
        const closestEnemy = nearbyEnemies[0] || null;
        const isEnemyVeryClose = closestEnemy && closestEnemy.dist < 150;
        const isEnemyDangerous = closestEnemy && closestEnemy.dist < 100 && !closestEnemy.hasTrail;

        // === チームメイト検出（協調行動：CPU + 人間プレイヤー）===
        const allTeammates = cpu.team ? findAllTeammates(cpu) : [];
        const teammateCpus = cpu.team ? findTeammateCpus(cpu) : [];
        const hasTeammate = allTeammates.length > 0;
        // チームメイトCPUが拡大中か（役割分担用）
        const teammateIsExpanding = teammateCpus.some(t => t.isExpanding);
        
        // === チームメイト援護モード（CPU + 人間チームメイト対象）===
        if (hasTeammate && cpu.gridTrail.length === 0 && isInOwnTerritory(cpu) && !hasNearbyEnemy) {
            const helpTarget = findTeammateNeedingHelp(cpu, allTeammates);
            
            if (helpTarget && Math.random() < settings.attackProbability * 0.5) {
                if (helpTarget.type === 'attack_enemy_trail' && helpTarget.enemy.hasTrail) {
                    // 敵のラインを切りに行く（援護攻撃）
                    ai.phase = 'supporting';
                    ai.supportTarget = helpTarget;
                    
                    // 敵のプレイヤー位置に向かう
                    const targetX = helpTarget.enemy.player.x;
                    const targetY = helpTarget.enemy.player.y;
                    const dx = targetX - cpu.x;
                    const dy = targetY - cpu.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    
                    if (dist > 0) {
                        const targetDx = dx / dist;
                        const targetDy = dy / dist;
                        if (isDirectionSafe(cpu, targetDx, targetDy, 5)) {
                            newDx = targetDx;
                            newDy = targetDy;
                            needsChange = true;
                            // 援護時はブースト使用
                            tryActivateBoost(cpu, settings);
                        }
                    }
                }
            }
        }
        
        // === 援護モード継続中 ===
        if (ai.phase === 'supporting' && ai.supportTarget) {
            const helpTarget = ai.supportTarget;
            
            // チームメイトがまだ危険な状態か確認
            const stillNeedsHelp = findTeammateNeedingHelp(cpu, allTeammates);
            
            if (stillNeedsHelp && stillNeedsHelp.enemy.hasTrail) {
                // 敵のライン（軌跡）を狙う
                const enemyTrailPoint = findNearestEnemyTrail(cpu);
                if (enemyTrailPoint && enemyTrailPoint.dist < settings.attackRange * 2) {
                    const dx = enemyTrailPoint.x - cpu.x;
                    const dy = enemyTrailPoint.y - cpu.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    
                    if (dist > 0) {
                        const targetDx = dx / dist;
                        const targetDy = dy / dist;
                        if (isDirectionSafe(cpu, targetDx, targetDy, 3)) {
                            newDx = targetDx;
                            newDy = targetDy;
                            needsChange = true;
                        }
                    }
                }
                
                // 軌跡が長くなりすぎたら帰還
                if (cpu.gridTrail.length >= settings.maxTrailLength * 0.5) {
                    ai.phase = 'returning';
                    ai.supportTarget = null;
                }
            } else {
                // 援護完了 → 通常モードに戻る
                ai.phase = 'returning';
                ai.supportTarget = null;
            }
            
            // 援護モード中は他の処理をスキップ
            if (needsChange && ai.phase === 'supporting') {
                const mag = Math.sqrt(newDx * newDx + newDy * newDy);
                if (mag > 0) {
                    cpu.dx = newDx / mag;
                    cpu.dy = newDy / mag;
                    ai.lastDirectionChange = now;
                }
                return;
            }
        }

        // === 敵のライン検出（攻撃チャンス）===
        const enemyTrail = findNearestEnemyTrail(cpu);
        const hasEnemyTrailNearby = enemyTrail && enemyTrail.dist < settings.attackRange;

        // === 攻撃モード: 敵のラインを切りに行く ===
        if (hasEnemyTrailNearby && cpu.gridTrail.length === 0 && isInOwnTerritory(cpu)) {
            // 自陣内にいて軌跡がない状態で敵のラインを発見 → 攻撃チャンス!
            if (Math.random() < settings.attackProbability) {
                ai.phase = 'attacking';
                ai.attackTarget = enemyTrail;
                
                // 敵のラインに向かって移動
                const dx = enemyTrail.x - cpu.x;
                const dy = enemyTrail.y - cpu.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0) {
                    const targetDx = dx / dist;
                    const targetDy = dy / dist;
                    if (isDirectionSafe(cpu, targetDx, targetDy, 5)) {
                        newDx = targetDx;
                        newDy = targetDy;
                        needsChange = true;
                    }
                }
            }
        }
        
        // === 攻撃モード継続中 ===
        if (ai.phase === 'attacking') {
            // 敵のラインを再検索
            const currentTarget = findNearestEnemyTrail(cpu);
            
            if (currentTarget && currentTarget.dist < settings.attackRange * 1.5) {
                // ターゲットが存在 → 追跡続行
                const dx = currentTarget.x - cpu.x;
                const dy = currentTarget.y - cpu.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                // 敵に近づいたらブースト発動！
                if (dist < 150 && dist > 50) {
                    tryActivateBoost(cpu, settings);
                }
                
                if (dist > 0) {
                    let targetDx = dx / dist;
                    let targetDy = dy / dist;
                    
                    // フェイント動作（確率で急な方向転換）
                    if (dist < 100 && Math.random() < settings.feintChance) {
                        const feint = performFeint(cpu, ai, targetDx, targetDy);
                        if (isDirectionSafe(cpu, feint.dx, feint.dy, 3)) {
                            targetDx = feint.dx;
                            targetDy = feint.dy;
                        }
                    }
                    
                    // 安全な場合のみ追跡
                    if (isDirectionSafe(cpu, targetDx, targetDy, 3)) {
                        newDx = targetDx;
                        newDy = targetDy;
                        needsChange = true;
                    } else {
                        // 安全な迂回路を探す
                        const safeDir = findSafeDirection(cpu, targetDx, targetDy);
                        if (safeDir) {
                            newDx = safeDir.dx;
                            newDy = safeDir.dy;
                            needsChange = true;
                        } else {
                            // 迂回路もない → 攻撃中止、帰還
                            ai.phase = 'returning';
                        }
                    }
                }
                
                // 軌跡が長くなりすぎたら帰還
                if (cpu.gridTrail.length >= settings.maxTrailLength * 0.7) {
                    ai.phase = 'returning';
                }
            } else {
                // ターゲットが消えた（切った or 敵が帰還）→ 自陣に戻る
                ai.phase = 'returning';
                ai.attackTarget = null;
            }
            
            // 攻撃モード中は他の処理をスキップ
            if (needsChange && ai.phase === 'attacking') {
                const mag = Math.sqrt(newDx * newDx + newDy * newDy);
                if (mag > 0) {
                    cpu.dx = newDx / mag;
                    cpu.dy = newDy / mag;
                    ai.lastDirectionChange = now;
                }
                return;
            }
        }

        // === 緊急事態: 軌跡があり敵が接近 → 急いで自陣に戻る ===
        if (cpu.gridTrail.length > 0 && hasNearbyEnemy) {
            ai.phase = 'emergency_return';
            
            // 緊急時はブーストで逃げる！
            tryActivateBoost(cpu, settings);
            
            const home = findNearestOwnTerritory(cpu);
            if (home) {
                const dx = home.x - cpu.x;
                const dy = home.y - cpu.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > GRID_SIZE) {
                    const targetDx = dx / dist;
                    const targetDy = dy / dist;
                    
                    if (isDirectionSafe(cpu, targetDx, targetDy, 3)) {
                        newDx = targetDx;
                        newDy = targetDy;
                        needsChange = true;
                    } else {
                        // 安全な迂回路を探す
                        const safeDir = findSafeDirection(cpu, targetDx, targetDy);
                        if (safeDir) {
                            newDx = safeDir.dx;
                            newDy = safeDir.dy;
                            needsChange = true;
                        }
                    }
                }
            }
            
            // 緊急帰還中は他の処理をスキップ
            if (needsChange) {
                const mag = Math.sqrt(newDx * newDx + newDy * newDy);
                if (mag > 0) {
                    cpu.dx = newDx / mag;
                    cpu.dy = newDy / mag;
                    ai.lastDirectionChange = now;
                }
                return;
            }
        }

        // === 危険回避 ===
        if (!currentDirSafe) {
            const safeDir = findSafeDirection(cpu);
            if (safeDir) {
                newDx = safeDir.dx;
                newDy = safeDir.dy;
                needsChange = true;
            }
        }

        // === 壁回避 ===
        if (!needsChange) {
            const wallDist = getWallDistance(cpu, cpu.dx, cpu.dy);
            if (wallDist < settings.reactionDistance) {
                const safeDir = findSafeDirection(cpu);
                if (safeDir) {
                    newDx = safeDir.dx;
                    newDy = safeDir.dy;
                    needsChange = true;
                }
            }
        }

        // === 陣形追従モード（敵が近くにいる時のみBOSS周辺に集結）===
        // 条件: 非ボスBOT、敵が接近中、軌跡なし、攻撃中でない
        const bossHasNearbyEnemy = boss ? findNearbyEnemies(boss, 400).length > 0 : false;
        const shouldFormUp = !cpu.isBoss && boss && (hasNearbyEnemy || bossHasNearbyEnemy) &&
            cpu.gridTrail.length === 0 &&
            (ai.phase === 'idle' || ai.phase === 'patrolling' || ai.phase === 'returning' || ai.phase === 'formation') &&
            !needsChange;

        if (shouldFormUp) {
            const target = getFormationTarget(cpu, boss);
            if (target) {
                const dx = target.x - cpu.x;
                const dy = target.y - cpu.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist > 40) {
                    ai.phase = 'formation';
                    const targetDx = dx / dist;
                    const targetDy = dy / dist;
                    if (isDirectionSafe(cpu, targetDx, targetDy, 4)) {
                        newDx = targetDx;
                        newDy = targetDy;
                        needsChange = true;
                        if (dist > 200) tryActivateBoost(cpu, settings);
                    } else {
                        const safeDir = findSafeDirection(cpu, targetDx, targetDy);
                        if (safeDir) {
                            newDx = safeDir.dx;
                            newDy = safeDir.dy;
                            needsChange = true;
                        }
                    }
                } else {
                    // 陣形位置到達 → BOSSと同方向に並走
                    ai.phase = 'formation';
                    if (boss.dx !== 0 || boss.dy !== 0) {
                        if (isDirectionSafe(cpu, boss.dx, boss.dy, 3)) {
                            newDx = boss.dx;
                            newDy = boss.dy;
                            needsChange = true;
                        }
                    }
                }
            }
        }
        // 敵がいなくなったら陣形解除 → 通常行動に戻る
        if (ai.phase === 'formation' && !hasNearbyEnemy && !bossHasNearbyEnemy) {
            ai.phase = 'idle';
        }

        // === 自陣にいる場合 ===
        if (isInOwnTerritory(cpu)) {
            if (cpu.gridTrail.length > 0) {
                // 軌跡があるのに自陣にいる = 領地確保完了
                ai.phase = 'idle';
            }
            
            // 敵が近くにいる場合 → 陣地内で警戒（現在方向が安全ならそのまま直進維持）
            if (hasNearbyEnemy && (ai.phase === 'idle' || ai.phase === 'returning' || ai.phase === 'patrolling' || ai.phase === 'formation')) {
                ai.phase = 'patrolling';

                // 現在の方向が安全＆自陣内なら方向維持（無駄な転換をしない）
                if (currentDirSafe && (cpu.dx !== 0 || cpu.dy !== 0)) {
                    const checkX = cpu.x + cpu.dx * GRID_SIZE * 5;
                    const checkY = cpu.y + cpu.dy * GRID_SIZE * 5;
                    const checkGx = game.toGrid(checkX);
                    const checkGy = game.toGrid(checkY);
                    if (checkGy >= 0 && checkGy < state.GRID_ROWS &&
                        checkGx >= 0 && checkGx < state.GRID_COLS &&
                        state.worldGrid[checkGy] && state.worldGrid[checkGy][checkGx] === cpu.id) {
                        // 安全＆自陣内 → 現在の方向をそのまま維持
                    } else {
                        // 自陣端に近づいた → 緩やかに方向転換
                        const patrolDir = getPatrolDirection(cpu, ai);
                        if (isDirectionSafe(cpu, patrolDir.dx, patrolDir.dy, 3)) {
                            newDx = patrolDir.dx;
                            newDy = patrolDir.dy;
                            needsChange = true;
                        }
                    }
                } else {
                    // 現在の方向が危険 → 安全な方向を探す
                    const patrolDir = getPatrolDirection(cpu, ai);
                    if (isDirectionSafe(cpu, patrolDir.dx, patrolDir.dy, 3)) {
                        newDx = patrolDir.dx;
                        newDy = patrolDir.dy;
                        needsChange = true;
                    }
                }
            }
            // 敵がいない & idle/returning → 領地拡大を検討
            else if (!hasNearbyEnemy && (ai.phase === 'idle' || ai.phase === 'returning' || ai.phase === 'patrolling' || ai.phase === 'formation')) {
                // 役割分担: チームメイトCPUが拡大中なら防御を優先（チーム領地を守る）
                if (teammateIsExpanding) {
                    ai.phase = 'patrolling';
                    // 現在方向が安全ならそのまま維持
                    if (!currentDirSafe || cpu.dx === 0 && cpu.dy === 0) {
                        const patrolDir = getPatrolDirection(cpu, ai);
                        if (isDirectionSafe(cpu, patrolDir.dx, patrolDir.dy, 3)) {
                            newDx = patrolDir.dx;
                            newDy = patrolDir.dy;
                            needsChange = true;
                        }
                    }
                }
                // チームメイトが拡大中でない → 自分が拡大する
                else if (Math.random() < settings.aggressiveness * 0.4) {
                    ai.phase = 'expanding';
                    ai.turnCount = 0;
                    ai.stepsInDirection = 0;

                    // チーム領地境界から最適方向を選択
                    let expandDir = null;
                    if (hasTeammate) {
                        const coopDir = getCooperativeExpandDirection(cpu, allTeammates);
                        if (coopDir && isDirectionSafe(cpu, coopDir.dx, coopDir.dy, 5)) {
                            expandDir = coopDir;
                        }
                    } else {
                        // チームメイトがいなくてもfrontierを使う
                        expandDir = findTeamExpandFrontier(cpu);
                    }

                    // frontier方向が安全でない場合は通常の安全な方向
                    if (!expandDir) {
                        expandDir = findSafeDirection(cpu);
                    }

                    if (expandDir) {
                        newDx = expandDir.dx;
                        newDy = expandDir.dy;
                        ai.captureDirection = { dx: expandDir.dx, dy: expandDir.dy };
                        needsChange = true;
                    }
                }
            }
        }
        
        // === 領地拡大中 ===
        if (ai.phase === 'expanding' && cpu.gridTrail.length > 0) {
            ai.stepsInDirection++;

            // 敵が近くにいる場合 → 即座に帰還（警戒行動）
            if (hasNearbyEnemy && closestEnemy && closestEnemy.dist < 200) {
                ai.phase = 'returning';
            }
            // 軌跡が上限の70%に達したら早めに帰還（隙を見せない）
            else if (cpu.gridTrail.length >= settings.maxTrailLength * 0.7) {
                ai.phase = 'returning';
            }
            // 現在方向が安全なら直進を維持（蛇行しない）
            else if (currentDirSafe && ai.stepsInDirection <= settings.captureSize) {
                // そのまま直進 → 方向変更不要
            }
            // 一定歩数進んだら曲がる（小さな四角形を描く）
            else if (ai.stepsInDirection > settings.captureSize) {
                ai.turnCount++;
                ai.stepsInDirection = 0;

                // 90度曲がる（時計回り）
                const oldDx = cpu.dx;
                const oldDy = cpu.dy;
                newDx = -oldDy;
                newDy = oldDx;

                // 曲がった方向が安全かチェック
                if (!isDirectionSafe(cpu, newDx, newDy, 4)) {
                    // 反対方向を試す
                    newDx = oldDy;
                    newDy = -oldDx;
                    if (!isDirectionSafe(cpu, newDx, newDy, 4)) {
                        // どちらも危険 → 戻る
                        ai.phase = 'returning';
                    }
                }

                needsChange = true;

                // 2回曲がったら自動的に帰還（小さく取って素早く戻る）
                if (ai.turnCount >= 2) {
                    ai.phase = 'returning';
                }
            }

            // 敵の軌跡を狙う（強CPUのみ・現在方向が安全でない時のみ）
            if (!currentDirSafe && Math.random() < settings.chaseChance) {
                const enemy = findNearestEnemyTrail(cpu);
                if (enemy && enemy.dist < 200) {
                    const dx = enemy.x - cpu.x;
                    const dy = enemy.y - cpu.y;
                    const mag = Math.sqrt(dx * dx + dy * dy);
                    if (mag > 0) {
                        const targetDx = dx / mag;
                        const targetDy = dy / mag;
                        if (isDirectionSafe(cpu, targetDx, targetDy, 5)) {
                            newDx = targetDx;
                            newDy = targetDy;
                            needsChange = true;
                        }
                    }
                }
            }
        }

        // === 自陣に戻る ===
        if (ai.phase === 'returning' ||
            (cpu.gridTrail.length > 0 && cpu.gridTrail.length >= settings.maxTrailLength)) {
            ai.phase = 'returning';

            // 現在の方向が安全で、自陣に向かっているなら直進維持
            if (currentDirSafe && (cpu.dx !== 0 || cpu.dy !== 0)) {
                const home = findNearestOwnTerritory(cpu);
                if (home) {
                    const dx = home.x - cpu.x;
                    const dy = home.y - cpu.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > GRID_SIZE) {
                        // 現在の方向と自陣方向の角度差チェック（90度以内なら直進維持）
                        const dot = cpu.dx * (dx / dist) + cpu.dy * (dy / dist);
                        if (dot > 0) {
                            // 自陣方向に概ね向かっている → 直進維持
                        } else {
                            // 自陣と反対方向 → 方向修正
                            const targetDx = dx / dist;
                            const targetDy = dy / dist;
                            const safeDir = findSafeDirection(cpu, targetDx, targetDy);
                            if (safeDir) {
                                newDx = safeDir.dx;
                                newDy = safeDir.dy;
                                needsChange = true;
                            }
                        }
                    }
                }
            } else {
                // 現在方向が危険 or 停止中 → 自陣への最短経路
                const home = findNearestOwnTerritory(cpu);
                if (home) {
                    const dx = home.x - cpu.x;
                    const dy = home.y - cpu.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > GRID_SIZE) {
                        const targetDx = dx / dist;
                        const targetDy = dy / dist;
                        const safeDir = findSafeDirection(cpu, targetDx, targetDy);
                        if (safeDir) {
                            newDx = safeDir.dx;
                            newDy = safeDir.dy;
                            needsChange = true;
                        }
                    }
                }
            }
        }

        // === 初期動作 ===
        if (cpu.dx === 0 && cpu.dy === 0) {
            const safeDir = findSafeDirection(cpu);
            if (safeDir) {
                newDx = safeDir.dx;
                newDy = safeDir.dy;
                needsChange = true;
            } else {
                // どこも安全でない場合はランダム
                const angle = Math.random() * Math.PI * 2;
                newDx = Math.cos(angle);
                newDy = Math.sin(angle);
                needsChange = true;
            }
        }

        // 方向を適用
        if (needsChange) {
            const mag = Math.sqrt(newDx * newDx + newDy * newDy);
            if (mag > 0) {
                cpu.dx = newDx / mag;
                cpu.dy = newDy / mag;
                ai.lastDirectionChange = now;
                cpu.hasMovedSinceSpawn = true;
            }
        }
    });
}

/**
 * ラウンド開始時のCPUリセット
 */
function resetCpusForNewRound() {
    const mode = GAME_MODES[state.currentModeIdx];

    // スウォームBOTは別管理なのでスキップ
    Object.values(cpuPlayers).forEach(cpu => {
        if (cpu.isSwarmBot) return;

        cpu.hasChattedInRound = false;

        if (cpu.isTanukichi) {
            // たぬきち: TEAM戦では「たぬき」チームに所属
            if (mode === 'TEAM') {
                cpu.team = TANUKI_TEAM_NAME;
                cpu.requestedTeam = TANUKI_TEAM_NAME;
                cpu.color = TANUKI_TEAM_COLOR;
                cpu.name = `[${TANUKI_TEAM_NAME}] たぬきち`;
            } else {
                cpu.team = '';
                cpu.requestedTeam = '';
                cpu.color = cpu.originalColor;
                cpu.name = 'たぬきち';
            }
        } else if (mode === 'TEAM') {
            // チーム戦: CPUチームに所属
            cpu.team = CPU_TEAM_NAME;
            cpu.requestedTeam = CPU_TEAM_NAME;
            cpu.color = CPU_TEAM_COLOR;
            const cleanName = cpu.name.replace(/^\[.*?\]\s*/, '');
            cpu.name = `[${CPU_TEAM_NAME}] ${cleanName}`;
        } else {
            // SOLOモード: チームタグ削除
            cpu.team = '';
            cpu.color = cpu.originalColor;
            cpu.name = cpu.name.replace(/^\[.*?\]\s*/, '');
        }

        // リスポーン
        if (game.respawnPlayer) {
            game.respawnPlayer(cpu, true);
        }

        // AI状態リセット
        cpu.ai = {
            lastDirectionChange: 0,
            phase: 'idle',
            captureDirection: null,
            turnCount: 0,
            targetAngle: 0,
            stepsInDirection: 0,
            patrolAngle: 0,
            patrolChangeTime: 0,
            formationIndex: 0
        };
    });

    // CPUが足りない場合は追加（強制実行）
    adjustCpuCount(true);

    // スウォームモードの場合はスウォームを再構築
    if (state.swarmMode) {
        resetSwarmForNewRound();
    }
}

/**
 * 全CPUを削除
 */
function removeAllCpus() {
    const cpuIds = Object.keys(cpuPlayers);
    cpuIds.forEach(id => removeCpuPlayer(id));
}

/**
 * CPUループ開始
 */
let cpuUpdateTimer = null;
let cpuAdjustTimer = null;
let swarmUpdateTimer = null;

function startCpuLoop() {
    // AI更新ループ
    cpuUpdateTimer = setInterval(updateCpuAI, CPU_UPDATE_INTERVAL);

    // スウォームAI更新ループ（200msごと）
    swarmUpdateTimer = setInterval(updateSwarmAI, 200);

    // CPU数調整ループ（2秒ごと - CPUが消えた場合の素早い補充）
    cpuAdjustTimer = setInterval(adjustCpuCount, 2000);

    // 初回調整
    setTimeout(adjustCpuCount, 1000);

    console.log('[CPU] CPU management loop started');
}

/**
 * CPUループ停止
 */
function stopCpuLoop() {
    if (cpuUpdateTimer) {
        clearInterval(cpuUpdateTimer);
        cpuUpdateTimer = null;
    }
    if (cpuAdjustTimer) {
        clearInterval(cpuAdjustTimer);
        cpuAdjustTimer = null;
    }
    if (swarmUpdateTimer) {
        clearInterval(swarmUpdateTimer);
        swarmUpdateTimer = null;
    }
}

/**
 * 人間のチャットに反応してBOTが発言
 */
function onHumanChat() {
    // 未発言のCPUからランダムに1体選んで反応
    const available = Object.values(cpuPlayers).filter(c => c.state === 'active' && !c.hasChattedInRound);
    if (available.length === 0 || !game) return;
    const cpu = available[Math.floor(Math.random() * available.length)];
    cpu.hasChattedInRound = true;
    setTimeout(() => {
        game.broadcast({ type: 'chat', text: 'ニンゲンヲ駆逐スル', color: cpu.color, name: cpu.name });
    }, 500 + Math.random() * 2000);
}

// ============================================================
// スウォームモード（BOT50体連結）
// ============================================================
const swarmBots = {};  // スウォームBOT管理用

/**
 * スウォームBOTを1体生成
 */
function createSwarmBot(index) {
    if (!game) return null;

    const id = game.generateShortId();
    const color = CPU_TEAM_COLOR;
    const emoji = '🤖';
    const isLeader = (index === 0);
    const baseName = isLeader ? 'SWARM-L' : `BOT`;

    // スウォームBOTは常にチーム名付き
    const displayName = `[${CPU_TEAM_NAME}] ${baseName}`;

    const bot = {
        id,
        name: displayName,
        color,
        emoji,
        originalColor: color,
        x: 0, y: 0,
        dx: 0, dy: 0,
        gridTrail: [], trail: [],
        score: 0, kills: 0,
        state: 'waiting',
        invulnerableUntil: 0,
        afkDeaths: 0,
        hasMovedSinceSpawn: false,
        requestedTeam: CPU_TEAM_NAME,
        team: CPU_TEAM_NAME,
        boostUntil: 0,
        boostCooldownUntil: 0,
        autoRun: false,
        spawnTime: 0,
        hasChattedInRound: false,
        isCpu: true,
        isBoss: false,
        isSwarmBot: true,
        scale: 1,
        difficulty: isLeader ? 'MEDIUM' : 'WEAK',
        settings: AI_SETTINGS[isLeader ? 'MEDIUM' : 'WEAK'],
        ws: { readyState: 1, send: () => {}, close: () => {} },
        // チェーン
        chainRole: 'none',
        chainLeaderId: null,
        chainFollowers: [],
        chainPathHistory: [],
        chainIndex: 0,
        chainHasInput: false,
        chainAnchorX: 0,
        chainAnchorY: 0,
        chainOffsetX: 0,
        chainOffsetY: 0,
        // AI状態
        ai: {
            lastDirectionChange: 0,
            phase: 'idle',
            captureDirection: null,
            turnCount: 0,
            targetAngle: 0,
            stepsInDirection: 0,
            swarmAttackTarget: null,
            swarmDetachTime: 0
        }
    };

    state.players[id] = bot;
    cpuPlayers[id] = bot;
    swarmBots[id] = bot;

    return bot;
}

/**
 * スウォーム生成（50体のBOTを個別にスポーン → 自然に連結）
 */
function createSwarm() {
    if (!game) return;

    // 既存スウォームがあれば先に破棄
    destroySwarm();

    // 強制チーム戦モードに切替（連結にはチーム戦が必要）
    const teamIdx = GAME_MODES.indexOf('TEAM');
    if (teamIdx >= 0 && state.currentModeIdx !== teamIdx) {
        state.currentModeIdx = teamIdx;
        console.log('[SWARM] Forced TEAM mode for swarm');
        game.broadcast({ type: 'round_start', mode: 'TEAM', obstacles: state.obstacles, gears: state.gears || [], world: { width: state.WORLD_WIDTH, height: state.WORLD_HEIGHT }, tf: state.territoryRects, tv: state.territoryVersion });
    }

    console.log(`[SWARM] Creating swarm with ${SWARM_BOT_COUNT} bots (organic mode)...`);

    state.swarmMode = true;
    state.swarmLeaderId = null;  // 固定リーダーなし

    // 全BOTを個別にスポーン（チェーンなし、自由行動から開始）
    for (let i = 0; i < SWARM_BOT_COUNT; i++) {
        const bot = createSwarmBot(i);
        if (!bot) continue;
        if (game.respawnPlayer) game.respawnPlayer(bot, true);
        bot.hasMovedSinceSpawn = true;
        bot.ai.phase = 'seek_ally';  // 最初は仲間を探す
        state.roundParticipants.add(bot.id);
    }

    // 全BOTのマスタ情報をブロードキャスト
    const pmPlayers = Object.values(swarmBots).map(bot => {
        const d = { i: bot.id, n: bot.name, c: bot.color, e: bot.emoji, t: bot.team || '' };
        if (bot.scale && bot.scale !== 1) d.sc = bot.scale;
        return d;
    });
    game.broadcast({ type: 'pm', players: pmPlayers });

    console.log(`[SWARM] ${Object.keys(swarmBots).length} bots spawned, seeking allies...`);
}

/**
 * スウォーム破棄（全BOT削除）
 */
function destroySwarm() {
    const ids = Object.keys(swarmBots);
    if (ids.length === 0) return;

    console.log(`[SWARM] Destroying swarm (${ids.length} bots)...`);

    ids.forEach(id => {
        const bot = swarmBots[id];
        if (bot) {
            if (game.detachFromChain) game.detachFromChain(bot);
            for (let y = 0; y < state.GRID_ROWS; y++) {
                for (let x = 0; x < state.GRID_COLS; x++) {
                    if (state.worldGrid[y][x] === id) state.worldGrid[y][x] = null;
                }
            }
            if (bot.id) state.usedShortIds.delete(bot.id);
            delete state.players[id];
            delete cpuPlayers[id];
        }
        delete swarmBots[id];
    });

    state.swarmMode = false;
    state.swarmLeaderId = null;
    console.log('[SWARM] Swarm destroyed');
}

/**
 * 最も近いスウォーム仲間（チェーンターゲット）を探す
 * ソロBOT or 別チェーンのメンバーを返す
 */
function findNearestSwarmAlly(bot) {
    let nearest = null;
    let minDist = Infinity;

    Object.values(swarmBots).forEach(other => {
        if (other.id === bot.id || other.state !== 'active') return;
        // 自分と同じチェーンのメンバーは除外
        if (bot.chainLeaderId && other.chainLeaderId === bot.chainLeaderId) return;
        if (bot.chainRole === 'leader' && other.chainLeaderId === bot.id) return;

        const d = Math.hypot(other.x - bot.x, other.y - bot.y);
        if (d < minDist) {
            minDist = d;
            nearest = { bot: other, dist: d };
        }
    });

    return nearest;
}

/**
 * BOTのチェーンサイズを取得
 */
function getChainSize(bot) {
    if (bot.chainRole === 'none') return 1;
    let leaderId = bot.chainRole === 'leader' ? bot.id : bot.chainLeaderId;
    let leader = state.players[leaderId];
    if (!leader) return 1;
    let count = 1;
    let current = leader;
    while (current.chainFollowers && current.chainFollowers.length > 0) {
        count++;
        current = state.players[current.chainFollowers[0]];
        if (!current) break;
    }
    return count;
}

/**
 * 敵プレイヤーを探す（スウォームBOT以外の敵）
 */
function findNearestEnemy(bot, range) {
    let nearest = null;
    let minDist = Infinity;

    Object.values(state.players).forEach(p => {
        if (p.id === bot.id || p.state !== 'active') return;
        if (p.isSwarmBot) return;
        if (p.team && p.team === bot.team) return;
        const d = Math.hypot(p.x - bot.x, p.y - bot.y);
        if (d < range && d < minDist) {
            minDist = d;
            nearest = { player: p, dist: d };
        }
    });

    return nearest;
}

/**
 * 2つのチェーンをマージ（小さい方を解散→大きい方に合流）
 */
function mergeChains(botA, botB) {
    // 各チェーンのリーダーとサイズを取得
    let leaderA = botA.chainRole === 'leader' ? botA :
        (botA.chainLeaderId ? state.players[botA.chainLeaderId] : botA);
    let leaderB = botB.chainRole === 'leader' ? botB :
        (botB.chainLeaderId ? state.players[botB.chainLeaderId] : botB);

    if (!leaderA || !leaderB) return false;
    if (leaderA.id === leaderB.id) return false;  // 同じチェーン

    const sizeA = getChainSize(leaderA);
    const sizeB = getChainSize(leaderB);
    const totalSize = sizeA + sizeB;
    if (totalSize > SWARM_BOT_COUNT) return false;

    // 小さい方を解散して大きい方に合流
    const smaller = sizeA <= sizeB ? leaderA : leaderB;
    const larger = sizeA <= sizeB ? leaderB : leaderA;

    // 小さいチェーンのメンバーを収集
    const membersToMove = [];
    let current = smaller;
    while (current) {
        membersToMove.push(current);
        const nextId = current.chainFollowers && current.chainFollowers[0];
        current = nextId ? state.players[nextId] : null;
    }

    // 小さいチェーンを解散
    if (game.detachFromChain) game.detachFromChain(smaller);

    // メンバーを大きいチェーンに順次接続
    membersToMove.forEach(member => {
        if (member.chainRole !== 'none') {
            if (game.detachFromChain) game.detachFromChain(member);
        }
        if (game.tryChainAttach) game.tryChainAttach(member, larger);
    });

    console.log(`[SWARM] Merged chains: ${sizeA}+${sizeB} → ${getChainSize(larger)}`);
    return true;
}

/**
 * BOTの壁回避方向を計算
 */
function getWallAvoidDir(bot) {
    const margin = 150;
    let dx = 0, dy = 0;
    if (bot.x < margin) dx = 1;
    if (bot.x > state.WORLD_WIDTH - margin) dx = -1;
    if (bot.y < margin) dy = 1;
    if (bot.y > state.WORLD_HEIGHT - margin) dy = -1;
    if (dx === 0 && dy === 0) return null;
    const mag = Math.hypot(dx, dy);
    return { dx: dx / mag, dy: dy / mag };
}

/**
 * 方向を設定（正規化付き）
 */
function setDirection(bot, dx, dy) {
    const mag = Math.hypot(dx, dy);
    if (mag > 0) {
        bot.dx = dx / mag;
        bot.dy = dy / mag;
    }
}

/**
 * スウォームAI更新（自然連結 + 合流 + 攻撃）
 */
function updateSwarmAI() {
    if (!state.swarmMode || !state.roundActive) return;

    const now = Date.now();

    Object.values(swarmBots).forEach(bot => {
        // === 死亡/待機BOTのリスポーン ===
        if (bot.state === 'waiting' || bot.state === 'dead') {
            if (game.respawnPlayer) {
                game.respawnPlayer(bot, false);
                bot.hasMovedSinceSpawn = true;
                bot.ai.phase = 'seek_ally';
            }
            return;
        }
        if (bot.state !== 'active') return;

        // === フォロワーは移動をゲームループに任せる ===
        if (bot.chainRole === 'follower') return;

        const ai = bot.ai;

        // === 壁回避（最優先） ===
        const wallDir = getWallAvoidDir(bot);
        if (wallDir) {
            setDirection(bot, wallDir.dx * 0.7 + bot.dx * 0.3, wallDir.dy * 0.7 + bot.dy * 0.3);
        }

        // === 敵検知 ===
        const enemy = findNearestEnemy(bot, SWARM_ATTACK_RANGE);

        // === チェーンリーダーの行動 ===
        // リーダーは常に前進し続ける。仲間探しはしない（ソロが合流してくる）
        if (bot.chainRole === 'leader') {
            // 敵が近い → チェーンごと敵に向かう
            if (enemy) {
                const dx = enemy.player.x - bot.x;
                const dy = enemy.player.y - bot.y;
                setDirection(bot, dx, dy);
                // ブースト
                if (!bot.boostUntil || now >= bot.boostUntil) {
                    if (!bot.boostCooldownUntil || now >= bot.boostCooldownUntil) {
                        bot.boostUntil = now + BOOST_DURATION;
                        bot.boostCooldownUntil = now + BOOST_COOLDOWN;
                        bot.boosting = true;
                    }
                }
                ai.lastDirectionChange = now;
                return;
            }

            // 近くに別チェーンが来たら受動的にマージ（リーダー側からは追わない）
            const ally = findNearestSwarmAlly(bot);
            if (ally && ally.dist < 100 && (ally.bot.chainRole === 'leader' || ally.bot.chainRole === 'none')) {
                mergeChains(bot, ally.bot);
            }

            // 常に前進＋緩やかな巡回（止まらない）
            if (now - ai.lastDirectionChange > 2000) {
                if (!wallDir) {
                    const angle = Math.atan2(bot.dy, bot.dx) + (Math.random() - 0.5) * Math.PI / 3;
                    setDirection(bot, Math.cos(angle), Math.sin(angle));
                }
                ai.lastDirectionChange = now;
            }
            // dx/dyが0なら初期方向設定（停止防止）
            if (bot.dx === 0 && bot.dy === 0) {
                const angle = Math.random() * Math.PI * 2;
                setDirection(bot, Math.cos(angle), Math.sin(angle));
            }
            return;
        }

        // === ソロBOT（chainRole === 'none'）の行動 ===

        // 敵が近い → 攻撃
        if (enemy && enemy.dist < 150) {
            const dx = enemy.player.x - bot.x;
            const dy = enemy.player.y - bot.y;
            setDirection(bot, dx, dy);
            if (!bot.boostUntil || now >= bot.boostUntil) {
                if (!bot.boostCooldownUntil || now >= bot.boostCooldownUntil) {
                    bot.boostUntil = now + BOOST_DURATION;
                    bot.boostCooldownUntil = now + BOOST_COOLDOWN;
                    bot.boosting = true;
                }
            }
            return;
        }

        // 仲間を探して合流（リーダーや既存チェーンを優先）
        const ally = findNearestSwarmAlly(bot);
        if (ally) {
            // 近ければチェーン接続を試みる（成功したらフォロワーになり移動委任）
            if (ally.dist < 100 && game.tryChainAttach) {
                game.tryChainAttach(bot, ally.bot);
                // 成功してもしなくても止まらず前進し続ける
            }
            // 仲間に向かって移動（止まらない）
            if (bot.chainRole === 'none' && ally.dist < 600) {
                const dx = ally.bot.x - bot.x;
                const dy = ally.bot.y - bot.y;
                if (!wallDir) setDirection(bot, dx, dy);
                ai.lastDirectionChange = now;
                return;
            }
        }

        // 誰もいなければ前進しつつ巡回（停止防止）
        if (bot.dx === 0 && bot.dy === 0) {
            const angle = Math.random() * Math.PI * 2;
            setDirection(bot, Math.cos(angle), Math.sin(angle));
        }
        if (now - ai.lastDirectionChange > 1500) {
            if (!wallDir) {
                const angle = Math.atan2(bot.dy, bot.dx) + (Math.random() - 0.5) * Math.PI / 2;
                setDirection(bot, Math.cos(angle), Math.sin(angle));
            }
            ai.lastDirectionChange = now;
        }
    });
}

/**
 * スウォームのラウンドリセット
 */
function resetSwarmForNewRound() {
    if (!state.swarmMode) return;

    console.log('[SWARM] Resetting swarm for new round...');
    destroySwarm();
    state.swarmMode = true;
    createSwarm();
}

// ============================================================
// 連結デバッグモード（chain_debug）
// 3体のBOTが "sato" に接近して連結する
// ============================================================
const debugChainBots = [];
let debugChainTimer = null;

function startDebugChainMode() {
    if (!CHAIN_DEBUG) return;
    console.log('[CHAIN-DEBUG] Starting chain debug mode (100 bots)');

    // 1秒後に初期化（サーバー起動完了を待つ）
    setTimeout(() => {
        spawnDebugChainBots();
        // 200msごとにBOTのAIを更新
        debugChainTimer = setInterval(updateDebugChainBots, 200);
    }, 2000);
}

const DEBUG_BOT_COUNT = 2;

function spawnDebugChainBots() {
    for (let i = 0; i < DEBUG_BOT_COUNT; i++) {
        const id = game.generateShortId();
        const bot = {
            id,
            name: `Bot${i + 1}`,
            color: '#ff8800',
            emoji: '🔗',
            originalColor: '#ff8800',
            x: 0, y: 0, dx: 0, dy: 0,
            gridTrail: [], trail: [],
            score: 0, kills: 0, deaths: 0,
            state: 'waiting',
            invulnerableUntil: 0,
            afkDeaths: 0,
            hasMovedSinceSpawn: false,
            hasBeenActive: false,
            requestedTeam: '', team: '',
            boostUntil: 0, boostCooldownUntil: 0,
            autoRun: false, spawnTime: 0,
            hasChattedInRound: false,
            isCpu: true, isBoss: false, scale: 1,
            difficulty: 'WEAK',
            settings: AI_SETTINGS['WEAK'],
            ws: { readyState: 1, send: () => {}, close: () => {} },
            ai: {
                lastDirectionChange: 0,
                phase: 'debug_chase',
                targetAngle: 0,
                stepsInDirection: 0
            },
            // チェーンプロパティ
            chainRole: 'none', chainLeaderId: null,
            chainFollowers: [], chainPathHistory: [],
            chainIndex: 0, chainHasInput: false,
            chainAnchorX: 0, chainAnchorY: 0,
            chainOffsetX: 0, chainOffsetY: 0,
            chainPrevId: null, chainPrevX: undefined, chainPrevY: undefined
        };

        state.players[id] = bot;
        cpuPlayers[id] = bot;
        debugChainBots.push(bot);
        console.log(`[CHAIN-DEBUG] Created debug bot: ${bot.name} (id: ${id})`);
    }
}

function updateDebugChainBots() {
    if (!state.roundActive) return;

    // "sato" を探す（名前に "sato" を含むプレイヤー、大文字小文字無視）
    const sato = Object.values(state.players).find(p =>
        !p.isCpu && p.state === 'active' && p.name && p.name.toLowerCase().includes('sato')
    );

    for (const bot of debugChainBots) {
        // 死んだら復活
        if (bot.state === 'waiting' || bot.state === 'dead') {
            if (sato) {
                // satoと同じチームに設定してリスポーン
                bot.team = sato.team || '';
                bot.requestedTeam = sato.team || '';
                if (sato.team) {
                    bot.name = `[${sato.team}] ${bot.name.replace(/^\[.*?\]\s*/, '')}`;
                    // チーム色を合わせる
                    bot.color = game.getTeamColor(sato.team);
                }
                if (game.respawnPlayer) game.respawnPlayer(bot, false);
                // PMブロードキャスト
                const pmData = { i: bot.id, n: bot.name, c: bot.color, e: bot.emoji, t: bot.team || '' };
                game.broadcast({ type: 'pm', players: [pmData] });
            }
            continue;
        }

        if (bot.state !== 'active') continue;

        // 既に連結済みならAI更新しない
        if (bot.chainRole === 'follower') continue;

        if (!sato) {
            // satoがいなければその場で待機
            bot.dx = 0; bot.dy = 0;
            continue;
        }

        const dist = Math.hypot(sato.x - bot.x, sato.y - bot.y);

        // 100px以内なら連結を試みる
        if (dist <= 100 && bot.hasMovedSinceSpawn && sato.hasMovedSinceSpawn) {
            if (game.tryChainAttach) {
                const success = game.tryChainAttach(bot, sato);
                if (success) {
                    console.log(`[CHAIN-DEBUG] ${bot.name} attached to ${sato.name}!`);
                    continue;
                }
            }
        }

        // satoに向かって移動
        if (dist > 5) {
            const angle = Math.atan2(sato.y - bot.y, sato.x - bot.x);
            bot.dx = Math.cos(angle);
            bot.dy = Math.sin(angle);
            bot.hasMovedSinceSpawn = true;
        } else {
            bot.dx = 0;
            bot.dy = 0;
        }
    }
}

function stopDebugChainMode() {
    if (debugChainTimer) {
        clearInterval(debugChainTimer);
        debugChainTimer = null;
    }
    // BOTを削除
    for (const bot of debugChainBots) {
        delete state.players[bot.id];
        delete cpuPlayers[bot.id];
        if (bot.id) state.usedShortIds.delete(bot.id);
    }
    debugChainBots.length = 0;
}

module.exports = {
    setDependencies,
    createCpuPlayer,
    createTanukichi,
    removeCpuPlayer,
    adjustCpuCount,
    updateCpuAI,
    resetCpusForNewRound,
    removeAllCpus,
    startCpuLoop,
    stopCpuLoop,
    getCpuCount,
    getRealPlayerCount,
    onHumanChat,
    cpuPlayers,
    // スウォーム
    createSwarm,
    destroySwarm,
    updateSwarmAI,
    resetSwarmForNewRound,
    swarmBots,
    // 連結デバッグ
    startDebugChainMode,
    stopDebugChainMode
};

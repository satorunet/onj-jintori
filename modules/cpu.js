/**
 * modules/cpu.js
 * CPUプレイヤー管理モジュール
 * 
 * 参加人数が5人以下の場合、2名のCPUを常駐させる
 * 難易度: WEAK（弱）, MEDIUM（中）, STRONG（強）
 */

const config = require('./config');
const { GAME_MODES, TEAM_COLORS, GRID_SIZE, BOOST_DURATION, BOOST_COOLDOWN, state } = config;

// 外部依存（後から設定）
let game = null;

// CPUプレイヤー管理
const cpuPlayers = {};

// CPU設定
const CPU_TARGET_COUNT = 2;          // 常駐させるCPU数
const PLAYER_THRESHOLD = 10;         // CPU発動の閾値（10名以下で出現）
const CPU_UPDATE_INTERVAL = 100;     // CPUのAI更新間隔 (ms)
const CPU_DIRECTION_CHANGE_MIN = 300;  // 方向変更の最小間隔 (ms)
const CPU_TEAM_NAME = '🇯🇵ONJ';       // CPUのチーム名（国旗:日本 + ONJ）
const CPU_MASS_SUICIDE_COOLDOWN = 10 * 60 * 1000;  // CPU全員自滅後のクールダウン (10分)

// CPU全員自滅クールダウン状態
let cpuMassSuicideTime = 0;  // 最後に全員自滅した時刻

// 難易度設定
const AI_SETTINGS = {
    WEAK: {
        name: '弱',
        maxTrailLength: 15,             // 短い軌跡で戻る（安全重視）
        captureSize: 8,                 // 小さな領地を確保
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
        maxTrailLength: 25,
        captureSize: 15,
        chaseChance: 0.3,
        reactionDistance: 100,
        aggressiveness: 0.5,
        attackRange: 200,
        attackProbability: 0.5,
        boostUsage: 0.3,                // 適度にブースト使用
        feintChance: 0.1                // たまにフェイント
    },
    STRONG: {
        name: '強',
        maxTrailLength: 40,
        captureSize: 25,
        chaseChance: 0.6,               // 積極的に軌跡を狙う
        reactionDistance: 120,
        aggressiveness: 0.7,
        attackRange: 300,               // 広い範囲で敵ラインを検知
        attackProbability: 0.8,         // 高確率で攻撃モードに入る
        boostUsage: 0.6,                // 積極的にブースト使用
        feintChance: 0.3                // フェイント動作で騙す
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
 */
function createCpuPlayer(forceDifficulty = null) {
    if (!game) return null;

    // shortIdを唯一のプレイヤーIDとして使用（フルID廃止）
    const id = game.generateShortId();
    const color = game.getUniqueColor();
    const emoji = game.getRandomEmoji();
    const difficulty = forceDifficulty || getRandomDifficulty();
    const settings = AI_SETTINGS[difficulty];
    const baseName = generateCpuName();
    
    // 現在のゲームモードに応じてチーム設定
    const currentMode = GAME_MODES[state.currentModeIdx];
    let team = '';
    let displayName = baseName;
    let finalColor = color;
    
    if (currentMode === 'TEAM') {
        team = CPU_TEAM_NAME;
        displayName = `[${CPU_TEAM_NAME}] ${baseName}`;
        
        // 同じチームのプレイヤー（CPU含む）がいれば、その色を使用
        // まずcpuPlayersから探す
        let existingTeammate = Object.values(cpuPlayers).find(cpu => 
            cpu.team === CPU_TEAM_NAME && cpu.color
        );
        
        // cpuPlayersにいなければstate.players全体から探す
        if (!existingTeammate) {
            existingTeammate = Object.values(state.players).find(p => 
                p.team === CPU_TEAM_NAME && p.color && p.isCpu
            );
        }
        
        if (existingTeammate) {
            finalColor = existingTeammate.color;
            console.log(`[CPU] Using team color from existing teammate: ${finalColor}`);
        }
        // チームメイトがいない場合は新しい色を使用（color変数のまま）
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
        hasMovedSinceSpawn: true,
        requestedTeam: team,
        team: team,
        boostUntil: 0,
        boostCooldownUntil: 0,
        autoRun: false,
        spawnTime: 0,
        hasChattedInRound: false,
        
        // CPU専用プロパティ
        isCpu: true,
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

    const realCount = getRealPlayerCount();
    const cpuCount = getCpuCount();
    const mode = GAME_MODES[state.currentModeIdx];
    
    // チーム戦で10人以上のプレイヤーがいる場合 → CPUは全員自滅して活動しない
    if (mode === 'TEAM' && realCount > PLAYER_THRESHOLD && cpuCount > 0) {
        const now = Date.now();
        
        // クールダウン中かチェック（10分間は繰り返さない）
        if (now - cpuMassSuicideTime < CPU_MASS_SUICIDE_COOLDOWN) {
            // クールダウン中は何もしない（ログも出さない）
            return;
        }
        
        console.log(`[CPU] チーム戦で${realCount}人参加中 → CPU全員自滅（10分間休止）`);
        cpuMassSuicideTime = now;  // クールダウン開始
        
        const cpuIds = Object.keys(cpuPlayers);
        cpuIds.forEach(id => {
            const cpu = cpuPlayers[id];
            if (cpu && cpu.state === 'active') {
                // 自滅処理（削除ではなくwaitingに戻す）
                cpu.state = 'waiting';
                cpu.gridTrail = [];
                cpu.trail = [];
            }
        });
        return;
    }
    
    // クールダウン中はCPU復活もスキップ
    const now = Date.now();
    if (now - cpuMassSuicideTime < CPU_MASS_SUICIDE_COOLDOWN) {
        return;
    }
    
    if (realCount <= PLAYER_THRESHOLD) {
        // プレイヤーが少ない → CPUを増やす
        const needed = CPU_TARGET_COUNT - cpuCount;
        
        // 強CPUがいるかチェック
        const hasStrongCpu = Object.values(cpuPlayers).some(cpu => cpu.difficulty === 'STRONG');
        
        for (let i = 0; i < needed; i++) {
            // 最初のCPUは強CPUがいなければ強、それ以外はランダム
            let difficulty = null;
            if (!hasStrongCpu && i === 0) {
                difficulty = 'STRONG';
            }
            
            const cpu = createCpuPlayer(difficulty);
            if (cpu && game.respawnPlayer) {
                game.respawnPlayer(cpu, true);
                
                // プレイヤーマスタ情報をブロードキャスト
                game.broadcast({
                    type: 'pm',
                    players: [{ 
                        i: cpu.id, 
                        n: cpu.name, 
                        c: cpu.color, 
                        e: cpu.emoji, 
                        t: cpu.team || '' 
                    }]
                });
            }
        }
        
        // waitingになっているCPUを復活させる
        Object.values(cpuPlayers).forEach(cpu => {
            if (cpu.state === 'waiting' && game.respawnPlayer) {
                game.respawnPlayer(cpu, true);
            }
        });
    } else if (realCount > PLAYER_THRESHOLD && cpuCount > 0) {
        // プレイヤーが増えた → CPUをwaiting状態に
        Object.values(cpuPlayers).forEach(cpu => {
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
    if (state.worldGrid[gy] && state.worldGrid[gy][gx] === 'obstacle') {
        return false;
    }
    
    // 自分の軌跡チェック（自爆回避）
    for (const pt of cpu.gridTrail) {
        if (pt.x === gx && pt.y === gy) {
            return false;
        }
    }
    
    return true;
}

/**
 * ピクセル座標での安全チェック
 */
function isSafePixelPosition(cpu, px, py) {
    const gx = game.toGrid(px);
    const gy = game.toGrid(py);
    return isSafePosition(cpu, gx, gy);
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
 * 壁までの距離を計算
 */
function getWallDistance(cpu, dx, dy) {
    if (dx > 0) return state.WORLD_WIDTH - cpu.x;
    if (dx < 0) return cpu.x;
    if (dy > 0) return state.WORLD_HEIGHT - cpu.y;
    if (dy < 0) return cpu.y;
    return Infinity;
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
 * 安全な方向を見つける（複数候補から選択）
 */
function findSafeDirection(cpu, preferredDx = null, preferredDy = null) {
    const directions = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
        { dx: 0.7, dy: 0.7 },
        { dx: -0.7, dy: 0.7 },
        { dx: 0.7, dy: -0.7 },
        { dx: -0.7, dy: -0.7 }
    ];
    
    // 優先方向がある場合、それを先にチェック
    if (preferredDx !== null && preferredDy !== null) {
        if (isDirectionSafe(cpu, preferredDx, preferredDy, 8)) {
            return { dx: preferredDx, dy: preferredDy };
        }
    }
    
    // 安全な方向をシャッフルして探す
    const shuffled = [...directions].sort(() => Math.random() - 0.5);
    for (const dir of shuffled) {
        if (isDirectionSafe(cpu, dir.dx, dir.dy, 6)) {
            return dir;
        }
    }
    
    // どこも安全でない場合、最も安全そうな方向
    for (const dir of shuffled) {
        if (isDirectionSafe(cpu, dir.dx, dir.dy, 2)) {
            return dir;
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
 * 近くの敵プレイヤーを検出
 * @returns {Array} 敵プレイヤーのリスト（距離順）
 */
function findNearbyEnemies(cpu, maxDistance = 300) {
    const enemies = [];
    
    Object.values(state.players).forEach(p => {
        if (p.id === cpu.id || p.state !== 'active') return;
        if (p.team && p.team === cpu.team) return;  // チームメイトは除外
        
        const dx = p.x - cpu.x;
        const dy = p.y - cpu.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < maxDistance) {
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
            x: other.x,
            y: other.y,
            dx: dx,
            dy: dy,
            dist: dist,
            isExpanding: other.gridTrail && other.gridTrail.length > 0,
            phase: other.ai ? other.ai.phase : 'idle'
        });
    });
    
    return teammates;
}

/**
 * チームメイトと協調した領地拡大方向を計算
 * チームメイトと反対方向に行くことで効率的に領地を広げる
 */
function getCooperativeExpandDirection(cpu, teammates) {
    if (teammates.length === 0) return null;
    
    // チームメイトの平均位置を計算
    let avgX = 0, avgY = 0;
    teammates.forEach(t => {
        avgX += t.x;
        avgY += t.y;
    });
    avgX /= teammates.length;
    avgY /= teammates.length;
    
    // チームメイトの反対方向に行く（領地を分散させる）
    const dx = cpu.x - avgX;
    const dy = cpu.y - avgY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist > 0) {
        return { dx: dx / dist, dy: dy / dist };
    }
    
    // 距離が近すぎる場合はランダムな方向
    const angle = Math.random() * Math.PI * 2;
    return { dx: Math.cos(angle), dy: Math.sin(angle) };
}

/**
 * チームメイトが攻撃されているか確認し、援護対象を返す
 */
function findTeammateNeedingHelp(cpu, teammates) {
    for (const teammate of teammates) {
        // チームメイトがラインを出していて、敵が近くにいる場合
        if (teammate.isExpanding) {
            const enemies = findNearbyEnemies(teammate.cpu, 200);
            if (enemies.length > 0) {
                // 援護対象の敵を返す
                const targetEnemy = enemies[0];
                if (targetEnemy.hasTrail) {
                    // 敵がラインを出している → 切りに行くチャンス
                    return {
                        teammate: teammate,
                        enemy: targetEnemy,
                        type: 'attack_enemy_trail'
                    };
                } else {
                    // 敵がラインを出していない → チームメイトの近くに行って威嚇
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
 * 自陣内で右往左往する動き（威嚇・警戒行動）
 */
function getPatrolDirection(cpu, ai) {
    const baseAngle = ai.patrolAngle || 0;
    
    // パトロール方向を頻繁に変える
    if (!ai.patrolChangeTime || Date.now() - ai.patrolChangeTime > 300 + Math.random() * 500) {
        // ランダムに方向転換
        ai.patrolAngle = baseAngle + (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 4 + Math.random() * Math.PI / 2);
        ai.patrolChangeTime = Date.now();
    }
    
    const angle = ai.patrolAngle || Math.random() * Math.PI * 2;
    return { dx: Math.cos(angle), dy: Math.sin(angle) };
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
 * CPUのAI更新（メインロジック）
 */
function updateCpuAI() {
    if (!state.roundActive) return;
    if (!game) return;

    const now = Date.now();

    Object.values(cpuPlayers).forEach(cpu => {
        if (cpu.state !== 'active') return;

        const settings = cpu.settings;
        const ai = cpu.ai;

        // 方向変更の最小間隔チェック
        if (now - ai.lastDirectionChange < CPU_DIRECTION_CHANGE_MIN) {
            // ただし危険な場合は即座に対応
            if (isDirectionSafe(cpu, cpu.dx, cpu.dy, 3)) {
                return;
            }
        }

        let newDx = cpu.dx;
        let newDy = cpu.dy;
        let needsChange = false;

        // === 敵プレイヤー検出 ===
        const nearbyEnemies = findNearbyEnemies(cpu, 250);
        const hasNearbyEnemy = nearbyEnemies.length > 0;
        const closestEnemy = nearbyEnemies[0] || null;
        const isEnemyVeryClose = closestEnemy && closestEnemy.dist < 150;
        const isEnemyDangerous = closestEnemy && closestEnemy.dist < 100 && !closestEnemy.hasTrail;

        // === チームメイトCPU検出（協調行動）===
        const teammateCpus = cpu.team ? findTeammateCpus(cpu) : [];
        const hasTeammate = teammateCpus.length > 0;
        
        // === チームメイト援護モード ===
        if (hasTeammate && cpu.gridTrail.length === 0 && isInOwnTerritory(cpu) && !hasNearbyEnemy) {
            const helpTarget = findTeammateNeedingHelp(cpu, teammateCpus);
            
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
            const stillNeedsHelp = findTeammateNeedingHelp(cpu, teammateCpus);
            
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

        // === 危険回避（最優先）===
        if (!isDirectionSafe(cpu, cpu.dx, cpu.dy, 4)) {
            const safeDir = findSafeDirection(cpu);
            if (safeDir) {
                newDx = safeDir.dx;
                newDy = safeDir.dy;
                needsChange = true;
            }
        }

        // === 壁回避 ===
        const wallDist = getWallDistance(cpu, cpu.dx, cpu.dy);
        if (wallDist < settings.reactionDistance) {
            const safeDir = findSafeDirection(cpu);
            if (safeDir) {
                newDx = safeDir.dx;
                newDy = safeDir.dy;
                needsChange = true;
            }
        }

        // === 自陣にいる場合 ===
        if (isInOwnTerritory(cpu)) {
            if (cpu.gridTrail.length > 0) {
                // 軌跡があるのに自陣にいる = 領地確保完了
                ai.phase = 'idle';
            }
            
            // 敵が近くにいる場合 → 陣地内を右往左往（威嚇・警戒行動）
            if (hasNearbyEnemy && (ai.phase === 'idle' || ai.phase === 'returning' || ai.phase === 'patrolling')) {
                ai.phase = 'patrolling';
                
                // 右往左往する動き
                const patrolDir = getPatrolDirection(cpu, ai);
                
                // 自陣内に留まれる方向かチェック
                const checkX = cpu.x + patrolDir.dx * GRID_SIZE * 3;
                const checkY = cpu.y + patrolDir.dy * GRID_SIZE * 3;
                const checkGx = game.toGrid(checkX);
                const checkGy = game.toGrid(checkY);
                
                // 自陣内に留まる＆安全な場合のみその方向に移動
                if (checkGy >= 0 && checkGy < state.GRID_ROWS && 
                    checkGx >= 0 && checkGx < state.GRID_COLS &&
                    state.worldGrid[checkGy] && state.worldGrid[checkGy][checkGx] === cpu.id &&
                    isDirectionSafe(cpu, patrolDir.dx, patrolDir.dy, 3)) {
                    newDx = patrolDir.dx;
                    newDy = patrolDir.dy;
                    needsChange = true;
                } else {
                    // 自陣外に出そうなら反転
                    ai.patrolAngle = (ai.patrolAngle || 0) + Math.PI;
                }
            }
            // 敵がいない & idle/returning → 領地拡大を検討
            else if (!hasNearbyEnemy && (ai.phase === 'idle' || ai.phase === 'returning' || ai.phase === 'patrolling')) {
                // 領地拡大を開始するかどうか（敵がいないときのみ）
                if (Math.random() < settings.aggressiveness * 0.3) {
                    ai.phase = 'expanding';
                    ai.turnCount = 0;
                    ai.stepsInDirection = 0;
                    
                    // チームメイトがいる場合、協調した方向に出発
                    let expandDir = null;
                    if (hasTeammate) {
                        const coopDir = getCooperativeExpandDirection(cpu, teammateCpus);
                        if (coopDir && isDirectionSafe(cpu, coopDir.dx, coopDir.dy, 5)) {
                            expandDir = coopDir;
                        }
                    }
                    
                    // 協調方向が安全でない場合は通常の安全な方向
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
            // 軌跡が長すぎる → 自陣に戻る
            else if (cpu.gridTrail.length >= settings.maxTrailLength) {
                ai.phase = 'returning';
            }
            // 一定歩数進んだら曲がる（四角形を描く）
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
                
                // 4回曲がったら自動的に戻る
                if (ai.turnCount >= 4) {
                    ai.phase = 'returning';
                }
            }
            
            // 敵の軌跡を狙う（強CPUのみ）
            if (Math.random() < settings.chaseChance) {
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
            
            const home = findNearestOwnTerritory(cpu);
            if (home) {
                const dx = home.x - cpu.x;
                const dy = home.y - cpu.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > GRID_SIZE) {
                    const targetDx = dx / dist;
                    const targetDy = dy / dist;
                    
                    // 安全な経路で戻る
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
            }
        }
    });
}

/**
 * ラウンド開始時のCPUリセット
 */
function resetCpusForNewRound() {
    const mode = GAME_MODES[state.currentModeIdx];
    
    Object.values(cpuPlayers).forEach(cpu => {
        cpu.hasChattedInRound = false;
        
        // モードに応じてチーム設定
        if (mode === 'SOLO') {
            cpu.team = '';
            cpu.color = cpu.originalColor;
            // 名前からチームタグを削除
            cpu.name = cpu.name.replace(/^\[.*?\]\s*/, '');
        } else {
            // TEAMモード: 🇯🇵ONJチームに固定
            cpu.team = CPU_TEAM_NAME;
            // ランダム色を使用（一般プレイヤーと同じ）
            cpu.color = cpu.originalColor;
            const cleanName = cpu.name.replace(/^\[.*?\]\s*/, '');
            cpu.name = `[${CPU_TEAM_NAME}] ${cleanName}`;
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
            patrolChangeTime: 0
        };
    });
    
    // CPUが足りない場合は追加（強制実行）
    adjustCpuCount(true);
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

function startCpuLoop() {
    // AI更新ループ
    cpuUpdateTimer = setInterval(updateCpuAI, CPU_UPDATE_INTERVAL);
    
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
}

module.exports = {
    setDependencies,
    createCpuPlayer,
    removeCpuPlayer,
    adjustCpuCount,
    updateCpuAI,
    resetCpusForNewRound,
    removeAllCpus,
    startCpuLoop,
    stopCpuLoop,
    getCpuCount,
    getRealPlayerCount,
    cpuPlayers
};

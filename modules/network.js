/**
 * modules/network.js
 * WebSocket通信・クライアント同期・ブロードキャストループ
 */

const WebSocket = require('ws');
const zlib = require('zlib');

const config = require('./config');
const botAuth = require('./bot-auth');
const { GAME_MODES, TEAM_COLORS, BOOST_DURATION, BOOST_COOLDOWN, state, bandwidthStats } = config;

// 外部依存（後から設定）
let game = null;
let msgpack = null;
let wss = null;

function setDependencies(g, mp, w) {
    game = g;
    msgpack = mp;
    wss = w;
}

/**
 * WebSocket接続ハンドラを設定
 */
function setupConnectionHandler() {
    if (!wss) return;

    wss.on('connection', (ws, req) => {
        // shortIdを唯一のプレイヤーIDとして使用（フルID廃止）
        const id = game.generateShortId();
        const color = game.getUniqueColor();
        const emoji = game.getRandomEmoji();
        
        
        // クライアントIPアドレスを取得（CloudFlare経由を前提）
        // CloudFlareの場合、CF-Connecting-IPが最も信頼できる実際のクライアントIP
        const ip = req.headers['cf-connecting-ip']          // CloudFlare: 実際のクライアントIP
                || req.headers['x-forwarded-for']?.split(',')[0]?.trim()  // フォールバック1
                || req.headers['x-real-ip']                  // フォールバック2
                || req.socket?.remoteAddress                 // 直接接続（ほぼ使われない）
                || 'unknown';
        
        // CloudFlare経由かどうかをログ出力（デバッグ用）
        const isCloudFlare = !!req.headers['cf-connecting-ip'];
        if (!isCloudFlare) {
            console.log(`[WARN] Connection without CF-Connecting-IP header from: ${ip}`);
        }

        ws.playerId = id;
        state.lastFullSyncVersion[id] = state.territoryVersion;
        
        // Bot認証が必要かチェック
        const requiresAuth = botAuth.needsBotAuth(ip);

        state.players[id] = {
            id, color, emoji, name: `P${id}`,
            x: 0, y: 0, dx: 0, dy: 0,
            gridTrail: [], trail: [],
            score: 0, state: 'waiting',
            ws, invulnerableUntil: 0,
            afkDeaths: 0, hasMovedSinceSpawn: false,
            hasBeenActive: false,  // アクティブにプレイした履歴（join後にactive状態になったか）
            originalColor: color, requestedTeam: '', kills: 0,
            ip: ip,  // IPアドレスを保存
            cfCountry: req.headers['cf-ipcountry'] || null,      // CloudFlare: 国コード
            cfRay: req.headers['cf-ray'] || null,                 // CloudFlare: リクエストID
            pendingAuth: requiresAuth  // 認証待ちフラグ
        };

        if (requiresAuth) {
            const cfInfo = req.headers['cf-ipcountry'] ? ` [CF: ${req.headers['cf-ipcountry']}, Ray: ${req.headers['cf-ray']}]` : '';
            console.log(`[BOT-AUTH] Auth required for IP: ${ip}${cfInfo} (will challenge on join)`);
        }

        // 初期データは常に送信（認証待ちでもログイン画面・ユーザー数は表示する）
        ws.send(JSON.stringify({
            type: 'init', id, color, emoji,
            world: { width: state.WORLD_WIDTH, height: state.WORLD_HEIGHT },
            mode: GAME_MODES[state.currentModeIdx],
            obstacles: state.obstacles,
            tf: state.territoryRects,
            tv: state.territoryVersion,
            teams: game.getTeamStats(),
            pc: Object.keys(state.players).length
        }));

        // 既存プレイヤーのマスタ情報送信
        const existingPlayers = Object.values(state.players)
            .filter(p => p.id !== id && p.name)
            .map(p => ({ i: p.id, n: p.name, c: p.color, e: p.emoji, t: p.team || '' }));
        if (existingPlayers.length > 0) {
            ws.send(JSON.stringify({ type: 'pm', players: existingPlayers }));
        }

        if (!state.roundActive && state.lastResultMsg) {
            // 残り時間を再計算
            const now = Date.now();
            const timeLeft = state.nextRoundStartTime ? Math.max(0, Math.ceil((state.nextRoundStartTime - now) / 1000)) : 15;

            const updatedMsg = {
                ...state.lastResultMsg,
                secondsUntilNext: timeLeft
            };
            ws.send(JSON.stringify(updatedMsg));
        }

        ws.on('message', msg => {
            const byteLen = msg.length || Buffer.byteLength(msg, 'utf8');
            bandwidthStats.totalBytesReceived += byteLen;
            bandwidthStats.periodBytesReceived += byteLen;
            bandwidthStats.msgsReceived++;
            bandwidthStats.periodMsgsReceived++;

            const p = state.players[id];
            if (!p) return;

            // 1バイトまたは2バイトバイナリ移動コマンド
            if (Buffer.isBuffer(msg) && (msg.length === 1 || msg.length === 2)) {
                bandwidthStats.received.input += byteLen;
                if (p.state !== 'active') return;

                const angleByte = msg[0];
                p.hasMovedSinceSpawn = true;
                p.autoRun = false;
                p.afkDeaths = 0;

                if (angleByte !== 255) {
                    const normalized = angleByte / 254;
                    const angle = normalized * 2 * Math.PI - Math.PI;
                    p.dx = Math.cos(angle);
                    p.dy = Math.sin(angle);
                    p.invulnerableUntil = 0;
                }

                // 2バイト目: ブーストリクエスト
                if (msg.length === 2 && msg[1] === 1) {
                    const now = Date.now();
                    const canBoost = !p.boostCooldownUntil || now >= p.boostCooldownUntil;
                    if (canBoost) {
                        p.boostUntil = now + BOOST_DURATION;
                        p.boostCooldownUntil = now + BOOST_COOLDOWN;
                        console.log(`[BOOST] ${p.name} activated boost`);
                    }
                }
                return;
            }

            // JSON形式
            try {
                const data = JSON.parse(msg);
                handleJsonMessage(data, p, id, byteLen);
            } catch (e) { }
        });

        ws.on('close', () => {
            if (state.players[id]) {
                state.usedShortIds.delete(state.players[id].id);
            }
            delete state.players[id];
            delete state.lastFullSyncVersion[id];
        });
    });
}

/**
 * JSONメッセージ処理
 */
async function handleJsonMessage(data, p, id, byteLen) {
    // Bot認証の検証
    if (data.type === 'bot_auth_response') {
        console.log(`[BOT-AUTH] Received auth response from ${id}:`, data.code);
        
        if (!p.pendingAuth) {
            // 認証が不要なのに送られてきた場合は無視
            console.log(`[BOT-AUTH] Player ${id} not pending auth, ignoring`);
            return;
        }
        
        const userInput = String(data.code || '').trim();
        console.log(`[BOT-AUTH] Verifying code for ${id}: "${userInput}"`);
        const result = botAuth.verifyChallenge(id, userInput);
        
        if (result.success) {
            const cfInfo = p.cfCountry ? ` [CF: ${p.cfCountry}, Ray: ${p.cfRay}]` : '';
            console.log(`[BOT-AUTH] Authentication successful for ${id} (IP: ${p.ip}${cfInfo})`);

            // 認証成功：フラグをクリアしてIPアドレスの記録を削除
            p.pendingAuth = false;
            await botAuth.clearAfkTimeout(p.ip);

            p.ws.send(JSON.stringify({
                type: 'bot_auth_success',
                message: '認証に成功しました'
            }));

            // 保存されたjoinデータがあれば自動的にjoin処理を実行
            if (p.pendingJoinData) {
                const joinData = p.pendingJoinData;
                delete p.pendingJoinData;
                handleJsonMessage({ type: 'join', name: joinData.name, team: joinData.team }, p, id, 0);
            }
        } else {
            console.log(`[BOT-AUTH] Authentication failed for ${id}: ${result.reason}`);
            
            // 認証失敗：新しいチャレンジを生成
            const newCaptcha = botAuth.createChallenge(id);
            let errorMsg = '認証に失敗しました。もう一度お試しください。';
            
            if (result.reason === 'timeout') {
                errorMsg = '認証がタイムアウトしました。新しい画像で再度お試しください。';
            } else if (result.reason === 'incorrect') {
                errorMsg = '入力された数字が正しくありません。もう一度お試しください。';
            }
            
            p.ws.send(JSON.stringify({
                type: 'bot_auth_failed',
                message: errorMsg,
                captchaImage: newCaptcha
            }));
        }
        return;
    }
    
    // 認証待ちの場合は join と bot_auth_response 以外を処理しない
    if (p.pendingAuth && data.type !== 'join') {
        return;
    }

    if (data.type === 'join') {
        // Bot認証が必要な場合: joinデータを保存してチャレンジを送信
        if (p.pendingAuth) {
            p.pendingJoinData = { name: data.name, team: data.team };
            const captchaImage = botAuth.createChallenge(id);
            console.log(`[BOT-AUTH] Sending challenge to ${id} on join attempt`);
            p.ws.send(JSON.stringify({
                type: 'bot_auth_required',
                message: '無操作タイムアウト後の再接続のため、認証が必要です',
                captchaImage: captchaImage
            }));
            return;
        }
        bandwidthStats.received.join += byteLen;
        
        // ============================================================
        // 入力値バリデーション
        // ============================================================
        const rawName = data.name || '';
        const rawTeam = data.team || '';
        
        // 名前の長さチェック（8文字制限）
        const nameChars = Array.from(rawName.replace(/[\[\]]/g, '').trim());
        if (nameChars.length > 8) {
            console.log(`[KICK] ${id} (IP: ${p.ip}): Name too long (${nameChars.length} chars)`);
            if (p.ws.readyState === WebSocket.OPEN) {
                p.ws.close(4001, 'Invalid name length');
            }
            return;
        }
        
        // チーム名の長さチェック（5文字制限）
        const teamChars = Array.from(rawTeam.replace(/[\[\]]/g, ''));
        if (teamChars.length > 5) {
            console.log(`[KICK] ${id} (IP: ${p.ip}): Team name too long (${teamChars.length} chars)`);
            if (p.ws.readyState === WebSocket.OPEN) {
                p.ws.close(4002, 'Invalid team name length');
            }
            return;
        }
        
        // 不正な制御文字チェック
        const controlCharRegex = /[\x00-\x1f\x7f]/;
        if (controlCharRegex.test(rawName) || controlCharRegex.test(rawTeam)) {
            console.log(`[KICK] ${id} (IP: ${p.ip}): Invalid control characters`);
            if (p.ws.readyState === WebSocket.OPEN) {
                p.ws.close(4003, 'Invalid characters');
            }
            return;
        }
        
        // ============================================================
        // 正常処理
        // ============================================================
        
        // 名前未指定の場合は「名無し＋ランダム英数字2文字」
        let name = nameChars.join('');
        if (!name) {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            const randomStr = chars.charAt(Math.floor(Math.random() * chars.length)) 
                            + chars.charAt(Math.floor(Math.random() * chars.length));
            name = '名無し' + randomStr;
        }
        // 国旗対応: コードポイント単位で5文字まで（国旗2+チーム名3）
        let team = teamChars.slice(0, 5).join('');

        p.requestedTeam = team;
        const mode = GAME_MODES[state.currentModeIdx];

        if (mode === 'SOLO') {
            p.team = '';
            p.color = p.originalColor;
            p.name = name;
        } else {
            p.team = team;
            if (team) {
                p.name = `[${team}] ${name}`;
                if (TEAM_COLORS[team]) {
                    p.color = TEAM_COLORS[team];
                } else {
                    const teammate = Object.values(state.players).find(op => op.id !== p.id && op.team === team);
                    if (teammate) p.color = teammate.color;
                    else if (Object.values(state.players).some(op => op.id !== p.id && op.color === p.color)) {
                        p.color = game.getUniqueColor();
                    }
                }
            } else {
                p.name = name;
                if (Object.values(state.players).some(op => op.id !== p.id && op.color === p.color)) {
                    p.color = game.getUniqueColor();
                }
            }
        }

        // respawnPlayer は game モジュールから呼び出す（後で統合時に設定）
        if (game.respawnPlayer) game.respawnPlayer(p, true);
        state.lastFullSyncVersion[p.id] = 0;

        game.broadcast({
            type: 'pm',
            players: [{ i: p.id, n: p.name, c: p.color, e: p.emoji, t: p.team || '' }]
        });
    } else if (data.type === 'update_team') {
        bandwidthStats.received.updateTeam += byteLen;
        // 国旗対応: コードポイント単位で5文字まで
        const rawTeam = data.team || '';
        const reqTeamChars = Array.from(rawTeam.replace(/[\[\]]/g, ''));
        
        // チーム名の長さチェック
        if (reqTeamChars.length > 5) {
            console.log(`[WARN] ${id}: Team update too long, truncating`);
        }
        p.requestedTeam = reqTeamChars.slice(0, 5).join('');
    } else if (data.type === 'perf') {
        // パフォーマンスモード設定（AOI調整用）
        const mode = data.mode;
        if (['auto', 'high', 'low'].includes(mode)) {
            p.perfMode = mode;
            console.log(`[PERF] ${p.name || id} set performance mode to: ${mode}`);
        }
        // 不正な値は無視（切断はしない）
    } else if (data.type === 'viewport') {
        // 画面サイズ（AOI最適化用）
        const w = parseInt(data.w) || 0;
        const h = parseInt(data.h) || 0;

        // スマホ上限を超えている場合はキック（CSS改変対策）
        const MAX_VIEWPORT_W = 540;
        const MAX_VIEWPORT_H = 1020;
        if (w > MAX_VIEWPORT_W || h > MAX_VIEWPORT_H) {
            console.log(`[KICK] ${p.name || id} (IP: ${p.ip}): Screen too large ${w}x${h} (max ${MAX_VIEWPORT_W}x${MAX_VIEWPORT_H})`);
            if (p.ws.readyState === WebSocket.OPEN) {
                p.ws.close(4010, 'Screen size too large');
            }
            return;
        }

        // バリデーション（妥当な範囲: 100px以上）
        if (w >= 100 && h >= 100) {
            p.viewportWidth = w;
            p.viewportHeight = h;

            // 四角形AOI: 半幅・半高 + マージン200px
            p.aoiHalfWidth = Math.min(2500, Math.round(w * 0.6 + 200));
            p.aoiHalfHeight = Math.min(2500, Math.round(h * 0.6 + 200));

            console.log(`[VIEWPORT] ${p.name || id}: ${w}x${h} → AOI: ${p.aoiHalfWidth}x${p.aoiHalfHeight}px`);
        }
    } else if (data.type === 'chat') {
        if (p.hasChattedInRound) return;
        bandwidthStats.received.chat += byteLen;
        
        // チャットテキストのバリデーション
        const rawText = (data.text || '').toString();
        
        // 制御文字チェック
        const controlCharRegex = /[\x00-\x1f\x7f]/;
        if (controlCharRegex.test(rawText)) {
            console.log(`[WARN] ${id}: Chat contains control characters, ignored`);
            return;
        }
        
        const text = rawText.substring(0, 15);
        if (text.trim().length > 0) {
            p.hasChattedInRound = true;
            game.broadcast({ type: 'chat', text, color: p.color, name: p.name });
        }
    } else if (Array.isArray(data) && data.length === 2 && p.state === 'active') {
        bandwidthStats.received.input += byteLen;
        const dx = data[0], dy = data[1];
        p.hasMovedSinceSpawn = true;
        p.autoRun = false;
        p.afkDeaths = 0;
        const mag = Math.sqrt(dx * dx + dy * dy);
        if (mag > 0) { p.dx = dx / mag; p.dy = dy / mag; p.invulnerableUntil = 0; }
    } else {
        bandwidthStats.received.other += byteLen;
    }
}

/**
 * ブロードキャストループ開始
 */
function startBroadcastLoop() {
    let frameCount = 0;
    
    // クライアントごとの軌跡送信状態を追跡
    // { clientId: { playerId: { lastSentLength: number, lastSentTime: number } } }
    const clientTrailState = {};
    
    // チーム統計のキャッシュ（変化時のみ送信するため）
    let lastTeamStatsSerialized = '';

    setInterval(() => {
        const now = Date.now();
        const dt = now - bandwidthStats.lastTickTime;
        const lag = Math.max(0, dt - 150);
        bandwidthStats.lagSum += lag;
        bandwidthStats.lagMax = Math.max(bandwidthStats.lagMax, lag);
        bandwidthStats.ticks++;
        bandwidthStats.lastTickTime = now;

        if (!state.roundActive) return;
        frameCount++;

        // 基本プレイヤー情報を準備（軌跡バイナリは後でクライアントごとに生成）
        const activePlayers = Object.values(state.players).filter(p => p.state !== 'waiting');
        
        // ミニマップ（10秒ごと）- 5秒→10秒に変更で帯域節約
        let minimapData = null, scoreboardData = null;
        if (frameCount % 66 === 0) {  // 33→66に変更（10秒毎）
            const territoryBitmap = game.generateMinimapBitmap();
            
            // カラーパレットからIDへのマッピング構築
            const colorToIndex = {};
            Object.entries(territoryBitmap.cp).forEach(([idx, color]) => {
                colorToIndex[color] = parseInt(idx);
            });
            
            // プレイヤー位置を配列形式で生成 [x, y, colorIndex]
            const playerPositions = activePlayers.map(p => [
                Math.round(p.x),
                Math.round(p.y),
                colorToIndex[p.color] || 0
            ]);
            
            minimapData = { tb: territoryBitmap, pl: playerPositions };
        }
        
        // スコアボード（3秒ごと）- 全プレイヤーのスコア情報を送信
        if (frameCount % 20 === 0) {  // 約3秒毎（20フレーム × 150ms）
            scoreboardData = activePlayers.map(p => ({ 
                i: p.id, 
                s: p.score, 
                k: p.kills || 0,
                n: p.name,
                t: p.team || '',
                c: p.color,
                e: p.emoji
            }));
        }

        // テリトリー差分
        const baseStateMsg = {
            type: 's',
            tm: state.timeRemaining,
            pc: Object.keys(state.players).length,
            te: null
        };

        if (frameCount % 20 === 0) {
            const newTeamStats = game.getTeamStats();
            const serialized = JSON.stringify(newTeamStats);
            
            // 前回と変化があった場合のみ送信
            if (serialized !== lastTeamStatsSerialized) {
                baseStateMsg.te = newTeamStats;
                lastTeamStatsSerialized = serialized;
            }
        }

        if (state.territoriesChanged) {
            const tb = buildTerritoryBinary();
            if (tb) {
                baseStateMsg.tb = tb;
                baseStateMsg.tv = state.territoryVersion;
            }
            state.pendingTerritoryUpdates = [];
            state.territoriesChanged = false;
        }

        // クライアントごとに送信
        wss.clients.forEach(c => {
            if (c.readyState !== WebSocket.OPEN) return;
            
            const clientId = c.playerId;
            const myPlayer = state.players[clientId];
            const myX = myPlayer ? myPlayer.x : state.WORLD_WIDTH / 2;
            const myY = myPlayer ? myPlayer.y : state.WORLD_HEIGHT / 2;
            
            // 四角形AOI範囲を決定
            // デフォルト: スマホ基準（480x920 → 488x752）
            let aoiHalfW = 488;
            let aoiHalfH = 752;
            
            if (myPlayer) {
                if (myPlayer.aoiHalfWidth && myPlayer.aoiHalfHeight) {
                    // viewportベースの四角形AOI
                    aoiHalfW = myPlayer.aoiHalfWidth;
                    aoiHalfH = myPlayer.aoiHalfHeight;
                }
                
                // 軽量モードは0.6倍に制限
                if (myPlayer.perfMode === 'low') {
                    aoiHalfW = Math.min(aoiHalfW, 1500);
                    aoiHalfH = Math.min(aoiHalfH, 1500);
                }
                
                // 下限800px
                aoiHalfW = Math.max(800, aoiHalfW);
                aoiHalfH = Math.max(800, aoiHalfH);
            }

            // クライアントの軌跡状態を初期化
            if (!clientTrailState[clientId]) {
                clientTrailState[clientId] = {};
            }
            const trailState = clientTrailState[clientId];

            // AOIフィルタリング＆差分軌跡生成（四角形判定）
            const visiblePlayers = [];
            activePlayers.forEach(p => {
                const isMe = myPlayer && p.id === myPlayer.id;
                
                // 四角形AOI判定
                const inView = isMe || (
                    p.x >= myX - aoiHalfW && p.x <= myX + aoiHalfW &&
                    p.y >= myY - aoiHalfH && p.y <= myY + aoiHalfH
                );
                
                if (!inView) {
                    // 視界外 → 送信しない＆状態リセット
                    if (trailState[p.id]) {
                        delete trailState[p.id];
                    }
                    return;
                }

                const invulSec = (p.invulnerableUntil && now < p.invulnerableUntil) 
                    ? Math.ceil((p.invulnerableUntil - now) / 1000) : 0;
                let st = p.state === 'dead' ? 0 : p.state === 'waiting' ? 2 : invulSec > 0 ? 2 + invulSec : 1;

                const data = { i: p.id, x: Math.round(p.x), y: Math.round(p.y) };
                if (st !== 1) data.st = st;
                
                // ブースト状態（自分のプレイヤーのみ詳細情報を送信）
                if (isMe) {
                    // ブースト中: 残り時間（100msあたり1）
                    if (p.boostUntil && now < p.boostUntil) {
                        data.bs = Math.ceil((p.boostUntil - now) / 100);
                    }
                    // クールダウン中: 残り時間（秒）
                    if (p.boostCooldownUntil && now < p.boostCooldownUntil) {
                        data.bc = Math.ceil((p.boostCooldownUntil - now) / 1000);
                    }
                } else {
                    // 他プレイヤー: ブースト中かどうかだけ（エフェクト表示用）
                    if (p.boosting) data.bs = 1;
                }

                // 軌跡の差分送信処理
                if (p.gridTrail && p.gridTrail.length > 0) {
                    const currentLength = p.gridTrail.length;
                    const playerTrailState = trailState[p.id];
                    
                    // 新規、5秒経過、軌跡がリセットされた、または前回が空だった場合は全軌跡を送信
                    const lastLength = playerTrailState ? (playerTrailState.lastSentLength || 0) : 0;
                    const trailWasReset = currentLength < lastLength;  // 陣地化で軌跡がクリアされた
                    const needFullSync = !playerTrailState || 
                        (now - (playerTrailState.lastFullTime || 0) > 5000) ||
                        trailWasReset ||
                        lastLength === 0;  // 前回が空だった場合（陣地化後の新しい軌跡）
                    
                    if (needFullSync) {
                        // 全軌跡送信
                        const bufSize = 4 + Math.max(0, currentLength - 1) * 2;
                        const trailBinary = Buffer.allocUnsafe(bufSize);
                        try {
                            trailBinary.writeUInt16LE(p.gridTrail[0].x, 0);
                            trailBinary.writeUInt16LE(p.gridTrail[0].y, 2);
                            let prevX = p.gridTrail[0].x, prevY = p.gridTrail[0].y;
                            for (let i = 1; i < currentLength; i++) {
                                const pt = p.gridTrail[i];
                                let dx = Math.max(-128, Math.min(127, pt.x - prevX));
                                let dy = Math.max(-128, Math.min(127, pt.y - prevY));
                                trailBinary.writeInt8(dx, 4 + (i - 1) * 2);
                                trailBinary.writeInt8(dy, 4 + (i - 1) * 2 + 1);
                                prevX = pt.x; prevY = pt.y;
                            }
                            data.rb = trailBinary;
                            data.ft = 1;  // フル軌跡フラグ
                        } catch (e) { /* ignore */ }
                        
                        trailState[p.id] = { 
                            lastSentLength: currentLength, 
                            lastFullTime: now 
                        };
                    } else {
                        // 差分送信（lastLengthは上で既に計算済み）
                        const newPointsCount = currentLength - lastLength;
                        
                        if (newPointsCount > 0 && lastLength > 0) {
                            // 差分のみエンコード
                            const bufSize = newPointsCount * 2;
                            const trailBinary = Buffer.allocUnsafe(bufSize);
                            try {
                                let prevX = p.gridTrail[lastLength - 1].x;
                                let prevY = p.gridTrail[lastLength - 1].y;
                                for (let i = 0; i < newPointsCount; i++) {
                                    const pt = p.gridTrail[lastLength + i];
                                    let dx = Math.max(-128, Math.min(127, pt.x - prevX));
                                    let dy = Math.max(-128, Math.min(127, pt.y - prevY));
                                    trailBinary.writeInt8(dx, i * 2);
                                    trailBinary.writeInt8(dy, i * 2 + 1);
                                    prevX = pt.x; prevY = pt.y;
                                }
                                data.rb = trailBinary;
                                // ft フラグなし = 差分
                            } catch (e) { /* ignore */ }
                        }
                        // 新規ポイントがない場合は rb を含めない
                        
                        trailState[p.id].lastSentLength = currentLength;
                    }
                } else {
                    // 軌跡がない場合
                    const playerTrailState = trailState[p.id];
                    if (playerTrailState && playerTrailState.lastSentLength > 0) {
                        // 以前は軌跡があったのに今はない → クリアされた
                        data.tc = 1;  // trail cleared フラグ
                        trailState[p.id].lastSentLength = 0;
                    }
                }

                visiblePlayers.push(data);
            });

            const msg = { ...baseStateMsg, p: visiblePlayers };
            if (minimapData) msg.mm = minimapData;
            if (scoreboardData) msg.sb = scoreboardData;

            // フル同期チェック
            const lastVersion = state.lastFullSyncVersion[c.playerId] || 0;
            if (state.territoryVersion - lastVersion > 1000 || lastVersion === 0) {
                if (state.territoryArchiveVersion !== state.territoryVersion) {
                    try {
                        const simplified = state.territoryRects.map(t => ({ o: t.o, c: t.c, x: t.x, y: t.y, w: t.w, h: t.h }));
                        state.cachedTerritoryArchive = zlib.gzipSync(JSON.stringify(simplified)).toString('base64');
                        state.territoryArchiveVersion = state.territoryVersion;
                    } catch (e) { state.cachedTerritoryArchive = null; }
                }
                if (state.cachedTerritoryArchive) msg.tfb = state.cachedTerritoryArchive;
                else msg.tf = state.territoryRects;
                msg.tv = state.territoryVersion;
                state.lastFullSyncVersion[c.playerId] = state.territoryVersion;
                bandwidthStats.periodFullSyncs++;
            } else {
                bandwidthStats.periodDeltaSyncs++;
            }

            const payload = msgpack.encode(msg);
            c.send(payload);
            bandwidthStats.totalBytesSent += payload.length;
            bandwidthStats.periodBytesSent += payload.length;
            bandwidthStats.msgsSent++;
            bandwidthStats.periodMsgsSent++;
            
            // 機能別サイズ計測（サンプリング: 20回に1回 または 大きなデータを含む場合）
            const hasLargeData = msg.mm || msg.tf || msg.tfb;
            if (frameCount % 20 === 0 || hasLargeData) {
                try {
                    // 各フィールドの推定サイズ（個別エンコード）
                    bandwidthStats.breakdown.base += msgpack.encode({ type: msg.type, tm: msg.tm, pc: msg.pc }).length;
                    if (msg.te) bandwidthStats.breakdown.teams += msgpack.encode({ te: msg.te }).length;
                    if (msg.p) bandwidthStats.breakdown.players += msgpack.encode({ p: msg.p }).length;
                    if (msg.mm) bandwidthStats.breakdown.minimap += msgpack.encode({ mm: msg.mm }).length;
                    if (msg.tf) bandwidthStats.breakdown.territoryFull += msgpack.encode({ tf: msg.tf }).length;
                    if (msg.tfb) bandwidthStats.breakdown.territoryFull += msgpack.encode({ tfb: msg.tfb }).length;
                    if (msg.td) bandwidthStats.breakdown.territoryDelta += msgpack.encode({ td: msg.td }).length;
                    if (msg.tb) bandwidthStats.breakdown.territoryDelta += msg.tb.length + 5; // Buffer + Key overhead
                } catch (e) { /* ignore */ }
            }
        });
    }, 150);
}

/**
 * テリトリーバイナリ生成
 */
function buildTerritoryBinary() {
    const addedMap = new Map(), removedMap = new Map();
    state.pendingTerritoryUpdates.forEach(update => {
        if (update.a) update.a.forEach(a => addedMap.set(`${a.x},${a.y}`, a));
        if (update.r) update.r.forEach(r => removedMap.set(`${r.x},${r.y}`, r));
    });

    const currentKeys = new Set();
    state.territoryRects.forEach(t => currentKeys.add(`${t.x},${t.y}`));
    addedMap.forEach((v, k) => { if (!currentKeys.has(k)) addedMap.delete(k); });
    removedMap.forEach((v, k) => { if (currentKeys.has(k)) removedMap.delete(k); });

    const mergedAdded = Array.from(addedMap.values());
    const mergedRemoved = Array.from(removedMap.values());
    if (mergedAdded.length === 0 && mergedRemoved.length === 0) return null;

    const hexToRgb = hex => {
        if (!hex || hex.length !== 7) return [128, 128, 128];
        return [parseInt(hex.substring(1, 3), 16), parseInt(hex.substring(3, 5), 16), parseInt(hex.substring(5, 7), 16)];
    };

    const bufSize = 2 + mergedAdded.length * 13 + 2 + mergedRemoved.length * 4;
    const tb = Buffer.allocUnsafe(bufSize);
    let offset = 0;

    tb.writeUInt16LE(mergedAdded.length, offset); offset += 2;
    mergedAdded.forEach(a => {
        tb.writeUInt16LE(a.x, offset); offset += 2;
        tb.writeUInt16LE(a.y, offset); offset += 2;
        tb.writeUInt16LE(a.w || 0, offset); offset += 2;
        tb.writeUInt16LE(a.h || 0, offset); offset += 2;
        const p = state.players[a.o];
        tb.writeUInt16LE(p ? p.id : 0, offset); offset += 2;
        const [r, g, b] = hexToRgb(p ? p.color : a.c);
        tb.writeUInt8(r, offset++);
        tb.writeUInt8(g, offset++);
        tb.writeUInt8(b, offset++);
    });

    tb.writeUInt16LE(mergedRemoved.length, offset); offset += 2;
    mergedRemoved.forEach(r => {
        tb.writeUInt16LE(r.x, offset); offset += 2;
        tb.writeUInt16LE(r.y, offset); offset += 2;
    });

    return tb;
}

module.exports = { setDependencies, setupConnectionHandler, startBroadcastLoop };

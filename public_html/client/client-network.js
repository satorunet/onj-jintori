// ============================================
// client-network.js - WebSocket通信
// ============================================

function connect() {
    socket = new WebSocket(SERVER_URL);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
        console.log('Connected');
        // 接続時にviewportサイズを送信
        sendViewportSize();
    };
    socket.onmessage = (e) => {
        let data;
        if (e.data instanceof ArrayBuffer) {
            try {
                data = msgpack.decode(new Uint8Array(e.data));
            } catch (err) {
                console.error('MsgPack Decode Error:', err);
                return;
            }
        } else {
            data = JSON.parse(e.data);
        }
        if (data.type === 'init') {
            myId = data.id;
            world = data.world;
            obstacles = data.obstacles || [];
            const initTerritories = data.tf || data.territories || [];
            territories = initTerritories.map(normalizeTerritory);
            rebuildTerritoryMap();
            territoryVersion = data.tv || 0;
            if (data.teams) allTeamsData = data.teams;

            if (data.pc !== undefined) {
                currentPlayerCount = data.pc;
                const lp = document.getElementById('login-pcount');
                if (lp) lp.textContent = `(${currentPlayerCount}人プレイ中)`;
            }

            updateModeDisplay(data.mode);
            updateTeamSelect();
        } else if (data.type === 'bot_auth_required') {
            // Bot認証が必要
            console.log('[Bot Auth] Authentication required');
            showBotAuthDialog(data.captchaImage, data.message);
        } else if (data.type === 'bot_auth_success') {
            // 認証成功 - サーバー側で自動joinされるのでゲーム開始状態にする
            console.log('[Bot Auth] Authentication successful');
            hideBotAuthDialog();
            document.getElementById('login-modal').style.display = 'none';
            isGameReady = true;
        } else if (data.type === 'bot_auth_failed') {
            // 認証失敗 - 新しいチャレンジ画像を表示
            console.log('[Bot Auth] Authentication failed:', data.message);
            showBotAuthError(data.message);
            updateBotAuthCaptcha(data.captchaImage);
        } else if (data.type === 'pm') {
            // プレイヤーマスター情報（フルID廃止済み、idは数値のshortId）
            if (data.players) {
                data.players.forEach(p => {
                    const pid = p.i || p.id;
                    playerProfiles[pid] = {
                        name: p.n || p.name,
                        color: p.c || p.color,
                        emoji: p.e || p.emoji,
                        team: p.t || p.team
                    };

                    // colorCacheにも登録
                    colorCache[pid] = p.c || p.color;

                    const existing = players.find(ep => ep.id === pid);
                    if (existing) {
                        Object.assign(existing, playerProfiles[pid]);
                    }
                });
                updateLoginIcons();
            }
        } else if (data.type === 's' || data.type === 'state') {
            // ラウンド開始判定（残り時間が200秒以上ならラウンド開始）
            if (data.tm !== undefined && data.tm >= 200) {
                isScoreScreenPeriod = false;
                // スコア画面期間が終わったのでpending結果もクリア
                if (pendingResultScreen) {
                    pendingResultScreen = null;
                }
            }
            
            const playersData = data.p || data.players || [];
            const minimapData = data.mm;
            const scoreboardData = data.sb;

            if (scoreboardData) {
                // スコアボード受信時は全データを更新（古い/切断されたプレイヤーを削除）
                // ただし、自分自身のスコアが消えると困る場合があるので注意が必要だが、
                // scorebaordDataには自分も含まれているはず。
                playerScores = {}; 

                // スコアボード（フルID廃止済み、idは数値のshortId）
                scoreboardData.forEach(s => {
                    const pid = s.i || s.id;
                    playerScores[pid] = {
                        score: s.s !== undefined ? s.s : s.score,
                        kills: s.k !== undefined ? s.k : s.kills,
                        name: s.n,
                        team: s.t,
                        color: s.c,
                        emoji: s.e
                    };
                    
                    // プロファイル情報も更新しておく（念のため）
                    if (s.n) {
                        playerProfiles[pid] = {
                            name: s.n,
                            team: s.t,
                            color: s.c,
                            emoji: s.e
                        };
                        colorCache[pid] = s.c;
                    }
                });
            }

            if (data.pc !== undefined) {
                currentPlayerCount = data.pc;
                
                // 10人以上で強制軽量モードをON
                const shouldForce = currentPlayerCount >= FORCE_LOW_PERF_PLAYER_COUNT;
                if (shouldForce !== forceLowPerformance) {
                    forceLowPerformance = shouldForce;
                    if (shouldForce) {
                        isLowPerformance = true;
                        console.log(`[Performance] Forced LOW mode (${currentPlayerCount} players)`);
                    } else {
                        // 人数が減ったらユーザー設定に戻す
                        isLowPerformance = (performanceMode === 'low');
                        console.log(`[Performance] Force mode OFF (${currentPlayerCount} players)`);
                    }
                }
            }

            const lp = document.getElementById('login-pcount');
            if (lp) lp.textContent = `(${currentPlayerCount}人プレイ中)`;

            updateLoginIcons();

            const teamsData = data.te || data.teams;
            if (teamsData) {
                allTeamsData = teamsData;
                if (!isGameReady) updateTeamSelect();
            }

            const detailsIds = new Set();
            playersData.forEach(serverP => {
                // idは数値のshortId（フルID廃止済み）
                const sId = serverP.i || serverP.id;
                detailsIds.add(sId);

                const profile = playerProfiles[sId] || {};
                const scoreData = playerScores[sId] || { score: 0 };

                let state = 'active';
                let invulnerableCount = 0;

                if (serverP.st !== undefined) {
                    if (serverP.st === 0) state = 'dead';
                    else if (serverP.st === 2) state = 'waiting';
                    else if (serverP.st >= 3) {
                        state = 'active';
                        invulnerableCount = serverP.st - 2;
                    }
                } else if (serverP.state) {
                    state = serverP.state;
                }

                const normalized = {
                    id: sId,
                    x: serverP.x,
                    y: serverP.y,
                    color: profile.color || serverP.c || serverP.color,
                    name: profile.name || serverP.n || serverP.name,
                    emoji: profile.emoji || serverP.e || serverP.emoji,
                    team: profile.team || serverP.t || serverP.team,
                };

                // 軌跡のデコード（差分送信対応）
                let decodedTrail = [];
                const isFullTrail = serverP.ft === 1;  // ft フラグで判定
                
                if (serverP.rb) {
                    const buf = serverP.rb;
                    
                    if (isFullTrail) {
                        // 全軌跡: 先頭4バイトが始点座標
                        if (buf.length >= 4) {
                            const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
                            let cx = view.getUint16(0, true);
                            let cy = view.getUint16(2, true);
                            decodedTrail.push({ x: cx * 10 + 5, y: cy * 10 + 5 });

                            const len = Math.floor((buf.byteLength - 4) / 2);
                            for (let i = 0; i < len; i++) {
                                const dx = view.getInt8(4 + i * 2);
                                const dy = view.getInt8(4 + i * 2 + 1);
                                cx += dx;
                                cy += dy;
                                decodedTrail.push({ x: cx * 10 + 5, y: cy * 10 + 5 });
                            }
                        }
                    } else {
                        // 差分: 既存の軌跡の最後から続ける
                        const existing = players.find(p => p.id === normalized.id);
                        if (existing && existing.trail && existing.trail.length > 0) {
                            // 既存の軌跡をコピー
                            decodedTrail = [...existing.trail];
                            
                            // 最後の座標をグリッド座標に変換
                            const lastPoint = existing.trail[existing.trail.length - 1];
                            let cx = Math.floor((lastPoint.x - 5) / 10);
                            let cy = Math.floor((lastPoint.y - 5) / 10);
                            
                            // 差分をデコードして追加
                            const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
                            const len = Math.floor(buf.byteLength / 2);
                            for (let i = 0; i < len; i++) {
                                const dx = view.getInt8(i * 2);
                                const dy = view.getInt8(i * 2 + 1);
                                cx += dx;
                                cy += dy;
                                decodedTrail.push({ x: cx * 10 + 5, y: cy * 10 + 5 });
                            }
                        }
                        // 既存の軌跡がない場合は空のまま（次のフル同期を待つ）
                    }
                } else if (serverP.tc === 1) {
                    // 軌跡がクリアされた（陣地化後）
                    decodedTrail = [];
                } else {
                    // rb がない場合は既存の軌跡を維持（変化がないだけ）
                    const existing = players.find(p => p.id === normalized.id);
                    if (existing && existing.trail) {
                        decodedTrail = existing.trail;  // 既存の軌跡をそのまま使う
                    } else {
                        // 旧形式対応
                        decodedTrail = (serverP.r || serverP.trail || []).map(pt => Array.isArray(pt) ? { x: pt[0], y: pt[1] } : pt);
                    }
                }
                normalized.trail = decodedTrail;

                Object.assign(normalized, {
                    score: serverP.s !== undefined ? serverP.s : (scoreData.score || 0),
                    state: state,
                    invulnerableCount: serverP.iv !== undefined ? serverP.iv : invulnerableCount,
                    boosting: serverP.bs ? true : false  // ブースト中フラグ
                });

                // 自分のブースト情報を更新
                if (sId === myId) {
                    if (serverP.bs) {
                        boostRemainingMs = serverP.bs * 100;  // 100msあたり1
                    } else {
                        boostRemainingMs = 0;
                    }
                    if (serverP.bc) {
                        boostCooldownSec = serverP.bc;
                    } else {
                        boostCooldownSec = 0;
                    }
                }

                let existing = players.find(p => p.id === normalized.id);
                if (existing) {
                    const distSq = (existing.x - normalized.x) ** 2 + (existing.y - normalized.y) ** 2;
                    if (distSq > 200 * 200) {
                        existing.x = normalized.x;
                        existing.y = normalized.y;
                    }
                    existing.targetX = normalized.x;
                    existing.targetY = normalized.y;

                    if (normalized.score !== undefined) existing.score = normalized.score;
                    if (normalized.name) existing.name = normalized.name;
                    if (normalized.team) existing.team = normalized.team;
                    if (normalized.color) existing.color = normalized.color;
                    if (normalized.emoji) existing.emoji = normalized.emoji;

                    existing.invulnerableCount = normalized.invulnerableCount;
                    if (normalized.state === 'dead' && existing.state !== 'dead') {
                        existing.deathTime = Date.now();
                    }
                    
                    // 自分のstate変更を検出
                    const isMe = existing.id === myId;
                    const wasWaiting = existing.state === 'waiting';
                    const nowActive = normalized.state !== 'waiting';
                    
                    existing.state = normalized.state;
                    
                    // waiting→activeに変わった時、スコア画面期間中なら保存していたround_endを表示
                    if (isMe && wasWaiting && nowActive && pendingResultScreen) {
                        if (isScoreScreenPeriod) {
                            // スコア画面期間中なので表示
                            showResultScreen(
                                pendingResultScreen.rankings,
                                pendingResultScreen.winner,
                                pendingResultScreen.teamRankings,
                                pendingResultScreen.nextMode,
                                pendingResultScreen.allTeams,
                                pendingResultScreen.totalPlayers,
                                null,
                                pendingResultScreen.mapFlags,
                                pendingResultScreen.secondsUntilNext,
                                pendingResultScreen.minimapHistory
                            );
                        }
                        // ゲーム中もスコア画面期間中も、pending結果はクリア
                        pendingResultScreen = null;
                    }
                    
                    existing.trail = normalized.trail;
                    existing.boosting = normalized.boosting;  // ブースト状態をコピー
                    existing.hasDetail = true;
                } else {
                    normalized.targetX = normalized.x;
                    normalized.targetY = normalized.y;
                    normalized.hasDetail = true;
                    players.push(normalized);
                }
            });
            
            // sメッセージに含まれていないプレイヤーを削除
            // （waiting状態のプレイヤーなど）
            players = players.filter(p => {
                // 自分は常に保持
                if (p.id === myId) return true;
                // sメッセージに含まれていたプレイヤーは保持
                if (detailsIds.has(p.id)) return true;
                // それ以外は削除
                console.log('[CLIENT] Removing player not in state:', p.name || p.id);
                return false;
            });

            if (minimapData) {
                if (minimapData.tb) {
                    try {
                        const tb = minimapData.tb;
                        const base64 = tb.bm;
                        const palette = tb.cp;
                        const size = tb.sz || 60;

                        let compressed;
                        if (typeof base64 === 'string') {
                            const binaryStr = atob(base64);
                            compressed = new Uint8Array(binaryStr.length);
                            for (let i = 0; i < binaryStr.length; i++) {
                                compressed[i] = binaryStr.charCodeAt(i);
                            }
                        } else {
                            compressed = base64;
                        }
                        const bitmap = pako.inflate(compressed);

                        minimapBitmapData = {
                            bitmap: bitmap,
                            palette: palette,
                            size: size,
                            flags: tb.flags || []  // サーバーから受信した国旗位置
                        };
                    } catch (e) {
                        console.error('Minimap bitmap decode error:', e);
                    }
                }

                const playerList = minimapData.pl || [];
                
                // 配列形式 [x, y, colorIndex] をそのまま保存
                minimapPlayerPositions = playerList;
                
                // プレイヤー同期処理は不要（sメッセージで既に同期されている）
            }

            if (data.tb) {
                try {
                    const buf = data.tb;
                    if (buf.byteLength >= 4) {
                        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
                        let offset = 0;

                        const addCount = view.getUint16(offset, true); offset += 2;
                        const adds = [];
                        for (let i = 0; i < addCount; i++) {
                            const x = view.getUint16(offset, true); offset += 2;
                            const y = view.getUint16(offset, true); offset += 2;
                            const w = view.getUint16(offset, true); offset += 2;
                            const h = view.getUint16(offset, true); offset += 2;
                            const sid = view.getUint16(offset, true); offset += 2;

                            const r = view.getUint8(offset); offset += 1;
                            const g = view.getUint8(offset); offset += 1;
                            const b = view.getUint8(offset); offset += 1;

                            const toHex = (c) => c.toString(16).padStart(2, '0');
                            const color = `#${toHex(r)}${toHex(g)}${toHex(b)}`;

                            // sidがそのままプレイヤーID（id統一済み）
                            const ownerId = sid;

                            adds.push({ x, y, w, h, color, ownerId });
                        }

                        const remCount = view.getUint16(offset, true); offset += 2;
                        const rems = [];
                        for (let i = 0; i < remCount; i++) {
                            const x = view.getUint16(offset, true); offset += 2;
                            const y = view.getUint16(offset, true); offset += 2;
                            rems.push({ x, y });
                        }

                        applyTerritoryDelta({ a: adds, r: rems });
                        if (data.tv) territoryVersion = data.tv;
                    }
                } catch (e) {
                    console.error('Territory Binary Decode Error:', e);
                }
            } else if (data.tfb) {
                try {
                    const binaryStr = atob(data.tfb);
                    const compressed = new Uint8Array(binaryStr.length);
                    for (let i = 0; i < binaryStr.length; i++) {
                        compressed[i] = binaryStr.charCodeAt(i);
                    }
                    const decompressed = pako.inflate(compressed, { to: 'string' });
                    const raw = JSON.parse(decompressed);
                    territories = raw.map(normalizeTerritory);
                    rebuildTerritoryMap();
                    territoryVersion = data.tv || territoryVersion;
                } catch (e) {
                    console.error("Territory Decompression Error:", e);
                }
            } else if (data.tf) {
                territories = data.tf.map(normalizeTerritory);
                rebuildTerritoryMap();
                territoryVersion = data.tv || territoryVersion;
            } else if (data.td && data.tv > territoryVersion) {
                applyTerritoryDelta(data.td);
                territoryVersion = data.tv;
            }
            if (data.territories) {
                territories = data.territories.map(normalizeTerritory);
                rebuildTerritoryMap();
            }

            const timeData = data.tm !== undefined ? data.tm : data.time;
            updateUI(timeData);
            updateLeaderboard();
            if (!isGameReady) updateTeamSelect();
        } else if (data.type === 'player_death') {
            if (data.id === myId) showDeathScreen(data.reason);

            const p = players.find(obj => obj.id === data.id);
            if (p) {
                if (p.trail && p.trail.length > 0) {
                    spawnLineDestroyParticles(p.trail, p.color, p.x, p.y);
                }
                p.state = 'dead';
                p.deathTime = Date.now();
                p.trail = [];
            }
            
            // 名前取得: players → playerProfiles → data.name の順で探す
            let pName = 'Unknown';
            if (p && p.name) {
                pName = p.name;
            } else if (playerProfiles[data.id] && playerProfiles[data.id].name) {
                pName = playerProfiles[data.id].name;
            } else if (data.name) {
                // サーバーから名前が送られてきた場合（後で実装可能）
                pName = data.name;
            }
            
            let msg = "";
            if (data.reason.startsWith("キル: ")) {
                const killerName = data.reason.replace("キル: ", "");
                msg = `${killerName} が ${pName} を倒した！`;
            } else if (data.reason === "自爆") {
                msg = `${pName} が自爆した！`;
            } else if (data.reason === "壁") {
                msg = `${pName} が壁に衝突！`;
            } else {
                msg = `${pName} が ${data.reason}`;
            }
            addKillFeed(msg);
        } else if (data.type === 'round_start') {
            if (data.world) world = data.world;
            hasSentChat = false;
            hideDeathScreen();
            document.getElementById('result-modal').style.display = 'none';
            obstacles = data.obstacles || [];

            playerScores = {};

            const lbList = document.getElementById('lb-list');
            if (lbList) lbList.innerHTML = '';
            const lbTeamList = document.getElementById('lb-team-list');
            if (lbTeamList) lbTeamList.innerHTML = '';
            const teamContainer = document.getElementById('team-lb-container');
            if (teamContainer) teamContainer.style.display = 'none';

            const scoreEl = document.getElementById('scoreVal');
            if (scoreEl) scoreEl.innerHTML = '0.00%';

            const killFeed = document.getElementById('kill-feed');
            if (killFeed) killFeed.innerHTML = '';

            minimapBitmapData = null;
            minimapPlayerPositions = [];

            players.forEach(p => {
                p.score = 0;
                p.kills = 0;
                p.trail = [];
                p.gridTrail = [];
                p.state = 'active';
                p.deathTime = null;
            });

            particles = [];
            fadeOutLines = [];

            if (data.tf && data.tf.length > 0) {
                territories = data.tf.map(normalizeTerritory);
                rebuildTerritoryMap();
                territoryVersion = data.tv || 0;
            } else {
                territories = [];
                territoryMap.clear();
                territoryVersion = 0;
            }

            updateModeDisplay(data.mode);
        } else if (data.type === 'round_end') {
            minimapBitmapData = null;
            minimapPlayerPositions = [];
            
            // スコア画面期間に入った
            isScoreScreenPeriod = true;
            
            // プレイヤーがゲームに参加していた場合のみスコア画面を表示
            const me = players.find(p => p.id === myId);
            const hasPlayedThisRound = me && me.state !== 'waiting';
            
            if (hasPlayedThisRound) {
                // すぐに表示（minimapHistoryも渡す）
                showResultScreen(data.rankings, data.winner, data.teamRankings, data.nextMode, data.allTeams, data.totalPlayers, null, data.mapFlags, data.secondsUntilNext, data.minimapHistory);
                pendingResultScreen = null;  // 念のためクリア
            } else {
                // wait状態の場合は保存（参加後に表示）
                pendingResultScreen = {
                    rankings: data.rankings,
                    winner: data.winner,
                    teamRankings: data.teamRankings,
                    nextMode: data.nextMode,
                    allTeams: data.allTeams,
                    totalPlayers: data.totalPlayers,
                    mapFlags: data.mapFlags,
                    secondsUntilNext: data.secondsUntilNext,
                    minimapHistory: data.minimapHistory
                };
            }
        } else if (data.type === 'chat') {
            spawnNicoComment(data.text, data.color, data.name);
        }
    };
    socket.onclose = (e) => {
        if (e.code === 4000) {
            // AFK切断時は独自のモーダルを表示
            showAfkDisconnectNotice();
        } else if (e.code === 4010) {
            // 画面サイズ超過でキック
            alert('画面サイズが大きすぎます。\nスマートフォン、またはブラウザのウィンドウを小さくしてアクセスしてください。');
        }
        document.getElementById('login-modal').style.display = 'flex';
        document.getElementById('deathScreen').style.display = 'none';
        document.getElementById('result-modal').style.display = 'none';
        isGameReady = false;

        setTimeout(connect, 3000);
    };
}

// ============================================
// Viewport送信（AOI最適化用）
// ============================================
let lastSentViewport = { w: 0, h: 0 };

function sendViewportSize() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    // 実際の画面サイズを送信（サーバー側で制限判定）
    const container = document.getElementById('game-container');
    const w = Math.round(container ? container.clientWidth : window.innerWidth);
    const h = Math.round(container ? container.clientHeight : window.innerHeight);

    // 変化がある場合のみ送信（100px以上の変化）
    if (Math.abs(w - lastSentViewport.w) > 100 || Math.abs(h - lastSentViewport.h) > 100) {
        socket.send(JSON.stringify({ type: 'viewport', w: w, h: h }));
        lastSentViewport = { w, h };
        console.log(`[Viewport] Sent: ${w}x${h}`);
    }
}

// リサイズ時にviewportを再送信（デバウンス）
let viewportResizeTimer = null;
window.addEventListener('resize', () => {
    if (viewportResizeTimer) clearTimeout(viewportResizeTimer);
    viewportResizeTimer = setTimeout(sendViewportSize, 500);
});

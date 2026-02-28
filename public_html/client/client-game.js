// ============================================
// client-game.js - ゲームロジック・描画・入力
// ============================================

// チーム連結モード: 近くのチームメイトID
let chainNearbyIds = [];

// 衝撃波エフェクト
let shockwaves = [];

function spawnShockwave(x, y) {
    shockwaves.push({ x, y, radius: 10, maxRadius: 120, life: 1.0, speed: 400 });
    // パーティクルも散らす
    if (!isLowPerformance) {
        for (let i = 0; i < 20; i++) {
            if (particles.length >= MAX_PARTICLES) break;
            const angle = Math.random() * Math.PI * 2;
            const speed = 150 + Math.random() * 250;
            particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color: `hsl(${(Math.random() * 60 + 10) | 0},100%,60%)`,
                size: 3 + Math.random() * 5,
                life: 1.0,
                decay: 0.025 + Math.random() * 0.02,
                gravity: 0,
                sparkle: true
            });
        }
    }
}

function updateShockwaves(dt) {
    for (let i = shockwaves.length - 1; i >= 0; i--) {
        const sw = shockwaves[i];
        sw.radius += sw.speed * dt;
        sw.life = 1 - (sw.radius / sw.maxRadius);
        if (sw.life <= 0) shockwaves.splice(i, 1);
    }
}

function drawShockwaves(ctx) {
    for (const sw of shockwaves) {
        ctx.save();
        ctx.globalAlpha = sw.life * 0.7;
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, ${(180 * sw.life) | 0}, 0, ${sw.life})`;
        ctx.lineWidth = 4 + sw.life * 6;
        if (!isLowPerformance) {
            ctx.shadowColor = '#ff6600';
            ctx.shadowBlur = 20;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        // 内側の白いリング
        if (sw.life > 0.3) {
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, sw.radius * 0.7, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 255, 255, ${sw.life * 0.4})`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        ctx.restore();
    }
}

function spawnLineDestroyParticles(trail, color, playerX, playerY) {
    // 軽量モードではパーティクルを生成しない
    if (isLowPerformance) return;
    if (!trail || trail.length === 0) return;

    const particlesPerPoint = Math.min(5, Math.ceil(50 / trail.length));

    trail.forEach((pt, idx) => {
        for (let i = 0; i < particlesPerPoint; i++) {
            if (particles.length >= MAX_PARTICLES) return;

            const angle = Math.random() * Math.PI * 2;
            const speed = 50 + Math.random() * 150;

            particles.push({
                x: pt.x,
                y: pt.y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color: color,
                size: 3 + Math.random() * 5,
                life: 1.0,
                decay: 0.02 + Math.random() * 0.02,
                gravity: 50 + Math.random() * 50,
                sparkle: Math.random() > 0.7
            });
        }
    });

    for (let i = 0; i < 15; i++) {
        if (particles.length >= MAX_PARTICLES) break;
        const angle = Math.random() * Math.PI * 2;
        const speed = 100 + Math.random() * 200;

        particles.push({
            x: playerX,
            y: playerY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color: color,
            size: 5 + Math.random() * 8,
            life: 1.0,
            decay: 0.015 + Math.random() * 0.015,
            gravity: 30,
            sparkle: true
        });
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += p.gravity * dt;
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.life -= p.decay;

        if (p.life <= 0) {
            particles.splice(i, 1);
        }
    }
}

function drawParticles(ctx) {
    // 軽量モードではパーティクルを描画しない
    if (isLowPerformance) return;
    
    ctx.save();
    for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        ctx.globalAlpha = p.life;

        if (p.sparkle && Math.random() > 0.5) {
            ctx.fillStyle = '#fff';
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 10;
        } else {
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 5;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

// Input Handling
function initInput() {
    const joyBase = document.getElementById('virtual-joystick-base');
    const joyStick = document.getElementById('virtual-joystick-stick');

    const handleStart = (x, y) => {
        if (!isGameReady) return;
        touchStartPos = { x, y };
        inputState.drawing = true;

        joyBase.style.display = 'block';
        joyBase.style.left = (x - 60) + 'px';
        joyBase.style.top = (y - 60) + 'px';
        joyStick.style.transform = `translate(-50%, -50%)`;

        sendInput();
    };

    const handleMove = (x, y) => {
        if (!touchStartPos) return;

        const deltaX = x - touchStartPos.x;
        const deltaY = y - touchStartPos.y;

        const dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const maxDist = 35;
        const visualX = dist > maxDist ? (deltaX / dist) * maxDist : deltaX;
        const visualY = dist > maxDist ? (deltaY / dist) * maxDist : deltaY;

        joyStick.style.transform = `translate(calc(-50% + ${visualX}px), calc(-50% + ${visualY}px))`;

        if (dist > 10) {
            inputState.dx = deltaX;
            inputState.dy = deltaY;
        }
        sendInput();
    };

    const handleEnd = () => {
        touchStartPos = null;
        inputState.drawing = false;
        joyBase.style.display = 'none';
        sendInput();
    };

    // 連結候補タップ判定（スクリーン座標→ワールド座標）
    function checkChainTap(screenX, screenY) {
        if (chainNearbyIds.length === 0) return false;
        const worldX = screenX / ZOOM_LEVEL + camera.x;
        const worldY = screenY / ZOOM_LEVEL + camera.y;
        for (const tid of chainNearbyIds) {
            const t = players.find(p => p.id === tid);
            if (!t || t.state !== 'active') continue;
            const d = Math.hypot(worldX - t.x, worldY - t.y);
            if (d < 40) {
                // 連結リクエスト送信
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'chain_attach', targetId: tid }));
                }
                chainNearbyIds = [];
                return true;
            }
        }
        return false;
    }

    canvas.addEventListener('touchstart', e => {
        e.preventDefault();
        const touchX = e.touches[0].clientX;
        const touchY = e.touches[0].clientY;

        // 連結候補タップ検出
        if (isGameReady && checkChainTap(touchX, touchY)) return;

        // 連結解除ボタンのタップ検出
        if (isGameReady && isInChainDetachButtonArea(touchX, touchY)) {
            triggerChainDetach();
            return;
        }
        // ブーストボタンエリアのタップ検出
        if (isGameReady && isInBoostButtonArea(touchX, touchY)) {
            triggerBoost();
            return;  // ブーストボタンタップ時は移動入力しない
        }

        handleStart(touchX, touchY);
    }, { passive: false });

    canvas.addEventListener('touchmove', e => {
        e.preventDefault();
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    canvas.addEventListener('touchend', e => {
        e.preventDefault();
        handleEnd();
    });

    canvas.addEventListener('mousedown', e => {
        // 連結候補クリック検出（PC用）
        if (isGameReady && checkChainTap(e.clientX, e.clientY)) return;
        // 連結解除ボタンのクリック検出（PC用）
        if (isGameReady && isInChainDetachButtonArea(e.clientX, e.clientY)) {
            triggerChainDetach();
            return;
        }
        // ブーストボタンエリアのクリック検出（PC用）
        if (isGameReady && isInBoostButtonArea(e.clientX, e.clientY)) {
            triggerBoost();
            return;
        }
        handleStart(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', e => { if (touchStartPos) handleMove(e.clientX, e.clientY); });
    window.addEventListener('mouseup', handleEnd);
    
    // キーボード操作（PC用）
    const keysPressed = {};
    const updateArrowInput = () => {
        let dx = 0, dy = 0;
        if (keysPressed['ArrowLeft'])  dx -= 1;
        if (keysPressed['ArrowRight']) dx += 1;
        if (keysPressed['ArrowUp'])    dy -= 1;
        if (keysPressed['ArrowDown'])  dy += 1;
        if (dx !== 0 || dy !== 0) {
            inputState.dx = dx;
            inputState.dy = dy;
            inputState.drawing = true;
        } else {
            inputState.dx = 0;
            inputState.dy = 0;
            inputState.drawing = false;
        }
        sendInput();
    };

    window.addEventListener('keydown', e => {
        if (!isGameReady) return;
        if (e.code === 'Space' && !e.repeat) {
            e.preventDefault();
            triggerBoost();
            return;
        }
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
            e.preventDefault();
            keysPressed[e.code] = true;
            updateArrowInput();
        }
    });

    window.addEventListener('keyup', e => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
            delete keysPressed[e.code];
            updateArrowInput();
        }
    });
}

// ブーストボタンエリア判定
function isInBoostButtonArea(x, y) {
    const gaugeWidth = 140;
    const gaugeHeight = 40;
    const gaugeX = (width - gaugeWidth) / 2;
    const gaugeY = height - 65;
    
    return x >= gaugeX && x <= gaugeX + gaugeWidth && 
           y >= gaugeY && y <= gaugeY + gaugeHeight;
}

// ブースト発動（クールダウンチェック込み）
function triggerBoost() {
    if (boostCooldownSec <= 0 && boostRemainingMs <= 0) {
        boostRequested = true;
        sendInput();
    }
}

// 連結解除ボタンエリア判定（HTML要素に移行したため不要だが互換用）
function isInChainDetachButtonArea(x, y) {
    return false;
}

// 連結解除を送信
function triggerChainDetach() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'chain_detach' }));
    }
}

function sendInput() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const dx = inputState.dx;
    const dy = inputState.dy;
    const now = Date.now();

    let angleByte;

    const magnitude = Math.sqrt(dx * dx + dy * dy);
    if (magnitude < 0.1) {
        angleByte = ANGLE_STOP;
    } else {
        const angle = Math.atan2(dy, dx);
        const normalized = (angle + Math.PI) / (2 * Math.PI);
        angleByte = Math.round(normalized * 254) % 255;
    }

    let angleChanged = false;
    if (lastSentAngle === null) {
        angleChanged = true;
    } else if (angleByte === ANGLE_STOP || lastSentAngle === ANGLE_STOP) {
        angleChanged = (angleByte !== lastSentAngle);
    } else {
        let diff = Math.abs(angleByte - lastSentAngle);
        if (diff > 127) diff = 255 - diff;
        angleChanged = (diff >= ANGLE_THRESHOLD);
    }

    // ブーストリクエストがある場合は必ず送信
    const shouldSend = angleChanged || boostRequested || (now - lastForceSendTime > FORCE_SEND_INTERVAL);

    if (shouldSend) {
        // ブーストリクエストがある場合は2バイト送信
        if (boostRequested) {
            socket.send(new Uint8Array([angleByte, 1]));
            boostRequested = false;  // リクエストをリセット
        } else {
            socket.send(new Uint8Array([angleByte]));
        }
        lastSentAngle = angleByte;
        lastForceSendTime = now;
    }
}

// Rendering
function loop() {
    const currentTime = Date.now();
    const dt = Math.min((currentTime - lastLoopTime) / 1000, 0.1);
    lastLoopTime = currentTime;
    
    // FPS監視とパフォーマンスモード自動切り替え
    // 強制軽量モード中（10人以上）はFPS判定をスキップ
    if (forceLowPerformance) {
        isLowPerformance = true;
    } else if (performanceMode === 'auto') {
        const fps = dt > 0 ? 1 / dt : 60;
        fpsHistory.push(fps);
        if (fpsHistory.length > FPS_SAMPLE_SIZE) fpsHistory.shift();
        
        if (fpsHistory.length >= FPS_SAMPLE_SIZE) {
            const avgFps = fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length;
            // ヒステリシス: 低→高は45FPS以上、高→低は35FPS以下
            if (isLowPerformance && avgFps > 45) {
                isLowPerformance = false;
                console.log('[Performance] Switching to HIGH quality mode (FPS:', avgFps.toFixed(1), ')');
            } else if (!isLowPerformance && avgFps < FPS_THRESHOLD) {
                isLowPerformance = true;
                console.log('[Performance] Switching to LOW quality mode (FPS:', avgFps.toFixed(1), ')');
            }
        }
    } else {
        isLowPerformance = (performanceMode === 'low');
    }

    // CSSクラスで低パフォーマンスモードを反映（backdrop-filter等の無効化用）
    const gc = document.getElementById('game-container');
    if (gc) {
        if (isLowPerformance) { if (!gc.classList.contains('low-perf')) gc.classList.add('low-perf'); }
        else { gc.classList.remove('low-perf'); }
    }

    updateParticles(dt);
    updateShockwaves(dt);

    const lerpSpeed = 12;
    players.forEach(p => {
        if (p.targetX !== undefined) {
            const prevX = p.x;
            const prevY = p.y;

            const lerpFactor = Math.min(1, lerpSpeed * dt);
            p.x += (p.targetX - p.x) * lerpFactor;
            p.y += (p.targetY - p.y) * lerpFactor;

            if (p.trail && p.trail.length > 0 && p.state === 'active') {
                if (!p.pixelTrail || p.pixelTrail.length === 0) {
                    // サーバーから受け取ったtrailで初期化（始点から表示するため）
                    p.pixelTrail = p.trail ? [...p.trail] : [];
                }

                const lastPt = p.pixelTrail.length > 0 ? p.pixelTrail[p.pixelTrail.length - 1] : null;
                const minDist = 3;

                if (!lastPt || Math.hypot(p.x - lastPt.x, p.y - lastPt.y) >= minDist) {
                    p.pixelTrail.push({ x: p.x, y: p.y });

                    const maxLen = Math.max(100, p.trail.length * 3);
                    // shift()はO(n)なので、2倍を超えたら一括でslice（頻度を下げる）
                    if (p.pixelTrail.length > maxLen * 2) {
                        p.pixelTrail = p.pixelTrail.slice(-maxLen);
                    }
                }
            } else {
                p.pixelTrail = [];
            }
        }
    });
    updateCamera();

    // トップランカー判定（サーバーから受信した全プレイヤースコアを使用）
    // idは数値のshortId（フルID廃止済み）
    let topId = null;
    let maxScore = -1;
    const teamScores = {};

    Object.entries(playerScores).forEach(([pid, scoreData]) => {
        const score = scoreData.score || 0;
        if (score > maxScore) {
            maxScore = score;
            topId = Number(pid);  // 数値に変換
        }
        
        // チームスコア計算（playerScores内のチーム情報を使用）
        const team = scoreData.team; // サーバーから送られてくる
        if (team && score > 0) {
            teamScores[team] = (teamScores[team] || 0) + score;
        }
    });

    let topTeam = null;
    let maxTeamScore = -1;
    Object.entries(teamScores).forEach(([t, s]) => {
        if (s > maxTeamScore && s > 0) {
            maxTeamScore = s;
            topTeam = t;
        }
    });
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.scale(ZOOM_LEVEL, ZOOM_LEVEL);
    ctx.translate(-camera.x, -camera.y);

    const margin = 100;
    const viewLeft = camera.x - margin;
    const viewRight = camera.x + (width / ZOOM_LEVEL) + margin;
    const viewTop = camera.y - margin;
    const viewBottom = camera.y + (height / ZOOM_LEVEL) + margin;

    drawGrid();

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, world.width || 3000, world.height || 3000);

    ctx.fillStyle = COLORS.obstacle;
    obstacles.forEach(o => {
        if (o.x + o.width < viewLeft || o.x > viewRight || o.y + o.height < viewTop || o.y > viewBottom) return;
        ctx.fillRect(o.x, o.y, o.width, o.height);
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2;
        ctx.strokeRect(o.x, o.y, o.width, o.height);
    });

    // 回転歯車の描画
    const gearNow = Date.now();
    gears.forEach(g => {
        // 画面外判定
        if (g.cx + g.radius < viewLeft || g.cx - g.radius > viewRight ||
            g.cy + g.radius < viewTop || g.cy - g.radius > viewBottom) return;

        const elapsed = (gearNow - g.startTime) / 1000;
        const angle = g.angle + g.speed * elapsed;
        const isCaptured = !!g.capturedBy;
        const capColor = g.capturedColor || null;
        const capPercent = g.capturePercent || 0;
        const capName = g.captureName || '';
        const progressColor = g.captureColor || null;

        ctx.save();
        ctx.translate(g.cx, g.cy);
        ctx.rotate(angle);

        const r = g.radius;
        const teeth = g.teeth;
        const tw = g.toothWidth || 0.2;
        const safeR = r * 0.45;

        // 歯の色（占領済みなら占領色）
        const armFill = isCaptured ? capColor : '#4a5568';
        const armStroke = isCaptured ? capColor : '#718096';
        const tipFill = isCaptured ? capColor : '#5a6577';

        // 各歯をアーム状に描画
        for (let i = 0; i < teeth; i++) {
            const aStart = (i / teeth) * Math.PI * 2;
            const aEnd = aStart + (tw / teeth) * Math.PI * 2 * teeth;
            const armWidth = r * 0.12;
            const aMid = (aStart + aEnd) / 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(aMid - armWidth / r) * safeR, Math.sin(aMid - armWidth / r) * safeR);
            ctx.lineTo(Math.cos(aStart) * r * 1.05, Math.sin(aStart) * r * 1.05);
            ctx.lineTo(Math.cos(aEnd) * r * 1.05, Math.sin(aEnd) * r * 1.05);
            ctx.lineTo(Math.cos(aMid + armWidth / r) * safeR, Math.sin(aMid + armWidth / r) * safeR);
            ctx.closePath();
            ctx.globalAlpha = isCaptured ? 0.8 : 1;
            ctx.fillStyle = armFill;
            ctx.fill();
            ctx.strokeStyle = armStroke;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.globalAlpha = 1;

            // 歯の先端
            ctx.beginPath();
            const tipStart = aStart - 0.05;
            const tipEnd = aEnd + 0.05;
            ctx.arc(0, 0, r * 1.05, tipStart, tipEnd);
            ctx.arc(0, 0, r * 0.85, tipEnd, tipStart, true);
            ctx.closePath();
            ctx.globalAlpha = isCaptured ? 0.8 : 1;
            ctx.fillStyle = tipFill;
            ctx.fill();
            ctx.strokeStyle = armStroke;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // 回転を戻してから中心エリアを描画（テキストが回転しないように）
        ctx.restore();
        ctx.save();
        ctx.translate(g.cx, g.cy);

        if (isCaptured) {
            // 占領済み: 中心に薄く占領色の円 + 占領者名
            ctx.beginPath();
            ctx.arc(0, 0, safeR, 0, Math.PI * 2);
            ctx.fillStyle = capColor;
            ctx.globalAlpha = 0.15;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.setLineDash([8, 8]);
            ctx.strokeStyle = capColor;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.setLineDash([]);

            // 占領者名
            ctx.fillStyle = capColor;
            ctx.font = getGameFont(Math.max(14, safeR * 0.2), true);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.globalAlpha = 0.7;
            ctx.fillText(g.capturedBy || '', 0, 0);
            ctx.globalAlpha = 1;
        } else if (capPercent > 0 && progressColor) {
            // 占領途中: 円グラフ進捗 + パーセンテージ
            // 進捗円弧
            const progressAngle = (capPercent / 100) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, safeR * 0.9, -Math.PI / 2, -Math.PI / 2 + progressAngle);
            ctx.closePath();
            ctx.fillStyle = progressColor;
            ctx.globalAlpha = 0.25;
            ctx.fill();
            ctx.globalAlpha = 1;

            // 外枠の点線
            ctx.beginPath();
            ctx.arc(0, 0, safeR, 0, Math.PI * 2);
            ctx.setLineDash([8, 8]);
            ctx.strokeStyle = progressColor;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.setLineDash([]);

            // パーセンテージテキスト
            ctx.fillStyle = progressColor;
            ctx.font = getGameFont(Math.max(16, safeR * 0.3), true);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${capPercent}%`, 0, -safeR * 0.1);

            // 占領者名
            if (capName) {
                ctx.font = getGameFont(Math.max(11, safeR * 0.15));
                ctx.globalAlpha = 0.7;
                ctx.fillText(capName, 0, safeR * 0.2);
                ctx.globalAlpha = 1;
            }
        } else {
            // 未占領: 薄い点線の円のみ
            ctx.beginPath();
            ctx.arc(0, 0, safeR, 0, Math.PI * 2);
            ctx.setLineDash([8, 8]);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.restore();
    });

    // 領地を色ごとにグループ化して描画
    const territoryGroups = {};
    territories.forEach(t => {
        const k = t.color || '#cccccc';
        if (!territoryGroups[k]) territoryGroups[k] = [];
        territoryGroups[k].push(t);
    });

    Object.entries(territoryGroups).forEach(([color, group]) => {
        ctx.beginPath();
        let hasVisible = false;
        group.forEach(t => {
            if (t.points && t.points.length > 0) {
                if (t.x + t.w < viewLeft || t.x > viewRight || t.y + t.h < viewTop || t.y > viewBottom) return;
                hasVisible = true;
                ctx.moveTo(t.points[0].x, t.points[0].y);
                for (let i = 1; i < t.points.length; i++) ctx.lineTo(t.points[i].x, t.points[i].y);
            }
        });
        if (!hasVisible) return;
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = color;
        if (!isLowPerformance) {
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
        }
        ctx.fill();
        ctx.restore();
    });

    // チェーン接続線の描画
    (() => {
        const leaders = players.filter(p => p.chainRole === 1 && p.state === 'active');
        leaders.forEach(leader => {
            const followers = players
                .filter(p => p.chainRole === 2 && p.chainLeaderId === leader.id && p.state === 'active')
                .sort((a, b) => {
                    const da = (a.x - leader.x) ** 2 + (a.y - leader.y) ** 2;
                    const db = (b.x - leader.x) ** 2 + (b.y - leader.y) ** 2;
                    return da - db;
                });
            if (followers.length === 0) return;
            const chain = [leader, ...followers];

            // 光る接続線
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(chain[0].x, chain[0].y);
            for (let i = 1; i < chain.length; i++) ctx.lineTo(chain[i].x, chain[i].y);
            ctx.strokeStyle = leader.color || '#ffffff';
            ctx.lineWidth = 6;
            ctx.globalAlpha = 0.3;
            if (!isLowPerformance) { ctx.shadowColor = leader.color || '#ffffff'; ctx.shadowBlur = 15; }
            ctx.stroke();
            ctx.shadowBlur = 0;

            // 白い点線
            ctx.beginPath();
            ctx.moveTo(chain[0].x, chain[0].y);
            for (let i = 1; i < chain.length; i++) ctx.lineTo(chain[i].x, chain[i].y);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.6;
            ctx.setLineDash([8, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();

            // フォロワーに🔗表示
            followers.forEach(f => {
                ctx.save();
                ctx.translate(f.x, f.y);
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('🔗', 0, -25);
                ctx.restore();
            });
        });
    })();

    players.forEach(p => {
        // waiting状態、名前がない(Unknown)、座標が0,0のプレイヤーは表示しない
        if (p.state === 'waiting') return;
        if (!p.name || p.name === '' || p.name === 'Unknown') return;
        if (p.x === 0 && p.y === 0) return;

        let inView = (p.x + 30 >= viewLeft && p.x - 30 <= viewRight && p.y + 30 >= viewTop && p.y - 30 <= viewBottom);

        if (!inView && p.trail && p.trail.length > 0) {
            for (let i = 0; i < p.trail.length; i += 5) {
                if (p.trail[i].x >= viewLeft && p.trail[i].x <= viewRight && p.trail[i].y >= viewTop && p.trail[i].y <= viewBottom) {
                    inView = true;
                    break;
                }
            }
            if (!inView) {
                const last = p.trail[p.trail.length - 1];
                if (last.x >= viewLeft && last.x <= viewRight && last.y >= viewTop && last.y <= viewBottom) inView = true;
            }
        }

        if (!inView) return;

        const isMe = p.id === myId;
        const color = p.color;

        if (p.state === 'dead') {
            if (!p.deathTime) p.deathTime = Date.now();
            const age = Date.now() - p.deathTime;
            if (age > 2000) return;

            const t = age / 2000;
            const alpha = Math.max(0, 1 - t);

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(t * Math.PI * 6);
            ctx.globalAlpha = alpha;

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(0, 0, 16, 0, Math.PI * 2);
            ctx.fill();

            ctx.font = getGameFont(20);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(p.emoji || '💀', 0, 2);
            ctx.restore();

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.shadowColor = '#000';
            ctx.shadowBlur = 4;
            ctx.fillText(p.name || 'Unknown', 0, -25);
            ctx.shadowBlur = 0;
            ctx.restore();

            return;
        } else {
            p.deathTime = 0;
        }

        const trailSource = (p.pixelTrail && p.pixelTrail.length > 2) ? p.pixelTrail : p.trail;
        if (trailSource && trailSource.length > 0) {
            const points = [...trailSource, { x: p.x, y: p.y }];

            // 低パフォーマンス時はシンプルなパス描画
            const drawPath = () => {
                ctx.beginPath();
                if (points.length < 2) return;
                
                if (isLowPerformance) {
                    // シンプルな直線パス
                    ctx.moveTo(points[0].x, points[0].y);
                    for (let i = 1; i < points.length; i++) {
                        ctx.lineTo(points[i].x, points[i].y);
                    }
                } else {
                    // スムーズパス（Catmull-Romスプライン）
                    if (points.length === 2) {
                        ctx.moveTo(points[0].x, points[0].y);
                        ctx.lineTo(points[1].x, points[1].y);
                        return;
                    }

                    const pts = [points[0], ...points, points[points.length - 1]];
                    ctx.moveTo(pts[1].x, pts[1].y);

                    for (let i = 1; i < pts.length - 2; i++) {
                        const p0 = pts[i - 1];
                        const p1 = pts[i];
                        const p2 = pts[i + 1];
                        const p3 = pts[i + 2];

                        const segments = 4;  // 6→4に削減
                        for (let t = 1; t <= segments; t++) {
                            const tt = t / segments;
                            const tt2 = tt * tt;
                            const tt3 = tt2 * tt;

                            const x = 0.5 * (
                                (2 * p1.x) +
                                (-p0.x + p2.x) * tt +
                                (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * tt2 +
                                (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * tt3
                            );
                            const y = 0.5 * (
                                (2 * p1.y) +
                                (-p0.y + p2.y) * tt +
                                (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * tt2 +
                                (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * tt3
                            );
                            ctx.lineTo(x, y);
                        }
                    }
                }
            };

            drawPath();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = 14;
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.stroke();

            drawPath();
            ctx.lineWidth = 8;
            
            // リーダーがJET中ならフォロワーもJETエフェクト
            const leaderJet = p.chainRole === 2 && p.chainLeaderId &&
                players.some(lp => lp.id === p.chainLeaderId && lp.machBoosting);
            const isJet = p.machBoosting || leaderJet;

            // ブースト中は虹色のラインエフェクト（低パフォーマンス時は簡略化）
            if (isJet) {
                // マッハブースト: 超高速虹色 + 太いライン
                ctx.lineWidth = 12;
                if (isLowPerformance) {
                    ctx.strokeStyle = '#ff4400';
                } else {
                    const hue = (Date.now() / 2) % 360;
                    const h0 = hue | 0, h1 = (hue + 120) % 360 | 0, h2 = (hue + 240) % 360 | 0;
                    const machGradient = ctx.createLinearGradient(
                        points[0].x, points[0].y,
                        points[points.length - 1].x, points[points.length - 1].y
                    );
                    machGradient.addColorStop(0, `hsl(${h0},100%,70%)`);
                    machGradient.addColorStop(0.5, `hsl(${h1},100%,70%)`);
                    machGradient.addColorStop(1, `hsl(${h2},100%,70%)`);
                    ctx.strokeStyle = machGradient;
                    ctx.shadowColor = '#ffffff';
                    ctx.shadowBlur = 40;
                }
            } else if (p.boosting) {
                if (isLowPerformance) {
                    ctx.strokeStyle = '#ffff00';
                } else {
                    const hue = (Date.now() / 5) % 360;
                    const h0 = hue | 0, h1 = (hue + 100) % 360 | 0, h2 = (hue + 200) % 360 | 0;
                    const rainbowGradient = ctx.createLinearGradient(
                        points[0].x, points[0].y,
                        points[points.length - 1].x, points[points.length - 1].y
                    );
                    rainbowGradient.addColorStop(0, `hsl(${h0},100%,60%)`);
                    rainbowGradient.addColorStop(0.5, `hsl(${h1},100%,60%)`);
                    rainbowGradient.addColorStop(1, `hsl(${h2},100%,60%)`);
                    ctx.strokeStyle = rainbowGradient;
                    ctx.shadowColor = `hsl(${h0},100%,50%)`;
                    ctx.shadowBlur = 25;
                }
            } else {
                ctx.strokeStyle = color;
                if (!isLowPerformance) {
                    ctx.shadowColor = color;
                    ctx.shadowBlur = 15;
                }
            }
            ctx.stroke();
            ctx.shadowBlur = 0;

            drawPath();
            ctx.lineWidth = 3;
            ctx.strokeStyle = p.boosting ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)';
            ctx.stroke();
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        const pScale = p.scale || 1;
        if (pScale !== 1) ctx.scale(pScale, pScale);

        if (p.invulnerableCount > 0) {
            ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 50) * 0.4;
        }

        // ブースト中のエフェクト（低パフォーマンス時は簡略化）
        const isJetBody = p.machBoosting || (p.chainRole === 2 && p.chainLeaderId &&
            players.some(lp => lp.id === p.chainLeaderId && lp.machBoosting));
        if (isJetBody) {
            // マッハブースト: 超派手エフェクト
            if (!isLowPerformance) {
                // 二重オーラ
                const pulseSize = 32 + Math.sin(Date.now() / 30) * 8;
                ctx.beginPath();
                ctx.arc(0, 0, pulseSize, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 100, 0, 0.8)';
                ctx.lineWidth = 5;
                ctx.shadowColor = '#ff4400';
                ctx.shadowBlur = 35;
                ctx.stroke();
                ctx.shadowBlur = 0;

                ctx.beginPath();
                ctx.arc(0, 0, pulseSize + 8, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.lineWidth = 2;
                ctx.stroke();

                // 大量スピードライン
                const lineCount = 10;
                for (let i = 0; i < lineCount; i++) {
                    const angle = (Date.now() / 50 + i * (Math.PI * 2 / lineCount)) % (Math.PI * 2);
                    const innerR = 22;
                    const outerR = 45 + Math.random() * 15;
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(angle) * innerR, Math.sin(angle) * innerR);
                    ctx.lineTo(Math.cos(angle) * outerR, Math.sin(angle) * outerR);
                    ctx.strokeStyle = `rgba(255, ${150 + Math.random() * 105 | 0}, 0, 0.7)`;
                    ctx.lineWidth = 3;
                    ctx.stroke();
                }
            } else {
                ctx.beginPath();
                ctx.arc(0, 0, 26, 0, Math.PI * 2);
                ctx.strokeStyle = '#ff4400';
                ctx.lineWidth = 4;
                ctx.stroke();
            }
        } else if (p.boosting) {
            if (!isLowPerformance) {
                const pulseSize = 25 + Math.sin(Date.now() / 50) * 5;
                ctx.beginPath();
                ctx.arc(0, 0, pulseSize, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 255, 0, 0.6)';
                ctx.lineWidth = 4;
                ctx.shadowColor = '#ffff00';
                ctx.shadowBlur = 20;
                ctx.stroke();
                ctx.shadowBlur = 0;

                const lineCount = 6;
                for (let i = 0; i < lineCount; i++) {
                    const angle = (Date.now() / 100 + i * (Math.PI * 2 / lineCount)) % (Math.PI * 2);
                    const innerR = 20;
                    const outerR = 35 + Math.random() * 10;
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(angle) * innerR, Math.sin(angle) * innerR);
                    ctx.lineTo(Math.cos(angle) * outerR, Math.sin(angle) * outerR);
                    ctx.strokeStyle = 'rgba(255, 200, 0, 0.5)';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            } else {
                ctx.beginPath();
                ctx.arc(0, 0, 22, 0, Math.PI * 2);
                ctx.strokeStyle = '#ffff00';
                ctx.lineWidth = 3;
                ctx.stroke();
            }
        }

        if (!isLowPerformance) {
            ctx.shadowColor = color;
            ctx.shadowBlur = isJetBody ? 40 : p.boosting ? 25 : 15;
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, isJetBody ? 20 : p.boosting ? 18 : 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1.0;

        if (p.invulnerableCount > 0) {
            ctx.fillStyle = '#fff';
            ctx.font = getGameFont(24, true);
            ctx.textAlign = 'center';
            ctx.fillText(p.invulnerableCount, 0, -45);
        }

        ctx.font = getGameFont(20);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.emoji || '😐', 0, 2);

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;

        let displayName = p.name || 'Unknown';
        // トップランカー判定（id統一済み）
        if (p.id === topId || (topTeam && p.team === topTeam)) displayName = '👑 ' + displayName;
        ctx.fillText(displayName, 0, -25);
        ctx.shadowBlur = 0;

        ctx.restore();
    });

    drawParticles(ctx);
    drawShockwaves(ctx);

    // 連結候補リング表示
    if (chainNearbyIds.length > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 200);
        chainNearbyIds.forEach(tid => {
            const t = players.find(pp => pp.id === tid);
            if (!t || t.state !== 'active') return;
            ctx.save();
            ctx.translate(t.x, t.y);
            // 脈動するリング
            ctx.beginPath();
            ctx.arc(0, 0, 25 + pulse * 5, 0, Math.PI * 2);
            ctx.strokeStyle = '#00ff88';
            ctx.lineWidth = 3;
            ctx.globalAlpha = 0.6 + pulse * 0.3;
            ctx.shadowColor = '#00ff88';
            ctx.shadowBlur = 15;
            ctx.stroke();
            // 🔗アイコン
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('🔗', 0, -35);
            ctx.restore();
        });
    }

    ctx.restore();

    // ブーストゲージUI
    if (isGameReady) {
        drawBoostGauge(ctx);
        updateChainDetachBadge();
    }

    const now = Date.now();
    // 軽量モードではミニマップ更新間隔を2.5秒に（通常は1秒）
    const minimapInterval = isLowPerformance ? 2500 : 1000;
    if (now - lastMinimapTime > minimapInterval) {
        drawMinimap();
        lastMinimapTime = now;
    }

    // チームチャット表示切替＋戦績タブ更新
    updateTeamChatVisibility();
    if (teamChatVisible && now - (window._lastTeamStatsRefresh || 0) > 2000) {
        window._lastTeamStatsRefresh = now;
        if (currentTeamTab === 'team') refreshTeamStats();
    }

    requestAnimationFrame(loop);
}

// ブーストボタンを描画
function drawBoostGauge(ctx) {
    const gaugeWidth = 140;
    const gaugeHeight = 36;
    const gaugeX = (width - gaugeWidth) / 2;
    const gaugeY = height - 65;
    
    ctx.save();
    
    if (machBoosting) {
        // マッハブースト中: 炎のようなボタン
        const hue = (Date.now() / 3) % 360;
        const gradient = ctx.createLinearGradient(gaugeX, gaugeY, gaugeX + gaugeWidth, gaugeY);
        gradient.addColorStop(0, `hsl(${hue}, 100%, 55%)`);
        gradient.addColorStop(0.3, '#ff4400');
        gradient.addColorStop(0.7, '#ffaa00');
        gradient.addColorStop(1, `hsl(${(hue + 60) % 360}, 100%, 55%)`);

        ctx.fillStyle = gradient;
        ctx.shadowColor = '#ff4400';
        ctx.shadowBlur = 25;
        ctx.beginPath();
        ctx.roundRect(gaugeX, gaugeY, gaugeWidth, gaugeHeight, 10);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;
        ctx.fillText('\ud83d\ude80 JET!!', gaugeX + gaugeWidth / 2, gaugeY + gaugeHeight / 2);
        ctx.shadowBlur = 0;

    } else if (boostRemainingMs > 0) {
        // 通常ブースト中: 虹色グラデーションのボタン
        const hue = (Date.now() / 10) % 360;
        const gradient = ctx.createLinearGradient(gaugeX, gaugeY, gaugeX + gaugeWidth, gaugeY);
        gradient.addColorStop(0, `hsl(${hue}, 100%, 50%)`);
        gradient.addColorStop(0.5, `hsl(${(hue + 60) % 360}, 100%, 50%)`);
        gradient.addColorStop(1, `hsl(${(hue + 120) % 360}, 100%, 50%)`);

        ctx.fillStyle = gradient;
        ctx.shadowColor = '#ffff00';
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.roundRect(gaugeX, gaugeY, gaugeWidth, gaugeHeight, 10);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;
        ctx.fillText('\u26a1 BOOST!', gaugeX + gaugeWidth / 2, gaugeY + gaugeHeight / 2);
        ctx.shadowBlur = 0;

    } else if (boostCooldownSec > 0) {
        // クールダウン中: グレーのボタン
        const progress = 1 - (boostCooldownSec / 5);
        
        // 背景
        ctx.fillStyle = 'rgba(60, 60, 60, 0.8)';
        ctx.beginPath();
        ctx.roundRect(gaugeX, gaugeY, gaugeWidth, gaugeHeight, 10);
        ctx.fill();
        
        // プログレスバー
        ctx.fillStyle = 'rgba(100, 100, 100, 0.8)';
        ctx.beginPath();
        ctx.roundRect(gaugeX, gaugeY, gaugeWidth * progress, gaugeHeight, 10);
        ctx.fill();
        
        // 枠
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(gaugeX, gaugeY, gaugeWidth, gaugeHeight, 10);
        ctx.stroke();
        
        // テキスト
        ctx.fillStyle = '#888888';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${boostCooldownSec}秒`, gaugeX + gaugeWidth / 2, gaugeY + gaugeHeight / 2);
        
    } else if (jetChargeSec >= 20) {
        // ジェット使用可能: オレンジ系のJETボタン（脈動エフェクト）
        const pulse = 0.85 + Math.sin(Date.now() / 200) * 0.15;
        const gradient = ctx.createLinearGradient(gaugeX, gaugeY, gaugeX, gaugeY + gaugeHeight);
        gradient.addColorStop(0, '#ffaa00');
        gradient.addColorStop(1, '#ff6600');

        ctx.fillStyle = gradient;
        ctx.shadowColor = '#ff8800';
        ctx.shadowBlur = 15 * pulse;
        ctx.beginPath();
        ctx.roundRect(gaugeX, gaugeY, gaugeWidth, gaugeHeight, 10);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 + Math.sin(Date.now() / 150) * 0.4})`;
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#993300';
        ctx.shadowBlur = 3;
        ctx.fillText('\ud83d\ude80 JET', gaugeX + gaugeWidth / 2, gaugeY + gaugeHeight / 2);
        ctx.shadowBlur = 0;
    } else if (highSpeedEvent) {
        // イベント中: JETボタン（オレンジ系）
        const gradient = ctx.createLinearGradient(gaugeX, gaugeY, gaugeX, gaugeY + gaugeHeight);
        gradient.addColorStop(0, '#ffaa00');
        gradient.addColorStop(1, '#ff6600');

        ctx.fillStyle = gradient;
        ctx.shadowColor = '#ff8800';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.roundRect(gaugeX, gaugeY, gaugeWidth, gaugeHeight, 10);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#993300';
        ctx.shadowBlur = 2;
        ctx.fillText('\ud83d\ude80 JET', gaugeX + gaugeWidth / 2, gaugeY + gaugeHeight / 2);
        ctx.shadowBlur = 0;
    } else if (jetChargeSec > 0) {
        // ジェットチャージ中: 緑→オレンジのグラデーション進行ボタン
        const chargeProgress = jetChargeSec / 20;

        // 背景（緑ベース）
        const gradient = ctx.createLinearGradient(gaugeX, gaugeY, gaugeX, gaugeY + gaugeHeight);
        gradient.addColorStop(0, '#66ff66');
        gradient.addColorStop(1, '#22cc22');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(gaugeX, gaugeY, gaugeWidth, gaugeHeight, 10);
        ctx.fill();

        // チャージ進行バー（オレンジ系）
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(gaugeX, gaugeY, gaugeWidth, gaugeHeight, 10);
        ctx.clip();
        const jetGradient = ctx.createLinearGradient(gaugeX, gaugeY, gaugeX, gaugeY + gaugeHeight);
        jetGradient.addColorStop(0, '#ffaa00');
        jetGradient.addColorStop(1, '#ff6600');
        ctx.fillStyle = jetGradient;
        ctx.fillRect(gaugeX, gaugeY, gaugeWidth * chargeProgress, gaugeHeight);
        ctx.restore();

        // 枠
        ctx.shadowColor = chargeProgress > 0.5 ? '#ff8800' : '#44ff44';
        ctx.shadowBlur = 6;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(gaugeX, gaugeY, gaugeWidth, gaugeHeight, 10);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // テキスト
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 3;
        ctx.fillText(`\u26a1BOOST \ud83d\ude80${jetChargeSec}s`, gaugeX + gaugeWidth / 2, gaugeY + gaugeHeight / 2);
        ctx.shadowBlur = 0;
    } else {
        // 使用可能: 緑のボタン（通常ブースト）
        const gradient = ctx.createLinearGradient(gaugeX, gaugeY, gaugeX, gaugeY + gaugeHeight);
        gradient.addColorStop(0, '#66ff66');
        gradient.addColorStop(1, '#22cc22');

        ctx.fillStyle = gradient;
        ctx.shadowColor = '#44ff44';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.roundRect(gaugeX, gaugeY, gaugeWidth, gaugeHeight, 10);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#006600';
        ctx.shadowBlur = 2;
        ctx.fillText('\u26a1BOOST', gaugeX + gaugeWidth / 2, gaugeY + gaugeHeight / 2);
        ctx.shadowBlur = 0;
    }
    
    ctx.restore();
}

// 連結解除バッジの表示/非表示を更新
function updateChainDetachBadge() {
    const badge = document.getElementById('chain-detach-badge');
    if (!badge) return;
    const me = players.find(p => p.id === myId);
    if (me && me.chainRole !== 0) {
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

function drawMinimap() {
    if (!world || !world.width) return;
    minimapCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);

    const canvasSize = minimapCanvas.width;
    const s = canvasSize / world.width;
    const ox = 0;
    const oy = 0;

    if (minimapBitmapData && minimapBitmapData.bitmap) {
        const { bitmap, palette, size } = minimapBitmapData;
        const pixelSize = canvasSize / size;

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const colorIdx = bitmap[y * size + x];
                if (colorIdx > 0 && palette[colorIdx]) {
                    minimapCtx.fillStyle = palette[colorIdx];
                    minimapCtx.fillRect(x * pixelSize, y * pixelSize, pixelSize + 1, pixelSize + 1);
                }
            }
        }
    } else {
        territories.forEach(t => {
            const drawX = t.x * s + ox;
            const drawY = t.y * s + oy;
            const drawW = t.w * s;
            const drawH = t.h * s;

            const visW = Math.max(drawW, 0.5);
            const visH = Math.max(drawH, 0.5);

            const me2 = players.find(p => p.id === myId);
            const myTeam2 = me2 ? me2.team : null;
            const isMyTerritory = (t.ownerId === myId) || (myTeam2 && players.find(p => p.id === t.ownerId && p.team === myTeam2));
            if (!myTeam2 && isMyTerritory) {
                minimapCtx.fillStyle = '#ff69b4';
            } else if (t.color) {
                minimapCtx.fillStyle = t.color;
            } else {
                const owner = Object.values(players).find(p => p.id === t.ownerId);
                minimapCtx.fillStyle = owner ? owner.color : '#cccccc';
            }
            minimapCtx.fillRect(drawX, drawY, visW, visH);
        });
    }

    const playerSource = minimapPlayerPositions.length > 0 ? minimapPlayerPositions : players;

    playerSource.forEach(p => {
        let px, py, pcolor, isMe = false;
        
        // ミニマップデータ（配列形式: [x, y, colorIndex]）
        if (Array.isArray(p)) {
            px = p[0];
            py = p[1];
            const colorIdx = p[2];
            pcolor = (minimapBitmapData && minimapBitmapData.palette) 
                ? minimapBitmapData.palette[colorIdx] 
                : '#888888';
            
            // 自分判定: 座標が近い場合（±5ピクセル以内）
            const me = players.find(p => p.id === myId);
            if (me) {
                isMe = Math.abs(px - me.x) < 5 && Math.abs(py - me.y) < 5;
            }
        } 
        // 通常のplayersデータ（オブジェクト形式）
        else {
            px = p.x;
            py = p.y;
            pcolor = p.color;
            const pid = p.id;
            isMe = (pid === myId);
            
            if (p.state && p.state !== 'active') return;
        }

        minimapCtx.fillStyle = isMe ? '#fff' : pcolor;
        minimapCtx.beginPath();
        minimapCtx.arc(px * s + ox, py * s + oy, isMe ? 1.5 : 1, 0, Math.PI * 2);
        minimapCtx.fill();
    });

    // サーバーから受信した国旗位置を描画（クラスタリング計算なし）
    if (minimapBitmapData && minimapBitmapData.flags && minimapBitmapData.flags.length > 0) {
        const s = canvasSize / world.width;
        const ox = 0;
        const oy = 0;
        
        minimapCtx.font = '8px sans-serif';
        minimapCtx.textAlign = 'center';
        minimapCtx.textBaseline = 'middle';
        
        minimapBitmapData.flags.forEach(flagData => {
            const centerX = flagData.x * s + ox;
            const centerY = flagData.y * s + oy;
            minimapCtx.fillText(flagData.f, centerX, centerY);
        });
    }

    minimapCtx.strokeStyle = 'rgba(255,255,255,0.3)';
    minimapCtx.lineWidth = 1;
    minimapCtx.strokeRect(camera.x * s + ox, camera.y * s + oy, width * s, height * s);
}

function drawGrid() {
    const step = 50;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;

    const startX = Math.floor(camera.x / step) * step;
    const startY = Math.floor(camera.y / step) * step;
    const endX = startX + width + step;
    const endY = startY + height + step;

    for (let x = startX; x < endX; x += step) {
        if (x < 0 || x > world.width) continue;
        ctx.beginPath();
        ctx.moveTo(x, Math.max(0, startY));
        ctx.lineTo(x, Math.min(world.height, endY));
        ctx.stroke();
    }
    for (let y = startY; y < endY; y += step) {
        if (y < 0 || y > world.height) continue;
        ctx.beginPath();
        ctx.moveTo(Math.max(0, startX), y);
        ctx.lineTo(Math.min(world.width, endX), y);
        ctx.stroke();
    }
}

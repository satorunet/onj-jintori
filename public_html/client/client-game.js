// ============================================
// client-game.js - ゲームロジック・描画・入力
// ============================================

// エフェクト関連（無効化・コード削除済み）
function spawnCaptureLineEffect(trail, color) { }
function updateFadeOutLines(dt) { }
function drawFadeOutLines(ctx) { }

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
    
    particles.forEach(p => {
        ctx.save();
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
        ctx.restore();
    });
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

    canvas.addEventListener('touchstart', e => {
        e.preventDefault();
        const touchX = e.touches[0].clientX;
        const touchY = e.touches[0].clientY;
        
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
        // ブーストボタンエリアのクリック検出（PC用）
        if (isGameReady && isInBoostButtonArea(e.clientX, e.clientY)) {
            triggerBoost();
            return;
        }
        handleStart(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', e => { if (touchStartPos) handleMove(e.clientX, e.clientY); });
    window.addEventListener('mouseup', handleEnd);
    
    // スペースキーでもブースト発動（PC用）
    window.addEventListener('keydown', e => {
        if (e.code === 'Space' && isGameReady && !e.repeat) {
            e.preventDefault();
            triggerBoost();
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

    updateParticles(dt);
    updateFadeOutLines(dt);

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
                    if (p.pixelTrail.length > maxLen) {
                        p.pixelTrail.shift();
                    }
                }
            } else {
                if (p.pixelTrail && p.pixelTrail.length >= 2) {
                    spawnCaptureLineEffect(p.pixelTrail, p.color);
                }
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
            
            // ブースト中は虹色のラインエフェクト（低パフォーマンス時は簡略化）
            if (p.boosting) {
                if (isLowPerformance) {
                    // 低パフォーマンス: 単色で光らせる
                    ctx.strokeStyle = '#ffff00';
                } else {
                    const hue = (Date.now() / 5) % 360;
                    // 虹色グラデーション
                    const rainbowGradient = ctx.createLinearGradient(
                        points[0].x, points[0].y,
                        points[points.length - 1].x, points[points.length - 1].y
                    );
                    rainbowGradient.addColorStop(0, `hsl(${hue}, 100%, 60%)`);
                    rainbowGradient.addColorStop(0.5, `hsl(${(hue + 100) % 360}, 100%, 60%)`);
                    rainbowGradient.addColorStop(1, `hsl(${(hue + 200) % 360}, 100%, 60%)`);
                    ctx.strokeStyle = rainbowGradient;
                    ctx.shadowColor = `hsl(${hue}, 100%, 50%)`;
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

        if (p.invulnerableCount > 0) {
            ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 50) * 0.4;
        }

        // ブースト中のエフェクト（低パフォーマンス時は簡略化）
        if (p.boosting) {
            if (!isLowPerformance) {
                // 輝くオーラ
                const pulseSize = 25 + Math.sin(Date.now() / 50) * 5;
                ctx.beginPath();
                ctx.arc(0, 0, pulseSize, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 255, 0, 0.6)';
                ctx.lineWidth = 4;
                ctx.shadowColor = '#ffff00';
                ctx.shadowBlur = 20;
                ctx.stroke();
                ctx.shadowBlur = 0;
                
                // スピードライン
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
                // 低パフォーマンス: シンプルな円だけ
                ctx.beginPath();
                ctx.arc(0, 0, 22, 0, Math.PI * 2);
                ctx.strokeStyle = '#ffff00';
                ctx.lineWidth = 3;
                ctx.stroke();
            }
        }

        if (!isLowPerformance) {
            ctx.shadowColor = color;
            ctx.shadowBlur = p.boosting ? 25 : 15;
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, p.boosting ? 18 : 16, 0, Math.PI * 2);
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

    drawFadeOutLines(ctx);
    drawParticles(ctx);

    ctx.restore();

    // ブーストゲージUI
    if (isGameReady) {
        drawBoostGauge(ctx);
    }

    const now = Date.now();
    // 軽量モードではミニマップ更新間隔を2.5秒に（通常は1秒）
    const minimapInterval = isLowPerformance ? 2500 : 1000;
    if (now - lastMinimapTime > minimapInterval) {
        drawMinimap();
        lastMinimapTime = now;
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
    
    if (boostRemainingMs > 0) {
        // ブースト中: 虹色グラデーションのボタン
        const progress = boostRemainingMs / 2000;
        
        // 虹色背景
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
        
        // 枠
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // テキスト
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;
        ctx.fillText('⚡ BOOST!', gaugeX + gaugeWidth / 2, gaugeY + gaugeHeight / 2);
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
        
    } else {
        // 使用可能: 緑のボタン
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
        
        // 枠
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // テキスト
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#006600';
        ctx.shadowBlur = 2;
        ctx.fillText('⚡BOOST', gaugeX + gaugeWidth / 2, gaugeY + gaugeHeight / 2);
        ctx.shadowBlur = 0;
    }
    
    ctx.restore();
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

            if (t.color) {
                minimapCtx.fillStyle = t.color;
                minimapCtx.fillRect(drawX, drawY, visW, visH);
            } else {
                const owner = Object.values(players).find(p => p.id === t.ownerId);
                if (owner) {
                    minimapCtx.fillStyle = owner.color;
                    minimapCtx.fillRect(drawX, drawY, visW, visH);
                }
            }
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

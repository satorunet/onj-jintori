// ============================================
// client-ui.js - UI・モーダル・画面
// ============================================

// AFK切断通知を表示
function showAfkDisconnectNotice() {
    // 既存の通知があれば削除
    const existing = document.getElementById('afk-notice');
    if (existing) existing.remove();
    
    // 通知要素を作成
    const notice = document.createElement('div');
    notice.id = 'afk-notice';
    notice.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border: 2px solid #f59e0b;
        border-radius: 12px;
        padding: 24px 32px;
        z-index: 10000;
        text-align: center;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        animation: fadeIn 0.3s ease;
    `;
    
    notice.innerHTML = `
        <div style="font-size: 48px; margin-bottom: 12px;">⏰</div>
        <div style="color: #f59e0b; font-size: 18px; font-weight: bold; margin-bottom: 8px;">
            操作なしで切断されました
        </div>
        <div style="color: #94a3b8; font-size: 14px; margin-bottom: 16px;">
            一定時間操作がなかったため、サーバーから切断されました。
        </div>
        <button onclick="document.getElementById('afk-notice').remove();" style="
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
            border: none;
            color: #fff;
            padding: 10px 24px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
        ">OK</button>
    `;
    
    document.body.appendChild(notice);
    
    // 5秒後に自動で消す
    setTimeout(() => {
        const el = document.getElementById('afk-notice');
        if (el) el.remove();
    }, 5000);
}

// ============================================
// プレイヤー画像アップロード（個人用・ソロ戦向け）
// ============================================
let uploadedImageBase64 = null;

// 起動時にlocalStorageから復元
(function restorePlayerImage() {
    const saved = localStorage.getItem('playerImageBase64');
    if (!saved) return;
    uploadedImageBase64 = saved;
    function showPreview() {
        const thumb = document.getElementById('player-image-thumb');
        if (!thumb) return;
        thumb.src = 'data:image/jpeg;base64,' + saved;
        document.getElementById('player-image-preview').style.display = 'inline-block';
        const status = document.getElementById('player-image-status');
        if (status) {
            status.textContent = `${Math.round(saved.length / 1024)}KB`;
            status.style.color = '#4ade80';
        }
    }
    // DOM要素が既に存在する場合は直接表示、まだの場合はDOMContentLoaded待ち
    if (document.getElementById('player-image-thumb')) {
        showPreview();
    } else {
        document.addEventListener('DOMContentLoaded', showPreview);
    }
})();

function handleImageUpload(input) {
    const file = input.files[0];
    if (!file) return;
    const status = document.getElementById('player-image-status');
    status.textContent = '処理中...';
    status.style.color = '#94a3b8';

    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = () => {
            const maxDim = 320;
            const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const c = canvas.getContext('2d');
            c.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            uploadedImageBase64 = dataUrl.split(',')[1];
            localStorage.setItem('playerImageBase64', uploadedImageBase64);
            const thumb = document.getElementById('player-image-thumb');
            thumb.src = dataUrl;
            document.getElementById('player-image-preview').style.display = 'inline-block';
            status.textContent = `${Math.round(uploadedImageBase64.length / 1024)}KB`;
            status.style.color = '#4ade80';
        };
        img.onerror = () => {
            status.textContent = '読込失敗';
            status.style.color = '#f87171';
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
}

function clearUploadedImage() {
    uploadedImageBase64 = null;
    localStorage.removeItem('playerImageBase64');
    document.getElementById('player-image-preview').style.display = 'none';
    document.getElementById('player-image-input').value = '';
    document.getElementById('player-image-status').textContent = '';
}

// ============================================
// チーム画像提案＆投票
// ============================================

function handleTeamImageUpload(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = () => {
            const maxDim = 320;
            const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const cvs = document.createElement('canvas');
            cvs.width = w; cvs.height = h;
            const c = cvs.getContext('2d');
            c.drawImage(img, 0, 0, w, h);
            const dataUrl = cvs.toDataURL('image/jpeg', 0.7);
            const base64 = dataUrl.split(',')[1];
            // 確認ダイアログ表示
            showTeamImgConfirm(dataUrl, () => {
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'team_img_propose', img: base64 }));
                }
            });
        };
        img.onerror = () => { console.error('Team image load failed'); };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
    input.value = '';
}

function showTeamImgConfirm(dataUrl, onConfirm) {
    // 既存のダイアログがあれば削除
    const existing = document.getElementById('team-img-confirm');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'team-img-confirm';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:20000;';
    overlay.innerHTML = `
        <div style="background:#1e293b;border:1px solid #3b82f6;border-radius:12px;padding:16px;text-align:center;max-width:250px;width:90%;">
            <div style="color:#e2e8f0;font-size:13px;margin-bottom:10px;">この画像を提案しますか？</div>
            <img src="${dataUrl}" style="width:80px;height:80px;border-radius:6px;object-fit:cover;border:1px solid #475569;margin-bottom:10px;">
            <div style="display:flex;gap:8px;justify-content:center;">
                <button id="team-img-confirm-no" style="padding:6px 16px;background:#475569;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;">やめる</button>
                <button id="team-img-confirm-yes" style="padding:6px 16px;background:#3b82f6;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;">提案する</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('team-img-confirm-no').onclick = () => overlay.remove();
    document.getElementById('team-img-confirm-yes').onclick = () => { overlay.remove(); onConfirm(); };
}

function voteTeamImage() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'team_img_vote' }));
    }
    // 承認ボタンを押した後、UIを「投票済み」に変更
    const btn = document.getElementById('team-img-vote-btn');
    if (btn) { btn.textContent = '投票済'; btn.disabled = true; btn.style.background = '#475569'; }
}

function showTeamImgProposal(imgBase64, proposerName, votes, needed, isProposer) {
    // 既存の提案メッセージがあれば削除
    const old = document.getElementById('team-img-proposal-msg');
    if (old) old.remove();

    const msgs = document.getElementById('team-chat-messages');
    if (!msgs) return;

    const shortName = (proposerName || '???').replace(/^\[.*?\]\s*/, '');
    const div = document.createElement('div');
    div.id = 'team-img-proposal-msg';
    div.style.cssText = 'padding:4px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:6px;margin:2px 0;';

    const voteLabel = votes + '/' + needed + ' 票';
    let btnHtml;
    if (isProposer) {
        btnHtml = '<span style="font-size:10px;color:#64748b;">提案者</span>';
    } else {
        btnHtml = '<button id="team-img-vote-btn" onclick="voteTeamImage()" style="padding:2px 8px;background:#3b82f6;color:#fff;border:none;border-radius:3px;font-size:10px;cursor:pointer;margin-right:4px;">承認</button>';
    }

    div.innerHTML = `
        <div style="font-size:11px;color:#93c5fd;font-weight:bold;">${shortName} が陣地画像を提案</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
            <img src="data:image/jpeg;base64,${imgBase64}" style="width:40px;height:40px;border-radius:4px;object-fit:cover;border:1px solid #475569;flex-shrink:0;">
            <div>
                <div id="team-img-proposal-votes" style="font-size:10px;color:#94a3b8;margin-bottom:2px;">${voteLabel}</div>
                ${btnHtml}
            </div>
        </div>
    `;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
}

function updateTeamImgVotes(votes, needed, isProposer) {
    const el = document.getElementById('team-img-proposal-votes');
    if (el) el.textContent = votes + '/' + needed + ' 票';
    // isProposerの場合はボタンがないので何もしない
}

function hideTeamImgProposal() {
    const msg = document.getElementById('team-img-proposal-msg');
    if (msg) msg.remove();
}

function onTeamImgApproved(imgBase64) {
    // 提案メッセージを「承認済み」に変更
    const msg = document.getElementById('team-img-proposal-msg');
    if (msg) {
        msg.style.background = 'rgba(74,222,128,0.1)';
        msg.style.borderColor = 'rgba(74,222,128,0.3)';
        const voteEl = document.getElementById('team-img-proposal-votes');
        if (voteEl) voteEl.textContent = '承認済み！';
        const btn = document.getElementById('team-img-vote-btn');
        if (btn) btn.remove();
    } else {
        appendTeamChatMessage('🖼️ チーム画像が承認されました！', '', '#4ade80');
    }
    // チーム画像サムネイル表示
    const cur = document.getElementById('team-img-current');
    if (cur) {
        cur.style.display = 'block';
        document.getElementById('team-img-thumb').src = 'data:image/jpeg;base64,' + imgBase64;
    }
    // チーム全員のplayerImagesを一括設定
    const me = players.find(p => p.id === myId);
    if (!me || !me.team) return;
    const img = new Image();
    img.onload = () => {
        for (const pid in playerProfiles) {
            if (playerProfiles[pid].team === me.team) {
                playerImages[pid] = img;
                playerPatterns[pid] = null;
            }
        }
        // 自分も
        playerImages[myId] = img;
        playerPatterns[myId] = null;
    };
    img.src = 'data:image/jpeg;base64,' + imgBase64;
}

// ============================================
// Bot認証ダイアログ
// ============================================
function showBotAuthDialog(captchaImage, message) {
    // 既存のダイアログがあれば削除
    const existing = document.getElementById('bot-auth-modal');
    if (existing) existing.remove();
    
    // ダイアログ要素を作成
    const modal = document.createElement('div');
    modal.id = 'bot-auth-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
        animation: fadeIn 0.3s ease;
    `;
    
    modal.innerHTML = `
        <div style="
            background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
            border: 2px solid #3b82f6;
            border-radius: 16px;
            padding: 32px;
            max-width: 400px;
            width: 90%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        ">
            <div style="font-size: 48px; text-align: center; margin-bottom: 16px;">🔐</div>
            <div style="color: #3b82f6; font-size: 20px; font-weight: bold; text-align: center; margin-bottom: 12px;">
                Bot認証が必要です
            </div>
            <div id="bot-auth-message" style="color: #94a3b8; font-size: 14px; text-align: center; margin-bottom: 20px;">
                ${message}
            </div>
            
            <div style="text-align: center; margin-bottom: 20px;">
                <img id="bot-auth-captcha" src="${captchaImage}" style="
                    border: 2px solid #475569;
                    border-radius: 8px;
                    background: #fff;
                    max-width: 100%;
                " />
            </div>
            
            <div id="bot-auth-error" style="
                color: #ef4444;
                font-size: 13px;
                text-align: center;
                margin-bottom: 12px;
                min-height: 20px;
            "></div>
            
            <div style="margin-bottom: 16px;">
                <label style="color: #cbd5e1; font-size: 14px; display: block; margin-bottom: 6px;">
                    画像の3桁の数字を入力してください
                </label>
                <input 
                    type="text" 
                    id="bot-auth-input" 
                    maxlength="3" 
                    pattern="[0-9]{3}"
                    inputmode="numeric"
                    autocomplete="off"
                    style="
                        width: 100%;
                        padding: 12px;
                        font-size: 24px;
                        text-align: center;
                        letter-spacing: 8px;
                        border: 2px solid #475569;
                        border-radius: 8px;
                        background: #0f172a;
                        color: #fff;
                        font-family: monospace;
                    "
                    placeholder="000"
                />
            </div>
            
            <button id="bot-auth-submit" style="
                width: 100%;
                background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                border: none;
                color: #fff;
                padding: 14px;
                border-radius: 8px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                transition: all 0.2s;
            ">認証する</button>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // イベントリスナーを設定
    const input = document.getElementById('bot-auth-input');
    const submitBtn = document.getElementById('bot-auth-submit');
    
    // 全角数字を半角に変換する関数
    const toHalfWidth = (str) => {
        return str.replace(/[０-９]/g, (s) => {
            return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
        });
    };
    
    // 数字のみ入力可能にする（全角数字も半角に変換）
    input.addEventListener('input', (e) => {
        // 全角数字を半角に変換
        let value = toHalfWidth(e.target.value);
        // 数字以外を削除
        value = value.replace(/[^0-9]/g, '');
        e.target.value = value;
    });
    
    // Enterキーで送信
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && input.value.length === 3) {
            submitBotAuth();
        }
    });
    
    // ボタンクリックで送信
    submitBtn.addEventListener('click', submitBotAuth);
    
    // モーダルホバーエフェクト
    submitBtn.addEventListener('mouseenter', (e) => {
        e.target.style.transform = 'translateY(-2px)';
        e.target.style.boxShadow = '0 4px 12px rgba(59,130,246,0.4)';
    });
    submitBtn.addEventListener('mouseleave', (e) => {
        e.target.style.transform = 'translateY(0)';
        e.target.style.boxShadow = 'none';
    });
    
    // 自動フォーカス
    input.focus();
}

function submitBotAuth() {
    const input = document.getElementById('bot-auth-input');
    let code = input.value;
    
    // 全角数字を半角に変換
    code = code.replace(/[０-９]/g, (s) => {
        return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
    });
    
    // 数字以外を削除
    code = code.replace(/[^0-9]/g, '');
    
    console.log('[Bot Auth] Submitting code:', code);
    
    if (code.length !== 3) {
        showBotAuthError('3桁の数字を入力してください');
        return;
    }
    
    // サーバーに認証コードを送信
    if (socket && socket.readyState === WebSocket.OPEN) {
        console.log('[Bot Auth] Sending to server:', { type: 'bot_auth_response', code: code });
        socket.send(JSON.stringify({
            type: 'bot_auth_response',
            code: code
        }));
        
        // 送信中表示
        const submitBtn = document.getElementById('bot-auth-submit');
        if (submitBtn) {
            submitBtn.textContent = '認証中...';
            submitBtn.disabled = true;
        }
    } else {
        console.error('[Bot Auth] Socket not ready:', socket ? socket.readyState : 'null');
        showBotAuthError('サーバーとの接続がありません');
    }
}

function showBotAuthError(message) {
    const errorDiv = document.getElementById('bot-auth-error');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.animation = 'shake 0.5s';
        setTimeout(() => {
            if (errorDiv) errorDiv.style.animation = '';
        }, 500);
    }
}

function updateBotAuthCaptcha(newCaptchaImage) {
    const img = document.getElementById('bot-auth-captcha');
    const input = document.getElementById('bot-auth-input');
    const submitBtn = document.getElementById('bot-auth-submit');
    
    if (img) img.src = newCaptchaImage;
    if (input) {
        input.value = '';
        input.focus();
    }
    if (submitBtn) {
        submitBtn.textContent = '認証する';
        submitBtn.disabled = false;
    }
}

function hideBotAuthDialog() {
    const modal = document.getElementById('bot-auth-modal');
    if (modal) {
        modal.style.opacity = '0';
        setTimeout(() => modal.remove(), 300);
    }
}

// 設定モーダル
function showSettingsModal() {
    document.getElementById('settings-modal').style.display = 'flex';
    updateSettingsUI();
}

function hideSettingsModal() {
    document.getElementById('settings-modal').style.display = 'none';
}

function setPerformanceMode(mode) {
    performanceMode = mode;
    localStorage.setItem('performanceMode', mode);
    
    // 手動設定時はisLowPerformanceを即時設定
    if (mode === 'low') {
        isLowPerformance = true;
        fpsHistory = [];  // FPS履歴をリセット
    } else if (mode === 'high') {
        isLowPerformance = false;
        fpsHistory = [];
    }
    // autoの場合はFPS監視で自動切り替え
    
    // サーバーにパフォーマンスモードを通知（AOI調整用）
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'perf', mode: mode }));
    }
    
    updateSettingsUI();
    console.log('[Settings] Performance mode set to:', mode);
}

function updateSettingsUI() {
    const modes = ['auto', 'high', 'low'];
    const descriptions = {
        'auto': 'FPSに応じて自動的に切り替えます',
        'high': '高品質な描画（光沢エフェクト・スムーズな線）',
        'low': '軽量描画（エフェクト簡略化・直線描画）'
    };
    
    modes.forEach(m => {
        const btn = document.getElementById('perf-' + m);
        if (btn) {
            if (m === performanceMode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });
    
    const desc = document.getElementById('perf-description');
    if (desc) {
        desc.textContent = descriptions[performanceMode] || '';
    }
}

// 起動時に設定を読み込み
function loadSettings() {
    const savedMode = localStorage.getItem('performanceMode');
    if (savedMode && ['auto', 'high', 'low'].includes(savedMode)) {
        performanceMode = savedMode;
        if (savedMode === 'high') {
            isLowPerformance = false;
        } else if (savedMode === 'low') {
            isLowPerformance = true;
        }
        // autoの場合はFPS監視で自動切り替え（初期値はlow）
    }
    // savedModeがない場合はデフォルトの'low'のまま
}

// ページ読み込み時に設定を読み込む
loadSettings();

function startGame() {
    const name = document.getElementById('username-input').value;
    const flagSelect = document.getElementById('flag-select');
    const teamInput = document.getElementById('team-input').value;
    
    // 国旗 + チーム名を組み合わせ
    const flag = flagSelect ? flagSelect.value : '';
    const team = flag && teamInput ? flag + teamInput : teamInput;

    if (name.includes('[') || name.includes(']')) {
        alert("名前に「[」や「]」は使えません。");
        return;
    }

    if (name) localStorage.setItem('playerName', name);
    if (teamInput) localStorage.setItem('playerTeam', teamInput);
    if (flag) localStorage.setItem('playerFlag', flag);

    if (socket.readyState === WebSocket.OPEN) {
        const joinMsg = { type: 'join', name: name, team: team };
        if (imageEnabled && uploadedImageBase64) joinMsg.img = uploadedImageBase64;
        socket.send(JSON.stringify(joinMsg));
        document.getElementById('login-modal').style.display = 'none';
        isGameReady = true;
        
        // スコア画面期間中であれば、pending結果を表示
        // （サーバーはroundActive=falseの間はstateメッセージを送信しないため）
        if (isScoreScreenPeriod && pendingResultScreen) {
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
            pendingResultScreen = null;
        }
    } else {
        alert("サーバー接続中です。少々お待ち下さい。");
    }
}

// 既存チームを選択した時に国旗とチーム名を分離してセット
function selectExistingTeam(fullTeamName) {
    if (!fullTeamName) return;
    
    const flagSelect = document.getElementById('flag-select');
    const teamInput = document.getElementById('team-input');
    
    // 国旗絵文字を検出（先頭の2つのRegional Indicator Symbol）
    // 国旗はU+1F1E6〜U+1F1FFの2文字で構成される
    const chars = Array.from(fullTeamName);
    let flag = '';
    let teamName = fullTeamName;
    
    // 特殊プレフィックス絵文字（国旗以外でフラグとして使えるもの）
    const SPECIAL_FLAG_EMOJIS = ['🍂'];

    if (chars.length >= 1 && SPECIAL_FLAG_EMOJIS.includes(chars[0])) {
        flag = chars[0];
        teamName = chars.slice(1).join('');
    } else if (chars.length >= 2) {
        const first = chars[0].codePointAt(0);
        const second = chars[1].codePointAt(0);

        // Regional Indicator Symbol範囲: U+1F1E6 (🇦) to U+1F1FF (🇿)
        if (first >= 0x1F1E6 && first <= 0x1F1FF && second >= 0x1F1E6 && second <= 0x1F1FF) {
            flag = chars[0] + chars[1];
            teamName = chars.slice(2).join('');
        }
    }
    
    if (flag && flagSelect) {
        flagSelect.value = flag;
    } else if (flagSelect) {
        flagSelect.value = '';
    }
    
    if (teamInput) {
        teamInput.value = teamName;
    }
}

function showHistoryModal() {
    document.getElementById('history-modal').style.display = 'flex';
    switchPeriod('today');
}

function switchPeriod(period) {
    currentHistoryPeriod = period;

    const btnToday = document.getElementById('period-btn-today');
    const btnAll = document.getElementById('period-btn-all');
    if (btnToday) btnToday.style.background = period === 'today' ? '#3b82f6' : '#475569';
    if (btnAll) btnAll.style.background = period === 'all' ? '#3b82f6' : '#475569';

    const subtitle = document.getElementById('ranking-subtitle');
    if (subtitle) {
        if (period === 'today') {
            const d = new Date().toLocaleDateString('ja-JP');
            subtitle.innerHTML = `今日のランキング<br>🏆${d}杯`;
        } else {
            subtitle.innerHTML = `通算ランキング<br>🏆全期間`;
        }
    }

    loadHistoryTab(currentHistoryTab);
}

function hideHistoryModal() {
    document.getElementById('history-modal').style.display = 'none';
}

function updateRoundFilter(val) {
    currentRoundFilter = val;
    loadHistoryTab('rounds');
}

async function loadHistoryTab(tab) {
    currentHistoryTab = tab;
    const content = document.getElementById('history-content');
    content.innerHTML = '<p style="text-align:center; color:#94a3b8;">読み込み中...</p>';

    ['teams', 'teams-best', 'players', 'players-best', 'rounds'].forEach(t => {
        const btn = document.getElementById('history-tab-' + t);
        if (btn) btn.style.background = t === tab ? '#3b82f6' : '#475569';
    });

    try {
        let html = '';
        if (tab === 'rounds') {
            html += `<div style="margin-bottom:10px; text-align:right;">
                    <span style="font-size:0.8rem; color:#94a3b8; margin-right:5px;">期間:</span>
                    <select onchange="updateRoundFilter(this.value)" style="padding:4px; border-radius:4px; background:#1e293b; color:#cbd5e1; border:1px solid #475569; font-size:0.8rem;">
                        <option value="latest" ${currentRoundFilter === 'latest' ? 'selected' : ''}>最新 (50件)</option>
                        <option value="1h" ${currentRoundFilter === '1h' ? 'selected' : ''}>1時間以内</option>
                        <option value="3h" ${currentRoundFilter === '3h' ? 'selected' : ''}>3時間以内</option>
                        <option value="24h" ${currentRoundFilter === '24h' ? 'selected' : ''}>24時間以内</option>
                        <option value="all" ${currentRoundFilter === 'all' ? 'selected' : ''}>全期間 (Limit 500)</option>
                    </select>
                </div>`;

            let queryString = '';
            if (currentRoundFilter === 'latest') queryString = '?limit=50';
            else if (currentRoundFilter === '1h') queryString = '?hours=1';
            else if (currentRoundFilter === '3h') queryString = '?hours=3';
            else if (currentRoundFilter === '24h') queryString = '?hours=24';
            else if (currentRoundFilter === 'all') queryString = '?limit=500';

            const res = await fetch(API_BASE + '/api/rounds' + queryString, { credentials: 'include' });
            const data = await res.json();

            html += '<table id="ranking-table" class="result-table" style="width:100%;"><thead><tr><th onclick="sortTable(0)">日時</th><th onclick="sortTable(1)">モード</th><th onclick="sortTable(2)">人数</th><th onclick="sortTable(3)">1位</th><th onclick="sortTable(4)">占領</th></tr></thead><tbody>';
            data.forEach(r => {
                const date = new Date(r.played_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                const scoreTxt = formatPercent(r.winner_score);
                let winnerDisplay = r.winner || '-';
                if (r.mode === 'TEAM' && r.winner) {
                    winnerDisplay = `[${r.winner}]`;
                }
                html += `<tr><td>${date}</td><td>${r.mode}</td><td>${r.player_count}</td><td>${winnerDisplay}</td><td>${scoreTxt || '-'}</td></tr>`;
            });
            html += '</tbody></table>';

        } else if (tab === 'players' || tab === 'players-best') {
            const sort = tab === 'players-best' ? 'best' : 'total';
            const res = await fetch(API_BASE + '/api/player-stats?sort=' + sort + '&period=' + currentHistoryPeriod, { credentials: 'include' });
            const data = await res.json();
            const scoreLabel = sort === 'best' ? '最高占領' : '累計占領';

            html = `<table id="ranking-table" class="result-table" style="width:100%;"><thead><tr><th onclick="sortTable(0)">#</th><th onclick="sortTable(1)">名前</th><th onclick="sortTable(2)">試合</th><th onclick="sortTable(3)">1位</th><th onclick="sortTable(4)">${scoreLabel}</th><th onclick="sortTable(5)">キル</th></tr></thead><tbody>`;
            data.forEach((p, i) => {
                const scoreVal = sort === 'best' ? p.best_score : p.total_score;
                const scoreTxt = sort === 'best' ? formatPercent(scoreVal) : formatPercent(scoreVal);
                html += `<tr><td>${i + 1}</td><td>${p.player_name}</td><td>${p.total_games}</td><td>${p.wins}</td><td>${scoreTxt}</td><td>${p.total_kills}</td></tr>`;
            });
            html += '</tbody></table>';

        } else if (tab === 'teams' || tab === 'teams-best') {
            const sort = tab === 'teams-best' ? 'best' : 'total';
            const res = await fetch(API_BASE + '/api/team-stats?sort=' + sort + '&period=' + currentHistoryPeriod, { credentials: 'include' });
            const data = await res.json();
            const scoreLabel = sort === 'best' ? '最高占領' : '累計占領';

            html = `<table id="ranking-table" class="result-table" style="width:100%;"><thead><tr><th onclick="sortTable(0)">#</th><th onclick="sortTable(1)">チーム</th><th onclick="sortTable(2)">試合</th><th onclick="sortTable(3)">1位</th><th onclick="sortTable(4)">${scoreLabel}</th><th onclick="sortTable(5)">キル</th></tr></thead><tbody>`;
            data.forEach((t, i) => {
                const scoreVal = sort === 'best' ? t.best_score : t.total_score;
                const scoreTxt = sort === 'best' ? formatPercent(scoreVal) : formatPercent(scoreVal);
                html += `<tr><td>${i + 1}</td><td>${t.team_name}</td><td>${t.total_games}</td><td>${t.wins}</td><td>${scoreTxt}</td><td>${t.total_kills}</td></tr>`;
            });
            html += '</tbody></table>';
        }
        content.innerHTML = html || '<p style="text-align:center; color:#94a3b8;">データがありません</p>';
    } catch (e) {
        content.innerHTML = '<p style="text-align:center; color:#ef4444;">読み込みエラー: ' + e.message + '</p>';
    }
}

async function showRoundDetail(roundId) {
    try {
        const sub = document.getElementById('ranking-subtitle');
        if (sub) sub.innerText = '詳細データを読み込み中...';

        const res = await fetch(API_BASE + '/api/round/' + roundId, { credentials: 'include' });
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        const rankingData = data.players.map(p => ({
            name: p.player_name,
            score: p.score,
            emoji: p.emoji || '👤',
            color: '#94a3b8',
            kills: p.kills,
            team: p.team
        }));

        const teamData = data.teams.map(t => ({
            name: t.team_name,
            score: t.score,
            kills: t.kills
        }));

        const total = rankingData.length;
        showResultScreen(rankingData, rankingData[0], teamData, null, [], total, data.minimap);

        const resModal = document.getElementById('result-modal');
        resModal.style.zIndex = '10001';

    } catch (e) {
        alert('詳細データの取得に失敗しました: ' + e.message);
    }

    switchPeriod(currentHistoryPeriod);
}

function sortTable(colIndex) {
    const table = document.getElementById("ranking-table");
    if (!table) return;
    const tbody = table.tBodies[0];
    const rows = Array.from(tbody.rows);

    if (currentSortCol === colIndex) {
        currentSortAsc = !currentSortAsc;
    } else {
        currentSortCol = colIndex;
        currentSortAsc = false;
        if (colIndex === 0 || colIndex === 1) currentSortAsc = true;
    }

    rows.sort((a, b) => {
        const valA = a.cells[colIndex].innerText;
        const valB = b.cells[colIndex].innerText;
        const numA = parseFloat(valA.replace(/[%,]/g, ''));
        const numB = parseFloat(valB.replace(/[%,]/g, ''));

        if (!isNaN(numA) && !isNaN(numB)) {
            return currentSortAsc ? numA - numB : numB - numA;
        }
        return currentSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });

    rows.forEach(row => tbody.appendChild(row));

    const ths = table.tHead.rows[0].cells;
    if (ths[0].innerText === '#') {
        rows.forEach((row, index) => {
            row.cells[0].innerText = index + 1;
        });
    }
}

function updateLoginIcons() {
    const li = document.getElementById('login-players');
    if (li && document.getElementById('login-modal').style.display !== 'none') {
        const profileIds = Object.keys(playerProfiles);
        
        // currentPlayerCountに合わせてアイコン数を制限
        // profilesが多すぎる場合は最新のものだけ表示
        const maxIcons = Math.min(currentPlayerCount, 18);
        const displayIds = profileIds.slice(-maxIcons);  // 後ろから（新しい順）

        const frag = document.createDocumentFragment();
        displayIds.forEach(pid => {
            const profile = playerProfiles[pid];
            if (!profile) return;

            const div = document.createElement('div');
            const color = profile.color || '#ccc';
            const emoji = profile.emoji;
            const name = profile.name || 'Unknown';

            div.style.cssText = `width:30px; height:30px; border-radius:50%; background-color:${color}; display:flex; align-items:center; justify-content:center; font-size:18px; color:#fff; text-shadow:1px 1px 1px #000; box-shadow:0 2px 4px rgba(0,0,0,0.3); cursor:default;`;
            div.textContent = emoji || '😐';
            div.title = name;
            frag.appendChild(div);
        });
        li.innerHTML = '';
        li.appendChild(frag);
        
        // アイコン数と人数の差が大きい場合、古いプロファイルを削除
        if (profileIds.length > currentPlayerCount + 10) {
            const toRemove = profileIds.slice(0, profileIds.length - currentPlayerCount);
            toRemove.forEach(pid => delete playerProfiles[pid]);
        }
    }
}

// 時間杯チップ表示（ラインで結ぶ）
function showHourlyTip(e, text) {
    e.stopPropagation();
    hideHourlyTip();

    const rect = e.target.getBoundingClientRect();
    const barCx = rect.left + rect.width / 2;
    const barTop = rect.top;
    const barBottom = rect.bottom;

    // チップ
    const tip = document.createElement('div');
    tip.id = 'hourly-tip';
    tip.textContent = text;
    tip.style.cssText = 'position:fixed; background:#1e293b; color:#fff; font-size:0.7rem; padding:4px 10px; border-radius:4px; border:1px solid #475569; box-shadow:0 2px 8px rgba(0,0,0,0.5); z-index:20000; pointer-events:none; white-space:nowrap;';
    document.body.appendChild(tip);

    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    const gap = 8;
    const above = barTop - tipH - gap >= 0;
    let tipTop = above ? barTop - tipH - gap : barBottom + gap;
    let tipLeft = barCx - tipW / 2;
    if (tipLeft < 4) tipLeft = 4;
    if (tipLeft + tipW > window.innerWidth - 4) tipLeft = window.innerWidth - tipW - 4;
    tip.style.left = tipLeft + 'px';
    tip.style.top = tipTop + 'px';

    // ライン（SVG）
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'hourly-tip-line';
    svg.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; z-index:19999; pointer-events:none;';
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', barCx);
    line.setAttribute('y1', above ? barTop : barBottom);
    line.setAttribute('x2', tipLeft + tipW / 2);
    line.setAttribute('y2', above ? tipTop + tipH : tipTop);
    line.setAttribute('stroke', '#94a3b8');
    line.setAttribute('stroke-width', '1');
    line.setAttribute('stroke-dasharray', '3,3');
    svg.appendChild(line);
    // バー上の小丸
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', barCx);
    circle.setAttribute('cy', above ? barTop : barBottom);
    circle.setAttribute('r', '2.5');
    circle.setAttribute('fill', '#94a3b8');
    svg.appendChild(circle);
    document.body.appendChild(svg);

    setTimeout(() => { document.addEventListener('click', hideHourlyTip, { once: true }); }, 0);
}
function hideHourlyTip() {
    const t = document.getElementById('hourly-tip');
    if (t) t.remove();
    const l = document.getElementById('hourly-tip-line');
    if (l) l.remove();
}

// 杯データのキャッシュ
let hourlyWinsCache = null;
let dailyWinsCache = null;
let resultWinnerName = null; // 直近ラウンド勝者名（チップ自動表示用）

// 期間・カテゴリの現在状態を保持
const currentCupPeriod = {};   // location → 'hourly' | 'daily'
const currentCupCategory = {}; // location → 'team' | 'player'

// 時間杯データを取得
async function fetchHourlyWins() {
    try {
        const res = await fetch(API_BASE + '/api/wins-hourly?hours=24', { credentials: 'include' });
        const data = await res.json();
        // 空データはキャッシュしない（レースコンディション対策）
        if (data && !data.error && (data.teams?.length || data.players?.length)) hourlyWinsCache = data;
        return data;
    } catch (e) { console.error('[HourlyGraph] fetch error:', e); return null; }
}

// 1日杯データを取得
async function fetchDailyWins() {
    try {
        const res = await fetch(API_BASE + '/api/wins-daily?days=20', { credentials: 'include' });
        const data = await res.json();
        // 空データはキャッシュしない（レースコンディション対策）
        if (data && !data.error && (data.teams?.length || data.players?.length)) dailyWinsCache = data;
        return data;
    } catch (e) { console.error('[DailyGraph] fetch error:', e); return null; }
}

// 共通: 横棒グラフHTMLを生成（slotKey/labelKey でhourly/daily両対応）
function buildCupBarsHtml(rows, topN, slotKey, labelKey) {
    if (!rows || rows.length === 0) return '';

    const TEAM_COLORS = {
        'RED': '#ef4444', 'BLUE': '#3b82f6', 'GREEN': '#22c55e',
        'YELLOW': '#eab308', 'HUMAN': '#3b82f6', '🍂たぬき': '#8B4513', '🇯🇵ONJ': '#9ca3af'
    };
    const PALETTE = ['#f97316','#a855f7','#14b8a6','#ec4899','#6366f1','#84cc16','#f43f5e','#06b6d4'];

    // topN指定時: 全スロットの合計勝利数で上位N名を決定
    let topNames = null;
    if (topN > 0) {
        const totalByName = {};
        rows.forEach(row => { totalByName[row.name] = (totalByName[row.name] || 0) + row.wins; });
        const sorted = Object.entries(totalByName).sort((a, b) => b[1] - a[1]);
        topNames = new Set(sorted.slice(0, topN).map(e => e[0]));
    }

    // スロットごとにグループ化
    const slotMap = {};
    const allNames = new Set();
    rows.forEach(row => {
        const slot = row[slotKey];
        const label = row[labelKey];
        if (!slotMap[slot]) slotMap[slot] = { label: label, entries: [] };
        if (topNames && !topNames.has(row.name)) {
            const existing = slotMap[slot].entries.find(e => e.name === 'その他');
            if (existing) { existing.wins += row.wins; }
            else { slotMap[slot].entries.push({ name: 'その他', wins: row.wins }); }
        } else {
            slotMap[slot].entries.push({ name: row.name, wins: row.wins });
            allNames.add(row.name);
        }
    });
    if (topNames) allNames.add('その他');

    // 名前ごとに一貫した色を割り当て
    const colorMap = {};
    let paletteIdx = 0;
    allNames.forEach(name => {
        if (name === 'その他') { colorMap[name] = '#475569'; }
        else { colorMap[name] = TEAM_COLORS[name] || PALETTE[paletteIdx++ % PALETTE.length]; }
    });

    const slots = Object.keys(slotMap).sort().reverse();

    let html = '';
    slots.forEach(slot => {
        const h = slotMap[slot];
        const totalWins = h.entries.reduce((sum, t) => sum + t.wins, 0);
        if (totalWins === 0) return;

        // wins降順にソート
        h.entries.sort((a, b) => b.wins - a.wins);

        // 🏆表示: その他以外の最上位を表示、いなければ「なし」
        const topEntry = h.entries.find(e => e.name !== 'その他');
        const winnerName = topEntry ? topEntry.name : 'なし';

        html += `<div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">`;
        html += `<div style="font-size:0.7rem; color:#64748b; width:36px; text-align:right; flex-shrink:0;">${h.label}</div>`;
        html += `<div style="display:flex; height:18px; border-radius:3px; overflow:hidden; flex:1;">`;
        h.entries.forEach(t => {
            const pct = (t.wins / totalWins * 100);
            const color = colorMap[t.name];
            const label = pct >= 20 ? `${t.name}` : (pct >= 12 ? `${Math.round(pct)}%` : '');
            const tipText = `${t.name}: ${t.wins}勝 (${Math.round(pct)}%)`;
            html += `<div data-name="${t.name.replace(/"/g, '&quot;')}" onclick="showHourlyTip(event,'${tipText.replace(/'/g, "\\&#39;")}')" style="width:${pct}%; background:${color}; display:flex; align-items:center; justify-content:center; font-size:0.6rem; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,0.7); white-space:nowrap; overflow:hidden; min-width:2px; cursor:pointer;">${label}</div>`;
        });
        html += `</div>`;
        html += `<div style="font-size:0.65rem; color:#fbbf24; width:50px; text-align:left; flex-shrink:0; overflow:hidden; white-space:nowrap;">🏆${winnerName}</div>`;
        html += `</div>`;
    });

    return html || '';
}

// 期間切り替え（時間杯 / 1日杯）
async function switchCupPeriod(location, period) {
    hideHourlyTip();
    currentCupPeriod[location] = period;

    // 期間ボタンのactive状態を更新
    const hourlyBtn = document.getElementById(location + '-cup-hourly');
    const dailyBtn = document.getElementById(location + '-cup-daily');
    if (hourlyBtn) hourlyBtn.className = 'hourly-tab-btn' + (period === 'hourly' ? ' active' : '');
    if (dailyBtn) dailyBtn.className = 'hourly-tab-btn' + (period === 'daily' ? ' active' : '');

    // データが未取得 or 空ならフェッチ
    if (period === 'daily' && (!dailyWinsCache || (!dailyWinsCache.teams?.length && !dailyWinsCache.players?.length))) await fetchDailyWins();
    if (period === 'hourly' && (!hourlyWinsCache || (!hourlyWinsCache.teams?.length && !hourlyWinsCache.players?.length))) await fetchHourlyWins();

    // 現在のカテゴリタブで再描画
    const tab = currentCupCategory[location] || 'team';
    renderCupBars(location, tab);
}

// カテゴリ切り替え（チーム / 個人）
function switchHourlyTab(location, tab) {
    hideHourlyTip();
    currentCupCategory[location] = tab;

    // タブボタンのactive状態を更新
    const teamBtn = document.getElementById(location + '-hourly-tab-team');
    const playerBtn = document.getElementById(location + '-hourly-tab-player');
    if (teamBtn) teamBtn.className = 'hourly-tab-btn' + (tab === 'team' ? ' active' : '');
    if (playerBtn) playerBtn.className = 'hourly-tab-btn' + (tab === 'player' ? ' active' : '');

    renderCupBars(location, tab);
}

// グラフ描画の共通処理
function renderCupBars(location, tab) {
    const barsDiv = document.getElementById(location + '-hourly-bars');
    if (!barsDiv) return;

    const period = currentCupPeriod[location] || 'hourly';
    const cache = period === 'daily' ? dailyWinsCache : hourlyWinsCache;
    if (!cache) {
        barsDiv.innerHTML = '<div style="text-align:center; color:#64748b; font-size:0.7rem;">データなし</div>';
        return;
    }

    let rows = tab === 'team' ? cache.teams : cache.players;

    // 個人タブ: [チーム名] プレフィックスを除去し、同一人物の勝利数を合算
    if (tab === 'player' && rows) {
        const slotKey = period === 'daily' ? 'day_slot' : 'hour_slot';
        const labelKey = period === 'daily' ? 'day_label' : 'hour_num';
        const merged = {};
        rows.forEach(r => {
            const pureName = r.name.replace(/^\[.*?\]\s*/, '');
            const key = r[slotKey] + '\0' + pureName;
            if (merged[key]) { merged[key].wins += r.wins; }
            else { merged[key] = { [slotKey]: r[slotKey], [labelKey]: r[labelKey], name: pureName, wins: r.wins }; }
        });
        rows = Object.values(merged);
        rows.sort((a, b) => a[slotKey] < b[slotKey] ? 1 : a[slotKey] > b[slotKey] ? -1 : b.wins - a.wins);
    }

    const topN = (tab === 'player') ? 10 : 0;
    let slotKey, labelKey;
    if (period === 'daily') {
        slotKey = 'day_slot';
        labelKey = 'day_label';
    } else {
        slotKey = 'hour_slot';
        // hour_num を「N時」形式のラベルに変換
        rows = rows.map(r => ({ ...r, _label: r.hour_num + '時' }));
        slotKey = 'hour_slot';
        labelKey = '_label';
    }

    const html = buildCupBarsHtml(rows, topN, slotKey, labelKey);
    const expandDiv = document.getElementById(location + '-cup-expand');
    const expandIcon = document.getElementById(location + '-cup-expand-icon');

    // タブ切り替え前の展開状態を保持
    const wasExpanded = barsDiv.firstElementChild && barsDiv.firstElementChild.dataset.expanded === 'true';

    if (!html) {
        barsDiv.innerHTML = '<div style="text-align:center; color:#64748b; font-size:0.7rem;">データなし</div>';
        if (expandDiv) expandDiv.style.display = 'none';
    } else {
        const cupTransition = 'max-height 0.4s cubic-bezier(0.34,1.56,0.64,1)';
        barsDiv.innerHTML = `<div style="max-height:${wasExpanded ? '300px' : '114px'}; overflow-y:auto; scrollbar-width:thin; scrollbar-color:#475569 transparent;${wasExpanded ? '' : ' transition:' + cupTransition + ';'}">${html}</div>`;
        barsDiv.firstElementChild.addEventListener('scroll', hideHourlyTip);

        // 展開ボタンの表示制御 + 展開状態を復元
        if (expandDiv) {
            requestAnimationFrame(() => {
                const wrapper = barsDiv.firstElementChild;
                if (wrapper && wrapper.scrollHeight > 118) {
                    expandDiv.style.display = 'block';
                    if (wasExpanded) {
                        wrapper.style.maxHeight = '300px';
                        wrapper.style.overflowY = 'auto';
                        wrapper.style.transition = cupTransition;
                        wrapper.dataset.expanded = 'true';
                        if (expandIcon) expandIcon.className = 'fas fa-angles-up';
                    } else {
                        wrapper.dataset.expanded = 'false';
                        if (expandIcon) expandIcon.className = 'fas fa-angles-down';
                    }
                } else {
                    expandDiv.style.display = 'none';
                }
            });
        }

        // 結果画面: 勝者のチップを自動表示（最新スロットの該当バーをクリック）
        if (location === 'result' && resultWinnerName) {
            requestAnimationFrame(() => {
                const segments = barsDiv.querySelectorAll('[data-name]');
                for (const seg of segments) {
                    if (seg.dataset.name === resultWinnerName) {
                        seg.click();
                        break;
                    }
                }
            });
        }
    }
}

// 杯グラフの展開/折りたたみ
function toggleCupExpand(location) {
    hideHourlyTip();
    const barsDiv = document.getElementById(location + '-hourly-bars');
    if (!barsDiv || !barsDiv.firstElementChild) return;
    const wrapper = barsDiv.firstElementChild;
    const icon = document.getElementById(location + '-cup-expand-icon');
    const isExpanded = wrapper.dataset.expanded === 'true';

    if (isExpanded) {
        wrapper.style.maxHeight = '114px';
        wrapper.style.overflowY = 'auto';
        wrapper.dataset.expanded = 'false';
        if (icon) icon.className = 'fas fa-angles-down';
    } else {
        wrapper.style.maxHeight = '300px';
        wrapper.style.overflowY = 'auto';
        wrapper.dataset.expanded = 'true';
        if (icon) icon.className = 'fas fa-angles-up';
    }
}

// 杯グラフを読み込み・表示（login / result 両方に対応）
async function loadHourlyGraph(location, defaultTab) {
    const container = document.getElementById(location + '-hourly-graph');
    const barsDiv = document.getElementById(location + '-hourly-bars');
    if (!container || !barsDiv) return;

    // 結果画面はキャッシュクリアして最新データを取得
    if (location === 'result') {
        hourlyWinsCache = null;
        dailyWinsCache = null;
    }

    // 両方のデータを並行フェッチ
    const [hourlyData] = await Promise.all([fetchHourlyWins(), fetchDailyWins()]);
    const hasHourly = hourlyWinsCache && (hourlyWinsCache.teams?.length || hourlyWinsCache.players?.length);
    const hasDaily = dailyWinsCache && (dailyWinsCache.teams?.length || dailyWinsCache.players?.length);

    if (!hasHourly && !hasDaily) {
        container.style.display = 'none';
        return;
    }

    // 初期状態をセット
    currentCupPeriod[location] = 'hourly';
    currentCupCategory[location] = defaultTab || 'team';

    // 期間ボタンの初期active状態
    const hourlyBtn = document.getElementById(location + '-cup-hourly');
    const dailyBtn = document.getElementById(location + '-cup-daily');
    if (hourlyBtn) hourlyBtn.className = 'hourly-tab-btn active';
    if (dailyBtn) dailyBtn.className = 'hourly-tab-btn';

    container.style.display = 'block';
    switchHourlyTab(location, defaultTab || 'team');
}

// 後方互換: loginモーダル用のショートカット
function loadTeamWinGraph() { loadHourlyGraph('login'); }

function updateTeamSelect() {
    const select = document.getElementById('team-select');
    if (!select) return;

    let currentTeams = [];
    if (allTeamsData && allTeamsData.length > 0) {
        currentTeams = allTeamsData;
    } else {
        const teamCounts = {};
        players.forEach(p => {
            if (p.team) teamCounts[p.team] = (teamCounts[p.team] || 0) + 1;
        });
        currentTeams = Object.keys(teamCounts)
            .map(name => ({ name: name, count: teamCounts[name] }))
            .sort((a, b) => b.count - a.count);
    }

    const serialized = JSON.stringify(currentTeams);
    if (serialized === knownTeamsSerialized) return;
    knownTeamsSerialized = serialized;
    knownTeams = currentTeams;

    if (currentTeams.length > 0) {
        select.style.display = 'block';
        const val = select.value;
        select.innerHTML = '<option value="">既存チームから選択</option>';
        currentTeams.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.name;
            opt.textContent = `${t.name} (${t.count}人)`;
            select.appendChild(opt);
        });
        if (currentTeams.some(t => t.name === val)) select.value = val;
    } else {
        select.style.display = 'none';
    }
}

function updateUI(time) {
    let timeStr;
    if (time >= 86400) {
        timeStr = '∞';
    } else {
        const m = Math.floor(time / 60);
        const s = time % 60;
        timeStr = `${m}:${s.toString().padStart(2, '0')}`;
    }
    document.getElementById('timer').textContent = timeStr;
    document.getElementById('pCount').textContent = currentPlayerCount;
    const me = players.find(p => p.id === myId);
    if (me) {
        let scoreText = '';
        if (me.team) {
            let teamTotal = 0;
            players.forEach(p => {
                if (p.state === 'active' && p.team === me.team) {
                    teamTotal += (p.score || 0);
                }
            });
            scoreText = `${formatRawScore(teamTotal)} <span style="font-size:0.7em; color:#fbbf24;">(${formatRawScore(me.score)})</span>`;
        } else {
            scoreText = formatRawScore(me.score);
        }
        const scoreEl = document.getElementById('scoreVal');
        scoreEl.innerHTML = scoreText;
    }
}

// イベントバナー更新
let _eventBannerTimer = null;
function updateEventBanner() {
    const banner = document.getElementById('event-banner');
    if (!banner) return;
    if (_eventBannerTimer) { clearTimeout(_eventBannerTimer); _eventBannerTimer = null; }
    if (highSpeedEvent) {
        banner.style.display = 'block';
        banner.textContent = '\u26a1 \u30d6\u30fc\u30b9\u30c8\u796d\u958b\u50ac\u4e2d \u26a1';
        _eventBannerTimer = setTimeout(() => {
            banner.style.display = 'none';
        }, 10000);
    } else {
        banner.style.display = 'none';
    }
}

// Intl.Segmenterキャッシュ（毎フレーム生成を回避）
const _segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;

// ランク/スコア変動ポップアップ用の状態
let _lbPrevRank = null;
let _lbPrevScore = null;
let _lbScoreAccum = 0;
let _lbRankPopupCD = 0;
let _lbScorePopupCD = 0;

// スコアカウントアップ/ダウンアニメーション
let _lbAnimCurrent = 0;   // 現在表示中のスコア（raw値）
let _lbAnimTarget = 0;    // 目標スコア（raw値）
let _lbAnimInterval = null;

function _lbAnimTick() {
    const diff = _lbAnimTarget - _lbAnimCurrent;
    if (Math.abs(diff) < 0.5) {
        _lbAnimCurrent = _lbAnimTarget;
        clearInterval(_lbAnimInterval);
        _lbAnimInterval = null;
    } else {
        // 0.01%刻みでカウント（raw値に変換）
        const w = (typeof world !== 'undefined' && world && world.width) ? world.width : 3000;
        const h = (typeof world !== 'undefined' && world && world.height) ? world.height : 3000;
        const gs = (typeof gridSize !== 'undefined' && gridSize) ? gridSize : 10;
        const totalCells = (w / gs) * (h / gs);
        const step = totalCells * 0.0001; // 0.01%分のraw値
        if (diff > 0) {
            _lbAnimCurrent = Math.min(_lbAnimCurrent + step, _lbAnimTarget);
        } else {
            _lbAnimCurrent = Math.max(_lbAnimCurrent - step, _lbAnimTarget);
        }
    }
    const myRow = document.getElementById('lb-my-row');
    if (myRow) {
        const scoreEl = myRow.querySelector('.lb-score');
        if (scoreEl) scoreEl.textContent = formatRawScore(_lbAnimCurrent);
    }
}

// ── リーダーボード行入れ替えアニメーション (FLIP) ──
const _lbFlipState = new Map(); // container → { prevOrder, animating, timer }

function captureRowOrder(container) {
    const keys = [];
    container.querySelectorAll('.lb-row[data-key]').forEach(row => {
        keys.push(row.dataset.key);
    });
    return keys;
}

function flipUpdateDom(container, html) {
    const cid = container.id || 'default';
    let st = _lbFlipState.get(cid);
    if (!st) { st = { prevOrder: [], animating: false, timer: null }; _lbFlipState.set(cid, st); }

    const prevOrder = st.prevOrder;

    // アニメーション中はDOMだけ更新してFLIPスキップ
    if (st.animating) {
        container.innerHTML = html;
        st.prevOrder = captureRowOrder(container);
        return;
    }

    // 前回の順序をインデックスマップに変換
    const prevIdx = {};
    prevOrder.forEach((key, i) => { prevIdx[key] = i; });

    // DOM更新
    container.innerHTML = html;
    const newOrder = captureRowOrder(container);
    st.prevOrder = newOrder;

    // 順序が変わったか判定
    let orderChanged = false;
    if (prevOrder.length !== newOrder.length) {
        orderChanged = true;
    } else {
        for (let i = 0; i < newOrder.length; i++) {
            if (newOrder[i] !== prevOrder[i]) { orderChanged = true; break; }
        }
    }
    if (!orderChanged) return;

    // FLIP: インデックス差分 × 行高さで移動量を計算（getBoundingClientRectを避ける）
    const rows = container.querySelectorAll('.lb-row[data-key]');
    if (rows.length === 0) return;
    const rowHeight = rows[0].offsetHeight + 2; // margin-bottom: 2px
    let animated = false;

    rows.forEach((row, newIdx) => {
        const key = row.dataset.key;
        const oldIdx = prevIdx[key];
        if (oldIdx === undefined) return;
        const delta = (oldIdx - newIdx) * rowHeight;
        if (Math.abs(delta) < 1) return;

        animated = true;
        row.style.transition = 'none';
        row.style.transform = `translateY(${delta}px)`;
        row.offsetHeight; // force reflow
        row.style.transition = 'transform 0.18s cubic-bezier(0.4,0,0.2,1)';
        row.style.transform = 'translateY(0)';
    });

    if (animated) {
        st.animating = true;
        if (st.timer) clearTimeout(st.timer);
        st.timer = setTimeout(() => {
            st.animating = false;
            st.timer = null;
            // アニメーション後にtransformを完全クリア
            container.querySelectorAll('.lb-row[data-key]').forEach(row => {
                row.style.transition = '';
                row.style.transform = '';
            });
        }, 200); // 180ms animation + 20ms buffer
    }
}

function resetLbTracking() {
    _lbPrevRank = null;
    _lbPrevScore = null;
    _lbScoreAccum = 0;
    _lbAnimCurrent = 0;
    _lbAnimTarget = 0;
    if (_lbAnimInterval) { clearInterval(_lbAnimInterval); _lbAnimInterval = null; }
}

function showLbPopup(text, color, side, direction) {
    const container = document.getElementById('leaderboard');
    if (!container) return;
    const myRow = document.getElementById('lb-my-row');
    const pos = side === 'left' ? 'left:4px;' : 'right:4px;';
    const moveY = direction === 'down' ? '14px' : '-14px';
    // 自分の行の位置を基準にする
    let verticalPos = 'bottom:-2px;';
    if (myRow) {
        verticalPos = `top:${myRow.offsetTop + myRow.offsetHeight / 2 - 4}px;`;
    }
    const popup = document.createElement('div');
    popup.textContent = text;
    popup.style.cssText = `position:absolute; ${pos} ${verticalPos} color:${color}; font-size:5pt; font-weight:bold; pointer-events:none; opacity:1; z-index:10; text-shadow:0 1px 3px rgba(0,0,0,0.9);`;
    container.appendChild(popup);
    requestAnimationFrame(() => {
        popup.style.transition = 'all 1.5s ease-out';
        popup.style.transform = `translateY(${moveY})`;
        popup.style.opacity = '0';
    });
    setTimeout(() => popup.remove(), 1600);
}

function updateLeaderboard() {
    // players（AOI内）ではなく、playerScores（全体）を使用
    const allPlayersData = Object.entries(playerScores).map(([pid, data]) => ({
        id: Number(pid),
        ...data
    }));

    // チームスコア集計（TEAM表示 & サブリーダーボード両方で使用）
    const teamScores = {};
    const teamColors = {};
    const totalTeamCounts = {};
    allPlayersData.forEach(p => {
        if (p.team) {
            totalTeamCounts[p.team] = (totalTeamCounts[p.team] || 0) + 1;
            if (p.score > 0) {
                if (!teamScores[p.team]) teamScores[p.team] = 0;
                teamScores[p.team] += p.score;
            }
            if (!teamColors[p.team] && p.color) {
                teamColors[p.team] = p.color;
            }
        }
    });

    const allSortedTeams = Object.keys(teamScores).map(team => ({
        name: team, score: teamScores[team]
    })).sort((a, b) => b.score - a.score);

    const isTeamMode = (currentMode === 'TEAM');
    const container = document.getElementById('lb-list');
    const teamContainer = document.getElementById('team-lb-container');
    const teamList = document.getElementById('lb-team-list');

    let html = '';
    let curRank = null;
    let curScore = null;

    if (isTeamMode) {
        // ── チーム戦: メイン欄にトップチームを表示 ──
        const teamLimit = 5;
        const sortedTeams = allSortedTeams.slice(0, teamLimit);

        const me = players.find(p => p.id === myId);
        const myTeam = me ? me.team : null;

        sortedTeams.forEach((t, i) => {
            const rankIcon = (i === 0) ? '👑 ' : '';
            const teamColor = teamColors[t.name] || '#fbbf24';
            const isMine = (myTeam && t.name === myTeam);
            if (isMine) { curRank = i + 1; curScore = t.score; }
            html += `
                <div class="lb-row" data-key="t_${t.name}"${isMine ? ` id="lb-my-row" style="background:rgba(59,130,246,0.2); border-radius:3px; padding:0 2px;"` : ''}>
                    <span class="lb-name" style="font-weight:bold;">
                        <span style="color:#64748b; margin-right:1px;">#${i + 1}</span>
                        <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background-color:${teamColor}; margin-right:4px; vertical-align:middle;"></span>
                        ${rankIcon}${t.name} (${totalTeamCounts[t.name] || 0}人)
                    </span>
                    <span class="lb-score">${formatRawScore(t.score)}</span>
                </div>
            `;
        });

        // 所属チームがランク外の場合
        const myTeamInTop = myTeam && sortedTeams.some(t => t.name === myTeam);
        if (myTeam && !myTeamInTop && sortedTeams.length > 0) {
            const myTeamIdx = allSortedTeams.findIndex(t => t.name === myTeam);
            const myTeamRank = myTeamIdx >= 0 ? myTeamIdx + 1 : allSortedTeams.length + 1;
            const myTeamScore = myTeamIdx >= 0 ? allSortedTeams[myTeamIdx].score : 0;
            curRank = myTeamRank;
            curScore = myTeamScore;

            html += `<div style="border-top:1px solid rgba(255,255,255,0.1); margin-top:2px; padding-top:2px;">`;
            html += `<div id="lb-my-row" class="lb-row" style="background:rgba(59,130,246,0.2); border-radius:3px; padding:0 2px;">`;
            html += `<span class="lb-name" style="color:#94a3b8; font-size:5.5pt; font-weight:bold;">`;
            html += `<span style="color:#64748b;">#${myTeamRank}</span> ${myTeam}`;
            html += `</span>`;
            html += `<span class="lb-score" style="font-size:5.5pt;">${formatRawScore(myTeamScore)}</span>`;
            html += `</div></div>`;
        }

        flipUpdateDom(container, html);
        teamContainer.style.display = 'none';

    } else {
        // ── 個人戦 / DUO: メイン欄に個人ランキング表示 ──
        const limit = (currentMode === 'SOLO') ? 5 : 2;
        const allSorted = allPlayersData.filter(p => p.score > 0).sort((a, b) => b.score - a.score);
        const sorted = allSorted.slice(0, limit);

        sorted.forEach((p, i) => {
            const rankIcon = (i === 0) ? '👑 ' : '';
            let displayName = p.name || '???';
            let graphemes;
            if (_segmenter) {
                graphemes = [..._segmenter.segment(displayName)].map(s => s.segment);
            } else {
                graphemes = Array.from(displayName);
            }
            if (graphemes.length > 10) {
                displayName = graphemes.slice(0, 9).join('') + '…';
            }
            const pColor = p.color || '#000000';
            const isMe = (p.id === myId);
            if (isMe) { curRank = i + 1; curScore = p.score; }

            html += `
                <div class="lb-row" data-key="p_${p.id}"${isMe ? ` id="lb-my-row" style="background:rgba(59,130,246,0.2); border-radius:3px; padding:0 2px;"` : ''}>
                    <span class="lb-name">
                        <span style="color:#64748b; margin-right:1px;">#${i + 1}</span>
                        <span style="display:inline-block; width:14px; height:14px; border-radius:50%; background-color:${pColor}; text-align:center; line-height:14px; margin-right:4px; font-size:10px; vertical-align:middle;">
                            ${p.emoji || ''}
                        </span>
                        ${rankIcon}${displayName}
                    </span>
                    <span class="lb-score">${formatRawScore(p.score)}</span>
                </div>
            `;
        });

        // 自分がトップランカーに入っていない場合
        const myInTop = sorted.some(p => p.id === myId);
        if (!myInTop && myId) {
            const myIdx = allSorted.findIndex(p => p.id === myId);
            const myRank = myIdx >= 0 ? myIdx + 1 : allSorted.length + 1;
            const myScore = myIdx >= 0 ? allSorted[myIdx].score : 0;
            curRank = myRank;
            curScore = myScore;
            const topCount = sorted.length;
            const positionsGap = myRank - topCount;

            if (topCount > 0) {
                html += `<div style="border-top:1px solid rgba(255,255,255,0.1); margin-top:2px; padding-top:2px;">`;
                html += `<div id="lb-my-row" class="lb-row" style="background:rgba(59,130,246,0.2); border-radius:3px; padding:0 2px;">`;
                html += `<span class="lb-name" style="color:#94a3b8; font-size:5.5pt;">`;
                html += `<span style="color:#64748b;">#${myRank}</span> 自分`;
                if (positionsGap > 0) html += ` <span style="color:#64748b;">(あと${positionsGap}位)</span>`;
                html += `</span>`;
                html += `<span class="lb-score" style="font-size:5.5pt;">${formatRawScore(myScore)}</span>`;
                html += `</div></div>`;
            }
        }

        flipUpdateDom(container, html);

        // 個人戦/DUO: サブにチームリーダーボード表示
        const sortedTeams = allSortedTeams.slice(0, 5);
        if (sortedTeams.length > 0) {
            teamContainer.style.display = 'block';
            let tHtml = '';
            sortedTeams.forEach((t, i) => {
                const rankIcon = (i === 0) ? '👑 ' : '';
                const teamColor = teamColors[t.name] || '#fbbf24';
                tHtml += `
                    <div class="lb-row" data-key="st_${t.name}">
                        <span class="lb-name" style="font-weight:bold;">
                            <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background-color:${teamColor}; margin-right:4px; vertical-align:middle;"></span>
                            ${rankIcon}${t.name} (${totalTeamCounts[t.name] || 0}人)
                        </span>
                        <span class="lb-score">${formatRawScore(t.score)}</span>
                    </div>
                `;
            });
            flipUpdateDom(teamList, tHtml);
        } else {
            teamContainer.style.display = 'none';
        }
    }

    // ── ランク/スコア変動ポップアップ ──
    if (curRank !== null && curScore !== null) {
        const now = Date.now();
        // ランク変動 → 左側（上昇=赤↑、下降=青↓）
        if (_lbPrevRank !== null && curRank !== _lbPrevRank && now > _lbRankPopupCD) {
            if (curRank < _lbPrevRank) {
                showLbPopup(`▲${_lbPrevRank - curRank}位`, '#f87171', 'left', 'up');
            } else {
                showLbPopup(`▼${curRank - _lbPrevRank}位`, '#60a5fa', 'left', 'down');
            }
            _lbRankPopupCD = now + 2000;
        }
        // スコア増減 → 右側（増=▲、減=▼）記号のみ表示 + スコアカウントアニメーション
        if (_lbPrevScore !== null) {
            _lbScoreAccum += curScore - _lbPrevScore;
        }
        if (now > _lbScorePopupCD && _lbScoreAccum !== 0) {
            const pct = formatRawScore(Math.abs(_lbScoreAccum));
            if (pct !== '0.00%') {
                const dir = _lbScoreAccum > 0 ? 'up' : 'down';
                showLbPopup(_lbScoreAccum > 0 ? '▲' : '▼', _lbScoreAccum > 0 ? '#f87171' : '#60a5fa', 'right', dir);
            }
            _lbScoreAccum = 0;
            _lbScorePopupCD = now + 3000;
        }
        // スコアカウントアニメーション: 目標値を更新して滑らかにカウント
        if (_lbAnimCurrent === 0 && _lbAnimTarget === 0) {
            // 初回: いきなり表示
            _lbAnimCurrent = curScore;
        }
        // 別カウントが動作中なら即座に完了させてから新カウント開始
        if (_lbAnimInterval && curScore !== _lbAnimTarget) {
            clearInterval(_lbAnimInterval);
            _lbAnimInterval = null;
            _lbAnimCurrent = _lbAnimTarget; // 前回目標にスナップ
        }
        _lbAnimTarget = curScore;
        if (Math.abs(_lbAnimTarget - _lbAnimCurrent) >= 0.5 && !_lbAnimInterval) {
            _lbAnimInterval = setInterval(_lbAnimTick, 40);
        }
        _lbPrevRank = curRank;
        _lbPrevScore = curScore;
    }
}

function addKillFeed(msg) {
    const feed = document.getElementById('kill-feed');
    const item = document.createElement('div');
    item.textContent = msg;
    item.style.opacity = '0';
    item.style.transition = 'opacity 0.5s';
    feed.prepend(item);

    requestAnimationFrame(() => item.style.opacity = '1');

    while (feed.children.length > 2) {
        feed.removeChild(feed.lastElementChild);
    }

    setTimeout(() => {
        if (item.parentNode) {
            item.style.opacity = '0';
            setTimeout(() => { if (item.parentNode) item.remove(); }, 500);
        }
    }, 3000);
}

function drawMinimapOnCanvas(ctx, data, w, h) {
    if (!data || !data.bm) return;
    try {
        const binaryStr = atob(data.bm);
        const compressed = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            compressed[i] = binaryStr.charCodeAt(i);
        }
        const bitmap = pako.inflate(compressed);
        const size = data.sz || 60;
        const palette = data.cp || {};

        const cellW = w / size;
        const cellH = h / size;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const colorIdx = bitmap[y * size + x];
                if (colorIdx > 0 && palette[colorIdx]) {
                    ctx.fillStyle = palette[colorIdx];
                    ctx.fillRect(x * cellW, y * cellH, cellW + 0.5, cellH + 0.5);
                }
            }
        }
    } catch (e) { console.error('Render error:', e); }
}

function showResultScreen(rankings, winner, teamRankings, nextMode, allTeams, totalPlayers, finalMinimap, mapFlags, secondsUntilNext) {
    const modal = document.getElementById('result-modal');
    const tbody = document.getElementById('result-body');
    const title = document.getElementById('result-title');

    const countText = totalPlayers ? ` <span style="font-size:0.8rem; color:#94a3b8;">(参加: ${totalPlayers}人)</span>` : '';

    if (!nextMode) {
        title.innerHTML = "📜 試合詳細" + countText;
        title.style.color = "#fff";
    } else if (winner && winner.id === myId) {
        title.innerHTML = "勝利！" + countText;
        title.style.color = "#fbbf24";
    } else {
        title.innerHTML = "ラウンド終了" + countText;
        title.style.color = "#fff";
    }

    let html = '';

    const rCanvas = document.getElementById('result-map');
    const rCtx = rCanvas.getContext('2d');
    
    // 最終ミニマップを描画
    if (finalMinimap && finalMinimap.bm) {
        drawMinimapOnCanvas(rCtx, finalMinimap, rCanvas.width, rCanvas.height);
    } else if (nextMode) {
        drawResultMapFrame(rCtx, territories, world.width, world.height, mapFlags);
    } else {
        rCtx.fillStyle = '#0f172a';
        rCtx.fillRect(0, 0, rCanvas.width, rCanvas.height);
    }


    if (rankings) {
        const winnerTeam = (teamRankings && teamRankings.length > 0) ? teamRankings[0].name : null;
        rankings.forEach((p, idx) => {
            let rankClass = '';
            if (idx === 0) rankClass = 'rank-1';
            if (idx === 1) rankClass = 'rank-2';
            if (idx === 2) rankClass = 'rank-3';

            const isTeamWinner = (winnerTeam && p.team === winnerTeam);
            const rankIcon = (idx === 0) ? '👑 ' : (isTeamWinner ? '👑 ' : '');

            html += `
                <tr class="${rankClass}">
                    <td>#${idx + 1}</td>
                    <td>
                        <span style="display:inline-block; width:20px; height:20px; border-radius:50%; background-color:${p.color || '#fff'}; text-align:center; line-height:20px; margin-right:5px; font-size:14px; color:#fff; text-shadow:1px 1px 1px #000;">
                            ${p.emoji || ''}
                        </span>
                        ${rankIcon}${p.name}
                    </td>
                    <td style="text-align:center; font-size:0.8rem; color:#f87171;">${p.kills || 0} ⚔️</td>
                    <td>${formatPercent(p.score)}</td>
                </tr>
            `;
        });
    }
    tbody.innerHTML = html;

    const teamArea = document.getElementById('result-team-area');
    const teamBody = document.getElementById('result-team-body');
    if (teamRankings && teamRankings.length > 0) {
        teamArea.style.display = 'block';
        let tHtml = '';
        teamRankings.forEach((t, idx) => {
            let rankClass = '';
            if (idx === 0) rankClass = 'rank-1';
            if (idx === 1) rankClass = 'rank-2';
            if (idx === 2) rankClass = 'rank-3';
            const rankIcon = (idx === 0) ? '👑 ' : '';

            tHtml += `
                <tr class="${rankClass}">
                    <td>#${idx + 1}</td>
                    <td>${rankIcon}[${t.name}] <span style="font-size:0.8em; color:#94a3b8;">(${t.members || 0}人)</span></td>
                    <td style="text-align:center; font-size:0.8rem; color:#f87171;">${t.kills} ⚔️</td>
                    <td>${formatPercent(t.score)}</td>
                </tr>
             `;
        });
        teamBody.innerHTML = tHtml;
    } else {
        teamArea.style.display = 'none';
    }

    const uiContainer = document.getElementById('result-next-mode-ui');
    if (uiContainer) {
        if (!nextMode) {
            uiContainer.style.display = 'none';
            uiContainer.innerHTML = '';
        } else {
            uiContainer.style.display = 'block';
            const isTeam = (nextMode === 'TEAM');
            uiContainer.innerHTML = `
            <div style="margin-top:15px; border-top:1px solid #475569; padding-top:10px; text-align:center;">
               <div style="color:#cbd5e1; font-size:14px;">次の試合は...</div>
               <div style="font-size:24px; font-weight:bold; color:#facc15; text-shadow:0 0 10px rgba(250, 204, 21, 0.5); margin:5px 0;">
                    ${nextMode === 'TEAM' ? '🚩 チーム戦' : (nextMode === 'DUO' ? '🤝 ペア戦' : '🚩 個人戦')}
               </div>
               ${isTeam ? `
               <div style="display:block; margin-top:10px;">
                   <div style="font-size:12px; color:#94a3b8; margin-bottom:5px;">所属チームを選択・入力</div>
                   <div style="display:flex; justify-content:center; gap:5px;">
                       <input type="text" id="result-team-input" placeholder="チーム名" maxlength="3" 
                           value="${localStorage.getItem('playerTeam') || ''}"
                           oninput="updateResultTeam(this.value)"
                           style="background:#1e293b; border:1px solid #475569; padding:5px; color:#fff; width:100px; text-align:center;">
                       <select id="result-team-select" onchange="updateResultTeam(this.value)"
                           style="background:#1e293b; border:1px solid #475569; padding:5px; color:#fff; width:100px;">
                           <option value="">既存チーム</option>
                       </select>
                   </div>
                   <div style="font-size:10px; color:#64748b; margin-top:2px;">※入力後、自動送信されます</div>
               </div>` : ''}
            </div>`;

            const teamsSource = (allTeams && allTeams.length > 0) ? allTeams : knownTeams;

            if (isTeam && teamsSource.length > 0) {
                const sel = document.getElementById('result-team-select');
                if (sel) {
                    sel.innerHTML = '<option value="">既存チーム</option>';
                    teamsSource.forEach(t => {
                        const opt = document.createElement('option');
                        const name = t.name || t;
                        const count = t.count || 0;
                        opt.value = name;
                        opt.textContent = t.name ? `${name} (${count}人)` : name;
                        sel.appendChild(opt);
                    });
                }
            }
        }
    }

    const chatInput = document.getElementById('chat-input');
    const chatBtn = chatInput ? chatInput.nextElementSibling : null;
    if (chatInput) {
        if (hasSentChat && !forceJet) {
            chatInput.disabled = true;
            chatInput.placeholder = "送信済み";
            if (chatBtn) {
                chatBtn.disabled = true;
                chatBtn.style.background = '#475569';
                chatBtn.textContent = '済';
                chatBtn.style.cursor = 'default';
            }
        } else {
            chatInput.disabled = false;
            chatInput.placeholder = "コメント (最大15文字)";
            chatInput.value = '';
            if (chatBtn) {
                chatBtn.disabled = false;
                chatBtn.style.background = '#3b82f6';
                chatBtn.textContent = '送信';
                chatBtn.style.cursor = 'pointer';
            }
        }
    }

    modal.style.display = 'flex';

    // モーダル内スクロールでチップを非表示
    if (!modal._hourlyTipScrollBound) {
        modal.addEventListener('scroll', hideHourlyTip, true);
        modal._hourlyTipScrollBound = true;
    }

    // 時間杯グラフを結果画面にも表示（チーム戦→チームタブ、個人戦→個人タブ）
    const isTeamRound = teamRankings && teamRankings.length > 0;
    // 勝者名を保存（チップ自動表示用）
    resultWinnerName = isTeamRound
        ? (teamRankings[0]?.name || null)
        : (rankings && rankings[0] ? rankings[0].name.replace(/^\[.*?\]\s*/, '') : null);
    loadHourlyGraph('result', isTeamRound ? 'team' : 'player');

    const msgEl = document.getElementById('next-round-msg');
    const countdownEl = document.getElementById('next-round-countdown');
    const countdownTextEl = document.getElementById('next-round-countdown-text');

    if (window.resultTimer) clearInterval(window.resultTimer);

    if (nextMode) {
        // サーバーから受け取った正確な残り時間を使用
        let seconds = secondsUntilNext !== undefined ? secondsUntilNext : 15;
        
        // 画面上部にカウントダウンを表示
        countdownEl.style.display = 'block';
        countdownTextEl.textContent = `${seconds}秒後に次のラウンドへ...`;
        
        // モーダル内のメッセージは非表示
        msgEl.style.display = 'none';

        window.resultTimer = setInterval(() => {
            seconds--;
            if (seconds >= 0) {
                countdownTextEl.textContent = `${seconds}秒後に次のラウンドへ...`;
            } else {
                clearInterval(window.resultTimer);
                countdownEl.style.display = 'none';
            }
        }, 1000);
    } else {
        // 過去の試合の場合はカウントダウンを隠す
        countdownEl.style.display = 'none';
        msgEl.style.display = 'block';
        msgEl.innerHTML = '<button class="action-btn" onclick="document.getElementById(\'result-modal\').style.display=\'none\'" style="margin-top:20px; padding:10px 30px;">閉じる</button>';
    }
}

function showDeathScreen(reason) {
    const el = document.getElementById('deathScreen');
    document.getElementById('deathReason').textContent = reason ? `死因: ${reason}` : '';
    el.style.display = 'block';
    let t = 3;
    document.getElementById('respawnTime').textContent = t;
    const iv = setInterval(() => {
        t--;
        document.getElementById('respawnTime').textContent = t;
        if (t <= 0) {
            clearInterval(iv);
            el.style.display = 'none';
        }
    }, 1000);
}

function hideDeathScreen() {
    document.getElementById('deathScreen').style.display = 'none';
}

// ゴーストペナルティ画面
let _ghostTimerIv = null;
function showGhostScreen(seconds, count) {
    const el = document.getElementById('ghostScreen');
    const n = Math.round(seconds / 10);
    document.getElementById('ghostPenaltyInfo').textContent = `${n}回 × 10秒`;
    el.style.display = 'block';
    let t = seconds;
    document.getElementById('ghostTime').textContent = t;
    if (_ghostTimerIv) clearInterval(_ghostTimerIv);
    _ghostTimerIv = setInterval(() => {
        t--;
        const timeEl = document.getElementById('ghostTime');
        if (timeEl) timeEl.textContent = Math.max(0, t);
        if (t <= 0) {
            clearInterval(_ghostTimerIv);
            _ghostTimerIv = null;
        }
    }, 1000);
}

function hideGhostScreen() {
    const el = document.getElementById('ghostScreen');
    if (el) el.style.display = 'none';
    if (_ghostTimerIv) { clearInterval(_ghostTimerIv); _ghostTimerIv = null; }
}

function updateGhostCountdown(seconds) {
    const timeEl = document.getElementById('ghostTime');
    if (timeEl && document.getElementById('ghostScreen').style.display !== 'none') {
        timeEl.textContent = Math.max(0, seconds);
    }
}

function drawResultMapFrame(ctx, rects, w, h, mapFlags) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!rects || !w) return;

    const s = Math.min(ctx.canvas.width / w, ctx.canvas.height / h);
    const ox = (ctx.canvas.width - w * s) / 2;
    const oy = (ctx.canvas.height - h * s) / 2;

    // 領地を描画
    rects.forEach(r => {
        const drawX = r.x * s + ox;
        const drawY = r.y * s + oy;
        const visW = Math.max(r.w * s, 0.5);
        const visH = Math.max(r.h * s, 0.5);
        ctx.fillStyle = r.color || '#cccccc';
        ctx.fillRect(drawX, drawY, visW, visH);
    });

    // サーバーから受信した国旗位置を描画（クラスタリング計算なし）
    if (mapFlags && mapFlags.length > 0) {
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        mapFlags.forEach(flagData => {
            const centerX = flagData.x * s + ox;
            const centerY = flagData.y * s + oy;
            ctx.fillText(flagData.f, centerX, centerY);
        });
    }
}

function sendChat() {
    if (hasSentChat && !forceJet) {
        return;
    }
    const input = document.getElementById('chat-input');
    const text = input.value;
    if (text.trim().length > 0) {
        socket.send(JSON.stringify({ type: 'chat', text: text }));
        input.value = '';
        if (!forceJet) {
            hasSentChat = true;
            input.disabled = true;
            input.placeholder = "送信済み";
            const btn = input.nextElementSibling;
            if (btn && btn.tagName === 'BUTTON') {
                btn.disabled = true;
                btn.style.background = '#475569';
                btn.style.cursor = 'default';
                btn.textContent = '済';
            }
        }
    }
}

function spawnNicoComment(text, color, name) {
    const layer = document.getElementById('nico-layer');
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.top = (Math.random() * 80) + '%';
    container.style.left = '100%';
    container.style.transition = 'transform 5s linear';
    container.style.pointerEvents = 'none';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'flex-start';

    const msgEl = document.createElement('div');
    msgEl.textContent = text;
    msgEl.style.color = color || '#fff';
    msgEl.style.fontSize = (20 + Math.random() * 20) + 'px';
    msgEl.style.fontWeight = 'bold';
    msgEl.style.whiteSpace = 'nowrap';
    msgEl.style.textShadow = '1px 1px 2px #000, -1px -1px 2px #000';

    container.appendChild(msgEl);

    if (name) {
        const nameEl = document.createElement('div');
        nameEl.textContent = name;
        nameEl.style.color = '#e2e8f0';
        nameEl.style.fontSize = '9pt';
        nameEl.style.marginTop = '-2px';
        nameEl.style.textShadow = '1px 1px 1px #000';
        nameEl.style.whiteSpace = 'nowrap';
        container.appendChild(nameEl);
    }

    layer.appendChild(container);

    requestAnimationFrame(() => {
        const gameContainer = document.getElementById('game-container');
        const containerW = gameContainer ? gameContainer.clientWidth : window.innerWidth;
        container.style.transform = 'translateX(-' + (containerW + container.offsetWidth + 100) + 'px)';
    });

    setTimeout(() => {
        container.remove();
    }, 5000);
}

// ============================================
// チームチャット
// ============================================
let teamChatVisible = false;
let teamChatClosed = true; // 初期はアイコン状態
let teamChatUnread = 0;

function updateTeamChatVisibility() {
    const me = players.find(p => p.id === myId);
    // チームに所属していればactive/dead問わず表示（ラウンド中ずっと残る）
    const inTeam = me && me.team && me.state !== 'waiting';
    const el = document.getElementById('team-chat');
    const badge = document.getElementById('team-chat-badge');
    if (!el) return;

    if (!inTeam) {
        if (teamChatVisible) {
            el.style.display = 'none';
            teamChatVisible = false;
        }
        if (badge) badge.style.display = 'none';
        return;
    }

    // ヘッダーにチーム名表示
    const nameEl = document.getElementById('team-chat-team-name');
    if (nameEl) nameEl.textContent = me.team || '';

    const shouldShow = !teamChatClosed;
    if (shouldShow && !teamChatVisible) {
        el.style.display = 'block';
        teamChatVisible = true;
        teamChatUnread = 0;
        if (badge) badge.style.display = 'none';
    } else if (!shouldShow) {
        // 閉じ状態: パネルを非表示にしてバッジのみ
        if (teamChatVisible) {
            el.style.display = 'none';
            teamChatVisible = false;
        }
    }

    // 閉じている間は常にバッジアイコン表示（未読あればカウントも）
    if (teamChatClosed && badge) {
        badge.style.display = 'flex';
        const countEl = document.getElementById('team-chat-badge-count');
        if (countEl) countEl.style.display = teamChatUnread > 0 ? 'flex' : 'none';
    }
}

function clearTeamChat() {
    teamChatClosed = true; // チーム戦参加時はアイコン状態から開始
    teamChatUnread = 0;
    teamChatVisible = false;
    const el = document.getElementById('team-chat');
    if (el) el.style.display = 'none';
    const badge = document.getElementById('team-chat-badge');
    if (badge) badge.style.display = 'none';
    const msgs = document.getElementById('team-chat-messages');
    if (msgs) msgs.innerHTML = '';
}

function closeTeamChat() {
    teamChatClosed = true;
    teamChatUnread = 0;
    const el = document.getElementById('team-chat');
    if (el) el.style.display = 'none';
    teamChatVisible = false;
    // すぐバッジ表示
    const badge = document.getElementById('team-chat-badge');
    if (badge) badge.style.display = 'flex';
    const countEl = document.getElementById('team-chat-badge-count');
    if (countEl) countEl.style.display = 'none';
}

function openTeamChat() {
    teamChatClosed = false;
    teamChatUnread = 0;
    const badge = document.getElementById('team-chat-badge');
    if (badge) badge.style.display = 'none';
    const el = document.getElementById('team-chat');
    if (el) {
        el.style.display = 'block';
        teamChatVisible = true;
    }
}

function appendTeamChatMessage(text, name, color) {
    const msgs = document.getElementById('team-chat-messages');
    if (!msgs) return;
    // チーム名プレフィックス除去（[XXX] を取る）
    let shortName = (name || '???').replace(/^\[.*?\]\s*/, '');
    const div = document.createElement('div');
    div.style.cssText = 'font-size:12px; line-height:1.2;';
    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = `color:${color || '#93c5fd'}; font-weight:bold; margin-right:3px;`;
    nameSpan.textContent = shortName;
    const textSpan = document.createElement('span');
    textSpan.style.color = '#e2e8f0';
    textSpan.textContent = text;
    div.appendChild(nameSpan);
    div.appendChild(textSpan);
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    while (msgs.children.length > 20) msgs.removeChild(msgs.firstChild);

    if (teamChatClosed) {
        teamChatUnread++;
        const badge = document.getElementById('team-chat-badge');
        const countEl = document.getElementById('team-chat-badge-count');
        if (badge) badge.style.display = 'flex';
        if (countEl) countEl.textContent = teamChatUnread;
    }
}

function sendTeamChat() {
    const input = document.getElementById('team-chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (text.length === 0) return;
    if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'team_chat', text }));
    }
    input.value = '';
}

let currentTeamTab = 'chat';
let teamBattleLog = []; // 戦歴ログ

function switchTeamTab(tab) {
    currentTeamTab = tab;
    const tabs = ['chat', 'team', 'log'];
    tabs.forEach(t => {
        const tabEl = document.getElementById('tc-tab-' + t);
        const panel = document.getElementById('tc-panel-' + t);
        if (tabEl) {
            tabEl.style.color = t === tab ? '#93c5fd' : '#64748b';
            tabEl.style.background = t === tab ? 'rgba(59,130,246,0.15)' : 'transparent';
            tabEl.style.borderBottom = t === tab ? '2px solid #3b82f6' : '2px solid transparent';
        }
        if (panel) panel.style.display = t === tab ? '' : 'none';
    });
    if (tab === 'team') refreshTeamStats();
}

function refreshTeamStats() {
    const statsEl = document.getElementById('tc-team-stats');
    if (!statsEl) return;
    const me = players.find(p => p.id === myId);
    if (!me || !me.team) { statsEl.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:10px;">チーム未所属</div>'; return; }

    const gs = (world && world.gs) || 10;
    const totalCells = ((world && world.width) || 3000) / gs * ((world && world.height) || 3000) / gs;
    const members = [];
    for (const pid in playerScores) {
        const ps = playerScores[pid];
        if (ps.team === me.team) {
            members.push({ name: (ps.name || '???').replace(/^\[.*?\]\s*/, ''), score: ps.score || 0, kills: ps.kills || 0, deaths: ps.deaths || 0 });
        }
    }
    members.sort((a, b) => b.score - a.score);

    let html = '<table style="width:100%;font-size:12px;color:#e2e8f0;border-collapse:collapse;">';
    html += '<tr style="color:#94a3b8;"><th style="text-align:left;padding:1px 2px;">名前</th><th style="width:32px;">占領</th><th style="width:20px;">K</th><th style="width:20px;">D</th></tr>';
    members.forEach(m => {
        const pct = totalCells > 0 ? (m.score / totalCells * 100).toFixed(1) + '%' : '0%';
        html += `<tr><td style="padding:1px 2px;">${m.name}</td><td style="text-align:center;color:#93c5fd;">${pct}</td><td style="text-align:center;">${m.kills}</td><td style="text-align:center;color:#f87171;">${m.deaths}</td></tr>`;
    });
    html += '</table>';
    if (members.length === 0) html = '<div style="color:#64748b;font-size:12px;text-align:center;padding:10px;">メンバーなし</div>';
    statsEl.innerHTML = html;
}

function addTeamBattleLog(msg) {
    teamBattleLog.push(msg);
    if (teamBattleLog.length > 50) teamBattleLog.shift();
    // ログタブが表示中なら即反映
    if (currentTeamTab === 'log') renderBattleLog();
}

function renderBattleLog() {
    const panel = document.getElementById('tc-panel-log');
    if (!panel) return;
    if (teamBattleLog.length === 0) {
        panel.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:10px;">戦歴なし</div>';
        return;
    }
    let html = '';
    for (let i = teamBattleLog.length - 1; i >= 0; i--) {
        html += `<div style="font-size:12px;color:#cbd5e1;padding:1px 0;border-bottom:1px solid rgba(51,65,85,0.5);">${teamBattleLog[i]}</div>`;
    }
    panel.innerHTML = html;
}

function clearTeamBattleLog() {
    teamBattleLog = [];
    const panel = document.getElementById('tc-panel-log');
    if (panel) panel.innerHTML = '';
}

function syncTeamLogs(chatLog, battleLog) {
    // チャット履歴を復元
    const msgs = document.getElementById('team-chat-messages');
    if (msgs) {
        msgs.innerHTML = '';
        chatLog.forEach(entry => {
            const div = document.createElement('div');
            div.style.cssText = 'font-size:12px; line-height:1.2;';
            const nameSpan = document.createElement('span');
            nameSpan.style.cssText = `color:${entry.color || '#93c5fd'}; font-weight:bold; margin-right:3px;`;
            nameSpan.textContent = (entry.name || '???').replace(/^\[.*?\]\s*/, '');
            const textSpan = document.createElement('span');
            textSpan.style.color = '#e2e8f0';
            textSpan.textContent = entry.text;
            div.appendChild(nameSpan);
            div.appendChild(textSpan);
            msgs.appendChild(div);
        });
        msgs.scrollTop = msgs.scrollHeight;
    }
    // 戦歴ログを復元
    teamBattleLog = battleLog.slice();
    renderBattleLog();
}

// チームチャットドラッグ移動
(() => {
    let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
    const getChat = () => document.getElementById('team-chat');
    const getHeader = () => document.getElementById('team-chat-header');

    function onStart(cx, cy) {
        const chat = getChat();
        if (!chat) return;
        dragging = true;
        startX = cx;
        startY = cy;
        const rect = chat.getBoundingClientRect();
        const container = document.getElementById('game-container');
        const cRect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
        origLeft = rect.left - cRect.left;
        origTop = rect.top - cRect.top;
        // absolute positioning に切り替え（right/bottomからleft/topへ）
        chat.style.left = origLeft + 'px';
        chat.style.top = origTop + 'px';
        chat.style.right = 'auto';
        chat.style.bottom = 'auto';
        const header = getHeader();
        if (header) header.style.cursor = 'grabbing';
    }

    function onMove(cx, cy) {
        if (!dragging) return;
        const chat = getChat();
        if (!chat) return;
        const container = document.getElementById('game-container');
        const cRect = container ? container.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        let newLeft = origLeft + (cx - startX);
        let newTop = origTop + (cy - startY);
        // 画面内にクランプ
        newLeft = Math.max(0, Math.min(cRect.width - chat.offsetWidth, newLeft));
        newTop = Math.max(0, Math.min(cRect.height - chat.offsetHeight, newTop));
        chat.style.left = newLeft + 'px';
        chat.style.top = newTop + 'px';
    }

    function onEnd() {
        dragging = false;
        const header = getHeader();
        if (header) header.style.cursor = 'grab';
    }

    document.addEventListener('mousedown', e => {
        const header = getHeader();
        if (header && header.contains(e.target) && e.target.tagName !== 'SPAN') {
            e.preventDefault();
            onStart(e.clientX, e.clientY);
        }
    });
    document.addEventListener('mousemove', e => { if (dragging) { e.preventDefault(); onMove(e.clientX, e.clientY); } });
    document.addEventListener('mouseup', () => onEnd());

    document.addEventListener('touchstart', e => {
        const header = getHeader();
        if (header && header.contains(e.target) && e.target.tagName !== 'SPAN') {
            const t = e.touches[0];
            onStart(t.clientX, t.clientY);
        }
    }, { passive: true });
    document.addEventListener('touchmove', e => {
        if (dragging) { e.preventDefault(); const t = e.touches[0]; onMove(t.clientX, t.clientY); }
    }, { passive: false });
    document.addEventListener('touchend', () => onEnd());
})();

function updateModeDisplay(mode) {
    if (!mode) return;
    currentMode = mode;
    const el = document.getElementById('mode-display');
    const map = { 'SOLO': '🚩 個人戦 (SOLO)', 'DUO': '🤝 ペア戦 (DUO)', 'TEAM': '🚩 チーム戦 (TEAM)' };
    if (el) el.textContent = map[mode] || map['SOLO'];

    const teamInput = document.getElementById('team-input');
    const teamSelect = document.getElementById('team-select');

    if (mode === 'TEAM') {
        // Team mode specific UI updates if any
    }
}

function updateResultTeam(val) {
    const input = document.getElementById('result-team-input');
    const sel = document.getElementById('result-team-select');
    if (input && input.value !== val) input.value = val;
    if (sel && sel.value !== val && val === '') sel.value = '';

    localStorage.setItem('playerTeam', val);
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'update_team', team: val }));
    }
}

// ============================================
// 初期化
// ============================================

window.onload = () => {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);

    const savedName = localStorage.getItem('playerName');
    if (savedName) document.getElementById('username-input').value = savedName;
    const savedTeam = localStorage.getItem('playerTeam');
    if (savedTeam) document.getElementById('team-input').value = savedTeam;
    const savedFlag = localStorage.getItem('playerFlag');
    if (savedFlag) {
        const flagSelect = document.getElementById('flag-select');
        if (flagSelect) flagSelect.value = savedFlag;
    }

    initInput();
    connect();
    requestAnimationFrame(loop);
};

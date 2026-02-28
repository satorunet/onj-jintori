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
        socket.send(JSON.stringify({ type: 'join', name: name, team: team }));
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
    
    if (chars.length >= 2) {
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

// Intl.Segmenterキャッシュ（毎フレーム生成を回避）
const _segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;

function updateLeaderboard() {
    const limit = (currentMode === 'SOLO') ? 5 : 2;

    // players（AOI内）ではなく、playerScores（全体）を使用
    const allPlayersData = Object.entries(playerScores).map(([pid, data]) => ({
        id: Number(pid),
        ...data
    }));

    const sorted = allPlayersData.filter(p => p.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
    const container = document.getElementById('lb-list');

    let html = '';
    sorted.forEach((p, i) => {
        const rankIcon = (i === 0) ? '👑 ' : '';
        let displayName = p.name || '???';
        // 国旗絵文字対応: Intl.Segmenterでグラフェムクラスタ単位に分割
        let graphemes;
        if (_segmenter) {
            graphemes = [..._segmenter.segment(displayName)].map(s => s.segment);
        } else {
            graphemes = Array.from(displayName);
        }
        if (graphemes.length > 10) {
            displayName = graphemes.slice(0, 9).join('') + '…';
        }
        // 色情報はscoreboardDataに含まれているはずだが、無ければ黒
        const pColor = p.color || '#000000';
        
        html += `
            <div class="lb-row">
                <span class="lb-name">
                    <span style="display:inline-block; width:14px; height:14px; border-radius:50%; background-color:${pColor}; text-align:center; line-height:14px; margin-right:4px; font-size:10px; vertical-align:middle;">
                        ${p.emoji || ''}
                    </span>
                    ${rankIcon}${displayName}
                </span>
                <span class="lb-score">${formatRawScore(p.score)}</span>
            </div>
        `;
    });
    container.innerHTML = html;

    const teamScores = {};
    const teamColors = {}; // チームカラー保持用
    const totalTeamCounts = {};
    
    // チームスコアもplayerScoresから計算
    allPlayersData.forEach(p => {
        if (p.team) {
            totalTeamCounts[p.team] = (totalTeamCounts[p.team] || 0) + 1;
            if (p.score > 0) {
                if (!teamScores[p.team]) teamScores[p.team] = 0;
                teamScores[p.team] += p.score;
            }
            // チームカラー取得（最初のプレイヤーの色を使う簡易ロジック）
            if (!teamColors[p.team] && p.color) {
                teamColors[p.team] = p.color;
            }
        }
    });

    const teamContainer = document.getElementById('team-lb-container');
    const teamList = document.getElementById('lb-team-list');

    // チーム別リーダーボード生成（上位5チームまで）
    const sortedTeams = Object.keys(teamScores).map(team => ({
        name: team,
        score: teamScores[team]
    })).sort((a, b) => b.score - a.score).slice(0, 5);

    if (sortedTeams.length > 0) {
        teamContainer.style.display = 'block';
        let tHtml = '';
        sortedTeams.forEach((t, i) => {
            const rankIcon = (i === 0) ? '👑 ' : '';
            const teamColor = teamColors[t.name] || '#fbbf24';
            tHtml += `
                <div class="lb-row">
                    <span class="lb-name" style="font-weight:bold;">
                        <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background-color:${teamColor}; margin-right:4px; vertical-align:middle;"></span>
                        ${rankIcon}${t.name} (${totalTeamCounts[t.name] || 0}人)
                    </span>
                    <span class="lb-score">${formatRawScore(t.score)}</span>
                </div>
            `;
        });
        teamList.innerHTML = tHtml;
    } else {
        teamContainer.style.display = 'none';
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

/**
 * ミニマップ履歴のフレームを描画
 */
function renderMinimapHistoryFrame(index) {
    const history = window.minimapHistoryData;
    if (!history || index < 0 || index >= history.length) return;
    
    const frame = history[index];
    const rCanvas = document.getElementById('result-map');
    const rCtx = rCanvas.getContext('2d');
    const timeDisplay = document.getElementById('history-time-display');
    
    // 時間表示を更新
    const time = frame.time || 0;
    const min = Math.floor(time / 60);
    const sec = time % 60;
    timeDisplay.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
    
    // ミニマップを描画
    drawMinimapOnCanvas(rCtx, frame, rCanvas.width, rCanvas.height);
    
    // 国旗を描画（もしあれば）
    if (frame.flags && frame.flags.length > 0) {
        // フラグの座標はワールド座標なので、ワールドサイズで割ってキャンバス座標に変換
        const worldWidth = world.width || 3000;
        const worldHeight = world.height || 3000;
        
        rCtx.font = '14px sans-serif';
        rCtx.textAlign = 'center';
        rCtx.textBaseline = 'middle';
        
        frame.flags.forEach(flagData => {
            const centerX = (flagData.x / worldWidth) * rCanvas.width;
            const centerY = (flagData.y / worldHeight) * rCanvas.height;
            rCtx.fillText(flagData.f, centerX, centerY);
        });
    }
}

/**
 * ミニマップ履歴再生の再生/一時停止切り替え
 */
function toggleHistoryPlayback() {
    const playBtn = document.getElementById('history-play-btn');
    window.minimapHistoryPlaying = !window.minimapHistoryPlaying;
    playBtn.textContent = window.minimapHistoryPlaying ? '⏸' : '▶';
}

function showResultScreen(rankings, winner, teamRankings, nextMode, allTeams, totalPlayers, historyMinimap, mapFlags, secondsUntilNext, minimapHistory) {
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
    
    // 前回のタイマーをクリア
    if (window.minimapHistoryTimer) {
        clearInterval(window.minimapHistoryTimer);
        window.minimapHistoryTimer = null;
    }
    if (window.replayTimer) clearTimeout(window.replayTimer);
    
    // ミニマップ履歴スライダーコンテナ（HTMLで定義済み）
    const historySliderContainer = document.getElementById('history-slider-container');
    
    // ミニマップ履歴がある場合
    if (minimapHistory && minimapHistory.length > 0) {
        window.minimapHistoryData = minimapHistory;
        window.minimapHistoryIndex = minimapHistory.length - 1;  // 最後から開始
        window.minimapHistoryPlaying = true;
        window.minimapHistoryUserInteracted = false;
        window.minimapHistoryDirection = -1;  // -1: 逆方向から開始
        
        const slider = document.getElementById('history-slider');
        const timeDisplay = document.getElementById('history-time-display');
        const playBtn = document.getElementById('history-play-btn');
        
        slider.max = minimapHistory.length - 1;
        slider.value = minimapHistory.length - 1;  // 最後から開始
        historySliderContainer.style.display = 'block';
        
        // 最後のフレームを描画
        renderMinimapHistoryFrame(minimapHistory.length - 1);
        
        // 軽量モードの場合はスライダーを非表示にしてアニメーションしない
        if (isLowPerformance) {
            window.minimapHistoryPlaying = false;
            historySliderContainer.style.display = 'none';
        } else {
            // スライダーイベント
            slider.oninput = function() {
                window.minimapHistoryUserInteracted = true;
                window.minimapHistoryPlaying = false;
                playBtn.textContent = '▶';
                const idx = parseInt(this.value);
                window.minimapHistoryIndex = idx;
                renderMinimapHistoryFrame(idx);
            };
            
            // 自動再生（400ms間隔で往復再生）
            window.minimapHistoryTimer = setInterval(() => {
                if (!window.minimapHistoryPlaying) return;
                
                // 次のフレームへ
                window.minimapHistoryIndex += window.minimapHistoryDirection;
                
                // 端に達したら方向を反転
                if (window.minimapHistoryIndex >= minimapHistory.length - 1) {
                    window.minimapHistoryIndex = minimapHistory.length - 1;
                    window.minimapHistoryDirection = -1;  // 逆方向へ
                } else if (window.minimapHistoryIndex <= 0) {
                    window.minimapHistoryIndex = 0;
                    window.minimapHistoryDirection = 1;   // 順方向へ
                }
                
                slider.value = window.minimapHistoryIndex;
                renderMinimapHistoryFrame(window.minimapHistoryIndex);
            }, 400);
        }
        
    } else if (nextMode) {
        // 履歴がない場合は最終状態を表示
        historySliderContainer.style.display = 'none';
        drawResultMapFrame(rCtx, territories, world.width, world.height, mapFlags);
    } else if (historyMinimap) {
        historySliderContainer.style.display = 'none';
        drawMinimapOnCanvas(rCtx, historyMinimap, rCanvas.width, rCanvas.height);
    } else {
        historySliderContainer.style.display = 'none';
        rCtx.fillStyle = '#0f172a';
        rCtx.fillRect(0, 0, rCanvas.width, rCanvas.height);
        rCtx.fillStyle = '#64748b';
        rCtx.font = '16px sans-serif';
        rCtx.textAlign = 'center';
        rCtx.textBaseline = 'middle';
        rCtx.fillText('No Map Data', rCanvas.width / 2, rCanvas.height / 2);
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
                    ${nextMode === 'TEAM' ? '🚩 チーム戦' : (nextMode === 'DUO' ? '🤝 ペア戦' : '👑 個人戦')}
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
        if (hasSentChat) {
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
    if (hasSentChat) {
        return;
    }
    const input = document.getElementById('chat-input');
    const text = input.value;
    if (text.trim().length > 0) {
        socket.send(JSON.stringify({ type: 'chat', text: text }));
        input.value = '';
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
    const panel = document.getElementById('tc-panel-team');
    if (!panel) return;
    const me = players.find(p => p.id === myId);
    if (!me || !me.team) { panel.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:10px;">チーム未所属</div>'; return; }

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
    panel.innerHTML = html;
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
    const map = { 'SOLO': '👑 個人戦 (SOLO)', 'DUO': '🤝 ペア戦 (DUO)', 'TEAM': '🚩 チーム戦 (TEAM)' };
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

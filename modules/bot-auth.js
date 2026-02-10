/**
 * modules/bot-auth.js
 * Bot認証システム - 3桁数字画像生成と検証
 */

const { state, dbPool } = require('./config');

// ============================================================
// 3桁の数字画像をBase64で生成（Canvas使用）
// ============================================================
function generateCaptchaImage() {
    // 3桁のランダムな数字を生成
    const code = String(Math.floor(100 + Math.random() * 900)); // 100-999
    
    // SVG形式で画像を生成（Node.jsでCanvasライブラリが不要）
    const width = 120;
    const height = 50;
    
    // ランダムな背景色（淡い色）
    const bgR = 200 + Math.floor(Math.random() * 55);
    const bgG = 200 + Math.floor(Math.random() * 55);
    const bgB = 200 + Math.floor(Math.random() * 55);
    
    // テキスト色（濃い色）
    const textR = Math.floor(Math.random() * 100);
    const textG = Math.floor(Math.random() * 100);
    const textB = Math.floor(Math.random() * 100);
    
    // ノイズライン用の色
    const lines = [];
    for (let i = 0; i < 5; i++) {
        const x1 = Math.random() * width;
        const y1 = Math.random() * height;
        const x2 = Math.random() * width;
        const y2 = Math.random() * height;
        const lineR = Math.floor(Math.random() * 150);
        const lineG = Math.floor(Math.random() * 150);
        const lineB = Math.floor(Math.random() * 150);
        lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgb(${lineR},${lineG},${lineB})" stroke-width="1" opacity="0.3"/>`);
    }
    
    // 各数字の位置をランダムにずらす
    const chars = code.split('');
    const charPositions = chars.map((char, i) => {
        const baseX = 20 + i * 30;
        const offsetX = (Math.random() - 0.5) * 8;
        const offsetY = (Math.random() - 0.5) * 6;
        const rotation = (Math.random() - 0.5) * 20;
        return { char, x: baseX + offsetX, y: 30 + offsetY, rotation };
    });
    
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="rgb(${bgR},${bgG},${bgB})"/>
    ${lines.join('\n    ')}
    ${charPositions.map(({ char, x, y, rotation }) => 
        `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="rgb(${textR},${textG},${textB})" transform="rotate(${rotation} ${x} ${y})">${char}</text>`
    ).join('\n    ')}
</svg>`;
    
    // SVGをBase64エンコード
    const base64 = Buffer.from(svg).toString('base64');
    const dataUrl = `data:image/svg+xml;base64,${base64}`;
    
    return { code, imageData: dataUrl };
}

// ============================================================
// Bot認証が必要かチェック
// ============================================================
function needsBotAuth(ip) {
    if (!ip || ip === 'unknown') return false;
    
    const afkTime = state.afkTimeoutIPs.get(ip);
    if (!afkTime) return false;
    
    const now = Date.now();
    const timeSinceAfk = now - afkTime;
    
    // 5分以内の再接続の場合は認証が必要
    const AUTH_WINDOW = 5 * 60 * 1000; // 5分
    return timeSinceAfk < AUTH_WINDOW;
}

// ============================================================
// 認証チャレンジを生成
// ============================================================
function createChallenge(sessionId) {
    const { code, imageData } = generateCaptchaImage();
    
    console.log(`[BOT-AUTH] Creating challenge for session ${sessionId}, code: "${code}"`);
    
    state.botChallenges.set(sessionId, {
        code,
        timestamp: Date.now()
    });
    
    // 古いチャレンジを削除（10分以上前）
    const now = Date.now();
    const CHALLENGE_TIMEOUT = 10 * 60 * 1000;
    for (const [sid, data] of state.botChallenges.entries()) {
        if (now - data.timestamp > CHALLENGE_TIMEOUT) {
            state.botChallenges.delete(sid);
        }
    }
    
    return imageData;
}

// ============================================================
// 認証を検証
// ============================================================
function verifyChallenge(sessionId, userInput) {
    const challenge = state.botChallenges.get(sessionId);
    
    console.log(`[BOT-AUTH] Verifying challenge for session ${sessionId}`);
    console.log(`[BOT-AUTH] User input: "${userInput}"`);
    console.log(`[BOT-AUTH] Challenge exists:`, !!challenge);
    
    if (!challenge) {
        console.log(`[BOT-AUTH] No challenge found for session ${sessionId}`);
        return { success: false, reason: 'no_challenge' };
    }
    
    console.log(`[BOT-AUTH] Expected code: "${challenge.code}"`);
    
    // タイムアウトチェック（3分）
    const now = Date.now();
    const elapsed = now - challenge.timestamp;
    console.log(`[BOT-AUTH] Time elapsed: ${Math.floor(elapsed / 1000)}s`);
    
    if (elapsed > 3 * 60 * 1000) {
        state.botChallenges.delete(sessionId);
        console.log(`[BOT-AUTH] Challenge timed out for session ${sessionId}`);
        return { success: false, reason: 'timeout' };
    }
    
    // 入力値チェック
    const isCorrect = userInput === challenge.code;
    console.log(`[BOT-AUTH] Code match: ${isCorrect} ("${userInput}" === "${challenge.code}")`);
    
    if (isCorrect) {
        // 成功したらチャレンジを削除
        state.botChallenges.delete(sessionId);
        console.log(`[BOT-AUTH] ✓ Authentication successful for session ${sessionId}`);
        return { success: true };
    } else {
        console.log(`[BOT-AUTH] ✗ Authentication failed for session ${sessionId}`);
        return { success: false, reason: 'incorrect' };
    }
}

// ============================================================
// AFKタイムアウトを記録
// ============================================================
async function recordAfkTimeout(ip, cfCountry = null, cfRay = null) {
    if (!ip || ip === 'unknown') return;
    
    const now = Date.now();
    state.afkTimeoutIPs.set(ip, now);
    
    const cfInfo = cfCountry ? ` [CF: ${cfCountry}, Ray: ${cfRay}]` : '';
    console.log(`[AFK] Recorded timeout for IP: ${ip}${cfInfo}`);
    
    // DBに保存
    if (dbPool) {
        try {
            const conn = await dbPool.getConnection();
            
            // 新しいレコードを挿入
            await conn.execute(
                'INSERT INTO afk_timeouts (ip_address, cf_country, cf_ray, timeout_at) VALUES (?, ?, ?, FROM_UNIXTIME(?))',
                [ip, cfCountry, cfRay, Math.floor(now / 1000)]
            );
            
            // 古いレコードを削除（直近100件のみ保持）
            await conn.execute(`
                DELETE FROM afk_timeouts 
                WHERE id NOT IN (
                    SELECT id FROM (
                        SELECT id FROM afk_timeouts 
                        ORDER BY timeout_at DESC 
                        LIMIT 100
                    ) AS recent
                )
            `);
            
            // 1時間以上前のレコードも削除
            await conn.execute(
                'DELETE FROM afk_timeouts WHERE timeout_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)'
            );
            
            conn.release();
            console.log(`[AFK-DB] Saved timeout record for IP: ${ip}${cfInfo}`);
        } catch (e) {
            console.error('[AFK-DB] Failed to save timeout:', e.message);
        }
    }
    
    // メモリ上の古いレコードを削除（1時間以上前）
    const RECORD_TTL = 60 * 60 * 1000; // 1時間
    for (const [recordIp, timestamp] of state.afkTimeoutIPs.entries()) {
        if (now - timestamp > RECORD_TTL) {
            state.afkTimeoutIPs.delete(recordIp);
        }
    }
}

// ============================================================
// AFKタイムアウト記録をクリア（認証成功時）
// ============================================================
async function clearAfkTimeout(ip) {
    if (!ip || ip === 'unknown') return;
    
    state.afkTimeoutIPs.delete(ip);
    console.log(`[AFK] Cleared timeout record for IP: ${ip}`);
    
    // DBからも削除
    if (dbPool) {
        try {
            const conn = await dbPool.getConnection();
            await conn.execute(
                'DELETE FROM afk_timeouts WHERE ip_address = ?',
                [ip]
            );
            conn.release();
            console.log(`[AFK-DB] Removed timeout record for IP: ${ip}`);
        } catch (e) {
            console.error('[AFK-DB] Failed to remove timeout:', e.message);
        }
    }
}

// ============================================================
// サーバー起動時にDBから読み込み
// ============================================================
async function loadAfkTimeoutsFromDB() {
    if (!dbPool) {
        console.log('[AFK-DB] No database pool, skipping load');
        return;
    }
    
    try {
        const conn = await dbPool.getConnection();
        
        // 過去1時間以内のレコードを読み込み
        const [rows] = await conn.execute(
            'SELECT ip_address, UNIX_TIMESTAMP(timeout_at) as timeout_ts FROM afk_timeouts WHERE timeout_at > DATE_SUB(NOW(), INTERVAL 1 HOUR) ORDER BY timeout_at DESC LIMIT 100'
        );
        
        let loadedCount = 0;
        rows.forEach(row => {
            const ip = row.ip_address;
            const timestamp = row.timeout_ts * 1000; // ミリ秒に変換
            state.afkTimeoutIPs.set(ip, timestamp);
            loadedCount++;
        });
        
        conn.release();
        console.log(`[AFK-DB] Loaded ${loadedCount} timeout records from database`);
    } catch (e) {
        console.error('[AFK-DB] Failed to load timeouts:', e.message);
    }
}

module.exports = {
    needsBotAuth,
    createChallenge,
    verifyChallenge,
    recordAfkTimeout,
    clearAfkTimeout,
    loadAfkTimeoutsFromDB
};

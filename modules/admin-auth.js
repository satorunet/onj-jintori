/**
 * modules/admin-auth.js
 * 管理者認証・セッション管理
 */

const config = require('./config');
const { crypto, fs, ADMIN_ACCOUNTS, ADMIN_CREDENTIALS_FILE, ADMIN_SESSION_TTL } = config;

// セッションストア: Map<sessionId, { username, createdAt }>
const sessions = new Map();

// ブルートフォース対策: Map<ip, { count, lockedUntil }>
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_DURATION = 5 * 60 * 1000; // 5分

/**
 * パスワードをSHA-256でハッシュ化
 */
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * ログイン処理
 * @returns {string|null} 成功時はsessionId、失敗時はnull
 */
function login(username, password, ip) {
    // ブルートフォースチェック
    const attempt = loginAttempts.get(ip);
    if (attempt && attempt.lockedUntil > Date.now()) {
        return null;
    }

    const passwordHash = hashPassword(password);
    const account = ADMIN_ACCOUNTS.find(
        a => a.username === username && a.passwordHash === passwordHash
    );

    if (!account) {
        // 失敗カウント
        const current = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
        current.count++;
        if (current.count >= MAX_ATTEMPTS) {
            current.lockedUntil = Date.now() + LOCK_DURATION;
            current.count = 0;
            console.log(`[ADMIN-AUTH] IP ${ip} locked for 5 minutes (too many failed attempts)`);
        }
        loginAttempts.set(ip, current);
        return null;
    }

    // 成功 → 失敗カウントリセット
    loginAttempts.delete(ip);

    // セッション発行
    const sessionId = crypto.randomBytes(32).toString('hex');
    sessions.set(sessionId, {
        username: account.username,
        createdAt: Date.now()
    });
    console.log(`[ADMIN-AUTH] Login success: ${account.username} from ${ip}`);
    return sessionId;
}

/**
 * セッション検証
 */
function validateSession(sessionId) {
    if (!sessionId) return false;
    const session = sessions.get(sessionId);
    if (!session) return false;
    if (Date.now() - session.createdAt > ADMIN_SESSION_TTL) {
        sessions.delete(sessionId);
        return false;
    }
    return true;
}

/**
 * ログアウト
 */
function logout(sessionId) {
    if (sessionId) {
        sessions.delete(sessionId);
    }
}

/**
 * CookieヘッダーからセッションIDを取得
 */
function getSessionFromCookie(cookieHeader) {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(/(?:^|;\s*)admin_session=([a-f0-9]{64})/);
    return match ? match[1] : null;
}

/**
 * IPがロック中かチェック
 */
function isLocked(ip) {
    const attempt = loginAttempts.get(ip);
    return attempt && attempt.lockedUntil > Date.now();
}

/**
 * セッションからユーザー名を取得
 */
function getUsername(sessionId) {
    if (!sessionId) return null;
    const session = sessions.get(sessionId);
    return session ? session.username : null;
}

/**
 * パスワード変更
 * @returns {{ success: boolean, error?: string }}
 */
function changePassword(sessionId, currentPassword, newPassword) {
    const username = getUsername(sessionId);
    if (!username) return { success: false, error: 'セッションが無効です' };

    // 現在のパスワード検証
    const currentHash = hashPassword(currentPassword);
    const account = ADMIN_ACCOUNTS.find(
        a => a.username === username && a.passwordHash === currentHash
    );
    if (!account) return { success: false, error: '現在のパスワードが正しくありません' };

    // 新しいパスワードのバリデーション
    if (!newPassword || newPassword.length < 4) {
        return { success: false, error: 'パスワードは4文字以上にしてください' };
    }

    // パスワード更新（メモリ上）
    account.passwordHash = hashPassword(newPassword);

    // ファイルに永続化
    try {
        fs.writeFileSync(ADMIN_CREDENTIALS_FILE, JSON.stringify(ADMIN_ACCOUNTS, null, 2), 'utf-8');
        console.log(`[ADMIN-AUTH] Password changed for user: ${username}`);
    } catch (e) {
        console.error('[ADMIN-AUTH] Failed to save credentials file:', e.message);
        return { success: false, error: 'パスワードの保存に失敗しました' };
    }

    return { success: true };
}

/**
 * 期限切れセッションのクリーンアップ
 */
function cleanExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of sessions) {
        if (now - session.createdAt > ADMIN_SESSION_TTL) {
            sessions.delete(id);
        }
    }
    // ロック期限切れもクリーンアップ
    for (const [ip, attempt] of loginAttempts) {
        if (attempt.lockedUntil > 0 && attempt.lockedUntil < now) {
            loginAttempts.delete(ip);
        }
    }
}

// 30分ごとにクリーンアップ
setInterval(cleanExpiredSessions, 30 * 60 * 1000);

module.exports = {
    login,
    validateSession,
    logout,
    getSessionFromCookie,
    isLocked,
    changePassword
};

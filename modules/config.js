/**
 * modules/config.js
 * 共有設定・定数・状態変数
 * 全モジュールから参照される共通基盤
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ============================================================
// MySQL接続設定
// ============================================================
let mysql;
let dbPool;
try {
    mysql = require('mysql2/promise');
    dbPool = mysql.createPool({
        host: 'localhost',
        user: 'root',
        password: '***REMOVED***',
        database: 'jintori',
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0
    });
    console.log('[DB] MySQL connection pool created');
} catch (e) {
    console.log('[DB] MySQL not available, rankings will not be saved:', e.message);
    dbPool = null;
}

// ============================================================
// 起動オプション・モード
// ============================================================
const INNER_DEBUG_MODE = process.argv.includes('inner_debug');
const DEBUG_MODE = process.argv.includes('debug') ||
    process.argv.includes('--debug') ||
    process.argv.includes('mode=debug') ||
    process.env.MODE === 'debug' ||
    INNER_DEBUG_MODE;

const FORCE_TEAM = process.argv.includes('team');
const INFINITE_TIME = process.argv.includes('mugen');
const STATS_MODE = process.argv.includes('toukei');

// ============================================================
// サーバー設定
// ============================================================
const SERVER_VERSION = '5.0.0'; // 2026-01-06 モジュール分割
const PORT = 2053;
const SSL_KEY_PATH = '/var/www/sites/nodejs/ssl/node.open2ch.net/pkey.pem';
const SSL_CERT_PATH = '/var/www/sites/nodejs/ssl/node.open2ch.net/cert.pem';

// 静的ファイル配信用ディレクトリ (server.jsからの相対パスで設定)
const PUBLIC_HTML_DIR = path.join(__dirname, '..', 'public_html');
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.webp': 'image/webp'
};

// ============================================================
// 管理者アカウント設定
// ============================================================
// パスワードハッシュ生成: echo -n 'パスワード' | sha256sum
const ADMIN_CREDENTIALS_FILE = path.join(__dirname, '..', 'admin-credentials.json');
let ADMIN_ACCOUNTS;
try {
    if (fs.existsSync(ADMIN_CREDENTIALS_FILE)) {
        ADMIN_ACCOUNTS = JSON.parse(fs.readFileSync(ADMIN_CREDENTIALS_FILE, 'utf-8'));
        console.log('[CONFIG] Admin credentials loaded from file');
    } else {
        ADMIN_ACCOUNTS = [
            { username: 'admin', passwordHash: '***REMOVED_HASH***' } // default: admin
        ];
    }
} catch (e) {
    console.error('[CONFIG] Failed to load admin credentials file:', e.message);
    ADMIN_ACCOUNTS = [
        { username: 'admin', passwordHash: '***REMOVED_HASH***' } // default: admin
    ];
}
const ADMIN_SESSION_TTL = 24 * 60 * 60 * 1000; // 24時間

// ============================================================
// ゲーム設定・定数
// ============================================================
const GAME_DURATION = (DEBUG_MODE || INFINITE_TIME) ? 999999 : 120; // seconds
const RESPAWN_TIME = 3; // seconds
const PLAYER_SPEED = 130;
const BOOST_SPEED_MULTIPLIER = 1.8;  // ブースト時の速度倍率
const BOOST_DURATION = 2000;         // ブースト持続時間（ミリ秒）
const BOOST_COOLDOWN = 5000;         // ブーストクールダウン（ミリ秒）
const GRID_SIZE = 10;
const AFK_DEATH_LIMIT = 3;
const MINIMAP_SIZE = 30;  // 40→30に削減（帯域節約）

const EMOJIS = ['😀', '😎', '😂', '😍', '🤔', '🤠', '😈', '👻', '👽', '🤖', '💩', '🐱', '🐶', '🦊', '🦁', '🐷', '🦄', '🐲'];
const GAME_MODES = ['SOLO', 'TEAM'];

// チーム固定色（RED/BLUE/GREEN/YELLOWのみ。それ以外のチームは各プレイヤーがランダム色）
const TEAM_COLORS = {
    'RED': '#ef4444',
    'BLUE': '#3b82f6',
    'GREEN': '#22c55e',
    'YELLOW': '#eab308'
};

// ============================================================
// ゲーム状態（可変）- 全モジュールから参照・更新される
// ============================================================
const state = {
    // ワールドサイズ（動的に変更される）
    WORLD_WIDTH: 3000,
    WORLD_HEIGHT: 3000,
    GRID_COLS: Math.ceil(3000 / GRID_SIZE),
    GRID_ROWS: Math.ceil(3000 / GRID_SIZE),

    // プレイヤー管理
    players: {},
    roundParticipants: new Set(),

    // テリトリー管理
    worldGrid: [],
    territoryRects: [],
    territoriesChanged: true,
    territoryVersion: 0,
    pendingTerritoryUpdates: [],
    lastFullSyncVersion: {},
    cachedTerritoryArchive: null,
    territoryArchiveVersion: -1,

    // ラウンド状態
    obstacles: [],
    timeRemaining: GAME_DURATION,
    roundActive: true,
    lastRoundWinner: null,
    lastResultMsg: null,
    currentModeIdx: FORCE_TEAM ? 1 : 0,

    // ミニマップ
    minimapBitmapCache: null,
    minimapColorPalette: {},
    minimapHistory: [],              // ミニマップ履歴（20秒ごとのスナップショット）
    lastMinimapHistoryTime: 0,       // 最後に履歴を保存した時間

    // ID管理
    nextShortId: 1,
    usedShortIds: new Set(),

    // プレイヤー状態キャッシュ（差分検出用）
    lastPlayerStates: {},

    // AFK/Bot認証管理
    afkTimeoutIPs: new Map(),        // Map<IP, timestamp> - AFKタイムアウトしたIPと時刻
    botChallenges: new Map()          // Map<sessionId, {code: string, timestamp: number}> - 認証チャレンジ
};

// ============================================================
// 帯域統計（独立オブジェクト）
// ============================================================
const bandwidthStats = {
    totalBytesSent: 0,
    totalBytesReceived: 0,
    msgsSent: 0,
    msgsReceived: 0,
    // 直近の統計（リセット可能）
    periodBytesSent: 0,
    periodBytesReceived: 0,
    periodMsgsSent: 0,
    periodMsgsReceived: 0,
    periodFullSyncs: 0,
    periodDeltaSyncs: 0,
    // 圧縮率サンプリング
    lastSampleOriginal: 0,
    lastSampleCompressed: 0,
    periodStart: Date.now(),
    // CPU Stats
    lastTickTime: Date.now(),
    cpuUserStart: process.cpuUsage().user,
    cpuSystemStart: process.cpuUsage().system,
    lagSum: 0,
    lagMax: 0,
    ticks: 0,
    // 機能別送信量 (ラウンド単位)
    breakdown: {
        players: 0,
        territoryFull: 0,
        territoryDelta: 0,
        minimap: 0,
        teams: 0,
        base: 0,
        other: 0
    },
    // 受信機能別
    received: {
        input: 0,
        join: 0,
        chat: 0,
        updateTeam: 0,
        other: 0
    }
};

// 帯域統計リセット関数
function resetBandwidthStats() {
    bandwidthStats.periodBytesSent = 0;
    bandwidthStats.periodBytesReceived = 0;
    bandwidthStats.periodMsgsSent = 0;
    bandwidthStats.periodMsgsReceived = 0;
    bandwidthStats.periodFullSyncs = 0;
    bandwidthStats.periodDeltaSyncs = 0;
    bandwidthStats.periodStart = Date.now();
    bandwidthStats.cpuUserStart = process.cpuUsage().user;
    bandwidthStats.cpuSystemStart = process.cpuUsage().system;
    bandwidthStats.lagSum = 0;
    bandwidthStats.lagMax = 0;
    bandwidthStats.ticks = 0;
    bandwidthStats.breakdown = {
        players: 0,
        territoryFull: 0,
        territoryDelta: 0,
        minimap: 0,
        teams: 0,
        base: 0,
        other: 0
    };
    bandwidthStats.received = {
        input: 0,
        join: 0,
        chat: 0,
        updateTeam: 0,
        other: 0
    };
}

// ============================================================
// サーバー情報出力
// ============================================================
console.log(`[SERVER] Version: ${SERVER_VERSION}`);
console.log('[SERVER] STATS_MODE:', STATS_MODE, 'DB Pool:', !!dbPool, 'DEBUG:', DEBUG_MODE);

// ============================================================
// exports
// ============================================================
module.exports = {
    // 依存ライブラリ参照
    fs,
    path,
    os,
    crypto,
    dbPool,

    // 定数
    SERVER_VERSION,
    PORT,
    SSL_KEY_PATH,
    SSL_CERT_PATH,
    PUBLIC_HTML_DIR,
    MIME_TYPES,

    // ゲーム設定
    GAME_DURATION,
    RESPAWN_TIME,
    PLAYER_SPEED,
    BOOST_SPEED_MULTIPLIER,
    BOOST_DURATION,
    BOOST_COOLDOWN,
    GRID_SIZE,
    AFK_DEATH_LIMIT,
    MINIMAP_SIZE,
    EMOJIS,
    GAME_MODES,
    TEAM_COLORS,

    // 管理者設定
    ADMIN_ACCOUNTS,
    ADMIN_CREDENTIALS_FILE,
    ADMIN_SESSION_TTL,

    // モード
    DEBUG_MODE,
    INNER_DEBUG_MODE,
    FORCE_TEAM,
    INFINITE_TIME,
    STATS_MODE,

    // 状態オブジェクト（参照渡し）
    state,
    bandwidthStats,
    resetBandwidthStats,
    
    // DB
    dbPool
};

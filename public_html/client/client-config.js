// ============================================
// client-config.js - 設定・定数・グローバル状態
// ============================================

// Server URL
//const SERVER_URL = 'wss://new-node01.open2ch.net:2087';
const SERVER_URL = 'wss://zin-new.open2ch.net:2053';

// API Base
const API_BASE = 'https://zin-new.open2ch.net:2053';

// Zoom Level
const ZOOM_LEVEL = 0.8;

// Particle Settings
const MAX_PARTICLES = 500;

// Input Settings
const FORCE_SEND_INTERVAL = 1000;
const ANGLE_STOP = 255;
const ANGLE_THRESHOLD = 3;

// Colors
const COLORS = {
    self: '#0ea5e9',
    enemy: '#ef4444',
    obstacle: '#475569',
    grid: 'rgba(255, 255, 255, 0.03)'
};

// ============================================
// グローバル状態変数
// ============================================

let canvas, ctx, width, height;
let socket;
let myId = null;
let world = { width: 2000, height: 2000 };
let camera = { x: 0, y: 0 };
let players = [];
let territories = [];
let territoryMap = new Map();
let territoryVersion = 0;
let obstacles = [];
let isGameReady = false;
let currentMode = 'SOLO';
let currentPlayerCount = 0;

let inputState = { dx: 0, dy: 0, drawing: false };
let touchStartPos = null;
let lastMinimapTime = 0;

// ミニマップビットマップキャッシュ
let minimapBitmapData = null;
let minimapPlayerPositions = [];

// プレイヤーマスタキャッシュ
let playerProfiles = {};
let playerScores = {};
let shortIdMap = {};
let colorCache = {};

// パーティクル
let particles = [];
let fadeOutLines = [];

// チャット
let hasSentChat = false;

// スコア画面の遅延表示（wait状態で受信した場合用）
let pendingResultScreen = null;

// スコア画面期間中フラグ
let isScoreScreenPeriod = false;

// チーム
let knownTeams = [];
let knownTeamsSerialized = '';
let allTeamsData = [];

// 履歴モーダル
let currentHistoryTab = 'teams';
let currentHistoryPeriod = 'today';
let currentRoundFilter = 'latest';

// ソート
let currentSortCol = -1;
let currentSortAsc = false;

// 入力送信
let lastSentAngle = null;
let lastForceSendTime = 0;

// ブースト（加速）
let boostRemainingMs = 0;       // ブースト残り時間（ミリ秒、サーバーから受信）
let boostCooldownSec = 0;       // クールダウン残り秒数
let boostRequested = false;     // 今回の送信でブーストをリクエストするか

// レンダリング
let lastLoopTime = Date.now();

// パフォーマンスモード（'auto', 'high', 'low'）
// auto: FPSに応じて自動切り替え
// high: 高品質（shadowBlur有効、スムーズパス）
// low: 低負荷（shadowBlur無効、シンプルパス）
let performanceMode = 'auto';
let isLowPerformance = false;
let forceLowPerformance = false;  // 人数多い時の強制軽量モード
let fpsHistory = [];
const FPS_THRESHOLD = 35;  // これ以下で低パフォーマンスモードに切り替え
const FPS_SAMPLE_SIZE = 30;
const FORCE_LOW_PERF_PLAYER_COUNT = 10;  // この人数以上で強制軽量モード

// ============================================
// ユーティリティ関数
// ============================================

// パフォーマンスモードに応じたフォントを取得
// 軽量モード: sans-serif（ノーマル）
// 通常モード: Yomogi, cursive（装飾フォント）
function getGameFont(size, bold = false) {
    const weight = bold ? 'bold ' : '';
    if (isLowPerformance) {
        return `${weight}${size}px sans-serif`;
    }
    return `${weight}${size}px Yomogi, cursive`;
}

function getEffectTypeFromColor(hexColor) {
    if (!hexColor) return 'default';

    let r, g, b;
    if (hexColor.startsWith('#')) {
        const hex = hexColor.slice(1);
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
    } else {
        return 'default';
    }

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;

    if (max !== min) {
        const d = max - min;
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }

    const hue = h * 360;
    const saturation = max === 0 ? 0 : (max - min) / max;

    if (saturation < 0.3) return 'default';

    if (hue >= 0 && hue < 30) return 'fire';
    if (hue >= 30 && hue < 70) return 'electric';
    if (hue >= 70 && hue < 160) return 'leaf';
    if (hue >= 160 && hue < 250) return 'water';
    if (hue >= 250 && hue < 290) return 'mystic';
    if (hue >= 290 && hue < 340) return 'heart';
    if (hue >= 340 || hue < 0) return 'fire';

    return 'default';
}

function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
}

function normalizeTerritory(t) {
    return {
        ownerId: t.o || t.ownerId,
        color: t.c || t.color,
        x: t.x,
        y: t.y,
        w: t.w,
        h: t.h,
        points: t.points || [
            { x: t.x, y: t.y },
            { x: t.x + t.w, y: t.y },
            { x: t.x + t.w, y: t.y + t.h },
            { x: t.x, y: t.y + t.h }
        ]
    };
}

function rebuildTerritoryMap() {
    territoryMap.clear();
    territories.forEach((t, idx) => {
        const key = `${t.x},${t.y}`;
        territoryMap.set(key, idx);
    });
}

function applyTerritoryDelta(delta) {
    if (delta.r && delta.r.length > 0) {
        delta.r.forEach(rem => {
            const key = `${rem.x},${rem.y}`;
            const idx = territoryMap.get(key);
            if (idx !== undefined) {
                territories[idx] = null;
                territoryMap.delete(key);
            }
        });
    }

    if (delta.a && delta.a.length > 0) {
        delta.a.forEach(add => {
            const normalized = normalizeTerritory(add);
            const key = `${normalized.x},${normalized.y}`;
            const existingIdx = territoryMap.get(key);
            if (existingIdx !== undefined && territories[existingIdx] !== null) {
                territories[existingIdx] = normalized;
            } else {
                territories.push(normalized);
            }
        });
    }

    territories = territories.filter(t => t !== null);
    rebuildTerritoryMap();
}

function updateCamera() {
    if (!myId) return;
    const me = players.find(p => p.id === myId);
    if (me) {
        camera.x = me.x - (width / ZOOM_LEVEL) / 2;
        camera.y = me.y - (height / ZOOM_LEVEL) / 2;
    }
}

function formatRawScore(score) {
    if (!score) return '0.00%';
    const w = (typeof world !== 'undefined' && world && world.width) ? world.width : 3000;
    const h = (typeof world !== 'undefined' && world && world.height) ? world.height : 3000;
    const totalCells = (w / 10) * (h / 10);
    let pct = (score / totalCells) * 100;
    if (pct > 100) pct = 100;
    return pct.toFixed(2) + '%';
}

function formatPercent(score) {
    if (!score) return '0.00%';
    return Number(score).toFixed(2) + '%';
}

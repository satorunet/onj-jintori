/**
 * modules/bench-monitor.js
 * パフォーマンス計測モジュール
 *
 * ゲームループとブロードキャストの処理時間を計測し、
 * コンソール出力＋負荷テストクライアントへの送信を行う。
 *
 * Usage: node server.v5.js bench
 */

const BENCH_ENABLED = process.argv.includes('bench');

// 計測バッファ（直近N回分のtick時間を保持）
const BUFFER_SIZE = 200;

const gameLoopTimes = new Float64Array(BUFFER_SIZE);
let gameLoopIdx = 0;
let gameLoopCount = 0;
let gameLoopMax = 0;
let gameLoopOverruns = 0;  // 50ms超え回数

const broadcastTimes = new Float64Array(BUFFER_SIZE);
let broadcastIdx = 0;
let broadcastCount = 0;
let broadcastMax = 0;
let broadcastOverruns = 0;  // 150ms超え回数

// ゲームループ内の個別処理計測
const breakdown = {
    playerUpdate: { sum: 0, count: 0, max: 0 },
    collision: { sum: 0, count: 0, max: 0 },
    capture: { sum: 0, count: 0, max: 0 },
};

// ブロードキャスト内の処理計測
const broadcastBreakdown = {
    aoiFilter: { sum: 0, count: 0, max: 0 },
    msgpackEncode: { sum: 0, count: 0, max: 0 },
    wsSend: { sum: 0, count: 0, max: 0 },
    territoryBinary: { sum: 0, count: 0, max: 0 },
    minimap: { sum: 0, count: 0, max: 0 },
};

let lastReportTime = Date.now();

// ============================================================
// 計測API
// ============================================================

/**
 * ゲームループの1 tick 処理時間を記録
 */
function recordGameLoopTick(durationMs) {
    if (!BENCH_ENABLED) return;
    gameLoopTimes[gameLoopIdx % BUFFER_SIZE] = durationMs;
    gameLoopIdx++;
    gameLoopCount++;
    if (durationMs > gameLoopMax) gameLoopMax = durationMs;
    if (durationMs > 50) gameLoopOverruns++;
}

/**
 * ブロードキャストの1回の処理時間を記録
 */
function recordBroadcastTick(durationMs) {
    if (!BENCH_ENABLED) return;
    broadcastTimes[broadcastIdx % BUFFER_SIZE] = durationMs;
    broadcastIdx++;
    broadcastCount++;
    if (durationMs > broadcastMax) broadcastMax = durationMs;
    if (durationMs > 50) broadcastOverruns++;
}

/**
 * 個別処理の計測記録
 */
function recordBreakdown(category, durationMs) {
    if (!BENCH_ENABLED) return;
    const b = breakdown[category];
    if (!b) return;
    b.sum += durationMs;
    b.count++;
    if (durationMs > b.max) b.max = durationMs;
}

function recordBroadcastBreakdown(category, durationMs) {
    if (!BENCH_ENABLED) return;
    const b = broadcastBreakdown[category];
    if (!b) return;
    b.sum += durationMs;
    b.count++;
    if (durationMs > b.max) b.max = durationMs;
}

/**
 * hr精度のタイマー開始
 */
function startTimer() {
    if (!BENCH_ENABLED) return 0;
    return performance.now();
}

/**
 * タイマー終了→経過ms
 */
function endTimer(start) {
    if (!BENCH_ENABLED) return 0;
    return performance.now() - start;
}

// ============================================================
// 集計・レポート
// ============================================================

function getStats() {
    const calcAvg = (arr, count) => {
        const n = Math.min(count, BUFFER_SIZE);
        if (n === 0) return 0;
        let sum = 0;
        for (let i = 0; i < n; i++) sum += arr[i];
        return sum / n;
    };

    const calcP95 = (arr, count) => {
        const n = Math.min(count, BUFFER_SIZE);
        if (n === 0) return 0;
        const sorted = Array.from(arr.subarray(0, n)).sort((a, b) => a - b);
        return sorted[Math.floor(n * 0.95)];
    };

    const calcP99 = (arr, count) => {
        const n = Math.min(count, BUFFER_SIZE);
        if (n === 0) return 0;
        const sorted = Array.from(arr.subarray(0, n)).sort((a, b) => a - b);
        return sorted[Math.floor(n * 0.99)];
    };

    const mem = process.memoryUsage();

    return {
        gameLoop: {
            avg: calcAvg(gameLoopTimes, gameLoopCount),
            max: gameLoopMax,
            p95: calcP95(gameLoopTimes, gameLoopCount),
            p99: calcP99(gameLoopTimes, gameLoopCount),
            tickOverruns: gameLoopOverruns,
            totalTicks: gameLoopCount,
        },
        broadcast: {
            avg: calcAvg(broadcastTimes, broadcastCount),
            max: broadcastMax,
            p95: calcP95(broadcastTimes, broadcastCount),
            p99: calcP99(broadcastTimes, broadcastCount),
            tickOverruns: broadcastOverruns,
            totalTicks: broadcastCount,
        },
        breakdown: Object.fromEntries(
            Object.entries(breakdown).map(([k, v]) => [k, {
                avg: v.count > 0 ? v.sum / v.count : 0,
                max: v.max,
                count: v.count
            }])
        ),
        broadcastBreakdown: Object.fromEntries(
            Object.entries(broadcastBreakdown).map(([k, v]) => [k, {
                avg: v.count > 0 ? v.sum / v.count : 0,
                max: v.max,
                count: v.count
            }])
        ),
        memory: {
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            external: mem.external,
        },
    };
}

/**
 * コンソールに定期レポートを出力（10秒ごと）
 */
function printReport(playerCount) {
    if (!BENCH_ENABLED) return;

    const now = Date.now();
    if (now - lastReportTime < 10000) return;
    lastReportTime = now;

    const s = getStats();
    const mem = process.memoryUsage();

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`[BENCH] プレイヤー数: ${playerCount}`);
    console.log(`${'─'.repeat(70)}`);
    console.log(`  ゲームループ (50ms target):`);
    console.log(`    avg: ${s.gameLoop.avg.toFixed(3)}ms  p95: ${s.gameLoop.p95.toFixed(3)}ms  p99: ${s.gameLoop.p99.toFixed(3)}ms  max: ${s.gameLoop.max.toFixed(3)}ms`);
    console.log(`    超過(>50ms): ${s.gameLoop.tickOverruns}/${s.gameLoop.totalTicks} ticks`);

    if (Object.values(breakdown).some(v => v.count > 0)) {
        console.log(`    内訳:`);
        Object.entries(s.breakdown).forEach(([k, v]) => {
            if (v.count > 0) {
                console.log(`      ${k.padEnd(15)} avg: ${v.avg.toFixed(3)}ms  max: ${v.max.toFixed(3)}ms`);
            }
        });
    }

    console.log(`  ブロードキャスト (150ms target):`);
    console.log(`    avg: ${s.broadcast.avg.toFixed(3)}ms  p95: ${s.broadcast.p95.toFixed(3)}ms  p99: ${s.broadcast.p99.toFixed(3)}ms  max: ${s.broadcast.max.toFixed(3)}ms`);
    console.log(`    超過(>150ms): ${s.broadcast.tickOverruns}/${s.broadcast.totalTicks} ticks`);

    if (Object.values(broadcastBreakdown).some(v => v.count > 0)) {
        console.log(`    内訳:`);
        Object.entries(s.broadcastBreakdown).forEach(([k, v]) => {
            if (v.count > 0) {
                console.log(`      ${k.padEnd(15)} avg: ${v.avg.toFixed(3)}ms  max: ${v.max.toFixed(3)}ms`);
            }
        });
    }

    console.log(`  メモリ:`);
    console.log(`    RSS: ${(mem.rss / 1024 / 1024).toFixed(1)}MB  Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}/${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB  External: ${(mem.external / 1024 / 1024).toFixed(1)}MB`);
    console.log('');
}

/**
 * 計測値をリセット
 */
function reset() {
    gameLoopIdx = 0;
    gameLoopCount = 0;
    gameLoopMax = 0;
    gameLoopOverruns = 0;
    broadcastIdx = 0;
    broadcastCount = 0;
    broadcastMax = 0;
    broadcastOverruns = 0;
    Object.values(breakdown).forEach(b => { b.sum = 0; b.count = 0; b.max = 0; });
    Object.values(broadcastBreakdown).forEach(b => { b.sum = 0; b.count = 0; b.max = 0; });
}

module.exports = {
    BENCH_ENABLED,
    recordGameLoopTick,
    recordBroadcastTick,
    recordBreakdown,
    recordBroadcastBreakdown,
    startTimer,
    endTimer,
    getStats,
    printReport,
    reset,
};

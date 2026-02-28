#!/usr/bin/env node
/**
 * load-test.js - 負荷テストスクリプト
 *
 * 偽プレイヤーを大量接続してサーバーの限界を測定する。
 * サーバー側に bench-monitor モジュールが有効であれば、
 * ゲームループ・ブロードキャストの処理時間も表示される。
 *
 * Usage:
 *   node bench/load-test.js [options]
 *
 * Options:
 *   --host=HOST       接続先 (default: wss://localhost:2053)
 *   --players=N       接続プレイヤー数 (default: 10)
 *   --ramp=MS         プレイヤー追加間隔 (default: 200ms)
 *   --duration=SEC    テスト時間 (default: 60)
 *   --move-interval=MS  方向変更間隔 (default: 500)
 *   --no-tls          TLS検証を無効化 (自己署名証明書用)
 */

const WebSocket = require('ws');

// ============================================================
// 引数パース
// ============================================================
const args = {};
process.argv.slice(2).forEach(arg => {
    const [key, val] = arg.replace(/^--/, '').split('=');
    args[key] = val === undefined ? true : val;
});

const HOST = args.host || 'wss://localhost:2053';
const TARGET_PLAYERS = parseInt(args.players) || 10;
const RAMP_INTERVAL = parseInt(args.ramp) || 200;
const DURATION = parseInt(args.duration) || 60;
const MOVE_INTERVAL = parseInt(args['move-interval']) || 500;
const NO_TLS = args['no-tls'] || HOST.startsWith('wss://localhost');

// ============================================================
// 統計
// ============================================================
const stats = {
    connected: 0,
    joined: 0,
    disconnected: 0,
    errors: 0,
    messagesReceived: 0,
    bytesReceived: 0,
    messagesSent: 0,
    bytesSent: 0,
    // レイテンシ計測
    latencies: [],       // 直近100件
    // サーバーからのベンチマーク情報
    serverBench: null,
};

const players = [];
let startTime = Date.now();

// ============================================================
// プレイヤー作成
// ============================================================
function createPlayer(index) {
    const wsOptions = {};
    if (NO_TLS) {
        wsOptions.rejectUnauthorized = false;
    }

    const ws = new WebSocket(HOST, wsOptions);
    const player = {
        index,
        ws,
        id: null,
        state: 'connecting',
        moveTimer: null,
        joinTime: null,
    };

    ws.on('open', () => {
        stats.connected++;
        player.state = 'connected';
    });

    ws.on('message', (data) => {
        const byteLen = data.length || Buffer.byteLength(data, 'utf8');
        stats.messagesReceived++;
        stats.bytesReceived += byteLen;

        // JSON解析を試みる（init等はJSON、ゲーム状態はmsgpackバイナリ）
        let msg;
        try {
            const str = Buffer.isBuffer(data) ? data.toString('utf8') : data;
            msg = JSON.parse(str);
        } catch (e) {
            // msgpackバイナリ（ゲーム状態更新）→ スキップ
            return;
        }

        try {

            if (msg.type === 'init') {
                player.id = msg.id;
                player.state = 'initialized';

                // viewport送信
                ws.send(JSON.stringify({ type: 'viewport', w: 375, h: 667 }));

                // join送信
                setTimeout(() => {
                    const name = `Bot${index}`;
                    ws.send(JSON.stringify({ type: 'join', name, team: '', emoji: '🤖' }));
                    player.joinTime = Date.now();
                    stats.joined++;
                    player.state = 'playing';

                    // 定期的に方向変更
                    player.moveTimer = setInterval(() => {
                        if (ws.readyState !== WebSocket.OPEN) return;
                        // 1バイトバイナリ移動コマンド
                        const angleByte = Math.floor(Math.random() * 254);
                        const buf = Buffer.alloc(1);
                        buf.writeUInt8(angleByte, 0);
                        ws.send(buf);
                        stats.messagesSent++;
                        stats.bytesSent += 1;
                    }, MOVE_INTERVAL);
                }, 100);
            }

            if (msg.type === 'bench_stats') {
                stats.serverBench = msg;
            }
        } catch (e) {
            // メッセージ処理エラー
        }
    });

    ws.on('error', (err) => {
        stats.errors++;
        if (player.state === 'connecting') {
            console.error(`[ERROR] Player ${index}: ${err.message}`);
        }
    });

    ws.on('close', (code, reason) => {
        stats.connected--;
        stats.disconnected++;
        player.state = 'disconnected';
        if (player.moveTimer) clearInterval(player.moveTimer);

        if (code === 4010) {
            // Screen size too large — 無視
        } else if (code !== 1000 && code !== 1001) {
            console.log(`[CLOSE] Player ${index}: code=${code} reason=${reason}`);
        }
    });

    players.push(player);
    return player;
}

// ============================================================
// レポート表示
// ============================================================
function printReport() {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const activePlayers = players.filter(p => p.state === 'playing').length;
    const recvRate = (stats.bytesReceived / (Date.now() - startTime) * 1000 / 1024).toFixed(1);
    const sendRate = (stats.bytesSent / (Date.now() - startTime) * 1000 / 1024).toFixed(1);

    console.log(`\n${'='.repeat(70)}`);
    console.log(`[${elapsed}s] 負荷テスト状況`);
    console.log(`${'='.repeat(70)}`);
    console.log(`  接続中: ${stats.connected}  アクティブ: ${activePlayers}  切断: ${stats.disconnected}  エラー: ${stats.errors}`);
    console.log(`  受信: ${stats.messagesReceived} msgs (${(stats.bytesReceived / 1024).toFixed(1)} KB, ${recvRate} KB/s)`);
    console.log(`  送信: ${stats.messagesSent} msgs (${(stats.bytesSent / 1024).toFixed(1)} KB, ${sendRate} KB/s)`);

    if (stats.serverBench) {
        const b = stats.serverBench;
        console.log(`\n  --- サーバー側計測値 ---`);
        console.log(`  ゲームループ: avg=${b.gameLoop?.avg?.toFixed(2)}ms  max=${b.gameLoop?.max?.toFixed(2)}ms  (target: 50ms)`);
        console.log(`  ブロードキャスト: avg=${b.broadcast?.avg?.toFixed(2)}ms  max=${b.broadcast?.max?.toFixed(2)}ms  (target: 150ms)`);
        console.log(`  メモリ: RSS=${(b.memory?.rss / 1024 / 1024).toFixed(1)}MB  Heap=${(b.memory?.heapUsed / 1024 / 1024).toFixed(1)}MB`);
        if (b.gameLoop?.tickOverruns > 0) {
            console.log(`  ⚠ tick超過: ${b.gameLoop.tickOverruns}回 (50ms超え)`);
        }
        if (b.broadcast?.tickOverruns > 0) {
            console.log(`  ⚠ broadcast超過: ${b.broadcast.tickOverruns}回 (150ms超え)`);
        }
    }
    console.log('');
}

// ============================================================
// メイン実行
// ============================================================
console.log(`\n負荷テスト開始`);
console.log(`  接続先: ${HOST}`);
console.log(`  目標プレイヤー数: ${TARGET_PLAYERS}`);
console.log(`  追加間隔: ${RAMP_INTERVAL}ms`);
console.log(`  テスト時間: ${DURATION}s`);
console.log(`  移動間隔: ${MOVE_INTERVAL}ms`);
console.log('');

// プレイヤーを段階的に追加
let playerIndex = 0;
const rampTimer = setInterval(() => {
    if (playerIndex >= TARGET_PLAYERS) {
        clearInterval(rampTimer);
        console.log(`[INFO] 全 ${TARGET_PLAYERS} プレイヤーの接続完了`);
        return;
    }
    createPlayer(playerIndex);
    playerIndex++;
}, RAMP_INTERVAL);

// 定期レポート（5秒ごと）
const reportTimer = setInterval(printReport, 5000);

// テスト終了
setTimeout(() => {
    clearInterval(rampTimer);
    clearInterval(reportTimer);

    printReport();
    console.log('\n[END] テスト終了。接続を切断中...');

    players.forEach(p => {
        if (p.moveTimer) clearInterval(p.moveTimer);
        if (p.ws.readyState === WebSocket.OPEN) p.ws.close(1000);
    });

    setTimeout(() => process.exit(0), 2000);
}, DURATION * 1000);

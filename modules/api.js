/**
 * modules/api.js
 * HTTP APIハンドラ・静的ファイル配信
 */

const config = require('./config');
const { fs, path, os, dbPool, PUBLIC_HTML_DIR, MIME_TYPES, GAME_MODES, state, bandwidthStats } = config;

/**
 * CORS設定を適用
 */
function setCorsHeaders(req, res) {
    const origin = req.headers.origin || '';
    // Allow: null (file://), open2ch.net subdomains (with/without port), localhost, 127.0.0.1
    if (origin === 'null' || origin.includes('.open2ch.net') || origin === 'https://open2ch.net' || origin.includes('localhost') || origin.includes('127.0.0.1')) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}

/**
 * HTTP APIハンドラ (メイン)
 */
async function handleHttpRequest(req, res) {
    // CORS設定
    setCorsHeaders(req, res);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const urlPath = url.pathname;

    try {
        // ========================================
        // API: 最近のラウンド一覧
        // ========================================
        if (urlPath === '/api/rounds') {
            if (!dbPool) {
                res.writeHead(503);
                res.end(JSON.stringify({ error: 'Database not available' }));
                return;
            }

            const hours = parseInt(url.searchParams.get('hours')) || 0;
            const limitParam = url.searchParams.get('limit');
            let limit = 50;
            if (limitParam) {
                limit = parseInt(limitParam);
            } else if (hours > 0) {
                limit = 0;
            }

            let conn;
            try {
                conn = await dbPool.getConnection();
                let query = `
                SELECT r.id, r.mode, r.played_at, r.player_count,
                    CASE 
                        WHEN r.mode = 'TEAM' THEN (SELECT team_name FROM team_rankings WHERE round_id = r.id AND rank_position = 1 LIMIT 1)
                        ELSE (SELECT player_name FROM player_rankings WHERE round_id = r.id AND rank_position = 1 LIMIT 1)
                    END as winner,
                    CASE 
                        WHEN r.mode = 'TEAM' THEN (SELECT score FROM team_rankings WHERE round_id = r.id AND rank_position = 1 LIMIT 1)
                        ELSE (SELECT score FROM player_rankings WHERE round_id = r.id AND rank_position = 1 LIMIT 1)
                    END as winner_score
                FROM rounds r
            `;
                const params = [];
                if (hours > 0) {
                    query += ` WHERE r.played_at >= DATE_SUB(NOW(), INTERVAL ? HOUR) `;
                    params.push(hours);
                }
                query += ` ORDER BY r.played_at DESC `;
                if (limit > 0) {
                    query += ` LIMIT ${parseInt(limit)} `;
                }
                const [rows] = await conn.execute(query, params);
                res.writeHead(200);
                res.end(JSON.stringify(rows));
            } catch (err) {
                console.error('[API] /api/rounds error:', err);
                res.writeHead(500);
                res.end(JSON.stringify({ error: err.message }));
            } finally {
                if (conn) conn.release();
            }
            return;
        }

        // ========================================
        // API: 特定ラウンドの詳細ランキング
        // ========================================
        if (urlPath.startsWith('/api/round/')) {
            const roundId = parseInt(urlPath.split('/')[3]);
            if (!dbPool || isNaN(roundId)) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid request' }));
                return;
            }
            let conn;
            try {
                conn = await dbPool.getConnection();
                const [players] = await conn.execute(
                    'SELECT rank_position, player_name, team, emoji, score, kills FROM player_rankings WHERE round_id = ? ORDER BY rank_position',
                    [roundId]
                );
                const [teams] = await conn.execute(
                    'SELECT rank_position, team_name, score, kills FROM team_rankings WHERE round_id = ? ORDER BY rank_position',
                    [roundId]
                );
                const [maps] = await conn.execute(
                    'SELECT minimap_data FROM round_minimaps WHERE round_id = ?',
                    [roundId]
                );
                let minimap = null;
                if (maps.length > 0 && maps[0].minimap_data) {
                    try {
                        const raw = maps[0].minimap_data;
                        const str = raw.toString();
                        minimap = JSON.parse(str);
                    } catch (e) { console.error('Minimap parse error:', e); }
                }
                res.writeHead(200);
                res.end(JSON.stringify({ players, teams, minimap }));
            } catch (err) {
                console.error('[API] /api/round/:id error:', err);
                res.writeHead(500);
                res.end(JSON.stringify({ error: err.message }));
            } finally {
                if (conn) conn.release();
            }
            return;
        }

        // ========================================
        // API: プレイヤー累計統計
        // ========================================
        if (urlPath === '/api/player-stats') {
            if (!dbPool) {
                res.writeHead(503);
                res.end(JSON.stringify({ error: 'Database not available' }));
                return;
            }
            const sort = url.searchParams.get('sort');
            const period = url.searchParams.get('period') || 'today';
            const orderBy = sort === 'best' ? 'best_score DESC' : 'total_score DESC';
            const whereClause = period === 'today' ? 'WHERE created_at >= CURDATE()' : '';

            let conn;
            try {
                conn = await dbPool.getConnection();
                const [rows] = await conn.execute(`
                SELECT player_name, COUNT(*) as total_games,
                    SUM(CASE WHEN rank_position = 1 THEN 1 ELSE 0 END) as wins,
                    SUM(score) as total_score, SUM(kills) as total_kills,
                    ROUND(AVG(score)) as avg_score, MAX(score) as best_score
                FROM player_rankings ${whereClause} GROUP BY player_name ORDER BY ${orderBy} LIMIT 50
            `);
                res.writeHead(200);
                res.end(JSON.stringify(rows));
            } catch (err) {
                console.error('[API] /api/player-stats error:', err);
                res.writeHead(500);
                res.end(JSON.stringify({ error: err.message }));
            } finally {
                if (conn) conn.release();
            }
            return;
        }

        // ========================================
        // API: チーム累計統計
        // ========================================
        if (urlPath === '/api/team-stats') {
            if (!dbPool) {
                res.writeHead(503);
                res.end(JSON.stringify({ error: 'Database not available' }));
                return;
            }
            const sort = url.searchParams.get('sort');
            const period = url.searchParams.get('period') || 'today';
            const orderBy = sort === 'best' ? 'best_score DESC' : 'total_score DESC';
            const whereClause = period === 'today' ? 'WHERE created_at >= CURDATE()' : '';

            let conn;
            try {
                conn = await dbPool.getConnection();
                const [rows] = await conn.execute(`
                SELECT team_name, COUNT(*) as total_games,
                    SUM(CASE WHEN rank_position = 1 THEN 1 ELSE 0 END) as wins,
                    SUM(score) as total_score, SUM(kills) as total_kills,
                    ROUND(AVG(score)) as avg_score, MAX(score) as best_score
                FROM team_rankings ${whereClause} GROUP BY team_name ORDER BY ${orderBy} LIMIT 50
            `);
                res.writeHead(200);
                res.end(JSON.stringify(rows));
            } catch (err) {
                console.error('[API] /api/team-stats error:', err);
                res.writeHead(500);
                res.end(JSON.stringify({ error: err.message }));
            } finally {
                if (conn) conn.release();
            }
            return;
        }

        // ========================================
        // API: サーバー負荷統計 (DB依存)
        // ========================================
        if (urlPath === '/api/server-stats') {
            if (!dbPool) {
                res.writeHead(503);
                res.end(JSON.stringify({ error: 'Database not available' }));
                return;
            }
            let conn;
            try {
                conn = await dbPool.getConnection();
                const [recent] = await conn.execute(`
                SELECT id, mode, round_duration_sec, player_count, active_player_count,
                    bytes_sent, send_rate_bps, cpu_percent, load_avg_1m, avg_lag_ms, max_lag_ms,
                    heap_used_mb, heap_total_mb, rss_mb, external_mb,
                    system_mem_total_mb, system_mem_used_mb, system_mem_usage_pct, created_at
                FROM round_stats ORDER BY created_at DESC LIMIT 50
            `);
                const [daily] = await conn.execute(`
                SELECT DATE(created_at) as date, COUNT(*) as total_rounds,
                    SUM(player_count) as total_players, ROUND(AVG(active_player_count)) as avg_active,
                    SUM(bytes_sent) as total_bytes_sent, ROUND(AVG(cpu_percent), 1) as avg_cpu,
                    ROUND(AVG(avg_lag_ms), 1) as avg_lag, MAX(max_lag_ms) as worst_lag,
                    ROUND(AVG(heap_used_mb), 1) as avg_heap, ROUND(MAX(rss_mb), 1) as max_rss,
                    ROUND(AVG(system_mem_usage_pct), 1) as avg_sys_mem_pct, ROUND(MAX(system_mem_usage_pct), 1) as max_sys_mem_pct
                FROM round_stats GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30
            `);
                res.writeHead(200);
                res.end(JSON.stringify({ recent, daily }));
            } catch (err) {
                console.error('[API] /api/server-stats error:', err);
                res.writeHead(500);
                res.end(JSON.stringify({ error: err.message }));
            } finally {
                if (conn) conn.release();
            }
            return;
        }

        // ========================================
        // API: リアルタイムサーバー状態 (DB不要)
        // ========================================
        if (urlPath === '/api/server-realtime') {
            const memUsage = process.memoryUsage();
            const uptime = process.uptime();
            const playerCount = Object.keys(state.players).length;
            const activePlayerCount = Object.values(state.players).filter(p => p.state !== 'waiting').length;

            // システム全体のメモリ情報
            const totalMemMB = os.totalmem() / 1024 / 1024;
            const freeMemMB = os.freemem() / 1024 / 1024;
            const usedMemMB = totalMemMB - freeMemMB;
            const memUsagePercent = (usedMemMB / totalMemMB) * 100;

            const realtimeData = {
                timestamp: Date.now(),
                uptime: Math.floor(uptime),
                roundActive: state.roundActive,
                timeRemaining: state.timeRemaining,
                mode: GAME_MODES[state.currentModeIdx],
                players: {
                    total: playerCount,
                    active: activePlayerCount
                },
                memory: {
                    heapUsedMB: parseFloat((memUsage.heapUsed / 1024 / 1024).toFixed(1)),
                    heapTotalMB: parseFloat((memUsage.heapTotal / 1024 / 1024).toFixed(1)),
                    rssMB: parseFloat((memUsage.rss / 1024 / 1024).toFixed(1)),
                    externalMB: parseFloat((memUsage.external / 1024 / 1024).toFixed(1)),
                    systemTotalMB: parseFloat(totalMemMB.toFixed(0)),
                    systemFreeMB: parseFloat(freeMemMB.toFixed(0)),
                    systemUsedMB: parseFloat(usedMemMB.toFixed(0)),
                    systemUsagePercent: parseFloat(memUsagePercent.toFixed(1))
                },
                cpu: {
                    loadAvg1m: os.loadavg()[0],
                    loadAvg5m: os.loadavg()[1],
                    loadAvg15m: os.loadavg()[2]
                },
                territories: {
                    count: state.territoryRects.length,
                    version: state.territoryVersion
                },
                bandwidth: {
                    totalBytesSent: bandwidthStats.totalBytesSent,
                    totalBytesReceived: bandwidthStats.totalBytesReceived,
                    periodBytesSent: bandwidthStats.periodBytesSent,
                    periodBytesReceived: bandwidthStats.periodBytesReceived
                }
            };

            res.writeHead(200);
            res.end(JSON.stringify(realtimeData));
            return;
        }

        // ========================================
        // API: 管理者用 ランキングリセット
        // ========================================
        if (urlPath === '/api/admin/reset-rankings' && req.method === 'POST') {
            if (!dbPool) {
                res.writeHead(503);
                res.end(JSON.stringify({ error: 'Database not available' }));
                return;
            }
            let conn;
            try {
                conn = await dbPool.getConnection();
                await conn.query('SET FOREIGN_KEY_CHECKS = 0');
                await conn.query('TRUNCATE TABLE player_rankings');
                await conn.query('TRUNCATE TABLE team_rankings');
                await conn.query('TRUNCATE TABLE round_minimaps');
                await conn.query('TRUNCATE TABLE rounds');
                await conn.query('SET FOREIGN_KEY_CHECKS = 1');
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, message: 'All ranking data has been reset.' }));
                console.log('[ADMIN] Ranking data reset performed.');
            } catch (err) {
                console.error('[API] /api/admin/reset-rankings error:', err);
                res.writeHead(500);
                res.end(JSON.stringify({ error: err.message }));
            } finally {
                if (conn) conn.release();
            }
            return;
        }

        // ========================================
        // 静的ファイル配信
        // ========================================
        if (fs.existsSync(PUBLIC_HTML_DIR)) {
            let filePath = path.join(PUBLIC_HTML_DIR, urlPath === '/' ? 'index.html' : urlPath);
            
            // セキュリティ: ディレクトリトラバーサル防止
            const realPath = path.resolve(filePath);
            if (!realPath.startsWith(PUBLIC_HTML_DIR)) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }
            
            // ディレクトリの場合は index.html を探す
            if (fs.existsSync(realPath) && fs.statSync(realPath).isDirectory()) {
                filePath = path.join(realPath, 'index.html');
            }
            
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                const ext = path.extname(filePath).toLowerCase();
                const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
                
                try {
                    const content = fs.readFileSync(filePath);
                    res.setHeader('Content-Type', mimeType);
                    res.writeHead(200);
                    res.end(content);
                    return;
                } catch (err) {
                    console.error('[Static] File read error:', err.message);
                }
            }
        }

        // ========================================
        // デフォルトレスポンス (API情報)
        // ========================================
        res.writeHead(200);
        res.end(JSON.stringify({ 
            status: 'Game Server Running', 
            endpoints: ['/api/rounds', '/api/round/:id', '/api/player-stats', '/api/team-stats', '/api/server-stats', '/api/server-realtime'] 
        }));
    } catch (e) {
        console.error('[API] Error:', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
    }
}

// ============================================================
// exports
// ============================================================
module.exports = {
    handleHttpRequest
};

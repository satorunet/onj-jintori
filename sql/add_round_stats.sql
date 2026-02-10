-- round_stats テーブルを追加するスクリプト
-- 実行: mysql -u root -p***REMOVED*** jintori < add_round_stats.sql

USE jintori;

-- ラウンド統計テーブル（パフォーマンス情報）
CREATE TABLE IF NOT EXISTS round_stats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    mode VARCHAR(10) NOT NULL COMMENT 'SOLO or TEAM',
    round_duration_sec INT NOT NULL,
    player_count INT NOT NULL,
    active_player_count INT NOT NULL,
    territory_rects INT NOT NULL,
    territory_version INT NOT NULL,
    bytes_sent BIGINT NOT NULL COMMENT '送信バイト数',
    bytes_received BIGINT NOT NULL COMMENT '受信バイト数',
    send_rate_bps INT NOT NULL COMMENT '送信レート (bytes/sec)',
    recv_rate_bps INT NOT NULL COMMENT '受信レート (bytes/sec)',
    per_player_sent INT NOT NULL COMMENT '1人あたり送信バイト数',
    avg_msg_size INT NOT NULL COMMENT '平均メッセージサイズ',
    full_syncs INT NOT NULL COMMENT 'フル同期回数',
    delta_syncs INT NOT NULL COMMENT '差分同期回数',
    cpu_percent DECIMAL(5,2) COMMENT 'CPU使用率 (%)',
    load_avg_1m DECIMAL(5,2) COMMENT 'ロードアベレージ (1分)',
    avg_lag_ms DECIMAL(8,2) COMMENT '平均ラグ (ms)',
    max_lag_ms INT COMMENT '最大ラグ (ms)',
    breakdown_players BIGINT DEFAULT 0 COMMENT 'プレイヤーデータ送信量',
    breakdown_territory_full BIGINT DEFAULT 0 COMMENT 'テリトリー全量送信量',
    breakdown_territory_delta BIGINT DEFAULT 0 COMMENT 'テリトリー差分送信量',
    breakdown_minimap BIGINT DEFAULT 0 COMMENT 'ミニマップ送信量',
    breakdown_teams BIGINT DEFAULT 0 COMMENT 'チーム統計送信量',
    breakdown_base BIGINT DEFAULT 0 COMMENT 'ベース情報送信量',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_created_at (created_at),
    INDEX idx_mode (mode)
) ENGINE=InnoDB;

-- 日別サマリビュー
CREATE OR REPLACE VIEW daily_stats AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_rounds,
    SUM(player_count) as total_players,
    ROUND(AVG(active_player_count)) as avg_active_players,
    SUM(bytes_sent) as total_bytes_sent,
    ROUND(AVG(cpu_percent), 1) as avg_cpu_percent,
    ROUND(AVG(avg_lag_ms), 1) as avg_lag_ms,
    MAX(max_lag_ms) as worst_lag_ms
FROM round_stats
GROUP BY DATE(created_at)
ORDER BY date DESC;

SELECT 'round_stats table created!' as status;

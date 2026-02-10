-- jintori ランキングデータベース作成スクリプト
-- 実行: mysql -u root -p < setup_db.sql

-- データベース作成
CREATE DATABASE IF NOT EXISTS jintori CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE jintori;

-- ラウンド情報テーブル
CREATE TABLE IF NOT EXISTS rounds (
    id INT AUTO_INCREMENT PRIMARY KEY,
    mode VARCHAR(10) NOT NULL COMMENT 'SOLO or TEAM',
    played_at DATETIME NOT NULL,
    player_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_played_at (played_at),
    INDEX idx_mode (mode)
) ENGINE=InnoDB;

-- 個人ランキングテーブル
CREATE TABLE IF NOT EXISTS player_rankings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    round_id INT NOT NULL,
    rank_position INT NOT NULL COMMENT '順位 (1-10)',
    player_name VARCHAR(50) NOT NULL,
    team VARCHAR(10) DEFAULT '',
    emoji VARCHAR(10) DEFAULT '',
    score INT NOT NULL DEFAULT 0,
    kills INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
    INDEX idx_round_id (round_id),
    INDEX idx_player_name (player_name),
    INDEX idx_score (score DESC)
) ENGINE=InnoDB;

-- チームランキングテーブル
CREATE TABLE IF NOT EXISTS team_rankings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    round_id INT NOT NULL,
    rank_position INT NOT NULL COMMENT '順位 (1-5)',
    team_name VARCHAR(10) NOT NULL,
    score INT NOT NULL DEFAULT 0,
    kills INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
    INDEX idx_round_id (round_id),
    INDEX idx_team_name (team_name),
    INDEX idx_score (score DESC)
) ENGINE=InnoDB;

-- 累計ランキングビュー (個人)
CREATE OR REPLACE VIEW player_stats AS
SELECT 
    player_name,
    COUNT(*) as total_games,
    SUM(CASE WHEN rank_position = 1 THEN 1 ELSE 0 END) as wins,
    SUM(score) as total_score,
    SUM(kills) as total_kills,
    AVG(score) as avg_score,
    MAX(score) as best_score
FROM player_rankings
GROUP BY player_name
ORDER BY total_score DESC;

-- 累計ランキングビュー (チーム)
CREATE OR REPLACE VIEW team_stats AS
SELECT 
    team_name,
    COUNT(*) as total_games,
    SUM(CASE WHEN rank_position = 1 THEN 1 ELSE 0 END) as wins,
    SUM(score) as total_score,
    SUM(kills) as total_kills,
    AVG(score) as avg_score,
    MAX(score) as best_score
FROM team_rankings
GROUP BY team_name
ORDER BY total_score DESC;

-- 最近のラウンドを取得するビュー
CREATE OR REPLACE VIEW recent_rounds AS
SELECT 
    r.id,
    r.mode,
    r.played_at,
    r.player_count,
    (SELECT player_name FROM player_rankings WHERE round_id = r.id AND rank_position = 1 LIMIT 1) as winner,
    (SELECT score FROM player_rankings WHERE round_id = r.id AND rank_position = 1 LIMIT 1) as winner_score
FROM rounds r
ORDER BY r.played_at DESC
LIMIT 100;

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

-- パフォーマンス統計ビュー（日別サマリ）
CREATE OR REPLACE VIEW daily_stats AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_rounds,
    SUM(player_count) as total_players,
    AVG(active_player_count) as avg_active_players,
    SUM(bytes_sent) as total_bytes_sent,
    AVG(cpu_percent) as avg_cpu_percent,
    AVG(avg_lag_ms) as avg_lag_ms,
    MAX(max_lag_ms) as worst_lag_ms
FROM round_stats
GROUP BY DATE(created_at)
ORDER BY date DESC;

SELECT 'Database setup complete!' as status;

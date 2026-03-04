-- 時間杯・1日杯キャッシュテーブル追加スクリプト
-- 実行: mysql -u root -p jintori < add_wins_cache.sql

USE jintori;

-- 時間杯キャッシュテーブル（直近48時間分を保持）
CREATE TABLE IF NOT EXISTS wins_hourly_cache (
    type ENUM('team', 'player') NOT NULL,
    hour_slot DATETIME NOT NULL,
    hour_num TINYINT NOT NULL,
    name VARCHAR(50) NOT NULL,
    wins INT NOT NULL DEFAULT 0,
    PRIMARY KEY (type, hour_slot, name),
    INDEX idx_hour_slot (hour_slot)
) ENGINE=InnoDB COMMENT='時間杯キャッシュ（ラウンド終了後に再構築）';

-- 1日杯キャッシュテーブル（直近30日分を保持）
CREATE TABLE IF NOT EXISTS wins_daily_cache (
    type ENUM('team', 'player') NOT NULL,
    day_slot DATE NOT NULL,
    day_label VARCHAR(10) NOT NULL,
    name VARCHAR(50) NOT NULL,
    wins INT NOT NULL DEFAULT 0,
    PRIMARY KEY (type, day_slot, name),
    INDEX idx_day_slot (day_slot)
) ENGINE=InnoDB COMMENT='1日杯キャッシュ（ラウンド終了後に再構築）';

-- 初回データ投入（時間杯 直近48時間）
DELETE FROM wins_hourly_cache;
INSERT INTO wins_hourly_cache (type, hour_slot, hour_num, name, wins)
SELECT 'team', DATE_FORMAT(r.played_at, '%Y-%m-%d %H:00:00'), HOUR(r.played_at), tr.team_name, COUNT(*)
FROM team_rankings tr
JOIN rounds r ON tr.round_id = r.id
WHERE tr.rank_position = 1
  AND r.mode = 'TEAM'
  AND r.played_at >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
GROUP BY DATE_FORMAT(r.played_at, '%Y-%m-%d %H:00:00'), HOUR(r.played_at), tr.team_name;

INSERT INTO wins_hourly_cache (type, hour_slot, hour_num, name, wins)
SELECT 'player', DATE_FORMAT(r.played_at, '%Y-%m-%d %H:00:00'), HOUR(r.played_at), pr.player_name, COUNT(*)
FROM player_rankings pr
JOIN rounds r ON pr.round_id = r.id
WHERE pr.rank_position = 1
  AND r.played_at >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
GROUP BY DATE_FORMAT(r.played_at, '%Y-%m-%d %H:00:00'), HOUR(r.played_at), pr.player_name;

-- 初回データ投入（1日杯 直近30日）
DELETE FROM wins_daily_cache;
INSERT INTO wins_daily_cache (type, day_slot, day_label, name, wins)
SELECT 'team', DATE(r.played_at), DATE_FORMAT(r.played_at, '%m/%d'), tr.team_name, COUNT(*)
FROM team_rankings tr
JOIN rounds r ON tr.round_id = r.id
WHERE tr.rank_position = 1
  AND r.mode = 'TEAM'
  AND r.played_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(r.played_at), DATE_FORMAT(r.played_at, '%m/%d'), tr.team_name;

INSERT INTO wins_daily_cache (type, day_slot, day_label, name, wins)
SELECT 'player', DATE(r.played_at), DATE_FORMAT(r.played_at, '%m/%d'), pr.player_name, COUNT(*)
FROM player_rankings pr
JOIN rounds r ON pr.round_id = r.id
WHERE pr.rank_position = 1
  AND r.played_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(r.played_at), DATE_FORMAT(r.played_at, '%m/%d'), pr.player_name;

SELECT 'Wins cache tables created and populated!' AS status;

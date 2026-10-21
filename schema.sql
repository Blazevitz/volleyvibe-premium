CREATE DATABASE IF NOT EXISTS afterhours_vbc
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE afterhours_vbc;

CREATE TABLE IF NOT EXISTS event_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  club_name VARCHAR(120) NOT NULL,
  event_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  venue VARCHAR(180) NOT NULL,
  court_fee INT UNSIGNED NOT NULL,
  hero_eyebrow VARCHAR(80) NOT NULL DEFAULT 'AFTER THE LAST WHISTLE',
  hero_headline VARCHAR(180) NOT NULL DEFAULT 'Every rally has
a story.',
  hero_description VARCHAR(500) NOT NULL DEFAULT 'A home for the late-night regulars, friendly rivalries, and the points we’ll talk about next week.',
  payment_provider VARCHAR(20) NOT NULL DEFAULT '',
  payment_qr_file VARCHAR(80) NULL DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_event_settings_singleton CHECK (id = 1),
  CONSTRAINT chk_event_times CHECK (end_time > start_time)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS teams (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  color CHAR(7) CHARACTER SET ascii NOT NULL,
  tagline VARCHAR(120) NOT NULL DEFAULT '',
  players JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_teams_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS matches (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  match_number INT UNSIGNED NOT NULL,
  team_a_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  team_b_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  match_date DATE NULL,
  match_time TIME NULL,
  referee VARCHAR(120) NOT NULL DEFAULT '',
  score_a SMALLINT UNSIGNED NULL,
  score_b SMALLINT UNSIGNED NULL,
  status ENUM('scheduled', 'in_progress', 'completed', 'official') NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_matches_number (match_number),
  KEY ix_matches_team_a (team_a_id),
  KEY ix_matches_team_b (team_b_id),
  CONSTRAINT fk_matches_team_a FOREIGN KEY (team_a_id) REFERENCES teams (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_matches_team_b FOREIGN KEY (team_b_id) REFERENCES teams (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_matches_different_teams CHECK (team_a_id <> team_b_id),
  CONSTRAINT chk_matches_both_scores CHECK ((score_a IS NULL AND score_b IS NULL) OR (score_a IS NOT NULL AND score_b IS NOT NULL))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  ip_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  failures SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until TIMESTAMP NULL DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT INTO event_settings (id, club_name, event_date, start_time, end_time, venue, court_fee)
VALUES (1, 'Volleyvibe Spikers Club', '2026-10-24', '18:00:00', '22:00:00', 'CKSM Basketball Court', 140)
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO teams (id, name, color, tagline, players) VALUES
('11111111-1111-4111-8111-111111111111', 'KYU', '#e9e3df', 'Calm under pressure', JSON_ARRAY('Celso', 'Kari', 'Percy', 'Elloy', 'Lester', 'Renato')),
('22222222-2222-4222-8222-222222222222', 'TEE', '#239b9b', 'Play with purpose', JSON_ARRAY('Team TEE')),
('33333333-3333-4333-8333-333333333333', 'EST', '#d51e60', 'Bring the intensity', JSON_ARRAY('Team EST')),
('44444444-4444-4444-8444-444444444444', 'ARR', '#e0a51d', 'Every point matters', JSON_ARRAY('Team ARR'))
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO matches (id, match_number, team_a_id, team_b_id, score_a, score_b, referee, status) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 1, '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 21, 11, 'TEE', 'official'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 2, '44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 21, 18, 'KYU', 'official'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 3, '44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 21, 18, 'EST', 'official'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 4, '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 21, 13, 'ARR', 'official'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 5, '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', 21, 17, 'KYU', 'official'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6', 6, '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 21, 16, 'EST', 'official'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7', 7, '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 20, 18, 'ARR', 'official'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8', 8, '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', 21, 20, 'TEE', 'official'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9', 9, '44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 16, 21, 'KYU', 'official'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaA', 10, '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 20, 21, 'ARR', 'official'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaB', 11, '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', 21, 14, 'TEE', 'official'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaC', 12, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 21, 19, 'EST', 'official'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaD', 13, '44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 18, 21, 'KYU', 'official'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaE', 14, '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 16, 18, 'EST', 'official')
ON DUPLICATE KEY UPDATE id = id;

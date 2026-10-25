-- Manifestei — esquema inicial
-- Requer PostgreSQL 14+ com PostGIS 3+.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- Usuários: o telefone NUNCA é guardado em claro (LGPD, minimização).
-- phone_hash = HMAC-SHA256(pepper do servidor, telefone E.164), em hex.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY,
  phone_hash    char(64) NOT NULL UNIQUE,
  display_name  text CHECK (display_name IS NULL OR char_length(display_name) <= 60),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id                  uuid PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash  char(64) NOT NULL UNIQUE,
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  rotated_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- ---------------------------------------------------------------------------
-- Aparelhos: um único aparelho ATIVO por usuário.
-- iOS guarda a chave pública do App Attest e o contador de assinaturas.
-- ---------------------------------------------------------------------------
CREATE TYPE device_platform AS ENUM ('ios', 'android');
CREATE TYPE device_trust    AS ENUM ('TRUSTED', 'UNTRUSTED');

CREATE TABLE devices (
  id                         uuid PRIMARY KEY,
  user_id                    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform                   device_platform NOT NULL,
  installation_id            uuid NOT NULL,
  trust                      device_trust NOT NULL,
  untrusted_reason           text,
  app_attest_key_id          text UNIQUE,
  app_attest_public_key_pem  text,
  app_attest_sign_count      bigint NOT NULL DEFAULT 0,
  app_attest_environment     text CHECK (app_attest_environment IN ('production', 'development')),
  app_attest_receipt         bytea,
  active                     boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  last_seen_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (platform <> 'ios' OR trust <> 'TRUSTED' OR app_attest_public_key_pem IS NOT NULL)
);
CREATE UNIQUE INDEX devices_one_active_per_user ON devices(user_id) WHERE active;
CREATE INDEX devices_installation_idx ON devices(installation_id);

-- ---------------------------------------------------------------------------
-- Eventos: a área é um polígono geográfico (círculo ou trajeto com largura),
-- já que passeatas se movem. A geocerca é calculada no banco (ST_Distance).
-- ---------------------------------------------------------------------------
CREATE TYPE event_status AS ENUM ('SCHEDULED', 'CANCELLED');

CREATE TABLE events (
  id            uuid PRIMARY KEY,
  organizer_id  uuid NOT NULL REFERENCES users(id),
  title         text NOT NULL CHECK (char_length(title) BETWEEN 5 AND 120),
  description   text NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
  city          text CHECK (city IS NULL OR char_length(city) <= 80),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  area          geography(Geometry, 4326) NOT NULL,
  area_kind     text NOT NULL CHECK (area_kind IN ('circle', 'route')),
  status        event_status NOT NULL DEFAULT 'SCHEDULED',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (ends_at - starts_at <= interval '24 hours')
);
CREATE INDEX events_area_gix   ON events USING gist(area);
CREATE INDEX events_ends_at_idx ON events(ends_at);
CREATE INDEX events_organizer_created_idx ON events(organizer_id, created_at);

-- ---------------------------------------------------------------------------
-- Presença: um registro por (evento, usuário) + amostras auditáveis.
-- ---------------------------------------------------------------------------
CREATE TYPE attendance_status AS ENUM ('PENDING_ON_SITE', 'CONFIRMED_ON_SITE', 'VIRTUAL_SUPPORTER');

CREATE TABLE attendance_records (
  id                     uuid PRIMARY KEY,
  event_id               uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                 attendance_status NOT NULL,
  virtual_reason         text,
  valid_sample_count     integer NOT NULL DEFAULT 0 CHECK (valid_sample_count >= 0),
  first_valid_sample_at  timestamptz,
  last_valid_sample_at   timestamptz,
  confirmed_at           timestamptz,
  downgraded_at          timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id),
  CHECK (status <> 'VIRTUAL_SUPPORTER' OR virtual_reason IS NOT NULL),
  CHECK (status <> 'CONFIRMED_ON_SITE' OR confirmed_at IS NOT NULL)
);
CREATE INDEX attendance_event_status_idx ON attendance_records(event_id, status);

CREATE TABLE presence_samples (
  id                  uuid PRIMARY KEY,
  attendance_id       uuid NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
  device_id           uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  installation_id     uuid NOT NULL,
  received_at         timestamptz NOT NULL,
  fix_timestamp       timestamptz NOT NULL,
  -- coordenada exata: anulada pelo job de retenção após o fim do evento
  location            geography(Point, 4326),
  accuracy_m          real NOT NULL,
  distance_to_area_m  real NOT NULL,
  verdict             text NOT NULL CHECK (verdict IN ('VALID', 'INCONCLUSIVE', 'FRAUD')),
  reason              text,
  location_purged_at  timestamptz
);
CREATE INDEX samples_attendance_received_idx ON presence_samples(attendance_id, received_at DESC);
CREATE INDEX samples_installation_valid_idx ON presence_samples(installation_id) WHERE verdict = 'VALID';

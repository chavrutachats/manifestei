-- Manifestei — 002: consentimento LGPD, exclusão de conta com anonimização
-- e suporte a métricas de integridade.

-- ---------------------------------------------------------------------------
-- Consentimento específico e destacado (LGPD art. 11, I): participação em ato
-- político revela opinião política, que é dado pessoal SENSÍVEL (art. 5º, II).
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN consent_version text,
  ADD COLUMN consented_at    timestamptz;

UPDATE users SET consent_version = 'legacy', consented_at = created_at WHERE consent_version IS NULL;

ALTER TABLE users
  ALTER COLUMN consent_version SET NOT NULL,
  ALTER COLUMN consented_at    SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Exclusão de conta (LGPD art. 18, VI; App Store 5.1.1(v)).
-- A pessoa some; o número do ato não muda. O vínculo é cortado (user_id/
-- device_id/installation_id → NULL) e a coordenada exata é apagada, o que torna
-- o registro anônimo (LGPD art. 12) e preserva a contagem histórica.
-- ---------------------------------------------------------------------------
ALTER TABLE attendance_records ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE attendance_records DROP CONSTRAINT attendance_records_user_id_fkey;
ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_records_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE presence_samples ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE presence_samples ALTER COLUMN installation_id DROP NOT NULL;
ALTER TABLE presence_samples DROP CONSTRAINT presence_samples_device_id_fkey;
ALTER TABLE presence_samples
  ADD CONSTRAINT presence_samples_device_id_fkey
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL;

-- Eventos continuam públicos mesmo se quem organizou apagar a conta.
ALTER TABLE events ALTER COLUMN organizer_id DROP NOT NULL;
ALTER TABLE events DROP CONSTRAINT events_organizer_id_fkey;
ALTER TABLE events
  ADD CONSTRAINT events_organizer_id_fkey
  FOREIGN KEY (organizer_id) REFERENCES users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Índices de apoio
-- ---------------------------------------------------------------------------
-- Velocidade impossível ENTRE eventos: última amostra do usuário em qualquer ato.
CREATE INDEX attendance_user_idx ON attendance_records(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX samples_received_idx ON presence_samples(received_at DESC) WHERE location IS NOT NULL;

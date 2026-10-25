-- Manifestei — 003: sem cadastro.
--
-- A identidade deixa de ser um telefone e passa a ser o APARELHO:
--   anchor_hash = HMAC-SHA256(pepper, "<plataforma>:<âncora>")
--   Android: ANDROID_ID (estável por app+aparelho, sobrevive à reinstalação)
--   iOS:     UUID no Keychain com THIS_DEVICE_ONLY (sobrevive à reinstalação, não vai para backup)
-- A âncora só é aceita dentro de um payload atestado pela Apple/Google, e só o
-- HMAC é guardado: o banco não contém nome, telefone, e-mail nem id de hardware.

ALTER TABLE users RENAME COLUMN phone_hash TO anchor_hash;
ALTER TABLE users RENAME CONSTRAINT users_phone_hash_key TO users_anchor_hash_key;

COMMENT ON TABLE users IS 'Participante anônimo: um por aparelho físico verificado. Sem dados pessoais diretos.';
COMMENT ON COLUMN users.anchor_hash IS 'HMAC-SHA256(pepper, plataforma:âncora do aparelho). Irreversível sem o pepper.';

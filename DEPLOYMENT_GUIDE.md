# 📱 Guia Completo: Teste e Publicação do Manifestei

## Índice
1. [Documentação do Código](#documentação-do-código)
2. [Teste Local (Desenvolvimento)](#teste-local-desenvolvimento)
3. [Teste em Dispositivo Físico](#teste-em-dispositivo-físico)
4. [Publicação Google Play](#publicação-google-play)
5. [Publicação App Store](#publicação-app-store)
6. [Checklist Pré-Lançamento](#checklist-pré-lançamento)

---

## Documentação do Código

### Status Atual ✅
O código está **bem documentado**:
- **README.md**: 450 linhas cobrindo funcionalidade, arquitetura, segurança, LGPD
- **99 comentários** específicos no backend (funções, lógica, avisos)
- **Arquitetura Clean**: pastas bem separadas (`domain/`, `application/`, `infrastructure/`)
- **TypeScript estrito**: tipos em todo o código
- **Comentários de negócio**: cada decisão explicada (por que GPS, por que não SMS, etc)

### Documentação Adicional por Seção

#### Backend (`/backend`)
```
src/
├── domain/             → Regras puras (sem I/O), altamente comentadas
│   ├── presence.ts     "Estados: PENDING, CONFIRMED, VIRTUAL"
│   ├── timeline.ts     "Pico, queda, tempo médio — algoritmo de diferença"
│   └── event-area.ts   "Limites de raio, faixa e trajeto"
├── application/
│   ├── ports.ts        → Interfaces (contrato entre camadas)
│   └── use-cases/      → Cada caso de uso é uma classe bem nomeada
├── infrastructure/
│   ├── attestation/    → Apple App Attest, Google Play Integrity
│   ├── db/             → Repositórios (SQL parametrizado 100%)
│   └── jobs/           → Retenção automática de dados (LGPD)
└── interfaces/http/    → Rotas, schemas, error handling
```

**Leia na Ordem:**
1. `README.md` — visão geral
2. `backend/src/domain/presence.ts` — máquina de estados
3. `backend/src/application/use-cases/presence.ts` — fluxo de matrícula e leitura
4. `backend/src/infrastructure/attestation/` — como verifica Apple/Google

#### Mobile (`/mobile`)
```
src/
├── features/identity/     → Enroll, consentimento
├── features/presence/     → Leitura de presença, sesão automática
├── security/              → Payload assinado, atestação nativa
└── ui/                    → Componentes (PresenceTimelineChart.tsx bem comentado)
modules/manifestei-integrity/
├── ios/*.swift            → App Attest, CoreLocation
└── android/*.kt           → Play Integrity, FusedLocation
```

---

## Teste Local (Desenvolvimento)

### 1. Setup Inicial

#### 1.1 Backend
```bash
cd backend

# Crie o arquivo de ambiente
cp .env.example .env

# Edite .env com:
# JWT_SECRET=seu_segredo_aleatorio_com_32_chars_minimo
# DEVICE_ANCHOR_PEPPER=outro_segredo_aleatorio_com_32_chars
# Veja .env.example para todas as variáveis

# Gere segredos aleatórios:
openssl rand -base64 32    # para JWT_SECRET
openssl rand -base64 32    # para DEVICE_ANCHOR_PEPPER

# Inicie Postgres + PostGIS + Redis
cd ..
docker compose up -d

# Confirme que está rodando
docker compose ps

# Volte para backend
cd backend

# Instale dependências
npm ci

# Execute migrações
npm run migrate

# Inicie o servidor
npm run dev
```

**Esperado:** Servidor rodando em `http://localhost:3000`

```
✓ Migrations applied
✓ Database connected
✓ Redis connected
✓ HTTP server listening on 0.0.0.0:3000
```

#### 1.2 Mobile

```bash
cd mobile

# Instale dependências
npm ci

# Inicie o servidor de desenvolvimento
npx expo start

# Escolha:
# - "i" para iOS (se em Mac com Xcode)
# - "a" para Android (se tiver Android Studio ou emulador rodando)
```

**Esperado:** QR code aparecendo no terminal

### 2. Testes Unitários

#### Backend
```bash
cd backend

# Testes rápidos (sem banco)
npm run test:unit

# Testes de integração (com Postgres, PostGIS, Redis)
TEST_DATABASE_URL=postgres://manifestei:root@localhost/manifestei_test \
TEST_REDIS_URL=redis://localhost:6379/1 \
npm test

# Resultado esperado:
# ✓ 92 tests passing
```

#### Mobile
```bash
cd mobile

# Verificação de tipos
npm run typecheck

# Contrato (app e servidor geram o MESMO payload)
npm run verify:contract

# Regras da sessão (quando ler, quando parar)
npm run verify:session:rules
```

### 3. Teste de Ponta a Ponta (E2E) Local

```bash
cd backend
npm run test:integration

# Isso simula:
# ✓ Matrícula (enrollment) com atestação
# ✓ Leitura de presença (toque + automáticas)
# ✓ Geocerca
# ✓ Velocidade impossível (teletransporte)
# ✓ Rebaixamento por fraude
# ✓ Retenção de dados (72 h)
# ✓ Timeline (pico, queda, tempo médio)
```

---

## Teste em Dispositivo Físico

### Pré-Requisitos
- ✅ Backend rodando (localhost:3000 ou servidor remoto)
- ✅ Dispositivo Android real ou iPhone real (emulador/simulador são bloqueados por desenho)
- ✅ Desenvolvimento build do Manifestei (não vale Expo Go)

### 1. Preparação do Backend para Teste

```bash
cd backend

# Se testar remoto, altere em .env:
# TRUST_PROXY=true
# (seu balanceador informa o IP real via X-Forwarded-For)

# Ambiente de teste: permite App Attest de desenvolvimento
# APPLE_TEAM_ID=XXXXXXXXXX        (seu Team ID do Apple Developer)
# APPLE_BUNDLE_ID=br.org.manifestei.app.dev
# APPLE_APP_ATTEST_ALLOW_DEVELOPMENT=true

# Para Android, precisa de service account para Play Integrity:
# GOOGLE_SERVICE_ACCOUNT_JSON={colar JSON inteiro aqui}
# PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER=123456789012

npm run dev
```

### 2. Build do App (Android)

```bash
cd mobile

# Configure a URL da API
export MANIFESTEI_API_URL=http://SEU_IP_LOCAL:3000
export PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER=123456789012
export GOOGLE_MAPS_ANDROID_API_KEY=sua_chave_aqui

# Build de desenvolvimento (com hot reload)
npx expo run:android

# Esperado:
# ✓ Compila Kotlin (módulo nativo)
# ✓ Empacota APK
# ✓ Instala no dispositivo
# ✓ App inicia

# Ou use EAS (Expo's build service):
eas build -p android --profile preview
```

### 3. Build do App (iOS)

**Apenas em Mac com Xcode**

```bash
cd mobile

export MANIFESTEI_API_URL=http://SEU_IP_LOCAL:3000

# Build de desenvolvimento
npx expo run:ios

# Esperado:
# ✓ Compila Swift (módulo nativo)
# ✓ Empacota app
# ✓ Abre no Simulador (ou dispositivo conectado)

# Ou use EAS:
eas build -p ios --profile preview
```

### 4. Fluxo de Teste Manual

1. **Abrir o app**
   - [ ] Telinha de consentimento aparece
   - [ ] Ao concordar, vê "Carregando..." por alguns segundos
   - [ ] Depois, lista de atos vazia (ou com testes)

2. **Criar um ato de teste**
   - [ ] Use o app mesmo ou faça POST `/v1/events` (veja curl abaixo)
   - [ ] Ato com área circular (raio 100 m) num local seu

3. **Testar "Estou no ato"**
   - [ ] Abra o ato
   - [ ] Toque em "Estou no ato"
   - [ ] Status muda para "EM VERIFICAÇÃO"
   - [ ] Depois de 45 min, muda para "PRESENTE"
   - [ ] (Para teste rápido, mude `PRESENCE_MIN_DWELL_MINUTES=1` no backend)

4. **Testar "Apoiar à distância"**
   - [ ] Toque novamente (em outro ato ou antes do toque no mesmo)
   - [ ] Status muda para "APOIO VIRTUAL"

5. **Testar Timeline**
   - [ ] Com 10+ pessoas confirmadas, a timeline aparece
   - [ ] Mostra pico, início da queda, tempo médio

### 5. Testes via API (curl)

```bash
# 1. Obter desafio de matrícula
curl -X POST http://localhost:3000/v1/enroll/challenge \
  -H "Content-Type: application/json" \
  -d '{"installationId":"550e8400-e29b-41d4-a716-446655440000"}'
# Resposta: {"challenge":"...","expiresInSeconds":120}

# 2. Matricular (com atestação real do app)
curl -X POST http://localhost:3000/v1/enroll \
  -H "Content-Type: application/json" \
  -d '{
    "platform":"android",
    "installationId":"550e8400-e29b-41d4-a716-446655440000",
    "deviceAnchor":"ANDROID_ID_HEX",
    "consentVersion":"2026-10",
    "challenge":"... do passo 1",
    "attestation":{"kind":"unsupported"}
  }'
# Resposta: {"accessToken":"...","refreshToken":"...","userId":"...","deviceId":"..."}

# 3. Criar ato
AREA='{"type":"Polygon","coordinates":[[[-51.2,-30.0],[-51.2,-30.1],[-51.1,-30.1],[-51.1,-30.0],[-51.2,-30.0]]]}'
curl -X POST http://localhost:3000/v1/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{
    \"title\":\"Ato Teste\",
    \"startsAt\":\"2026-10-25T14:00:00-03:00\",
    \"endsAt\":\"2026-10-25T16:00:00-03:00\",
    \"area\":{
      \"kind\":\"circle\",
      \"center\":{\"latitude\":-30.05,\"longitude\":-51.15},
      \"radiusM\":100
    }
  }"
# Resposta: {"id":"uuid...","title":"Ato Teste",...}

# 4. Listar atos
curl http://localhost:3000/v1/events

# 5. Ver estado de um ato
curl http://localhost:3000/v1/events/{id}

# 6. Ver timeline (com 10+ confirmados)
curl http://localhost:3000/v1/events/{id}/timeline
```

---

## Publicação Google Play

### Fase 1: Preparação (1-2 semanas)

#### 1.1 Conta Google Play
```
1. Play Console: console.play.google.com
2. Crie um novo app
   - Nome: "Manifestei"
   - Categoria: "Ativismo" ou "Educação"
   - Tipo: "Aplicativo"
3. Reserve o pacote: br.org.manifestei.app (ou .dev para teste)
4. Complete a aba "Configuração do app"
```

#### 1.2 Play Integrity API
```
1. Play Console → App Signing
   - Ative "Google Play App Signing"
   - Note o SHA-256 do certificado (aparece em "Release")
   - Salve em PLAY_INTEGRITY_ALLOWED_CERT_DIGESTS no .env da API

2. Google Cloud Console
   - Crie um novo projeto ou vincule ao Play Console
   - APIs → Play Integrity API → Ativar
   - Credenciais → Service Account
   - Crie chave JSON (private key)
   - Salve em GOOGLE_SERVICE_ACCOUNT_JSON na API

3. Back no Play Console
   - Integridade do App → Vincule o projeto Google Cloud
   - Ative "Play Integrity API"
```

#### 1.3 Permissões
```bash
# No arquivo app.config.ts, já está correto:
permissions: [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
]
blockedPermissions: [
  'android.permission.ACCESS_BACKGROUND_LOCATION',  # ← Bloqueado
  ...
]
```

### Fase 2: Build para Google Play (1-2 dias)

#### 2.1 Prepare o App
```bash
cd mobile

# Copie as variáveis de ambiente
cp .env.example .env
# Edite .env com:
# MANIFESTEI_API_URL=https://api.manifestei.org.br (produção)
# PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER=123456789012

# Aumente a versão em app.config.ts
# version: '1.0.1'

npm ci
npm run typecheck
npm run test:unit
```

#### 2.2 Build com EAS
```bash
# Login no EAS (crie conta em expo.dev)
eas login

# Configure o projeto
eas init

# Build para produção
eas build -p android --profile production

# Esperado: URL do APK/AAB aparece no terminal
# URL tipo: https://expo.dev/artifacts/eas/...

# Ou localmente (precisa de Keystore, versão 100.000 ou maior):
cd android
./gradlew bundleRelease
# Output: app/release/app-release.aab
```

#### 2.3 Upload no Play Console
```
1. Play Console → Configuração do app → Integridade do app
   - SHA-256 do certificado já capturado? ✓

2. Publicação → Versões → Criar novo lançamento
   - Selecione o AAB (Android App Bundle)
   - Descreva: "Registro de presença em manifestações públicas"
   - Capturas de tela:
     * Tela inicial
     * "Estou no ato"
     * Barra de progresso
     * Timeline (pico)

3. Conteúdo do app → Declaração de dados de privacidade
   - Localização precisa: Sim (coletada)
     * Vinculada à identidade? NÃO
     * Rastreada? NÃO
     * Finalidade: Funcionalidade + Fraude
   - Identificador do dispositivo: Sim (HMAC)
     * Vinculado à identidade? NÃO
     * Rastreado? NÃO

4. Conteúdo do app → Serviços em primeiro plano
   - Tipo: Localização
   - Finalidade: Registrar presença durante ato
   - Descrição: "Quando toca em 'Estou no ato', o app lê a localização a cada 15 min..."
   - Upload de vídeo mostrando a notificação

5. Diretrizes do app
   - Verificação de política automática
   - Resolva avisos (ex: "Vídeo da notificação é obrigatório")
```

### Fase 3: Teste Antes de Lançar

#### 3.1 Teste Interno
```
Play Console → Testes → Teste interno
→ Convide seu email de teste
→ Abra o link de instalação
→ Teste num dispositivo Android real (não emulador)
```

#### 3.2 Teste Fechado
```
Depois do sucesso interno, abra para um grupo pequeno:
Play Console → Testes → Teste fechado (alfa/beta)
→ Convide ~50-100 pessoas de confiança
→ Recolha feedback sobre crashes, lentidão
```

### Fase 4: Lançamento

```
Play Console → Publicação → Versões
→ Selecione a versão testada
→ Clique em "Enviar para produção"
→ Descrição da versão (ex: "Versão 1.0: lançamento oficial")
→ Data de lançamento (imediato ou agendar)

Aguarde aprovação (geralmente 2-4 horas):
- ✓ Código malicioso? NÃO
- ✓ Permissões adequadas? SIM
- ✓ Privacidade declarada? SIM
- ✓ App roda sem crashes? SIM
```

---

## Publicação App Store

### Fase 1: Preparação (1-2 semanas)

**Requer Mac com Xcode**

#### 1.1 Apple Developer Account
```
1. developer.apple.com → Account
2. Agree to Developer Agreement
3. Cadastre um Team (ou use existente)
4. Certificate + Identifiers + Provisioning Profiles
   - Automatizado no Xcode, mas entenda a estrutura
```

#### 1.2 App ID e App Attest
```
1. Xcode Cloud Settings (ou App Store Connect)
   - Identifiers → App IDs
   - Com o Bundle ID: br.org.manifestei.app
   - Habilitar: App Attest (provisioning profile)

2. Guarde:
   - APPLE_TEAM_ID=ABC123DEFG (veja em account.apple.com)
   - APPLE_BUNDLE_ID=br.org.manifestei.app

3. Na API, configure:
   - APPLE_TEAM_ID e APPLE_BUNDLE_ID no backend
   - Baixe a raiz do App Attest:
     curl -fsSL -o certs/Apple_App_Attestation_Root_CA.pem \
       https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
```

#### 1.3 Privacy Manifest
```bash
# Já incluído em app.config.ts:
privacyManifests: {
  NSPrivacyTracking: false,
  NSPrivacyCollectedDataTypes: [
    {
      NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePreciseLocation',
      NSPrivacyCollectedDataTypeLinked: false,  # ← não vinculado
      NSPrivacyTracking: false
    },
    ...
  ]
}
```

### Fase 2: Build para App Store (1-2 dias)

#### 2.1 Prepare no Mac
```bash
cd mobile

# Aumente a versão em app.config.ts
# version: '1.0.1'
# ios.buildNumber: '2'  (sempre crescente)

npm ci
npm run typecheck

# Instale dependências nativas
npm run prebuild
```

#### 2.2 Build com EAS (Recomendado)
```bash
eas login
eas init  # (se não feito ainda)

# Build para TestFlight (produção, mas com assinatura Apple)
eas build -p ios --profile production

# Esperado: URL do .ipa aparece
```

#### 2.3 Upload no App Store Connect
```
1. App Store Connect: appstoreconnect.apple.com
2. Selecione seu app (Manifestei)
3. Versão do app → "+ Versão do app"
   - Versão: 1.0.1
   - Release type: Manual Release (você controla quando sai)

4. Novo build
   - Envia o .ipa para Apple
   - Processing... (10-20 min)
   - Status: Ready to Submit

5. Screenshotshots em cada idioma (en-US, pt-BR, etc)
   - iPhone 6.7" (Pro Max): obrigatório
   - Screenshots mostram:
     * Tela inicial
     * "Estou no ato"
     * Barra de progresso
     * Timeline (pico)

6. Descrição
   - Resumo: "Registre sua presença em manifestações públicas, sem cadastro"
   - Descrição: "O Manifestei mede o pico de participantes em atos públicos. Você toca uma vez e o app confere sua localização a cada 15 minutos, confirmando presença após 45 minutos no local."
   - Palavras-chave: "manifestação, protesto, ativismo, participação"
   - Suporte: seu email
   - Website: seu site

7. Privacy Nutrition Label
   - Localização precisa? Sim (coletada, não vinculada)
   - Identificador do dispositivo? Sim (não rastreado)
   - Purpose: funcionalidade + prevenção de fraude
   - Usuário pode apagar? Sim (Privacidade → Apagar)

8. Classificação (IARC)
   - Política: Sim (ativismo político)
   - Violência: Não
   - Idade recomendada: 12+
```

#### 2.4 Revisão para App Store
```
Envie para revisão:
App Store Connect → Versão → "Enviar para revisão"

Apple revisa:
- ✓ App roda sem crashes
- ✓ App Attest funciona
- ✓ Permissões declaradas usadas
- ✓ Diretrizes sobre locação (2.5.4)
  "Local de background é apenas durante sessão de ato"
- ✓ Diretrizes sobre privacidade (5.1.1)
  "Apagar dados funciona"

Status:
- Waiting for Review (6-48 h)
- In Review
- Ready for Sale (ou Rejected + motivo)
```

#### 2.5 Lançamento
```
App Store Connect → Versão
→ Quando tudo aprovado:
→ Release manually → Escolha a data
→ "Release This Version"

A versão sai na App Store em ~30 minutos
```

---

## Checklist Pré-Lançamento

### Código e Segurança
- [ ] `.env` tem secrets em 32+ chars (JWT_SECRET, DEVICE_ANCHOR_PEPPER)
- [ ] `APPLE_APP_ATTEST_ALLOW_DEVELOPMENT=false` em produção
- [ ] `TRUST_PROXY=true` se atrás de balanceador
- [ ] CDN/cache na frente de `GET /v1/events*` (milhares de pessoas)
- [ ] HTTPS/TLS em produção
- [ ] Rate limit Redis rodando e monitorado
- [ ] Postgres com backup diário

### App Store
- [ ] Bundle ID único (não br.org.manifestei.app.dev)
- [ ] Version e buildNumber sempre crescentes
- [ ] Screenshots em resolução correta (6.7")
- [ ] Privacy Manifest completo
- [ ] App Attest habilitado no App ID
- [ ] Permissão "Localização durante o uso" apenas

### Google Play
- [ ] SHA-256 do certificado em PLAY_INTEGRITY_ALLOWED_CERT_DIGESTS
- [ ] Service account com Play Integrity API
- [ ] Vídeo mostrando notificação de primeiro plano
- [ ] Declaração de dados correta (localização + ID sem rastreamento)

### API
- [ ] `npm run test:unit` passa 100%
- [ ] `npm run test:integration` testa ponta a ponta
- [ ] Logs não expõem tokens (já redactados)
- [ ] CORS permite apenas domínios do app
- [ ] Migrations testadas em banco limpo

### Mobile
- [ ] `npm run typecheck` sem erros
- [ ] `npm run verify:contract` app e servidor batem
- [ ] App abre em dispositivo físico (não emulador)
- [ ] Teste de 45 min simulado (mude para 1 min localmente)
- [ ] Battery drain < 2%/hora em modo standby

### Operacional
- [ ] Email de suporte funcionando (em `extra.supportEmail`)
- [ ] Política de privacidade online e atualizada
- [ ] Contacto legal para LGPD (ex: revisao@manifestei.org.br)
- [ ] Plano de escalabilidade (quantas leituras/segundo?)
- [ ] Monitoramento (alertas para Play Integrity rate limit, Postgres disco cheio)

### Documentação
- [ ] README.md atualizado
- [ ] API documentada (OpenAPI/Swagger — roadmap)
- [ ] Playbook para moderadores (aprovar/rejeitar atos)

---

## Roadmap Pós-Lançamento

### Curto Prazo (Mês 1)
- [ ] Monitorar crashes no Sentry ou Crashlytics
- [ ] Responder feedback no App Store e Play Store
- [ ] Aumentar cota de Play Integrity (padrão = 10k/dia)

### Médio Prazo (Meses 2-3)
- [ ] Localizações (i18n): pt-BR, es, en, etc
- [ ] Dashboard para organizadores (ver quem está no local, timeline em tempo real)
- [ ] OpenAPI/Swagger para documentação da API

### Longo Prazo
- [ ] BLE beacons de organizadores (leitura perto de âncora física)
- [ ] Android DeviceCheck (2 bits, melhor que ANDROID_ID)
- [ ] App Store review bot (detecção de fraude em tempo real)

---

**Data:** 25/10/2026  
**Versão:** 1.0.0

# Manifestei

Registro de presença em passeatas, manifestações e atos públicos, **sem cadastro**.

Quem está no ato toca em **"Estou no ato"**. Quem apoia de longe toca em **"Apoiar à distância"**.
Um toque cada, e cada aparelho conta **uma vez por ato**. Não há nome, telefone, e-mail nem
data de nascimento. O número de pessoas no local é o número principal; o apoio à distância
aparece separado, como número secundário.

Depois do toque, o app confere a localização **sozinho, a cada 15 minutos**, e a presença é
confirmada após **45 minutos no local**. Essas leituras também medem o **pico** do ato (quantas
pessoas ao mesmo tempo, e quando), **quando começou a esvaziar** e o **tempo médio** que as
pessoas ficaram.

> **Duas verdades antes de tudo**
>
> 1. **Nenhum sistema é impossível de fraudar.** O que este projeto faz é tornar a fraude
>    *cara*: cada registro exige um aparelho físico íntegro, o app oficial da loja e, para
>    contar como presente, estar **dentro da área** com GPS real. Robôs, emuladores, apps
>    de GPS falso e scripts são barrados; uma pessoa com 5 celulares no local ainda conta
>    5 vezes (veja [Riscos residuais](#riscos-residuais)).
> 2. **O número é de aparelhos verificados pelo app, não do público total.** O app diz isso
>    na tela do ato. É um *piso auditável*, não uma estimativa de multidão.

---

## Sumário

1. [Como funciona para quem usa](#como-funciona-para-quem-usa)
   - [Pico, queda e tempo médio](#pico-queda-e-tempo-médio)
2. [Stack](#stack)
3. [Arquitetura](#arquitetura)
4. [Lógica de segurança](#lógica-de-segurança) ← leia antes do código
5. [Estados da participação](#estados-da-participação)
6. [Modelo de dados](#modelo-de-dados)
7. [API](#api)
8. [Privacidade e LGPD](#privacidade-e-lgpd)
9. [Como rodar](#como-rodar)
10. [Publicação nas lojas](#publicação-nas-lojas)
11. [Riscos residuais](#riscos-residuais)
12. [Testes](#testes)

---

## Como funciona para quem usa

1. **Primeira vez:** uma tela explica o que é guardado e pede consentimento. Ao concordar, o
   app verifica o aparelho com a Apple/Google em segundo plano. Nenhum formulário.
2. **No ato:** abre o ato e toca em **"Estou no ato"**. O app lê o GPS na hora e mostra
   **EM VERIFICAÇÃO**, ou explica o que faltou (por exemplo, "você está a 480 m da área").
3. **Depois, nada:** a pessoa guarda o celular. O app faz uma leitura a cada 15 minutos, com a
   tela bloqueada ou o app em segundo plano. Na primeira leitura válida depois de 45 minutos, a
   presença vira **PRESENTE**. As leituras continuam enquanto ela fica, e param sozinhas quando
   ela sai da área (duas leituras seguidas fora) ou o ato termina.
4. **De longe:** toca em **"Apoiar à distância"**. Tocar de novo não conta de novo.
5. **Chegou depois?** Quem apoiou à distância pode tocar em "Estou no ato" ao chegar e passa
   a contar como presente (sai do apoio virtual). O contrário não acontece: quem foi
   confirmado no local nunca é rebaixado para virtual por engano.

**Automático, mas não escondido.** Enquanto o registro está ativo, o iOS mostra o indicador
azul de localização e o Android mostra uma notificação fixa ("Registrando sua presença no ato").
Isso é exigência dos dois sistemas para ler a localização com o app em segundo plano e é o
certo num app sobre participação política. A tela do ato diz, antes do toque, exatamente o que
vai acontecer, e tem o botão **"Parar registro automático"**.

### Pico, queda e tempo médio

Cada pessoa confirmada vira um intervalo: da **primeira** à **última** leitura válida no local.
A saída real aconteceu entre a última leitura e a seguinte; usamos o ponto médio (última
leitura + 7,5 min), o que dá erro de ±7,5 min por pessoa e nenhum viés no total. Somando os
intervalos a cada 5 minutos (`domain/timeline.ts`):

| Número | Como sai |
|---|---|
| **Pico** | maior quantidade de pessoas no local ao mesmo tempo, e o horário em que foi atingido |
| **Começou a esvaziar** | primeiro momento abaixo do pico depois da última vez em que o pico foi atingido |
| **Tempo médio** (e mediana) | média dos intervalos; durante o ato, quem ainda está conta "até agora" |

Só entra quem foi **confirmado** (45 min ou mais). Quem passou menos tempo aparece à parte,
como "ficaram menos tempo que o necessário para confirmar". Com **menos de 10 pessoas
confirmadas** a linha do tempo não é publicada: em atos pequenos, horários de chegada e saída
poderiam identificar alguém.

---

## Stack

| Camada | Escolha | Por quê |
|---|---|---|
| App (iOS + Android) | **Expo SDK 58 / React Native 0.88**, TypeScript, Expo Router | Um código para as duas lojas, com build nativo real (EAS) e módulos nativos próprios. |
| Módulo nativo | **Swift** (`DCAppAttestService`, `CoreLocation`) e **Kotlin** (Play Integrity Standard API, `FusedLocationProviderClient`) | Atestação de hardware e leitura de GPS **sem passar por JS**: o JS não consegue "inventar" um fix. |
| API | **Node 22 + Fastify 5**, TypeScript estrito, Zod | Rápida, tipada ponta a ponta, validação em toda entrada. |
| Banco | **PostgreSQL 16 + PostGIS 3** | Geocerca calculada no banco em metros reais (`geography`), não em graus. |
| Efêmeros | **Redis 7** | Desafios de uso único (GETDEL atômico), rate limit, bloqueios com prazo. |
| Segundo plano | **expo-location + expo-task-manager** | iOS: modo de fundo `location` (sem pedir "Sempre"). Android: serviço em primeiro plano com notificação, sem `ACCESS_BACKGROUND_LOCATION`. |

Não há provedor de SMS: o cadastro por telefone foi removido.

## Arquitetura

```
┌──────────────────────── App (Expo) ────────────────────────┐
│ app/            telas (Expo Router)                        │
│ src/features    identidade, presença, registro automático │
│ src/security    atestação, matrícula, payload assinado     │
│ src/data        HTTP, sessão, Keychain/Keystore            │
│ modules/manifestei-integrity  ← Swift + Kotlin             │
└───────────────┬────────────────────────────────────────────┘
                │ HTTPS  (payload + token de atestação)
┌───────────────▼──────────── API (Fastify) ─────────────────┐
│ interfaces/http   rotas, Zod, erros → HTTP                 │
│ application       casos de uso + PORTAS (interfaces)       │
│ domain            regras puras: presença, área, payload    │
│ infrastructure    Postgres, Redis, Apple, Google           │
└──────┬─────────────┬──────────────┬───────────────┬────────┘
   PostGIS        Redis     Apple App Attest   Google Play Integrity
```

**Clean Architecture:** `domain/` não importa nada de fora; `application/` só conhece interfaces
(`ports.ts`); `infrastructure/` implementa as portas; `container.ts` é o único lugar que conhece
classes concretas. A regra de presença inteira (`domain/presence.ts`) é testada como função pura.

```
manifestei/
├── backend/
│   ├── migrations/            001 esquema+PostGIS · 002 consentimento/exclusão · 003 identidade por aparelho
│   ├── src/domain/            presence.ts, timeline.ts, event-area.ts, signed-payload.ts
│   ├── src/application/       ports.ts, use-cases/{auth,account,events,presence,timeline}.ts
│   ├── src/infrastructure/    attestation/{apple-app-attest,play-integrity}.ts, db/, redis.ts
│   ├── src/interfaces/http/   server.ts, schemas.ts
│   └── test/                  unit/ + integration/ (Postgres+PostGIS+Redis reais)
├── mobile/
│   ├── app/                   (onboarding) consentimento; (app) atos, ato, novo ato, privacidade
│   ├── src/security/          enrollment.ts, attestation.ts, signedPayload.ts, location.ts
│   ├── src/features/          identity/, presence/{confirmPresence,presenceSession,sessionRules,presenceTask}.ts
│   ├── src/ui/                componentes, PresenceTimelineChart.tsx
│   ├── index.ts               registra a tarefa de segundo plano antes das telas
│   └── modules/manifestei-integrity/  ios/*.swift, android/*.kt
├── docker-compose.yml
└── .github/workflows/ci.yml
```

---

## Lógica de segurança

### O princípio

**O app não decide nada.** Ele coleta, assina e mostra o veredito. Toda decisão é do servidor,
porque qualquer código no celular pode ser modificado por quem controla o aparelho.

### "Uma vez por ato" sem cadastro: a identidade é o aparelho

Sem nome nem telefone, quem garante que ninguém registra duas vezes é o **aparelho**:

| | Âncora do aparelho | Sobrevive a reinstalar? | Muda quando |
|---|---|---|---|
| Android | `ANDROID_ID` (único por app + aparelho + usuário do Android, desde o Android 8) | Sim | Restauração de fábrica |
| iOS | UUID no **Keychain** com `THIS_DEVICE_ONLY` | Sim | Apagar o iPhone |

1. Na primeira abertura, o app manda a âncora **dentro de um payload atestado** pela Apple
   (App Attest) ou pelo Google (Play Integrity). Só o app oficial, num aparelho íntegro,
   consegue produzir esse payload; um emulador ou script não consegue inventar âncoras.
2. O servidor guarda apenas `HMAC-SHA256(pepper, plataforma:âncora)`. Sem o pepper, que fica
   fora do banco, não dá para descobrir de qual aparelho se trata nem cruzar com outro sistema.
3. A presença e o apoio são registrados com `UNIQUE(ato, participante)`. Reinstalar o app
   devolve **a mesma** identidade, então não adianta.

**Por que não MAC address:** desde o iOS 7 e o Android 6 os apps recebem `02:00:00:00:00:00`, e o
Android 10+ randomiza o MAC. Além de não funcionar, seria um identificador de hardware em claro.

**Aparelho reprovado na atestação não entra em nenhuma contagem**, nem como apoio virtual. Sem
prova de que é um aparelho real, não há como garantir "uma vez só" (um emulador fabrica quantas
âncoras quiser). Ele continua podendo ver os atos e os totais.

### Cada leitura (a do toque e as automáticas)

```
 App                                          Servidor
  │ 1. POST /presence/challenge  ───────────▶  256 bits aleatórios, TTL 120 s,
  │                              ◀───────────  escopo = (participante, ato)
  │ 2. GPS nativo, sem cache
  │    Android: Location.isMock()
  │    iOS: sourceInformation.isSimulatedBySoftware / isProducedByAccessory
  │ 3. payload canônico:
  │    mf1|presence|ato|desafio|instalação|lat|lng|precisão|timestamp|mock
  │ 4. atestação sobre SHA-256(payload)
  │    iOS: App Attest assertion (chave no Secure Enclave)
  │    Android: Play Integrity token com requestHash
  │ 5. POST /presence {campos + atestação} ──▶  a. consome o desafio (uso único)
  │                                             b. aparelho é deste participante e está ativo?
  │                                             c. RECONSTRÓI o payload com o installationId
  │                                                que ELE guardou na matrícula
  │                                             d. verifica a atestação contra esse payload
  │                                             e. geocerca no PostGIS, precisão, idade do fix
  │                                             f. velocidade desde a última leitura (qualquer ato)
  │                              ◀───────────  g. veredito → PRESENTE, apoio virtual ou "tente de novo"
```

O ponto central é o passo **c**: o servidor nunca aceita um hash vindo do cliente. Se um app
modificado ler a coordenada real, atestar e depois trocar a coordenada, o hash reconstruído
não bate com o que a Apple/Google assinou → `PAYLOAD_TAMPERED` → apoio virtual.

### Camadas de defesa

| Ameaça | Defesa | Onde |
|---|---|---|
| Mesma pessoa registrar duas vezes | Identidade = HMAC da âncora do aparelho; `UNIQUE(ato, participante)`; reinstalar devolve a mesma identidade | `auth.ts`, migrações |
| Apagar os dados e registrar de novo no mesmo ato | Registro anônimo continua contando; a âncora fica bloqueada para nova identidade por 26 h | `account.ts` |
| Emulador / simulador | Play Integrity exige `MEETS_DEVICE_INTEGRITY`; App Attest não existe no Simulador → sem identidade | `play-integrity.ts`, `auth.ts` |
| Root / jailbreak | Veredito de integridade do Google; `PLAY_INTEGRITY_REQUIRE_STRONG` exige atestação por hardware | `play-integrity.ts` |
| APK modificado, app fora da loja | `PLAY_RECOGNIZED` + SHA-256 do certificado; iOS: `rpIdHash = SHA256(TEAM.BUNDLE)` | ambos verificadores |
| Script/robô chamando a API direto | Sem token de atestação não há identidade nem presença | `auth.ts`, `presence.ts` |
| App de GPS falso | `isMock()` (Android) e `isSimulatedBySoftware` (iOS) lidos no código nativo e assinados junto | módulo nativo |
| GPS por acessório externo | `isProducedByAccessory` tratado como simulado | Swift |
| Adulterar coordenada depois de assinar | Servidor reconstrói o payload; assinatura não confere | `signed-payload.ts` |
| Replay de requisição | Desafio de uso único + contador monotônico do App Attest com compare-and-set | `redis.ts`, `device-repository.ts` |
| Fazenda de robôs / automação | `recentDeviceActivity = LEVEL_4` e app desconhecido controlando a tela (`UNKNOWN_CONTROLLING`) | `play-integrity.ts` |
| "Teletransporte" (fix forjado em outro lugar) | Velocidade mínima implícita entre leituras, descontando a imprecisão do GPS, **inclusive entre atos** | `presence.ts` |
| Organizador "aumentar a cerca" | Raio ≤ 1,5 km, faixa ≤ 300 m, trajeto ≤ 25 km; área **imutável** | `event-area.ts` |
| Inflação coordenada além do possível | Teto físico = área × 4 pessoas/m²; acima disso o ato é sinalizado publicamente | `event-area.ts` |
| "Tentar até passar" | Rebaixamento por fraude é **definitivo** naquele ato | `domain/presence.ts` |
| Passar pela área sem participar | Duas leituras válidas com ≥ 45 min; leituras automáticas a cada 15 min, todas atestadas | `domain/presence.ts`, `presenceSession.ts` |
| Multidão atrás do mesmo IP (CGNAT da operadora) | Rate limit por sessão, não por IP; rotas anônimas com teto alto | `server.ts` |

### Fraude × leitura ruim

| Fraude → apoio virtual, definitivo no ato | Leitura ruim → não conta, não pune, toque de novo |
|---|---|
| atestação inválida, integridade do aparelho/app, payload adulterado, GPS simulado, velocidade impossível | precisão > 50 m, fora da área (o app mostra a distância), fora do horário, fix velho, Apple/Google fora do ar |

Sinais de fraude são checados **antes** dos de leitura ruim: GPS falso fora da área é fraude.

### O que foi descartado e por quê

- **Telefone/SMS**: no Brasil o chip pré-pago é cadastrado no CPF. Guardar telefones criaria uma
  lista de quem foi a cada ato ligada à identidade civil. A âncora do aparelho dá o mesmo "uma
  vez por pessoa" para quem tem um celular, sem esse risco.
- **Login com gov.br/CPF**: mesmo motivo, ainda mais direto.
- **Varredura de Wi-Fi/Bluetooth**: o iOS não tem API pública para isso e o Android limita a 4
  varreduras a cada 2 minutos. O sistema já usa Wi-Fi e torres internamente para o GPS.
- **Localização "Sempre" / rastreamento contínuo**: o registro automático NÃO usa a permissão
  "Sempre" nem `ACCESS_BACKGROUND_LOCATION`. Ele só existe numa sessão iniciada pelo toque, presa
  a um ato, com aviso visível, e termina sozinho. Coleta permanente exigiria permissão "Sempre",
  revisão mais dura nas lojas e seria rastreamento, não registro de presença.

---

## Estados da participação

```
                toque válido          leituras automáticas a cada 15 min
  (nenhum) ───────────────────▶ EM VERIFICAÇÃO ─────────────────────────────▶ PRESENTE
     │                                │        (2ª leitura válida com ≥ 45 min)    │
     │ "Apoiar à distância"           │ sinal de fraude                           │ sinal de fraude
     ▼                                ▼                                           ▼
  APOIO VIRTUAL ── toque válido ──▶ EM VERIFICAÇÃO           APOIO VIRTUAL (rebaixado) — definitivo
  (declarado)       no local
```

- Leitura inconclusiva (fora da área, GPS fraco) **não cria registro** e não pune.
- Depois de PRESENTE, as leituras continuam só para medir a permanência.
- "Apoiar à distância" é idempotente e **nunca** rebaixa quem já está como PRESENTE.

Tudo é configurável no servidor (o app lê as regras da API):

```env
PRESENCE_MIN_SAMPLES=2               # 1 = a primeira leitura confirma
PRESENCE_MIN_DWELL_MINUTES=45        # 60 para exigir uma hora
PRESENCE_SAMPLE_INTERVAL_MINUTES=15  # menor = pico mais preciso, mais bateria e mais cota
```

---

## Modelo de dados

```
users  (participante anônimo = um aparelho verificado)
  id, anchor_hash  ← HMAC da âncora, UNIQUE
  consent_version, consented_at
   ├──< sessions             (refresh token só como SHA-256, rotativo)
   ├──< devices              (1 ativo; installation_id, App Attest key/contador)
   └──< events (organizer_id, ON DELETE SET NULL)
          area geography(Polygon)  ← círculo ou trajeto com faixa, imutável
          starts_at/ends_at (≤ 24 h)
             │
attendance_records ──────────┘  UNIQUE(event_id, user_id)
  status: CONFIRMED_ON_SITE | VIRTUAL_SUPPORTER | PENDING_ON_SITE (só no modo permanência)
  virtual_reason (DECLARED_BY_USER ou o motivo da fraude)
     │
  first_valid_sample_at, last_valid_sample_at  ← base do pico e do tempo médio
     │
     └──< presence_samples   (cada leitura; APAGADAS 72 h após o fim do ato)
            verdict VALID|INCONCLUSIVE|FRAUD, reason, accuracy_m, distance_to_area_m, location
```

---

## API

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/v1/enroll/challenge` | — | Desafio para a matrícula do aparelho |
| POST | `/v1/enroll` | — | Matrícula atestada `{platform, installationId, deviceAnchor, consentVersion, challenge, attestation}` → sessão |
| POST | `/v1/auth/refresh` | — | Rotação do refresh token |
| GET | `/v1/me` | ✓ | Situação do aparelho |
| DELETE | `/v1/me` | ✓ | Apagar meus dados (anonimiza presenças) |
| GET | `/v1/events` | — | Atos ao vivo e próximos, com totais |
| GET | `/v1/events/:id` | — | Ato, área (GeoJSON), totais, teto físico |
| GET | `/v1/events/:id/timeline` | — | Pessoas no local a cada 5 min, pico, início da queda, tempo médio e mediana (agregado; suprimido com < 10 confirmados) |
| POST | `/v1/events` | ✓ | Cria ato (máx. 5/dia por aparelho) |
| POST | `/v1/events/:id/cancel` | ✓ | Só quem organizou |
| GET | `/v1/events/:id/me` | ✓ | Sua situação neste ato |
| POST | `/v1/events/:id/presence/challenge` | ✓ | Desafio de presença |
| POST | `/v1/events/:id/presence` | ✓ | Leitura atestada (o toque e as automáticas) |
| POST | `/v1/events/:id/virtual-support` | ✓ | "Apoiar à distância" (idempotente) |

As rotas públicas **nunca** retornam quem organizou ou quem participou: só totais.

---

## Privacidade e LGPD

Participar de um ato revela **opinião política**, dado pessoal sensível (art. 5º, II).

- **Sem cadastro**: nenhum nome, telefone, e-mail ou data de nascimento existe no sistema.
- **Consentimento específico e destacado** (art. 11, I): tela própria na primeira abertura;
  a versão aceita é registrada e exigida pela API (`CONSENT_VERSION`).
- **Minimização**: o aparelho vira um HMAC. A localização só é lida depois do toque em "Estou
  no ato" e só enquanto a pessoa está na área. 72 h após o fim do ato, **todas as leituras
  individuais são apagadas** (`npm run purge:locations` de hora em hora); ficam só o resultado
  e dois horários (chegada e última leitura), o mínimo para o pico e o tempo médio.
- **Agregação com limiar**: a linha do tempo só é publicada com 10 ou mais pessoas confirmadas.
- **Sem lista de participantes**: nem quem organiza vê quem foi.
- **Apagar meus dados** (art. 18, VI): corta o vínculo aparelho↔presença (o registro fica
  anônimo, art. 12) e apaga sessões, aparelhos e coordenadas. A contagem do ato não muda.
- **Revisão de decisão automatizada** (art. 20): o motivo da recusa aparece na tela, com botão
  para pedir revisão humana (e-mail em `extra.supportEmail`).
- O HMAC da âncora fica 26 h num bloqueio com prazo após "apagar meus dados", só para impedir
  contagem dupla. Registre isso na política de privacidade.

---

## Como rodar

### API

```bash
docker compose up -d                       # Postgres+PostGIS e Redis
cd backend
cp .env.example .env                       # gere segredos: openssl rand -base64 48
curl -fsSL -o certs/Apple_App_Attestation_Root_CA.pem \
  https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
npm ci && npm run migrate
npm run dev
```

Produção: `docker build -t manifestei-api backend/`, `APPLE_APP_ATTEST_ALLOW_DEVELOPMENT=false`
(a API se recusa a subir em produção com App Attest de desenvolvimento), TLS no balanceador,
`TRUST_PROXY=true`, e **CDN/cache na frente de `GET /v1/events*`**: num ato grande, milhares de
pessoas atualizam o total ao mesmo tempo.

### App

O app usa módulo nativo próprio, então **não roda no Expo Go**: use um development build.

```bash
cd mobile
npm ci
export MANIFESTEI_API_URL=https://sua-api
export PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER=123456789012
export GOOGLE_MAPS_ANDROID_API_KEY=...
npx expo run:android            # ou: npx expo run:ios  (Mac com Xcode)
eas build -p android --profile production
eas build -p ios --profile production
```

Para testar de verdade é preciso **aparelho físico** instalado pela loja (Play: teste interno;
iOS: TestFlight). Emulador e Simulador são, por desenho, recusados.

---

## Publicação nas lojas

### Google Play
1. Play Console → **Integridade do app** → vincule um projeto do Google Cloud e ative a
   *Play Integrity API*. Use o **número** do projeto em `PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER`.
2. **Peça aumento de cota da Play Integrity antes do primeiro ato grande.** O padrão é
   10.000 requisições/dia e **cada leitura usa uma**. Conta aproximada: pessoas × (1 + 4 por hora
   no ato). Um ato com 100 mil pessoas no Android ficando 4 horas ≈ 1,7 milhão de leituras.
   Para reduzir, aumente `PRESENCE_SAMPLE_INTERVAL_MINUTES`.
3. **Declaração de serviço em primeiro plano** (Play Console → Conteúdo do app): tipo
   `location`, finalidade "registrar presença em um evento iniciado pelo usuário", com vídeo
   mostrando o toque, a notificação e o botão de parar.
4. Service account com acesso à Play Integrity API → `GOOGLE_SERVICE_ACCOUNT_JSON`.
5. SHA-256 do certificado de **assinatura do app** (Play App Signing) em
   `PLAY_INTEGRITY_ALLOWED_CERT_DIGESTS` (aceita o formato `AB:CD:…` do Console).
6. Ative as respostas opcionais **app access risk** e **recent device activity**.
7. **Segurança dos dados**: *Localização precisa* (inclusive em segundo plano, durante o ato) e *IDs do dispositivo*, coletados, não
   compartilhados, criptografados em trânsito, com exclusão no app. Finalidade: funcionalidade
   do app e prevenção de fraude.
8. Declare o link web para exclusão de dados (exigência da Play).

### App Store
1. Developer → Identifiers → habilite **App Attest** no App ID.
2. `APPLE_TEAM_ID` e `APPLE_BUNDLE_ID` na API; entitlement `production` já está no `app.config.ts`.
3. **Privacy Nutrition Label**: Localização precisa e Identificador do dispositivo, **não**
   vinculados à identidade, sem rastreamento. O `PrivacyInfo.xcprivacy` sai do `app.config.ts`.
4. Exclusão dentro do app (Diretriz 5.1.1(v)): *Privacidade → Apagar meus dados*.
5. **Modo de fundo "location"** (Diretriz 2.5.4): nas notas para a revisão, explique que a
   localização em segundo plano só é usada depois que a pessoa toca em "Estou no ato", para
   confirmar presença e medir permanência, com o indicador azul visível e o botão de parar.
   O app pede só "Durante o uso", nunca "Sempre". O plugin `withLocationOnlyBackgroundMode`
   remove o modo `fetch`, que o app não usa.

---

## Riscos residuais

| Risco | Situação | Mitigação possível |
|---|---|---|
| Uma pessoa com vários celulares **no local** | Conta uma vez por aparelho | Inerente a qualquer sistema sem identificação civil |
| Android com vários usuários/perfil de trabalho no mesmo celular | Cada perfil tem outro `ANDROID_ID` | Play Integrity *device recall* (bits por aparelho físico) quando sair do beta |
| Restaurar de fábrica / apagar o iPhone | Gera nova identidade (custa ~30 min e apaga o celular) | Apple DeviceCheck (2 bits por aparelho físico) |
| Root com ocultação avançada | Pode passar `MEETS_DEVICE_INTEGRITY` | `PLAY_INTEGRITY_REQUIRE_STRONG=true` (exclui aparelhos antigos/sem patch) |
| Jailbreak no iOS | App Attest prova o app, não a ausência de jailbreak; hooks podem alterar GPS/Keychain | Jailbreak público é raro nos iOS atuais; RASP comercial se o risco justificar |
| Falsificador de sinal GPS por rádio | Caro, ilegal e localizado | Âncoras BLE de organizador (roadmap) |
| Quem só "passa de carro" pela área | Não é confirmado: precisa de 45 min no local | — |
| App fechado à força (deslizar para cima no iPhone) | As leituras param até a pessoa abrir o app de novo; o registro é religado ao abrir | Texto na tela pedindo para deixar o app em segundo plano |
| Economia de bateria agressiva de alguns fabricantes Android | Pode matar o serviço em primeiro plano | Religado ao abrir o app; orientar a liberar o Manifestei da otimização de bateria |

---

## Testes

```bash
cd backend
npm run test:unit
TEST_DATABASE_URL=postgres://... TEST_REDIS_URL=redis://... npm test   # + ponta a ponta via HTTP

cd mobile
npm run typecheck
npm run verify:contract     # app e servidor geram o MESMO payload assinado
```

`npm run verify:session` testa as regras da sessão automática (quando ler de novo, quando
parar). O teste `dwell-timeline` simula 13 pessoas num ato de duas horas (chegadas em horários
diferentes, leituras a cada 15 min, saídas) e confere confirmação aos 45 min, pico às 14h15,
queda às 14h55, tempo médio de 75 min e que ninguém com menos de 45 min entra na conta.

O teste `presence-flow` (modo um toque) cobre, contra PostGIS e Redis reais: consentimento obrigatório;
emulador sem identidade; um toque confirma; tocar de novo não conta; **reinstalar devolve a
mesma identidade**; GPS falso (definitivo); payload adulterado; replay; fora da área (não
pune, informa a distância); provedor fora do ar; teletransporte no mesmo ato e entre atos;
apoio à distância idempotente; apoio → presente; presente não vira apoio; contagem final
exata; apagar dados com anonimização e bloqueio; **nenhum identificador em claro no banco**;
retenção de coordenadas.

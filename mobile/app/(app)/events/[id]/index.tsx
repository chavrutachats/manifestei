import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { config } from '../../../../src/config';
import {
  useCancelEvent,
  useConfirmPresence,
  useDeclareVirtualSupport,
  useEvent,
  useEventTimeline,
  useMyAttendance,
} from '../../../../src/data/queries';
import {
  formatArea,
  formatClock,
  formatDistance,
  formatDuration,
  formatEventWhen,
  isCheckInOpen,
} from '../../../../src/domain/format';
import {
  INCONCLUSIVE_TEXT,
  STAMP_TEXT,
  VIRTUAL_REASON_TEXT,
  isFraudReason,
  stampToneFor,
} from '../../../../src/domain/presenceCopy';
import type { EventTimeline, InconclusiveReason, MyAttendance, PresenceSampleResult, ProtestEvent } from '../../../../src/domain/types';
import { useIdentity } from '../../../../src/features/identity/IdentityProvider';
import { startPresenceSession, stopPresenceSession, type PresenceSession } from '../../../../src/features/presence/presenceSession';
import { usePresenceSessionState } from '../../../../src/features/presence/usePresenceSessionState';
import { color, space, type } from '../../../../src/theme';
import { EventAreaMap } from '../../../../src/ui/EventAreaMap';
import { PresenceTimelineChart, PresenceTimelineTable } from '../../../../src/ui/PresenceTimelineChart';
import {
  Button,
  CountBlock,
  ErrorState,
  Gap,
  H1,
  H2,
  Loading,
  Notice,
  P,
  Rule,
  Screen,
  Stamp,
  formatInt,
} from '../../../../src/ui/components';

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const identity = useIdentity();
  const ready = identity.status === 'ready';
  const event = useEvent(id);
  const mine = useMyAttendance(id, ready);
  const confirm = useConfirmPresence(id);
  const support = useDeclareVirtualSupport(id);
  const cancel = useCancelEvent(id);
  const session = usePresenceSessionState(id);
  const [sessionError, setSessionError] = useState<string | null>(null);

  if (event.isLoading) return <Loading />;
  if (event.isError || !event.data) return <ErrorState message="Ato não encontrado." onRetry={() => void event.refetch()} />;

  const e = event.data;
  const me = mine.data;
  const status = me?.status ?? 'NONE';
  const fraud = status === 'VIRTUAL_SUPPORTER' && isFraudReason(me?.virtualReason ?? null);
  const sessionActive = !!session && !session.ended;
  const busy = confirm.isPending || support.isPending;

  // Um toque: lê agora e, se valeu, liga o registro automático (precisa ser com o app na tela).
  const tapImHere = () =>
    confirm.mutate(undefined, {
      onSuccess: (result) => {
        if (result.sample.verdict !== 'VALID') return;
        if (result.status !== 'PENDING_ON_SITE' && result.status !== 'CONFIRMED_ON_SITE') return;
        setSessionError(null);
        startPresenceSession(e, result).catch(() =>
          setSessionError(
            'Não foi possível ligar o registro automático. Sua leitura de agora valeu; abra o app de novo mais tarde para continuar.',
          ),
        );
      },
    });

  // Presencial vale mais: "Estou no ato" segue disponível para quem apoiou à distância.
  const canConfirm = ready && isCheckInOpen(e) && !fraud && !sessionActive && !(status === 'CONFIRMED_ON_SITE' && session?.ended);
  const canSupport = ready && (e.phase === 'LIVE' || e.phase === 'UPCOMING') && status === 'NONE';
  const imHereLabel =
    status === 'PENDING_ON_SITE' ? 'Retomar verificação' : status === 'CONFIRMED_ON_SITE' ? 'Voltar a registrar' : 'Estou no ato';

  const confirmCancel = () =>
    Alert.alert('Cancelar este ato?', 'O registro de presença será fechado para todos. Isso não pode ser desfeito.', [
      { text: 'Voltar', style: 'cancel' },
      { text: 'Cancelar ato', style: 'destructive', onPress: () => cancel.mutate() },
    ]);

  const requestReview = () =>
    void Linking.openURL(
      `mailto:${config.supportEmail}?subject=${encodeURIComponent('Revisão de presença')}&body=${encodeURIComponent(
        `Ato: ${e.title}\nID do ato: ${e.id}\nMotivo informado: ${me?.virtualReason ?? ''}\n\nConte o que aconteceu:`,
      )}`,
    );

  return (
    <Screen
      footer={
        canConfirm || canSupport ? (
          <>
            {canConfirm ? (
              <Button
                label={confirm.isPending ? 'Verificando aparelho e localização…' : imHereLabel}
                loading={confirm.isPending}
                disabled={busy}
                onPress={tapImHere}
                accessibilityHint="Lê sua localização agora e liga a verificação automática enquanto você estiver no ato"
              />
            ) : null}
            {canSupport ? (
              <Button tone="secondary" label="Apoiar à distância" loading={support.isPending} disabled={busy} onPress={() => support.mutate()} />
            ) : null}
          </>
        ) : null
      }
    >
      <Stack.Screen options={{ title: e.phase === 'LIVE' ? 'Ao vivo' : '' }} />
      <H1>{e.title}</H1>
      <Gap h={space.xs} />
      <P muted>{[e.city, formatEventWhen(e.startsAt, e.endsAt)].filter(Boolean).join(', ')}</P>
      {e.phase === 'CANCELLED' ? (
        <>
          <Gap />
          <Notice tone="warn">Este ato foi cancelado por quem o organizou.</Notice>
        </>
      ) : null}

      {/* O número que importa: gente no local. O apoio à distância é secundário, em uma linha. */}
      <Gap h={space.lg} />
      <CountBlock
        emphasis
        value={e.counts.confirmedOnSite}
        label={e.phase === 'ENDED' ? 'pessoas estiveram no ato' : 'pessoas confirmadas no ato'}
      />
      <Text style={styles.secondaryLine}>
        <Text style={styles.secondaryNumber}>{formatInt(e.counts.virtualSupporters)}</Text> apoiando à distância
        {e.counts.pendingOnSite > 0 ? (
          <>
            {', '}
            <Text style={styles.secondaryNumber}>{formatInt(e.counts.pendingOnSite)}</Text>
            {e.phase === 'ENDED' ? ' ficaram menos tempo que o necessário para confirmar' : ' chegando (em verificação)'}
          </>
        ) : null}
      </Text>
      <Text style={styles.footnote}>
        Cada aparelho verificado conta uma vez, e só depois de {me?.minDwellMinutes ?? 45} minutos no local. É o número de
        pessoas confirmadas pelo app, não uma estimativa do público total.
        {e.counts.downgradedForFraud > 0
          ? ` ${formatInt(e.counts.downgradedForFraud)} tentativa${e.counts.downgradedForFraud > 1 ? 's' : ''} com sinal de fraude ${e.counts.downgradedForFraud > 1 ? 'foram contadas' : 'foi contada'} só como apoio virtual.`
          : ''}
      </Text>
      {e.integrity.capacityAnomaly ? (
        <>
          <Gap h={space.sm} />
          <Notice tone="fraud">
            O número de presentes passou do máximo fisicamente possível para esta área. A contagem está sob análise.
          </Notice>
        </>
      ) : null}

      <YourParticipation
        event={e}
        identityStatus={identity.status}
        identityError={identity.error}
        onRetryIdentity={() => void identity.retry()}
        me={me ?? null}
        session={session}
        last={confirm.data?.sample ?? null}
        error={sessionError ?? confirm.error?.message ?? support.error?.message ?? null}
        canConfirm={canConfirm}
        onStop={() =>
          Alert.alert('Parar o registro automático?', 'Se você ainda não completou o tempo mínimo, sua presença não será confirmada.', [
            { text: 'Continuar registrando', style: 'cancel' },
            { text: 'Parar', style: 'destructive', onPress: () => void stopPresenceSession('STOPPED_BY_USER') },
          ])
        }
        onRequestReview={requestReview}
      />

      {e.phase === 'LIVE' || e.phase === 'ENDED' ? <ActOverTime eventId={e.id} live={e.phase === 'LIVE'} /> : null}

      <Rule style={{ marginVertical: space.lg }} />
      <EventAreaMap area={e.area} />
      <Text style={styles.footnote}>
        {e.areaKind === 'route' ? 'Trajeto da passeata' : 'Área de concentração'}: {formatArea(e.integrity.areaM2)}. A área não
        pode ser alterada depois de criada.
      </Text>

      {e.description ? (
        <>
          <Gap h={space.lg} />
          <P>{e.description}</P>
        </>
      ) : null}

      {me?.isOrganizer && (e.phase === 'LIVE' || e.phase === 'UPCOMING') ? (
        <>
          <Gap h={space.xl} />
          <Button tone="danger" label="Cancelar ato" loading={cancel.isPending} onPress={confirmCancel} />
        </>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------- sua participação

const ENDED_TEXT: Record<NonNullable<PresenceSession['ended']>['reason'], (at: string) => string> = {
  LEFT_AREA: (at) => `Registro automático encerrado às ${at}, quando você saiu da área do ato.`,
  EVENT_ENDED: () => 'Registro automático encerrado com o fim do ato.',
  STOPPED_BY_USER: (at) => `Você parou o registro automático às ${at}.`,
  DOWNGRADED: () => 'Registro automático encerrado.',
  PERMISSION: () => 'Registro automático parado: a permissão de localização precisa foi retirada.',
  DEVICE_UNTRUSTED: () => 'Registro automático parado: o aparelho não passou na verificação de integridade.',
};

function YourParticipation(p: {
  event: ProtestEvent;
  identityStatus: ReturnType<typeof useIdentity>['status'];
  identityError: string | null;
  onRetryIdentity: () => void;
  me: MyAttendance | null;
  session: PresenceSession | null;
  last: PresenceSampleResult['sample'] | null;
  error: string | null;
  canConfirm: boolean;
  onStop: () => void;
  onRequestReview: () => void;
}) {
  if (p.identityStatus === 'enrolling') {
    return (
      <>
        <Rule style={{ marginVertical: space.lg }} />
        <P muted>Verificando este aparelho com a Apple/Google…</P>
      </>
    );
  }
  if (p.identityStatus === 'untrusted' || p.identityStatus === 'error') {
    return (
      <>
        <Rule style={{ marginVertical: space.lg }} />
        <Notice tone={p.identityStatus === 'untrusted' ? 'fraud' : 'warn'}>{p.identityError ?? 'Não foi possível verificar o aparelho.'}</Notice>
        {p.identityStatus === 'error' ? (
          <>
            <Gap h={space.sm} />
            <Button tone="secondary" label="Tentar de novo" onPress={p.onRetryIdentity} />
          </>
        ) : null}
      </>
    );
  }

  const status = p.me?.status ?? 'NONE';
  const virtualReason = p.me?.virtualReason ?? null;
  const fraud = status === 'VIRTUAL_SUPPORTER' && isFraudReason(virtualReason);
  const active = !!p.session && !p.session.ended;
  const dwell = p.me?.minDwellMinutes ?? 45;
  const every = Math.round((p.me?.sampleIntervalSeconds ?? 900) / 60);
  const outside = p.last?.verdict === 'INCONCLUSIVE' && p.last.reason === 'OUTSIDE_AREA';
  const otherInconclusive = p.last?.verdict === 'INCONCLUSIVE' && !outside && p.last.reason;

  // Antes do primeiro toque: diz exatamente o que vai acontecer (transparência).
  if (status === 'NONE' && !p.last && !p.error) {
    if (!p.canConfirm) return null;
    return (
      <>
        <Rule style={{ marginVertical: space.lg }} />
        <P muted>
          Ao tocar em "Estou no ato", o app confere sua localização agora e depois sozinho a cada {every} minutos, mesmo com o
          celular no bolso. Sua presença é confirmada depois de {dwell} minutos no local. Um aviso do sistema fica visível
          enquanto isso acontece, e o registro para quando você sai da área ou o ato termina.
        </P>
      </>
    );
  }

  return (
    <>
      <Rule style={{ marginVertical: space.lg }} />
      {status !== 'NONE' ? (
        <>
          <Stamp size="small" text={STAMP_TEXT[status]} tone={stampToneFor({ status, virtualReason })} />
          <Gap h={space.sm} />
        </>
      ) : null}

      {status === 'PENDING_ON_SITE' && active && p.me?.confirmableAfter ? (
        <P>
          Confirmação automática por volta das {formatClock(p.me.confirmableAfter)}. Pode guardar o celular: o app confere sua
          localização a cada {every} minutos.
        </P>
      ) : null}
      {status === 'PENDING_ON_SITE' && !active ? (
        <P muted>
          Sua presença ainda não foi confirmada: são necessários {dwell} minutos no local. Toque em "Retomar verificação" se
          você ainda está no ato.
        </P>
      ) : null}
      {status === 'CONFIRMED_ON_SITE' ? (
        <P>
          Sua presença está somada ao total.
          {active ? ` O app segue conferindo a cada ${every} minutos enquanto você estiver aqui, para medir o pico e o tempo de permanência do ato.` : ''}
        </P>
      ) : null}
      {status === 'VIRTUAL_SUPPORTER' && !fraud ? (
        <P muted>Você está apoiando à distância. Se chegar ao ato, toque em "Estou no ato" para contar como presente.</P>
      ) : null}
      {fraud && virtualReason ? (
        <>
          <Notice tone="fraud">
            <Text style={styles.noticeTitle}>Sua presença foi registrada como apoio virtual.</Text>
            <Text style={styles.noticeBody}>{VIRTUAL_REASON_TEXT[virtualReason]}</Text>
            <Text style={styles.noticeBody}>Essa decisão vale para este ato. Se acha que foi um erro, peça revisão.</Text>
          </Notice>
          <Gap h={space.sm} />
          <Button tone="quiet" label="Pedir revisão" onPress={p.onRequestReview} />
        </>
      ) : null}

      {active ? (
        <View style={styles.sessionRow}>
          <View style={styles.liveDot} />
          <Text style={styles.sessionText}>
            Registro automático ativo. Próxima leitura às {formatClock(new Date(p.session!.nextReadingAt))}. Pode bloquear a tela;
            só não feche o app à força.
          </Text>
        </View>
      ) : null}
      {p.session?.ended && !fraud ? (
        <P muted style={{ marginTop: space.sm }}>
          {ENDED_TEXT[p.session.ended.reason](formatClock(new Date(p.session.ended.at)))}
        </P>
      ) : null}
      {p.session?.notice && active ? (
        <>
          <Gap h={space.sm} />
          <Notice tone="warn">{p.session.notice}</Notice>
        </>
      ) : null}

      {outside ? (
        <>
          <Gap h={space.sm} />
          <Notice tone="warn">
            {p.last?.distanceToAreaM
              ? `Você está a cerca de ${formatDistance(p.last.distanceToAreaM)} da área do ato. Chegue mais perto e toque de novo, ou apoie à distância.`
              : INCONCLUSIVE_TEXT.OUTSIDE_AREA}
          </Notice>
        </>
      ) : null}
      {otherInconclusive ? (
        <>
          <Gap h={space.sm} />
          <Notice tone="warn">{INCONCLUSIVE_TEXT[p.last!.reason as InconclusiveReason]}</Notice>
        </>
      ) : null}
      {p.error ? (
        <>
          <Gap h={space.sm} />
          <Notice tone="warn">{p.error}</Notice>
        </>
      ) : null}

      {active ? (
        <>
          <Gap h={space.sm} />
          <Button tone="quiet" label="Parar registro automático" onPress={p.onStop} />
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------- o ato ao longo do tempo

function ActOverTime({ eventId, live }: { eventId: string; live: boolean }) {
  const tl = useEventTimeline(eventId);
  const [showTable, setShowTable] = useState(false);
  if (!tl.data) return null;
  const t: EventTimeline = tl.data;

  return (
    <>
      <Rule style={{ marginVertical: space.lg }} />
      <H2>O ato ao longo do tempo</H2>
      <Gap h={space.sm} />
      {t.suppressed ? (
        <P muted>
          O pico e o tempo médio de permanência aparecem quando houver pelo menos {t.minPeople} pessoas confirmadas. Com menos
          gente, os horários poderiam identificar alguém.
        </P>
      ) : (
        <>
          <PresenceTimelineChart timeline={t} />
          <Gap h={space.md} />
          <Fact label="Pico">
            {t.peak ? `${formatInt(t.peak.onSite)} pessoas ao mesmo tempo, às ${formatClock(t.peak.at)}` : '—'}
          </Fact>
          <Fact label="Começou a esvaziar">
            {t.declineStartedAt ? `às ${formatClock(t.declineStartedAt)}` : live ? 'ainda não: o ato está no pico' : '—'}
          </Fact>
          <Fact label={live ? 'Tempo médio até agora' : 'Tempo médio no ato'}>
            {t.averageStayMinutes !== null ? formatDuration(t.averageStayMinutes) : '—'}
            {t.medianStayMinutes !== null ? `; metade ficou mais de ${formatDuration(t.medianStayMinutes)}` : ''}
          </Fact>
          <Text style={styles.footnote}>
            Calculado com as leituras automáticas a cada {t.sampleIntervalMinutes} minutos de {formatInt(t.people)} pessoas
            confirmadas. Margem de cerca de {Math.round(t.sampleIntervalMinutes / 2)} minutos em cada chegada e saída.
          </Text>
          <Gap h={space.sm} />
          <Button tone="quiet" label={showTable ? 'Esconder números' : 'Ver números a cada 30 minutos'} onPress={() => setShowTable((v) => !v)} />
          {showTable ? <PresenceTimelineTable timeline={t} /> : null}
        </>
      )}
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  secondaryLine: { fontSize: type.body, color: color.graphite, marginTop: space.sm, lineHeight: 23 },
  secondaryNumber: { color: color.ink, fontWeight: '700' },
  footnote: { fontSize: type.caption, lineHeight: 19, color: color.graphite, marginTop: space.sm },
  noticeTitle: { fontSize: type.body, fontWeight: '700', color: color.ink, marginBottom: space.xs },
  noticeBody: { fontSize: type.body - 1, lineHeight: 22, color: color.ink, marginTop: space.xs },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.stamp },
  sessionText: { flex: 1, fontSize: type.body - 1, color: color.ink },
  fact: { paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.rule },
  factLabel: { fontSize: type.caption, color: color.graphite },
  factValue: { fontSize: type.body, color: color.ink, marginTop: 2, fontWeight: '600' },
});

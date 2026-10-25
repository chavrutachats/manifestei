import { useMemo, useState } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { formatClock } from '../domain/format';
import type { EventTimeline } from '../domain/types';
import { color, space, type } from '../theme';
import { formatInt } from './components';

const HEIGHT = 132;
const MAX_COLUMNS = 48;
const GAP = 2;

interface Column {
  at: string;
  onSite: number;
}

/** Até 48 colunas; cada coluna leva o MÁXIMO do seu trecho, para o pico nunca sumir no resumo. */
function downsample(series: EventTimeline['series']): Column[] {
  const step = Math.max(1, Math.ceil(series.length / MAX_COLUMNS));
  const out: Column[] = [];
  for (let i = 0; i < series.length; i += step) {
    const chunk = series.slice(i, i + step);
    out.push({ at: chunk[0]!.at, onSite: Math.max(...chunk.map((p) => p.onSite)) });
  }
  return out;
}

/**
 * Pessoas no local ao longo do ato. Uma série, uma cor (a do carimbo); o pico tem
 * rótulo direto e o início da queda, uma linha de marcação. Tocar e arrastar mostra
 * o valor de cada momento.
 */
export function PresenceTimelineChart({ timeline }: { timeline: EventTimeline }) {
  const columns = useMemo(() => downsample(timeline.series), [timeline.series]);
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  const max = Math.max(1, ...columns.map((c) => c.onSite));
  const peakIdx = columns.findIndex((c) => c.onSite === max);
  const colW = columns.length ? width / columns.length : 0;
  const center = (i: number) => i * colW + colW / 2;

  // Posição pelo HORÁRIO exato (as colunas podem agrupar vários intervalos de 5 min).
  const t0 = columns[0] ? new Date(columns[0].at).getTime() : 0;
  const colSpanMs = columns[1] ? new Date(columns[1].at).getTime() - t0 : timeline.bucketMinutes * 60_000;
  const xAt = (iso: string) => ((new Date(iso).getTime() - t0) / (colSpanMs * columns.length)) * width;
  const declineX = timeline.declineStartedAt && width ? xAt(timeline.declineStartedAt) : null;

  const pick = (e: GestureResponderEvent) => {
    if (!colW) return;
    const i = Math.min(columns.length - 1, Math.max(0, Math.floor(e.nativeEvent.locationX / colW)));
    setSelected(i);
  };

  const shown = selected !== null ? columns[selected]! : null;
  const label = (x: number, text: string) => {
    // rótulo nunca sai da área do gráfico
    const w = 120;
    const left = Math.min(Math.max(0, x - w / 2), Math.max(0, width - w));
    return { left, width: w, text };
  };
  const peakLabel = peakIdx >= 0 && width ? label(center(peakIdx), `pico ${formatInt(max)}`) : null;

  return (
    <View>
      <Text style={styles.readout} accessibilityLiveRegion="polite">
        {shown ? `${formatClock(shown.at)}: ${formatInt(shown.onSite)} pessoas no local` : 'Toque e arraste no gráfico para ver cada horário'}
      </Text>

      <View
        style={[styles.plot, { height: HEIGHT + 22 }]}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={pick}
        onResponderMove={pick}
        onResponderRelease={() => setTimeout(() => setSelected(null), 2500)}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Gráfico de pessoas no local ao longo do ato. Pico de ${formatInt(max)} pessoas às ${
          peakIdx >= 0 ? formatClock(columns[peakIdx]!.at) : ''
        }.`}
      >
        {/* rótulo direto do pico */}
        {peakLabel && selected === null ? (
          <Text style={[styles.peakLabel, { left: peakLabel.left, width: peakLabel.width }]}>{peakLabel.text}</Text>
        ) : null}

        <View style={[styles.bars, { height: HEIGHT }]}>
          {/* linhas de grade recessivas: metade e topo */}
          <View style={[styles.grid, { bottom: HEIGHT / 2 }]} />
          <View style={[styles.grid, { bottom: HEIGHT - 1 }]} />

          {declineX !== null && declineX > 0 && declineX < width ? <View style={[styles.declineLine, { left: declineX }]} /> : null}

          {columns.map((c, i) => {
            const h = c.onSite === 0 ? 0 : Math.max(2, (c.onSite / max) * (HEIGHT - 4));
            const isSel = selected === i;
            return (
              <View key={c.at} style={{ width: colW, paddingHorizontal: GAP / 2, justifyContent: 'flex-end', height: HEIGHT }}>
                <View
                  style={{
                    height: h,
                    borderTopLeftRadius: 3,
                    borderTopRightRadius: 3,
                    backgroundColor: isSel ? color.ink : color.stamp,
                    opacity: selected === null || isSel ? 1 : 0.55,
                  }}
                />
              </View>
            );
          })}
        </View>
        <View style={styles.baseline} />
      </View>

      <View style={styles.axis}>
        <Text style={styles.axisLabel}>{columns[0] ? formatClock(columns[0].at) : ''}</Text>
        {timeline.declineStartedAt ? (
          <Text style={[styles.axisLabel, styles.axisDecline]}>começou a esvaziar às {formatClock(timeline.declineStartedAt)}</Text>
        ) : null}
        <Text style={styles.axisLabel}>{columns.at(-1) ? formatClock(columns.at(-1)!.at) : ''}</Text>
      </View>
    </View>
  );
}

/** Tabela equivalente ao gráfico (leitores de tela, impressão, quem prefere números). */
export function PresenceTimelineTable({ timeline, everyMinutes = 30 }: { timeline: EventTimeline; everyMinutes?: number }) {
  const step = Math.max(1, Math.round(everyMinutes / timeline.bucketMinutes));
  const rows = timeline.series.filter((_, i) => i % step === 0);
  return (
    <View accessibilityRole="list">
      {rows.map((r) => (
        <View key={r.at} style={styles.tableRow} accessible accessibilityLabel={`${formatClock(r.at)}, ${formatInt(r.onSite)} pessoas`}>
          <Text style={styles.tableTime}>{formatClock(r.at)}</Text>
          <Text style={styles.tableValue}>{formatInt(r.onSite)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { fontSize: type.caption, color: color.graphite, marginBottom: space.sm, minHeight: 18 },
  plot: { justifyContent: 'flex-end' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', position: 'relative' },
  grid: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: color.rule },
  baseline: { height: 1, backgroundColor: color.graphite, opacity: 0.4 },
  peakLabel: { position: 'absolute', top: 0, textAlign: 'center', fontSize: type.caption, fontWeight: '700', color: color.ink },
  declineLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: color.fraud, opacity: 0.7 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs },
  axisLabel: { fontSize: type.caption - 1, color: color.graphite },
  axisDecline: { color: color.fraud },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.rule,
  },
  tableTime: { fontSize: type.body - 1, color: color.graphite },
  tableValue: { fontSize: type.body - 1, color: color.ink, fontWeight: '600' },
});

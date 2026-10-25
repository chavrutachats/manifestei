import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, Polyline, type MapPressEvent, type Region } from 'react-native-maps';
import { ApiError } from '../../../src/data/http';
import { useCreateEvent } from '../../../src/data/queries';
import { parseLocalDateTime, pathLengthMeters } from '../../../src/domain/geo';
import { AREA_LIMITS, type GeoPoint } from '../../../src/domain/types';
import { roughPosition } from '../../../src/security/location';
import { color, radius, space, type } from '../../../src/theme';
import { Button, Field, Gap, H2, Notice, P, Screen } from '../../../src/ui/components';

type Kind = 'circle' | 'route';
const DURATIONS = [1, 2, 3, 4, 6, 8, 12];
const SAO_PAULO: Region = { latitude: -23.5614, longitude: -46.6559, latitudeDelta: 0.02, longitudeDelta: 0.02 };

const pad = (n: number) => String(n).padStart(2, '0');
const nextHour = () => {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
};

export default function NewEventScreen() {
  const start = nextHour();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [date, setDate] = useState(`${pad(start.getDate())}/${pad(start.getMonth() + 1)}/${start.getFullYear()}`);
  const [time, setTime] = useState(`${pad(start.getHours())}:00`);
  const [hours, setHours] = useState(3);
  const [kind, setKind] = useState<Kind>('circle');
  const [center, setCenter] = useState<GeoPoint | null>(null);
  const [radiusM, setRadiusM] = useState(300);
  const [path, setPath] = useState<GeoPoint[]>([]);
  const [widthM, setWidthM] = useState(60);
  const [region, setRegion] = useState<Region>(SAO_PAULO);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateEvent();

  useEffect(() => {
    void roughPosition().then((p) => p && setRegion({ ...p, latitudeDelta: 0.015, longitudeDelta: 0.015 }));
  }, []);

  const onMapPress = (e: MapPressEvent) => {
    const p = e.nativeEvent.coordinate;
    if (kind === 'circle') setCenter(p);
    else setPath((prev) => [...prev, p]);
  };

  const routeLength = pathLengthMeters(path);

  const submit = () => {
    setError(null);
    const startsAt = parseLocalDateTime(date, time);
    if (title.trim().length < 5) return setError('Dê um título com pelo menos 5 letras.');
    if (!startsAt) return setError('Confira a data (DD/MM/AAAA) e o horário (HH:MM).');
    const endsAt = new Date(startsAt.getTime() + hours * 3600_000);
    if (endsAt <= new Date()) return setError('Esse horário já passou.');
    if (kind === 'circle' && !center) return setError('Toque no mapa para marcar o ponto de concentração.');
    if (kind === 'route' && path.length < 2) return setError('Toque no mapa pelo menos duas vezes para desenhar o trajeto.');
    if (kind === 'route' && routeLength > AREA_LIMITS.routeMaxLengthM) return setError('O trajeto pode ter no máximo 25 km.');

    create.mutate(
      {
        title: title.trim(),
        description: description.trim(),
        city: city.trim() || null,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        area: kind === 'circle' ? { kind, center: center!, radiusM } : { kind, path, widthM },
      },
      {
        onSuccess: ({ id }) => router.replace({ pathname: '/events/[id]', params: { id } }),
        onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível criar o ato.'),
      },
    );
  };

  return (
    <Screen edges={['bottom']} footer={<Button label="Publicar ato" onPress={submit} loading={create.isPending} />}>
      <Field label="Título" value={title} onChangeText={setTitle} placeholder="Ato pela educação pública" maxLength={120} />
      <Field label="Cidade" value={city} onChangeText={setCity} placeholder="São Paulo" maxLength={80} />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field label="Data" value={date} onChangeText={setDate} placeholder="DD/MM/AAAA" keyboardType="numbers-and-punctuation" maxLength={10} />
        </View>
        <View style={{ width: 110 }}>
          <Field label="Início" value={time} onChangeText={setTime} placeholder="HH:MM" keyboardType="numbers-and-punctuation" maxLength={5} />
        </View>
      </View>

      <Text style={styles.label}>Duração</Text>
      <View style={styles.chips}>
        {DURATIONS.map((h) => (
          <Chip key={h} label={`${h} h`} selected={hours === h} onPress={() => setHours(h)} />
        ))}
      </View>

      <Gap h={space.lg} />
      <H2>Onde acontece</H2>
      <Gap h={space.sm} />
      <View style={styles.segment} accessibilityRole="radiogroup">
        <Segment label="Concentração" selected={kind === 'circle'} onPress={() => setKind('circle')} />
        <Segment label="Passeata" selected={kind === 'route'} onPress={() => setKind('route')} />
      </View>
      <Gap h={space.sm} />
      <P muted>
        {kind === 'circle'
          ? 'Toque no mapa para marcar o ponto de encontro e ajuste o raio.'
          : 'Toque no mapa ao longo do trajeto, do início ao fim. A área inclui uma faixa para cada lado.'}
      </P>
      <Gap h={space.sm} />

      <View style={styles.map}>
        <MapView style={StyleSheet.absoluteFill} region={region} onRegionChangeComplete={setRegion} onPress={onMapPress} rotateEnabled={false} pitchEnabled={false}>
          {kind === 'circle' && center ? (
            <>
              <Marker coordinate={center} pinColor={color.stamp} />
              <Circle center={center} radius={radiusM} strokeColor={color.stamp} strokeWidth={2} fillColor="rgba(51,67,181,0.14)" />
            </>
          ) : null}
          {kind === 'route' && path.length > 0 ? (
            <>
              <Polyline coordinates={path} strokeColor={color.stamp} strokeWidth={4} />
              <Marker coordinate={path[0]!} pinColor={color.stamp} title="Início" />
              {path.length > 1 ? <Marker coordinate={path[path.length - 1]!} pinColor={color.graphite} title="Fim" /> : null}
            </>
          ) : null}
        </MapView>
      </View>
      <Gap h={space.md} />

      {kind === 'circle' ? (
        <Stepper
          label="Raio"
          value={radiusM}
          unit="m"
          min={AREA_LIMITS.circleMinRadiusM}
          max={AREA_LIMITS.circleMaxRadiusM}
          step={50}
          onChange={setRadiusM}
        />
      ) : (
        <>
          <Stepper
            label="Largura da faixa"
            value={widthM}
            unit="m"
            min={AREA_LIMITS.routeMinWidthM}
            max={AREA_LIMITS.routeMaxWidthM}
            step={10}
            onChange={setWidthM}
          />
          <View style={styles.rowBetween}>
            <P muted>
              {path.length} ponto{path.length === 1 ? '' : 's'}, {(routeLength / 1000).toFixed(1).replace('.', ',')} km
            </P>
            <Button tone="quiet" label="Desfazer ponto" onPress={() => setPath((p) => p.slice(0, -1))} disabled={!path.length} />
          </View>
        </>
      )}

      <Gap />
      <Notice>A área não pode ser alterada depois de publicada. Isso impede que alguém amplie a cerca para contar quem não está no local.</Notice>

      <Gap h={space.lg} />
      <Field label="Descrição" value={description} onChangeText={setDescription} multiline maxLength={4000} placeholder="Ponto de encontro, trajeto, o que levar." />

      {error ? <Notice tone="fraud">{error}</Notice> : null}
    </Screen>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected }}>
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Segment({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.segmentItem, selected && styles.segmentOn]} accessibilityRole="radio" accessibilityState={{ selected }}>
      <Text style={[styles.segmentText, selected && styles.segmentTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Stepper(p: { label: string; value: number; unit: string; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const set = (v: number) => p.onChange(Math.min(p.max, Math.max(p.min, v)));
  return (
    <View style={styles.rowBetween} accessible accessibilityLabel={`${p.label}: ${p.value} ${p.unit}`} accessibilityRole="adjustable"
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => set(p.value + (e.nativeEvent.actionName === 'increment' ? p.step : -p.step))}
    >
      <Text style={styles.stepperLabel}>
        {p.label}: <Text style={{ fontWeight: '700' }}>{p.value} {p.unit}</Text>
      </Text>
      <View style={styles.row}>
        <StepBtn glyph="−" onPress={() => set(p.value - p.step)} disabled={p.value <= p.min} />
        <StepBtn glyph="+" onPress={() => set(p.value + p.step)} disabled={p.value >= p.max} />
      </View>
    </View>
  );
}

function StepBtn({ glyph, onPress, disabled }: { glyph: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.stepBtn, disabled && { opacity: 0.35 }]} hitSlop={6}>
      <Text style={styles.stepGlyph}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm + 4, alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 48 },
  label: { fontSize: type.caption, fontWeight: '600', color: color.ink, marginBottom: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingHorizontal: 14, height: 38, borderRadius: 19, borderWidth: 1, borderColor: color.rule, justifyContent: 'center', backgroundColor: color.surface },
  chipOn: { backgroundColor: color.ink, borderColor: color.ink },
  chipText: { fontSize: type.body - 1, color: color.ink },
  chipTextOn: { color: '#FFFFFF', fontWeight: '600' },
  segment: { flexDirection: 'row', borderWidth: 1.5, borderColor: color.stamp, borderRadius: radius.control, overflow: 'hidden' },
  segmentItem: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  segmentOn: { backgroundColor: color.stamp },
  segmentText: { fontSize: type.body, fontWeight: '600', color: color.stamp },
  segmentTextOn: { color: '#FFFFFF' },
  map: { height: 300, borderRadius: radius.surface, overflow: 'hidden', backgroundColor: color.stampSoft },
  stepperLabel: { fontSize: type.body, color: color.ink },
  stepBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: color.stamp, alignItems: 'center', justifyContent: 'center' },
  stepGlyph: { fontSize: 22, color: color.stamp, fontWeight: '600', marginTop: -2 },
});

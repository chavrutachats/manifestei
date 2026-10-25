import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Polygon } from 'react-native-maps';
import type { AreaGeoJson } from '../domain/types';
import { color, radius } from '../theme';

type LatLng = { latitude: number; longitude: number };

function rings(area: AreaGeoJson): LatLng[][] {
  const polys = area.type === 'Polygon' ? [area.coordinates] : area.coordinates;
  return polys.map((poly) => (poly[0] ?? []).map(([lng, lat]) => ({ latitude: lat!, longitude: lng! })));
}

/** Mostra a área oficial do ato (desenhada pelo servidor a partir da geocerca). */
export function EventAreaMap({ area, height = 220 }: { area: AreaGeoJson; height?: number }) {
  const outlines = useMemo(() => rings(area), [area]);
  const region = useMemo(() => {
    const pts = outlines.flat();
    const lats = pts.map((p) => p.latitude);
    const lngs = pts.map((p) => p.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.004, (maxLat - minLat) * 1.4),
      longitudeDelta: Math.max(0.004, (maxLng - minLng) * 1.4),
    };
  }, [outlines]);

  return (
    <View style={[styles.wrap, { height }]} accessible accessibilityLabel="Mapa com a área do ato">
      <MapView style={StyleSheet.absoluteFill} initialRegion={region} pitchEnabled={false} rotateEnabled={false} toolbarEnabled={false}>
        {outlines.map((coords, i) => (
          <Polygon key={i} coordinates={coords} strokeColor={color.stamp} strokeWidth={2} fillColor="rgba(51,67,181,0.14)" />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.surface, overflow: 'hidden', backgroundColor: color.stampSoft },
});

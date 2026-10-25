import { Link, Stack, router } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEvents } from '../../src/data/queries';
import { formatEventWhen } from '../../src/domain/format';
import type { ProtestEvent } from '../../src/domain/types';
import { color, font, space, type } from '../../src/theme';
import { Button, ErrorState, Loading, P, formatInt } from '../../src/ui/components';

export default function EventsScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useEvents();

  const header = (
    <Stack.Screen
      options={{
        headerRight: () => (
          <Link href="/account" asChild>
            <Pressable accessibilityRole="button" hitSlop={12}>
              <Text style={styles.headerLink}>Privacidade</Text>
            </Pressable>
          </Link>
        ),
      }}
    />
  );

  if (isLoading) return <>{header}<Loading /></>;
  if (isError) return <>{header}<ErrorState message="Não foi possível carregar os atos." onRetry={() => void refetch()} /></>;

  const events = data ?? [];
  const live = events.filter((e) => e.phase === 'LIVE');
  const upcoming = events.filter((e) => e.phase === 'UPCOMING');
  const sections: Array<{ key: string; title?: string; event?: ProtestEvent }> = [
    ...(live.length ? [{ key: 'h-live', title: 'Acontecendo agora' }, ...live.map((e) => ({ key: e.id, event: e }))] : []),
    ...(upcoming.length ? [{ key: 'h-next', title: 'Próximos' }, ...upcoming.map((e) => ({ key: e.id, event: e }))] : []),
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.paper }} edges={['bottom']}>
      {header}
      <FlatList
        data={sections}
        keyExtractor={(i) => i.key}
        contentContainerStyle={{ padding: space.md, paddingBottom: space.xl }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={color.stamp} />}
        ListEmptyComponent={
          <View style={{ paddingVertical: space.xxl }}>
            <P>Nenhum ato agendado por enquanto.</P>
            <P muted>Organizando um? Crie o ato e compartilhe com quem vai.</P>
          </View>
        }
        renderItem={({ item }) =>
          item.title ? (
            <Text style={styles.section} accessibilityRole="header">
              {item.title}
            </Text>
          ) : (
            <EventRow event={item.event!} />
          )
        }
      />
      <View style={styles.footer}>
        <Button label="Criar ato" tone="secondary" onPress={() => router.push('/events/new')} />
      </View>
    </SafeAreaView>
  );
}

function EventRow({ event }: { event: ProtestEvent }) {
  const live = event.phase === 'LIVE';
  return (
    <Link href={{ pathname: '/events/[id]', params: { id: event.id } }} asChild>
      <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} accessibilityRole="button">
        <View style={{ flex: 1, paddingRight: space.md }}>
          <Text style={styles.title} numberOfLines={2}>
            {event.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[event.city, formatEventWhen(event.startsAt, event.endsAt)].filter(Boolean).join(', ')}
          </Text>
        </View>
        {live ? (
          <View style={styles.countCol} accessible accessibilityLabel={`${formatInt(event.counts.confirmedOnSite)} presentes confirmados`}>
            <Text style={styles.count}>{formatInt(event.counts.confirmedOnSite)}</Text>
            <Text style={styles.countLabel}>presentes</Text>
          </View>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  headerLink: { color: color.stamp, fontSize: type.body, fontWeight: '600' },
  section: { fontSize: type.caption, fontWeight: '700', color: color.graphite, marginTop: space.lg, marginBottom: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.rule,
  },
  title: { fontSize: type.lead, lineHeight: 24, fontWeight: '600', color: color.ink },
  meta: { fontSize: type.caption + 1, color: color.graphite, marginTop: 4 },
  countCol: { alignItems: 'flex-end', minWidth: 72 },
  count: { fontFamily: font.display, fontSize: 36, lineHeight: 38, color: color.stamp },
  countLabel: { fontSize: type.caption - 1, color: color.graphite },
  footer: { paddingHorizontal: space.md, paddingVertical: space.sm },
});

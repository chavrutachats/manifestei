import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import type { StampTone } from '../domain/presenceCopy';
import { color, font, radius, space, type } from '../theme';

// ---------------------------------------------------------------------------- Screen

export function Screen({
  children,
  scroll = true,
  edges = ['bottom'],
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  footer?: ReactNode;
}) {
  return (
    <SafeAreaView style={s.screen} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={s.screenContent} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[s.screenContent, { flex: 1 }]}>{children}</View>
      )}
      {footer ? <View style={s.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

// ------------------------------------------------------------------------------ Text

export const H1 = ({ children }: { children: ReactNode }) => (
  <Text style={s.h1} accessibilityRole="header">
    {children}
  </Text>
);
export const H2 = ({ children }: { children: ReactNode }) => (
  <Text style={s.h2} accessibilityRole="header">
    {children}
  </Text>
);
export const P = ({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) => (
  <Text style={[s.p, muted && s.muted, style]}>{children}</Text>
);

// ---------------------------------------------------------------------------- Button

type ButtonTone = 'primary' | 'secondary' | 'quiet' | 'danger';

export function Button({
  label,
  onPress,
  tone = 'primary',
  loading,
  disabled,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  tone?: ButtonTone;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [s.btn, s[`btn_${tone}`], pressed && s.btnPressed, off && s.btnOff]}
    >
      {loading ? (
        <ActivityIndicator color={tone === 'primary' ? '#FFFFFF' : color.stamp} />
      ) : (
        <Text style={[s.btnLabel, s[`btnLabel_${tone}`]]}>{label}</Text>
      )}
    </Pressable>
  );
}

// ----------------------------------------------------------------------------- Field

export function Field({ label, hint, error, ...input }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={color.graphite}
        {...input}
        accessibilityLabel={label}
        style={[s.input, input.multiline && s.inputMultiline, error && s.inputError]}
      />
      {error ? <Text style={s.fieldError}>{error}</Text> : hint ? <Text style={s.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------- Notice

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'fraud'; children: ReactNode }) {
  const bar = tone === 'fraud' ? color.fraud : tone === 'warn' ? color.pending : color.stamp;
  const bg = tone === 'fraud' ? color.fraudSoft : tone === 'warn' ? color.pendingSoft : color.stampSoft;
  return (
    <View style={[s.notice, { borderLeftColor: bar, backgroundColor: bg }]} accessibilityRole="alert">
      {typeof children === 'string' ? <Text style={s.noticeText}>{children}</Text> : children}
    </View>
  );
}

// ----------------------------------------------------------------------------- Stamp

export type { StampTone };

const STAMP_COLOR: Record<StampTone, string> = {
  confirmed: color.stamp,
  pending: color.pending,
  virtual: color.virtual,
  fraud: color.fraud,
  none: color.rule,
};

/**
 * O carimbo de presença. Tracejado enquanto a verificação não termina;
 * sólido e levemente torto (como um carimbo de verdade) quando confirmado.
 */
export function Stamp({ text, tone, size = 'large' }: { text: string; tone: StampTone; size?: 'large' | 'small' }) {
  const c = STAMP_COLOR[tone];
  const large = size === 'large';
  const dashed = tone === 'pending' || tone === 'none';
  return (
    <View
      style={[
        s.stampOuter,
        { borderColor: c, borderStyle: dashed ? 'dashed' : 'solid', transform: [{ rotate: tone === 'confirmed' ? '-4deg' : '0deg' }] },
        !large && s.stampOuterSmall,
      ]}
      accessible
      accessibilityLabel={`Situação: ${text.toLowerCase()}`}
    >
      <View style={[s.stampInner, { borderColor: c, borderStyle: dashed ? 'dashed' : 'solid' }, !large && s.stampInnerSmall]}>
        <Text style={[s.stampText, { color: c }, !large && s.stampTextSmall]} numberOfLines={1} adjustsFontSizeToFit>
          {text}
        </Text>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------------ CountBlock

export const formatInt = (n: number): string => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export function CountBlock({ value, label, emphasis = false }: { value: number; label: string; emphasis?: boolean }) {
  return (
    <View style={s.count} accessible accessibilityLabel={`${formatInt(value)} ${label}`}>
      <Text style={[s.countValue, !emphasis && s.countValueSmall]}>{formatInt(value)}</Text>
      <Text style={[s.countLabel, emphasis && s.countLabelEmphasis]}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------- Misc

export const Gap = ({ h = space.md }: { h?: number }) => <View style={{ height: h }} />;
export const Rule = ({ style }: { style?: ViewStyle }) => <View style={[s.rule, style]} />;

export function Loading() {
  return (
    <View style={s.center}>
      <ActivityIndicator color={color.stamp} size="large" />
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={[s.center, { padding: space.lg }]}>
      <P>{message}</P>
      {onRetry ? (
        <>
          <Gap />
          <Button label="Tentar de novo" tone="secondary" onPress={onRetry} />
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  screenContent: { padding: space.md, paddingBottom: space.xl },
  footer: {
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    gap: space.sm,
    backgroundColor: color.paper,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.rule,
  },

  h1: { fontSize: type.headline, lineHeight: 34, fontWeight: '700', color: color.ink, letterSpacing: -0.3 },
  h2: { fontSize: type.lead, lineHeight: 24, fontWeight: '700', color: color.ink },
  p: { fontSize: type.body, lineHeight: 24, color: color.ink },
  muted: { color: color.graphite },

  btn: {
    minHeight: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  btn_primary: { backgroundColor: color.stamp },
  btn_secondary: { backgroundColor: color.surface, borderWidth: 1.5, borderColor: color.stamp },
  btn_quiet: { backgroundColor: 'transparent', minHeight: 44 },
  btn_danger: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: color.fraud },
  btnPressed: { opacity: 0.85 },
  btnOff: { opacity: 0.45 },
  btnLabel: { fontSize: type.body, fontWeight: '600' },
  btnLabel_primary: { color: '#FFFFFF' },
  btnLabel_secondary: { color: color.stamp },
  btnLabel_quiet: { color: color.stamp },
  btnLabel_danger: { color: color.fraud },

  field: { marginBottom: space.md },
  fieldLabel: { fontSize: type.caption, fontWeight: '600', color: color.ink, marginBottom: space.xs },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: color.rule,
    borderRadius: radius.control,
    backgroundColor: color.surface,
    paddingHorizontal: space.md,
    fontSize: type.body,
    color: color.ink,
  },
  inputMultiline: { minHeight: 110, paddingTop: 14, textAlignVertical: 'top' },
  inputError: { borderColor: color.fraud },
  fieldHint: { fontSize: type.caption, color: color.graphite, marginTop: space.xs },
  fieldError: { fontSize: type.caption, color: color.fraud, marginTop: space.xs },

  notice: { borderLeftWidth: 3, paddingVertical: space.sm + 4, paddingHorizontal: space.md, borderRadius: radius.surface },
  noticeText: { fontSize: type.body - 1, lineHeight: 22, color: color.ink },

  stampOuter: { alignSelf: 'center', maxWidth: '88%', borderWidth: 4, borderRadius: 8, padding: 4 },
  stampOuterSmall: { alignSelf: 'flex-start', maxWidth: '100%', borderWidth: 2, borderRadius: 5, padding: 2 },
  stampInner: { borderWidth: 1.5, borderRadius: 5, paddingVertical: space.sm, paddingHorizontal: space.lg },
  stampInnerSmall: { borderWidth: 1, paddingVertical: 2, paddingHorizontal: space.sm },
  stampText: { fontFamily: font.displayBlack, fontSize: 34, letterSpacing: 2, textAlign: 'center' },
  stampTextSmall: { fontSize: 15, letterSpacing: 1.5 },

  count: { paddingVertical: space.xs },
  countValue: { fontFamily: font.display, fontSize: type.count, lineHeight: type.count, color: color.ink, letterSpacing: -1 },
  countValueSmall: { fontSize: 40, lineHeight: 42, letterSpacing: 0 },
  countLabel: { fontSize: type.body, color: color.graphite, marginTop: 2 },
  countLabelEmphasis: { color: color.ink, fontWeight: '600' },

  rule: { height: StyleSheet.hairlineWidth, backgroundColor: color.rule, marginVertical: space.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.paper },
});

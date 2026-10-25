import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { config } from '../../src/config';
import { useIdentity } from '../../src/features/identity/IdentityProvider';
import { color, font, space, type } from '../../src/theme';
import { Button, Gap, H2, P, Screen } from '../../src/ui/components';

/**
 * A única tela antes de usar o app. Não há cadastro: nenhum nome, telefone,
 * e-mail ou data de nascimento. Mas dizer que você esteve num ato revela opinião
 * política (dado sensível na LGPD), então o consentimento é específico e destacado.
 */
export default function WelcomeScreen() {
  const { acceptConsent } = useIdentity();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  const proceed = async () => {
    setBusy(true);
    await acceptConsent();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.paper }} edges={['top']}>
      <Screen
        footer={
          <>
            <Pressable
              style={styles.consentRow}
              onPress={() => setAccepted((v) => !v)}
              accessibilityRole="switch"
              accessibilityState={{ checked: accepted }}
            >
              <Switch value={accepted} onValueChange={setAccepted} trackColor={{ true: color.stamp }} />
              <Text style={styles.consentText}>Li e concordo com o uso dos dados descrito acima.</Text>
            </Pressable>
            <Button label="Concordar e começar" onPress={() => void proceed()} disabled={!accepted} loading={busy} />
          </>
        }
      >
        <Text style={styles.brand} accessibilityRole="header">
          Manifestei
        </Text>
        <P muted>Quantas pessoas estiveram no ato, contadas uma vez cada.</P>
        <Gap h={space.xl} />

        <H2>Sem cadastro</H2>
        <Gap h={space.sm} />
        <P>
          Você não informa nome, telefone, e-mail nem data de nascimento. Para confirmar presença, basta tocar em "Estou
          no ato". Para apoiar de longe, "Apoiar à distância".
        </P>

        <Gap h={space.lg} />
        <H2>Como evitamos que alguém conte duas vezes</H2>
        <Item>
          A Apple ou o Google confirmam que este é um aparelho real com o app oficial. Emuladores e robôs não conseguem
          registrar nada.
        </Item>
        <Item>
          O aparelho vira um código anônimo e irreversível. Cada código registra uma vez por ato, mesmo que o app seja
          reinstalado.
        </Item>
        <Item>
          Depois que você toca em "Estou no ato", o app confere sua localização precisa a cada 15 minutos, sozinho, até
          você sair da área ou o ato terminar. A presença é confirmada após 45 minutos no local. Enquanto isso acontece, o
          sistema mostra um aviso, e você pode parar quando quiser.
        </Item>
        <Item>
          Fora de um ato, nenhuma localização é coletada. As coordenadas exatas são apagadas 72 horas depois do fim do ato;
          para medir o pico e o tempo de permanência, só ficam o horário de chegada e o da última leitura no local.
        </Item>

        <Gap h={space.lg} />
        <H2>O que ninguém vê</H2>
        <Item>Organizadores e o público veem apenas totais, o pico e médias. Não existe lista de participantes.</Item>
        <Item>Não usamos localização em segundo plano, contatos, câmera nem microfone.</Item>

        <Gap h={space.lg} />
        <H2>Seus direitos</H2>
        <Item>Você pode apagar seus dados a qualquer momento no próprio app. Os totais dos atos não mudam, mas deixam de ter qualquer ligação com este aparelho.</Item>
        <Item>Se o app recusar sua presença por suspeita de fraude, você pode pedir revisão humana em {config.supportEmail}.</Item>
        <Gap h={space.lg} />
      </Screen>
    </SafeAreaView>
  );
}

function Item({ children }: { children: ReactNode }) {
  return (
    <View style={styles.item}>
      <View style={styles.bullet} />
      <P style={{ flex: 1 }}>{children}</P>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { fontFamily: font.displayBlack, fontSize: 56, lineHeight: 60, color: color.stamp, marginTop: space.lg },
  item: { flexDirection: 'row', gap: space.sm + 4, marginTop: space.sm + 4 },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.stamp, marginTop: 9 },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 4, paddingVertical: space.xs },
  consentText: { flex: 1, fontSize: type.body - 1, lineHeight: 21, color: color.ink },
});

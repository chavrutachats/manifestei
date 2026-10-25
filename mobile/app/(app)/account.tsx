import Constants from 'expo-constants';
import { useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { config } from '../../src/config';
import { api } from '../../src/data/api';
import { ApiError } from '../../src/data/http';
import { useIdentity } from '../../src/features/identity/IdentityProvider';
import { color, space, type } from '../../src/theme';
import { Button, Gap, H2, Notice, P, Rule, Screen } from '../../src/ui/components';

export default function PrivacyScreen() {
  const identity = useIdentity();
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const confirmDelete = () =>
    Alert.alert(
      'Apagar seus dados?',
      'O vínculo deste aparelho com os atos é apagado. As presenças já registradas continuam nos totais, sem ligação com você. Este aparelho só poderá usar o app de novo depois de 24 horas.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Apagar',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await api.deleteAccount();
              await identity.forget();
            } catch (err) {
              setDeleting(false);
              setMessage(err instanceof ApiError ? err.message : 'Não foi possível apagar agora. Tente de novo.');
            }
          },
        },
      ],
    );

  return (
    <Screen>
      <H2>Este aparelho</H2>
      <Gap h={space.sm} />
      {identity.status === 'ready' ? (
        <P>Verificado pela Apple/Google. Pode confirmar presença e apoiar atos, uma vez por ato.</P>
      ) : identity.status === 'enrolling' ? (
        <P muted>Verificando…</P>
      ) : (
        <Notice tone={identity.status === 'untrusted' ? 'fraud' : 'warn'}>{identity.error ?? 'Aparelho não verificado.'}</Notice>
      )}
      {identity.status === 'untrusted' || identity.status === 'error' ? (
        <>
          <Gap h={space.sm} />
          <Button tone="secondary" label="Verificar de novo" onPress={() => void identity.retry()} />
        </>
      ) : null}

      <Rule style={{ marginVertical: space.lg }} />
      <H2>O que o Manifestei guarda</H2>
      <Gap h={space.sm} />
      <P muted>
        Nenhum nome, telefone ou e-mail. Este aparelho é representado por um código anônimo e irreversível, que só serve
        para garantir um registro por ato. A localização é lida a cada 15 minutos somente depois que você toca em "Estou no
        ato", e só enquanto você está no local; as coordenadas exatas são apagadas 72 horas após cada ato. Ninguém, nem
        quem organiza, vê quem participou: só os totais.
      </P>
      <Gap h={space.sm} />
      <P muted>Revisão de decisões automáticas e pedidos sobre seus dados: {config.supportEmail}</P>

      <Rule style={{ marginVertical: space.lg }} />
      <Button tone="danger" label="Apagar meus dados" loading={deleting} onPress={confirmDelete} />
      {message ? (
        <>
          <Gap h={space.sm} />
          <P muted>{message}</P>
        </>
      ) : null}

      <Text style={styles.version}>Versão {Constants.expoConfig?.version ?? '—'}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  version: { fontSize: type.caption, color: color.graphite, textAlign: 'center', marginTop: space.xl },
});

import type pg from 'pg';

/**
 * Retenção (LGPD, minimização). Depois que o ato termina (+ prazo de retenção):
 *
 *  - cada leitura individual é apagada (coordenada, horário, precisão, veredito);
 *  - no registro de presença ficam só o resultado (presente / apoio virtual e o
 *    motivo) e dois horários: chegada e última leitura válida no local. É o mínimo
 *    para o pico, a queda e o tempo médio do ato continuarem calculáveis.
 *
 * Rodar de hora em hora: npm run purge:locations
 */
export async function purgeExpiredPresenceData(pool: pg.Pool, retentionHours: number): Promise<number> {
  const res = await pool.query(
    `DELETE FROM presence_samples s
      USING attendance_records a, events e
      WHERE s.attendance_id = a.id
        AND e.id = a.event_id
        AND e.ends_at < now() - make_interval(hours => $1)`,
    [retentionHours],
  );
  return res.rowCount ?? 0;
}

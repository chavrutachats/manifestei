/**
 * Rodar de hora em hora (cron do sistema, Kubernetes CronJob, etc.):
 *   npm run purge:locations
 */
import { createPool } from '../src/infrastructure/db/pool.js';
import { purgeExpiredPresenceData } from '../src/infrastructure/jobs/purge-locations.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definido');
const hours = Number(process.env.LOCATION_RETENTION_HOURS ?? 72);

const pool = createPool(url);
const n = await purgeExpiredPresenceData(pool, hours);
console.log(`Leituras individuais apagadas: ${n}`);
await pool.end();

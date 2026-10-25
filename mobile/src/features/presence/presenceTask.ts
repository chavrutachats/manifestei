import * as TaskManager from 'expo-task-manager';
import { PRESENCE_TASK, runDueReading } from './presenceSession';

/**
 * Precisa ser definida no escopo global do bundle (ver index.ts): no Android o
 * sistema pode acordar só o JavaScript, sem nenhuma tela, para entregar a localização.
 */
TaskManager.defineTask(PRESENCE_TASK, async ({ error }) => {
  if (error) return;
  await runDueReading();
});

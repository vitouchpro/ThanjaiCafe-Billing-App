import { PowerSyncDatabase } from '@powersync/web';
import { SpikeSchema } from './schema';
import { SpikeConnector } from './SpikeConnector';

export const connector = new SpikeConnector();
export const db = new PowerSyncDatabase({
  schema: SpikeSchema,
  database: { dbFilename: 'cafe-spike.db' },
});

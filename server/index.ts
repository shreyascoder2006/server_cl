import { createApp } from './app.ts';
import { config } from './config.ts';
import { getDb } from './db.ts';
import { log } from './log.ts';
import { seed } from './seed.ts';

const db = getDb();
if (seed(db)) log.info('database_seeded', { path: config.databasePath });

createApp().listen(config.port, () => {
  console.log(`\n  Cloudlead Infra Store API running on http://localhost:${config.port}`);
  console.log(`  Provider mode: ${config.providerMode.toUpperCase()}  |  Payment gateway: ${config.paymentGateway}`);
  if (config.appSecret === 'dev-only-insecure-secret') console.log('  Warning: APP_SECRET not set (fine for local testing only).');
  console.log('');
});

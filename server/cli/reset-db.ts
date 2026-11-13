import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';
import { openDb } from '../db.ts';
import { seed } from '../seed.ts';

/** Recreates the local SQLite database with seed data. Local development only. */
const file = path.resolve(config.databasePath);
for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(file + suffix)) fs.unlinkSync(file + suffix);
}
const db = openDb(file);
seed(db);
db.close();
console.log(`Database ready at ${file}`);
console.log('Sign in with admin@cloudlead.local / admin1234 (admin) or demo@acme.local / demo1234 (customer).');

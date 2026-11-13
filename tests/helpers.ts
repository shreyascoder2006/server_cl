import request from 'supertest';
import { createApp } from '../server/app.ts';
import { openDb, setDb } from '../server/db.ts';
import { seed } from '../server/seed.ts';

export function freshApp() {
  const db = openDb(':memory:');
  seed(db);
  setDb(db);
  return { app: createApp(), db };
}

export async function login(app: any, email: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = res.headers['set-cookie'][0].split(';')[0];
  return cookie;
}

export const CONTACT = {
  firstName: 'Priya', lastName: 'Demo', company: 'Acme Growth', email: 'priya@acme.example', phone: '+1 415 555 0100',
  address1: '1 Market St', city: 'San Francisco', state: 'CA', postalCode: '94105', country: 'us',
};

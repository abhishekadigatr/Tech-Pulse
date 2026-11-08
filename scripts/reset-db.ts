import { db, resetDatabase, seedAccounts } from '../src/server/db.ts';

resetDatabase();
db();
await seedAccounts();
console.log('Database reset and re-seeded. Restart the dev server to pick up a fresh connection.');

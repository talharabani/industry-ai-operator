import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('./scratch/n8n.sqlite');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table';").all();
console.log('Tables:', tables.map(t => t.name));

try {
  const keys = db.prepare("SELECT * FROM user_api_keys;").all();
  console.log('user_api_keys:', keys);
} catch (e) {
  console.log('user_api_keys error:', e.message);
}

try {
  const users = db.prepare("SELECT id, email, firstName, lastName, apiKey FROM user;").all();
  console.log('users:', users);
} catch (e) {
  console.log('user error:', e.message);
}

process.exit(0);

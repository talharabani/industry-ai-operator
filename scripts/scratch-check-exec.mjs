import { execSync } from 'child_process';
import { query } from '../lib/db.ts';

async function main() {
  const audit = await query('SELECT * FROM iao.audit ORDER BY id DESC LIMIT 5;');
  console.log('Latest audit rows:');
  for (const a of audit) {
    console.log(a.id, a.event, a.details);
  }

  const job = await query("SELECT * FROM iao.services_lead_followup_jobs WHERE lead_id LIKE 'lead_mvcb22%' ORDER BY id DESC;");
  console.log('Lead jobs:', job);
}

main().catch(console.error);

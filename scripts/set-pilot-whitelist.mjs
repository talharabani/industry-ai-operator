import { query } from '../lib/db.ts';

async function main() {
  const result = await query(
    `UPDATE iao.businesses
     SET settings = jsonb_set(
       settings,
       '{pilot_whitelist}',
       $1::jsonb,
       true
     )
     WHERE tenant_id = $2
     RETURNING tenant_id, settings->'pilot_whitelist' as whitelist;`,
    [
      JSON.stringify({
        authorized_sender: 'talhaishaqrabani9490@gmail.com',
        authorized_recipient: 'mukaramajeed28094@gmail.com',
      }),
      'sandbox-services-alpha',
    ]
  );
  console.log('✓ Successfully set pilot whitelist on sandbox-services-alpha:');
  console.log(result[0]);
}

main().catch(console.error);

import './loadEnv.js';
import { ensureRuntimeReady } from './runtimeSetup.js';

async function main() {
  const result = await ensureRuntimeReady();
  if (result.adminCreated) {
    console.log('✅  Admin user created!');
  } else {
    console.log('⚠️  An admin user already exists — skipping.');
  }
  console.log(`    Email:    ${process.env.ADMIN_EMAIL || 'admin@example.com'}`);
  console.log(`    Password: ${process.env.ADMIN_PASSWORD || 'admin123'}`);
  console.log('    ⚠️  Remember to change the password after first login.');
}

main().catch(err => { console.error(err); process.exit(1); });

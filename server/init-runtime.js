import './loadEnv.js';
import { ensureRuntimeReady } from './runtimeSetup.js';

async function main() {
  const result = await ensureRuntimeReady();
  console.log(`Runtime ready for database "${result.dbName}".`);
  if (result.schemaCreated) {
    console.log('Base schema created.');
  }
  if (result.adminCreated) {
    console.log(`Default admin created: ${result.adminEmail}`);
  }
}

main().catch((error) => {
  console.error('Failed to initialize runtime', error);
  process.exit(1);
});

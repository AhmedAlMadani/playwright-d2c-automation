import { cleanDatabase } from './dbCleanup';

cleanDatabase()
  .then(() => {
    console.log('[Setup] Database cleaned successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[Setup] Failed to clean database:', err);
    process.exit(1);
  });

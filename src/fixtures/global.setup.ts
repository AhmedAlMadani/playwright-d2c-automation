import { cleanDatabase } from '../db/dbCleanup';
import { Logger } from '../utils/logger';

/**
 * Global Setup for Playwright tests.
 * Runs exactly once before all test workers start.
 * We clean the database here to ensure a fresh slate for the test run,
 * avoiding the race conditions of cleaning it before every individual test
 * across parallel workers.
 */
async function globalSetup() {
  Logger.info('[Global Setup] Starting test execution...');
  await cleanDatabase();
  Logger.info('[Global Setup] Initial database cleanup complete.');
}

export default globalSetup;

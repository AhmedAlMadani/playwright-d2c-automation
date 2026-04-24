import * as dotenv from 'dotenv';
dotenv.config();

export const config = {
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  apiUrl: process.env.API_URL || 'http://localhost:3001',
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
  debugMode: process.env.DEBUG_MODE === 'true',
};


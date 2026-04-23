import * as dotenv from 'dotenv';
dotenv.config();

export const config = {
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  apiUrl: process.env.API_URL || 'http://localhost:3001', // Mock API URL
  // Add other environment-specific configurations here
  // e.g., API keys, specific test user credentials, etc.
};

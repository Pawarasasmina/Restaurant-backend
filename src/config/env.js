import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  COOKIE_SECRET: z.string().min(16),
  TABLE_SESSION_MINUTES: z.coerce.number().int().min(5).default(240),
  DEMO_AUTO_ACTIVATE_TABLES: z.string().default('false').transform(v => v === 'true'),
  TRUST_PROXY: z.string().default('false').transform(v => v === 'true')
});

export const env = schema.parse(process.env);


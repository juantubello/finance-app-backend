import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

const envPath = existsSync('/app/.env') ? '/app/.env' : resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

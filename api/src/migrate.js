import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { pool } from './db.js';
if(!pool){console.error('DATABASE_URL is required');process.exit(1)}
try { const sql=await readFile(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'); await pool.query(sql); console.log('Database migration complete'); }
catch(e){console.error(e.message);process.exitCode=1} finally {await pool.end()}

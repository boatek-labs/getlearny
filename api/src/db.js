import pg from 'pg';
const { Pool } = pg;
export const pool = process.env.DATABASE_URL ? new Pool({connectionString:process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL==='true' ? {rejectUnauthorized:false}:undefined, max:10, idleTimeoutMillis:30000, connectionTimeoutMillis:5000}) : null;
export async function query(text, params=[]) { if(!pool) throw new Error('Database is not configured. Set DATABASE_URL.'); return pool.query(text,params); }
export async function health(){ if(!pool) return {configured:false,connected:false}; try {await pool.query('SELECT 1'); return {configured:true,connected:true};} catch {return {configured:true,connected:false};} }

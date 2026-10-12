import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { createServer } from 'node:http';

async function withServer(fn){const server=createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;try{await fn(url)}finally{await new Promise(resolve=>server.close(resolve))}}
test('health endpoint returns service metadata without requiring a database',async()=>{await withServer(async url=>{const r=await fetch(`${url}/api/v1/health`);assert.ok([200,503].includes(r.status));const body=await r.json();assert.equal(body.service,'getlearny-api');assert.ok(body.database)})});
test('unknown route is not silently treated as success',async()=>{await withServer(async url=>{const r=await fetch(`${url}/api/v1/not-a-route`);assert.equal(r.status,404)})});
test('registration rejects malformed input',async()=>{process.env.JWT_SECRET='test-secret-that-is-long-enough-to-pass-32-characters';await withServer(async url=>{const r=await fetch(`${url}/api/v1/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'A',email:'not-an-email',password:'short'})});assert.equal(r.status,400)})});

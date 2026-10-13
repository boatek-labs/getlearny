import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, health } from './db.js';

const app=express();
// Vercel sits in front of this serverless function and forwards the client IP.
// Trust the single platform proxy so express-rate-limit can safely read req.ip.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
const deploymentOrigins=[process.env.APP_URL,process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:'',process.env.VERCEL_PROJECT_PRODUCTION_URL?`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`:''];
const origins=[...new Set([...(process.env.CORS_ORIGINS||'http://localhost:3000,http://localhost:5173').split(',').map(x=>x.trim()),...deploymentOrigins].filter(Boolean))];
app.use(cors({origin(origin,cb){if(!origin||origins.includes(origin))return cb(null,true);return cb(new Error('Origin not allowed by CORS'));},credentials:true}));
app.use(express.json({limit:'1mb'})); app.use(morgan(process.env.NODE_ENV==='production'?'combined':'dev'));
app.use('/api/v1/auth',rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:true,legacyHeaders:false}));
app.use('/api/v1',rateLimit({windowMs:60*1000,limit:120,standardHeaders:true,legacyHeaders:false}));
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const fail=(res,status,error)=>res.status(status).json({error});
const envReady=()=>Boolean(process.env.JWT_SECRET&&process.env.JWT_SECRET.length>=32);
function auth(req,res,next){const value=req.headers.authorization||'';const token=value.startsWith('Bearer ')?value.slice(7):'';if(!token||!envReady())return fail(res,401,'Sign in required');try{req.user=jwt.verify(token,process.env.JWT_SECRET,{issuer:'getlearny-api',audience:'getlearny-app'});next()}catch{return fail(res,401,'Session expired. Sign in again.')}}
const registration=z.object({name:z.string().trim().min(2).max(120),email:z.string().trim().email().max(254),password:z.string().min(8).max(128)});
const login=z.object({email:z.string().trim().email().max(254),password:z.string().min(8).max(128)});
const journalSchema=z.object({learned:z.string().trim().min(1).max(5000),difficult:z.string().max(5000).optional().default(''),next_step:z.string().max(2000).optional().default('')});
app.get('/api/v1/health',asyncRoute(async(_req,res)=>{const db=await health();res.status(db.configured&&!db.connected?503:200).json({status:db.connected?'ok':db.configured?'degraded':'unconfigured',service:'getlearny-api',database:db,now:new Date().toISOString()})}));
app.post('/api/v1/auth/register',asyncRoute(async(req,res)=>{if(!envReady())return fail(res,503,'Authentication is not configured');const parsed=registration.safeParse(req.body);if(!parsed.success)return fail(res,400,parsed.error.issues[0].message);const {name,email,password}=parsed.data;const hash=await bcrypt.hash(password,12);try{const r=await query('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email,role,avatar_data,created_at',[name,email.toLowerCase(),hash]);const user=r.rows[0];const token=jwt.sign({sub:user.id,email:user.email,role:user.role},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||'7d',issuer:'getlearny-api',audience:'getlearny-app'});res.status(201).json({token,user})}catch(e){if(e.code==='23505')return fail(res,409,'An account with this email already exists');throw e}}));
app.post('/api/v1/auth/login',asyncRoute(async(req,res)=>{if(!envReady())return fail(res,503,'Authentication is not configured');const parsed=login.safeParse(req.body);if(!parsed.success)return fail(res,400,'Enter a valid email and password');const r=await query('SELECT id,name,email,role,avatar_data,password_hash,created_at FROM users WHERE email=$1',[parsed.data.email.toLowerCase()]);const user=r.rows[0];if(!user||!await bcrypt.compare(parsed.data.password,user.password_hash))return fail(res,401,'Email or password is incorrect');delete user.password_hash;const token=jwt.sign({sub:user.id,email:user.email,role:user.role},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||'7d',issuer:'getlearny-api',audience:'getlearny-app'});res.json({token,user})}));
app.get('/api/v1/me',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT id,name,email,role,avatar_data,created_at FROM users WHERE id=$1',[req.user.sub]);if(!r.rowCount)return fail(res,404,'Account not found');res.json({user:r.rows[0]})}));
app.get('/api/v1/subjects',asyncRoute(async(_req,res)=>{const r=await query('SELECT s.id,s.name,s.code,s.description,count(t.id)::int AS topic_count FROM subjects s LEFT JOIN topics t ON t.subject_id=s.id GROUP BY s.id ORDER BY s.name');res.json({subjects:r.rows})}));
app.get('/api/v1/topics',asyncRoute(async(req,res)=>{
  const subject = typeof req.query.subject === 'string' ? req.query.subject.trim().toUpperCase() : '';
  if (subject && !/^[A-Z0-9_-]{2,30}$/.test(subject)) return fail(res,400,'Subject code must contain 2–30 letters, numbers, underscores or hyphens');
  const rawLimit = req.query.limit === undefined ? '100' : String(req.query.limit);
  if (!/^[0-9]+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) return fail(res,400,'Limit must be an integer from 1 to 100');
  const result = await query(
    `SELECT t.id, s.name AS subject, s.code AS subject_code, t.title, t.description, t.level, t.prerequisites, t.sort_order
     FROM topics t JOIN subjects s ON s.id=t.subject_id
     WHERE ($1 = '' OR s.code = $1)
     ORDER BY s.name, t.sort_order, t.title LIMIT $2`,
    [subject, Number(rawLimit)]
  );
  res.json({topics:result.rows});
}));
app.get('/api/v1/dashboard',auth,asyncRoute(async(req,res)=>{const [logs,tests,journal]=await Promise.all([query("SELECT count(*) FILTER(WHERE status='completed')::int AS completed_topics,coalesce(sum(minutes_spent),0)::int AS minutes_studied FROM learning_logs WHERE user_id=$1",[req.user.sub]),query('SELECT count(*)::int AS tests,coalesce(round(avg(score/max_score*100),1),0) AS average_percent FROM test_logs WHERE user_id=$1',[req.user.sub]),query('SELECT count(*)::int AS journal_entries FROM journal_entries WHERE user_id=$1',[req.user.sub])]);res.json({progress:{completedTopics:logs.rows[0].completed_topics,minutesStudied:logs.rows[0].minutes_studied},tests:tests.rows[0],journal:journal.rows[0]})}));
app.post('/api/v1/learning-logs',auth,asyncRoute(async(req,res)=>{const s=z.object({subject:z.string().min(1).max(100),topic:z.string().min(1).max(200),minutes_spent:z.number().int().min(0).max(1440).default(0),status:z.enum(['started','completed','review']).default('started'),notes:z.string().max(5000).default('')}).safeParse(req.body);if(!s.success)return fail(res,400,s.error.issues[0].message);const d=s.data;const r=await query('INSERT INTO learning_logs(user_id,subject,topic,minutes_spent,status,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[req.user.sub,d.subject,d.topic,d.minutes_spent,d.status,d.notes]);res.status(201).json({log:r.rows[0]})}));
app.get('/api/v1/learning-logs',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT * FROM learning_logs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.sub]);res.json({logs:r.rows})}));
app.post('/api/v1/tests',auth,asyncRoute(async(req,res)=>{const s=z.object({subject:z.string().min(1).max(100),title:z.string().min(1).max(200),score:z.number().min(0),max_score:z.number().positive()}).refine(d=>d.score<=d.max_score,{message:'Score cannot exceed maximum'}).safeParse(req.body);if(!s.success)return fail(res,400,s.error.issues[0].message);const d=s.data;const r=await query('INSERT INTO test_logs(user_id,subject,title,score,max_score) VALUES($1,$2,$3,$4,$5) RETURNING *',[req.user.sub,d.subject,d.title,d.score,d.max_score]);res.status(201).json({test:r.rows[0]})}));
app.get('/api/v1/tests',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT * FROM test_logs WHERE user_id=$1 ORDER BY taken_at DESC LIMIT 100',[req.user.sub]);res.json({tests:r.rows})}));
app.post('/api/v1/journal',auth,asyncRoute(async(req,res)=>{const s=journalSchema.safeParse(req.body);if(!s.success)return fail(res,400,s.error.issues[0].message);const d=s.data;const r=await query('INSERT INTO journal_entries(user_id,learned,difficult,next_step) VALUES($1,$2,$3,$4) RETURNING id,learned,difficult,next_step,created_at',[req.user.sub,d.learned,d.difficult,d.next_step]);res.status(201).json({entry:r.rows[0]})}));
app.get('/api/v1/journal',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT id,learned,difficult,next_step,created_at FROM journal_entries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.sub]);res.json({entries:r.rows})}));
const lessonInput=z.object({subject:z.string().trim().min(1).max(100),topic:z.string().trim().min(1).max(200),level:z.string().max(30).default('SHS 3'),exam:z.string().max(30).default('WASSCE')});
app.post('/api/v1/lessons/generate',auth,asyncRoute(async(req,res)=>{
  const parsed=lessonInput.safeParse(req.body);
  if(!parsed.success)return fail(res,400,parsed.error.issues[0].message);
  const {subject,topic,level,exam}=parsed.data;
  const fallback=`# ${topic}

**Subject:** ${subject} · **Level:** ${level} · **Exam focus:** ${exam}

## Learning goals
- Explain the central idea in your own words.
- Identify prerequisite knowledge.
- Work through an example and check your answer.

## Build the foundation
Start by writing down what you already know about ${topic}. Define unfamiliar words, then connect each new idea to an example from class or daily life.

## Worked approach
1. Read the question carefully and underline the command words.
2. List the information given and what you must find.
3. Select the rule, definition, or method that applies.
4. Show each step and check your result.

## WASSCE exam tip
Answer the exact question, show clear working where appropriate, and reserve a moment to check units, spelling, and whether every part was answered.

## Quick recall
Close your notes and explain the main idea in three sentences. Then attempt practice questions and review every mistake.`;
  let lesson=fallback,generatedBy='built-in';
  const key=process.env.OPENROUTER_API_KEY;
  if(key){
    const models=[process.env.OPENROUTER_MODEL||'openrouter/free',...(process.env.OPENROUTER_FALLBACK_MODELS||'').split(',').map(x=>x.trim()).filter(Boolean)].filter((x,i,a)=>a.indexOf(x)===i).slice(0,3);
    for(const model of models){
      try{
        const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{
          method:'POST',
          headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','HTTP-Referer':process.env.OPENROUTER_SITE_URL||process.env.APP_URL||'https://getlearny.vercel.app','X-Title':process.env.OPENROUTER_APP_NAME||'GetLearny'},
          body:JSON.stringify({model,messages:[
            {role:'system',content:'You are a careful Ghana SHS tutor preparing students for WASSCE. Teach prerequisite concepts first, use age-appropriate language, worked examples, common mistakes, and a short self-check. Do not fabricate official syllabus claims.'},
            {role:'user',content:`Create a useful lesson in Markdown. Subject: ${subject}. Topic: ${topic}. Level: ${level}. Exam: ${exam}. Include goals, prerequisite check, explanation, worked example, common mistakes, exam tip, and 3 self-check questions with answers at the end.`}
          ],temperature:0.4,max_tokens:1800}),
          signal:AbortSignal.timeout(9000)
        });
        if(!response.ok)continue;
        const data=await response.json();
        const content=data.choices?.[0]?.message?.content;
        if(typeof content==='string'&&content.trim()){lesson=content;generatedBy='openrouter';break}
      }catch{/* try the next configured model; built-in lesson remains available */}
    }
  }
  res.json({lesson,generatedBy,subject,topic});
}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:(Number(process.env.MAX_UPLOAD_MB)||12)*1024*1024,files:1},fileFilter:(_req,file,cb)=>{const allowed=['application/pdf','text/plain'];if(!allowed.includes(file.mimetype))return cb(new Error('Only PDF and plain-text files are accepted'));cb(null,true)}});const avatarUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1},fileFilter:(_req,file,cb)=>{if(!['image/jpeg','image/png','image/webp'].includes(file.mimetype))return cb(new Error('Profile pictures must be JPG, PNG or WebP'));cb(null,true)}});
app.post('/api/v1/profile/avatar',auth,avatarUpload.single('file'),asyncRoute(async(req,res)=>{if(!req.file)return fail(res,400,'Choose a JPG, PNG or WebP profile picture');const avatar_data='data:'+req.file.mimetype+';base64,'+req.file.buffer.toString('base64');const r=await query('UPDATE users SET avatar_data=$1,updated_at=now() WHERE id=$2 RETURNING id,name,email,role,avatar_data,created_at',[avatar_data,req.user.sub]);res.json({user:r.rows[0],message:'Profile picture updated'})}));
app.post('/api/v1/documents',auth,upload.single('file'),asyncRoute(async(req,res)=>{if(!req.file)return fail(res,400,'Select a PDF or text file');const r=await query('INSERT INTO uploaded_documents(user_id,original_name,storage_path,mime_type,size_bytes,content,processing_status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,original_name,mime_type,size_bytes,processing_status,created_at',[req.user.sub,path.basename(req.file.originalname).slice(0,255),'database',req.file.mimetype,req.file.size,req.file.buffer,'uploaded']);res.status(201).json({document:r.rows[0],message:'Study material saved to your account.'})}));
app.get('/api/v1/documents',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT id,original_name,mime_type,size_bytes,processing_status,created_at FROM uploaded_documents WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.sub]);res.json({documents:r.rows})}));
app.get('/api/v1/documents/:id',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT original_name,mime_type,content FROM uploaded_documents WHERE id=$1 AND user_id=$2',[req.params.id,req.user.sub]);if(!r.rowCount)return fail(res,404,'Document not found');res.setHeader('Content-Type',r.rows[0].mime_type);res.setHeader('Content-Disposition','attachment; filename="study-material"');res.send(r.rows[0].content)}));
app.use((err,_req,res,_next)=>{if(err instanceof multer.MulterError)return fail(res,err.code==='LIMIT_FILE_SIZE'?413:400,err.code==='LIMIT_FILE_SIZE'?'File is too large':'Upload failed');if(err.message==='Origin not allowed by CORS')return fail(res,403,err.message);console.error(err);return fail(res,500,process.env.NODE_ENV==='production'?'Unexpected server error':err.message||'Unexpected server error')});
export default app;

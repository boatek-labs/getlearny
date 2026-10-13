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
import webPush from 'web-push';
import pdfParse from 'pdf-parse';
import { createWorker } from 'tesseract.js';
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
const pushReady=()=>Boolean(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY&&process.env.VAPID_SUBJECT);
function configurePush(){if(pushReady())webPush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY)}
configurePush();
function auth(req,res,next){const value=req.headers.authorization||'';const token=value.startsWith('Bearer ')?value.slice(7):'';if(!token||!envReady())return fail(res,401,'Sign in required');try{req.user=jwt.verify(token,process.env.JWT_SECRET,{issuer:'getlearny-api',audience:'getlearny-app'});next()}catch{return fail(res,401,'Session expired. Sign in again.')}}
const registration=z.object({name:z.string().trim().min(2).max(120),email:z.string().trim().email().max(254),password:z.string().min(8).max(128),class_level:z.string().trim().max(100).optional().default(''),subjects:z.array(z.string().trim().min(1).max(120)).max(40).optional().default([])});
const login=z.object({email:z.string().trim().email().max(254),password:z.string().min(8).max(128)});
const journalSchema=z.object({learned:z.string().trim().min(1).max(5000),difficult:z.string().max(5000).optional().default(''),next_step:z.string().max(2000).optional().default('')});

app.get('/api/v1/notifications/public-key',(_req,res)=>res.json({configured:pushReady(),publicKey:pushReady()?process.env.VAPID_PUBLIC_KEY:null}));
app.post('/api/v1/notifications/subscriptions',auth,asyncRoute(async(req,res)=>{
 if(!pushReady())return fail(res,503,'Background push notifications are not configured yet');
 const schema=z.object({subscription:z.object({endpoint:z.string().url().max(2048),keys:z.object({p256dh:z.string().min(8),auth:z.string().min(8)})}),timezone:z.string().max(100).optional().default('Africa/Accra'),reminderTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().default('19:00'),dailyReminder:z.boolean().optional().default(true)});
 const parsed=schema.safeParse(req.body);if(!parsed.success)return fail(res,400,'Invalid notification subscription');
 const {subscription,timezone,reminderTime,dailyReminder}=parsed.data;
 await query('INSERT INTO notification_subscriptions(user_id,endpoint,subscription,timezone,reminder_time,daily_reminder_enabled,updated_at) VALUES($1,$2,$3::jsonb,$4,$5::time,$6,now()) ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,subscription=EXCLUDED.subscription,timezone=EXCLUDED.timezone,reminder_time=EXCLUDED.reminder_time,daily_reminder_enabled=EXCLUDED.daily_reminder_enabled,updated_at=now()',[req.user.sub,subscription.endpoint,JSON.stringify(subscription),timezone,reminderTime,dailyReminder]);
 res.status(201).json({saved:true,backgroundPush:true});
}));
app.delete('/api/v1/notifications/subscriptions',auth,asyncRoute(async(req,res)=>{
 const endpoint=String(req.body?.endpoint||'');if(!endpoint)return fail(res,400,'Subscription endpoint is required');
 await query('DELETE FROM notification_subscriptions WHERE user_id=$1 AND endpoint=$2',[req.user.sub,endpoint]);res.json({removed:true});
}));

app.post('/api/v1/notifications/dispatch-reminders',asyncRoute(async(req,res)=>{
 if(!process.env.CRON_SECRET||req.headers.authorization!==`Bearer ${process.env.CRON_SECRET}`)return fail(res,401,'Scheduled notification authorization failed');
 if(!pushReady())return res.json({skipped:true,reason:'Background push notifications are not configured'});
 const due=await query("UPDATE notification_subscriptions SET last_reminder_date=(now() AT TIME ZONE timezone)::date,updated_at=now() WHERE daily_reminder_enabled=true AND last_reminder_date IS DISTINCT FROM (now() AT TIME ZONE timezone)::date AND EXTRACT(HOUR FROM now() AT TIME ZONE timezone)=EXTRACT(HOUR FROM reminder_time) AND floor(EXTRACT(MINUTE FROM now() AT TIME ZONE timezone)/5)=floor(EXTRACT(MINUTE FROM reminder_time)/5) RETURNING id,subscription");
 let sent=0,expired=0,failed=0;
 for(const row of due.rows){try{await webPush.sendNotification(row.subscription,JSON.stringify({title:'Time for a GetLearny study session',body:'Take one small step toward your WASSCE goals.',url:'/',tag:'getlearny-daily-reminder'}));sent++;}catch(error){failed++;if(error.statusCode===404||error.statusCode===410){await query('DELETE FROM notification_subscriptions WHERE id=$1',[row.id]);expired++;}}}
 res.json({matched:due.rowCount,sent,failed,expired});
}));

app.post('/api/v1/notifications/test',auth,asyncRoute(async(req,res)=>{
 if(!pushReady())return fail(res,503,'Background push notifications need VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT configuration');
 const r=await query('SELECT id,subscription FROM notification_subscriptions WHERE user_id=$1',[req.user.sub]);if(!r.rowCount)return fail(res,404,'No push subscription is saved for this account on this device');
 const payload=JSON.stringify({title:'GetLearny test notification',body:'Your device can receive GetLearny notifications.',url:'/',tag:'getlearny-push-test'});
 const results=await Promise.allSettled(r.rows.map(async row=>{try{await webPush.sendNotification(row.subscription,payload)}catch(error){if(error.statusCode===404||error.statusCode===410)await query('DELETE FROM notification_subscriptions WHERE id=$1',[row.id]);throw error}}));
 const sent=results.filter(x=>x.status==='fulfilled').length;if(!sent)return fail(res,502,'Push delivery failed. Check the VAPID configuration and browser subscription.');
 res.json({sent,message:'Test push notification sent.'});
}));

app.get('/api/v1/health',asyncRoute(async(_req,res)=>{const db=await health();res.status(db.configured&&!db.connected?503:200).json({status:db.connected?'ok':db.configured?'degraded':'unconfigured',service:'getlearny-api',database:db,now:new Date().toISOString()})}));
app.post('/api/v1/auth/register',asyncRoute(async(req,res)=>{if(!envReady())return fail(res,503,'Authentication is not configured');const parsed=registration.safeParse(req.body);if(!parsed.success)return fail(res,400,parsed.error.issues[0].message);const {name,email,password,class_level,subjects}=parsed.data;const hash=await bcrypt.hash(password,12);try{const r=await query('INSERT INTO users(name,email,password_hash,class_level,subjects) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,role,avatar_data,class_level,subjects,created_at',[name,email.toLowerCase(),hash,class_level,subjects]);const user=r.rows[0];const token=jwt.sign({sub:user.id,email:user.email,role:user.role},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||'7d',issuer:'getlearny-api',audience:'getlearny-app'});res.status(201).json({token,user})}catch(e){if(e.code==='23505')return fail(res,409,'An account with this email already exists');throw e}}));
app.post('/api/v1/auth/login',asyncRoute(async(req,res)=>{if(!envReady())return fail(res,503,'Authentication is not configured');const parsed=login.safeParse(req.body);if(!parsed.success)return fail(res,400,'Enter a valid email and password');const r=await query('SELECT id,name,email,role,avatar_data,class_level,subjects,password_hash,created_at FROM users WHERE email=$1',[parsed.data.email.toLowerCase()]);const user=r.rows[0];if(!user||!await bcrypt.compare(parsed.data.password,user.password_hash))return fail(res,401,'Email or password is incorrect');delete user.password_hash;const token=jwt.sign({sub:user.id,email:user.email,role:user.role},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||'7d',issuer:'getlearny-api',audience:'getlearny-app'});res.json({token,user})}));
app.get('/api/v1/me',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT id,name,email,role,avatar_data,class_level,subjects,created_at FROM users WHERE id=$1',[req.user.sub]);if(!r.rowCount)return fail(res,404,'Account not found');res.json({user:r.rows[0]})}));
app.patch('/api/v1/me',auth,asyncRoute(async(req,res)=>{const parsed=z.object({class_level:z.string().trim().max(100).optional().default(''),subjects:z.array(z.string().trim().min(1).max(120)).max(40).optional().default([])}).safeParse(req.body);if(!parsed.success)return fail(res,400,parsed.error.issues[0].message);const subjects=[...new Set(parsed.data.subjects.map(s=>s.trim()).filter(Boolean))];const r=await query('UPDATE users SET class_level=$1,subjects=$2,updated_at=now() WHERE id=$3 RETURNING id,name,email,role,avatar_data,class_level,subjects,created_at',[parsed.data.class_level,subjects,req.user.sub]);if(!r.rowCount)return fail(res,404,'Account not found');res.json({user:r.rows[0]})}));
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
app.post('/api/v1/practice/grade',auth,asyncRoute(async(req,res)=>{
 const schema=z.object({subject:z.string().trim().min(1).max(100),questions:z.array(z.object({question:z.string().min(1).max(2000),options:z.array(z.string().min(1).max(500)).length(4),answer:z.number().int().min(0).max(3),explanation:z.string().max(2000).optional().default('')})).min(5).max(15),answers:z.array(z.union([z.number().int().min(0).max(3),z.null()])).min(5).max(15)});
 const parsed=schema.safeParse(req.body);if(!parsed.success)return fail(res,400,'Invalid practice answers');
 const {subject,questions,answers}=parsed.data;if(questions.length!==answers.length)return fail(res,400,'Answer count does not match the question count');
 const results=questions.map((q,i)=>({question:i+1,correct:answers[i]===q.answer,chosen:answers[i],answer:q.answer,explanation:q.explanation}));
 const score=results.filter(x=>x.correct).length;let feedback='Your answers have been checked against the correct options.';
 if(process.env.OPENROUTER_API_KEY){const models=[process.env.OPENROUTER_MODEL||'openrouter/free',...(process.env.OPENROUTER_FALLBACK_MODELS||'').split(',').map(x=>x.trim()).filter(Boolean)].filter((x,i,a)=>a.indexOf(x)===i).slice(0,2);const review=results.map((r,i)=>({question:questions[i].question,options:questions[i].options,student_answer:r.chosen===null?'Not answered':questions[i].options[r.chosen],correct_answer:questions[i].options[r.answer],correct:r.correct,explanation:r.explanation}));for(const model of models){try{const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENROUTER_API_KEY,'Content-Type':'application/json','HTTP-Referer':process.env.OPENROUTER_SITE_URL||process.env.APP_URL||'https://getlearny.vercel.app','X-Title':'GetLearny Exam Review'},body:JSON.stringify({model,temperature:0.2,max_tokens:850,messages:[{role:'system',content:'You are a supportive Ghana SHS tutor reviewing a completed timed multiple-choice practice. Give concise, useful feedback based only on the supplied results. Mention strengths or topics to revise, explain mistakes briefly, and suggest one next step. Do not change the objective score. Keep response under 120 words.'},{role:'user',content:JSON.stringify({subject,score,max_score:questions.length,answers:review})}]}),signal:AbortSignal.timeout(8500)});if(!response.ok)continue;const data=await response.json(),content=data.choices?.[0]?.message?.content;if(typeof content==='string'&&content.trim()){feedback=content.trim().slice(0,1400);break;}}catch{}}}
 res.json({score,max_score:questions.length,results,feedback,ai_review:feedback!=='Your answers have been checked against the correct options.'});
}));
app.post('/api/v1/practice/generate',auth,asyncRoute(async(req,res)=>{
 const parsed=z.object({subject:z.string().trim().min(1).max(100),topic:z.string().trim().max(200).optional().default(''),level:z.string().max(100).optional().default('Not specified'),count:z.number().int().min(5).max(15).default(10)}).safeParse(req.body);
 if(!parsed.success)return fail(res,400,parsed.error.issues[0].message);
 const {subject,topic,level,count}=parsed.data;const key=process.env.OPENROUTER_API_KEY;
 if(!key)return fail(res,503,'AI practice is not configured. Add OPENROUTER_API_KEY to the API deployment environment.');
 const models=[process.env.OPENROUTER_MODEL||'openrouter/free',...(process.env.OPENROUTER_FALLBACK_MODELS||'').split(',').map(x=>x.trim()).filter(Boolean)].filter((x,i,a)=>a.indexOf(x)===i).slice(0,4);let lastStatus=0;
 for(const model of models){try{const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','HTTP-Referer':process.env.OPENROUTER_SITE_URL||process.env.APP_URL||'https://getlearny.vercel.app','X-Title':'GetLearny'},body:JSON.stringify({model,temperature:0.4,max_tokens:3600,response_format:{type:'json_object'},messages:[{role:'system',content:'Create accurate age-appropriate multiple choice practice for a Ghanaian secondary student. Return only JSON object with key questions, an array of exactly requested count. Each item has question string, options array of exactly 4 strings, answer integer 0-3, explanation string, topic string. Exactly one correct answer per question. No markdown.'},{role:'user',content:'Create '+count+' original questions. Subject: '+subject+'; class level: '+level+'; topic: '+(topic||'balanced core concepts')+'. Follow the schema exactly.'}]}),signal:AbortSignal.timeout(25000)});lastStatus=response.status;if(!response.ok)continue;const data=await response.json();let content=data.choices?.[0]?.message?.content;if(typeof content!=='string')continue;content=content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');const decoded=JSON.parse(content),qs=decoded.questions;if(!Array.isArray(qs)||qs.length!==count)continue;const valid=qs.every(q=>typeof q.question==='string'&&q.question.trim()&&Array.isArray(q.options)&&q.options.length===4&&q.options.every(o=>typeof o==='string'&&o.trim())&&Number.isInteger(q.answer)&&q.answer>=0&&q.answer<4&&typeof q.explanation==='string'&&q.explanation.trim());if(!valid)continue;return res.json({questions:qs,generatedBy:'openrouter',subject,model})}catch{}}
 return fail(res,502,lastStatus===401?'OpenRouter rejected the API key. Verify the key in the API deployment environment.':lastStatus===402?'OpenRouter reports insufficient credits or a payment limit.':lastStatus===429?'OpenRouter rate limit reached. Try again shortly.':'OpenRouter could not generate a valid practice set. Check the model and API key, then retry.');
}));
const lessonInput=z.object({subject:z.string().trim().min(1).max(100),topic:z.string().trim().min(1).max(200),level:z.string().max(30).default('SHS 3'),exam:z.string().max(30).default('WASSCE')});
app.post('/api/v1/lessons/generate',auth,asyncRoute(async(req,res)=>{
  const parsed=lessonInput.safeParse(req.body);
  if(!parsed.success)return fail(res,400,parsed.error.issues[0].message);
  const {subject,topic,level,exam}=parsed.data;

  const key=process.env.OPENROUTER_API_KEY;
  if(!key)return fail(res,503,'AI lessons are not configured. Add OPENROUTER_API_KEY to the API deployment environment.');
  let lesson=null;
  let lastStatus=0;
  const configured=[process.env.OPENROUTER_MODEL||'openrouter/free',...(process.env.OPENROUTER_FALLBACK_MODELS||'').split(',').map(x=>x.trim()).filter(Boolean)];
  const models=[...configured,'google/gemma-4-31b-it:free','nvidia/nemotron-3-ultra-550b-a55b:free','openrouter/free'].filter((x,i,a)=>a.indexOf(x)===i).slice(0,2);
  for(let index=0;index<models.length;index++){
    const model=models[index];
    try{
      const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{
        method:'POST',
        headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','HTTP-Referer':process.env.OPENROUTER_SITE_URL||process.env.APP_URL||'https://getlearny.vercel.app','X-Title':process.env.OPENROUTER_APP_NAME||'GetLearny'},
        body:JSON.stringify({model,messages:[
          {role:'system',content:'You are a careful Ghana SHS tutor preparing students for WASSCE. Teach prerequisite concepts first, use age-appropriate language, worked examples, common mistakes, and a short self-check. Do not fabricate official syllabus claims.'},
          {role:'user',content:`Create a useful lesson in Markdown. Subject: ${subject}. Topic: ${topic}. Level: ${level}. Exam: ${exam}. Include goals, prerequisite check, explanation, worked example, common mistakes, exam tip, and 3 self-check questions with answers at the end.`}
        ],temperature:0.4,max_tokens:1500}),
        signal:AbortSignal.timeout(index===0?14000:9000)
      });
      lastStatus=response.status;
      if(!response.ok){console.warn('OpenRouter lesson model failed:',model,'HTTP',response.status);continue;}
      const data=await response.json();
      const generated=data.choices?.[0]?.message?.content;
      if(typeof generated==='string'&&generated.trim()){lesson=generated;break;}
      console.warn('OpenRouter lesson model returned empty content:',model);
    }catch(error){console.warn('OpenRouter lesson request failed:',model,error?.name||'request error');}
  }
  if(!lesson)return fail(res,502,lastStatus===401?'OpenRouter rejected the API key. Check OPENROUTER_API_KEY in Vercel.':lastStatus===402?'OpenRouter reports a payment or credit limit.':lastStatus===429?'OpenRouter free-model rate limit reached. Try again shortly.':'AI lesson generation timed out or no free model returned a lesson. Check Vercel function logs and OpenRouter model availability, then retry.');
  res.json({lesson,generatedBy:'openrouter',subject,topic});
}));
const TEXT_MATERIAL_EXTENSIONS=new Set(['.txt','.md','.markdown','.csv','.json']);
const OCR_IMAGE_MIMES=new Set(['image/png','image/jpeg','image/webp']);
const TEXT_MATERIAL_MIMES=new Set(['text/plain','text/markdown','text/csv','application/json','application/octet-stream']);
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:(Number(process.env.MAX_UPLOAD_MB)||12)*1024*1024,files:1},fileFilter:(_req,file,cb)=>{const ext=path.extname(file.originalname||'').toLowerCase();if(file.mimetype==='application/pdf'||OCR_IMAGE_MIMES.has(file.mimetype)||(TEXT_MATERIAL_EXTENSIONS.has(ext)&&TEXT_MATERIAL_MIMES.has(file.mimetype)))return cb(null,true);return cb(new Error('Supported study materials: PDF, TXT, Markdown, CSV, JSON, PNG, JPG and WEBP files'))}});const avatarUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1},fileFilter:(_req,file,cb)=>{if(!['image/jpeg','image/png','image/webp'].includes(file.mimetype))return cb(new Error('Profile pictures must be JPG, PNG or WebP'));cb(null,true)}});
app.post('/api/v1/profile/avatar',auth,avatarUpload.single('file'),asyncRoute(async(req,res)=>{if(!req.file)return fail(res,400,'Choose a JPG, PNG or WebP profile picture');const avatar_data='data:'+req.file.mimetype+';base64,'+req.file.buffer.toString('base64');const r=await query('UPDATE users SET avatar_data=$1,updated_at=now() WHERE id=$2 RETURNING id,name,email,role,avatar_data,class_level,subjects,created_at',[avatar_data,req.user.sub]);res.json({user:r.rows[0],message:'Profile picture updated'})}));
app.post('/api/v1/documents',auth,upload.single('file'),asyncRoute(async(req,res)=>{
 if(!req.file)return fail(res,400,'Select a supported study material file');
 let extractedText='',processingStatus='uploaded';
 if(TEXT_MATERIAL_EXTENSIONS.has(path.extname(req.file.originalname||'').toLowerCase())){extractedText=req.file.buffer.toString('utf8').replace(/\u0000/g,'').slice(0,150000);processingStatus=extractedText.trim()?'ready':'uploaded';}
 else if(OCR_IMAGE_MIMES.has(req.file.mimetype)){let worker;try{worker=await createWorker('eng');const result=await worker.recognize(req.file.buffer);extractedText=String(result.data?.text||'').slice(0,150000);processingStatus=extractedText.trim()?'ready':'ocr_failed';}catch(error){console.error('Image OCR failed:',error.message);processingStatus='ocr_failed';}finally{if(worker)await worker.terminate().catch(()=>{});}}
 else{
  try{const parsed=await pdfParse(req.file.buffer);extractedText=String(parsed.text||'').slice(0,150000);processingStatus=extractedText.trim()?'ready':'needs_ocr';}catch{processingStatus='needs_ocr';}
  if(!extractedText.trim()&&req.file.size<=6*1024*1024&&process.env.OPENROUTER_API_KEY){
   const models=[process.env.OPENROUTER_MODEL||'openrouter/free',...(process.env.OPENROUTER_FALLBACK_MODELS||'').split(',').map(x=>x.trim()).filter(Boolean)].filter((x,i,a)=>a.indexOf(x)===i).slice(0,3);
   for(const model of models){try{const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENROUTER_API_KEY,'Content-Type':'application/json','HTTP-Referer':process.env.OPENROUTER_SITE_URL||process.env.APP_URL||'https://getlearny.vercel.app','X-Title':'GetLearny OCR'},body:JSON.stringify({model,temperature:0,max_tokens:6000,messages:[{role:'system',content:'You are an OCR engine for a student study document. Transcribe the visible text faithfully, preserving headings, formulas, numbering and tables as clearly as possible. Do not summarize or invent missing text. If pages contain no readable text, return an empty string.'},{role:'user',content:[{type:'text',text:'Extract all readable text from this scanned study PDF. Return only the transcription.'},{type:'file',file:{filename:path.basename(req.file.originalname||'study-material.pdf'),file_data:'data:application/pdf;base64,'+req.file.buffer.toString('base64')}}]}]}),signal:AbortSignal.timeout(18000)});if(!response.ok)continue;const data=await response.json(),text=data.choices?.[0]?.message?.content;if(typeof text==='string'&&text.trim()){extractedText=text.trim().slice(0,150000);processingStatus='ready';break;}}catch(error){console.warn('Scanned PDF AI OCR attempt failed:',error.message);}}
  }
 }
 const title=String(req.body?.material_title||req.file.originalname).trim();
 const r=await query('INSERT INTO uploaded_documents(user_id,original_name,storage_path,mime_type,size_bytes,content,extracted_text,processing_status,subject_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,original_name,mime_type,size_bytes,processing_status,subject_name,created_at',[req.user.sub,path.basename(title).slice(0,255)||path.basename(req.file.originalname).slice(0,255),'database',req.file.mimetype,req.file.size,req.file.buffer,extractedText,processingStatus,String(req.body?.subject_name||'General').trim().slice(0,120)||'General']);
 const messages={needs_ocr:'This PDF has no selectable text. AI OCR was unavailable for this file; try a smaller scanned PDF or upload clear page images.',ocr_failed:'OCR could not read this image. Try a clearer, well-lit image.',ready:'Study material saved and text extracted. The AI tutor can now use it.',uploaded:'File saved, but no readable text was found.'};
 res.status(201).json({document:r.rows[0],message:messages[processingStatus]||messages.uploaded});
}));
app.post('/api/v1/documents/:id/ask',auth,asyncRoute(async(req,res)=>{
 const parsed=z.object({question:z.string().trim().min(3).max(1000)}).safeParse(req.body);
 if(!parsed.success)return fail(res,400,'Enter a question of 3 to 1000 characters');
 const result=await query('SELECT original_name,extracted_text,processing_status FROM uploaded_documents WHERE id=$1 AND user_id=$2',[req.params.id,req.user.sub]);
 if(!result.rowCount)return fail(res,404,'Study material not found');
 const doc=result.rows[0];if(!doc.extracted_text?.trim())return fail(res,422,doc.processing_status==='needs_ocr'?'This PDF appears to be scanned or image-only. OCR must be configured before the tutor can read it.':'No readable text was extracted from this file.');
 if(!process.env.OPENROUTER_API_KEY)return fail(res,503,'Document AI tutoring needs OPENROUTER_API_KEY configured in the deployment.');
 const models=[process.env.OPENROUTER_MODEL||'openrouter/free',...(process.env.OPENROUTER_FALLBACK_MODELS||'').split(',').map(x=>x.trim()).filter(Boolean)].filter((x,i,a)=>a.indexOf(x)===i).slice(0,3);
 for(const model of models){try{const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`,'Content-Type':'application/json','HTTP-Referer':process.env.OPENROUTER_SITE_URL||process.env.APP_URL||'https://getlearny.vercel.app','X-Title':process.env.OPENROUTER_APP_NAME||'GetLearny'},body:JSON.stringify({model,messages:[{role:'system',content:'You are a supportive Ghana SHS tutor. Answer the student using the supplied study document as the primary source. Explain concepts clearly, use age-appropriate language, show a short example when useful, and say when the document does not contain enough information. Do not invent quotations or pretend unsupported facts came from the file.'},{role:'user',content:`Study file: ${doc.original_name}\n\nDOCUMENT EXCERPT:\n${doc.extracted_text.slice(0,30000)}\n\nSTUDENT QUESTION:\n${parsed.data.question}`}],temperature:0.3,max_tokens:1000}),signal:AbortSignal.timeout(10000)});if(!response.ok)continue;const data=await response.json();const answer=data.choices?.[0]?.message?.content;if(typeof answer==='string'&&answer.trim())return res.json({answer:answer.trim(),source:doc.original_name,generatedBy:'openrouter'});}catch{/* try the next configured model */}}
 return fail(res,502,'The document tutor could not reach an available AI model. Please try again.');
}));

app.get('/api/v1/documents',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT id,original_name,mime_type,size_bytes,processing_status,subject_name,created_at FROM uploaded_documents WHERE user_id=$1 ORDER BY subject_name,created_at DESC LIMIT 100',[req.user.sub]);res.json({documents:r.rows})}));
app.get('/api/v1/documents/:id',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT original_name,mime_type,content FROM uploaded_documents WHERE id=$1 AND user_id=$2',[req.params.id,req.user.sub]);if(!r.rowCount)return fail(res,404,'Document not found');res.setHeader('Content-Type',r.rows[0].mime_type);res.setHeader('Content-Disposition','attachment; filename="study-material"');res.send(r.rows[0].content)}));
app.use((err,_req,res,_next)=>{if(err instanceof multer.MulterError)return fail(res,err.code==='LIMIT_FILE_SIZE'?413:400,err.code==='LIMIT_FILE_SIZE'?'File is too large':'Upload failed');if(err.message==='Origin not allowed by CORS')return fail(res,403,err.message);console.error(err);return fail(res,500,process.env.NODE_ENV==='production'?'Unexpected server error':err.message||'Unexpected server error')});
export default app;

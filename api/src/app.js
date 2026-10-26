import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID, randomInt, createHash } from 'node:crypto';
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
export async function generateWithGemini({system,user,maxOutputTokens=1500,temperature=0.4,json=false,timeoutMs=15000,onFailure,onModel,validateResponse}){
 const apiKey=process.env.GEMINI_API_KEY;
 if(!apiKey){console.warn('Gemini is not configured: GEMINI_API_KEY is missing');onFailure?.({kind:'missing_key'});return null;}
 const primaryModel=process.env.GEMINI_MODEL||'gemini-3.8-flash';
 const configuredFallbacks=(process.env.GEMINI_FALLBACK_MODELS||'').split(',').map(value=>value.trim()).filter(Boolean);
 // Keep three supported text-generation models available, even if an environment
 // override only supplies one fallback.
 const models=[...new Set([primaryModel,...configuredFallbacks,'gemini-3.6-flash','gemini-3.5-flash-lite'])].slice(0,3);
 const deadline=Date.now()+timeoutMs;
 let lastFailure=null;
 for(let index=0;index<models.length;index++){
  const model=models[index];
  const remaining=deadline-Date.now();
  if(remaining<1000)break;
  const attemptTimeout=Math.max(2500,Math.min(10000,Math.floor(remaining/(models.length-index))));
  // Gemini 3.x/4.x reject legacy sampling parameters such as temperature.
  // Use low thinking for interactive learning tasks and retain the token budget for the answer.
  const generationConfig={maxOutputTokens,...(json?{responseMimeType:'application/json'}:{})};
  if(/^gemini-(?:3|4)(?:[.-])/i.test(model))generationConfig.thinkingConfig={thinkingLevel:'low'};
  else generationConfig.temperature=temperature;
  try{
   const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
    body:JSON.stringify({
     systemInstruction:{parts:[{text:system}]},
     contents:[{role:'user',parts:Array.isArray(user)?user:[{text:user}]}],
     generationConfig
    }),
    signal:AbortSignal.timeout(attemptTimeout)
   });
   if(!response.ok){
    let detail='';
    try{const errorData=await response.json();detail=String(errorData.error?.message||'').slice(0,240)}catch{}
    lastFailure={kind:'http',status:response.status,detail,model};
    console.warn('Gemini request failed: HTTP',response.status,'model',model,detail);
    // Retry only transient errors. Invalid keys, permissions and malformed requests
    // should fail quickly instead of repeatedly hitting the provider.
    if([403,404,408,429,500,502,503,504].includes(response.status)&&index<models.length-1)continue;
    break;
   }
   const data=await response.json();
   const text=(data.candidates?.[0]?.content?.parts||[]).map(part=>part.text||'').join('').trim();
   if(!text){
    const reason=data.promptFeedback?.blockReason||data.candidates?.[0]?.finishReason||'no finish reason';
    console.warn('Gemini returned no text from model',model,reason);
    lastFailure={kind:'empty',reason:String(reason),model};
    if(index<models.length-1)continue;
    break;
   }
   if(typeof validateResponse==='function'&&!validateResponse(text)){
    lastFailure={kind:'invalid_response',model};
    console.warn('Gemini response failed output validation for model',model);
    if(index<models.length-1)continue;
    break;
   }
   onModel?.(model);
   return text;
  }catch(error){
   const kind=error?.name==='TimeoutError'||error?.name==='AbortError'?'timeout':'network';
   console.warn('Gemini request failed:',error?.name||'request error','model',model);
   lastFailure={kind,model};
   if(index<models.length-1&&Date.now()<deadline-1000)continue;
   break;
  }
 }
 onFailure?.(lastFailure||{kind:'timeout'});
 return null;
}
const fail=(res,status,error)=>res.status(status).json({error});
const envReady=()=>Boolean(process.env.JWT_SECRET&&process.env.JWT_SECRET.length>=32);
const emailOtpLimiter=rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:true,legacyHeaders:false,message:{error:'Too many email verification requests. Wait 15 minutes and try again.'}});
const pushReady=()=>Boolean(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY&&process.env.VAPID_SUBJECT);
function configurePush(){if(pushReady())webPush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY)}
configurePush();
function auth(req,res,next){const value=req.headers.authorization||'';const token=value.startsWith('Bearer ')?value.slice(7):'';if(!token||!envReady())return fail(res,401,'Sign in required');try{req.user=jwt.verify(token,process.env.JWT_SECRET,{issuer:'getlearny-api',audience:'getlearny-app'});next()}catch{return fail(res,401,'Session expired. Sign in again.')}}
const registration=z.object({name:z.string().trim().min(2).max(120),email:z.string().trim().email().max(254),password:z.string().min(8).max(128),class_level:z.string().trim().max(100).optional().default(''),subjects:z.array(z.string().trim().min(1).max(120)).max(40).optional().default([]),referral_code:z.string().trim().max(32).optional().default('')});
function subjectIdentity(value){const cleaned=String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en');const aliases={'english':'english language','core math':'core mathematics','core maths':'core mathematics','math':'core mathematics','maths':'core mathematics','add math':'additional mathematics','add maths':'additional mathematics','elective mathematics':'additional mathematics','elective maths':'additional mathematics','comp sci':'computer science'};return aliases[cleaned]||cleaned}
function normalizeSubjectList(values=[]){const seen=new Set();return values.map(value=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ')).filter(value=>{if(!value)return false;const key=subjectIdentity(value);if(seen.has(key))return false;seen.add(key);return true})}
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
app.get('/api/v1/auth/config',(req,res)=>res.json({googleClientId:process.env.GOOGLE_CLIENT_ID||''}));
app.post('/api/v1/auth/google',asyncRoute(async(req,res)=>{
 if(!envReady())return fail(res,503,'Authentication is not configured');
 const credential=typeof req.body?.credential==='string'?req.body.credential:'';
 if(!credential||credential.length>10000)return fail(res,400,'Google sign-in credential is missing or invalid');
 const clientId=process.env.GOOGLE_CLIENT_ID;
 if(!clientId)return fail(res,503,'Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID in Vercel.');
 let claims;
 try{
  const verify=await fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(credential),{signal:AbortSignal.timeout(8000)});
  if(!verify.ok)return fail(res,401,'Google could not verify this sign-in. Please try again.');
  claims=await verify.json();
 }catch{return fail(res,502,'Could not reach Google to verify sign-in. Please try again.')}
 if(claims.aud!==clientId||(claims.email_verified!==true&&claims.email_verified!=='true')||!claims.email||!claims.sub)return fail(res,401,'Google account verification failed.');
 const email=String(claims.email).trim().toLowerCase();
 const displayName=String(claims.name||claims.given_name||email.split('@')[0]).trim().slice(0,120);
 let found=await query('SELECT id,name,email,role,avatar_data,class_level,subjects,created_at FROM users WHERE email=$1',[email]);
 let user=found.rows[0];
 if(!user){
  const passwordHash=await bcrypt.hash(randomUUID()+randomUUID(),12);
  try{
   const created=await query("INSERT INTO users(name,email,password_hash,class_level,subjects) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,role,avatar_data,class_level,subjects,created_at",[displayName,email,passwordHash,'',[]]);
   user=created.rows[0];
   const referralCode=typeof req.body?.referral_code==='string'?req.body.referral_code.trim().slice(0,32):'';
   if(referralCode){const ref=await query('SELECT owner_user_id FROM referral_codes WHERE code=$1',[referralCode]);if(ref.rowCount&&ref.rows[0].owner_user_id!==user.id)await query('INSERT INTO referrals(referrer_user_id,referred_user_id,referral_code) VALUES($1,$2,$3) ON CONFLICT(referred_user_id) DO NOTHING',[ref.rows[0].owner_user_id,user.id,referralCode]);}
  }catch(error){
   if(error.code!=='23505')throw error;
   found=await query('SELECT id,name,email,role,avatar_data,class_level,subjects,created_at FROM users WHERE email=$1',[email]);
   user=found.rows[0];
   if(!user)throw error;
  }
 }
 const token=jwt.sign({sub:user.id,email:user.email,role:user.role},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||'7d',issuer:'getlearny-api',audience:'getlearny-app'});
 res.json({token,user,created:!found.rowCount});
}));
app.post('/api/v1/auth/register/request-otp',emailOtpLimiter,asyncRoute(async(req,res)=>{
 if(!envReady())return fail(res,503,'Authentication is not configured');
 if(!process.env.RESEND_API_KEY||!process.env.EMAIL_FROM)return fail(res,503,'Email verification is not configured. Add RESEND_API_KEY and EMAIL_FROM in Vercel, then redeploy.');
 const parsed=registration.safeParse(req.body);
 if(!parsed.success)return fail(res,400,parsed.error.issues[0].message);
 const data=parsed.data;const email=data.email.toLowerCase();
 const existing=await query('SELECT id FROM users WHERE email=$1',[email]);
 if(existing.rowCount)return fail(res,409,'An account with this email already exists. Sign in instead.');
 const otp=String(randomInt(0,1000000)).padStart(6,'0');
 const otpHash=createHash('sha256').update(email+':'+otp+':'+process.env.JWT_SECRET).digest('hex');
 const passwordHash=await bcrypt.hash(data.password,12);
 await query('INSERT INTO email_verification_codes(email,otp_hash,pending_data,expires_at,attempts) VALUES($1,$2,$3::jsonb,now()+interval \'10 minutes\',0) ON CONFLICT(email) DO UPDATE SET otp_hash=EXCLUDED.otp_hash,pending_data=EXCLUDED.pending_data,expires_at=EXCLUDED.expires_at,attempts=0,created_at=now()',[email,otpHash,JSON.stringify({name:data.name,email,class_level:data.class_level,subjects:normalizeSubjectList(data.subjects),password_hash:passwordHash,referral_code:data.referral_code})]);
 let mail;
 try{
  mail=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[email],subject:'Your GetLearny verification code',text:'Hello '+data.name+',\n\nYour GetLearny verification code is '+otp+'. It expires in 10 minutes. If you did not request this, you can ignore this email.\n\nGetLearny'}),signal:AbortSignal.timeout(10000)});
 }catch{return fail(res,502,'The verification email could not be sent because the email service timed out. Please try again.')}
 if(!mail.ok){await query('DELETE FROM email_verification_codes WHERE email=$1',[email]);return fail(res,502,'The verification email could not be sent. Check the email service configuration and try again.')}
 res.status(202).json({message:'Verification code sent. Check your inbox and spam folder.',email,expiresInSeconds:600});
}));
app.post('/api/v1/auth/register/verify-otp',emailOtpLimiter,asyncRoute(async(req,res)=>{
 if(!envReady())return fail(res,503,'Authentication is not configured');
 const parsed=z.object({email:z.string().trim().email().max(254),code:z.string().regex(/^\d{6}$/)}).safeParse(req.body);
 if(!parsed.success)return fail(res,400,'Enter the email address and the 6-digit code.');
 const email=parsed.data.email.toLowerCase();
 const pending=await query('SELECT otp_hash,pending_data,expires_at,attempts FROM email_verification_codes WHERE email=$1',[email]);
 const record=pending.rows[0];
 if(!record)return fail(res,400,'No active verification request. Create your account again to receive a new code.');
 if(new Date(record.expires_at).getTime()<Date.now()){await query('DELETE FROM email_verification_codes WHERE email=$1',[email]);return fail(res,400,'That code has expired. Request a new verification code.')}
 if(record.attempts>=5){await query('DELETE FROM email_verification_codes WHERE email=$1',[email]);return fail(res,429,'Too many incorrect attempts. Request a new verification code.')}
 const submitted=createHash('sha256').update(email+':'+parsed.data.code+':'+process.env.JWT_SECRET).digest('hex');
 if(submitted!==record.otp_hash){await query('UPDATE email_verification_codes SET attempts=attempts+1 WHERE email=$1',[email]);return fail(res,400,'That verification code is incorrect. Check it and try again.')}
 const data=record.pending_data;
 try{
  const created=await query('INSERT INTO users(name,email,password_hash,class_level,subjects) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,role,avatar_data,class_level,subjects,created_at',[data.name,email,data.password_hash,data.class_level,normalizeSubjectList(data.subjects||[])]);
  if(data.referral_code){const ref=await query('SELECT owner_user_id FROM referral_codes WHERE code=$1',[data.referral_code]);if(ref.rowCount&&ref.rows[0].owner_user_id!==created.rows[0].id)await query('INSERT INTO referrals(referrer_user_id,referred_user_id,referral_code) VALUES($1,$2,$3) ON CONFLICT(referred_user_id) DO NOTHING',[ref.rows[0].owner_user_id,created.rows[0].id,data.referral_code]);}
  await query('DELETE FROM email_verification_codes WHERE email=$1',[email]);
  const user=created.rows[0];const token=jwt.sign({sub:user.id,email:user.email,role:user.role},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||'7d',issuer:'getlearny-api',audience:'getlearny-app'});
  res.status(201).json({token,user});
 }catch(error){if(error.code==='23505'){await query('DELETE FROM email_verification_codes WHERE email=$1',[email]);return fail(res,409,'An account with this email already exists. Sign in instead.')}throw error}
}));
app.post('/api/v1/auth/register',asyncRoute(async(req,res)=>{if(!envReady())return fail(res,503,'Authentication is not configured');const parsed=registration.safeParse(req.body);if(!parsed.success)return fail(res,400,parsed.error.issues[0].message);const {name,email,password,class_level}=parsed.data;const subjects=normalizeSubjectList(parsed.data.subjects);const hash=await bcrypt.hash(password,12);try{const r=await query('INSERT INTO users(name,email,password_hash,class_level,subjects) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,role,avatar_data,class_level,subjects,created_at',[name,email.toLowerCase(),hash,class_level,subjects]);const user=r.rows[0];const referralCode=parsed.data.referral_code;if(referralCode){const ref=await query('SELECT owner_user_id FROM referral_codes WHERE code=$1',[referralCode]);if(ref.rowCount&&ref.rows[0].owner_user_id!==user.id)await query('INSERT INTO referrals(referrer_user_id,referred_user_id,referral_code) VALUES($1,$2,$3) ON CONFLICT(referred_user_id) DO NOTHING',[ref.rows[0].owner_user_id,user.id,referralCode]);}const token=jwt.sign({sub:user.id,email:user.email,role:user.role},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||'7d',issuer:'getlearny-api',audience:'getlearny-app'});res.status(201).json({token,user})}catch(e){if(e.code==='23505')return fail(res,409,'An account with this email already exists');throw e}}));
app.post('/api/v1/auth/login',asyncRoute(async(req,res)=>{if(!envReady())return fail(res,503,'Authentication is not configured');const parsed=login.safeParse(req.body);if(!parsed.success)return fail(res,400,'Enter a valid email and password');const r=await query('SELECT id,name,email,role,avatar_data,class_level,subjects,password_hash,created_at FROM users WHERE email=$1',[parsed.data.email.toLowerCase()]);const user=r.rows[0];if(!user||!await bcrypt.compare(parsed.data.password,user.password_hash))return fail(res,401,'Email or password is incorrect');delete user.password_hash;const token=jwt.sign({sub:user.id,email:user.email,role:user.role},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||'7d',issuer:'getlearny-api',audience:'getlearny-app'});res.json({token,user})}));
app.get('/api/v1/me',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT id,name,email,role,avatar_data,class_level,subjects,created_at FROM users WHERE id=$1',[req.user.sub]);if(!r.rowCount)return fail(res,404,'Account not found');res.json({user:r.rows[0]})}));
app.patch('/api/v1/me',auth,asyncRoute(async(req,res)=>{const parsed=z.object({class_level:z.string().trim().max(100).optional().default(''),subjects:z.array(z.string().trim().min(1).max(120)).max(40).optional().default([])}).safeParse(req.body);if(!parsed.success)return fail(res,400,parsed.error.issues[0].message);const subjects=normalizeSubjectList(parsed.data.subjects);const r=await query('UPDATE users SET class_level=$1,subjects=$2,updated_at=now() WHERE id=$3 RETURNING id,name,email,role,avatar_data,class_level,subjects,created_at',[parsed.data.class_level,subjects,req.user.sub]);if(!r.rowCount)return fail(res,404,'Account not found');res.json({user:r.rows[0]})}));
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
app.get('/api/v1/community/summary',auth,asyncRoute(async(req,res)=>{
 let referral=await query('SELECT code FROM referral_codes WHERE owner_user_id=$1',[req.user.sub]);
 if(!referral.rowCount){const code=randomUUID().replace(/-/g,'').slice(0,12).toUpperCase();referral=await query('INSERT INTO referral_codes(owner_user_id,code) VALUES($1,$2) ON CONFLICT(owner_user_id) DO UPDATE SET owner_user_id=EXCLUDED.owner_user_id RETURNING code',[req.user.sub,code]);}
 const result=await query(`SELECT DISTINCT study_day FROM (
  SELECT to_char((created_at AT TIME ZONE 'UTC')::date,'YYYY-MM-DD') AS study_day FROM learning_logs WHERE user_id=$1 AND (status='completed' OR minutes_spent>0)
  UNION SELECT to_char((taken_at AT TIME ZONE 'UTC')::date,'YYYY-MM-DD') AS study_day FROM test_logs WHERE user_id=$1
 ) activity ORDER BY study_day DESC LIMIT 400`,[req.user.sub]);
 // PostgreSQL date values can arrive as Date objects depending on driver configuration.
 // Keep the streak algorithm operating only on validated YYYY-MM-DD strings.
 const days=result.rows.map(row=>{
  const value=row.study_day instanceof Date
   ? (Number.isNaN(row.study_day.getTime())?'':row.study_day.toISOString().slice(0,10))
   : String(row.study_day??'').slice(0,10);
  return /^\\d{4}-\\d{2}-\\d{2}$/.test(value)?value:'';
 }).filter(Boolean);
 const today=new Date().toISOString().slice(0,10),yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
 let current=0,check=days.includes(today)?today:days.includes(yesterday)?yesterday:null;
 if(check){for(const day of days){if(day!==check)break;current++;const d=new Date(check+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-1);check=d.toISOString().slice(0,10);}}
 let longest=0,run=0,previous=null;for(const day of [...days].sort()){if(previous){const d=new Date(previous+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);run=day===d.toISOString().slice(0,10)?run+1:1}else run=1;longest=Math.max(longest,run);previous=day;}
 // Referral qualification requires recorded study activity, not just a sign-in.
 const hasStudyActivity=days.length>0;
 if(hasStudyActivity)await query('UPDATE referrals SET qualified_at=COALESCE(qualified_at,now()) WHERE referred_user_id=$1',[req.user.sub]);
 const referrals=await query('SELECT count(*)::int AS invited,count(*) FILTER(WHERE qualified_at IS NOT NULL)::int AS qualified FROM referrals WHERE referrer_user_id=$1',[req.user.sub]);
 res.json({streak:{current,longest,activeDays:days.length,lastStudyDay:days[0]||null},referral:referrals.rows[0],invite:{url:process.env.APP_URL||'https://getlearny.vercel.app',code:referral.rows[0].code}});
}));
app.get('/api/v1/dashboard',auth,asyncRoute(async(req,res)=>{const [logs,tests,journal]=await Promise.all([query("SELECT count(*) FILTER(WHERE status='completed')::int AS completed_topics,coalesce(sum(minutes_spent),0)::int AS minutes_studied FROM learning_logs WHERE user_id=$1",[req.user.sub]),query('SELECT count(*)::int AS tests,coalesce(round(avg(score/max_score*100),1),0) AS average_percent FROM test_logs WHERE user_id=$1',[req.user.sub]),query('SELECT count(*)::int AS journal_entries FROM journal_entries WHERE user_id=$1',[req.user.sub])]);res.json({progress:{completedTopics:logs.rows[0].completed_topics,minutesStudied:logs.rows[0].minutes_studied},tests:tests.rows[0],journal:journal.rows[0]})}));
app.post('/api/v1/learning-logs',auth,asyncRoute(async(req,res)=>{const s=z.object({subject:z.string().min(1).max(100),topic:z.string().min(1).max(200),minutes_spent:z.number().int().min(0).max(1440).default(0),status:z.enum(['started','completed','review']).default('started'),notes:z.string().max(5000).default('')}).safeParse(req.body);if(!s.success)return fail(res,400,s.error.issues[0].message);const d=s.data;const r=await query('INSERT INTO learning_logs(user_id,subject,topic,minutes_spent,status,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[req.user.sub,d.subject,d.topic,d.minutes_spent,d.status,d.notes]);if(d.status==='completed'||d.minutes_spent>0)await query('UPDATE referrals SET qualified_at=COALESCE(qualified_at,now()) WHERE referred_user_id=$1',[req.user.sub]);res.status(201).json({log:r.rows[0]})}));
app.get('/api/v1/learning-logs',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT * FROM learning_logs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.sub]);res.json({logs:r.rows})}));
app.post('/api/v1/tests',auth,asyncRoute(async(req,res)=>{const s=z.object({subject:z.string().min(1).max(100),title:z.string().min(1).max(200),score:z.number().min(0),max_score:z.number().positive()}).refine(d=>d.score<=d.max_score,{message:'Score cannot exceed maximum'}).safeParse(req.body);if(!s.success)return fail(res,400,s.error.issues[0].message);const d=s.data;const r=await query('INSERT INTO test_logs(user_id,subject,title,score,max_score) VALUES($1,$2,$3,$4,$5) RETURNING *',[req.user.sub,d.subject,d.title,d.score,d.max_score]);await query('UPDATE referrals SET qualified_at=COALESCE(qualified_at,now()) WHERE referred_user_id=$1',[req.user.sub]);res.status(201).json({test:r.rows[0]})}));
app.get('/api/v1/tests',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT * FROM test_logs WHERE user_id=$1 ORDER BY taken_at DESC LIMIT 100',[req.user.sub]);res.json({tests:r.rows})}));
app.post('/api/v1/journal',auth,asyncRoute(async(req,res)=>{const s=journalSchema.safeParse(req.body);if(!s.success)return fail(res,400,s.error.issues[0].message);const d=s.data;const r=await query('INSERT INTO journal_entries(user_id,learned,difficult,next_step) VALUES($1,$2,$3,$4) RETURNING id,learned,difficult,next_step,created_at',[req.user.sub,d.learned,d.difficult,d.next_step]);res.status(201).json({entry:r.rows[0]})}));
app.get('/api/v1/journal',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT id,learned,difficult,next_step,created_at FROM journal_entries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.sub]);res.json({entries:r.rows})}));
app.post('/api/v1/practice/grade',auth,asyncRoute(async(req,res)=>{
 const schema=z.object({subject:z.string().trim().min(1).max(100),questions:z.array(z.object({question:z.string().min(1).max(2000),options:z.array(z.string().min(1).max(500)).length(4),answer:z.number().int().min(0).max(3),explanation:z.string().max(2000).optional().default('')})).min(5).max(15),answers:z.array(z.union([z.number().int().min(0).max(3),z.null()])).min(5).max(15)});
 const parsed=schema.safeParse(req.body);if(!parsed.success)return fail(res,400,'Invalid practice answers');
 const {subject,questions,answers}=parsed.data;if(questions.length!==answers.length)return fail(res,400,'Answer count does not match the question count');
 const results=questions.map((q,i)=>({question_number:i+1,question:q.question,options:q.options,correct:answers[i]===q.answer,chosen:answers[i],student_answer:answers[i]===null?'Not answered':q.options[answers[i]],answer:q.answer,correct_answer:q.options[q.answer],explanation:q.explanation||''}));
 const score=results.filter(x=>x.correct).length;
 const reviewPrompt={subject,score,max_score:questions.length,answers:results.map(r=>({question_number:r.question_number,question:r.question,options:r.options,student_answer:r.student_answer,correct_answer:r.correct_answer,correct:r.correct,provided_explanation:r.explanation}))};
 const system='You are a careful Ghana SHS tutor reviewing completed multiple-choice practice. Return ONLY valid JSON with keys feedback (string, at most 100 words) and solutions (array). Include one solutions item for every supplied question, in the same order, with question_number (number) and steps (array of 2 to 5 short strings). For correct answers, briefly reinforce the reasoning. For incorrect or unanswered items, teach the method step by step and explain why the correct answer fits. Use the question, options, correct answer and provided explanation as evidence; do not invent missing facts, calculations, or steps. If the provided explanation is insufficient to derive a method safely, say so plainly in one step and explain only what can be established. Do not alter or recalculate the objective score. Be clear, encouraging, age-appropriate, and concise.';
 let feedback='Your answers have been checked against the correct options. Review each question below to see which answers were right and how to work through missed questions.';
 const solutionByNumber={};
 const generated=await generateWithGemini({system,user:JSON.stringify(reviewPrompt),temperature:0.2,maxOutputTokens:2200,timeoutMs:14000,json:true,validateResponse:text=>{try{const v=JSON.parse(text);return typeof v.feedback==='string'&&Array.isArray(v.solutions)}catch{return false}}});
 if(generated){try{const parsedAI=JSON.parse(generated);if(typeof parsedAI.feedback==='string'&&parsedAI.feedback.trim())feedback=parsedAI.feedback.slice(0,1200);for(const item of parsedAI.solutions||[]){const n=Number(item.question_number);if(Number.isInteger(n)&&Array.isArray(item.steps))solutionByNumber[n]=item.steps.filter(s=>typeof s==='string'&&s.trim()).slice(0,5).map(s=>s.slice(0,700));}}catch{}}
 const detailedResults=results.map(r=>({...r,steps:solutionByNumber[r.question_number]?.length?solutionByNumber[r.question_number]:(r.explanation?r.explanation.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/).filter(s=>s.trim()).slice(0,5):['The answer key identifies “'+r.correct_answer+'” as the correct option, but a worked explanation is not available for this question right now.'])}));
 res.json({score,max_score:questions.length,results:detailedResults,feedback,ai_review:Boolean(generated)});
}));
app.post('/api/v1/practice/generate',auth,asyncRoute(async(req,res)=>{
 const parsed=z.object({subject:z.string().trim().min(1).max(100),topic:z.string().trim().max(200).optional().default(''),level:z.string().max(100).optional().default('Not specified'),count:z.number().int().min(5).max(15).default(10)}).safeParse(req.body);
 if(!parsed.success)return fail(res,400,parsed.error.issues[0].message);
 const {subject,topic,level,count}=parsed.data;
 const system='You are an assessment writer for Ghanaian SHS students. Return one JSON object with a questions array. Generate at least '+count+' and no more than '+count+' original multiple-choice questions. Every question must have question (string), options (exactly 4 distinct strings), answer (zero-based integer 0,1,2,3), and explanation (string). The explanation must give a clear 2–4 step worked solution, showing the reasoning or calculation that leads to the correct option and briefly why a likely wrong choice is wrong. Exactly one option must be correct. Avoid duplicate questions, ambiguous wording, trick questions, and unsupported syllabus claims. Return JSON only, no markdown.';
 const prompt='Create exactly '+count+' useful exam-practice questions. Subject: '+subject+'. Level: '+level+'. Topic: '+(topic||'a balanced selection of foundational topics in this subject')+'. Use clear language and plausible distractors. Ensure the answer index points to the one correct option and each explanation is usable as a step-by-step review after marking. Return {"questions":[...]} only.';
 const cleanText=value=>typeof value==='string'?value.trim():'';
 function parseQuestions(raw){
  if(typeof raw!=='string')return null;
  let text=raw.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,'').trim();
  let decoded;
  try{decoded=JSON.parse(text)}catch{
   const first=text.indexOf('{'),last=text.lastIndexOf('}');
   if(first<0||last<=first)return null;
   try{decoded=JSON.parse(text.slice(first,last+1))}catch{return null}
  }
  let list=Array.isArray(decoded)?decoded:decoded?.questions||decoded?.items||decoded?.practice;
  if(!Array.isArray(list)||list.length<count)return null;
  list=list.slice(0,count);
  const questions=[];
  for(const item of list){
   if(!item||typeof item!=='object')return null;
   const question=cleanText(item.question||item.text||item.prompt);
   const rawOptions=item.options||item.choices||item.answers;
   if(!question||!Array.isArray(rawOptions)||rawOptions.length!==4)return null;
   const options=rawOptions.map(o=>cleanText(typeof o==='string'?o:(o?.text||o?.label||o?.option)));
   if(options.some(o=>!o)||new Set(options.map(o=>o.toLowerCase())).size!==4)return null;
   let answer=item.answer??item.correctAnswer??item.correct_answer??item.correctOption??item.correct_option;
   if(typeof answer==='string'){
    const letter=answer.trim().match(/^([A-D])(?:[).:]|$)/i);
    if(letter)answer=letter[1].toUpperCase().charCodeAt(0)-65;
    else if(/^\d+$/.test(answer.trim()))answer=Number(answer.trim());
    else {const matched=options.findIndex(o=>o.toLowerCase()===answer.trim().toLowerCase());answer=matched;}
   }
   if(!Number.isInteger(answer)||answer<0||answer>3)return null;
   const explanation=cleanText(item.explanation||item.reason||item.rationale);
   questions.push({question,options,answer,explanation,topic:cleanText(item.topic)||topic||subject});
  }
  return questions.length===count?questions:null;
 }
 let geminiFailure=null;
 let generatedModel=process.env.GEMINI_MODEL||'gemini-3.8-flash';
 const geminiText=await generateWithGemini({system,user:prompt,maxOutputTokens:6000,json:true,temperature:0.2,timeoutMs:24000,validateResponse:text=>Boolean(parseQuestions(text)),onFailure:failure=>{geminiFailure=failure;},onModel:model=>{generatedModel=model;}});
 const geminiQuestions=parseQuestions(geminiText);
 if(geminiQuestions)return res.json({questions:geminiQuestions,generatedBy:'gemini',subject,model:generatedModel});
 if(geminiText&&!geminiQuestions)geminiFailure={kind:'invalid_response'};
 console.warn('Gemini practice generation failed validation or returned no content',geminiFailure?.kind||'unknown');
 if(!process.env.GEMINI_API_KEY)return fail(res,503,'Gemini is not configured. Add GEMINI_API_KEY to the Vercel production environment.');
 let message='Gemini returned a response that did not contain a valid '+count+'-question set. Please retry.';
 if(geminiFailure?.kind==='http'&&geminiFailure.status===400)message='Gemini rejected the request configuration. Check the selected model and generation settings, then retry.';
 else if(geminiFailure?.kind==='http'&&(geminiFailure.status===401||geminiFailure.status===403))message='Gemini rejected the API key or this key does not have access to the selected model. Check the key and model access.';
 else if(geminiFailure?.kind==='http'&&geminiFailure.status===429)message='Gemini rate limit or quota reached. Check your Gemini API quota and billing, then retry later.';
 else if(geminiFailure?.kind==='http'&&geminiFailure.status>=500)message='Gemini is temporarily unavailable. Please retry shortly.';
 else if(geminiFailure?.kind==='timeout')message='Gemini took too long to generate the practice set. Please retry.';
 else if(geminiFailure?.kind==='network')message='GetLearny could not reach Gemini. Check the API deployment network and retry.';
 else if(geminiFailure?.kind==='invalid_json'||geminiFailure?.kind==='invalid_response')message='Gemini could not return questions in the required format after trying the available models. Please retry.';
 return fail(res,502,message+' No sample questions were substituted.');
}));
const lessonInput=z.object({subject:z.string().trim().min(1).max(100),topic:z.string().trim().min(1).max(200),level:z.string().max(30).default('SHS 3'),exam:z.string().max(30).default('WASSCE')});
app.post('/api/v1/lessons/generate',auth,asyncRoute(async(req,res)=>{
 const parsed=lessonInput.safeParse(req.body);
 if(!parsed.success)return fail(res,400,parsed.error.issues[0].message);
 const {subject,topic,level,exam}=parsed.data;
 const system='You are a careful Ghana SHS tutor preparing students for WASSCE. Teach prerequisite concepts first, use age-appropriate language, worked examples, common mistakes, and a short self-check. Do not fabricate official syllabus claims.';
 const prompt='Create a useful lesson in Markdown. Subject: '+subject+'. Topic: '+topic+'. Level: '+level+'. Exam: '+exam+'. Include goals, prerequisite check, explanation, worked example, common mistakes, exam tip, and 3 self-check questions with answers at the end.';
 const lesson=await generateWithGemini({system,user:prompt,maxOutputTokens:2600,temperature:0.4,timeoutMs:18000});
 if(lesson)return res.json({lesson,generatedBy:'gemini',model:process.env.GEMINI_MODEL||'gemini-3.8-flash',subject,topic});
 if(!process.env.GEMINI_API_KEY)return fail(res,503,'Gemini is not configured. Add GEMINI_API_KEY to the Vercel API environment.');
 return fail(res,502,'Gemini could not generate a lesson. Check the Gemini API key, model access and quota, then retry. No sample lesson was substituted.');
}));


// Saved tutor conversations are private to the authenticated learner.
app.get('/api/v1/tutor/chats',auth,asyncRoute(async(req,res)=>{
 const result=await query('SELECT id,title,created_at,updated_at,jsonb_array_length(messages) AS message_count FROM tutor_conversations WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50',[req.user.sub]);
 res.json({chats:result.rows});
}));
app.get('/api/v1/tutor/chats/:id',auth,asyncRoute(async(req,res)=>{
 const result=await query('SELECT id,title,messages,created_at,updated_at FROM tutor_conversations WHERE id=$1 AND user_id=$2',[req.params.id,req.user.sub]);
 if(!result.rowCount)return fail(res,404,'Saved tutor chat not found');
 res.json({chat:result.rows[0]});
}));

// Personal tutor endpoint. Context is loaded server-side and scoped to the signed-in learner.
const tutorChatInput=z.object({question:z.string().trim().min(2).max(4000),subject:z.string().trim().max(100).optional().default(''),use_materials:z.boolean().optional().default(true),history:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().max(4000)})).max(80).optional().default([]),conversation_id:z.string().uuid().optional().nullable()});
app.post('/api/v1/tutor/chat',auth,asyncRoute(async(req,res)=>{
 const parsed=tutorChatInput.safeParse(req.body);if(!parsed.success)return fail(res,400,parsed.error.issues[0].message);
 const {question,subject,use_materials,history,conversation_id}=parsed.data;
 const [profile,logs,tests,journal,docs,dashboard]=await Promise.all([
  query('SELECT name,class_level,subjects FROM users WHERE id=$1',[req.user.sub]),
  query('SELECT subject,topic,minutes_spent,status,notes,created_at FROM learning_logs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 12',[req.user.sub]),
  query('SELECT subject,title,score,max_score,taken_at FROM test_logs WHERE user_id=$1 ORDER BY taken_at DESC LIMIT 8',[req.user.sub]),
  query('SELECT learned,difficult,next_step,created_at FROM journal_entries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 6',[req.user.sub]),
  query('SELECT id,original_name,subject_name,processing_status,extracted_text,created_at FROM uploaded_documents WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30',[req.user.sub]),
  query("SELECT count(*) FILTER(WHERE status='completed')::int AS completed_topics,coalesce(sum(minutes_spent),0)::int AS minutes_studied FROM learning_logs WHERE user_id=$1",[req.user.sub])
 ]);
 const learner=profile.rows[0]||{};
 const relevantDocs=use_materials?docs.rows.filter(d=>d.processing_status==='ready'&&d.extracted_text?.trim()&&(!subject||!d.subject_name||d.subject_name.toLowerCase()===subject.toLowerCase()||d.subject_name.toLowerCase()==='general')).slice(0,4):[];
 const materials=relevantDocs.map(d=>({file:d.original_name,subject:d.subject_name||'General',excerpt:d.extracted_text.slice(0,7000)}));
 const subjectLogs=logs.rows.filter(x=>!subject||x.subject.toLowerCase()===subject.toLowerCase()).slice(0,8);
 const subjectTests=tests.rows.filter(x=>!subject||x.subject.toLowerCase()===subject.toLowerCase()).slice(0,6).map(x=>({...x,percent:Math.round(Number(x.score)/Math.max(Number(x.max_score),1)*100)}));
 const context={learner:{name:learner.name,class_level:learner.class_level||'Not specified',subjects:learner.subjects||[]},focus_subject:subject||'All subjects',progress:dashboard.rows[0]||{},recent_learning:subjectLogs.map(x=>({subject:x.subject,topic:x.topic,status:x.status,minutes:x.minutes_spent,notes:x.notes,at:x.created_at})),recent_tests:subjectTests,journal:journal.rows.map(x=>({learned:x.learned,difficult:x.difficult,next_step:x.next_step,at:x.created_at})),study_materials:materials,available_materials:docs.rows.map(d=>({file:d.original_name,subject:d.subject_name,status:d.processing_status})).slice(0,20)};
 const system='You are GetLearny Tutor, a thoughtful, encouraging Ghana SHS/Form 3 learning coach supporting WASSCE preparation. Be clear, specific, and interactive. Adapt explanations to the learner level. Use the learner’s own study materials when provided and relevant; clearly say if the notes do not support a claim. Connect answers to their recent lessons, test results, and journal only when useful. If test history shows a weak area, suggest a focused next step without shaming the learner. For academic questions, explain the idea, show a worked example when appropriate, then give one small check-for-understanding question. For direct questions answer directly first. Never claim to have read a file unless its extracted text is included. Do not fabricate learner records, scores, sources, or syllabus requirements. Use concise Markdown. Do not reveal private context unrelated to the question.';
 const userPrompt='LEARNER CONTEXT (account-scoped, may contain empty lists):\n'+JSON.stringify(context)+'\n\nRECENT CONVERSATION:\n'+JSON.stringify(history.slice(-10))+'\n\nCURRENT QUESTION:\n'+question;
 let tutorFailure=null;
 let successfulModel=process.env.GEMINI_MODEL||'gemini-3.8-flash';
 const answer=await generateWithGemini({system,user:userPrompt,temperature:0.35,maxOutputTokens:1700,timeoutMs:24000,onFailure:failure=>{tutorFailure=failure;},onModel:model=>{successfulModel=model;}});
 if(answer){
  const conversationId=conversation_id||randomUUID();
  const savedMessages=[...history.slice(-78),{role:'user',content:question},{role:'assistant',content:answer}].slice(-80);
  const title=String(savedMessages.find(m=>m.role==='user')?.content||'New chat').trim().slice(0,100)||'New chat';
  await query(`INSERT INTO tutor_conversations(id,user_id,title,messages,updated_at) VALUES($1,$2,$3,$4::jsonb,now())
   ON CONFLICT(id) DO UPDATE SET title=CASE WHEN tutor_conversations.title='New chat' THEN EXCLUDED.title ELSE tutor_conversations.title END,messages=EXCLUDED.messages,updated_at=now()
   WHERE tutor_conversations.user_id=EXCLUDED.user_id`,
   [conversationId,req.user.sub,title,JSON.stringify(savedMessages)]);
  return res.json({answer,conversation_id:conversationId,generatedBy:'gemini',model:successfulModel,context_sources:[...(materials.length?['study files']:[]),...(subjectLogs.length?['learning logs']:[]),...(subjectTests.length?['test results']:[]),...(journal.rows.length?['learning journal']:[]),'learning profile'],context_summary:materials.length+' readable file(s), '+subjectLogs.length+' learning log(s), '+subjectTests.length+' test result(s) checked'});
 }
 if(!process.env.GEMINI_API_KEY)return fail(res,503,'Gemini is not configured. Add GEMINI_API_KEY to the API deployment.');
 if(tutorFailure?.kind==='timeout')return fail(res,504,'The AI tutor timed out while trying three Gemini models. Please retry in a moment or check Gemini API availability and quota. Your saved progress and notes are unchanged.');
 if(tutorFailure?.status===429)return fail(res,429,'Gemini API quota or rate limit reached across the available models. Please wait and retry. Your saved progress and notes are unchanged.');
 if(tutorFailure?.status===403)return fail(res,502,'Gemini access was denied for the configured API key or models. Check the key permissions and model access in the API deployment. Your saved progress and notes are unchanged.');
 if(tutorFailure?.status===404)return fail(res,502,'None of the configured Gemini model names was available to this API key. Check GEMINI_MODEL and GEMINI_FALLBACK_MODELS in the API deployment. Your saved progress and notes are unchanged.');
 return fail(res,502,'The AI tutor could not generate a response after trying the available Gemini models. Check Gemini model access, API quota and server logs, then retry. No answer was fabricated. Your saved progress and notes are unchanged.');
}));

const TEXT_MATERIAL_EXTENSIONS=new Set(['.txt','.md','.markdown','.csv','.json']);
function cloudinaryConfig(){try{const value=process.env.CLOUDINARY_URL;if(!value)return null;const url=new URL(value);if(url.protocol!=='cloudinary:')return null;return {cloudName:url.hostname,apiKey:decodeURIComponent(url.username),apiSecret:decodeURIComponent(url.password)}}catch{return null}}
function cloudinarySignature(params,secret){const base=Object.keys(params).filter(key=>key!=='file'&&key!=='api_key'&&key!=='resource_type'&&key!=='signature').sort().map(key=>key+'='+params[key]).join('&');return createHash('sha1').update(base+secret).digest('hex')}
function validCloudinaryUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='res.cloudinary.com'}catch{return false}}
async function downloadCloudinaryAsset(url){
 if(!validCloudinaryUrl(url))throw new Error('Stored Cloudinary asset URL is invalid');
 const candidates=[url];
 const addCandidate=value=>{if(value&&!candidates.includes(value))candidates.push(value)};
 if(url.includes('/image/upload/')){
  addCandidate(url.replace('/image/upload/','/image/upload/fl_attachment/'));
  // Cloudinary may store a PDF as an image resource; try its raw delivery route too.
  addCandidate(url.replace('/image/upload/','/raw/upload/'));
  addCandidate(url.replace('/image/upload/','/raw/upload/fl_attachment/'));
 }else if(url.includes('/raw/upload/')){
  addCandidate(url.replace('/raw/upload/','/raw/upload/fl_attachment/'));
  addCandidate(url.replace('/raw/upload/','/image/upload/'));
  addCandidate(url.replace('/raw/upload/','/image/upload/fl_attachment/'));
 }
 // Some older auto-uploaded PDFs were stored without the raw-file extension.
 // Probe the equivalent .pdf URL as well as image/raw delivery paths before failing.
 for(const candidate of [...candidates]){
  try{const parsed=new URL(candidate);const tail=parsed.pathname.split('/').pop()||'';if(!/\.[a-z0-9]{2,8}$/i.test(tail)){const withPdf=new URL(parsed.toString());withPdf.pathname+='.pdf';addCandidate(withPdf.toString());}else if(/\.pdf$/i.test(tail)){const withoutPdf=new URL(parsed.toString());withoutPdf.pathname=withoutPdf.pathname.replace(/\.pdf$/i,'');addCandidate(withoutPdf.toString());}}catch{}
 }
 const retrievalDeadline=Date.now()+18000;
 let lastStatus=0,lastContentType='',lastNetworkError='';
 for(const candidate of candidates){
  if(Date.now()>=retrievalDeadline)break;
  try{
   const response=await fetch(candidate,{signal:AbortSignal.timeout(Math.max(1000,Math.min(5000,retrievalDeadline-Date.now()))),redirect:'follow',headers:{'Accept':'application/pdf,image/*,application/octet-stream,*/*','User-Agent':'GetLearny-Study-Material-Processor/1.0'}});
   if(!response.ok){lastStatus=response.status;continue;}
   const type=(response.headers.get('content-type')||'').toLowerCase();lastContentType=type;
   if(type.includes('text/html')){lastStatus=response.status||502;continue;}
   const bytes=Buffer.from(await response.arrayBuffer());
   if(!bytes.length)throw new Error('Cloudinary returned an empty file');
   if(bytes.length>100*1024*1024)throw new Error('The stored material exceeds the 100 MB processing limit');
   return bytes;
  }catch(error){
   if(error?.name==='AbortError'||error?.name==='TimeoutError'){lastNetworkError='Cloudinary retrieval attempt timed out';if(Date.now()>=retrievalDeadline)break;continue;}
   if(error.message==='Cloudinary returned an empty file'||error.message.includes('exceeds the 100 MB'))throw error;
   lastNetworkError=error.message||'Network error';
  }
 }
 if(Date.now()>=retrievalDeadline)throw new Error('Cloudinary file retrieval timed out after 18 seconds. Retry OCR or upload the material again if the error continues.');
 if(lastStatus===401||lastStatus===403)throw new Error('Cloudinary denied access to this file (HTTP '+lastStatus+'). In Cloudinary, enable PDF delivery for image assets or check the asset access mode, then retry OCR.');
 if(lastStatus===404)throw new Error('Cloudinary returned HTTP 404 for this file. Its stored delivery URL or resource type may be incorrect; upload the material again.');
 if(lastStatus)throw new Error('Cloudinary could not deliver this file (HTTP '+lastStatus+(lastContentType?', '+lastContentType:'')+'). Check the Cloudinary asset and retry.');
 throw new Error('Cloudinary file retrieval failed'+(lastNetworkError?': '+lastNetworkError:'')+'. Check the asset delivery URL and Cloudinary account availability, then retry.');
}
const OCR_IMAGE_MIMES=new Set(['image/png','image/jpeg','image/webp']);
const TEXT_MATERIAL_MIMES=new Set(['text/plain','text/markdown','text/csv','application/json','application/octet-stream']);
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:(Number(process.env.MAX_UPLOAD_MB)||12)*1024*1024,files:1},fileFilter:(_req,file,cb)=>{const ext=path.extname(file.originalname||'').toLowerCase();if(file.mimetype==='application/pdf'||OCR_IMAGE_MIMES.has(file.mimetype)||(TEXT_MATERIAL_EXTENSIONS.has(ext)&&TEXT_MATERIAL_MIMES.has(file.mimetype)))return cb(null,true);return cb(new Error('Supported study materials: PDF, TXT, Markdown, CSV, JSON, PNG, JPG and WEBP files'))}});const avatarUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1},fileFilter:(_req,file,cb)=>{if(!['image/jpeg','image/png','image/webp'].includes(file.mimetype))return cb(new Error('Profile pictures must be JPG, PNG or WebP'));cb(null,true)}});
app.post('/api/v1/profile/avatar',auth,avatarUpload.single('file'),asyncRoute(async(req,res)=>{if(!req.file)return fail(res,400,'Choose a JPG, PNG or WebP profile picture');const avatar_data='data:'+req.file.mimetype+';base64,'+req.file.buffer.toString('base64');const r=await query('UPDATE users SET avatar_data=$1,updated_at=now() WHERE id=$2 RETURNING id,name,email,role,avatar_data,class_level,subjects,created_at',[avatar_data,req.user.sub]);res.json({user:r.rows[0],message:'Profile picture updated'})}));
app.post('/api/v1/documents/upload-signature',auth,asyncRoute(async(req,res)=>{
 const cloud=cloudinaryConfig();if(!cloud)return fail(res,503,'Cloudinary storage is not configured. Add CLOUDINARY_URL to the Vercel production environment.');
 const ext=String(req.body?.extension||'pdf').trim().toLowerCase().replace(/^\\./,'');
 if(!['pdf','txt','md','markdown','csv','json','png','jpg','jpeg','webp'].includes(ext))return fail(res,400,'Unsupported study material file extension');
 const resource_type=['txt','md','markdown','csv','json'].includes(ext)?'raw':'image';
 const timestamp=Math.floor(Date.now()/1000);const folder='getlearny/users/'+String(req.user.sub)+'/materials';const public_id=randomUUID()+(resource_type==='raw'?'.'+ext:'');const params={folder,public_id,timestamp};
 res.json({cloud_name:cloud.cloudName,api_key:cloud.apiKey,timestamp,folder,public_id,resource_type,signature:cloudinarySignature(params,cloud.apiSecret),max_file_mb:100});
}));
app.post('/api/v1/documents/register-cloudinary',auth,asyncRoute(async(req,res)=>{
 const cloud=cloudinaryConfig();if(!cloud)return fail(res,503,'Cloudinary storage is not configured. Add CLOUDINARY_URL to the Vercel production environment.');
 const schema=z.object({secure_url:z.string().url().max(2048),public_id:z.string().min(1).max(500),original_name:z.string().trim().min(1).max(255),mime_type:z.string().min(1).max(120),size_bytes:z.number().int().positive().max(100*1024*1024),subject_name:z.string().trim().max(120).optional().default('General'),material_title:z.string().trim().max(255).optional()});
 const parsed=schema.safeParse(req.body);if(!parsed.success)return fail(res,400,'Invalid Cloudinary upload details');const d=parsed.data;
 const expectedPrefix='getlearny/users/'+String(req.user.sub)+'/materials/';if(!validCloudinaryUrl(d.secure_url)||!d.public_id.startsWith(expectedPrefix))return fail(res,403,'This Cloudinary file does not belong to your account.');
 const ext=path.extname(d.original_name).toLowerCase();const textFile=TEXT_MATERIAL_EXTENSIONS.has(ext);let extractedText='',processingStatus='needs_ocr';
 const mimeByExt={'.txt':'text/plain','.md':'text/markdown','.markdown':'text/markdown','.csv':'text/csv','.json':'application/json','.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
 const mimeType=mimeByExt[ext]||d.mime_type;
 if(textFile){try{const bytes=await downloadCloudinaryAsset(d.secure_url);extractedText=bytes.toString('utf8').replace(/\u0000/g,'').trim().slice(0,150000);if(!extractedText)return fail(res,422,'The uploaded text file is empty or contains no readable text.');processingStatus='ready';}catch(error){console.error('Cloudinary text material retrieval failed:',error.message);return fail(res,502,'The text file uploaded, but GetLearny could not read it from Cloudinary: '+error.message);}}
 const title=String(d.material_title||d.original_name).trim();const r=await query('INSERT INTO uploaded_documents(user_id,original_name,storage_path,mime_type,size_bytes,content,extracted_text,processing_status,subject_name) VALUES($1,$2,$3,$4,$5,NULL,$6,$7,$8) RETURNING id,original_name,mime_type,size_bytes,processing_status,subject_name,created_at',[req.user.sub,path.basename(title).slice(0,255)||path.basename(d.original_name).slice(0,255),d.secure_url,mimeType,d.size_bytes,extractedText,processingStatus,String(d.subject_name||'General').trim().slice(0,120)||'General']);
 res.status(201).json({document:r.rows[0],message:textFile?'Material uploaded and text extracted. The AI tutor can now use this file.':'Material uploaded securely to Cloudinary. Run OCR to extract readable text before asking the AI tutor.'});
}));
app.post('/api/v1/documents',auth,upload.single('file'),asyncRoute(async(req,res)=>{
 if(!req.file)return fail(res,400,'Select a supported study material file');
 let extractedText='',processingStatus='uploaded';
 if(TEXT_MATERIAL_EXTENSIONS.has(path.extname(req.file.originalname||'').toLowerCase())){
  extractedText=req.file.buffer.toString('utf8').replace(/\u0000/g,'').slice(0,150000);
  processingStatus=extractedText.trim()?'ready':'uploaded';
 }else if(OCR_IMAGE_MIMES.has(req.file.mimetype)){
  // Save first; OCR runs on demand so slow processing cannot break uploads.
  processingStatus='needs_ocr';
 }else{
  try{const parsed=await pdfParse(req.file.buffer);extractedText=String(parsed.text||'').slice(0,150000);processingStatus=extractedText.trim()?'ready':'needs_ocr';}
  catch{processingStatus='needs_ocr';}
 }
 const title=String(req.body?.material_title||req.file.originalname).trim();
 const r=await query('INSERT INTO uploaded_documents(user_id,original_name,storage_path,mime_type,size_bytes,content,extracted_text,processing_status,subject_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,original_name,mime_type,size_bytes,processing_status,subject_name,created_at',[req.user.sub,path.basename(title).slice(0,255)||path.basename(req.file.originalname).slice(0,255),'database',req.file.mimetype,req.file.size,req.file.buffer,extractedText,processingStatus,String(req.body?.subject_name||'General').trim().slice(0,120)||'General']);
 const messages={needs_ocr:'Material saved. Run OCR to extract readable text before asking the AI tutor.',ocr_failed:'OCR could not read this material. Try a clearer scan or image.',ready:'Study material saved and text extracted. The AI tutor can now use it.',uploaded:'File saved, but no readable text was found.'};
 res.status(201).json({document:r.rows[0],message:messages[processingStatus]||messages.uploaded});
}));
app.post('/api/v1/documents/:id/ocr',auth,asyncRoute(async(req,res)=>{
 const found=await query('SELECT id,original_name,mime_type,content,storage_path FROM uploaded_documents WHERE id=$1 AND user_id=$2',[req.params.id,req.user.sub]);
 if(!found.rows.length)return fail(res,404,'Study material not found');
 const doc=found.rows[0];let buffer=doc.content;if(!buffer&&doc.storage_path){try{buffer=await downloadCloudinaryAsset(doc.storage_path)}catch(error){console.error('Cloudinary material retrieval failed:',error.message);return fail(res,502,error.message||'Could not retrieve this material from Cloudinary. Try again later.')}}if(!buffer)return fail(res,422,'Original file unavailable. Upload it again.');
 let extractedText='';
 if((TEXT_MATERIAL_EXTENSIONS.has(path.extname(doc.original_name||'').toLowerCase())||(TEXT_MATERIAL_MIMES.has(doc.mime_type)&&doc.mime_type!=='application/octet-stream'))){
  extractedText=buffer.toString('utf8').replace(/\u0000/g,'').trim().slice(0,150000);
 }else if(OCR_IMAGE_MIMES.has(doc.mime_type)){
  let worker;
  try{worker=await createWorker('eng');const result=await worker.recognize(buffer);extractedText=String(result.data?.text||'').trim().slice(0,150000);}
  catch(error){console.error('Stored image OCR failed:',error.message);return fail(res,502,'OCR could not read this image. Try a clearer image.');}
  finally{if(worker)await worker.terminate().catch(()=>{});}
 }else if(doc.mime_type==='application/pdf'){
  try{const parsed=await pdfParse(buffer);extractedText=String(parsed.text||'').trim().slice(0,150000);}catch{}
  if(!extractedText&&buffer.length<=6*1024*1024){
   const transcription=await generateWithGemini({
    system:'Transcribe all visible text from the study PDF faithfully. Preserve headings, formulas and numbering. Do not summarize or invent text. Return only transcription.',
    user:[{text:'OCR this scanned study PDF.'},{inlineData:{mimeType:'application/pdf',data:buffer.toString('base64')}}],
    temperature:0,maxOutputTokens:6000,timeoutMs:9000
   });
   if(transcription)extractedText=transcription.trim().slice(0,150000);
  }
 }else return fail(res,415,'OCR is available for scanned PDFs and PNG, JPG or WebP images');
 if(!extractedText)return fail(res,422,'OCR found no readable text. Check Gemini configuration for scanned PDFs or try a clearer scan.');
 const updated=await query('UPDATE uploaded_documents SET extracted_text=$1,processing_status=$2 WHERE id=$3 AND user_id=$4 RETURNING id,original_name,mime_type,size_bytes,processing_status,subject_name,created_at',[extractedText,'ready',doc.id,req.user.sub]);
 res.json({document:updated.rows[0],message:'OCR complete. The AI tutor can now use this material.',characters:extractedText.length});
}));
app.post('/api/v1/documents/:id/ask',auth,asyncRoute(async(req,res)=>{
 const parsed=z.object({question:z.string().trim().min(3).max(1000)}).safeParse(req.body);
 if(!parsed.success)return fail(res,400,'Enter a question of 3 to 1000 characters');
 const result=await query('SELECT original_name,extracted_text,processing_status FROM uploaded_documents WHERE id=$1 AND user_id=$2',[req.params.id,req.user.sub]);
 if(!result.rowCount)return fail(res,404,'Study material not found');
 const doc=result.rows[0];
 if(!doc.extracted_text?.trim())return fail(res,422,doc.processing_status==='needs_ocr'?'This PDF appears to be scanned or image-only. Run OCR before asking the tutor.':'No readable text was extracted from this file.');
 const answer=await generateWithGemini({
  system:'You are a supportive Ghana SHS tutor. Answer the student using the supplied study document as the primary source. Explain concepts clearly, use age-appropriate language, show a short example when useful, and say when the document does not contain enough information. Do not invent quotations or pretend unsupported facts came from the file.',
  user:'Study file: '+doc.original_name+'\n\nDOCUMENT EXCERPT:\n'+doc.extracted_text.slice(0,30000)+'\n\nSTUDENT QUESTION:\n'+parsed.data.question,
  temperature:0.3,maxOutputTokens:1200,timeoutMs:12000
 });
 if(answer)return res.json({answer,source:doc.original_name,generatedBy:'gemini',model:process.env.GEMINI_MODEL||'gemini-3.8-flash'});
 if(!process.env.GEMINI_API_KEY)return fail(res,503,'Gemini is not configured. Add GEMINI_API_KEY to the Vercel API environment.');
 return fail(res,502,'Gemini could not answer from this document. Check Gemini API access and quota, then retry.');
}));
app.get('/api/v1/documents',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT id,original_name,mime_type,size_bytes,processing_status,subject_name,created_at FROM uploaded_documents WHERE user_id=$1 ORDER BY subject_name,created_at DESC LIMIT 100',[req.user.sub]);res.json({documents:r.rows})}));
app.get('/api/v1/documents/:id',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT original_name,mime_type,content,storage_path FROM uploaded_documents WHERE id=$1 AND user_id=$2',[req.params.id,req.user.sub]);if(!r.rowCount)return fail(res,404,'Document not found');if(!r.rows[0].content&&validCloudinaryUrl(r.rows[0].storage_path))return res.redirect(302,r.rows[0].storage_path);if(!r.rows[0].content)return fail(res,404,'Stored file is unavailable');res.setHeader('Content-Type',r.rows[0].mime_type);res.setHeader('Content-Disposition','attachment; filename="study-material"');res.send(r.rows[0].content)}));
app.use((err,_req,res,_next)=>{if(err instanceof multer.MulterError)return fail(res,err.code==='LIMIT_FILE_SIZE'?413:400,err.code==='LIMIT_FILE_SIZE'?'File is too large':'Upload failed');if(err.message==='Origin not allowed by CORS')return fail(res,403,err.message);if(typeof err.message==='string'&&err.message.startsWith('Supported study materials:'))return fail(res,415,err.message);if(typeof err.message==='string'&&err.message.startsWith('Profile pictures must be'))return fail(res,415,err.message);console.error(err);return fail(res,500,process.env.NODE_ENV==='production'?'Unexpected server error':err.message||'Unexpected server error')});
export default app;

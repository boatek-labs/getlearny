import { createHash, randomBytes } from 'node:crypto';
import { query } from './db.js';

export const TERMS_VERSION = '2026-10-27';
export const LOCATION_CONSENT_VERSION = '2026-10-27';
export const ADULT_AGE = 18;
export const USER_COLUMNS = 'id,name,email,role,avatar_data,class_level,subjects,created_at,date_of_birth,age_declared_at,terms_accepted_at,terms_version,account_status';

export function ageOn(value, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const dob = new Date(value + 'T00:00:00.000Z');
  if (Number.isNaN(dob.getTime()) || dob.toISOString().slice(0, 10) !== value) return NaN;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  if (now.getUTCMonth() < dob.getUTCMonth() ||
      (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

export function validateSignupConsent(data, _email = '') {
  const dob = String(data?.date_of_birth || '').trim();
  const age = ageOn(dob);
  if (!dob || !Number.isFinite(age)) return { ok: false, error: 'Enter a valid date of birth.', needsGuardian: false };
  if (age < 10) return { ok: false, error: 'You must be at least 10 years old to use GetLearny.', needsGuardian: false };
  if (data?.accept_terms !== true) return { ok: false, error: 'Please accept the Terms of Use and Privacy Notice to continue.', needsGuardian: false };
  const minor = age < ADULT_AGE;
  const guardianEmail = String(data?.guardian_email || '').trim().toLowerCase();
  if (minor && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guardianEmail) || guardianEmail === String(_email).toLowerCase())) {
    return { ok: false, error: 'Enter a valid parent or guardian email address that is different from your own.', needsGuardian: true };
  }
  return { ok: true, dob, age, minor, guardianEmail };
}

export function accountGate(status) {
  if (status === 'pending_guardian') return { code: 'GUARDIAN_APPROVAL_PENDING', message: 'Your account is locked until your parent or guardian approves it. Check the guardian email invitation.' };
  if (status === 'guardian_declined') return { code: 'GUARDIAN_APPROVAL_DECLINED', message: 'Your parent or guardian did not approve this account. Contact GetLearny support if you believe this is a mistake.' };
  return null;
}

export function publicUser(user) {
  if (!user) return user;
  const { password_hash, ...safe } = user;
  return safe;
}

export function guardianEmailReady() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && process.env.APP_URL);
}

async function sendEmail(to, subject, text) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text }),
    signal: AbortSignal.timeout(10000)
  });
  return response.ok;
}

export async function createGuardianRequest({ userId, childName, kind = 'account', guardianEmail }) {
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const created = await query(
    'INSERT INTO guardian_requests(user_id,kind,guardian_email,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval \'7 days\') RETURNING id',
    [userId, kind, guardianEmail, tokenHash]
  );
  const link = String(process.env.APP_URL).replace(/\/$/, '') + '/guardian.html?token=' + encodeURIComponent(rawToken);
  let sent = false;
  try {
    sent = await sendEmail(guardianEmail, 'Approve a GetLearny account', 'Hello,\n\n' + childName + ' has requested to use GetLearny. Review the request and choose approve or decline here:\n' + link + '\n\nThis link expires in 7 days. If you did not expect this message, you can ignore it.');
  } catch (error) {
    console.error('Guardian approval email failed:', error?.message || 'email error');
  }
  return { id: created.rows[0].id, sent };
}

export function registerConsentRoutes(app, { asyncRoute, authAny, fail }) {
  app.get('/api/v1/guardian/request', asyncRoute(async (req, res) => {
    const rawToken = String(req.query?.token || '');
    if (!/^[a-f0-9]{64}$/.test(rawToken)) return fail(res, 400, 'This approval link is invalid or incomplete.');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const found = await query(
      'SELECT id,kind,status,expires_at FROM guardian_requests WHERE token_hash=$1',
      [tokenHash]
    );
    const item = found.rows[0];
    if (!item || item.status !== 'pending' || new Date(item.expires_at).getTime() < Date.now()) {
      return fail(res, 410, 'This approval link has expired or has already been used. Ask the learner to request a new one.');
    }
    res.json({ valid: true, kind: item.kind });
  }));

  app.post('/api/v1/guardian/decision', asyncRoute(async (req, res) => {
    const rawToken = String(req.body?.token || '');
    const decision = req.body?.decision;
    if (!/^[a-f0-9]{64}$/.test(rawToken) || !['approve', 'decline'].includes(decision)) {
      return fail(res, 400, 'Choose approve or decline using a valid approval link.');
    }
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const result = await query(
      "UPDATE guardian_requests SET status=$1,decided_at=now() WHERE token_hash=$2 AND status='pending' AND expires_at>now() RETURNING id,user_id,kind",
      [decision === 'approve' ? 'approved' : 'declined', tokenHash]
    );
    if (!result.rowCount) return fail(res, 410, 'This approval link has expired or has already been used.');
    const { user_id: userId, kind } = result.rows[0];
    if (kind === 'account') {
      await query('UPDATE users SET account_status=$1,updated_at=now() WHERE id=$2', [decision === 'approve' ? 'active' : 'guardian_declined', userId]);
    } else {
      await query(
        "INSERT INTO location_consents(user_id,status,source,agreement_version,granted_at,withdrawn_at,guardian_request_id,updated_at) VALUES($1,$2,'guardian',$3,CASE WHEN $2='granted' THEN now() ELSE NULL END,CASE WHEN $2='withdrawn' THEN now() ELSE NULL END,$4,now()) ON CONFLICT(user_id) DO UPDATE SET status=EXCLUDED.status,source='guardian',agreement_version=EXCLUDED.agreement_version,granted_at=EXCLUDED.granted_at,withdrawn_at=EXCLUDED.withdrawn_at,guardian_request_id=EXCLUDED.guardian_request_id,updated_at=now()",
        [userId, decision === 'approve' ? 'granted' : 'withdrawn', LOCATION_CONSENT_VERSION, result.rows[0].id]
      );
    }
    res.json({ saved: true, decision });
  }));

  app.get('/api/v1/me/consents/location', authAny, asyncRoute(async (req, res) => {
    const r = await query('SELECT status,source,agreement_version,granted_at,withdrawn_at FROM location_consents WHERE user_id=$1', [req.user.sub]);
    res.json({ consent: r.rows[0] || null, locationSharingAvailable: false, message: 'Location data is not collected by this version of GetLearny.' });
  }));

  app.put('/api/v1/me/consents/location', authAny, asyncRoute(async (req, res) => {
    const choice = req.body?.consent;
    if (!['granted', 'withdrawn'].includes(choice)) return fail(res, 400, 'Choose whether to grant or withdraw location consent.');
    const user = await query('SELECT id,name,email,date_of_birth FROM users WHERE id=$1', [req.user.sub]);
    if (!user.rowCount || !user.rows[0].date_of_birth) return fail(res, 403, 'Confirm your date of birth before changing consent settings.');
    const age = ageOn(String(user.rows[0].date_of_birth).slice(0, 10));
    if (age < ADULT_AGE && choice === 'granted') {
      const guardianEmail = String(req.body?.guardian_email || '').trim().toLowerCase();
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(guardianEmail) || guardianEmail === String(user.rows[0].email).toLowerCase()) return fail(res, 400, 'Enter a valid parent or guardian email different from your own.');
      if (!guardianEmailReady()) return fail(res, 503, 'Parent approval emails are not configured yet. Please try again later.');
      const approval = await createGuardianRequest({ userId: req.user.sub, childName: user.rows[0].name, kind: 'location', guardianEmail });
      return res.status(202).json({ saved: false, guardian_pending: true, guardian_email_sent: approval.sent, message: 'Location consent is pending parent or guardian approval. No location data is collected by this version of GetLearny.' });
    }
    await query(
      "INSERT INTO location_consents(user_id,status,source,agreement_version,granted_at,withdrawn_at,updated_at) VALUES($1,$2,'self',$3,CASE WHEN $2='granted' THEN now() ELSE NULL END,CASE WHEN $2='withdrawn' THEN now() ELSE NULL END,now()) ON CONFLICT(user_id) DO UPDATE SET status=EXCLUDED.status,source='self',agreement_version=EXCLUDED.agreement_version,granted_at=EXCLUDED.granted_at,withdrawn_at=EXCLUDED.withdrawn_at,updated_at=now()",
      [req.user.sub, choice, LOCATION_CONSENT_VERSION]
    );
    res.json({ saved: true, consent: choice, locationSharingAvailable: false });
  }));
}

import nodemailer from 'nodemailer';

export function emailConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS && process.env.EMAIL_FROM);
}

let cachedTransport;
function getTransport() {
  if (!emailConfigured()) throw new Error('Gmail SMTP is not configured');
  if (!cachedTransport) {
    const port = Number(process.env.SMTP_PORT || 465);
    cachedTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: String(process.env.SMTP_SECURE ?? (port === 465)).toLowerCase() === 'true',
      auth: { user: process.env.SMTP_USER, pass: String(process.env.SMTP_PASS).replace(/\\s/g, '') },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
    });
  }
  return cachedTransport;
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

/** Email-safe table layout. Always provide a plain-text alternative too. */
export function brandedEmail({ preheader = 'A message from GetLearny', title, greeting = 'Hello,', paragraphs = [], code, actionUrl, actionLabel, footnote = 'You received this message because an action was requested on GetLearny.' }) {
  const safeParagraphs = paragraphs.map(p => '<p style="margin:0 0 14px;color:#5d6175;font:15px/1.7 Arial,sans-serif;">' + escapeHtml(p) + '</p>').join('');
  const codeBlock = code ? '<div style="margin:22px 0;padding:18px 20px;border:1px solid #e8e5fb;border-radius:14px;background:#f7f5ff;text-align:center;"><div style="margin-bottom:8px;color:#77738f;font:700 10px Arial,sans-serif;letter-spacing:2px;">YOUR VERIFICATION CODE</div><div style="color:#292344;font:700 32px/1.2 Arial,sans-serif;letter-spacing:8px;">' + escapeHtml(code) + '</div></div>' : '';
  const action = actionUrl && actionLabel ? '<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;"><tr><td bgcolor="#7057f5" style="border-radius:10px;"><a href="' + escapeHtml(actionUrl) + '" style="display:inline-block;padding:14px 22px;color:#fff;text-decoration:none;font:700 14px Arial,sans-serif;">' + escapeHtml(actionLabel) + '</a></td></tr></table>' : '';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:28px 12px;background:#f4f5fa;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">' + escapeHtml(preheader) + '</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;border-collapse:separate;border-spacing:0;"><tr><td style="padding:22px 28px;background:#17172f;border-radius:18px 18px 0 0;"><table role="presentation" width="100%"><tr><td style="color:#fff;font:800 21px Arial,sans-serif;">GetLearny</td><td align="right" style="color:#c7c3e9;font:700 10px Arial,sans-serif;letter-spacing:1.5px;">BOATEK LABS</td></tr></table></td></tr><tr><td style="padding:34px 30px 28px;background:#fff;border:1px solid #e9e9f1;border-top:0;border-radius:0 0 18px 18px;"><div style="margin-bottom:10px;color:#7057f5;font:700 10px Arial,sans-serif;letter-spacing:1.7px;">YOUR LEARNING SPACE</div><h1 style="margin:0 0 18px;color:#1d1c36;font:800 25px/1.25 Arial,sans-serif;">' + escapeHtml(title) + '</h1><p style="margin:0 0 14px;color:#34364c;font:15px/1.6 Arial,sans-serif;">' + escapeHtml(greeting) + '</p>' + safeParagraphs + codeBlock + action + '<p style="margin:20px 0 0;color:#818397;font:12px/1.65 Arial,sans-serif;">' + escapeHtml(footnote) + '</p></td></tr><tr><td align="center" style="padding:18px 12px;color:#999bad;font:11px/1.6 Arial,sans-serif;">GetLearny · Learn with purpose<br>Built by Boatek Labs</td></tr></table></body></html>';
}

export async function sendEmail({ to, subject, text, html }) {
  return getTransport().sendMail({ from: process.env.EMAIL_FROM || process.env.SMTP_USER, to, subject, text, ...(html ? { html } : {}) });
}
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
      auth: {
        user: process.env.SMTP_USER,
        pass: String(process.env.SMTP_PASS).replace(/\\s/g, '')
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });
  }
  return cachedTransport;
}

export async function sendEmail({ to, subject, text, html }) {
  return getTransport().sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    ...(html ? { html } : {})
  });
}

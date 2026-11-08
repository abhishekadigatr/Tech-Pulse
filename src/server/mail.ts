import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface MailMessage { to: string; subject: string; text: string }
export interface MailTransport { send(message: MailMessage): Promise<void> }

export class SmtpTransport implements MailTransport {
  private readonly transport: Transporter;
  constructor(url: string, private readonly from: string) {
    const parsed = new URL(url);
    if (!['smtp:', 'smtps:'].includes(parsed.protocol) || !parsed.hostname || !from.trim()) throw new Error('Invalid SMTP configuration');
    if (parsed.protocol === 'smtp:') parsed.searchParams.set('requireTLS', 'true');
    this.transport = nodemailer.createTransport(parsed.toString());
  }
  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}
export class DevTransport implements MailTransport {
  async send(): Promise<void> { console.info('[mail] Development message accepted (code available in the response).'); }
}
let transport: MailTransport | undefined;
export function configureMail(): MailTransport {
  if (transport) return transport;
  const { SMTP_URL, MAIL_FROM, NODE_ENV } = process.env;
  if (SMTP_URL && MAIL_FROM) return transport = new SmtpTransport(SMTP_URL, MAIL_FROM);
  if (NODE_ENV === 'production') throw new Error('SMTP_URL and MAIL_FROM are required in production');
  if (SMTP_URL || MAIL_FROM) throw new Error('Set both SMTP_URL and MAIL_FROM');
  return transport = new DevTransport();
}
/** Injection is useful for isolated tests without a real provider. */
export function setMailTransport(value: MailTransport | undefined): void { transport = value; }
export async function sendCode(to: string, code: string, kind: 'verify' | 'reset'): Promise<void> {
  const subject = kind === 'verify' ? 'Verify your Tech Pulse email' : 'Reset your Tech Pulse password';
  await configureMail().send({ to, subject, text: `Your ${kind === 'verify' ? 'verification' : 'password reset'} code is ${code}. It expires in 15 minutes. If you did not request this, ignore this email.` });
}

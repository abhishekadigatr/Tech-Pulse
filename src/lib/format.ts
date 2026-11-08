export const DAY = 86_400_000;
export const HOUR = 3_600_000;

export const fmtDate = (ms: number): string =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms));

export const fmtShort = (ms: number): string =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(ms));

export const fmtTime = (ms: number): string =>
  new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms));

export const fmtDateTime = (ms: number): string => `${fmtShort(ms)} · ${fmtTime(ms)}`;

export function relative(ms: number): string {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const future = diff > 0;
  const units: Array<[number, string]> = [[DAY * 30, 'mo'], [DAY, 'd'], [HOUR, 'h'], [60_000, 'm']];
  for (const [size, label] of units) {
    if (abs >= size) {
      const n = Math.round(abs / size);
      return future ? `in ${n}${label}` : `${n}${label} ago`;
    }
  }
  return future ? 'in a moment' : 'just now';
}

export function countdown(ms: number): { label: string; urgent: boolean; expired: boolean } {
  const diff = ms - Date.now();
  if (diff <= 0) return { label: 'Closed', urgent: false, expired: true };
  const days = Math.floor(diff / DAY);
  const hours = Math.floor((diff % DAY) / HOUR);
  const minutes = Math.floor((diff % HOUR) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);
  if (days > 0) return { label: `${days}d ${hours}h left`, urgent: days <= 3, expired: false };
  if (hours > 0) return { label: `${hours}h ${minutes}m left`, urgent: true, expired: false };
  return { label: `${minutes}m ${String(seconds).padStart(2, '0')}s left`, urgent: true, expired: false };
}

export const hueColor = (hue: number, s = 78, l = 62, a = 1): string => `hsla(${hue}, ${s}%, ${l}%, ${a})`;

export const initials = (name: string): string => name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');

export const modeLabel: Record<string, string> = { online: 'Online', offline: 'In person', hybrid: 'Hybrid' };
export const statusLabel: Record<string, string> = {
  applied: 'Applied', shortlisted: 'Shortlisted', participating: 'Participating', rejected: 'Not selected',
};
export const typeLabel: Record<string, string> = {
  apply: 'Deadline', study: 'Study', hackathon: 'Hackathon', travel: 'Travel',
};
export const kindLabel: Record<string, string> = {
  application: 'Application', notification: 'Update', request: 'Team request',
  reminder: 'Reminder', team: 'Team', system: 'System', chat: 'Chat',
};

export function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}
export const fromLocalInput = (value: string): number => new Date(value).getTime();

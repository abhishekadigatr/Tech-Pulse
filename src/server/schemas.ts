import { z } from 'zod';

export const email = z.string().trim().toLowerCase().email().max(160);
export const password = z.string().min(10, 'Use at least 10 characters').max(200)
  .regex(/[A-Za-z]/, 'Include a letter').regex(/[0-9]/, 'Include a number');
export const shortText = (max: number) => z.string().trim().max(max);
export const isoDate = z.union([z.number().int(), z.string().datetime({ offset: true })]).transform((v) =>
  typeof v === 'number' ? v : new Date(v).getTime());
export const httpsUrl = z.string().url().max(500).refine((v) => /^https:\/\//i.test(v), 'HTTPS required');
export const status = z.enum(['applied', 'shortlisted', 'participating', 'rejected']);
export const mode = z.enum(['online', 'offline', 'hybrid']);
export const calendarType = z.enum(['apply', 'study', 'hackathon', 'travel']);
export const tripMode = z.enum(['car', 'train', 'bus', 'flight']);
export const placeType = z.enum(['food', 'fuel', 'rest', 'atm']);

export const registerSchema = z.object({
  name: shortText(80).min(2), email, password,
  college: shortText(120).default(''), city: shortText(80).default(''),
  skills: z.array(shortText(40)).max(20).default([]),
});
export const loginSchema = z.object({ email, password: z.string().max(200), code: z.string().max(20).optional() });
export const mfaSchema = z.object({ challengeToken: z.string().min(10).max(2000), code: z.string().min(6).max(20) });
export const emailCodeSchema = z.object({ email, code: z.string().min(4).max(12) });
export const resetSchema = z.object({ email, code: z.string().min(4).max(12), password });
export const disable2faSchema = z.object({ code: z.string().min(6).max(20), password: z.string().max(200) });
export const confirm2faSchema = z.object({ code: z.string().min(6).max(20) });

export const settingsSchema = z.object({
  theme: z.enum(['nebula', 'aurora', 'midnight']).optional(),
  notifyInApp: z.boolean().optional(),
  notifyPush: z.boolean().optional(),
  notifyEmail: z.boolean().optional(),
  reminderOffsets: z.array(z.number().int().min(5).max(60 * 24 * 30)).max(6).optional(),
  profileVisibility: z.enum(['public', 'team-only', 'private']).optional(),
  showJourneyTips: z.boolean().optional(),
  weeklyDigest: z.boolean().optional(),
});

export const profileSchema = z.object({
  name: shortText(80).min(2).optional(),
  college: shortText(120).optional(),
  city: shortText(80).optional(),
  skills: z.array(shortText(40)).max(20).optional(),
  bio: shortText(500).optional(),
});

export const vaultSchema = z.object({
  salt: z.string().min(10).max(200),
  blob: z.string().min(20).max(16_384),
});

export const deviceSchema = z.object({
  publicJwk: z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: z.string(), y: z.string() })
    .passthrough(),
  label: shortText(80).default('This browser'),
});

// The server must never accept a plaintext note on new writes.
export const encryptedNote = z.string().max(12000).refine((v) => v === '' || /^enc1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/.test(v), 'Encrypted note required');
export const notesKeySchema = z.object({
  salt: z.string().regex(/^[A-Za-z0-9_-]{22}$/), iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  ciphertext: z.string().regex(/^[A-Za-z0-9_-]{50,200}$/), version: z.literal(1),
});
export const applicationSchema = z.object({
  hackathonId: z.string().min(1).max(80),
  status: status.default('applied'),
  notes: encryptedNote.default(''),
});
export const applicationPatchSchema = z.object({
  status: status.optional(),
  notes: encryptedNote.optional(),
});

export const teamSchema = z.object({
  title: shortText(100).min(3),
  description: shortText(1000).min(5),
  lookingFor: z.array(shortText(40)).max(12).default([]),
  maxSize: z.number().int().min(2).max(12).default(4),
});
export const teamPatchSchema = teamSchema.partial();
export const requestSchema = z.object({ message: shortText(500).default(''), teamId: z.string().optional() });
export const requestPatchSchema = z.object({ accept: z.boolean() });
export const seekerSchema = z.object({
  hackathonId: z.string().min(1).max(80),
  headline: shortText(140).min(4),
  skills: z.array(shortText(40)).max(20).default([]),
  availability: shortText(60).default('Weekends'),
});

export const conversationSchema = z.object({ otherUserId: z.string().min(1).max(80).optional() });
export const keysSchema = z.object({
  keyVersion: z.number().int().min(1).max(10000),
  wrapped: z.array(z.object({ userId: z.string().max(80), wrappedKey: z.string().min(10).max(4096) })).max(20),
});

export const calendarSchema = z.object({
  title: shortText(140).min(2),
  type: calendarType.default('study'),
  startsAt: z.number().int().min(0).max(9_999_999_999_999),
  endsAt: z.number().int().min(0).max(9_999_999_999_999),
  notes: encryptedNote.default(''),
  remindOffsets: z.array(z.number().int().min(5).max(60 * 24 * 30)).max(6).default([1440, 120]),
  hackathonId: z.string().max(80).nullable().optional(),
});
export const calendarPatchSchema = calendarSchema.partial();

export const pushSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(500), auth: z.string().max(500) }).partial().default({}),
});

export const tripSchema = z.object({
  hackathonId: z.string().min(1).max(80),
  origin: shortText(80).min(2),
  mode: tripMode.default('car'),
});

export const hackathonSchema = z.object({
  name: shortText(160).min(3), organizer: shortText(160).min(2),
  description: shortText(2000).min(10), domain: shortText(80).min(2),
  tags: z.array(shortText(40)).max(12).default([]),
  mode, city: shortText(80).min(2), venue: shortText(160).default('Online'),
  deadline: z.number().int(), startAt: z.number().int(), endAt: z.number().int(),
  officialUrl: httpsUrl, applyUrl: httpsUrl, prize: shortText(160).default(''),
});

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
export const deadlineRangeSchema = z.object({ from: dateOnly.optional(), to: dateOnly.optional() })
  .strict().refine((v) => !v.from || !v.to || v.from <= v.to, 'End date must not precede start date');

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { hashPassword, newTotpSecret, sealForUser, sealSystem } from './crypto.ts';
import type { Mode } from '@/lib/types';

const DATA_DIR = path.join(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'tech-pulse.db');
const DAY = 86_400_000;
const HOUR = 3_600_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  verification_hash TEXT,
  verification_expires INTEGER,
  reset_hash TEXT,
  reset_expires INTEGER,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  recovery_hashes TEXT NOT NULL DEFAULT '[]',
  role TEXT NOT NULL DEFAULT 'user',
  avatar_hue INTEGER NOT NULL DEFAULT 190,
  college TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '[]',
  bio TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'nebula',
  notify_in_app INTEGER NOT NULL DEFAULT 1,
  notify_push INTEGER NOT NULL DEFAULT 0,
  notify_email INTEGER NOT NULL DEFAULT 0,
  reminder_offsets TEXT NOT NULL DEFAULT '[10080,1440,120]',
  profile_visibility TEXT NOT NULL DEFAULT 'public',
  show_journey_tips INTEGER NOT NULL DEFAULT 1,
  weekly_digest INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS vaults (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  salt TEXT NOT NULL,
  blob TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_jwk TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  aal2 INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  aal2 INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ws_tickets (
  ticket_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hackathons (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  organizer TEXT NOT NULL,
  description TEXT NOT NULL,
  domain TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  mode TEXT NOT NULL,
  city TEXT NOT NULL,
  venue TEXT NOT NULL,
  lat REAL NOT NULL DEFAULT 0,
  lng REAL NOT NULL DEFAULT 0,
  deadline INTEGER NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  official_url TEXT NOT NULL,
  apply_url TEXT NOT NULL,
  prize TEXT NOT NULL DEFAULT '',
  hue INTEGER NOT NULL DEFAULT 190,
  source TEXT NOT NULL DEFAULT 'curated',
  approval_status TEXT NOT NULL DEFAULT 'approved',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hackathons_url ON hackathons(official_url);
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hackathon_id TEXT NOT NULL REFERENCES hackathons(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, hackathon_id)
);
CREATE TABLE IF NOT EXISTS apply_clicks (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  hackathon_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hackathon_id TEXT NOT NULL REFERENCES hackathons(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'applied',
  notes TEXT NOT NULL DEFAULT '',
  applied_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, hackathon_id)
);
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  hackathon_id TEXT NOT NULL REFERENCES hackathons(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  looking_for TEXT NOT NULL DEFAULT '[]',
  max_size INTEGER NOT NULL DEFAULT 4,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE IF NOT EXISTS team_requests (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS seekers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hackathon_id TEXT NOT NULL REFERENCES hackathons(id) ON DELETE CASCADE,
  headline TEXT NOT NULL,
  skills TEXT NOT NULL DEFAULT '[]',
  availability TEXT NOT NULL DEFAULT 'Weekends',
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, hackathon_id)
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wrapped_key TEXT NOT NULL DEFAULT '',
  last_read_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  hackathon_id TEXT REFERENCES hackathons(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  remind_offsets TEXT NOT NULL DEFAULT '[10080,1440,120]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calendar_user ON calendar_events(user_id, starts_at);
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  offset_minutes INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  sent_at INTEGER,
  UNIQUE (event_id, offset_minutes)
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(sent_at, due_at);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hackathon_id TEXT NOT NULL REFERENCES hackathons(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  mode TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trip_saved_places (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, place_id)
);
CREATE TABLE IF NOT EXISTS journey_places (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  city TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  rating REAL NOT NULL,
  detour_min INTEGER NOT NULL,
  open_now INTEGER NOT NULL,
  price TEXT NOT NULL,
  note TEXT NOT NULL,
  address TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ingest_log (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

let connection: DatabaseSync | undefined;

export function db(): DatabaseSync {
  if (connection) return connection;
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  connection = new DatabaseSync(DB_FILE);
  connection.exec('PRAGMA journal_mode = WAL;');
  connection.exec('PRAGMA foreign_keys = ON;');
  connection.exec('PRAGMA busy_timeout = 5000;');
  connection.exec(SCHEMA);
  seedStatic();
  return connection;
}

export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...(params as never[])) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return db().prepare(sql).get(...(params as never[])) as T | undefined;
}

export function run(sql: string, ...params: unknown[]): void {
  db().prepare(sql).run(...(params as never[]));
}

export const uid = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/* ────────────────────────────────────────────────────────────────────────────
 * Seed data. Static content is inserted once (idempotent by fixed id). Demo
 * accounts are only created outside production; production starts empty and
 * users register normally.
 * ──────────────────────────────────────────────────────────────────────────── */
interface SeedHackathon {
  id: string; slug: string; name: string; organizer: string; description: string;
  domain: string; tags: string[]; mode: Mode; city: string; venue: string;
  lat: number; lng: number; deadlineDays: number; startDays: number; durationDays: number;
  officialUrl: string; applyUrl: string; prize: string; hue: number;
}

const HACKATHONS: SeedHackathon[] = [
  { id: 'hk_horizon', slug: 'hack-the-horizon-2026', name: 'Hack The Horizon 2026', organizer: 'Devpost × Community', description: 'A global 48-hour build sprint for AI-native products. Ship a working prototype, demo it live, and get feedback from founders and engineers.', domain: 'AI / ML', tags: ['AI', 'LLM', 'Product', 'Beginner friendly'], mode: 'online', city: 'Remote', venue: 'Online · Global', lat: 12.9716, lng: 77.5946, deadlineDays: 6, startDays: 13, durationDays: 2, officialUrl: 'https://devpost.com/hackathons', applyUrl: 'https://devpost.com/hackathons', prize: '$25,000 + cloud credits', hue: 168 },
  { id: 'hk_sih', slug: 'smart-india-hackathon-2026', name: 'Smart India Hackathon 2026', organizer: 'Ministry of Education, Govt. of India', description: 'The national student innovation challenge. Solve real problem statements from ministries and industry partners across 36 hours.', domain: 'GovTech', tags: ['GovTech', 'Social impact', 'Hardware', 'Students'], mode: 'offline', city: 'Bengaluru', venue: 'IISc Campus, Bengaluru', lat: 13.0211, lng: 77.5668, deadlineDays: 11, startDays: 24, durationDays: 2, officialUrl: 'https://sih.gov.in', applyUrl: 'https://sih.gov.in', prize: '₹1,00,000 + incubation', hue: 275 },
  { id: 'hk_orbit', slug: 'mlh-orbit-weekend', name: 'MLH Orbit Weekend', organizer: 'Major League Hacking', description: 'A student-first weekend of workshops, mentor sessions and hardware loans. Beginners welcome — no experience needed.', domain: 'Open Source', tags: ['Open source', 'Workshops', 'Beginner friendly', 'Hardware'], mode: 'hybrid', city: 'Hyderabad', venue: 'T-Hub, Hyderabad', lat: 17.4401, lng: 78.3853, deadlineDays: 9, startDays: 18, durationDays: 2, officialUrl: 'https://mlh.io/hackathons', applyUrl: 'https://mlh.io/hackathons', prize: 'Swag + mentor access', hue: 205 },
  { id: 'hk_nexus', slug: 'unstop-nexus-challenge', name: 'Unstop Nexus Challenge', organizer: 'Unstop', description: 'Build a fintech solution for the next billion users. Includes a data sandbox, API credits and a founder jury.', domain: 'Fintech', tags: ['Fintech', 'APIs', 'Data', 'Prize pool'], mode: 'online', city: 'Remote', venue: 'Online · India', lat: 19.076, lng: 72.8777, deadlineDays: 4, startDays: 10, durationDays: 5, officialUrl: 'https://unstop.com/hackathons', applyUrl: 'https://unstop.com/hackathons', prize: '₹5,00,000', hue: 42 },
  { id: 'hk_green', slug: 'climate-code-sprint', name: 'Climate Code Sprint', organizer: 'Climate Collective', description: 'Open data, satellite imagery and carbon models — build tools that make climate action measurable for cities.', domain: 'Climate', tags: ['Climate', 'Data viz', 'Maps', 'Impact'], mode: 'hybrid', city: 'Pune', venue: 'Symbiosis International, Pune', lat: 18.5596, lng: 73.7799, deadlineDays: 17, startDays: 31, durationDays: 3, officialUrl: 'https://devfolio.co/hackathons', applyUrl: 'https://devfolio.co/hackathons', prize: '€10,000 + grants', hue: 96 },
  { id: 'hk_chain', slug: 'ethglobal-pragati', name: 'ETHGlobal Pragati', organizer: 'ETHGlobal', description: 'A weekend of on-chain building with protocol mentors, workshops and a huge prize pool across multiple tracks.', domain: 'Web3', tags: ['Web3', 'Solidity', 'Smart contracts', 'Prize pool'], mode: 'offline', city: 'Mumbai', venue: 'Jio World Centre, Mumbai', lat: 19.0759, lng: 72.8777, deadlineDays: 21, startDays: 39, durationDays: 2, officialUrl: 'https://ethglobal.com/events', applyUrl: 'https://ethglobal.com/events', prize: '$100,000', hue: 292 },
  { id: 'hk_health', slug: 'medtech-innovate', name: 'MedTech Innovate', organizer: 'HackerEarth × HealthLabs', description: 'Design accessible health tooling with clinicians. Datasets and domain mentors provided from day one.', domain: 'Health', tags: ['Health', 'Accessibility', 'ML', 'Design'], mode: 'online', city: 'Remote', venue: 'Online · Global', lat: 28.6139, lng: 77.209, deadlineDays: 14, startDays: 27, durationDays: 7, officialUrl: 'https://www.hackerearth.com/challenges/', applyUrl: 'https://www.hackerearth.com/challenges/', prize: '₹3,00,000', hue: 340 },
  { id: 'hk_dora', slug: 'dora-hacks-quadrant', name: 'DoraHacks Quadrant', organizer: 'DoraHacks', description: 'Quadratic funding meets a builder marathon. Open-source tooling, privacy and decentralized science tracks.', domain: 'Open Source', tags: ['Open source', 'Privacy', 'Research', 'Web3'], mode: 'online', city: 'Remote', venue: 'Online · Global', lat: 12.2958, lng: 76.6394, deadlineDays: 26, startDays: 45, durationDays: 10, officialUrl: 'https://dorahacks.io/hackathon', applyUrl: 'https://dorahacks.io/hackathon', prize: '$30,000', hue: 230 },
  { id: 'hk_robotics', slug: 'robotics-arena-mysuru', name: 'Robotics Arena Mysuru', organizer: 'NIE & IEEE Student Branch', description: 'Autonomous navigation challenge on a physical track. Bring a team, a robot and a lot of curiosity.', domain: 'Robotics', tags: ['Robotics', 'Hardware', 'Embedded', 'Teams'], mode: 'offline', city: 'Mysuru', venue: 'NIE Campus, Mysuru', lat: 12.3088, lng: 76.6532, deadlineDays: 8, startDays: 20, durationDays: 2, officialUrl: 'https://www.ieee.org/', applyUrl: 'https://www.ieee.org/', prize: '₹1,50,000 + kits', hue: 18 },
  { id: 'hk_kaggle', slug: 'open-data-cup', name: 'Open Data Cup', organizer: 'Kaggle Community', description: 'A two-week modelling competition on civic open data. Solo or teams of up to four; notebooks are public after the deadline.', domain: 'Data Science', tags: ['Data', 'Python', 'Notebooks', 'Solo ok'], mode: 'online', city: 'Remote', venue: 'Online · Global', lat: 13.0827, lng: 80.2707, deadlineDays: 33, startDays: 40, durationDays: 14, officialUrl: 'https://www.kaggle.com/competitions', applyUrl: 'https://www.kaggle.com/competitions', prize: '$15,000', hue: 62 },
  { id: 'hk_cyber', slug: 'cyber-shield-ctf', name: 'Cyber Shield CTF', organizer: 'Cyber Security Cell', description: 'A capture-the-flag with blue-team and secure-coding tracks. Learn defensive security with guided challenges.', domain: 'Security', tags: ['Security', 'CTF', 'Networking', 'Students'], mode: 'hybrid', city: 'Delhi', venue: 'DTU Campus, Delhi', lat: 28.7501, lng: 77.1177, deadlineDays: 19, startDays: 34, durationDays: 2, officialUrl: 'https://ctftime.org/', applyUrl: 'https://ctftime.org/', prize: '₹2,00,000', hue: 150 },
  { id: 'hk_design', slug: 'design-for-good', name: 'Design For Good Jam', organizer: 'Figma Community', description: 'A 36-hour product design jam focused on accessible public services. Portfolio-ready case studies and critique rounds.', domain: 'Design', tags: ['Design', 'Accessibility', 'Figma', 'Beginner friendly'], mode: 'online', city: 'Remote', venue: 'Online · Global', lat: 12.9141, lng: 74.856, deadlineDays: 12, startDays: 22, durationDays: 2, officialUrl: 'https://www.figma.com/community', applyUrl: 'https://www.figma.com/community', prize: 'Mentorship + features', hue: 315 },
  { id: 'hk_spring', slug: 'spring-build-fest', name: 'Spring Build Fest', organizer: 'GitHub Campus', description: 'Ship a useful open-source project in a week, with maintainer reviews and a showcase for the best contributions.', domain: 'Open Source', tags: ['Open source', 'GitHub', 'DevTools', 'Solo ok'], mode: 'online', city: 'Remote', venue: 'Online · Global', lat: 17.385, lng: 78.4867, deadlineDays: -3, startDays: 4, durationDays: 7, officialUrl: 'https://github.com/explore', applyUrl: 'https://github.com/explore', prize: 'Swag + sponsorship', hue: 195 },
  { id: 'hk_space', slug: 'space-apps-mysuru', name: 'NASA Space Apps: Mysuru', organizer: 'Space Apps Community', description: 'A local edition of the global space-app challenge using NASA open data, with mentors from ISRO and academia.', domain: 'Space / Data', tags: ['Space', 'Data', 'Maps', 'Impact'], mode: 'offline', city: 'Mysuru', venue: 'SJCE Campus, Mysuru', lat: 12.3211, lng: 76.6253, deadlineDays: -9, startDays: -6, durationDays: 2, officialUrl: 'https://www.spaceappschallenge.org/', applyUrl: 'https://www.spaceappschallenge.org/', prize: 'Global finals entry', hue: 258 },
];

const PLACES: Array<[string, string, string, string, number, number, number, number, number, string, string, string]> = [
  // id, name, type, city, lat, lng, rating, detour, openNow, price, note, address
  ['pl_blr_1', 'CTR – Shri Sagar', 'food', 'Bengaluru', 13.0085, 77.5668, 4.7, 6, 1, '₹', 'Legendary butter masala dosa — refuel before a long build night.', 'Malleshwaram, 15th Cross'],
  ['pl_blr_2', 'Third Wave Coffee', 'food', 'Bengaluru', 12.9721, 77.5998, 4.5, 4, 1, '₹₹', 'Reliable Wi-Fi and quiet corners for a quick sync with teammates.', 'Indiranagar, 100 Feet Rd'],
  ['pl_blr_3', 'Nandi Fuel Stop', 'fuel', 'Bengaluru', 13.0312, 77.5489, 4.2, 9, 1, '₹', '24×7 fuel, clean restrooms and a small convenience store.', 'NH 48, Yeshwanthpur'],
  ['pl_blr_4', 'Cubbon Park Rest Point', 'rest', 'Bengaluru', 12.9763, 77.5929, 4.6, 8, 1, 'Free', 'Shaded green break — perfect to reset between travel and check-in.', 'Cubbon Park, Kasturba Rd'],
  ['pl_blr_5', 'HDFC ATM', 'atm', 'Bengaluru', 12.9748, 77.6011, 4.1, 3, 1, 'Free', 'Cash for registration desks and small vendors.', 'MG Road'],
  ['pl_mys_1', 'Mylari Dosa', 'food', 'Mysuru', 12.3031, 76.6502, 4.8, 5, 1, '₹', 'Soft, ghee-roasted dosas — a Mysuru classic before the opening ceremony.', 'Nazarbad Main Rd'],
  ['pl_mys_2', 'Tiger Trail Coffee', 'food', 'Mysuru', 12.3095, 76.6547, 4.4, 7, 1, '₹₹', 'Late-evening coffee and plug points near the campus belt.', 'Jayalakshmipuram'],
  ['pl_mys_3', 'Highway Fuel & Rest', 'fuel', 'Mysuru', 12.3382, 76.6201, 4.3, 11, 1, '₹', 'Fuel, snacks and a clean washroom on the Bengaluru–Mysuru expressway.', 'NH 275, Srirangapatna'],
  ['pl_mys_4', 'Kukkarahalli Lake Point', 'rest', 'Mysuru', 12.3161, 76.6295, 4.5, 9, 1, 'Free', 'A calm lakeside stop to stretch after a long drive.', 'Kukkarahalli Lake'],
  ['pl_mys_5', 'SBI ATM', 'atm', 'Mysuru', 12.3068, 76.6489, 4.0, 4, 1, 'Free', 'Handy for on-site registration and food stalls.', 'Vontikoppal'],
  ['pl_hyd_1', 'Paradise Biryani', 'food', 'Hyderabad', 17.4435, 78.3823, 4.5, 6, 1, '₹₹', 'Iconic biryani near the tech corridor — great team dinner spot.', 'Secunderabad'],
  ['pl_hyd_2', 'Cafe Niloufer', 'food', 'Hyderabad', 17.4326, 78.3961, 4.6, 8, 1, '₹', 'Irani chai andOsmania biscuits for a quick breakfast.', 'Lakdikapul'],
  ['pl_hyd_3', 'ORR Fuel Plaza', 'fuel', 'Hyderabad', 17.4709, 78.3901, 4.2, 12, 1, '₹', '24-hour fuel and food court on the outer ring road.', 'Nehru ORR'],
  ['pl_hyd_4', 'KBR Park Stop', 'rest', 'Hyderabad', 17.4252, 78.3801, 4.4, 10, 1, 'Free', 'Green break with walking trails.', 'Banjara Hills'],
  ['pl_pun_1', 'Vohuman Cafe', 'food', 'Pune', 18.5298, 73.8772, 4.6, 5, 1, '₹', 'Famous cheese omelette and bun maska before a morning workshop.', 'Sassoon Rd'],
  ['pl_pun_2', 'Pagdandi Books & Cafe', 'food', 'Pune', 18.5562, 73.7684, 4.5, 7, 1, '₹₹', 'Quiet cafe with power outlets — ideal for a final pitch review.', 'Baner'],
  ['pl_pun_3', 'Hinjewadi Fuel Bay', 'fuel', 'Pune', 18.5912, 73.7389, 4.1, 9, 1, '₹', 'Fuel and ATMs on the approach to the IT corridor.', 'Hinjewadi Phase 1'],
  ['pl_mum_1', 'Kyani & Co.', 'food', 'Mumbai', 18.9572, 72.8361, 4.5, 7, 1, '₹', 'Old-school Irani bakery — fast, filling and budget friendly.', 'Dhobitalao'],
  ['pl_mum_2', 'Blue Tokai BKC', 'food', 'Mumbai', 19.0661, 72.8681, 4.6, 5, 1, '₹₹', 'Specialty coffee and reliable Wi-Fi near the venue.', 'Bandra Kurla Complex'],
  ['pl_mum_3', 'Eastern Express Fuel', 'fuel', 'Mumbai', 19.0531, 72.8802, 4.0, 11, 1, '₹', 'Open 24 hours with clean facilities.', 'EE Highway'],
  ['pl_del_1', 'Karim’s', 'food', 'Delhi', 28.6493, 77.2265, 4.5, 9, 1, '₹₹', 'Historic Mughlai food — a memorable team meal.', 'Jama Masjid'],
  ['pl_del_2', 'Indian Coffee House', 'food', 'Delhi', 28.6328, 77.2197, 4.3, 6, 1, '₹', 'Budget-friendly filter coffee and snacks.', 'Connaught Place'],
  ['pl_del_3', 'DTU Campus ATM', 'atm', 'Delhi', 28.7509, 77.1182, 4.0, 2, 1, 'Free', 'Closest cash point to the venue gate.', 'DTU Campus'],
];

function seedStatic(): void {
  const count = (get<{ n: number }>('SELECT COUNT(*) as n FROM hackathons')?.n ?? 0);
  if (count === 0) {
    const now = Date.now();
    const stmt = connection!.prepare(`INSERT OR IGNORE INTO hackathons
      (id,slug,name,organizer,description,domain,tags,mode,city,venue,lat,lng,deadline,start_at,end_at,official_url,apply_url,prize,hue,source,approval_status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const h of HACKATHONS) {
      const deadline = now + h.deadlineDays * DAY + 9 * HOUR;
      const start = now + h.startDays * DAY + 10 * HOUR;
      stmt.run(h.id, h.slug, h.name, h.organizer, h.description, h.domain, JSON.stringify(h.tags), h.mode,
        h.city, h.venue, h.lat, h.lng, deadline, start, start + h.durationDays * DAY, h.officialUrl,
        h.applyUrl, h.prize, h.hue, 'curated', 'approved', now);
    }
  }
  const places = get<{ n: number }>('SELECT COUNT(*) as n FROM journey_places')?.n ?? 0;
  if (places === 0) {
    const stmt = connection!.prepare(`INSERT OR IGNORE INTO journey_places
      (id,name,type,city,lat,lng,rating,detour_min,open_now,price,note,address) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const p of PLACES) stmt.run(...p);
  }
}

export const DEMO_EMAIL = 'demo@techpulse.dev';
export const DEMO_PASSWORD = 'PulseDemo!2026';
export const ADMIN_EMAIL = 'admin@techpulse.dev';
export const ADMIN_PASSWORD = 'AdminPulse!2026';
/** Fixed demo TOTP secret — dev-only, so the sample admin can demonstrate MFA. */
export const ADMIN_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

const PEOPLE: Array<[string, string, string, string, string, string[], string, number]> = [
  ['usr_demo', 'Aarav Rao', DEMO_EMAIL, 'NIE, Mysuru', 'Mysuru', ['React', 'TypeScript', 'Product', 'Python'], 'Building things that make student life easier. Always up for a 48-hour sprint.', 168],
  ['usr_admin', 'Isha Menon', ADMIN_EMAIL, 'IISc, Bengaluru', 'Bengaluru', ['Platform', 'Security', 'Go'], 'Community admin and hackathon mentor.', 275],
  ['usr_meera', 'Meera Nair', 'meera@techpulse.dev', 'NITK Surathkal', 'Mangaluru', ['ML', 'Python', 'Data viz'], 'Love turning messy datasets into clear stories.', 320],
  ['usr_kabir', 'Kabir Shah', 'kabir@techpulse.dev', 'BITS Pilani', 'Hyderabad', ['Rust', 'Web3', 'Backend'], 'Protocol nerd. Two ETHGlobal wins and counting.', 42],
  ['usr_ananya', 'Ananya Iyer', 'ananya@techpulse.dev', 'COEP Pune', 'Pune', ['Figma', 'Design systems', 'Research'], 'Design lead who prototypes faster than most people sketch.', 205],
  ['usr_rohan', 'Rohan Das', 'rohan@techpulse.dev', 'DTU Delhi', 'Delhi', ['Security', 'CTF', 'Linux'], 'Blue-teamer, occasional CTF organiser.', 96],
  ['usr_sana', 'Sana Kulkarni', 'sana@techpulse.dev', 'VJTI Mumbai', 'Mumbai', ['Flutter', 'Firebase', 'UI'], 'Mobile-first builder and community volunteer.', 18],
];

/** Async because Argon2id and WebCrypto key generation are async. Idempotent. */
export async function seedAccounts(): Promise<void> {
  db();
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_ACCOUNTS !== 'true') return;
  const exists = get<{ n: number }>('SELECT COUNT(*) as n FROM users')?.n ?? 0;
  const now = Date.now();
  if (exists === 0) {
    const demoHash = await hashPassword(DEMO_PASSWORD);
    const adminHash = await hashPassword(ADMIN_PASSWORD);
    const unknownHash = await hashPassword(`never-used-${Math.random()}`);
    const userStmt = connection!.prepare(`INSERT OR IGNORE INTO users
      (id,email,name,password_hash,email_verified,totp_secret,totp_enabled,recovery_hashes,role,avatar_hue,college,city,skills,bio,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const [id, name, email, college, city, skills, bio, hue] of PEOPLE) {
      const isAdmin = id === 'usr_admin';
      const hash = id === 'usr_demo' ? demoHash : isAdmin ? adminHash : unknownHash;
      userStmt.run(id, email, name, hash, 1, isAdmin ? sealSystem(ADMIN_TOTP_SECRET) : null, isAdmin ? 1 : 0,
        '[]', isAdmin ? 'admin' : 'user', hue, college, city, JSON.stringify(skills), bio, now);
    }
    for (const [id] of PEOPLE) {
      connection!.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(id);
    }
    // Placeholder device keys for the simulated community (their private halves
    // are discarded — only the browser of the signed-in user holds a real key).
    for (const [id] of PEOPLE) {
      if (id === 'usr_demo' || id === 'usr_admin') continue;
      const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
      connection!.prepare('INSERT OR IGNORE INTO devices (id,user_id,public_jwk,label,created_at) VALUES (?,?,?,?,?)')
        .run(`dev_${id}`, id, JSON.stringify(jwk), 'Seeded device', now);
    }

    // Rich demo state for the signed-in demo account.
    const d = connection!;
    d.prepare('INSERT OR IGNORE INTO bookmarks VALUES (?,?,?)').run('usr_demo', 'hk_sih', now);
    d.prepare('INSERT OR IGNORE INTO bookmarks VALUES (?,?,?)').run('usr_demo', 'hk_horizon', now);
    d.prepare('INSERT OR IGNORE INTO bookmarks VALUES (?,?,?)').run('usr_demo', 'hk_green', now);

    const appStmt = d.prepare(`INSERT OR IGNORE INTO applications
      (id,user_id,hackathon_id,status,notes,applied_at,updated_at) VALUES (?,?,?,?,?,?,?)`);
    appStmt.run('app_1', 'usr_demo', 'hk_sih', 'shortlisted', sealForUser('usr_demo', 'Idea shortlisted for the campus round. Need the prototype demo ready by Friday.'), now - 3 * DAY, now - DAY);
    appStmt.run('app_2', 'usr_demo', 'hk_horizon', 'applied', sealForUser('usr_demo', 'Submitted as a solo builder — looking for a designer.'), now - 2 * DAY, now - 2 * DAY);
    appStmt.run('app_3', 'usr_demo', 'hk_space', 'participating', sealForUser('usr_demo', 'Team of 4 confirmed. Travel booked for Mysuru.'), now - 14 * DAY, now - 10 * DAY);
    appStmt.run('app_4', 'usr_demo', 'hk_spring', 'rejected', sealForUser('usr_demo', 'Missed the deadline — keeping notes for next year.'), now - 20 * DAY, now - 18 * DAY);

    const teamStmt = d.prepare(`INSERT OR IGNORE INTO teams
      (id,hackathon_id,owner_id,title,description,looking_for,max_size,created_at) VALUES (?,?,?,?,?,?,?,?)`);
    teamStmt.run('team_1', 'hk_sih', 'usr_demo', 'Signal & Sense', 'Computer-vision tooling for accessible public transport. We have the ML side covered.', JSON.stringify(['Frontend', 'React', 'UI design']), 4, now - 5 * DAY);
    teamStmt.run('team_2', 'hk_horizon', 'usr_kabir', 'Orbit Agents', 'Building an autonomous research agent with tool use and a clean web UI.', JSON.stringify(['Product', 'TypeScript', 'Design']), 5, now - 4 * DAY);
    teamStmt.run('team_3', 'hk_green', 'usr_ananya', 'Carbon Canvas', 'Climate data storytelling for city planners. Need a data engineer and a storyteller.', JSON.stringify(['Python', 'Data', 'Maps']), 4, now - 3 * DAY);
    teamStmt.run('team_4', 'hk_robotics', 'usr_rohan', 'Track Titans', 'Autonomous line-follower with computer vision. Hardware is ready.', JSON.stringify(['Embedded', 'C++', 'ROS']), 3, now - 2 * DAY);
    teamStmt.run('team_5', 'hk_chain', 'usr_sana', 'Chain Compass', 'A mobile-first onboarding wallet with great UX.', JSON.stringify(['Flutter', 'Solidity', 'UX']), 4, now - DAY);
    for (const [team, owner] of [['team_1', 'usr_demo'], ['team_2', 'usr_kabir'], ['team_3', 'usr_ananya'], ['team_4', 'usr_rohan'], ['team_5', 'usr_sana']]) {
      d.prepare('INSERT OR IGNORE INTO team_members VALUES (?,?,?)').run(team, owner, now);
    }

    const seekerStmt = d.prepare(`INSERT OR IGNORE INTO seekers
      (id,user_id,hackathon_id,headline,skills,availability,created_at) VALUES (?,?,?,?,?,?,?)`);
    seekerStmt.run('seek_1', 'usr_meera', 'hk_sih', 'ML engineer looking for a product-minded team', JSON.stringify(['ML', 'Python', 'Data viz']), 'Evenings + weekends', now - 4 * DAY);
    seekerStmt.run('seek_2', 'usr_ananya', 'hk_horizon', 'Designer who ships full design systems in 48h', JSON.stringify(['Figma', 'UI', 'Research']), 'Full weekend', now - 3 * DAY);
    seekerStmt.run('seek_3', 'usr_rohan', 'hk_cyber', 'Security enthusiast, happy to mentor', JSON.stringify(['Security', 'CTF', 'Linux']), 'Weekends', now - 2 * DAY);
    seekerStmt.run('seek_4', 'usr_kabir', 'hk_chain', 'Backend dev wanting a Web3 first build', JSON.stringify(['Rust', 'Backend', 'Web3']), 'Flexible', now - DAY);
    seekerStmt.run('seek_5', 'usr_sana', 'hk_green', 'Flutter dev for a climate dashboard', JSON.stringify(['Flutter', 'Firebase', 'UI']), 'Evenings', now - DAY);

    d.prepare(`INSERT OR IGNORE INTO team_requests (id,team_id,from_user_id,message,status,created_at,resolved_at) VALUES (?,?,?,?,?,?,?)`)
      .run('req_1', 'team_1', 'usr_ananya', 'I can own the whole UI layer and bring a design system. Would love to join!', 'pending', now - 6 * HOUR, null);

    // Team conversations are seeded; their E2EE keys are created by the browser
    // on first open (server never sees plaintext or private keys).
    d.prepare('INSERT OR IGNORE INTO conversations (id,kind,team_id,title,key_version,created_at) VALUES (?,?,?,?,?,?)')
      .run('conv_team', 'team', 'team_2', 'Orbit Agents · team chat', 1, now - 4 * DAY);
    for (const u of ['usr_demo', 'usr_kabir', 'usr_ananya']) {
      d.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id,user_id,wrapped_key,last_read_at) VALUES (?,?,?,?)')
        .run('conv_team', u, '', 0);
    }

    const calStmt = d.prepare(`INSERT OR IGNORE INTO calendar_events
      (id,user_id,title,type,starts_at,ends_at,hackathon_id,notes,remind_offsets,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const hk = (id: string) => get<{ deadline: number; start_at: number; end_at: number; name: string }>('SELECT * FROM hackathons WHERE id=?', id)!;
    const sih = hk('hk_sih');
    calStmt.run('cal_1', 'usr_demo', `Apply · ${sih.name}`, 'apply', sih.deadline - 2 * HOUR, sih.deadline, 'hk_sih', sealForUser('usr_demo', 'Submit the SIH campus-round idea before the portal closes.'), '[10080,1440,120]', now);
    calStmt.run('cal_2', 'usr_demo', sih.name, 'hackathon', sih.start_at, sih.end_at, 'hk_sih', sealForUser('usr_demo', 'Bring laptop, student ID and a charger.'), '[10080,1440,120]', now);
    calStmt.run('cal_3', 'usr_demo', 'Study · System design revision', 'study', now + 2 * DAY, now + 2 * DAY + 2 * HOUR, null, sealForUser('usr_demo', 'API design, caching and consistency basics.'), '[1440,120]', now);
    calStmt.run('cal_4', 'usr_demo', 'Study · DSA sprint', 'study', now + 5 * DAY + 3 * HOUR, now + 5 * DAY + 5 * HOUR, null, sealForUser('usr_demo', 'Graphs + DP problem set.'), '[1440,120]', now);
    calStmt.run('cal_5', 'usr_demo', 'Travel · Mysuru → Bengaluru', 'travel', sih.start_at - DAY, sih.start_at - DAY + 4 * HOUR, 'hk_sih', sealForUser('usr_demo', 'Leave early, breakfast stop on NH 275.'), '[10080,1440]', now);

    const notifStmt = d.prepare(`INSERT OR IGNORE INTO notifications
      (id,user_id,kind,title,body,link,read_at,created_at) VALUES (?,?,?,?,?,?,?,?)`);
    notifStmt.run('not_1', 'usr_demo', 'application', 'Shortlisted for Smart India Hackathon', 'Your idea moved to the campus round. Prep a 3-minute demo.', '/inbox', null, now - 4 * HOUR);
    notifStmt.run('not_2', 'usr_demo', 'team', 'New join request for Signal & Sense', 'Ananya Iyer wants to join your team listing.', '/collaborate', null, now - 6 * HOUR);
    notifStmt.run('not_3', 'usr_demo', 'reminder', 'Deadline in 6 days', 'Hack The Horizon closes soon. Finish your submission.', '/calendar', now - 12 * HOUR, now - DAY);
    notifStmt.run('not_4', 'usr_demo', 'system', 'Welcome to Tech Pulse', 'Your private vault and encrypted device key are ready to set up.', '/settings', null, now - 2 * DAY);

    d.prepare('INSERT OR IGNORE INTO trips (id,user_id,hackathon_id,origin,mode,created_at) VALUES (?,?,?,?,?,?)')
      .run('trip_demo', 'usr_demo', 'hk_sih', 'Mysuru', 'car', now - DAY);
    d.prepare('INSERT OR IGNORE INTO trip_saved_places VALUES (?,?,?)').run('trip_demo', 'pl_mys_1', now);
  }
}

export function resetDatabase(): void {
  if (connection) connection.close();
  connection = undefined;
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(DB_FILE + suffix)) unlinkSync(DB_FILE + suffix);
  }
}

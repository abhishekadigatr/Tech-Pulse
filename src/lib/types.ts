/** One shared type surface for the server, API and UI. */

export type Mode = 'online' | 'offline' | 'hybrid';
export type ApplicationStatus = 'applied' | 'shortlisted' | 'participating' | 'rejected';
export type CalendarType = 'apply' | 'study' | 'hackathon' | 'travel';
export type RequestStatus = 'pending' | 'accepted' | 'rejected';
export type ConversationKind = 'dm' | 'team';
export type PlaceType = 'food' | 'fuel' | 'rest' | 'atm';

export interface Hackathon {
  id: string;
  slug: string;
  name: string;
  organizer: string;
  description: string;
  domain: string;
  tags: string[];
  mode: Mode;
  city: string;
  venue: string;
  lat: number;
  lng: number;
  deadline: number;
  startAt: number;
  endAt: number;
  officialUrl: string;
  applyUrl: string;
  prize: string;
  hue: number;
  source: string;
  approvalStatus: 'approved' | 'pending' | 'rejected';
  bookmarked?: boolean;
  application?: ApplicationStatus | null;
  teamCount?: number;
  seekerCount?: number;
}

export interface PublicUser {
  id: string;
  name: string;
  email?: string;
  avatarHue: number;
  college: string;
  city: string;
  skills: string[];
  bio: string;
  role: 'user' | 'admin';
  profileVisibility: 'public' | 'team-only' | 'private';
}

export interface Me extends PublicUser {
  emailVerified: boolean;
  totpEnabled: boolean;
  aal2: boolean;
  createdAt: number;
  settings: UserSettings;
}

export interface UserSettings {
  theme: 'nebula' | 'aurora' | 'midnight';
  notifyInApp: boolean;
  notifyPush: boolean;
  notifyEmail: boolean;
  reminderOffsets: number[]; // minutes before
  profileVisibility: 'public' | 'team-only' | 'private';
  showJourneyTips: boolean;
  weeklyDigest: boolean;
}

export interface Application {
  id: string;
  userId: string;
  hackathonId: string;
  hackathon: Hackathon;
  status: ApplicationStatus;
  notes: string;
  notesFormat?: 'client' | 'legacy' | 'empty' | 'unreadable';
  appliedAt: number;
  updatedAt: number;
}

export interface Team {
  id: string;
  hackathonId: string;
  hackathon?: Hackathon;
  ownerId: string;
  owner: PublicUser;
  title: string;
  description: string;
  lookingFor: string[];
  maxSize: number;
  members: PublicUser[];
  createdAt: number;
  myRequestStatus?: RequestStatus | null;
}

export interface Seeker {
  id: string;
  user: PublicUser;
  hackathonId: string;
  hackathon?: Hackathon;
  headline: string;
  skills: string[];
  availability: string;
  createdAt: number;
}

export interface TeamRequest {
  id: string;
  teamId: string;
  teamTitle: string;
  hackathonName: string;
  fromUser: PublicUser;
  message: string;
  status: RequestStatus;
  createdAt: number;
}

export interface Conversation {
  id: string;
  kind: ConversationKind;
  teamId: string | null;
  title: string;
  members: PublicUser[];
  keyVersion: number;
  lastMessageAt: number;
  unread: number;
  online?: number;
}

/** The server never sees `plaintext`. This is the only shape it stores. */
export interface CipherMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  ciphertext: string;
  nonce: string;
  keyVersion: number;
  createdAt: number;
}

export interface WrappedKey {
  conversationId: string;
  userId: string;
  wrappedKey: string; // b64 JSON: { iv, ct, wrapperPublicJwk }
  keyVersion: number;
}

export interface CalendarEvent {
  id: string;
  userId: string;
  title: string;
  type: CalendarType;
  startsAt: number;
  endsAt: number;
  hackathonId: string | null;
  notes: string;
  notesFormat?: 'client' | 'legacy' | 'empty' | 'unreadable';
  remindOffsets: number[];
  createdAt: number;
}

export interface Notification {
  id: string;
  userId: string;
  kind: 'reminder' | 'team' | 'application' | 'system' | 'chat';
  title: string;
  body: string;
  link: string;
  readAt: number | null;
  createdAt: number;
}

export interface InboxItem {
  id: string;
  kind: 'application' | 'notification' | 'request';
  title: string;
  body: string;
  link: string;
  createdAt: number;
  read: boolean;
  meta?: string;
}

export interface JourneyPlace {
  id: string;
  name: string;
  type: PlaceType;
  city: string;
  lat: number;
  lng: number;
  rating: number;
  detourMin: number;
  openNow: boolean;
  price: string;
  note: string;
  address: string;
  saved?: boolean;
}

export interface RoutePoint {
  name: string;
  lat: number;
  lng: number;
  km: number;
}

export interface Trip {
  id: string;
  hackathonId: string;
  hackathon: Hackathon;
  origin: string;
  mode: 'car' | 'train' | 'bus' | 'flight';
  distanceKm: number;
  durationMin: number;
  route: RoutePoint[];
  suggestions: JourneyPlace[];
  checklist: { id: string; label: string; category: string }[];
  createdAt: number;
}

export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

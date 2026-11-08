import { get, run } from '../db.ts';
import { notFound } from '../http.ts';
import { ok, readBody, requireAuth, Routes, write, type Ctx } from '../router.ts';
import {
  conversationById, conversationKeys, createDirectConversation, createTeam, createTeamRequest,
  deleteTeam, listConversations, listSeekers, listTeams, markConversationRead, messagesFor,
  removeTeamMember, resolveTeamRequest, rotateConversationKey, setConversationKeys, teamById,
  teamRequestsFor, upsertSeeker,
} from '../features.ts';
import { teamPatchSchema, teamSchema, requestSchema, requestPatchSchema, seekerSchema, conversationSchema, keysSchema } from '../schemas.ts';
import { storeCipherMessage } from '../messages.ts';
import { z } from 'zod';
import { clampInt } from '../http.ts';

export async function handleSocial(ctx: Ctx): Promise<Response | null> {
  const r = new Routes(ctx);

  r.get('/teams', ({ ctx: c }) => ok({ items: listTeams(c.url.searchParams.get('hackathonId') ?? undefined, c.auth?.user.id) }));

  r.get('/hackathons/:id/teams', ({ ctx: c, params }) => ok({ items: listTeams(params.id, c.auth?.user.id) }));

  r.post('/hackathons/:id/teams', async ({ ctx: c, params }) => {
    const auth = write(c);
    if (!get('SELECT 1 FROM hackathons WHERE id=? AND approval_status=?', params.id, 'approved')) return notFound('Hackathon not found');
    const input = await readBody(c, teamSchema);
    return ok({ team: createTeam(auth.user.id, params.id, input.title, input.description, input.lookingFor, input.maxSize) }, 201);
  });

  r.get('/teams/:id', ({ ctx: c, params }) => {
    const team = teamById(params.id, c.auth?.user.id);
    return team ? ok({ team }) : notFound('Team not found');
  });

  r.patch('/teams/:id', async ({ ctx: c, params }) => {
    const auth = write(c);
    const team = teamById(params.id, auth.user.id);
    if (!team) return notFound('Team not found');
    if (team.ownerId !== auth.user.id) return notFound('Only the team owner can edit this listing');
    const input = await readBody(c, teamPatchSchema);
    run('UPDATE teams SET title=?, description=?, looking_for=?, max_size=? WHERE id=?',
      input.title ?? team.title, input.description ?? team.description,
      input.lookingFor ? JSON.stringify(input.lookingFor) : JSON.stringify(team.lookingFor),
      input.maxSize ?? team.maxSize, params.id);
    return ok({ team: teamById(params.id, auth.user.id) });
  });

  r.delete('/teams/:id', ({ ctx: c, params }) => {
    const auth = write(c);
    return deleteTeam(params.id, auth.user.id) ? ok({ ok: true }) : notFound('Team not found or not owned by you');
  });

  r.get('/seekers', ({ ctx: c }) => ok({ items: listSeekers(c.url.searchParams.get('hackathonId') ?? undefined) }));
  r.get('/hackathons/:id/seekers', ({ params }) => ok({ items: listSeekers(params.id) }));

  r.post('/seekers', async ({ ctx: c }) => {
    const auth = write(c);
    const input = await readBody(c, seekerSchema);
    if (!get('SELECT 1 FROM hackathons WHERE id=?', input.hackathonId)) return notFound('Hackathon not found');
    return ok({ seeker: upsertSeeker(auth.user.id, input.hackathonId, input.headline, input.skills, input.availability) }, 201);
  });

  r.post('/hackathons/:id/seekers', async ({ ctx: c, params }) => {
    const auth = write(c);
    const input = await readBody(c, seekerSchema.omit({ hackathonId: true }));
    if (!get('SELECT 1 FROM hackathons WHERE id=?', params.id)) return notFound('Hackathon not found');
    return ok({ seeker: upsertSeeker(auth.user.id, params.id, input.headline, input.skills, input.availability) }, 201);
  });

  r.post('/teams/:id/requests', async ({ ctx: c, params }) => {
    const auth = write(c);
    const input = await readBody(c, requestSchema);
    const request = createTeamRequest(params.id, auth.user.id, input.message);
    return request ? ok({ request }, 201) : notFound('Team not found, already requested, or you own it');
  });

  r.get('/teams/:id/requests', ({ ctx: c, params }) => {
    const auth = requireAuth(c);
    const team = teamById(params.id, auth.user.id);
    if (!team || team.ownerId !== auth.user.id) return notFound('No requests for this team');
    return ok({ items: teamRequestsFor(auth.user.id) });
  });

  r.get('/team-requests', ({ ctx: c }) => {
    const auth = requireAuth(c);
    const status = c.url.searchParams.get('status');
    return ok({ items: teamRequestsFor(auth.user.id, status === 'pending' || status === 'accepted' || status === 'rejected' ? status : undefined) });
  });

  r.patch('/team-requests/:id', async ({ ctx: c, params }) => {
    const auth = write(c);
    const { accept } = await readBody(c, requestPatchSchema);
    return resolveTeamRequest(params.id, auth.user.id, accept) ? ok({ ok: true, accepted: accept }) : notFound('Request not found');
  });

  r.delete('/teams/:id/members/:userId', ({ ctx: c, params }) => {
    const auth = write(c);
    return removeTeamMember(params.id, auth.user.id, params.userId) ? ok({ ok: true }) : notFound('Member not found');
  });

  /* ── Encrypted conversations ─────────────────────────────────────────── */
  r.get('/conversations', ({ ctx: c }) => {
    const auth = requireAuth(c);
    return ok({ items: listConversations(auth.user.id) });
  });

  r.post('/conversations', async ({ ctx: c }) => {
    const auth = write(c);
    const input = await readBody(c, conversationSchema);
    if (!input.otherUserId) return ok({ error: 'otherUserId is required for a direct message' }, 400);
    const conversation = createDirectConversation(auth.user.id, input.otherUserId);
    return conversation ? ok({ conversation }, 201) : notFound('User not found');
  });

  r.get('/conversations/:id', ({ ctx: c, params }) => {
    const auth = requireAuth(c);
    const conversation = conversationById(params.id, auth.user.id);
    return conversation ? ok({ conversation }) : notFound('Conversation not found');
  });

  r.get('/conversations/:id/messages', ({ ctx: c, params }) => {
    const auth = requireAuth(c);
    const before = c.url.searchParams.get('cursor');
    return ok(messagesFor(params.id, auth.user.id, before ?? undefined, clampInt(c.url.searchParams.get('limit'), 1, 100, 50)));
  });

  r.post('/conversations/:id/messages', async ({ ctx: c, params }) => {
    const auth = write(c);
    const input = await readBody(c, z.object({ ciphertext: z.string().max(16_384), nonce: z.string().max(64) }));
    const message = storeCipherMessage(params.id, auth.user.id, input.ciphertext, input.nonce);
    return message ? ok({ message }, 201) : notFound('Invalid encrypted payload or not a member');
  });

  r.get('/conversations/:id/keys', ({ ctx: c, params }) => {
    const auth = requireAuth(c);
    const keys = conversationKeys(params.id, auth.user.id);
    return keys ? ok(keys) : notFound('Conversation not found');
  });

  r.post('/conversations/:id/keys', async ({ ctx: c, params }) => {
    const auth = write(c);
    const input = await readBody(c, keysSchema);
    return setConversationKeys(params.id, auth.user.id, input.keyVersion, input.wrapped)
      ? ok({ ok: true }) : notFound('Invalid key distribution');
  });

  r.post('/conversations/:id/rotate-key', ({ ctx: c, params }) => {
    const auth = write(c);
    return rotateConversationKey(params.id, auth.user.id) ? ok({ ok: true }) : notFound('Conversation not found');
  });

  r.post('/conversations/:id/read', ({ ctx: c, params }) => {
    const auth = write(c);
    return markConversationRead(params.id, auth.user.id) ? ok({ ok: true }) : notFound('Conversation not found');
  });

  return r.run();
}

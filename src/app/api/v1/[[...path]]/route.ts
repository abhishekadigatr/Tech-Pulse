import { assertSameOrigin, clientIp, errorResponse, notFound, rateLimit } from '@/server/http';
import { ctxFrom, type Ctx } from '@/server/router';
import { handleAuth } from '@/server/routes/auth';
import { handleUsers } from '@/server/routes/users';
import { handleCatalog } from '@/server/routes/catalog';
import { handleApplications } from '@/server/routes/applications';
import { handleSocial } from '@/server/routes/social';
import { handlePlanning } from '@/server/routes/planning';
import { handleAdmin } from '@/server/routes/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handlers: Array<(ctx: Ctx) => Promise<Response | null>> = [
  handleAuth, handleUsers, handleCatalog, handleApplications,
  handleSocial, handlePlanning, handleAdmin,
];

type RouteContext = { params: Promise<{ path?: string[] }> };

async function dispatch(request: Request, context: RouteContext): Promise<Response> {
  const { path = [] } = await context.params;
  const segments = path.filter((s) => typeof s === 'string' && s.length <= 80 && !s.includes('..') && !s.includes('/'));
  const ctx = ctxFrom(request, segments);
  rateLimit(`api:${clientIp(request)}`, 900, 60_000);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(ctx.method)) assertSameOrigin(request);
  for (const handle of handlers) {
    const response = await handle(ctx);
    if (response) return response;
  }
  return notFound('Endpoint not found');
}

async function safe(request: Request, context: RouteContext): Promise<Response> {
  try {
    return await dispatch(request, context);
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = safe;
export const POST = safe;
export const PUT = safe;
export const PATCH = safe;
export const DELETE = safe;
export const HEAD = safe;
export const OPTIONS = async (): Promise<Response> => new Response(null, { status: 204 });

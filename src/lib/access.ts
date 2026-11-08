/** Shared route classification and assurance policy; no client-provided claims are trusted. */
export type AccessState = { totpEnabled: boolean; aal2: boolean } | null;
export type AccessDecision = 'allow' | 'login' | 'enroll' | 'step-up';

const pageRoots = ['/settings', '/inbox', '/collaborate', '/calendar', '/chat'];
const apiRoots = ['/users/me', '/applications', '/inbox', '/calendar', '/teams', '/seekers', '/team-requests', '/conversations'];
const atRoot = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

export function protectedPage(path: string): boolean {
  return pageRoots.some((root) => atRoot(path, root));
}
export function protectedApi(path: string): boolean {
  if (atRoot(path, '/auth')) return false;
  if (/^\/hackathons\/[^/]+\/(teams|seekers)(\/|$)/.test(path)) return true;
  if (/^\/users\/[^/]+\/public-keys$/.test(path)) return true;
  return apiRoots.some((root) => atRoot(path, root));
}
export function accessDecision(path: string, state: AccessState, enrollmentPage = false): AccessDecision {
  if (!protectedPage(path)) return 'allow';
  if (!state) return 'login';
  if (!state.totpEnabled) return path === '/settings' && enrollmentPage ? 'allow' : 'enroll';
  return state.aal2 ? 'allow' : 'step-up';
}
export function apiAccessDecision(path: string, state: AccessState): AccessDecision {
  if (!protectedApi(path)) return 'allow';
  if (!state) return 'login';
  if (!state.totpEnabled) return 'enroll';
  return state.aal2 ? 'allow' : 'step-up';
}

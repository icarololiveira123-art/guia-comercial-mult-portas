import { randomUUID } from 'node:crypto';

// Development-only transport. The packaged application never enables it.
export function createMockApi() {
  let state = { metrics: { leads: 7 }, followups: [{ id: 'example', client: 'Cliente exemplo', amountCents: 125050 }], marketingDaily: { days: [] } };
  let revision = 'initial';
  let token = null;
  const user = { id: 9001, username: 'teste', displayName: 'Equipe Mult Portas', branch: 'Araraquara' };
  const fetch = async (url, init = {}) => {
    const route = new URL(url).pathname.replace('/functions/v1/mult-portas-api', '');
    const body = init.body ? JSON.parse(init.body) : {};
    if (route === '/api/auth/login') {
      if (body.username !== 'teste' || body.password !== 'senha-temporaria-de-teste') return Response.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 });
      token = randomUUID(); return Response.json({ user, admin: false, token, expiresAt: '2030-01-01T00:00:00Z' });
    }
    if (!token || new Headers(init.headers).get('Authorization') !== `Bearer ${token}`) return Response.json({ error: 'Sessão expirada.' }, { status: 401 });
    if (route === '/api/auth/me') return Response.json({ user, admin: false });
    if (route === '/api/auth/logout') { token = null; return Response.json({ ok: true }); }
    if (route === '/api/data' && init.method === 'GET') return Response.json({ state, revision, clientState: { schemaVersion: 1 } });
    if (route === '/api/data' && init.method === 'PUT') {
      if (body.baseRevision !== revision) return Response.json({ error: 'Conflito.' }, { status: 409 });
      state = structuredClone(body.state); revision = randomUUID(); return Response.json({ ok: true, revision });
    }
    return Response.json({ error: 'Não encontrado.' }, { status: 404 });
  };
  fetch.readState = () => structuredClone(state);
  fetch.replaceState = value => { state = structuredClone(value); revision = randomUUID(); };
  fetch.revoke = () => { token = null; };
  return fetch;
}

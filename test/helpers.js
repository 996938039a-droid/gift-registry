const { createRuntime } = require('../scripts/mock-gas');
const rt = createRuntime();
// Same call shape the browser uses. jar holds the session token, like localStorage does.
function call(method, p, body, jar) {
  const q = {}; let pathOnly = p;
  if (p.includes('?')) { const [a, b] = p.split('?'); pathOnly = a; new URLSearchParams(b).forEach((v, k) => (q[k] = v)); }
  const out = rt.get({ method, path: pathOnly, query: q, body: body || {}, token: jar && jar.token });
  if (out.ok && out.data && out.data.token && jar) jar.token = out.data.token;
  return Promise.resolve({ status: out.status, body: out.ok ? out.data : { error: out.error } });
}
const get = (p, jar) => call('GET', p, null, jar);
const post = (p, b, jar) => call('POST', p, b || {}, jar);
async function signup(role, name, email, jar) { const r = await post('/auth/signup', { name, email, password: 'password123', role, consent: true }, jar); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r; }
module.exports = { rt, call, get, post, signup, cleanup: () => {} };

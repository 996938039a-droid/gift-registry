const test = require('node:test');
const assert = require('node:assert/strict');
const { rt, call, get, post, signup, cleanup } = require('./helpers');
test.after(cleanup);

const couple = {}, g1 = {}, g2 = {}, g3 = {};
let slug, itemSingle, itemGroup, itemGuestGroup, cashGoal;

test('signup validation and login', async () => {
  let r = await post('/auth/signup', { name: 'A', email: 'bad', password: 'password123', consent: true });
  assert.equal(r.status, 400);
  r = await post('/auth/signup', { name: 'A', email: 'a@x.com', password: 'short', consent: true });
  assert.equal(r.status, 400);
  r = await post('/auth/signup', { name: 'A', email: 'a@x.com', password: 'password123' });
  assert.equal(r.status, 400, 'needs consent');
  await signup('couple', 'Meera', 'meera@x.com', couple);
  assert.ok(couple.token && couple.token.includes('.'), 'session token issued');
  assert.equal((await post('/auth/signup', { name: 'M', email: 'MEERA@x.com', password: 'password123', consent: true })).status, 409);
  const bad = await post('/auth/login', { email: 'meera@x.com', password: 'wrongwrong' });
  assert.equal(bad.status, 401);
  const unknown = await post('/auth/login', { email: 'nobody@x.com', password: 'wrongwrong' });
  assert.equal(unknown.body.error, bad.body.error, 'same message for unknown user');
  const ok = await post('/auth/login', { email: 'meera@x.com', password: 'password123' }, {});
  assert.equal(ok.status, 200);
  await signup('guest', 'Tara', 'tara@x.com', g1); await signup('guest', 'Imran', 'imran@x.com', g2); await signup('guest', 'Sana', 'sana@x.com', g3);
});

test('security basics', async () => {
  assert.equal((await get('/registry/mine', {})).status, 401);
  assert.equal((await get('/registry/mine', g1)).status, 403, 'guest cannot open couple dashboard');
  assert.equal((await post('/item/save', { name: 'x', price: 5 }, g1)).status, 403);
  assert.equal((await get('/registry/mine', { token: couple.token.slice(0, -3) + 'abc' })).status, 401, 'tampered token');
  assert.equal((await get('/registry/mine', { token: 'garbage' })).status, 401, 'garbage token');
  assert.equal((await call('GET', '/nope', null, couple)).status, 404);
  assert.equal(rt.post('{not json').status, 400);
  const forged = Buffer.from(JSON.stringify({ sub: 'x', name: 'Eve', role: 'couple', exp: Date.now() + 1e9 })).toString('base64');
  assert.equal((await get('/registry/mine', { token: forged + '.' + '0'.repeat(64) })).status, 401, 'forged token');
});

test('couple creates registry and gifts', async () => {
  assert.equal((await post('/registry/save', { names: 'Aarav & Meera', date: '2027-02-13', venue: 'Hall', upi: 'bad upi' }, couple)).status, 400);
  const r = await post('/registry/save', { names: 'Aarav & Meera', date: '2027-02-13', venue: 'Hall, Powai', city: 'Mumbai', upi: 'meera@okbank', handoverNote: 'At venue by 6 pm', papers: ['ivory', 'blush', 'nope'] }, couple);
  assert.equal(r.status, 200); slug = r.body.slug; assert.match(slug, /^aarav-and-meera-/);
  const bad = await post('/item/save', { name: 'Evil', price: 100, url: 'javascript:alert(1)' }, couple);
  assert.equal(bad.status, 400);
  itemSingle = (await post('/item/save', { name: 'Air fryer', price: 7995, url: 'https://www.amazon.in/s?k=air+fryer' }, couple)).body.id;
  itemGroup = (await post('/item/save', { name: 'Washing machine', price: 30000, url: 'https://www.amazon.in/x', group: true }, couple)).body.id;
  itemGuestGroup = (await post('/item/save', { name: 'Dining table', price: 28000, url: 'flipkart.com/dining' }, couple)).body.id;
  cashGoal = (await post('/item/save', { kind: 'cash', name: 'Honeymoon fund', price: 100000 }, couple)).body.id;
  const mine = (await get('/registry/mine', couple)).body;
  assert.equal(mine.items.length, 4);
  assert.deepEqual(mine.registry.papers, ['ivory', 'blush']);
  assert.equal(mine.items.find((i) => i.id === itemGuestGroup).url, 'https://flipkart.com/dining');
});

test('guest must sign in; sees items; cannot see couple UPI unless paying', async () => {
  assert.equal((await get('/registry/view?slug=' + slug, {})).status, 401);
  assert.equal((await get('/registry/peek?slug=' + slug, {})).body.names, 'Aarav & Meera');
  const v = (await get('/registry/view?slug=' + slug, g1)).body;
  assert.equal(v.registry.upi, undefined);
  assert.equal(v.items.find((i) => i.id === itemSingle).payUpi, '');
  assert.equal(v.items.find((i) => i.id === itemGroup).payUpi, 'meera@okbank');
  assert.equal((await get('/registry/view?slug=nope', g1)).status, 404);
});

test('solo gift: self delivery, race protection and cancel', async () => {
  const [a, b] = await Promise.all([post('/claim/create', { itemId: itemSingle, delivery: 'self' }, g1), post('/claim/create', { itemId: itemSingle, delivery: 'self' }, g2)]);
  const codes = [a.status, b.status].sort();
  assert.deepEqual(codes, [200, 409], 'exactly one wins');
  const winner = a.status === 200 ? { jar: g1, id: a.body.id } : { jar: g2, id: b.body.id };
  assert.equal((await post('/claim/create', { itemId: itemSingle, delivery: 'self' }, g3)).status, 409);
  assert.equal((await post('/claim/cancel', { id: winner.id }, winner.jar)).status, 200);
  const c2 = await post('/claim/create', { itemId: itemSingle, delivery: 'self', groupName: 'College friends', members: 'Tara, Imran, Sana' }, g3);
  assert.equal(c2.status, 200);
  assert.equal((await post('/claim/bought', { id: c2.body.id, orderRef: 'OD123' }, g3)).status, 200);
  assert.equal((await post('/claim/bought', { id: c2.body.id }, g1)).status, 404, "can't touch another guest's claim");
  assert.equal((await post('/claim/cancel', { id: c2.body.id }, g3)).status, 400, 'bought cannot be cancelled');
  const view = (await get('/registry/view?slug=' + slug, g1)).body.items.find((i) => i.id === itemSingle);
  assert.equal(view.claim.status, 'bought'); assert.equal(view.claim.by, 'Sana'); assert.equal(view.claim.members, undefined, 'members private');
  const own = (await get('/registry/mine', couple)).body.items.find((i) => i.id === itemSingle);
  assert.equal(own.claim.groupName, 'College friends'); assert.equal(own.claim.members, 'Tara, Imran, Sana');
  assert.equal((await post('/claim/received', { id: own.claim.id }, g3)).status, 403);
  assert.equal((await post('/claim/received', { id: own.claim.id }, couple)).status, 200);
});

test('wrap service order carries customisation and statuses', async () => {
  const gid = (await post('/item/save', { name: 'Bedsheet set', price: 2499, url: 'https://amazon.in/b' }, couple)).body.id;
  assert.equal((await post('/claim/create', { itemId: gid, delivery: 'service', paper: 'midnight', ribbon: 'gold', tier: 'premium' }, g1)).status, 400, 'paper not offered by couple');
  const c = await post('/claim/create', { itemId: gid, delivery: 'service', paper: 'blush', ribbon: 'sage', tier: 'premium', card: 'With love, Tara' }, g1);
  assert.equal(c.status, 200);
  await post('/claim/bought', { id: c.body.id, orderRef: 'AMZ-9' }, g1);
  assert.equal((await post('/claim/feepaid', { id: c.body.id }, g1)).status, 200);
  const mine = (await get('/guest/mine', g1)).body.claims.find((x) => x.id === c.body.id);
  assert.deepEqual([mine.fee, mine.feeStatus, mine.wrapStatus, mine.card], [499, 'claimed', 'awaiting', 'With love, Tara']);
  const cv = (await get('/registry/mine', couple)).body.items.find((i) => i.id === gid).claim;
  assert.equal(cv.delivery, 'service'); assert.equal(cv.paper, 'blush');
  assert.equal((await post('/claim/create', { itemId: gid, delivery: 'self' }, couple)).status, 403, 'owner cannot buy own gift');
});

test('couple-set group gift: pledges, caps, privacy, confirm', async () => {
  assert.equal((await post('/claim/create', { itemId: itemGroup, delivery: 'self' }, g1)).status, 403, 'group item cannot be bought solo');
  assert.equal((await post('/pledge/create', { itemId: itemGroup, amount: 40000 }, g1)).status, 400, 'over target');
  const p1 = await post('/pledge/create', { itemId: itemGroup, amount: 10000, note: 'Congrats!' }, g1);
  const p2 = await post('/pledge/create', { itemId: itemGroup, amount: 5000, anonymous: true }, g2);
  assert.equal(p1.status, 200);
  const view = (await get('/registry/view?slug=' + slug, g3)).body.items.find((i) => i.id === itemGroup);
  assert.equal(view.pledgedTotal, 15000);
  assert.deepEqual(view.pledges.map((p) => p.name), ['Tara', 'Anonymous']);
  assert.equal(view.pledges[0].note, '', "other guests don't see notes");
  const own = (await get('/registry/mine', couple)).body.items.find((i) => i.id === itemGroup);
  assert.deepEqual(own.pledges.map((p) => p.name), ['Tara', 'Imran'], 'couple sees real names');
  assert.equal((await post('/pledge/confirm', { id: p1.body.id }, g2)).status, 403, 'only recipient confirms');
  assert.equal((await post('/pledge/sent', { id: p1.body.id }, g1)).status, 200);
  assert.equal((await post('/pledge/confirm', { id: p1.body.id }, couple)).status, 200);
  assert.equal((await post('/pledge/cancel', { id: p1.body.id }, g1)).status, 400, 'confirmed cannot be cancelled');
  assert.equal((await post('/pledge/cancel', { id: p2.body.id }, g2)).status, 200);
  assert.equal((await post('/pledge/create', { itemId: cashGoal, amount: 2000 }, g3)).status, 200, 'cash goal pledge');
  assert.equal((await post('/pledge/create', { itemId: itemGroup, amount: 100 }, couple)).status, 403);
});

test('guest-organised group gift, then bought with wrap service', async () => {
  assert.equal((await post('/group/start', { itemId: itemGuestGroup, groupName: 'Office gang', upi: 'bad' }, g1)).status, 400);
  assert.equal((await post('/group/start', { itemId: itemGuestGroup, groupName: 'Office gang', upi: 'tara@okbank' }, g1)).status, 200);
  const v = (await get('/registry/view?slug=' + slug, g2)).body.items.find((i) => i.id === itemGuestGroup);
  assert.equal(v.mode, 'group'); assert.equal(v.payUpi, 'tara@okbank'); assert.equal(v.groupName, 'Office gang'); assert.equal(v.organiserName, 'Tara');
  const p = await post('/pledge/create', { itemId: itemGuestGroup, amount: 8000 }, g2);
  assert.equal((await post('/pledge/confirm', { id: p.body.id }, couple)).status, 403, 'couple is not the recipient here');
  assert.equal((await post('/pledge/confirm', { id: p.body.id }, g1)).status, 200, 'organiser confirms');
  assert.equal((await post('/claim/create', { itemId: itemGuestGroup, delivery: 'self' }, g2)).status, 403, 'only organiser can mark bought');
  const mineOrg = (await get('/guest/mine', g1)).body.organised[0]; assert.equal(mineOrg.pledgedTotal, 8000);
  const c = await post('/claim/create', { itemId: itemGuestGroup, delivery: 'service', paper: 'ivory', ribbon: 'red', tier: 'standard', card: 'From the office gang' }, g1);
  assert.equal(c.status, 200);
  const cl = (await get('/registry/mine', couple)).body.items.find((i) => i.id === itemGuestGroup).claim;
  assert.equal(cl.groupName, 'Office gang');
  assert.equal((await post('/pledge/create', { itemId: itemGuestGroup, amount: 100 }, g3)).status, 400, 'closed once bought');
  assert.equal((await post('/group/cancel', { itemId: itemGuestGroup }, g1)).status, 400);
});

test('hide buyers hides other guests but not couple', async () => {
  const s = await post('/registry/save', { names: 'Aarav & Meera', date: '2027-02-13', venue: 'Hall, Powai', city: 'Mumbai', upi: 'meera@okbank', hideBuyers: true, papers: ['ivory', 'blush'] }, couple);
  assert.equal(s.body.slug, slug, 'update keeps slug');
  const v = (await get('/registry/view?slug=' + slug, g2)).body.items.find((i) => i.id === itemSingle);
  assert.equal(v.claim.by, null); assert.equal(v.claim.status, 'received');
  const own = (await get('/registry/mine', couple)).body.items.find((i) => i.id === itemSingle);
  assert.equal(own.claim.by, 'Sana');
});

test('messages and remove rules', async () => {
  assert.equal((await post('/message/create', { slug, text: 'Congratulations!' }, g1)).status, 200);
  assert.equal((await post('/message/create', { slug, text: 'hi' }, couple)).status, 403);
  assert.equal((await get('/registry/mine', couple)).body.messages[0].text, 'Congratulations!');
  assert.equal((await post('/item/remove', { id: itemSingle }, couple)).status, 400, 'bought gift cannot be removed');
  const tmp = (await post('/item/save', { name: 'Vase', price: 900 }, couple)).body.id;
  assert.equal((await post('/item/remove', { id: tmp }, couple)).status, 200);
  assert.equal((await get('/registry/mine', couple)).body.items.some((i) => i.id === tmp), false);
});

test('values with formula or markup characters are stored as plain text', async () => {
  const id = (await post('/item/save', { name: '=HYPERLINK("http://evil")<img src=x>', price: 500 }, couple)).body.id;
  const it = (await get('/registry/mine', couple)).body.items.find((i) => i.id === id);
  assert.equal(it.name, '=HYPERLINK("http://evil")<img src=x>');
});


test('passwords are not stored in the clear and tokens expire', async () => {
  const users = rt.state.sheets.Users.slice(1);
  assert.ok(users.every((r) => /^v1\$[0-9a-f]{16}\$[0-9a-f]{64}$/.test(r[4])), 'hashed, salted');
  assert.ok(!JSON.stringify(rt.state.sheets.Users).includes('password123'));
  const realNow = Date.now; Date.now = () => realNow() + 15 * 86400000;
  try { assert.equal((await get('/registry/mine', couple)).status, 401, 'expired after 14 days'); } finally { Date.now = realNow; }
  assert.equal((await get('/registry/mine', couple)).status, 200);
});

test('login lockout after repeated failures, and recovery by reset code', async () => {
  const jar = {};
  for (let i = 0; i < 8; i++) assert.equal((await post('/auth/login', { email: 'tara@x.com', password: 'nope-nope-1' }, jar)).status, 401);
  const locked = await post('/auth/login', { email: 'tara@x.com', password: 'password123' }, jar);
  assert.equal(locked.status, 429, 'even the right password is refused while locked');
  // forgot: same reply for unknown emails, mail only for real accounts
  const before = rt.state.mail.length;
  assert.equal((await post('/auth/forgot', { email: 'nobody@x.com' })).status, 200); assert.equal(rt.state.mail.length, before);
  assert.equal((await post('/auth/forgot', { email: 'tara@x.com' })).status, 200); assert.equal(rt.state.mail.length, before + 1);
  const code = rt.state.mail[rt.state.mail.length - 1].body.match(/code is (\d{6})/)[1];
  assert.equal((await post('/auth/reset', { email: 'tara@x.com', code: '000000', password: 'newpassword1' })).status, 400, 'wrong code');
  assert.equal((await post('/auth/reset', { email: 'tara@x.com', code, password: 'short' })).status, 400, 'weak password');
  const ok = await post('/auth/reset', { email: 'tara@x.com', code, password: 'newpassword1' }, jar);
  assert.equal(ok.status, 200); assert.ok(jar.token, 'signed in after reset');
  assert.equal((await post('/auth/reset', { email: 'tara@x.com', code, password: 'another-pass1' })).status, 400, 'code is single use');
  const again = await post('/auth/login', { email: 'tara@x.com', password: 'newpassword1' }, {});
  assert.equal(again.status, 200, 'lockout cleared and new password works');
  assert.equal((await post('/auth/login', { email: 'tara@x.com', password: 'password123' }, {})).status, 401, 'old password no longer works');
});

test('settings come from the Config tab', async () => {
  const row = rt.state.sheets.Config.find((r) => r[0] === 'feePremium'); row[1] = '650';
  const upi = rt.state.sheets.Config.find((r) => r[0] === 'serviceUpi'); upi[1] = 'shop@upi';
  const me = (await get('/me', g2)).body;
  assert.equal(me.config.tiers.premium.fee, 650); assert.equal(me.config.serviceUpi, 'shop@upi');
  row[1] = '499';
});

test('web addresses are validated without the URL class', async () => {
  const mk = (url) => post('/item/save', { name: 'T', price: 10, url }, couple);
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.com/a', 'http://', 'https://bad host.com', 'http://user@evil.com']) assert.equal((await mk(bad)).status, 400, bad);
  assert.equal((await mk('HTTPS://Www.Example.COM/Path?x=1')).status, 200);
  const it = (await get('/registry/mine', couple)).body.items.find((i) => i.url.includes('example'));
  assert.equal(it.url, 'https://www.example.com/Path?x=1'); assert.equal(it.store, 'example.com');
});

test('a concurrent-looking double reservation: second one is refused', async () => {
  const gid = (await post('/item/save', { name: 'Kettle', price: 1500 }, couple)).body.id;
  const r1 = await post('/claim/create', { itemId: gid, delivery: 'self' }, g2);
  const r2 = await post('/claim/create', { itemId: gid, delivery: 'self' }, g3);
  assert.deepEqual([r1.status, r2.status], [200, 409]);
});

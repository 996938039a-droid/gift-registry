/**
 * Wedding Gift Registry: backend for Google Apps Script.
 *
 * Paste this whole file into the Apps Script editor of your Google Sheet
 * (Extensions > Apps Script), run setup() once, then deploy as a Web app.
 * The Sheet is the database. See README.md for the steps.
 */

/* ============================== schema ============================== */
var TABS = {
  Config: ['key', 'value', 'what it is'],
  Users: ['id', 'email', 'name', 'role', 'passHash', 'createdAt'],
  Registries: ['id', 'ownerId', 'slug', 'names', 'date', 'venue', 'city', 'upi', 'handoverNote', 'welcome', 'papers', 'hideBuyers', 'serviceEnabled', 'createdAt'],
  Items: ['id', 'registryId', 'kind', 'name', 'url', 'store', 'price', 'note', 'mode', 'organiserType', 'organiserId', 'organiserName', 'organiserUpi', 'groupName', 'status', 'createdAt'],
  Claims: ['id', 'itemId', 'registryId', 'guestId', 'guestName', 'groupName', 'members', 'delivery', 'status', 'orderRef', 'tier', 'paper', 'ribbon', 'card', 'fee', 'feeStatus', 'wrapStatus', 'createdAt', 'updatedAt'],
  Pledges: ['id', 'itemId', 'registryId', 'guestId', 'guestName', 'amount', 'anonymous', 'note', 'status', 'createdAt'],
  Messages: ['id', 'registryId', 'guestId', 'guestName', 'text', 'createdAt']
};
var CONFIG_ROWS = [
  ['serviceName', 'Gift Wrap Service', 'Name guests see for the wrapping service.'],
  ['serviceUpi', '', 'Your business UPI ID. Guests pay the wrap fee here. Fill this in.'],
  ['wrapPoint', '', 'Address where guests ship gifts to be wrapped. Fill this in.'],
  ['feeStandard', '299', 'Wrap fee in rupees for the Standard level.'],
  ['feePremium', '499', 'Wrap fee in rupees for the Premium level.']
];
var DROPDOWNS = { Claims: { feeStatus: ['unpaid', 'claimed', 'paid'], wrapStatus: ['pending', 'awaiting', 'received', 'wrapped', 'atvenue', 'handed'] } };
var PAPERS = { ivory: 'Ivory and gold', marigold: 'Marigold silk', midnight: 'Midnight stars', blush: 'Blush floral' };
var RIBBONS = { gold: 'Gold', red: 'Red', silver: 'Silver', sage: 'Sage' };
var CLAIM_ACTIVE = ['reserved', 'bought', 'received'];
var PLEDGE_ACTIVE = ['pledged', 'sent', 'confirmed'];
var TOKEN_DAYS = 14;
var HASH_ROUNDS = 40;

/* ============================== helpers ============================== */
function HttpError(status, message) { this.status = status; this.message = message; }
function fail(status, message) { throw new HttpError(status, message); }
function newId() { return Utilities.getUuid().replace(/-/g, '').slice(0, 16); }
function nowIso() { return new Date().toISOString(); }
function str(v, max, label) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/^\s+|\s+$/g, '');
  if (s.length > max) fail(400, (label || 'Text') + ' is too long (max ' + max + ' characters)');
  return s;
}
function req(v, max, label) { var s = str(v, max, label); if (!s) fail(400, (label || 'Field') + ' is required'); return s; }
function money(v, label) {
  var n = Math.round(Number(String(v).replace(/[^\d.]/g, '')));
  if (!isFinite(n) || n < 1 || n > 10000000) fail(400, (label || 'Amount') + ' must be between 1 and 10,000,000');
  return n;
}
function cleanUrl(v, label) {
  var s = str(v, 500, label); label = label || 'Link';
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9+.\-]*:/i.test(s) && !/^[^\s\/]+\.[a-z]{2,}(:\d+)?([\/?#]|$)/i.test(s)) fail(400, label + ' must start with http or https');
    s = 'https://' + s;
  }
  var m = s.match(/^(https?):\/\/([^\/?#\s@]+)([\/?#]\S*)?$/i);
  if (!m || !/^[A-Za-z0-9.\-]+(:\d{1,5})?$/.test(m[2]) || m[2].indexOf('.') < 0) fail(400, label + ' is not a valid web address');
  return m[1].toLowerCase() + '://' + m[2].toLowerCase() + (m[3] || '');
}
function hostOf(url) { var m = String(url).match(/^https?:\/\/([^\/?#:]+)/i); return m ? m[1].replace(/^www\./, '') : ''; }
function cleanUpi(v, required, label) {
  var s = str(v, 80, label || 'UPI ID'); label = label || 'UPI ID';
  if (!s) { if (required) fail(400, label + ' is required'); return ''; }
  if (!/^[A-Za-z0-9._\-]+@[A-Za-z][A-Za-z0-9]{1,}$/.test(s)) fail(400, label + ' looks wrong. It should look like name@bank');
  return s;
}
function isTrue(v) { return v === true || v === 'TRUE' || v === 'true'; }
function tf(v) { return v ? 'TRUE' : 'FALSE'; }
function slugify(s) { return String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'registry'; }
function byCreated(a, b) { return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : (a._row || 0) - (b._row || 0); }
function sum(arr, f) { var t = 0; for (var i = 0; i < arr.length; i++) t += Number(f(arr[i])) || 0; return t; }
function prop(k) { return PropertiesService.getScriptProperties().getProperty(k); }

/* ============================== crypto ============================== */
function toHex(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) { var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i]; s += (b < 16 ? '0' : '') + b.toString(16); } return s; }
function hmacHex(key, msg) { return toHex(Utilities.computeHmacSha256Signature(msg, key)); }
function safeEqual(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
// Salted, peppered, iterated HMAC-SHA256. The pepper lives in Script Properties, never in the Sheet,
// so a copy of the Users tab alone cannot be used to guess passwords offline.
function hashPassword(pw, salt) {
  salt = salt || newId();
  var pepper = prop('PEPPER'); if (!pepper) throw new Error('Run setup() first');
  var h = hmacHex(pepper, salt + ':' + pw);
  for (var i = 1; i < HASH_ROUNDS; i++) h = hmacHex(pepper, h + ':' + salt);
  return 'v1$' + salt + '$' + h;
}
function verifyPassword(pw, stored) {
  var dummy = 'v1$0000000000000000$' + new Array(65).join('0');
  var s = String(stored || '').split('$'), ok = s.length === 3 && s[0] === 'v1';
  var calc = hashPassword(pw, ok ? s[1] : '0000000000000000');
  return ok && safeEqual(calc, stored);
}
function signToken(user) {
  var payload = JSON.stringify({ sub: user.id, name: user.name, role: user.role, exp: Date.now() + TOKEN_DAYS * 86400000 });
  var body = Utilities.base64EncodeWebSafe(payload);
  return body + '.' + hmacHex(prop('JWT_SECRET'), body);
}
function readToken(token) {
  if (!token || typeof token !== 'string') return null;
  var p = token.split('.'); if (p.length !== 2) return null;
  if (!safeEqual(hmacHex(prop('JWT_SECRET'), p[0]), p[1])) return null;
  try {
    var o = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(p[0])).getDataAsString());
    if (!o.exp || o.exp < Date.now()) return null;
    return { id: o.sub, name: o.name, role: o.role };
  } catch (e) { return null; }
}
function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) fail(400, 'Password must be at least 8 characters');
  if (pw.length > 100) fail(400, 'Password is too long');
}
// Counts failures in the script cache; blocks for 15 minutes after max failures.
function throttle(key, max) {
  var cache = CacheService.getScriptCache(), n = Number(cache.get(key) || 0);
  if (n >= max) fail(429, 'Too many attempts. Please wait 15 minutes and try again.');
  return { bump: function () { cache.put(key, String(n + 1), 900); }, clear: function () { cache.remove(key); } };
}

/* ============================== storage (the Sheet) ============================== */
function norm(v) {
  if (v === null || v === undefined) return '';
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
  return String(v);
}
function openBook() {
  var id = prop('SHEET_ID');
  if (!id) throw new Error('Not set up. Run setup() from the Apps Script editor.');
  return SpreadsheetApp.openById(id);
}
function createStore() {
  var book = openBook(), memo = {};
  function sheet(tab) { var sh = book.getSheetByName(tab); if (!sh) throw new Error('Missing tab "' + tab + '". Run setup().'); return sh; }
  function read(tab) {
    if (memo[tab]) return memo[tab];
    var sh = sheet(tab), last = sh.getLastRow(), cols = Math.max(sh.getLastColumn(), TABS[tab].length);
    var vals = last < 1 ? [] : sh.getRange(1, 1, last, cols).getValues();
    var head = (vals[0] || []).map(norm), i;
    for (i = 0; i < TABS[tab].length; i++) if (head.indexOf(TABS[tab][i]) < 0) throw new Error('Tab "' + tab + '" is missing the column "' + TABS[tab][i] + '". Run setup().');
    var rows = [];
    for (var r = 1; r < vals.length; r++) {
      var o = { _row: r + 1 };
      for (var c = 0; c < head.length; c++) if (head[c]) o[head[c]] = norm(vals[r][c]);
      if (o.id || (tab === 'Config' && o.key)) rows.push(o);
    }
    memo[tab] = { head: head, rows: rows };
    return memo[tab];
  }
  function writeRow(tab, rowNum, head, obj) {
    var sh = sheet(tab);
    if (rowNum > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
    var rg = sh.getRange(rowNum, 1, 1, head.length);
    rg.setNumberFormat('@'); // plain text, so nothing is ever parsed as a number, date or formula
    rg.setValues([head.map(function (h) { return obj[h] === undefined || obj[h] === null ? '' : norm(obj[h]); })]);
  }
  return {
    readTabs: function (names) { var out = {}; names.forEach(function (n) { out[n] = read(n).rows; }); return out; },
    append: function (tab, obj) { var d = read(tab), sh = sheet(tab), row = Math.max(sh.getLastRow(), 1) + 1; writeRow(tab, row, d.head, obj); obj._row = row; d.rows.push(obj); },
    update: function (tab, rowNum, obj) { writeRow(tab, rowNum, read(tab).head, obj); }
  };
}
function getConfig(store) {
  var kv = {}; store.readTabs(['Config']).Config.forEach(function (r) { kv[r.key] = r.value; });
  var n = function (v, d) { return isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d; };
  return {
    serviceName: kv.serviceName || 'Gift Wrap Service', serviceUpi: kv.serviceUpi || '', wrapPoint: kv.wrapPoint || '',
    tiers: { standard: { name: 'Standard', fee: n(kv.feeStandard, 299), text: 'Wrapping paper, ribbon and a printed message card' }, premium: { name: 'Premium', fee: n(kv.feePremium, 499), text: 'Everything in Standard, a handwritten card and a keepsake box' } },
    papers: PAPERS, ribbons: RIBBONS
  };
}

/* ============================== business logic ============================== */
function needUser(c) { if (!c.user) fail(401, 'Please sign in'); return c.user; }
function needCouple(c) { var u = needUser(c); if (u.role !== 'couple') fail(403, 'Only couple accounts can do this'); return u; }
function publicUser(u) { return { id: u.id, name: u.name, role: u.role, email: u.email }; }
function myRegistry(c, db) { var u = needCouple(c); db = db || c.store.readTabs(['Registries']); return db.Registries.filter(function (r) { return r.ownerId === u.id; })[0] || null; }
function findReg(db, slug) { slug = String(slug || '').toLowerCase(); return db.Registries.filter(function (r) { return r.slug === slug; })[0]; }
function activeClaim(db, itemId) { return db.Claims.filter(function (x) { return x.itemId === itemId && CLAIM_ACTIVE.indexOf(x.status) >= 0; }).sort(byCreated)[0]; }
function itemPledges(db, itemId) { return db.Pledges.filter(function (p) { return p.itemId === itemId && PLEDGE_ACTIVE.indexOf(p.status) >= 0; }); }
function recipient(item, reg) { return item.organiserType === 'guest' ? { id: item.organiserId, upi: item.organiserUpi, name: item.organiserName } : { id: reg.ownerId, upi: reg.upi, name: reg.names }; }
function touch(cl, patch) { for (var k in patch) cl[k] = patch[k]; cl.updatedAt = nowIso(); }
function loadAll(c) { return c.store.readTabs(['Registries', 'Items', 'Claims', 'Pledges']); }
function loadItem(db, itemId, reg) {
  var it = db.Items.filter(function (i) { return i.id === itemId && (!reg || i.registryId === reg.id) && i.status !== 'removed'; })[0];
  if (!it) fail(404, 'Gift not found'); return it;
}
function regOf(db, item) { return db.Registries.filter(function (r) { return r.id === item.registryId; })[0]; }

function claimView(cl, viewer, isOwner, hide) {
  var mine = cl.guestId === viewer.id;
  if (isOwner || mine) return { id: cl.id, status: cl.status, mine: mine, by: cl.guestName, groupName: cl.groupName, members: cl.members, delivery: cl.delivery, tier: cl.tier, paper: cl.paper, ribbon: cl.ribbon, card: cl.card, fee: Number(cl.fee) || 0, feeStatus: cl.feeStatus, wrapStatus: cl.wrapStatus, orderRef: cl.orderRef, createdAt: cl.createdAt };
  return { status: cl.status, mine: false, by: hide ? null : cl.guestName, groupName: hide ? null : cl.groupName };
}
function shapeItems(reg, db, viewer, isOwner) {
  var hide = reg.hideBuyers === 'TRUE' && !isOwner;
  return db.Items.filter(function (i) { return i.registryId === reg.id && i.status !== 'removed'; }).sort(byCreated).map(function (i) {
    var cl = activeClaim(db, i.id), pl = itemPledges(db, i.id), rc = recipient(i, reg);
    var isRecipient = rc.id === viewer.id, seeAll = isOwner || isRecipient;
    return {
      id: i.id, kind: i.kind, name: i.name, url: i.url, store: i.store, price: Number(i.price) || 0, note: i.note, mode: i.mode, status: i.status,
      organiserType: i.organiserType, organiserName: i.organiserType === 'guest' ? i.organiserName : '', groupName: i.groupName,
      isOrganiser: i.organiserType === 'guest' && i.organiserId === viewer.id, isRecipient: isRecipient,
      payUpi: i.mode === 'group' ? rc.upi : '', payName: i.mode === 'group' ? rc.name : '',
      pledgedTotal: sum(pl, function (p) { return p.amount; }), confirmedTotal: sum(pl.filter(function (p) { return p.status === 'confirmed'; }), function (p) { return p.amount; }), pledgeCount: pl.length,
      pledges: pl.sort(byCreated).map(function (p) {
        var mine = p.guestId === viewer.id;
        return { id: p.id, amount: Number(p.amount) || 0, status: p.status, mine: mine, note: seeAll || mine ? p.note : '', name: seeAll || mine ? p.guestName : (p.anonymous === 'TRUE' || hide ? 'Anonymous' : p.guestName), anonymous: p.anonymous === 'TRUE' };
      }),
      claim: cl ? claimView(cl, viewer, isOwner, hide) : null
    };
  });
}
function regPublic(reg, isOwner) {
  var o = { id: reg.id, slug: reg.slug, names: reg.names, date: reg.date, venue: reg.venue, city: reg.city, welcome: reg.welcome, papers: reg.papers ? reg.papers.split(',').filter(Boolean) : [], serviceEnabled: reg.serviceEnabled === 'TRUE', isOwner: isOwner, handoverNote: reg.handoverNote };
  if (isOwner) { o.upi = reg.upi; o.hideBuyers = reg.hideBuyers === 'TRUE'; }
  return o;
}
function findUserByEmail(store, email) { return store.readTabs(['Users']).Users.filter(function (x) { return x.email === email; })[0]; }

var ROUTES = {
  /* ---------- auth ---------- */
  'POST /auth/signup': function (c) {
    var b = c.body, name = req(b.name, 80, 'Name'), email = req(b.email, 120, 'Email').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address');
    checkPassword(b.password);
    if (b.consent !== true) fail(400, 'Please agree to the privacy note to continue');
    if (findUserByEmail(c.store, email)) fail(409, 'An account with this email already exists. Please sign in.');
    var u = { id: newId(), email: email, name: name, role: b.role === 'couple' ? 'couple' : 'guest', passHash: hashPassword(b.password), createdAt: nowIso() };
    c.store.append('Users', u);
    return { body: { user: publicUser(u), token: signToken(u) } };
  },
  'POST /auth/login': function (c) {
    var email = str(c.body.email, 120).toLowerCase(), pw = typeof c.body.password === 'string' ? c.body.password : '';
    var t = throttle('login:' + email, 8), u = findUserByEmail(c.store, email);
    var ok = verifyPassword(pw, u && u.passHash);
    if (!u || !ok) { t.bump(); fail(401, 'Email or password is not correct'); }
    t.clear();
    return { body: { user: publicUser(u), token: signToken(u) } };
  },
  'POST /auth/logout': function () { return { body: { ok: true } }; },
  'POST /auth/forgot': function (c) { // emails a 6-digit code; the answer is the same whether or not the account exists
    var email = str(c.body.email, 120).toLowerCase(), cache = CacheService.getScriptCache(), generic = { body: { ok: true } };
    if (!email || cache.get('resetsent:' + email)) return generic;
    var u = findUserByEmail(c.store, email); if (!u) return generic;
    var code = String(1000000 + (parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 8), 16) % 900000)).slice(1);
    cache.put('reset:' + email, JSON.stringify({ h: hmacHex(prop('JWT_SECRET'), code + ':' + email), tries: 0 }), 900);
    cache.put('resetsent:' + email, '1', 60);
    try { MailApp.sendEmail(email, 'Your gift registry password reset code', 'Hello ' + u.name + ',\n\nYour code is ' + code + '. It works for 15 minutes.\nIf you did not ask for this, ignore this email.\n'); } catch (e) { console.error('Mail failed: ' + e.message); }
    return generic;
  },
  'POST /auth/reset': function (c) {
    var email = str(c.body.email, 120).toLowerCase(), code = str(c.body.code, 10), cache = CacheService.getScriptCache();
    checkPassword(c.body.password);
    var raw = cache.get('reset:' + email), st = raw ? JSON.parse(raw) : null, bad = 'That code is not correct or has expired. Ask for a new one.';
    if (!st) fail(400, bad);
    if (st.tries >= 5) { cache.remove('reset:' + email); fail(400, bad); }
    if (!safeEqual(hmacHex(prop('JWT_SECRET'), code + ':' + email), st.h)) { st.tries++; cache.put('reset:' + email, JSON.stringify(st), 900); fail(400, bad); }
    var u = findUserByEmail(c.store, email); if (!u) fail(400, bad);
    u.passHash = hashPassword(c.body.password); c.store.update('Users', u._row, u);
    cache.remove('reset:' + email); cache.remove('login:' + email);
    return { body: { user: publicUser(u), token: signToken(u) } };
  },
  'GET /me': function (c) {
    var cfg = getConfig(c.store), pub = { serviceName: cfg.serviceName, serviceUpi: cfg.serviceUpi, wrapPoint: cfg.wrapPoint, tiers: cfg.tiers, papers: cfg.papers, ribbons: cfg.ribbons };
    if (!c.user) return { body: { user: null, config: pub } };
    var registry = null;
    if (c.user.role === 'couple') { var r = myRegistry(c); if (r) registry = { slug: r.slug, names: r.names }; }
    return { body: { user: { id: c.user.id, name: c.user.name, role: c.user.role }, registry: registry, config: pub } };
  },

  /* ---------- couple: registry ---------- */
  'POST /registry/save': function (c) {
    var u = needCouple(c), b = c.body;
    var names = req(b.names, 100, 'Names'), date = str(b.date, 10, 'Date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'Choose the wedding date');
    var papers = (Array.isArray(b.papers) ? b.papers : []).filter(function (k) { return PAPERS[k]; });
    var patch = { names: names, date: date, venue: req(b.venue, 150, 'Venue'), city: str(b.city, 60, 'City'), upi: cleanUpi(b.upi, true, 'Your UPI ID'), handoverNote: str(b.handoverNote, 200, 'Handover note'), welcome: str(b.welcome, 400, 'Welcome note'), papers: (papers.length ? papers : Object.keys(PAPERS)).join(','), hideBuyers: tf(isTrue(b.hideBuyers)), serviceEnabled: tf(b.serviceEnabled !== false) };
    var db = c.store.readTabs(['Registries']), ex = db.Registries.filter(function (r) { return r.ownerId === u.id; })[0];
    if (ex) { for (var k in patch) ex[k] = patch[k]; c.store.update('Registries', ex._row, ex); return { body: { slug: ex.slug } }; }
    var reg = { id: newId(), ownerId: u.id, slug: slugify(names) + '-' + newId().slice(0, 4), createdAt: nowIso() };
    for (var k2 in patch) reg[k2] = patch[k2];
    c.store.append('Registries', reg);
    return { body: { slug: reg.slug } };
  },
  'GET /registry/mine': function (c) {
    var u = needCouple(c), db = c.store.readTabs(['Registries', 'Items', 'Claims', 'Pledges', 'Messages']);
    var reg = db.Registries.filter(function (r) { return r.ownerId === u.id; })[0];
    if (!reg) return { body: { registry: null } };
    return { body: { registry: regPublic(reg, true), items: shapeItems(reg, db, u, true), messages: db.Messages.filter(function (m) { return m.registryId === reg.id; }).sort(byCreated).reverse().map(function (m) { return { id: m.id, name: m.guestName, text: m.text, createdAt: m.createdAt }; }) } };
  },

  /* ---------- couple: items ---------- */
  'POST /item/save': function (c) {
    needCouple(c); var b = c.body, db = loadAll(c), reg = myRegistry(c, db);
    if (!reg) fail(400, 'Create your registry first');
    var kind = b.kind === 'cash' ? 'cash' : 'product';
    var fields = { name: req(b.name, 120, 'Name'), price: money(b.price, kind === 'cash' ? 'Target' : 'Price'), note: str(b.note, 200, 'Note') };
    if (kind === 'product') { fields.url = cleanUrl(b.url, 'Product link'); fields.store = fields.url ? hostOf(fields.url) : str(b.store, 60, 'Store'); } else { fields.url = ''; fields.store = ''; }
    if (b.id) {
      var it = loadItem(db, b.id, reg);
      for (var k in fields) it[k] = fields[k];
      if (it.organiserType !== 'guest' && kind === 'product') {
        var wantGroup = isTrue(b.group);
        if (wantGroup !== (it.mode === 'group')) {
          if (activeClaim(db, it.id)) fail(400, 'This gift already has a buyer. Release the reservation first.');
          if (it.mode === 'group' && itemPledges(db, it.id).length) fail(400, 'This group gift already has pledges, so it stays a group gift.');
          it.mode = wantGroup ? 'group' : 'single'; it.organiserType = wantGroup ? 'couple' : '';
        }
      }
      c.store.update('Items', it._row, it);
      return { body: { id: it.id } };
    }
    var group = kind === 'cash' || isTrue(b.group);
    var item = { id: newId(), registryId: reg.id, kind: kind, mode: group ? 'group' : 'single', organiserType: group ? 'couple' : '', organiserId: '', organiserName: '', organiserUpi: '', groupName: '', status: 'open', createdAt: nowIso() };
    for (var k2 in fields) item[k2] = fields[k2];
    c.store.append('Items', item);
    return { body: { id: item.id } };
  },
  'POST /item/remove': function (c) {
    needCouple(c); var db = loadAll(c), reg = myRegistry(c, db); if (!reg) fail(400, 'No registry');
    var it = loadItem(db, c.body.id, reg), cl = activeClaim(db, it.id);
    if (cl && cl.status !== 'reserved') fail(400, 'A guest has already bought this gift, so it cannot be removed.');
    if (itemPledges(db, it.id).some(function (p) { return p.status === 'confirmed' || p.status === 'sent'; })) fail(400, 'Guests have already sent money toward this, so it cannot be removed.');
    if (cl) { touch(cl, { status: 'void' }); c.store.update('Claims', cl._row, cl); }
    itemPledges(db, it.id).forEach(function (p) { p.status = 'void'; c.store.update('Pledges', p._row, p); });
    it.status = 'removed'; c.store.update('Items', it._row, it);
    return { body: { ok: true } };
  },
  'POST /item/status': function (c) {
    needCouple(c); var db = loadAll(c), reg = myRegistry(c, db); if (!reg) fail(400, 'No registry');
    var it = loadItem(db, c.body.id, reg);
    if (['open', 'bought'].indexOf(c.body.status) < 0) fail(400, 'Bad status');
    if (it.mode !== 'group') fail(400, 'Only group gifts and cash goals use this');
    it.status = c.body.status; c.store.update('Items', it._row, it);
    return { body: { ok: true } };
  },

  /* ---------- guest: view ---------- */
  'GET /registry/view': function (c) {
    var u = needUser(c), db = loadAll(c), reg = findReg(db, c.query.slug);
    if (!reg) fail(404, 'We could not find that registry. Check the link or code.');
    var isOwner = reg.ownerId === u.id;
    return { body: { registry: regPublic(reg, isOwner), items: shapeItems(reg, db, u, isOwner) } };
  },
  'GET /registry/peek': function (c) {
    var reg = findReg(c.store.readTabs(['Registries']), c.query.slug);
    if (!reg) fail(404, 'We could not find that registry. Check the link or code.');
    return { body: { names: reg.names, date: reg.date, city: reg.city } };
  },
  'GET /guest/mine': function (c) {
    var u = needUser(c), db = loadAll(c);
    var claims = db.Claims.filter(function (x) { return x.guestId === u.id && x.status !== 'void'; }).sort(byCreated).reverse().map(function (x) {
      var it = db.Items.filter(function (i) { return i.id === x.itemId; })[0], reg = db.Registries.filter(function (r) { return r.id === x.registryId; })[0];
      return { id: x.id, item: it ? it.name : '(removed gift)', price: it ? Number(it.price) : 0, slug: reg && reg.slug, names: reg && reg.names, venue: reg && reg.venue, date: reg && reg.date, handoverNote: reg && reg.handoverNote, status: x.status, delivery: x.delivery, groupName: x.groupName, members: x.members, tier: x.tier, paper: x.paper, ribbon: x.ribbon, card: x.card, fee: Number(x.fee) || 0, feeStatus: x.feeStatus, wrapStatus: x.wrapStatus, orderRef: x.orderRef };
    });
    var pledges = db.Pledges.filter(function (p) { return p.guestId === u.id && p.status !== 'void'; }).sort(byCreated).reverse().map(function (p) {
      var it = db.Items.filter(function (i) { return i.id === p.itemId; })[0], reg = db.Registries.filter(function (r) { return r.id === p.registryId; })[0], rc = it && reg ? recipient(it, reg) : {};
      return { id: p.id, item: it ? it.name : '(removed gift)', slug: reg && reg.slug, names: reg && reg.names, amount: Number(p.amount), status: p.status, payUpi: rc.upi, payName: rc.name, groupName: it && it.groupName };
    });
    var organised = db.Items.filter(function (i) { return i.organiserType === 'guest' && i.organiserId === u.id && i.status !== 'removed'; }).map(function (i) {
      var reg = db.Registries.filter(function (r) { return r.id === i.registryId; })[0];
      return { id: i.id, name: i.name, slug: reg && reg.slug, names: reg && reg.names, groupName: i.groupName, price: Number(i.price), pledgedTotal: sum(itemPledges(db, i.id), function (p) { return p.amount; }), bought: !!activeClaim(db, i.id) };
    });
    return { body: { claims: claims, pledges: pledges, organised: organised } };
  },

  /* ---------- guest: buying ---------- */
  'POST /claim/create': function (c) {
    var u = needUser(c), b = c.body, cfg = getConfig(c.store), db = loadAll(c);
    var it = loadItem(db, b.itemId), reg = regOf(db, it);
    if (reg.ownerId === u.id) fail(403, 'You cannot buy a gift from your own registry');
    if (it.kind !== 'product') fail(400, 'Cash goals are not bought. Use "Send cash".');
    if (activeClaim(db, it.id)) fail(409, 'Someone has already reserved this gift');
    if (it.mode === 'group' && !(it.organiserType === 'guest' && it.organiserId === u.id)) fail(403, it.organiserType === 'guest' ? 'Only the person organising this group gift can mark it as bought' : 'This is a group gift. Please pitch in instead.');
    var delivery = b.delivery === 'service' ? 'service' : 'self';
    var cl = { id: newId(), itemId: it.id, registryId: reg.id, guestId: u.id, guestName: u.name, groupName: str(b.groupName || (it.mode === 'group' ? it.groupName : ''), 80, 'Group name'), members: str(b.members, 200, 'Group members'), delivery: delivery, status: 'reserved', orderRef: '', tier: '', paper: '', ribbon: '', card: '', fee: '', feeStatus: '', wrapStatus: '', createdAt: nowIso(), updatedAt: nowIso() };
    if (delivery === 'service') {
      if (reg.serviceEnabled !== 'TRUE') fail(400, 'The couple has not enabled the gift-wrap service');
      var tier = cfg.tiers[b.tier] ? b.tier : 'standard';
      if (reg.papers.split(',').indexOf(b.paper) < 0) fail(400, 'Choose a wrapping paper');
      if (!RIBBONS[b.ribbon]) fail(400, 'Choose a ribbon');
      cl.tier = tier; cl.paper = b.paper; cl.ribbon = b.ribbon; cl.card = str(b.card, 140, 'Card message'); cl.fee = cfg.tiers[tier].fee; cl.feeStatus = 'unpaid'; cl.wrapStatus = 'pending';
    }
    c.store.append('Claims', cl); // the script lock means no one else can claim between the check above and this write
    return { body: { id: cl.id } };
  },
  'POST /claim/bought': function (c) {
    var u = needUser(c), cl = c.store.readTabs(['Claims']).Claims.filter(function (x) { return x.id === c.body.id && x.guestId === u.id; })[0];
    if (!cl) fail(404, 'Not found');
    if (cl.status !== 'reserved') fail(400, 'Already marked as bought');
    touch(cl, { status: 'bought', orderRef: str(c.body.orderRef, 80, 'Order reference'), wrapStatus: cl.delivery === 'service' ? 'awaiting' : '' });
    c.store.update('Claims', cl._row, cl); return { body: { ok: true } };
  },
  'POST /claim/cancel': function (c) {
    var u = needUser(c), cl = c.store.readTabs(['Claims']).Claims.filter(function (x) { return x.id === c.body.id && x.guestId === u.id; })[0];
    if (!cl) fail(404, 'Not found');
    if (cl.status !== 'reserved') fail(400, 'You have already bought this. Please contact the couple.');
    touch(cl, { status: 'cancelled' }); c.store.update('Claims', cl._row, cl); return { body: { ok: true } };
  },
  'POST /claim/feepaid': function (c) {
    var u = needUser(c), cl = c.store.readTabs(['Claims']).Claims.filter(function (x) { return x.id === c.body.id && x.guestId === u.id; })[0];
    if (!cl) fail(404, 'Not found');
    if (cl.delivery !== 'service' || cl.feeStatus !== 'unpaid') fail(400, 'Nothing to update');
    touch(cl, { feeStatus: 'claimed' }); c.store.update('Claims', cl._row, cl); return { body: { ok: true } };
  },
  'POST /claim/release': function (c) {
    needCouple(c); var db = loadAll(c), reg = myRegistry(c, db); if (!reg) fail(400, 'No registry');
    var cl = db.Claims.filter(function (x) { return x.id === c.body.id && x.registryId === reg.id; })[0]; if (!cl) fail(404, 'Not found');
    if (cl.status !== 'reserved') fail(400, 'Only reservations that are not yet bought can be released');
    touch(cl, { status: 'void' }); c.store.update('Claims', cl._row, cl); return { body: { ok: true } };
  },
  'POST /claim/received': function (c) {
    needCouple(c); var db = loadAll(c), reg = myRegistry(c, db); if (!reg) fail(400, 'No registry');
    var cl = db.Claims.filter(function (x) { return x.id === c.body.id && x.registryId === reg.id; })[0]; if (!cl) fail(404, 'Not found');
    if (cl.status !== 'bought') fail(400, 'Only bought gifts can be marked received');
    touch(cl, { status: 'received' }); c.store.update('Claims', cl._row, cl); return { body: { ok: true } };
  },

  /* ---------- group gifts ---------- */
  'POST /group/start': function (c) {
    var u = needUser(c), b = c.body, db = loadAll(c), it = loadItem(db, b.itemId), reg = regOf(db, it);
    if (reg.ownerId === u.id) fail(403, 'Use the group gift switch on your own gifts');
    if (it.kind !== 'product' || it.mode !== 'single') fail(400, 'This gift cannot become a group gift');
    if (activeClaim(db, it.id)) fail(409, 'Someone has already reserved this gift');
    it.mode = 'group'; it.organiserType = 'guest'; it.organiserId = u.id; it.organiserName = u.name; it.organiserUpi = cleanUpi(b.upi, true, 'Your UPI ID'); it.groupName = req(b.groupName, 80, 'Group name');
    c.store.update('Items', it._row, it); return { body: { ok: true } };
  },
  'POST /group/cancel': function (c) {
    var u = needUser(c), db = loadAll(c), it = loadItem(db, c.body.itemId);
    if (it.organiserType !== 'guest' || it.organiserId !== u.id) fail(403, 'Only the organiser can do this');
    if (itemPledges(db, it.id).length || activeClaim(db, it.id)) fail(400, 'Others have already pledged, so the group gift cannot be undone');
    it.mode = 'single'; it.organiserType = ''; it.organiserId = ''; it.organiserName = ''; it.organiserUpi = ''; it.groupName = '';
    c.store.update('Items', it._row, it); return { body: { ok: true } };
  },
  'POST /pledge/create': function (c) {
    var u = needUser(c), b = c.body, db = loadAll(c), it = loadItem(db, b.itemId), reg = regOf(db, it);
    if (reg.ownerId === u.id) fail(403, 'You cannot pledge to your own registry');
    if (it.mode !== 'group') fail(400, 'This is not a group gift');
    if (it.status === 'bought' || activeClaim(db, it.id)) fail(400, 'This gift has already been bought');
    var amount = money(b.amount, 'Amount'), total = sum(itemPledges(db, it.id), function (p) { return p.amount; }), target = Number(it.price);
    if (it.kind === 'product' && total + amount > target) fail(400, total >= target ? 'This gift is fully pledged' : 'Only ' + (target - total) + ' rupees are still needed');
    var p = { id: newId(), itemId: it.id, registryId: reg.id, guestId: u.id, guestName: u.name, amount: amount, anonymous: tf(isTrue(b.anonymous)), note: str(b.note, 200, 'Note'), status: 'pledged', createdAt: nowIso() };
    c.store.append('Pledges', p); return { body: { id: p.id } };
  },
  'POST /pledge/sent': function (c) {
    var u = needUser(c), p = c.store.readTabs(['Pledges']).Pledges.filter(function (x) { return x.id === c.body.id && x.guestId === u.id; })[0];
    if (!p) fail(404, 'Not found'); if (p.status !== 'pledged') fail(400, 'Already updated');
    p.status = 'sent'; c.store.update('Pledges', p._row, p); return { body: { ok: true } };
  },
  'POST /pledge/confirm': function (c) {
    var u = needUser(c), db = loadAll(c), p = db.Pledges.filter(function (x) { return x.id === c.body.id; })[0]; if (!p) fail(404, 'Not found');
    var it = db.Items.filter(function (i) { return i.id === p.itemId; })[0], reg = it && regOf(db, it);
    if (!it || !reg || recipient(it, reg).id !== u.id) fail(403, 'Only the person receiving this money can confirm it');
    if (['pledged', 'sent'].indexOf(p.status) < 0) fail(400, 'Already updated');
    p.status = 'confirmed'; c.store.update('Pledges', p._row, p); return { body: { ok: true } };
  },
  'POST /pledge/cancel': function (c) {
    var u = needUser(c), db = loadAll(c), p = db.Pledges.filter(function (x) { return x.id === c.body.id; })[0]; if (!p) fail(404, 'Not found');
    var it = db.Items.filter(function (i) { return i.id === p.itemId; })[0], reg = it && regOf(db, it), isRecipient = it && reg && recipient(it, reg).id === u.id;
    if (p.guestId !== u.id && !isRecipient) fail(403, 'Not allowed');
    if (p.status === 'confirmed') fail(400, 'This money is already confirmed as received');
    p.status = 'void'; c.store.update('Pledges', p._row, p); return { body: { ok: true } };
  },

  /* ---------- messages ---------- */
  'POST /message/create': function (c) {
    var u = needUser(c), db = c.store.readTabs(['Registries', 'Messages']), reg = findReg(db, c.body.slug);
    if (!reg) fail(404, 'Registry not found');
    if (reg.ownerId === u.id) fail(403, 'This is your own registry');
    if (db.Messages.filter(function (m) { return m.registryId === reg.id && m.guestId === u.id; }).length >= 3) fail(400, 'You have already left a few messages. Thank you!');
    c.store.append('Messages', { id: newId(), registryId: reg.id, guestId: u.id, guestName: u.name, text: req(c.body.text, 500, 'Message'), createdAt: nowIso() });
    return { body: { ok: true } };
  }
};

/* ============================== web app entry points ============================== */
function dispatch(request) {
  var method = request && request.method === 'POST' ? 'POST' : 'GET';
  var path = String((request && request.path) || ''), route = ROUTES[method + ' ' + path];
  if (!route) fail(404, 'Not found');
  var lock = null;
  if (method === 'POST') { lock = LockService.getScriptLock(); lock.waitLock(25000); } // one write at a time: no double-booking
  try {
    var body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
    var query = request.query && typeof request.query === 'object' ? request.query : {};
    var res = route({ user: readToken(request.token), body: body, query: query, store: createStore() });
    return { ok: true, status: 200, data: res.body };
  } finally { if (lock) lock.releaseLock(); }
}
function respond(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function doPost(e) {
  var out;
  try {
    var request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = dispatch(request);
  } catch (err) {
    if (err instanceof HttpError) out = { ok: false, status: err.status, error: err.message };
    else if (err instanceof SyntaxError) out = { ok: false, status: 400, error: 'Bad request' };
    else { console.error(err && err.stack ? err.stack : String(err)); out = { ok: false, status: 500, error: 'Something went wrong on our side. Please try again.' }; }
  }
  return respond(out);
}
function doGet() { return respond({ ok: true, status: 200, data: { service: 'Gift Registry API', ready: !!(prop('SHEET_ID') && prop('JWT_SECRET') && prop('PEPPER')) } }); }

/* ============================== one-time setup and self-test ============================== */
function onOpen() {
  try { SpreadsheetApp.getUi().createMenu('Gift Registry').addItem('Check setup', 'setup').addItem('Run self-test', 'selfTest').addToUi(); } catch (e) { /* not opened from the Sheet */ }
}
function setup() {
  var props = PropertiesService.getScriptProperties(), book = SpreadsheetApp.getActive(), log = [];
  if (!props.getProperty('SHEET_ID')) { props.setProperty('SHEET_ID', book.getId()); log.push('Linked to this Sheet.'); }
  ['JWT_SECRET', 'PEPPER'].forEach(function (k) { if (!props.getProperty(k)) { props.setProperty(k, newId() + newId() + newId() + newId()); log.push('Created secret ' + k + '.'); } });
  Object.keys(TABS).forEach(function (tab) {
    var sh = book.getSheetByName(tab), cols = TABS[tab].length;
    if (!sh) { sh = book.insertSheet(tab); log.push('Created tab ' + tab + '.'); }
    var head = sh.getLastRow() >= 1 ? sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), cols)).getValues()[0].map(norm) : [];
    if (!head.length || head.every(function (h) { return !h; })) { sh.getRange(1, 1, 1, cols).setNumberFormat('@').setValues([TABS[tab]]); log.push('Wrote headers for ' + tab + '.'); }
    else TABS[tab].forEach(function (h) { if (head.indexOf(h) < 0) throw new Error('Tab "' + tab + '" has headers that do not match. Missing "' + h + '". Delete the tab and run setup() again, or fix the header row.'); });
    sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), cols).setNumberFormat('@');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, cols).setFontWeight('bold').setBackground('#1F3864').setFontColor('#FFFFFF');
    var dd = DROPDOWNS[tab];
    if (dd) Object.keys(dd).forEach(function (col) { sh.getRange(2, TABS[tab].indexOf(col) + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(dd[col], true).setAllowInvalid(false).build()); });
  });
  var cfgSheet = book.getSheetByName('Config'), existing = {};
  var cfgRows = cfgSheet.getLastRow() >= 2 ? cfgSheet.getRange(2, 1, cfgSheet.getLastRow() - 1, 1).getValues() : [];
  cfgRows.forEach(function (r) { existing[norm(r[0])] = true; });
  CONFIG_ROWS.forEach(function (r) { if (!existing[r[0]]) { var row = Math.max(cfgSheet.getLastRow(), 1) + 1; cfgSheet.getRange(row, 1, 1, 3).setNumberFormat('@').setValues([r]); log.push('Added setting ' + r[0] + '.'); } });
  log.push('Setup finished. Next: Deploy > New deployment > Web app.');
  console.log(log.join('\n')); Logger.log(log.join('\n'));
  return log.join('\n');
}
// Run once from the editor to confirm the parts that depend on Google's behaviour.
function selfTest() {
  var out = [], book = SpreadsheetApp.openById(prop('SHEET_ID')), name = 'zz_selftest', sh = book.getSheetByName(name);
  function check(label, ok) { out.push((ok ? 'PASS ' : 'FAIL ') + label); }
  if (sh) book.deleteSheet(sh); sh = book.insertSheet(name);
  try {
    var tricky = ['=1+1', '+5', '-3', '@x', '00123', '3/14/2026', 'TRUE'];
    var rg = sh.getRange(1, 1, 1, tricky.length); rg.setNumberFormat('@'); rg.setValues([tricky]);
    var back = sh.getRange(1, 1, 1, tricky.length).getValues()[0].map(norm);
    check('text-looking input is stored as plain text', JSON.stringify(back) === JSON.stringify(tricky));
    var t0 = Date.now(), h = hashPassword('correct horse battery', 'abcdef0123456789'), ms = Date.now() - t0;
    check('password hash round trip (' + ms + ' ms per hash)', verifyPassword('correct horse battery', h) && !verifyPassword('wrong', h));
    var tok = signToken({ id: 'u1', name: 'T', role: 'guest' }), u = readToken(tok);
    check('session token round trip', !!u && u.id === 'u1');
    check('tampered token rejected', readToken(tok.slice(0, -2) + 'aa') === null);
    var cache = CacheService.getScriptCache(); cache.put('selftest', '1', 30);
    check('script cache works', cache.get('selftest') === '1');
    var lock = LockService.getScriptLock(); lock.waitLock(5000); lock.releaseLock(); check('script lock works', true);
    check('Sheet has all tabs', Object.keys(TABS).every(function (t) { return !!book.getSheetByName(t); }));
    var cfg = getConfig(createStore()); check('settings readable (fee ' + cfg.tiers.standard.fee + ')', cfg.tiers.standard.fee > 0);
  } catch (e) { out.push('FAIL unexpected error: ' + e.message); }
  book.deleteSheet(sh);
  var report = out.join('\n'); console.log(report); Logger.log(report); return report;
}

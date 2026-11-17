// A small local stand-in for the Google Apps Script services that Code.gs uses.
// Runs Code.gs unchanged. Used by the dev server and the tests. Not used in production.
const vm = require('vm'), fs = require('fs'), path = require('path'), crypto = require('crypto');

function createRuntime(opts) {
  opts = opts || {};
  const file = opts.file || null;
  const state = { sheets: {}, props: {}, mail: [], cache: new Map() };
  if (file && fs.existsSync(file)) { try { Object.assign(state, JSON.parse(fs.readFileSync(file, 'utf8')), { mail: [], cache: new Map() }); } catch (e) {} }
  const persist = () => { if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ sheets: state.sheets, props: state.props })); } };
  const toBytes = (v) => (typeof v === 'string' ? Array.from(Buffer.from(v, 'utf8')) : Array.from(v)).map((b) => (b > 127 ? b - 256 : b));
  const bufOf = (v) => Buffer.from(typeof v === 'string' ? Buffer.from(v, 'utf8') : v.map((b) => (b < 0 ? b + 256 : b)));
  const noop = () => proxy;
  const proxy = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : noop), apply: () => proxy });

  function sheetObj(name) {
    const data = () => state.sheets[name];
    const sh = {
      getName: () => name,
      getLastRow: () => { const d = data(); for (let i = d.length - 1; i >= 0; i--) if (d[i].some((c) => c !== '')) return i + 1; return 0; },
      getLastColumn: () => { const d = data(); let m = 0; d.forEach((r) => r.forEach((c, i) => { if (c !== '') m = Math.max(m, i + 1); })); return m; },
      getMaxRows: () => Math.max(data().length, 1000),
      insertRowsAfter: () => {},
      getRange: (r, c, nr, nc) => {
        nr = nr || 1; nc = nc || 1;
        const rg = {
          getValues: () => { const d = data(), out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((d[r - 1 + i] || [])[c - 1 + j]) === undefined ? '' : d[r - 1 + i][c - 1 + j]); out.push(row); } return out; },
          setValues: (vals) => { const d = data(); vals.forEach((row, i) => { while (d.length < r + i) d.push([]); row.forEach((v, j) => { const rr = d[r - 1 + i]; while (rr.length < c + j) rr.push(''); rr[c - 1 + j] = v; }); }); persist(); return rg; },
          setNumberFormat: () => rg, setFontWeight: () => rg, setBackground: () => rg, setFontColor: () => rg, setDataValidation: () => rg
        };
        return rg;
      },
      setFrozenRows: () => {}
    };
    return sh;
  }
  const book = {
    getId: () => 'MOCK_SHEET',
    getSheetByName: (n) => (state.sheets[n] ? sheetObj(n) : null),
    insertSheet: (n) => { state.sheets[n] = []; persist(); return sheetObj(n); },
    deleteSheet: (sh) => { delete state.sheets[sh.getName()]; persist(); }
  };
  const sandbox = {
    console, JSON, Math, Date, Object, Array, String, Number, Error, SyntaxError, isFinite, parseInt, RegExp,
    SpreadsheetApp: { getActive: () => book, openById: () => book, getUi: () => ({ createMenu: () => proxy }), newDataValidation: () => proxy },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in state.props ? state.props[k] : null), setProperty: (k, v) => { state.props[k] = v; persist(); } }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => { const e = state.cache.get(k); if (!e) return null; if (e.exp < Date.now()) { state.cache.delete(k); return null; } return e.v; },
      put: (k, v, ttl) => state.cache.set(k, { v, exp: Date.now() + (ttl || 600) * 1000 }),
      remove: (k) => state.cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    MailApp: { sendEmail: (to, subject, body) => state.mail.push({ to, subject, body }) },
    Logger: { log: () => {} },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ getContent: () => s, setMimeType() { return this; } }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      computeHmacSha256Signature: (v, key) => toBytes(crypto.createHmac('sha256', key).update(bufOf(typeof v === 'string' ? Array.from(Buffer.from(v, 'utf8')) : v)).digest()),
      base64EncodeWebSafe: (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : bufOf(v)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: (s) => toBytes(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: (v) => ({ getDataAsString: () => bufOf(typeof v === 'string' ? Array.from(Buffer.from(v, 'utf8')) : v).toString('utf8'), getBytes: () => toBytes(v) })
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });
  // pre-create the tabs the way a real Sheet would already have them
  if (!Object.keys(state.sheets).length) sandbox.setup();
  return {
    sandbox, state,
    // Send one request the way the browser does (one JSON text body) and parse the reply.
    get(request) { const out = sandbox.doGet({ parameter: { r: typeof request === 'string' ? request : JSON.stringify(request) } }); return JSON.parse(out.getContent()); },
    post(request) { const out = sandbox.doPost({ postData: { contents: typeof request === 'string' ? request : JSON.stringify(request) } }); return JSON.parse(out.getContent()); },
    get raw() { return state; }
  };
}
module.exports = { createRuntime };

(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var inr = function (n) { return "₹" + new Intl.NumberFormat("en-IN").format(Math.round(Number(n) || 0)); };
  var fmtDate = function (d) { if (!d) return ""; var x = new Date(d + "T00:00:00"); return isNaN(x) ? d : x.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); };
  var safeUrl = function (u) { return /^https?:\/\//i.test(u || "") ? u : ""; };
  var initials = function (n) { return String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join(""); };
  var HUES = ["#8E2C5B", "#2F6F8F", "#6A4C9C", "#B0612B", "#3B7A57", "#A13D63", "#4A5A9C", "#8A6A1F"];
  var hue = function (id) { var h = 0; String(id).split("").forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 997; }); return HUES[h % HUES.length]; };
  var PAPER = { ivory: { fill: "#F1E4BF", pat: "#C9971C" }, marigold: { fill: "#F2AE1B", pat: "#B86E00" }, midnight: { fill: "#2B2A5E", pat: "#B9B6F2" }, blush: { fill: "#F2C2CF", pat: "#C2456B" } };
  var RIBBON = { gold: "#C9971C", red: "#B3123F", silver: "#A9AFBC", sage: "#7D9A7A" };
  var WRAP_LABEL = { pending: "Not bought yet", awaiting: "Waiting for the gift to arrive", received: "Received at the wrapping point", wrapped: "Wrapped", atvenue: "Ready at the venue", handed: "Handed to the family" };
  var WRAP_STEPS = ["awaiting", "received", "wrapped", "atvenue", "handed"];
  var FEE_LABEL = { unpaid: "Fee not paid yet", claimed: "Fee marked as paid, being checked", paid: "Fee received" };

  var S = { me: null, cfg: null, reg: null, route: { name: "home" }, d: null, filter: "all", sheet: null, next: null, loading: false, err: "",
    auth: { mode: "login", role: "guest", name: "", email: "", password: "", consent: false, code: "" }, regForm: null, itemForm: blankItem(), code: "", msg: "" };
  function blankItem() { return { id: null, kind: "product", name: "", url: "", price: "", note: "", group: false }; }

  /* ---------- helpers ---------- */
  var toastTimer;
  function toast(msg, isErr) { var t = $("#toast"); t.textContent = msg; t.className = "toast show" + (isErr ? " err" : ""); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = "toast"; }, isErr ? 4200 : 2400); }
  var API_URL = (window.GR_API_URL || "").trim();
  var pending = 0;
  function tokenGet() { try { return localStorage.getItem("gr_token") || ""; } catch (e) { return S.tokenMem || ""; } }
  function tokenSet(t) { S.tokenMem = t; try { if (t) localStorage.setItem("gr_token", t); else localStorage.removeItem("gr_token"); } catch (e) { /* private mode: keep in memory */ } }
  function busy(d) { pending += d; document.body.classList.toggle("busy", pending > 0); }
  // One GET per call (?r=<json>): a plain GET needs no CORS preflight and Google lets any site read the reply.
  function api(path, body) {
    if (!API_URL) return Promise.reject(Object.assign(new Error("The site is not connected yet. Set the web app address in config.js."), { status: 0 }));
    var q = {}, i = path.indexOf("?");
    if (i >= 0) { new URLSearchParams(path.slice(i + 1)).forEach(function (v, k) { q[k] = v; }); path = path.slice(0, i); }
    var payload = { method: body === undefined ? "GET" : "POST", path: path, query: q, body: body === undefined ? {} : body, token: tokenGet() };
    var url = API_URL + (API_URL.indexOf("?") < 0 ? "?" : "&") + "r=" + encodeURIComponent(JSON.stringify(payload)) + "&_=" + Date.now();
    if (url.length > 7500) return Promise.reject(Object.assign(new Error("That is too much text to send at once. Please shorten it."), { status: 413 }));
    busy(1);
    return fetch(url, { method: "GET", redirect: "follow", cache: "no-store" }).then(function (r) {
      return r.text().then(function (t) {
        var j; try { j = JSON.parse(t); } catch (e) { throw Object.assign(new Error("The server sent an unexpected reply. If you just changed the script, redeploy it as a new version."), { status: 502 }); }
        if (!j.ok) { if (j.status === 401) tokenSet(""); throw Object.assign(new Error(j.error || "Request failed"), { status: j.status }); }
        if (j.data && j.data.token) { tokenSet(j.data.token); delete j.data.token; }
        return j.data;
      });
    }, function () { throw Object.assign(new Error("Could not reach the server. Check your connection. If it keeps happening, open /check.html on this site."), { status: 0 }); }).then(function (d) { busy(-1); return d; }, function (e) { busy(-1); throw e; });
  }
  function setPath(path, val) { var p = path.split("."), o = S; for (var i = 0; i < p.length - 1; i++) o = o[p[i]]; o[p[p.length - 1]] = val; }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function chip(t, c) { return '<span class="chip ' + (c || "") + '">' + esc(t) + "</span>"; }
  function tile(it) { return '<span class="tile" style="background:' + hue(it.id) + '" aria-hidden="true">' + esc(initials(it.name)) + "</span>"; }
  function pct(a, b) { return b ? Math.min(100, Math.round(a / b * 100)) : 0; }
  function bar(a, b) { var p = pct(a, b); return '<div class="bar" role="img" aria-label="' + p + ' percent"><i class="' + (p >= 100 ? "ok" : "") + '" style="width:' + p + '%"></i></div>'; }
  function field(label, id, bind, val, extra) { return '<div class="field"><label for="' + id + '">' + label + '</label><input class="input" id="' + id + '" data-bind="' + bind + '" value="' + esc(val) + '" ' + (extra || "") + "></div>"; }
  function giftSVG(paper, ribbon, msg) {
    var p = PAPER[paper] || PAPER.ivory, r = RIBBON[ribbon] || RIBBON.gold, dots = "", i, j;
    for (i = 0; i < 6; i++) for (j = 0; j < 4; j++) dots += '<circle cx="' + (34 + i * 22 + (j % 2) * 11) + '" cy="' + (100 + j * 20) + '" r="2.4" fill="' + p.pat + '" opacity=".75"/>';
    var words = String(msg || "Your message appears here").split(/\s+/), lines = [], cur = "";
    words.forEach(function (w) { if ((cur + " " + w).trim().length > 22) { if (cur) lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); });
    if (cur) lines.push(cur);
    var tsp = lines.slice(0, 7).map(function (l, k) { return '<tspan x="182" dy="' + (k ? 14 : 0) + '">' + esc(l) + "</tspan>"; }).join("");
    return '<svg viewBox="0 0 320 200" role="img" aria-label="Preview of the wrapped gift and its card"><rect x="20" y="78" width="140" height="102" rx="6" fill="' + p.fill + '" stroke="rgba(0,0,0,.18)"/>' + dots +
      '<rect x="14" y="62" width="152" height="24" rx="6" fill="' + p.fill + '" stroke="rgba(0,0,0,.18)"/><rect x="80" y="62" width="20" height="118" fill="' + r + '"/><rect x="20" y="122" width="140" height="16" fill="' + r + '"/>' +
      '<path d="M90 62 C60 24 36 46 62 60 Z" fill="' + r + '" stroke="rgba(0,0,0,.2)"/><path d="M90 62 C120 24 144 46 118 60 Z" fill="' + r + '" stroke="rgba(0,0,0,.2)"/><circle cx="90" cy="62" r="8" fill="' + r + '"/>' +
      '<path d="M96 64 C150 70 150 40 176 40" fill="none" stroke="' + r + '" stroke-width="2"/><rect x="172" y="34" width="140" height="150" rx="8" fill="#FFFDF7" stroke="rgba(0,0,0,.22)"/>' +
      '<text x="182" y="62" font-size="11" fill="#3A2F4A" font-family="Figtree, system-ui, sans-serif">' + tsp + "</text></svg>";
  }

  /* ---------- session and routing ---------- */
  function refreshMe() {
    return api("/me").then(function (j) { S.me = j.user; S.cfg = j.config; S.reg = j.registry || null; if (!j.user) tokenSet(""); });
  }
  function parse() {
    var h = (location.hash || "").replace(/^#\/?/, ""), p = h.split("/");
    var n = p[0] || "home";
    if (n === "r") return { name: "registry", slug: decodeURIComponent(p[1] || "") };
    if (n === "couple") return { name: "couple", tab: p[1] || "gifts" };
    if (n === "auth") return { name: "auth" };
    if (n === "mine") return { name: "mine" };
    if (n === "find") return { name: "home", find: true };
    return { name: "home" };
  }
  function route() {
    S.route = parse(); S.sheet = null; S.err = ""; S.d = null; closeSheetDom();
    var r = S.route;
    if (r.name === "auth") { if (S.me) return go("#/"); return render(); }
    if (r.name === "home" && !r.find && S.me && S.me.role === "couple") return go("#/couple");
    if (r.name === "couple" || r.name === "mine") { if (!S.me) { S.next = location.hash; return go("#/auth"); } if (r.name === "couple" && S.me.role !== "couple") return go("#/"); }
    window.scrollTo(0, 0);
    load();
  }
  function load(silent) {
    var r = S.route; if (r.name === "home" || r.name === "auth") return render();
    if (!silent) { S.loading = true; render(); }
    var p, fresh = silent ? (r.name === "registry" ? "&fresh=1" : "?fresh=1") : "";
    if (r.name === "couple") p = api("/registry/mine" + fresh).then(function (j) { S.d = j; if (j.registry) { var x = j.registry; S.regForm = { names: x.names, date: x.date, venue: x.venue, city: x.city, upi: x.upi, handoverNote: x.handoverNote, welcome: x.welcome, papers: x.papers.slice(), hideBuyers: x.hideBuyers, serviceEnabled: x.serviceEnabled }; } else if (!S.regForm) S.regForm = { names: "", date: "", venue: "", city: "", upi: "", handoverNote: "", welcome: "", papers: Object.keys(S.cfg.papers), hideBuyers: false, serviceEnabled: true }; });
    else if (r.name === "registry") p = S.me ? api("/registry/view?slug=" + encodeURIComponent(r.slug) + fresh).then(function (j) { S.d = j; }) : api("/registry/peek?slug=" + encodeURIComponent(r.slug)).then(function (j) { S.d = { peek: j }; });
    else p = api("/guest/mine" + fresh).then(function (j) { S.d = j; });
    return p.then(function () { S.loading = false; S.err = ""; render(); }, function (e) { S.loading = false; if (e.status === 401) { S.me = null; S.next = location.hash; return go("#/auth"); } S.err = e.message; S.d = null; render(); });
  }
  function reload(msg) { var y = window.scrollY; return load(true).then(function () { window.scrollTo(0, y); if (msg) toast(msg); if (S.sheet) renderSheet(); }); }
  function act(promise, msg) { return promise.then(function () { return reload(msg); }, function (e) { if (e.status === 401) { S.me = null; return go("#/auth"); } toast(e.message, true); if (e.status === 409) reload(); }); }

  /* ---------- views ---------- */
  function renderNav() {
    var h = "", r = S.route.name;
    if (!S.me) h = '<a href="#/auth">Sign in</a>';
    else {
      if (S.me.role === "couple") h += '<a href="#/couple"' + (r === "couple" ? ' aria-current="page"' : "") + ">My registry</a>";
      h += '<a href="#/find"' + (S.route.find ? ' aria-current="page"' : "") + ">Find registry</a>";
      h += '<a href="#/mine"' + (r === "mine" ? ' aria-current="page"' : "") + ">My gifts</a>";
      h += '<button data-act="logout">Sign out (' + esc(S.me.name.split(" ")[0]) + ")</button>";
    }
    $("#nav").innerHTML = h;
  }
  function render() {
    renderNav();
    var r = S.route.name, html;
    if (S.err) html = '<div class="narrow stack"><div class="notice err">' + esc(S.err) + '</div><a class="btn" href="#/">Back to start</a></div>';
    else if (r === "auth") html = viewAuth();
    else if (r === "home") html = viewHome();
    else if (S.loading || !S.d) html = '<p class="muted">Loading…</p>';
    else if (r === "couple") html = viewCouple();
    else if (r === "registry") html = viewRegistry();
    else if (r === "mine") html = viewMine();
    $("#app").innerHTML = html;
  }

  function viewHome() {
    var h = '<div class="narrow stack" style="gap:20px"><div class="stack"><h1>Wedding gifts, the way your guests want to give them</h1><p class="muted">Add gifts from any store, let friends chip in on bigger ones, and have gifts wrapped with a message and waiting at the venue.</p></div>';
    if (!S.me) h += '<div class="grid g2"><a class="btn primary block" href="#/auth" data-act="auth-couple">I am getting married</a><a class="btn block" href="#/auth" data-act="auth-guest">I am a guest</a></div><p class="small muted" style="text-align:center">Already have an account? <a href="#/auth" data-act="auth-login">Sign in</a></p>';
    h += '<div class="card stack"><h3>Have a registry link or code?</h3><div class="field"><label for="code">Link or code</label><input class="input" id="code" data-bind="code" value="' + esc(S.code) + '" placeholder="aarav-and-meera-1a2b"></div><button class="btn primary" data-act="open-code">Open registry</button></div></div>';
    return h;
  }
  function viewAuth() {
    var a = S.auth, signup = a.mode === "signup", forgot = a.mode === "forgot", reset = a.mode === "reset";
    if (forgot || reset) {
      var f = '<div class="narrow stack"><h1>' + (forgot ? "Forgot your password?" : "Choose a new password") + '</h1><p class="muted">' + (forgot ? "Enter your email. We will send a 6-digit code." : "Enter the code we emailed to " + esc(a.email) + ", then your new password.") + '</p><form class="card stack" data-form="' + a.mode + '" novalidate>';
      f += field("Email", "a-email", "auth.email", a.email, 'type="email" autocomplete="email" inputmode="email"');
      if (reset) f += field("6-digit code", "a-code", "auth.code", a.code, 'inputmode="numeric" autocomplete="one-time-code"') + field("New password (at least 8 characters)", "a-pw", "auth.password", a.password, 'type="password" autocomplete="new-password"');
      return f + '<div id="auth-err" class="notice err" style="display:none" role="alert"></div><button class="btn primary block" type="submit">' + (forgot ? "Send code" : "Save new password") + '</button><button class="btn quiet" type="button" data-act="auth-mode" data-id="login">Back to sign in</button></form></div>';
    }
    var h = '<div class="narrow stack"><h1>' + (signup ? "Create your account" : "Welcome back") + "</h1>" +
      '<div class="seg" role="group" aria-label="Sign in or sign up"><button data-act="auth-mode" data-id="login" aria-pressed="' + !signup + '">Sign in</button><button data-act="auth-mode" data-id="signup" aria-pressed="' + signup + '">Sign up</button></div>';
    h += '<form class="card stack" data-form="auth" novalidate>';
    if (signup) h += '<div class="field"><span class="lab">I am</span><div class="seg" role="group"><button type="button" data-act="auth-role" data-id="guest" aria-pressed="' + (a.role === "guest") + '">A guest</button><button type="button" data-act="auth-role" data-id="couple" aria-pressed="' + (a.role === "couple") + '">Getting married</button></div></div>' + field("Your name", "a-name", "auth.name", a.name, 'autocomplete="name"');
    h += field("Email", "a-email", "auth.email", a.email, 'type="email" autocomplete="email" inputmode="email"') + field("Password" + (signup ? " (at least 8 characters)" : ""), "a-pw", "auth.password", a.password, 'type="password" autocomplete="' + (signup ? "new-password" : "current-password") + '"');
    if (signup) h += '<label class="switch" style="align-items:flex-start"><input type="checkbox" data-check="auth.consent"' + (a.consent ? " checked" : "") + '><span class="small">I agree that my name and email are stored to run this registry, and that the couple (and the gift-wrap service, if I use it) can see my name, messages and orders.</span></label>';
    h += '<div id="auth-err" class="notice err" style="display:none" role="alert"></div><button class="btn primary block" type="submit">' + (signup ? "Create account" : "Sign in") + "</button>" + (signup ? "" : '<button class="btn quiet" type="button" data-act="auth-mode" data-id="forgot">Forgot password?</button>') + "</form></div>";
    return h;
  }

  /* couple dashboard */
  function viewCouple() {
    var d = S.d;
    if (!d.registry) return viewRegSetup(true);
    var t = S.route.tab, r = d.registry, items = d.items;
    var link = location.origin + "/#/r/" + r.slug;
    var bought = items.filter(function (i) { return i.claim && (i.claim.status === "bought" || i.claim.status === "received"); }).length;
    var pledged = items.reduce(function (a, i) { return a + i.pledgedTotal; }, 0);
    var orders = items.filter(function (i) { return i.claim && i.claim.delivery === "service"; }).length;
    var h = '<div class="stack" style="gap:20px"><div class="row"><div class="avatar" aria-hidden="true">' + esc(initials(r.names)) + '</div><div class="grow"><h1 style="font-size:26px">' + esc(r.names) + '</h1><p class="muted small">' + esc(fmtDate(r.date)) + " &middot; " + esc(r.venue) + "</p></div></div>" +
      '<div class="grid g4"><div class="kpi"><div class="v num">' + items.length + '</div><div class="l">gifts on the list</div></div><div class="kpi"><div class="v num">' + bought + '</div><div class="l">bought by guests</div></div><div class="kpi"><div class="v num">' + inr(pledged) + '</div><div class="l">pledged to group gifts and cash</div></div><div class="kpi"><div class="v num">' + orders + '</div><div class="l">gift-wrap orders</div></div></div>' +
      '<div class="card stack" style="gap:10px"><h3>Share with guests</h3><div class="notice small" id="share-text">' + esc(r.names) + " are getting married on " + esc(fmtDate(r.date)) + ". Here is our gift registry: " + esc(link) + '</div><div class="row wrap"><button class="btn" data-act="copy-share">Copy message</button><a class="btn" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=' + encodeURIComponent(r.names + " are getting married on " + fmtDate(r.date) + ". Here is our gift registry: " + link) + '">Share on WhatsApp</a><a class="btn quiet" href="#/r/' + esc(r.slug) + '">Preview as a guest</a></div></div>' +
      '<nav class="tabs" aria-label="Registry sections">' + [["gifts", "Gifts"], ["activity", "Activity"], ["settings", "Settings"]].map(function (x) { return '<a href="#/couple/' + x[0] + '"' + (t === x[0] ? ' aria-current="page"' : "") + ">" + x[1] + "</a>"; }).join("") + "</nav>";
    if (t === "settings") h += viewRegSetup(false); else if (t === "activity") h += viewActivity(); else h += viewCoupleGifts();
    return h + "</div>";
  }
  function viewRegSetup(isNew) {
    var f = S.regForm, cfg = S.cfg;
    var h = (isNew ? '<div class="narrow stack"><h1>Create your registry</h1><p class="muted">A few details so guests know where and when. You can change these later.</p>' : '<div class="stack">') +
      '<form class="card stack" data-form="registry" novalidate>' + field("Names of the couple", "r-names", "regForm.names", f.names, 'placeholder="Aarav &amp; Meera"') +
      '<div class="field"><label for="r-date">Wedding date</label><input class="input" id="r-date" type="date" data-bind="regForm.date" value="' + esc(f.date) + '"></div>' +
      field("Venue", "r-venue", "regForm.venue", f.venue, 'placeholder="Banquet hall name"') + field("City", "r-city", "regForm.city", f.city) +
      field("Your UPI ID, for cash gifts and group gifts", "r-upi", "regForm.upi", f.upi, 'placeholder="name@bank" autocapitalize="off"') +
      '<div class="field"><label for="r-wel">Welcome note for guests (optional)</label><textarea class="input" id="r-wel" maxlength="400" data-bind="regForm.welcome">' + esc(f.welcome) + "</textarea></div>" +
      '<label class="switch"><input type="checkbox" data-check="regForm.serviceEnabled"' + (f.serviceEnabled ? " checked" : "") + "> Let guests order the gift-wrap service</label>";
    if (f.serviceEnabled) h += '<div class="field"><span class="lab">Wrapping papers guests can choose</span><div class="chips">' + Object.keys(cfg.papers).map(function (k) { return '<button type="button" class="pick" data-act="toggle-paper" data-id="' + k + '" aria-pressed="' + (f.papers.indexOf(k) >= 0) + '"><span class="sw" style="background:' + PAPER[k].fill + '"></span>' + esc(cfg.papers[k]) + "</button>"; }).join("") + "</div></div>" + field("Handover at the venue (shown to guests)", "r-hand", "regForm.handoverNote", f.handoverNote, 'placeholder="Ready at the venue by 11 Feb, 6 pm"');
    h += '<label class="switch"><input type="checkbox" data-check="regForm.hideBuyers"' + (f.hideBuyers ? " checked" : "") + "> Keep it a surprise: hide who bought what from other guests</label>" +
      '<div id="reg-err" class="notice err" style="display:none" role="alert"></div><button class="btn primary" type="submit">' + (isNew ? "Create registry" : "Save settings") + "</button></form></div>";
    return h;
  }
  function claimLine(c) {
    var s = [];
    s.push(chip(c.status === "reserved" ? "Reserved, not bought yet" : c.status === "bought" ? "Bought" : "Received", c.status === "reserved" ? "warn" : "good"));
    if (c.delivery === "service") s.push(chip("Wrap service", "")), s.push(chip(WRAP_LABEL[c.wrapStatus] || c.wrapStatus, c.wrapStatus === "atvenue" || c.wrapStatus === "handed" ? "good" : "warn"));
    return s.join(" ");
  }
  function viewCoupleGifts() {
    var items = S.d.items, f = S.itemForm;
    var h = '<div class="stack"><div class="card stack"><h3>Add a gift</h3><div class="seg" role="group" aria-label="Kind of gift"><button data-act="item-kind" data-id="product" aria-pressed="' + (f.kind === "product") + '">Gift from a store</button><button data-act="item-kind" data-id="cash" aria-pressed="' + (f.kind === "cash") + '">Cash goal</button></div>' +
      '<form class="stack" data-form="item" novalidate>' + field(f.kind === "cash" ? "Goal name" : "Gift name", "i-name", "itemForm.name", f.name, 'placeholder="' + (f.kind === "cash" ? "Honeymoon fund" : "Air fryer, 5.5 L") + '"');
    if (f.kind === "product") h += field("Link to the product (any store)", "i-url", "itemForm.url", f.url, 'inputmode="url" autocapitalize="off" placeholder="https://www.amazon.in/..."');
    h += field(f.kind === "cash" ? "Target amount in rupees" : "Price in rupees", "i-price", "itemForm.price", f.price, 'inputmode="numeric"') + field("Note for guests (optional)", "i-note", "itemForm.note", f.note);
    if (f.kind === "product") h += '<label class="switch"><input type="checkbox" data-check="itemForm.group"' + (f.group ? " checked" : "") + "> Group gift: guests pitch in together</label>";
    h += '<div id="item-err" class="notice err" style="display:none" role="alert"></div><button class="btn primary" type="submit">Add to registry</button></form></div>';
    h += '<div class="stack" style="gap:10px"><h2>Your list</h2>' + (items.length ? items.map(coupleItem).join("") : '<p class="muted">No gifts yet. Add your first one above.</p>') + "</div></div>";
    return h;
  }
  function pledgeRows(i, canConfirm) {
    if (!i.pledges.length) return '<p class="small muted">No pledges yet.</p>';
    return i.pledges.map(function (p) {
      var cls = p.status === "confirmed" ? "good" : p.status === "sent" ? "warn" : "";
      var lab = p.status === "confirmed" ? "Received" : p.status === "sent" ? "Says sent" : "Pledged";
      return '<div class="pl"><span>' + esc(p.name) + (p.anonymous ? " (hidden from guests)" : "") + ' &middot; <b class="num">' + inr(p.amount) + "</b>" + (p.note ? ' <span class="muted">"' + esc(p.note) + '"</span>' : "") + "</span><span class=\"row\" style=\"gap:6px\">" + chip(lab, cls) +
        (canConfirm && p.status !== "confirmed" ? '<button class="btn small" data-act="confirm-pledge" data-id="' + p.id + '">Money received</button>' : "") + (canConfirm && p.status !== "confirmed" ? '<button class="btn small quiet danger" data-act="void-pledge" data-id="' + p.id + '">Remove</button>' : "") + "</span></div>";
    }).join("");
  }
  function coupleItem(i) {
    var h = '<div class="card stack" style="gap:10px"><div class="row" style="align-items:flex-start">' + tile(i) + '<div class="grow stack" style="gap:4px"><div class="row between wrap" style="gap:6px"><b style="overflow-wrap:anywhere">' + esc(i.name) + '</b><b class="num">' + inr(i.price) + '</b></div><div class="small muted">' + (i.kind === "cash" ? "Cash goal" : esc(i.store || "No link") + (safeUrl(i.url) ? ' &middot; <a href="' + esc(i.url) + '" target="_blank" rel="noopener noreferrer">open link</a>' : "")) + "</div>";
    if (i.mode === "group") h += bar(i.pledgedTotal, i.price) + '<div class="small num">' + inr(i.pledgedTotal) + " pledged of " + inr(i.price) + " &middot; " + inr(i.confirmedTotal) + " received" + (i.organiserType === "guest" ? " &middot; organised by " + esc(i.organiserName) + " (" + esc(i.groupName) + ")" : "") + "</div>";
    h += "</div></div>";
    if (i.claim) h += '<div class="stack" style="gap:6px"><div class="row wrap" style="gap:6px">' + claimLine(i.claim) + '</div><div class="small">From <b>' + esc(i.claim.by) + "</b>" + (i.claim.groupName ? " on behalf of " + esc(i.claim.groupName) : "") + (i.claim.members ? ' <span class="muted">(' + esc(i.claim.members) + ")</span>" : "") + (i.claim.card ? '<br>Card: "' + esc(i.claim.card) + '"' : "") + "</div><div class=\"row wrap\">" +
      (i.claim.status === "reserved" ? '<button class="btn small" data-act="release-claim" data-id="' + i.claim.id + '">Release reservation</button>' : "") + (i.claim.status === "bought" ? '<button class="btn small" data-act="claim-received" data-id="' + i.claim.id + '">Mark as received</button>' : "") + "</div></div>";
    else if (i.mode === "group") h += '<details class="more"' + (i.pledgeCount ? " open" : "") + "><summary>Pledges (" + i.pledgeCount + ")</summary>" + pledgeRows(i, i.organiserType !== "guest") + "</details>" + (i.organiserType !== "guest" ? '<div class="small muted">Guests send money to your UPI ID and tell us. Tap "Money received" when it arrives. You buy the gift yourselves.</div>' : "");
    h += '<div class="row wrap">';
    if (i.mode === "group" && i.organiserType !== "guest") h += '<button class="btn small" data-act="item-status" data-id="' + i.id + '" data-status="' + (i.status === "bought" ? "open" : "bought") + '">' + (i.status === "bought" ? "Reopen" : i.kind === "cash" ? "Close goal" : "Mark as bought") + "</button>" + (i.status === "bought" ? chip("Closed", "good") : "");
    h += '<button class="btn small" data-act="edit-item" data-id="' + i.id + '">Edit</button><button class="btn small quiet danger" data-act="remove-item" data-id="' + i.id + '">Remove</button></div></div>';
    return h;
  }
  function viewActivity() {
    var items = S.d.items, h = '<div class="stack">';
    var toConfirm = [];
    items.forEach(function (i) { if (i.mode === "group" && i.organiserType !== "guest") i.pledges.forEach(function (p) { if (p.status !== "confirmed") toConfirm.push({ i: i, p: p }); }); });
    h += '<div class="card stack"><h3>Money to confirm</h3>' + (toConfirm.length ? toConfirm.map(function (x) { return '<div class="pl"><span>' + esc(x.p.name) + " &middot; <b class=\"num\">" + inr(x.p.amount) + "</b> toward " + esc(x.i.name) + '</span><span class="row" style="gap:6px">' + chip(x.p.status === "sent" ? "Says sent" : "Pledged", x.p.status === "sent" ? "warn" : "") + '<button class="btn small" data-act="confirm-pledge" data-id="' + x.p.id + '">Money received</button></span></div>'; }).join("") : '<p class="small muted">Nothing waiting. When a guest says they sent money to your UPI, it appears here.</p>') + "</div>";
    var orders = items.filter(function (i) { return i.claim && i.claim.delivery === "service"; });
    h += '<div class="card stack"><h3>Gift-wrap orders</h3>' + (orders.length ? '<div class="tw"><table><thead><tr><th>Gift</th><th>From</th><th>Status</th></tr></thead><tbody>' + orders.map(function (i) { return "<tr><td>" + esc(i.name) + "</td><td>" + esc(i.claim.by) + "</td><td>" + esc(WRAP_LABEL[i.claim.wrapStatus] || "") + "</td></tr>"; }).join("") + "</tbody></table></div>" : '<p class="small muted">No guest has ordered gift wrapping yet.</p>') + "</div>";
    var buys = items.filter(function (i) { return i.claim; });
    h += '<div class="card stack"><h3>All gifts from guests</h3>' + (buys.length ? buys.map(function (i) { return '<div class="pl"><span>' + esc(i.name) + " from <b>" + esc(i.claim.by) + "</b>" + (i.claim.groupName ? " (" + esc(i.claim.groupName) + ")" : "") + "</span>" + claimLine(i.claim) + "</div>"; }).join("") : '<p class="small muted">Nothing yet.</p>') + "</div>";
    h += '<div class="card stack"><h3>Messages from guests</h3>' + (S.d.messages.length ? S.d.messages.map(function (m) { return '<div class="pl"><span><b>' + esc(m.name) + ":</b> " + esc(m.text) + "</span></div>"; }).join("") : '<p class="small muted">No messages yet.</p>') + "</div></div>";
    return h;
  }

  /* guest registry view */
  function stateOf(i) {
    if (i.claim) return i.claim.mine ? chip(i.claim.status === "reserved" ? "You reserved this" : "You bought this", "good") : chip(i.claim.status === "reserved" ? "Reserved" : "Bought", "warn");
    if (i.mode === "group") return i.status === "bought" ? chip("Fully funded and bought", "good") : chip("Group gift " + pct(i.pledgedTotal, i.price) + "%", "warn");
    return chip("Available", "");
  }
  function itemCard(i) {
    var mine = (i.claim && i.claim.mine) || i.isOrganiser || i.pledges.some(function (p) { return p.mine; });
    return '<button class="item' + (mine ? " mine" : "") + '" data-act="open-item" data-id="' + i.id + '">' + tile(i) + '<span class="stack" style="gap:6px"><span class="row between wrap" style="gap:6px"><span class="name">' + esc(i.name) + '</span><span class="price num">' + inr(i.price) + "</span></span><span class=\"meta\">" + (i.kind === "cash" ? "Cash gift by UPI" : esc(i.store || "")) + (i.note ? " &middot; " + esc(i.note) : "") + "</span>" + (i.mode === "group" ? bar(i.pledgedTotal, i.price) : "") + '<span class="row wrap" style="gap:6px">' + stateOf(i) + (i.groupName && i.mode === "group" ? chip(i.groupName, "") : "") + "</span></span></button>";
  }
  function viewRegistry() {
    var d = S.d;
    if (d.peek) return '<div class="narrow stack"><div class="card stack" style="text-align:center;align-items:center"><div class="avatar" aria-hidden="true">' + esc(initials(d.peek.names)) + "</div><h1>" + esc(d.peek.names) + '</h1><p class="muted">' + esc(fmtDate(d.peek.date)) + (d.peek.city ? " &middot; " + esc(d.peek.city) : "") + '</p><p class="small">Sign in or create a free guest account to see their gifts.</p></div><a class="btn primary block" href="#/auth" data-act="auth-guest-next">Sign in or sign up</a></div>';
    var r = d.registry, f = S.filter;
    var list = d.items.filter(function (i) { return f === "all" || (f === "open" && !i.claim && i.mode === "single") || (f === "group" && i.mode === "group" && i.kind === "product") || (f === "cash" && i.kind === "cash"); });
    var h = '<div class="narrow stack">';
    if (r.isOwner) h += '<div class="notice small"><b>This is how guests see your registry.</b> Manage gifts from <a href="#/couple">your dashboard</a>.</div>';
    h += '<div class="card stack" style="text-align:center;align-items:center;gap:10px"><div class="avatar" aria-hidden="true">' + esc(initials(r.names)) + '</div><h1 style="font-size:26px">' + esc(r.names) + '</h1><p class="muted small">' + esc(fmtDate(r.date)) + " &middot; " + esc(r.venue) + (r.city ? ", " + esc(r.city) : "") + "</p>" + (r.welcome ? '<p class="small">' + esc(r.welcome) + "</p>" : "") + '<p class="small muted">Buy a gift from its store, pitch in with friends, or send cash. ' + (r.serviceEnabled ? "You can also have it wrapped and kept ready at the venue." : "") + "</p></div>";
    h += '<div class="chips" role="group" aria-label="Filter gifts">' + [["all", "All"], ["open", "Available"], ["group", "Group gifts"], ["cash", "Cash"]].map(function (x) { return '<button class="pick" data-act="filter" data-id="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' + x[1] + "</button>"; }).join("") + "</div>";
    h += '<div class="stack" style="gap:10px">' + (list.length ? list.map(itemCard).join("") : '<p class="muted">Nothing here yet.</p>') + "</div>";
    if (!r.isOwner) h += '<div class="card stack"><h3>Leave a message for the couple</h3><div class="field"><label for="msg">Your message</label><textarea class="input" id="msg" maxlength="500" data-bind="msg">' + esc(S.msg) + '</textarea></div><button class="btn" data-act="send-message">Send message</button></div>';
    return h + "</div>";
  }

  /* my gifts */
  function viewMine() {
    var d = S.d, cfg = S.cfg;
    var h = '<div class="narrow stack"><h1>My gifts</h1><a class="btn" href="#/find">Open another registry</a>';
    h += "<h2>Gifts I am buying</h2>" + (d.claims.length ? d.claims.map(function (c) {
      var svc = c.delivery === "service";
      var s = '<div class="card stack" style="gap:10px"><div class="row between wrap" style="gap:6px"><b>' + esc(c.item) + '</b>' + chip(c.status === "reserved" ? "Reserved" : c.status === "bought" ? "Bought" : c.status === "received" ? "Received by the couple" : c.status, c.status === "reserved" ? "warn" : "good") + '</div><div class="small muted">For ' + esc(c.names) + (c.groupName ? " &middot; from " + esc(c.groupName) : "") + '</div><div class="row wrap">' + (c.status === "reserved" ? '<button class="btn primary small" data-act="claim-bought" data-id="' + c.id + '">I have bought it</button><button class="btn small quiet" data-act="claim-cancel" data-id="' + c.id + '">Cancel</button>' : "") + '<a class="btn small quiet" href="#/r/' + esc(c.slug) + '">Open registry</a></div>';
      if (svc) s += servicePanel(c);
      return s + "</div>";
    }).join("") : '<p class="muted">Nothing yet. Open a registry to pick a gift.</p>');
    h += "<h2>My pledges</h2>" + (d.pledges.length ? d.pledges.map(function (p) {
      return '<div class="card stack" style="gap:8px"><div class="row between wrap" style="gap:6px"><b>' + inr(p.amount) + " toward " + esc(p.item) + "</b>" + chip(p.status === "confirmed" ? "Received" : p.status === "sent" ? "Marked as sent" : "Pledged", p.status === "confirmed" ? "good" : p.status === "sent" ? "warn" : "") + '</div><div class="small muted">For ' + esc(p.names) + (p.groupName ? " &middot; group: " + esc(p.groupName) : "") + "</div>" +
        (p.status === "pledged" ? '<div class="notice small">Send ' + inr(p.amount) + " to <b>" + esc(p.payName) + "</b> at UPI <b>" + esc(p.payUpi) + '</b> from your own UPI app, then tap the button.</div><div class="row wrap"><button class="btn primary small" data-act="pledge-sent" data-id="' + p.id + '">I have sent it</button><button class="btn small quiet" data-act="pledge-cancel" data-id="' + p.id + '">Cancel pledge</button></div>' : "") + "</div>";
    }).join("") : '<p class="muted">No pledges.</p>');
    if (d.organised.length) h += "<h2>Group gifts I organise</h2>" + d.organised.map(function (o) { return '<div class="card stack" style="gap:8px"><b>' + esc(o.name) + '</b><div class="small muted">' + esc(o.groupName) + " &middot; for " + esc(o.names) + "</div>" + bar(o.pledgedTotal, o.price) + '<div class="small num">' + inr(o.pledgedTotal) + " pledged of " + inr(o.price) + (o.bought ? " &middot; bought" : "") + '</div><a class="btn small" href="#/r/' + esc(o.slug) + '">Manage pledges</a></div>'; }).join("");
    return h + "</div>";
  }
  function servicePanel(c) {
    var cfg = S.cfg, h = '<div class="notice stack" style="gap:8px"><b>Gift-wrap service (' + esc(cfg.tiers[c.tier] ? cfg.tiers[c.tier].name : c.tier) + ", " + inr(c.fee) + ")</b>";
    if (c.status === "reserved") h += '<span class="small">After you buy the gift, tap "I have bought it", then follow the steps below.</span>';
    h += '<div class="step ' + (c.status !== "reserved" ? "" : "") + '"><span class="n">1</span><span class="small">Have the store deliver the gift to: <b>' + esc(cfg.wrapPoint || "(address not set up yet)") + "</b>. Put the name <b>" + esc(c.names) + "</b> and reference <b>" + esc(c.id.slice(0, 6).toUpperCase()) + '</b> on the parcel.</span></div>' +
      '<div class="step ' + (c.feeStatus === "paid" ? "done" : "") + '"><span class="n">2</span><span class="small">Pay the service fee of ' + inr(c.fee) + " to <b>" + esc(cfg.serviceName) + "</b>, UPI <b>" + esc(cfg.serviceUpi || "(not set up yet)") + "</b>. " + chip(FEE_LABEL[c.feeStatus] || "", c.feeStatus === "paid" ? "good" : "warn") + "</span></div>" +
      (c.feeStatus === "unpaid" ? '<button class="btn small" data-act="fee-paid" data-id="' + c.id + '">I have paid the fee</button>' : "") +
      '<div class="step ' + (c.wrapStatus === "handed" || c.wrapStatus === "atvenue" ? "done" : "") + '"><span class="n">3</span><span class="small"><b>Status:</b> ' + esc(WRAP_LABEL[c.wrapStatus] || "") + (c.handoverNote ? "<br>" + esc(c.handoverNote) : "") + "</span></div>";
    h += '<div class="gift-preview">' + giftSVG(c.paper, c.ribbon, c.card) + "</div></div>";
    return h;
  }

  /* ---------- sheet (gift details) ---------- */
  function closeSheetDom() { $("#sheet").classList.remove("open"); $("#scrim").classList.remove("open"); $("#sheet").innerHTML = ""; }
  function openItem(id) { // refresh first so the guest never acts on stale state
    return load(true).then(function () { openItemNow(id); });
  }
  function openItemNow(id) {
    var i = findItem(id); if (!i) return toast("That gift is no longer on the list", true);
    S.sheet = { id: id, mode: i.mode === "group" ? "pledge" : "buy", deliv: "self", tier: "standard", paper: null, ribbon: "gold", card: "", onbehalf: false, groupName: "", members: "", gName: "", gUpi: "", amount: i.kind === "cash" ? 2000 : Math.min(1000, Math.max(100, i.price - i.pledgedTotal)), anon: false, note: "", orderRef: "", edit: null, buyNow: false };
    var allowed = S.d.registry.papers; S.sheet.paper = allowed[0] || "ivory";
    renderSheet();
  }
  function findItem(id) { return (S.d && S.d.items || []).filter(function (x) { return x.id === id; })[0]; }
  function closeSheet() { S.sheet = null; closeSheetDom(); }
  function serviceForm(s, r) {
    var cfg = S.cfg, h = '<div class="seg" role="group" aria-label="Service level">' + Object.keys(cfg.tiers).map(function (k) { return '<button data-act="s-set" data-key="tier" data-id="' + k + '" aria-pressed="' + (s.tier === k) + '">' + esc(cfg.tiers[k].name) + " " + inr(cfg.tiers[k].fee) + "</button>"; }).join("") + '</div><p class="small muted">' + esc(cfg.tiers[s.tier].text) + ".</p>" +
      '<div class="lab">Wrapping paper</div><div class="chips">' + r.papers.map(function (k) { return '<button class="pick" data-act="s-set" data-key="paper" data-id="' + k + '" aria-pressed="' + (s.paper === k) + '"><span class="sw" style="background:' + PAPER[k].fill + '"></span>' + esc(cfg.papers[k]) + "</button>"; }).join("") + "</div>" +
      '<div class="lab">Ribbon</div><div class="chips">' + Object.keys(cfg.ribbons).map(function (k) { return '<button class="pick" data-act="s-set" data-key="ribbon" data-id="' + k + '" aria-pressed="' + (s.ribbon === k) + '"><span class="sw" style="background:' + RIBBON[k] + '"></span>' + esc(cfg.ribbons[k]) + "</button>"; }).join("") + "</div>" +
      '<div class="field"><label for="s-card">Message on the card (140 characters)</label><textarea class="input" id="s-card" maxlength="140" data-bind="sheet.card" data-preview="1">' + esc(s.card) + '</textarea></div><div class="gift-preview" id="gift-preview">' + giftSVG(s.paper, s.ribbon, s.card) + "</div>" +
      '<p class="small muted">' + esc(r.handoverNote || "We keep it ready at the venue before the wedding.") + "</p>";
    return h;
  }
  function buyForm(i, s, r) {
    var h = '<div class="stack" style="gap:14px"><div class="step"><span class="n">1</span><div class="stack" style="gap:8px"><b>Buy it at ' + esc(i.store || "the store") + '</b><p class="small muted">You pay the store at its own checkout. We never see your payment.</p>' + (safeUrl(i.url) ? '<a class="btn" href="' + esc(i.url) + '" target="_blank" rel="noopener noreferrer">Open the store (new tab)</a>' : "") + "</div></div>" +
      '<div class="step"><span class="n">2</span><div class="stack" style="gap:10px"><b>How should it reach the couple?</b><div class="seg" role="group" aria-label="Delivery"><button data-act="s-set" data-key="deliv" data-id="self" aria-pressed="' + (s.deliv === "self") + '">I will give it myself</button>' + (r.serviceEnabled ? '<button data-act="s-set" data-key="deliv" data-id="service" aria-pressed="' + (s.deliv === "service") + '">Wrapped and kept at the venue</button>' : "") + "</div>";
    if (s.deliv === "service") h += serviceForm(s, r);
    if (!i.isOrganiser) {
      h += '<label class="switch"><input type="checkbox" data-check="sheet.onbehalf"' + (s.onbehalf ? " checked" : "") + "> I am buying this on behalf of a group</label>";
      if (s.onbehalf) h += field("Group name", "s-gn", "sheet.groupName", s.groupName, 'placeholder="College friends"') + field("Who is in the group? (only the couple sees this)", "s-mem", "sheet.members", s.members, 'placeholder="Tara, Imran, Sana"');
    }
    h += "</div></div>" +
      '<div class="step"><span class="n">3</span><div class="stack" style="gap:8px"><b>Reserve it so nobody else buys it</b><button class="btn primary" data-act="reserve">' + (i.isOrganiser ? "We have bought it: reserve" : "Reserve this gift") + '</button><p class="small muted">After buying, come back and tap "I have bought it".</p></div></div></div>';
    return h;
  }
  function pledgeForm(i, s) {
    var left = i.kind === "product" ? i.price - i.pledgedTotal : null, sug = [500, 1000, 2000, 5000].filter(function (a) { return left === null || a <= left; });
    var h = '<div class="stack" style="gap:12px">' + bar(i.pledgedTotal, i.price) + '<div class="row between small"><span class="num"><b>' + inr(i.pledgedTotal) + "</b> pledged</span><span class=\"num muted\">" + (i.kind === "cash" ? "goal " : "target ") + inr(i.price) + "</span></div>";
    if (i.groupName) h += '<div class="notice small">Group: <b>' + esc(i.groupName) + "</b>, organised by <b>" + esc(i.organiserName) + "</b>" + (i.isOrganiser ? " (you)" : "") + ". " + (i.isOrganiser ? "Friends pay you by UPI. You buy the gift." : "Pay your share to the organiser by UPI, then they buy the gift.") + "</div>";
    else if (i.kind === "product") h += '<div class="notice small">Everyone pays their share by UPI to the couple, who buy the gift themselves.</div>';
    h += '<div class="card stack" style="gap:2px">' + (i.pledges.length ? i.pledges.map(function (p) { return '<div class="pl"><span>' + esc(p.name) + (p.mine ? " (you)" : "") + (p.note && (i.isOrganiser || p.mine) ? ' <span class="muted">"' + esc(p.note) + '"</span>' : "") + ' &middot; <b class="num">' + inr(p.amount) + "</b></span><span class=\"row\" style=\"gap:6px\">" + chip(p.status === "confirmed" ? "Received" : p.status === "sent" ? "Says sent" : "Pledged", p.status === "confirmed" ? "good" : p.status === "sent" ? "warn" : "") + (i.isOrganiser && p.status !== "confirmed" ? '<button class="btn small" data-act="confirm-pledge" data-id="' + p.id + '">Money received</button>' : "") + (p.mine && p.status === "pledged" ? '<button class="btn small" data-act="pledge-sent" data-id="' + p.id + '">I have sent it</button>' : "") + (p.mine && p.status !== "confirmed" ? '<button class="btn small quiet" data-act="pledge-cancel" data-id="' + p.id + '">Cancel</button>' : "") + "</span></div>"; }).join("") : '<p class="small muted">Be the first to pitch in.</p>') + "</div>";
    if (left !== null && left <= 0) return h + '<div class="notice small">Fully pledged.</div></div>';
    h += '<div class="field"><span class="lab">Your ' + (i.kind === "cash" ? "gift" : "share") + '</span><div class="chips">' + sug.map(function (a) { return '<button class="pick num" data-act="s-set" data-key="amount" data-id="' + a + '" aria-pressed="' + (Number(s.amount) === a) + '">' + inr(a) + "</button>"; }).join("") + "</div></div>" +
      '<div class="field"><label for="s-amt">Amount in rupees</label><input class="input num" id="s-amt" inputmode="numeric" data-bind="sheet.amount" value="' + esc(s.amount) + '"></div>' +
      '<label class="switch"><input type="checkbox" data-check="sheet.anon"' + (s.anon ? " checked" : "") + "> Hide my name from other guests</label>" + field("Note (optional)", "s-note", "sheet.note", s.note) +
      '<button class="btn primary" data-act="pledge">Pledge ' + inr(s.amount) + '</button><p class="small muted">To pay: send the money from your own UPI app to <b>' + esc(i.payName) + "</b> at <b>" + esc(i.payUpi) + "</b>, then tap \"I have sent it\" on your pledge. This site never handles the money.</p></div>";
    return h;
  }
  function sheetHTML() {
    var s = S.sheet; if (!s) return "";
    var h = '<div class="grab"></div><div class="row between" style="margin-bottom:10px"><span></span><button class="btn small quiet" data-act="close-sheet">Close</button></div>';
    if (s.edit) return h + editForm(s);
    var i = findItem(s.id); if (!i) return h + "<p>This gift is no longer available.</p>";
    var r = S.d.registry;
    h += '<div class="stack" style="gap:16px"><div class="row" style="align-items:flex-start">' + tile(i) + '<div class="grow stack" style="gap:4px"><h2>' + esc(i.name) + '</h2><div class="small muted">' + inr(i.price) + (i.store ? " &middot; " + esc(i.store) : "") + "</div>" + (i.note ? '<div class="small">' + esc(i.note) + "</div>" : "") + '<div class="row wrap" style="gap:6px">' + stateOf(i) + "</div></div></div>";
    if (r.isOwner) return h + '<div class="notice small">This is your own registry. Manage this gift from your dashboard.</div></div>';
    var c = i.claim;
    if (c && c.mine) {
      h += '<div class="card stack" style="gap:10px"><b>' + (c.status === "reserved" ? "You have reserved this gift" : "Thank you, you bought this gift") + "</b>" +
        (c.status === "reserved" ? '<div class="field"><label for="s-ord">Order reference from the store (optional)</label><input class="input" id="s-ord" data-bind="sheet.orderRef" value="' + esc(s.orderRef) + '"></div><button class="btn primary" data-act="sheet-bought" data-id="' + c.id + '">I have bought it</button><button class="btn quiet" data-act="sheet-cancel" data-id="' + c.id + '">Cancel my reservation</button>' : "") +
        (c.groupName ? '<div class="small muted">Credited to: ' + esc(c.groupName) + "</div>" : "") + "</div>";
      if (c.delivery === "service") h += servicePanel({ id: c.id, tier: c.tier, fee: c.fee, feeStatus: c.feeStatus, wrapStatus: c.wrapStatus, paper: c.paper, ribbon: c.ribbon, card: c.card, status: c.status, names: r.names, handoverNote: r.handoverNote });
      else h += '<div class="notice small">You are giving this gift yourself. Please bring it to the wedding or deliver it to the couple.</div>';
      return h + "</div>";
    }
    if (c) return h + '<div class="notice">' + (c.status === "reserved" ? "Someone has reserved this gift" : "This gift has been bought") + (c.by ? " (" + esc(c.by) + (c.groupName ? ", " + esc(c.groupName) : "") + ")" : "") + ". Pick another gift or pitch in on a group gift.</div></div>";
    if (i.mode === "group") {
      if (i.isOrganiser) {
        h += pledgeForm(i, s) + '<div class="card stack" style="gap:10px"><h3>Ready to buy it?</h3><p class="small muted">When enough has been received, buy the gift and reserve it here.</p>' + (s.buyNow ? buyForm(i, s, r) : '<button class="btn" data-act="s-set" data-key="buyNow" data-id="true">Buy it for the group</button>') + (i.pledgeCount === 0 ? '<button class="btn quiet danger" data-act="group-cancel">Stop organising this group gift</button>' : "") + "</div>";
        return h + "</div>";
      }
      return h + pledgeForm(i, s) + "</div>";
    }
    h += '<div class="seg" role="group" aria-label="How do you want to give?"><button data-act="s-set" data-key="mode" data-id="buy" aria-pressed="' + (s.mode === "buy") + '">I will buy it</button><button data-act="s-set" data-key="mode" data-id="group" aria-pressed="' + (s.mode === "group") + '">Start a group gift</button></div>';
    if (s.mode === "group") h += '<div class="stack" style="gap:10px"><p class="small muted">You organise: friends pledge their share and pay you by UPI, then you buy the gift. Other guests will see the group name.</p>' + field("Group name", "s-g", "sheet.gName", s.gName, 'placeholder="Office friends"') + field("Your UPI ID, so friends can pay you", "s-u", "sheet.gUpi", s.gUpi, 'placeholder="name@bank" autocapitalize="off"') + '<button class="btn primary" data-act="group-start">Start group gift</button></div>';
    else h += buyForm(i, s, r);
    return h + "</div>";
  }
  function editForm(s) {
    var f = s.edit, i = findItem(s.id), guestOrg = i && i.organiserType === "guest";
    return '<form class="stack" data-form="edit" novalidate><h2>Edit gift</h2>' + field("Name", "e-name", "sheet.edit.name", f.name) + (f.kind === "product" ? field("Link", "e-url", "sheet.edit.url", f.url, 'inputmode="url" autocapitalize="off"') : "") + field("Price in rupees", "e-price", "sheet.edit.price", f.price, 'inputmode="numeric"') + field("Note", "e-note", "sheet.edit.note", f.note) +
      (f.kind === "product" && !guestOrg ? '<label class="switch"><input type="checkbox" data-check="sheet.edit.group"' + (f.group ? " checked" : "") + "> Group gift</label>" : "") +
      '<div id="edit-err" class="notice err" style="display:none" role="alert"></div><button class="btn primary" type="submit">Save</button></form>';
  }
  function renderSheet() {
    var sh = $("#sheet"), st = sh.scrollTop;
    if (!S.sheet) return closeSheetDom();
    sh.innerHTML = sheetHTML(); sh.classList.add("open"); $("#scrim").classList.add("open"); sh.scrollTop = st;
  }

  /* ---------- events ---------- */
  function showErr(id, msg) { var e = $("#" + id); if (e) { e.textContent = msg; e.style.display = "block"; } else toast(msg, true); }
  function doReserve() {
    var s = S.sheet, i = findItem(s.id), body = { itemId: i.id, delivery: s.deliv };
    if (s.deliv === "service") { body.tier = s.tier; body.paper = s.paper; body.ribbon = s.ribbon; body.card = s.card; }
    if (s.onbehalf) { body.groupName = s.groupName; body.members = s.members; }
    return act(api("/claim/create", body), "Reserved. Now buy it from the store.");
  }
  document.addEventListener("click", function (e) {
    if (e.target.id === "scrim") return closeSheet();
    var el = e.target.closest("[data-act]"); if (!el) return;
    var a = el.getAttribute("data-act"), id = el.getAttribute("data-id"), s = S.sheet, i;
    if (el.tagName === "INPUT") return;
    var simple = { "claim-bought": ["/claim/bought", "Marked as bought"], "claim-cancel": ["/claim/cancel", "Reservation cancelled"], "fee-paid": ["/claim/feepaid", "Thanks, we will check the payment"], "pledge-sent": ["/pledge/sent", "Marked as sent"], "pledge-cancel": ["/pledge/cancel", "Pledge cancelled"], "confirm-pledge": ["/pledge/confirm", "Marked as received"], "void-pledge": ["/pledge/cancel", "Pledge removed"], "release-claim": ["/claim/release", "Reservation released"], "claim-received": ["/claim/received", "Marked as received"] };
    if (simple[a]) return act(api(simple[a][0], { id: id }), simple[a][1]);
    switch (a) {
      case "logout": tokenSet(""); S.me = null; S.reg = null; S.auth.mode = "login"; S.regForm = null; S.itemForm = blankItem(); return refreshMe().then(function () { go("#/"); });
      case "auth-couple": S.auth.mode = "signup"; S.auth.role = "couple"; return;
      case "auth-guest": case "auth-guest-next": S.auth.mode = "signup"; S.auth.role = "guest"; if (a === "auth-guest-next") S.next = location.hash; return;
      case "auth-login": S.auth.mode = "login"; return;
      case "auth-mode": S.auth.mode = id; return render();
      case "auth-role": S.auth.role = id; return render();
      case "open-code": { var v = S.code.trim(), m = v.match(/#\/r\/([^/?#\s]+)/); v = m ? m[1] : v.replace(/^.*\//, ""); if (!v) return toast("Enter a link or code", true); return go("#/r/" + encodeURIComponent(v.toLowerCase())); }
      case "toggle-paper": { var p = S.regForm.papers, k = p.indexOf(id); if (k >= 0) { if (p.length === 1) return toast("Keep at least one paper", true); p.splice(k, 1); } else p.push(id); return render(); }
      case "copy-share": try { navigator.clipboard.writeText($("#share-text").textContent).then(function () { toast("Copied"); }, function () { toast("Copy is blocked. Select the text and copy it.", true); }); } catch (x) { toast("Copy is blocked. Select the text and copy it.", true); } return;
      case "item-kind": S.itemForm.kind = id; return render();
      case "edit-item": i = findItem(id); S.sheet = { id: id, edit: { id: i.id, kind: i.kind, name: i.name, url: i.url, price: String(i.price), note: i.note, group: i.mode === "group" } }; return renderSheet();
      case "remove-item": if (!confirm("Remove this gift from your registry?")) return; return act(api("/item/remove", { id: id }), "Removed");
      case "item-status": return act(api("/item/status", { id: id, status: el.getAttribute("data-status") }), "Updated");
      case "filter": S.filter = id; return render();
      case "open-item": return openItem(id);
      case "close-sheet": return closeSheet();
      case "s-set": s[el.getAttribute("data-key")] = (id === "true" ? true : id); if (el.getAttribute("data-key") === "amount") s.amount = Number(id); return renderSheet();
      case "reserve": return doReserve();
      case "sheet-bought": return act(api("/claim/bought", { id: id, orderRef: s.orderRef }), "Marked as bought. Thank you!");
      case "sheet-cancel": return act(api("/claim/cancel", { id: id }), "Reservation cancelled");
      case "group-start": return act(api("/group/start", { itemId: s.id, groupName: s.gName, upi: s.gUpi }), "Group gift started");
      case "group-cancel": return act(api("/group/cancel", { itemId: s.id }), "Group gift stopped").then(function () { if (S.sheet) { S.sheet.mode = "buy"; renderSheet(); } });
      case "pledge": return act(api("/pledge/create", { itemId: s.id, amount: s.amount, anonymous: s.anon, note: s.note }), "Pledge saved. Now send it by UPI and tap 'I have sent it'.");
      case "send-message": return api("/message/create", { slug: S.route.slug, text: S.msg }).then(function () { S.msg = ""; render(); toast("Message sent"); }, function (x) { toast(x.message, true); });
    }
  });
  document.addEventListener("input", function (e) {
    var t = e.target, b = t.getAttribute && t.getAttribute("data-bind"); if (!b) return;
    setPath(b, t.value);
    if (t.getAttribute("data-preview") && S.sheet) { var g = $("#gift-preview"); if (g) g.innerHTML = giftSVG(S.sheet.paper, S.sheet.ribbon, S.sheet.card); }
    if (b === "sheet.amount") { var btn = $('[data-act="pledge"]'); if (btn) btn.textContent = "Pledge " + inr(t.value); }
  });
  document.addEventListener("change", function (e) {
    var t = e.target, c = t.getAttribute && t.getAttribute("data-check"); if (!c) return;
    setPath(c, t.checked);
    if (c === "sheet.onbehalf" || c === "sheet.anon") renderSheet();
    if (c === "regForm.serviceEnabled") render();
  });
  document.addEventListener("submit", function (e) {
    var form = e.target.getAttribute("data-form"); if (!form) return; e.preventDefault();
    if (form === "forgot" || form === "reset") {
      var a2 = S.auth; ["email", "password", "code"].forEach(function (k) { var el = $("#a-" + (k === "password" ? "pw" : k)); if (el) a2[k] = el.value; });
      if (form === "forgot") return api("/auth/forgot", { email: a2.email }).then(function () { a2.mode = "reset"; render(); toast("If that email has an account, a code is on its way."); }, function (x) { showErr("auth-err", x.message); });
      return api("/auth/reset", { email: a2.email, code: a2.code, password: a2.password }).then(function () { a2.password = ""; a2.code = ""; a2.mode = "login"; return refreshMe(); }).then(function () { toast("Password changed. You are signed in."); go(S.me.role === "couple" ? "#/couple" : "#/"); }, function (x) { showErr("auth-err", x.message); });
    }
    if (form === "auth") {
      var a = S.auth; ["name", "email", "password", "code"].forEach(function (k) { var el = $("#a-" + (k === "password" ? "pw" : k)); if (el) a[k] = el.value; });
      var body = a.mode === "signup" ? { name: a.name, email: a.email, password: a.password, role: a.role, consent: a.consent } : { email: a.email, password: a.password };
      return api(a.mode === "signup" ? "/auth/signup" : "/auth/login", body).then(function () { a.password = ""; a.mode = "login"; return refreshMe(); }).then(function () { var n = S.next; S.next = null; go(n || (S.me.role === "couple" ? "#/couple" : "#/")); }, function (x) { showErr("auth-err", x.message); });
    }
    if (form === "registry") {
      return api("/registry/save", S.regForm).then(function () { return refreshMe(); }).then(function () { toast("Saved"); if (S.route.tab === "settings") return load(true); go("#/couple/gifts"); }, function (x) { showErr("reg-err", x.message); });
    }
    if (form === "item") {
      return api("/item/save", S.itemForm).then(function () { S.itemForm = blankItem(); return reload("Gift added"); }, function (x) { showErr("item-err", x.message); });
    }
    if (form === "edit") {
      return api("/item/save", S.sheet.edit).then(function () { closeSheet(); return reload("Saved"); }, function (x) { showErr("edit-err", x.message); });
    }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && S.sheet) closeSheet(); });
  window.addEventListener("hashchange", route);
  refreshMe().then(route, function (e) { renderNav(); $("#app").innerHTML = '<div class="narrow notice err">' + esc(e.message) + "</div>"; });
})();

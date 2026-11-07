/* Change Check — app logic.
   Data is saved on the device (localStorage) as one clean record per check,
   shaped so it can be sent to Supabase later without restructuring. */
(function () {
  "use strict";

  const D = window.CC_DATA;
  const KEY = "changecheck.v1";
  const DAY = 86400000;
  const WORDS = ["NO", "PARTLY", "YES"];          // index = points
  const ANSWER = ["No", "Partly", "Yes"];
  const DEMO = new URLSearchParams(location.search).has("demo");
  // Organization from the link (…/?org=img). Only codes listed in data.js count.
  const LINK_ORG = (() => { const c = (new URLSearchParams(location.search).get("org") || "").trim().toLowerCase(); return D.ORGANIZATIONS[c] ? c : null; })();

  /* ---------- Storage ---------- */
  // account = who signed up (first/last name, email, gender, age bracket); signedIn = signed in on this device.
  // startDate = workshop day (when they committed to their first action); firstAction = that first action, kept for the dashboard.
  // records = the checks (Week 2, 4, 6); action = the current action.
  // dirty = the account/action has changes not yet saved to Supabase (each check has its own "synced").
  function fresh() { return { version: 2, records: [], action: null, firstAction: null, startDate: null, demoOffsetDays: 0, homeTipDismissed: false, account: null, signedIn: false, dirty: false }; }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      // Version 1 had a check on day 0; that test data doesn't fit the Week 2/4/6 programme, so start clean.
      return s && s.version === 2 ? Object.assign(fresh(), s) : fresh();
    }
    catch (e) { return fresh(); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* storage full or blocked */ } }
  let store = load();

  const now = () => Date.now() + (store.demoOffsetDays || 0) * DAY;
  // The coach's organization: saved on their account once signed up, otherwise the one in the link.
  const orgCode = () => (store.account && store.account.org) || LINK_ORG;
  const startsAtWeek2 = () => { const o = D.ORGANIZATIONS[orgCode()]; return !!(o && o.startAtWeek2); };

  /* ---------- Supabase: login with a 6-digit email code, and saving ----------
     Project "Coaching Starts With You". The publishable key is meant to be public: what each coach can
     read or write is enforced by the database's security rules (each coach only sees their own rows).
     Emails go out through Resend (team@mail.coaching-startswithyou.com). The "Confirm signup" and
     "Magic Link" email templates show {{ .Token }}, so people get a code, not a link. */
  const SUPABASE_URL = "https://guwjgnvqygnxlpltmvop.supabase.co";
  const SUPABASE_KEY = "sb_publishable_HTh_pjczopYxfFSl7pzvyQ_4keK6ChT";
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  // Supabase's error → words a coach understands.
  function authError(err, fallback) {
    const m = ((err && (err.code || "") + " " + (err.message || "")) || "").toLowerCase();
    if (/signup.*not allowed|otp_disabled|user not found/.test(m))
      return "We couldn't find an account with this email. Check it, or go back and sign up.";
    if (/rate|too many|429|seconds/.test(m)) return "Too many tries. Wait a minute, then try again.";
    if (/fetch|network|failed to|load failed/.test(m)) return "No connection. Check your signal and try again.";
    if (/expired|invalid|otp/.test(m)) return "That code didn't work or has expired. Check it, or send a new code.";
    return fallback;
  }

  const Auth = {
    // Sign up: creates the login (the sign-up details ride along, so they're never lost).
    // Sign in: shouldCreateUser false, so a code only goes to emails that already signed up.
    async sendCode(email, isNew) {
      const options = { shouldCreateUser: isNew };
      if (isNew) options.data = signupProfile();
      try {
        const { error } = await sb.auth.signInWithOtp({ email, options });
        return error ? { error: authError(error, "We couldn't send the code. Try again in a moment.") } : {};
      } catch (e) { return { error: authError(e, "No connection. Check your signal and try again.") }; }
    },
    async verifyCode(email, code) {
      try {
        const { data, error } = await sb.auth.verifyOtp({ email, token: code, type: "email" });
        if (error || !data.session) return { error: authError(error, "That code didn't work. Check it and try again.") };
        return { user: data.session.user };
      } catch (e) { return { error: authError(e, "No connection. Check your signal and try again.") }; }
    }
  };
  // What the sign-up form becomes on the account.
  function signupProfile() {
    const s = ui.su;
    return { firstName: s.first.trim(), lastName: s.last.trim(), gender: s.gender, ageBracket: s.age,
      org: LINK_ORG, orgName: LINK_ORG ? D.ORGANIZATIONS[LINK_ORG].name : null };
  }

  /* ---------- Sync with Supabase ----------
     The phone keeps working from its own copy (store), so the app still works with no signal.
     Changes are marked (store.dirty for the profile, record.synced = false for a check) and pushed
     by pushAll(), which runs after every change, when the app opens and when the signal comes back.
     Pushes are "upserts" (insert or replace by id), so sending the same thing twice is harmless. */
  const iso = t => (t ? new Date(t).toISOString() : null);
  function profileRow(uid, email) {
    const a = store.account, f = store.firstAction, c = store.action;
    return {
      id: uid, email: a.email || email, first_name: a.firstName, last_name: a.lastName,
      gender: a.gender, age_bracket: a.ageBracket, org: a.org || null, org_name: a.orgName || null,
      start_date: iso(store.startDate),
      first_action_when: f ? f.when : null, first_action_will: f ? f.will : null, first_action_date: f ? iso(f.date) : null,
      current_action_when: c ? c.when : null, current_action_will: c ? c.will : null, current_action_date: c ? iso(c.date) : null
    };
  }
  function checkRow(uid, r) {
    const a = r.action || {};
    return {
      id: r.id, user_id: uid, checkpoint: r.checkpoint, checked_at: iso(r.date),
      q1: r.answers[0], q2: r.answers[1], q3: r.answers[2], q4: r.answers[3], q5: r.answers[4],
      score: r.score, max_score: r.max || 10, status: r.status, abc: r.abc || D.STATUS[r.status].abc,
      roadblock: r.roadblock || null,
      action_when: a.when || null, action_will: a.will || null, action_choice: a.choice || null,
      action_changed: a.changed == null ? null : !!a.changed
    };
  }
  let pushing = null;
  // Push everything not yet saved. Returns true when nothing is left waiting.
  function pushAll() {
    if (pushing) return pushing;
    pushing = (async () => {
      try {
        const { data } = await sb.auth.getSession();
        const user = data.session && data.session.user;
        if (!user) return false;
        if (!store.account) return true;   // logged in but nothing on this phone yet: nothing to push
        if (store.dirty) {
          const { error } = await sb.from("profiles").upsert(profileRow(user.id, user.email));
          if (error) return false;
          store.dirty = false; save();
        }
        for (const r of store.records.filter(r => !r.synced)) {
          const { error } = await sb.from("checks").upsert(checkRow(user.id, r));
          if (error) return false;
          r.synced = true; save();
        }
        return true;
      } catch (e) { return false; }      // offline: try again later
      finally { pushing = null; }
    })();
    return pushing;
  }
  // Load this coach's account, action and checks from Supabase into the phone's copy.
  // Returns "ok", "new" (logged in but no profile saved yet) or "offline".
  async function pullAll(user) {
    try {
      const [p, c] = await Promise.all([
        sb.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        sb.from("checks").select("*").eq("user_id", user.id).order("checked_at", { ascending: true })
      ]);
      if (p.error || c.error) return "offline";
      if (!p.data) return "new";
      const P = p.data;
      // Start from a clean copy, so a previous person's data on this phone never mixes in.
      const keep = { demoOffsetDays: store.demoOffsetDays, homeTipDismissed: store.homeTipDismissed };
      store = Object.assign(fresh(), keep, {
        signedIn: true, dirty: false,
        account: { email: P.email, firstName: P.first_name, lastName: P.last_name, gender: P.gender, ageBracket: P.age_bracket,
          org: P.org, orgName: P.org_name, createdAt: P.created_at },
        startDate: P.start_date,
        firstAction: P.first_action_when ? { when: P.first_action_when, will: P.first_action_will, date: P.first_action_date } : null,
        action: P.current_action_when ? { when: P.current_action_when, will: P.current_action_will, date: P.current_action_date } : null,
        records: c.data.map(R => {
          const answers = [R.q1, R.q2, R.q3, R.q4, R.q5];
          return { id: R.id, checkpoint: R.checkpoint, date: R.checked_at, answers, score: R.score, max: R.max_score,
            status: R.status, abc: R.abc, roadblock: R.roadblock, tips: tipsFor(answers), synced: true,
            action: R.action_when ? { when: R.action_when, will: R.action_will, choice: R.action_choice, changed: R.action_changed } : undefined };
        })
      });
      save();
      return "ok";
    } catch (e) { return "offline"; }
  }
  // App opens: still logged in? Push anything waiting, then refresh from Supabase (picks up another phone's checks).
  async function syncOnOpen() {
    let user = null;
    try { const { data } = await sb.auth.getSession(); user = data.session && data.session.user; } catch (e) { /* offline */ }
    if (!user) {
      // The login has gone (signed out, or data from the old test mode): sign in again; the phone's copy stays until then.
      if (store.signedIn) { store.signedIn = false; save(); if (ui.view === "home" || ui.view === "landing") go("landing"); }
      return;
    }
    if (!(await pushAll())) return;      // something still waiting (offline): keep the phone's copy as it is
    const before = JSON.stringify(store);
    if ((await pullAll(user)) === "ok" && JSON.stringify(store) !== before && (ui.view === "home" || ui.view === "landing")) render();
  }
  window.addEventListener("online", () => pushAll());

  /* ---------- UI state (not saved) ---------- */
  const ui = {
    // ?start in the address shows the first page even when signed up (for previewing it).
    // Signed in but no action yet (closed the app after the code): straight back to writing it
    // (organization that starts at Week 2: back to the first page, where BEGIN opens the Week 2 check).
    view: new URLSearchParams(location.search).has("start") || !store.signedIn ? "landing"
      : store.action ? "home" : startsAtWeek2() ? "landing" : "action",
    q: 0, answers: [null, null, null, null, null], actExOpen: false,
    when: "", will: "", result: null,
    // Sign up / sign in
    authMode: "signup", su: { first: "", last: "", email: "", gender: null, age: null }, siEmail: "",
    code: "", authErr: "", authBusy: false, resentAt: 0,
    tab: "see", chip: null, popup: null, gateway: false, readyShown: false
  };

  /* ---------- Helpers ---------- */
  const $app = document.getElementById("app");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sum = a => a.reduce((s, v) => s + v, 0);

  // Status comes from question 04 (followed through on my action?): Yes = A, Partly = B, No = C.
  function statusFor(ans) {
    if (ans[3] === 2) return "owning";
    if (ans[3] === 1) return "renting";
    return "notstarted";
  }
  function tipsFor(ans) {
    return ans.map((v, i) => ({ i, v })).filter(x => x.v < 2)
      .sort((a, b) => a.v - b.v || a.i - b.i).slice(0, 2).map(x => x.i);
  }
  function roadblockFor(ans) {
    let best = null, most = 0;
    D.ROADBLOCK_RULES.forEach(rule => {
      const missing = rule.questions.reduce((s, i) => s + (2 - ans[i]), 0);
      if (missing > most) { most = missing; best = rule.key; }
    });
    return best;
  }
  function whyLine(rec) {
    const rule = D.ROADBLOCK_RULES.find(r => r.key === rec.roadblock);
    if (!rule) return "";
    const low = rule.questions.filter(i => rec.answers[i] < 2);
    const byWord = {};
    low.forEach(i => { const w = ANSWER[rec.answers[i]]; (byWord[w] = byWord[w] || []).push(i + 1); });
    const parts = Object.keys(byWord).map(w => {
      const n = byWord[w];
      return w + " to question" + (n.length > 1 ? "s " + n.slice(0, -1).join(", ") + " and " + n[n.length - 1] : " " + n[0]);
    });
    return "Why this came up: you answered " + parts.join(" and ") + ".";
  }

  /* Programme timing: every check counts from workshop day (startDate). */
  function nextCheck() {
    const i = store.records.length;
    if (!store.startDate || i >= D.CHECKPOINTS.length) return null;
    const start = new Date(store.startDate).getTime();
    const due = start + D.CHECKPOINTS[i].day * DAY;
    const prevDay = i ? D.CHECKPOINTS[i - 1].day : 0;
    const span = (D.CHECKPOINTS[i].day - prevDay) * DAY;
    const left = Math.max(0, Math.ceil((due - now()) / DAY));
    const elapsed = Math.min(1, Math.max(0, (now() - (start + prevDay * DAY)) / span));
    return { cp: D.CHECKPOINTS[i], due: now() >= due, left, elapsed };
  }
  const complete = () => store.records.length >= D.CHECKPOINTS.length;

  /* ---------- Small view parts (DailyXcellence kit classes: dx-…) ---------- */
  const svg = (d, w = 2, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    back: svg('<path d="M15 6l-6 6 6 6"/>'),
    down: svg('<path d="M6 9l6 6 6-6"/>'),
    x: svg('<path d="M6 6l12 12M18 6L6 18"/>', 2.2),
    plus: svg('<path d="M12 5v14M5 12h14"/>', 2.4, 18),
    lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 2.4, 16)
  };
  // Two dots per answer: No = both grey, Partly = one black, Yes = both black.
  const dots = p => `<span class="cc-dots" role="img" aria-label="${ANSWER[p]}"><i${p > 0 ? ' class="on"' : ""}></i><i${p > 1 ? ' class="on"' : ""}></i></span>`;

  function smallRing(value, frac, sub, label) {
    const C = 2 * Math.PI * 50, off = C * (1 - Math.max(0, Math.min(1, frac)));
    return `<svg viewBox="0 0 112 112" width="88" height="88" role="img" aria-label="${esc(label)}">
      <circle class="cc-track" cx="56" cy="56" r="50" fill="none" stroke-width="7"/>
      <circle class="cc-arc" cx="56" cy="56" r="50" fill="none" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 56 56)"/>
      <text class="cc-ring-v" x="56" y="62" text-anchor="middle">${value}</text><text class="cc-ring-o" x="56" y="80" text-anchor="middle">${sub}</text></svg>`;
  }
  function rows(ans) {
    return '<ol class="cc-rows">' + ans.map((p, i) =>
      `<li class="cc-r"><span class="cc-num">0${i + 1}</span><span class="t">${esc(D.QUESTIONS[i].short)}</span>${dots(p)}</li>`).join("") + "</ol>";
  }
  function tipList(idx, withSource) {
    if (!idx.length) return `<p class="dx-text">No Partly or No answers this time. Use your lowest-scoring question as your next area for growth.</p>`;
    return '<div class="dx-rows cc-tips">' + idx.map((q, n) =>
      `<section class="dx-row is-done"><div class="dx-rail"><span class="dx-dot">0${n + 1}</span>${n < idx.length - 1 ? '<span class="dx-rail-line"></span>' : ""}</div>
        <div class="dx-row-body${withSource ? "" : " no-eyebrow"}">${withSource ? `<p class="dx-eyebrow">FROM QUESTION ${q + 1}</p>` : ""}<p class="dx-answer">${esc(D.TIPS[q])}</p></div></section>`
    ).join("") + "</div>";
  }
  const promise = a => `<p class="dx-promise">When <b class="dx-own">${esc(a ? a.when.replace(/,$/, "") : "")}</b>, I will <b class="dx-own">${esc(a ? a.will.replace(/\.$/, "") : "")}</b>.</p>`;
  function tabs() {
    const t = [["see", "SEE IT"], ["own", "OWN IT"], ["change", "CHANGE IT"]];
    return `<nav class="dx-tabs" aria-label="Sections">${t.map(([k, n]) =>
      `<a href="#${k}" data-act="tab" data-v="${k}"${ui.tab === k ? ' aria-current="page"' : ""}>${n}</a>`).join("")}</nav>`;
  }
  const bar = filled => `<div class="dx-bar" aria-hidden="true">${[0, 1, 2, 3, 4].map(k => `<span class="dx-bar-part">${k < filled ? '<i style="width:100%"></i>' : ""}</span>`).join("")}</div>`;

  /* ---------- Screens: the check ---------- */
  function vLanding() {
    return `<section class="dx-screen cc-landing">
      <div><img class="cc-logo" src="assets/logo.png" alt="Coaching starts with you" width="720" height="258"></div>
      <h1 class="cc-hero"><span class="cc-hero-big">FOLLOW-THROUGH</span></h1>
      <div class="cc-foot">
        <button class="dx-btn dx-btn--ink" data-act="begin">BEGIN ${ICON.arrow}</button>
      </div></section>`;
  }

  /* Before every check: what this is for. Press and hold to start, like I'M COMMITTED. */
  function vMirror() {
    return `<section class="dx-screen cc-mirror">
      <div class="cc-top"><button class="cc-back" data-act="back" aria-label="Back">${ICON.back}</button></div>
      <img class="cc-logo" src="assets/logo.png" alt="Coaching starts with you" width="720" height="258">
      <h1 class="dx-title">THE MIRROR IS FOR YOU.</h1>
      <p class="dx-intro cc-mirror-sub">A moment to reflect.</p>
      <p class="cc-q">Look honestly at how you coach. Recognise what you're doing well, where you're struggling, and what you might do differently.</p>
      <p class="cc-q">Your answers are for you. Only the programme team can see them. The aim is better coaching.</p>
      <p class="cc-q">Be honest when you've made progress. Be equally honest when you haven't. Your answer shows where you are right now, not who you are.</p>
      <p class="cc-q">That's how you become the coach you know you can be.</p>
      <div class="dx-spacer"></div>
      <div class="cc-foot"><button class="dx-hold cc-hold" id="mirror"><span class="dx-hold-fill"></span><span class="dx-hold-label">HOLD UP THE MIRROR</span></button></div>
    </section>`;
  }

  function vQuestion() {
    const n = ui.q, Q = D.QUESTIONS[n], sel = ui.answers[n];
    const ref = (n === 3 && store.action) ? `<div class="dx-card"><p class="dx-card-label">YOUR ACTION</p>${promise(store.action)}</div>` : "";
    const pills = [2, 1, 0].map(p =>
      `<button class="dx-pill${sel === p ? " is-on" : ""}" data-act="answer" data-v="${p}" aria-pressed="${sel === p}">${WORDS[p]}</button>`).join("");
    return `<section class="dx-screen">
      <div class="cc-top"><button class="cc-back" data-act="back" aria-label="Back">${ICON.back}</button>${bar(n + 1)}</div>
      <h1 class="dx-title" style="margin-top:26px">0${n + 1}: ${esc(Q.short.toUpperCase())}</h1>
      <p class="cc-q">${esc(Q.text)}</p>
      <button class="cc-ex-link" data-act="qExample" aria-haspopup="dialog">See an example</button>
      ${ref}
      <div class="dx-pills dx-pills--stack cc-pills" style="margin-top:22px">${pills}</div>
      <div class="dx-spacer"></div>
      <p class="dx-text cc-choose">Choose what you actually do in most relevant moments.</p>
    </section>${vPopup()}`;
  }

  /* Real words, not keyboard mashing: enough words, enough different words, nothing like "sdfgh" or "aaaa". */
  function wordsOk(text, min, minUnique) {
    const words = (text.toLowerCase().match(/[\p{L}']+/gu) || []);
    const unique = new Set(words);
    const mashing = /(\p{L})\1{3,}/u.test(text)                                // "aaaa", "jjjjjj" (letters only, so "...." or "!!!!" is fine)
      || words.some(w => w.length > 20)                                         // one endless "word"
      || words.some(w => w.length > 4 && !/[aeiouyàâäéèêëîïôöùûü]/.test(w));   // "sdfgh", "qwrtz"
    return { count: words.length, ok: words.length >= min && unique.size >= minUnique && !mashing };
  }
  /* Your action: When… and I will… each need 4+ words (3+ different). */
  function actionCheck(when, will) {
    const a = wordsOk(when, 4, 3), b = wordsOk(will, 4, 3), ok = a.ok && b.ok;
    const note = !(a.count || b.count) ? "" : ok ? "Clear and specific. Nice."
      : "Keep going. A few more words on each line will make the moment and the action clear.";
    return { ok, note };
  }
  /* ---------- Screens: sign up / sign in (once per device; then straight to the mirror) ---------- */
  const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
  const signupOk = () => { const s = ui.su; return !!(s.first.trim() && s.last.trim() && emailOk(s.email) && s.gender && s.age); };
  const authEmail = () => (ui.authMode === "signup" ? ui.su.email : ui.siEmail).trim().toLowerCase();
  const authTop = `<div class="cc-top"><button class="cc-back" data-act="authBack" aria-label="Back">${ICON.back}</button></div>`;
  const authErr = () => `<p class="dx-hint cc-auth-err" id="auth-err" role="alert"${ui.authErr ? "" : " hidden"}>${esc(ui.authErr)}</p>`;

  function vAuth() {
    return `<section class="dx-screen cc-auth">${authTop}
      <img class="cc-logo" src="assets/logo.png" alt="Coaching starts with you" width="720" height="258">
      <h1 class="dx-title">BEFORE YOU START.</h1>
      <p class="dx-intro">Sign up once. Your checks are then saved to your account, so you can come back to them on any phone.</p>
      <div class="dx-spacer"></div>
      <div class="cc-foot cc-stack">
        <button class="dx-btn dx-btn--ink" data-act="authMode" data-v="signup">SIGN UP ${ICON.arrow}</button>
        <button class="dx-btn dx-btn--outline" data-act="authMode" data-v="signin">I ALREADY HAVE AN ACCOUNT</button>
      </div></section>`;
  }

  function vSignup() {
    const s = ui.su;
    const field = (id, label, type, ac, val) => `<label class="cc-field"><span class="cc-field-label">${label}</span>
      <input class="cc-input" id="${id}" type="${type}" autocomplete="${ac}" value="${esc(val)}"${type === "email" ? ' inputmode="email" autocapitalize="off" spellcheck="false"' : ""}></label>`;
    // Drop-downs: the phone's own picker (iPhone wheel), styled closed like the text boxes.
    const select = (id, label, list, sel) => `<label class="cc-field"><span class="cc-field-label">${label}</span>
      <span class="cc-select${sel ? "" : " is-empty"}"><select class="cc-input" id="${id}">
        <option value=""${sel ? "" : " selected"} disabled hidden>Choose</option>
        ${list.map(([v, l]) => `<option value="${esc(v)}"${sel === v ? " selected" : ""}>${esc(l)}</option>`).join("")}
      </select>${ICON.down}</span></label>`;
    // Organization comes from the link and is locked: shown so coaches can see they're in the right place.
    const org = LINK_ORG ? `<div class="cc-field"><span class="cc-field-label">ORGANIZATION</span>
      <p class="cc-input cc-input--read cc-input--locked">${esc(D.ORGANIZATIONS[LINK_ORG].name)}<span class="cc-lock" aria-label="Set by your link">${ICON.lock}</span></p></div>` : "";
    return `<section class="dx-screen cc-auth">${authTop}
      <h1 class="dx-title" style="margin-top:26px">SIGN UP</h1>
      ${org}
      ${field("su-email", "EMAIL", "email", "email", s.email)}
      ${field("su-first", "FIRST NAME", "text", "given-name", s.first)}
      ${field("su-last", "LAST NAME", "text", "family-name", s.last)}
      ${select("su-gender", "GENDER", D.GENDERS, s.gender)}
      ${select("su-age", "AGE", D.AGE_BRACKETS.map(a => [a, a]), s.age)}
      <p class="cc-privacy">We save your name, email, gender, age and your check answers so your results are kept between checks. Only the programme team can see them.</p>
      ${authErr()}
      <div class="dx-spacer"></div>
      <div class="cc-foot"><button class="dx-btn dx-btn--ink" id="sendCode" data-act="sendCode"${signupOk() && !ui.authBusy ? "" : " disabled"}>SEND MY CODE ${ICON.arrow}</button></div>
    </section>`;
  }

  function vSignin() {
    return `<section class="dx-screen cc-auth">${authTop}
      <h1 class="dx-title" style="margin-top:26px">SIGN IN</h1>
      <p class="dx-intro">Enter the email you signed up with. We'll send you a 6-digit code.</p>
      <label class="cc-field"><span class="cc-field-label">EMAIL</span>
        <input class="cc-input" id="si-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" value="${esc(ui.siEmail)}"></label>
      ${authErr()}
      <div class="dx-spacer"></div>
      <div class="cc-foot"><button class="dx-btn dx-btn--ink" id="sendCode" data-act="sendCode"${emailOk(ui.siEmail) && !ui.authBusy ? "" : " disabled"}>SEND MY CODE ${ICON.arrow}</button></div>
    </section>`;
  }

  function vCode() {
    const c = ui.code, wait = Math.ceil((ui.resentAt + 30000 - Date.now()) / 1000);
    const boxes = [0, 1, 2, 3, 4, 5].map(k => `<span class="cc-code-box${k === Math.min(c.length, 5) ? " is-next" : ""}">${esc(c[k] || "")}</span>`).join("");
    return `<section class="dx-screen cc-auth">${authTop}
      <h1 class="dx-title" style="margin-top:26px">CHECK YOUR EMAIL</h1>
      <div class="cc-field"><span class="cc-field-label">EMAIL</span><p class="cc-input cc-input--read">${esc(authEmail())}</p></div>
      <p class="cc-field-label cc-field-gap">ENTER THE 6-DIGIT CODE WE SENT YOU</p>
      <label class="cc-code" id="code-wrap"><input id="code" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" value="${esc(c)}" aria-label="6-digit code">${boxes}</label>
      ${authErr()}
      <div class="cc-links">
        <button class="cc-link" data-act="resend"${wait > 0 ? " disabled" : ""}>${wait > 0 ? `NEW CODE IN ${wait}S` : "SEND A NEW CODE"}</button>
        <button class="cc-link" data-act="authBack">CHANGE EMAIL</button>
      </div>
    </section>`;
  }

  function vScore() {
    const r = ui.result;
    // No score number here: just where you are today (from question 04), then the five answers.
    return `<section class="dx-screen cc-score">
      <p class="cc-road-label cc-today-label">TODAY, YOU…</p>
      <h1 class="cc-today">${esc(D.STATUS[r.status].today.toUpperCase())}</h1>
      ${rows(r.answers)}
      <p class="dx-text cc-score-note">This describes your coaching right now, not a grade.</p>
      <div class="dx-spacer"></div>
      <div class="cc-foot"><button class="dx-btn dx-btn--ink" data-act="toGuidance">NEXT ${ICON.arrow}</button></div>
    </section>`;
  }

  function vGuidance() {
    const r = ui.result, S = D.STATUS[r.status];
    return `<section class="dx-screen cc-guidance">
      <h1 class="dx-title dx-title--xl">${S.name.toUpperCase()}</h1>
      <p class="dx-intro">${esc(S.lede)}</p>
      <ol class="dx-moves">${S.steps.map(([k, t], i) =>
        `<li class="dx-move"><span class="dx-move-num">0${i + 1}</span><div class="dx-move-body"><p class="dx-move-key">${k.toUpperCase()}</p><p class="dx-text">${esc(t)}</p></div></li>`).join("")}</ol>
      <p class="dx-label cc-tips-label">${r.tips.length === 2 ? "TWO TIPS" : r.tips.length === 1 ? "ONE TIP" : "TIPS"} FOR YOUR NEXT SESSION</p>
      ${tipList(r.tips, true)}
      <div class="dx-spacer"></div>
      <div class="cc-foot"><button class="dx-btn dx-btn--ink" data-act="afterGuidance">NEXT ${ICON.arrow}</button></div>
    </section>`;
  }

  function vAction() {
    const actCard = `<div class="dx-card cc-act-card"><p class="cc-road-label cc-my-head">MY ACTION <span class="cc-lock" role="img" aria-label="Committed">${ICON.lock}</span></p>${promise(store.action)}</div>`;
    // Week 2/4/6 (inside a check): first show the current action and two choices based on today's status.
    // Workshop day (no check, ui.result empty): straight to writing the first action.
    if (ui.result && store.action && !ui.actMode) {
      const R = D.ACTION_REVIEW[ui.result.status];
      // Reads top to bottom: your action (tile, as on CHANGE IT) → how it went today → what now.
      return `<section class="dx-screen cc-action">
        <h1 class="dx-title" style="margin-top:26px">YOUR ACTION</h1>
        ${actCard}
        <h2 class="dx-title cc-verdict">${esc(R.head.toUpperCase())}</h2>
        <p class="cc-review-line">${esc(R.line)}</p>
        <div class="dx-spacer"></div>
        <div class="cc-foot cc-choices">${R.choices.map(([v, label], k) =>
          `<button class="dx-btn ${k ? "dx-btn--outline" : "dx-btn--ink"}" data-act="actChoose" data-v="${v}">${label}</button>`).join("")}</div>
      </section>`;
    }
    // KEEP IT / KEEP GOING: the action stays locked (no boxes to edit); just hold to commit to it again.
    // Only NEW ACTION (empty boxes) and CHANGE IT (filled in) let you write.
    if (ui.actChoice === "keep") {
      return `<section class="dx-screen cc-action">
        <div class="cc-top"><button class="cc-back" data-act="actBack" aria-label="Back">${ICON.back}</button></div>
        <h1 class="dx-title" style="margin-top:26px">YOUR ACTION</h1>
        ${actCard}
        <p class="cc-review-line cc-keep-line">Same action, another two weeks. Hold the button to commit to it again.</p>
        <div class="dx-spacer"></div>
        <div class="cc-foot"><button class="dx-hold cc-hold" id="commit"><span class="dx-hold-fill"></span><span class="dx-hold-label">I'M COMMITTED</span></button></div>
      </section>`;
    }
    const chk = actionCheck(ui.when, ui.will), ready = chk.ok;
    const back = ui.actMode ? `<div class="cc-top"><button class="cc-back" data-act="actBack" aria-label="Back">${ICON.back}</button></div>` : "";
    const [title, help] = D.ACTION_EDIT[ui.actChoice] || D.ACTION_EDIT.first;
    return `<section class="dx-screen cc-action">${back}
      <h1 class="dx-title" style="margin-top:26px">${title}</h1>
      <p class="dx-text">${esc(help)}</p>
      <div class="cc-oneline">
        <div class="dx-box-wrap"><span class="dx-box-starter" aria-hidden="true">When </span>
          <textarea class="dx-box" id="when" rows="2" placeholder="…" aria-label="When">${esc(ui.when)}</textarea></div>
        <div class="dx-box-wrap"><span class="dx-box-starter" aria-hidden="true">I will </span>
          <textarea class="dx-box" id="will" rows="2" placeholder="…" aria-label="I will" aria-describedby="act-note">${esc(ui.will)}</textarea></div>
      </div>
      <p class="cc-ev-note" id="act-note" aria-live="polite">${chk.note}</p>
      <button class="cc-toggle" data-act="actExample" aria-expanded="${ui.actExOpen}"><span>SEE AN EXAMPLE</span>${ICON.down}</button>
      ${ui.actExOpen ? `<p class="dx-note cc-example">${esc(D.ACTION_EXAMPLE)}</p>` : ""}
      <h2 class="dx-title cc-my-action">MY ACTION</h2>
      <div id="preview">${promise({ when: ui.when.trim(), will: ui.will.trim() })}</div>
      <div class="dx-spacer"></div>
      <div class="cc-foot"><button class="dx-hold cc-hold" id="commit" ${ready ? "" : "disabled"}><span class="dx-hold-fill"></span><span class="dx-hold-label">I'M COMMITTED</span></button></div>
    </section>`;
  }

  /* ---------- Screens: home ---------- */
  function vSee() {
    const recs = store.records;
    // Before Week 2: no results yet. Show when the first check opens, and the action they committed to.
    if (!recs.length) {
      const nc = nextCheck();
      const ready = nc && nc.due;
      return `<div class="dx-card cc-sum cc-first"><p class="cc-road-label">YOUR FIRST CHECK…</p>
          <p class="cc-today">${ready ? "IS READY" : `IN ${nc ? nc.left : 14} DAY${nc && nc.left === 1 ? "" : "S"}`}</p>
          ${ready ? `<button class="dx-btn dx-btn--gold" data-act="begin">TAKE IT NOW ${ICON.arrow}</button>` : ""}</div>
        ${store.action ? `<div class="cc-my"><p class="cc-road-label">AT THE WORKSHOP, YOU COMMITTED TO:</p>${promise(store.action)}</div>` : ""}`;
    }
    if (ui.chip == null || ui.chip === "all") ui.chip = recs.length - 1;
    // Tap anywhere on the tile to choose a check; checks not taken yet stay greyed out.
    // Phones/tablets: an invisible native select over the tile opens the phone's own picker (iPhone wheel).
    // Computers: our own Magistral menu, since desktop browsers draw native lists in the system font.
    const touch = window.matchMedia("(pointer: coarse)").matches;
    const periods = D.CHECKPOINTS.map((cp, i) => [i, cp.label, i < recs.length]);
    const isOn = v => String(ui.chip) === String(v);
    let picker, menu = "", tileAttrs = "";
    if (touch) {
      picker = `<span class="cc-picker-arrow">${ICON.down}</span><select class="cc-native" id="period" aria-label="Show results for">${periods.map(([v, label, ok]) =>
        `<option value="${v}"${isOn(v) ? " selected" : ""}${ok ? "" : " disabled"}>${label}</option>`).join("")}</select>`;
    } else {
      picker = `<span class="cc-picker-arrow${ui.periodOpen ? " is-open" : ""}">${ICON.down}</span>`;
      tileAttrs = `role="button" tabindex="0" data-act="periodToggle" aria-haspopup="listbox" aria-expanded="${!!ui.periodOpen}"`;
      if (ui.periodOpen) menu = `<div class="cc-menu" role="listbox" aria-label="Show results for">${periods.map(([v, label, ok]) =>
        `<button class="cc-menu-item${isOn(v) ? " is-on" : ""}" role="option" aria-selected="${isOn(v)}" data-act="period" data-v="${v}"${ok ? "" : " disabled"}>${esc(label.toUpperCase())}</button>`).join("")}</div>`;
    }

    // "TODAY, YOU ARE…" then the circled A/B/C from OWN IT (Own it = A, Rent it = B, Not started = C).
    // Picking an older check changes the words to "AT WEEK 2, YOU WERE…".
    const i = ui.chip, r = recs[i], L = D.STATUS[r.status].abc;
    const latest = i === recs.length - 1;
    const when = latest ? "TODAY" : `AT ${D.CHECKPOINTS[i].label.toUpperCase()}`;
    return `<div class="cc-period"><div class="dx-card cc-sum cc-tile" ${tileAttrs}>${picker}
        <p class="cc-road-label">${when}, YOU ${latest ? "ARE" : "WERE"}…</p>
        <span class="cc-circ cc-sum-letter" role="img" aria-label="${L}: ${esc(D.ABC[L].name)}"><span>${L}</span></span></div>${menu}</div>
      ${rows(r.answers)}
      ${r.action ? `<div class="cc-my"><p class="cc-road-label">${when}, YOU COMMITTED TO${r.action.changed === false || r.action.choice === "kept" ? " (SAME AS BEFORE)" : ""}:</p>${promise(r.action)}</div>` : ""}`;
  }

  function vOwn() {
    const last = store.records[store.records.length - 1];
    if (ui.gateway && last && last.roadblock) {
      const R = D.ROADBLOCKS[last.roadblock];
      return `<button class="cc-backlink" data-act="closeGateway">${ICON.back}OWN IT</button>
        <div class="cc-gw-sec cc-gw-first"><p class="cc-road-label">YOUR ROADBLOCK:</p><h1 class="dx-card-title">${esc(R.name.toUpperCase())}</h1><p class="dx-text">${esc(R.looks)}</p></div>
        <div class="cc-gw-sec"><p class="cc-road-label">THE GATEWAY:</p><p class="dx-card-title">${esc(R.gateway.toUpperCase())}</p><p class="dx-text">${esc(R.detail)}</p></div>
        <div class="cc-gw-sec"><p class="cc-road-label">METHOD STAGE:</p><p class="dx-card-title">${esc(R.stage.toUpperCase())}</p></div>
        <div class="cc-gw-sec"><p class="dx-text">${esc(whyLine(last))}</p></div>`;
    }
    const road = !last ? `<div class="dx-card cc-road"><p class="cc-road-label">YOUR ROADBLOCK:</p><p class="dx-card-title">AFTER YOUR FIRST CHECK</p>
        <p class="dx-text">What's getting in the way of your action shows here after your Week 2 check.</p></div>`
      : last.roadblock ? (() => {
      const R = D.ROADBLOCKS[last.roadblock];
      // Whole tile opens the gateway; the + bottom-right shows that it does.
      return `<div class="dx-card cc-road cc-road--open" role="button" tabindex="0" data-act="openGateway" aria-label="Your roadblock: ${esc(R.name)}. Open the gateway">
        <p class="cc-road-label">YOUR ROADBLOCK:</p><p class="dx-card-title">${esc(R.name.toUpperCase())}</p><p class="dx-text">${esc(R.looks)}</p>
        <span class="cc-plus" aria-hidden="true">${ICON.plus}</span></div>`;
    })() : `<div class="dx-card cc-road"><p class="cc-road-label">YOUR ROADBLOCK:</p><p class="dx-card-title">NONE SHOWING</p>
        <p class="dx-text">All five answers were Yes. Identify the coaching situation most likely to pull you back.</p></div>`;
    const gap = D.GAP_LINE.split(". ");
    return `<p class="dx-intro" style="margin-top:6px">Which one am I right now?</p>
      <div class="cc-abc">${["A", "B", "C"].map(L => `<button class="cc-circ${ui.popup === L ? " is-on" : ""}" data-act="abc" data-v="${L}" aria-label="${L}: ${esc(D.ABC[L].name)}"><span>${L}</span></button>`).join("")}</div>
      <p class="dx-text cc-hint">Tap a letter to see what it means.</p>
      <p class="dx-quote" style="margin-top:28px">${esc(gap[0])}. <em>${esc(gap.slice(1).join(". "))}</em></p>
      ${road}`;
  }

  function vChange() {
    const last = store.records[store.records.length - 1], a = store.action;
    // No tile: grey Magistral label with the "committed" lock beside it, then the action as body text.
    // TEST ONLY: tapping the lock offers to reset everything. Remove before launch.
    const act = a ? `<div class="cc-my"><p class="cc-road-label cc-my-head">MY ACTION <button class="cc-lock" data-act="askReset" aria-label="Committed. Test: reset everything">${ICON.lock}</button></p>${promise(a)}</div>` : "";
    if (complete()) {
      const first = D.STATUS[store.records[0].status].name, end = D.STATUS[last.status].name;
      return act + `<div class="dx-card cc-done"><p class="dx-card-label">PROGRAMME COMPLETE</p>
        <p class="dx-card-title">${D.CHECKPOINTS.length} checks done</p>
        <p class="dx-text">${first === end ? "You finished at " + end + "." : "From " + first + " to " + end + "."}</p>
        <p class="cc-keep"><b>Keep it.</b> Name the coaching situation most likely to pull you back into the old habit.</p></div>`;
    }
    const nc = nextCheck();
    if (!nc) return act;
    const state = nc.due
      ? `<div class="dx-card cc-ready"><div class="dx-card-head"><p class="dx-card-label">NEXT CHECK</p><p class="dx-card-tag">${nc.cp.label.toUpperCase()}</p></div>
          <p class="dx-card-title">Your check is ready</p><p class="dx-text">Same five questions, same action.</p>
          <button class="dx-btn dx-btn--gold" data-act="begin">TAKE IT NOW ${ICON.arrow}</button></div>`
      // TEST ONLY: tapping the countdown jumps to the next check's date and starts it. Remove before launch.
      : `<div class="dx-card cc-count" role="button" tabindex="0" data-act="testSkip" aria-label="Test: start the next check now">${smallRing(nc.left, nc.elapsed, nc.left === 1 ? "DAY" : "DAYS", nc.left + " days left")}
          <div><p class="dx-card-label">NEXT CHECK</p><p class="dx-card-title">${nc.cp.label}</p><p class="dx-text" style="font-size:16px">in ${nc.left} day${nc.left === 1 ? "" : "s"}</p></div></div>`;
    // Tips come from a check's answers, so they only show from Week 2.
    return act + (last ? `<h2 class="cc-tips-title">TIPS FOR YOUR NEXT SESSION</h2>${tipList(last.tips, false)}` : "") + state;
  }

  function vHome() {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const banner = (ui.tab === "see" && !standalone && !store.homeTipDismissed) ? `<div class="dx-note cc-banner"><div><b>Add to your Home Screen</b>
      So your results stay saved between checks. Tap Share, then Add to Home Screen.</div>
      <button class="cc-x" data-act="dismissTip" aria-label="Dismiss">${ICON.x}</button></div>` : "";
    const titles = { see: "SEE IT", own: "OWN IT", change: "CHANGE IT" };
    const body = ui.tab === "see" ? vSee() : ui.tab === "own" ? vOwn() : vChange();
    const head = (ui.tab === "own" && ui.gateway) ? "" :
      `<h1 class="dx-title dx-title--xl" style="margin-top:0">${titles[ui.tab]}</h1>`;
    return `<section class="dx-screen cc-home">${head}${banner}${body}</section>${tabs()}${vPopup()}`;
  }

  function vPopup() {
    if (!ui.popup) return "";
    if (ui.popup === "qex") {     // "See an example" on a question: what YES / PARTLY / NO look like (read only)
      const Q = D.QUESTIONS[ui.q];
      return `<div class="cc-dim" data-act="closePopup"></div><div class="cc-sheet" role="dialog" aria-modal="true" aria-label="Example: ${esc(Q.short)}">
        <button class="cc-x" data-act="closePopup" aria-label="Close">${ICON.x}</button>
        <h2 class="dx-title cc-qex-title">0${ui.q + 1}: ${esc(Q.short.toUpperCase())}</h2>
        ${[2, 1, 0].map(p => `<div class="cc-qex-row"><p class="cc-road-label">${WORDS[p]}</p><p class="dx-text">${esc(Q.opts[2 - p])}</p></div>`).join("")}
      </div>`;
    }
    if (ui.popup === "reset") {   // TEST ONLY (from the lock on CHANGE IT)
      return `<div class="cc-dim" data-act="closePopup"></div><div class="cc-sheet center" role="dialog" aria-modal="true" aria-label="Reset everything">
        <p class="dx-label dx-label--muted">TEST ONLY</p><h2 class="dx-title dx-title--xl" style="margin-top:12px">RESET EVERYTHING?</h2>
        <p class="dx-intro">This deletes your checks, your action and your sign-up on this device, and takes you back to the start.</p>
        <button class="dx-btn dx-btn--ink" data-act="resetAll">YES, RESET</button>
        <button class="dx-btn dx-btn--outline" data-act="closePopup">CANCEL</button></div>`;
    }
    if (ui.popup === "ready") {
      const nc = nextCheck();
      return `<div class="cc-dim" data-act="closePopup"></div><div class="cc-sheet center" role="dialog" aria-modal="true" aria-label="Check ready">
        <p class="dx-label">${nc.cp.label.toUpperCase()}</p><h2 class="dx-title dx-title--xl" style="margin-top:12px">YOUR CHECK IS READY.</h2>
        <p class="dx-intro">Same five questions, same action. About two minutes.</p>
        <button class="dx-btn dx-btn--gold" data-act="begin">TAKE IT NOW ${ICON.arrow}</button>
        <button class="dx-btn dx-btn--outline" data-act="closePopup">LATER</button></div>`;
    }
    const A = D.ABC[ui.popup];
    return `<div class="cc-dim" data-act="closePopup"></div><div class="cc-sheet" role="dialog" aria-modal="true" aria-label="${esc(A.name)}">
      <button class="cc-x" data-act="closePopup" aria-label="Close">${ICON.x}</button>
      <div class="cc-sheet-head"><span class="cc-circ is-on"><span>${ui.popup}</span></span><h2 class="dx-title">${esc(A.name.toUpperCase())}</h2></div>
      ${A.reads.map(([label, quote]) => `<div class="cc-abc-read">${label ? `<p class="cc-road-label">${esc(label.toUpperCase())}:</p>` : ""}
        <p class="dx-text">“${esc(quote)}”</p></div>`).join("")}
      <div class="cc-abc-next"><p class="cc-road-label">WHAT TO DO NEXT:</p><p class="dx-card-title">${esc(A.next[0].toUpperCase())}</p><p class="dx-text">${esc(A.next[1])}</p></div></div>`;
  }

  /* ---------- Render ---------- */
  function render() {
    if (ui.view === "home" && !complete()) {
      const nc = nextCheck();
      if (nc && nc.due && !ui.readyShown && !ui.popup) { ui.popup = "ready"; ui.readyShown = true; }
    }
    const v = { landing: vLanding, auth: vAuth, signup: vSignup, signin: vSignin, code: vCode, mirror: vMirror, q: vQuestion, score: vScore, guidance: vGuidance, action: vAction, home: vHome }[ui.view];
    $app.innerHTML = v() + demoBar();
    bindInputs();
    centerPills();
  }
  /* Question screens: push Yes/Partly/No down so PARTLY sits in the exact middle of the screen.
     Never less than the normal 22px gap, so a long question on a small phone doesn't get covered. */
  function centerPills() {
    const el = document.querySelector(".cc-pills");
    if (!el) return;
    el.style.marginTop = "22px";
    const r = el.getBoundingClientRect(), mid = r.top + window.scrollY + r.height / 2;
    const delta = document.documentElement.clientHeight / 2 - mid;
    if (delta > 0) el.style.marginTop = 22 + delta + "px";
  }
  window.addEventListener("resize", centerPills);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(centerPills); // re-measure once fonts change line breaks
  function go(view) { ui.view = view; render(); window.scrollTo(0, 0); }

  function demoBar() {
    if (!DEMO) return "";
    document.body.classList.add("cc-has-demo");
    return `<div class="cc-demo"><span>DEMO · DAY +${store.demoOffsetDays}</span>
      <button data-act="demoSkip">+14 days</button>${store.signedIn ? '<button data-act="demoSignOut">Sign out</button>' : ""}<button data-act="demoReset">Reset</button></div>`;
  }

  /* ---------- Actions ---------- */
  function begin() {
    ui.q = 0; ui.answers = [null, null, null, null, null];
    ui.popup = null; ui.result = null; ui.actMode = null; ui.actChoice = null; ui.when = ""; ui.will = "";
    // Not signed in on this device yet: sign up / sign in first (once).
    if (!store.signedIn) { ui.authErr = ""; return go("auth"); }
    // Signed up but no action yet: workshop day, write it. Otherwise a check: the mirror, then question 01.
    // Organization that starts at Week 2: no workshop-day screen, straight into the Week 2 check.
    go(store.action || startsAtWeek2() ? "mirror" : "action");
  }
  /* Code checked: load this person's account, action and checks from Supabase, or create the account (first sign-up).
     Workshop day (no action yet) → write the first action. Already has one → SEE IT. */
  async function signedIn(user) {
    const got = await pullAll(user);
    if (got === "offline") {
      ui.authErr = "Signed in, but we couldn't load your account. Check your signal and enter a new code.";
      try { await sb.auth.signOut({ scope: "local" }); } catch (e) { /* offline */ }
      ui.code = ""; return go("code");
    }
    if (got === "new") {
      // First time: the details from the sign-up form, or the ones saved with the login (signed up, then confirmed later on Sign in).
      // org = the code from their link ("golf-department"), or null for the plain link. orgName kept too, for readable exports.
      const m = user.user_metadata || {};
      const p = ui.authMode === "signup" ? signupProfile() : m.firstName ? m : null;
      if (!p) { ui.authErr = "We couldn't find your sign-up details. Go back and sign up."; ui.code = ""; return go("code"); }
      const keep = { demoOffsetDays: store.demoOffsetDays, homeTipDismissed: store.homeTipDismissed };
      store = Object.assign(fresh(), keep, {
        account: { email: user.email, firstName: p.firstName, lastName: p.lastName, gender: p.gender, ageBracket: p.ageBracket,
          org: p.org || null, orgName: p.orgName || null, createdAt: new Date().toISOString() },
        signedIn: true, dirty: true
      });
      save(); pushAll();
    }
    ui.code = ""; ui.authErr = "";
    // The "check is ready" pop-up shows on SEE IT if one is due.
    ui.result = null; ui.actMode = null; ui.actChoice = null;
    if (store.action) return go("home");
    // Organization that starts at Week 2: straight into the Week 2 check (mirror, then question 01).
    if (startsAtWeek2()) { ui.q = 0; ui.answers = [null, null, null, null, null]; return go("mirror"); }
    go("action");
  }
  async function sendCode() {
    if (ui.authBusy) return;
    ui.authBusy = true; ui.authErr = "";
    const r = await Auth.sendCode(authEmail(), ui.authMode === "signup");
    ui.authBusy = false;
    if (r.error) { ui.authErr = r.error; return render(); }
    ui.code = ""; ui.resentAt = Date.now(); go("code");
  }
  async function verifyCode() {
    if (ui.authBusy || ui.code.length !== 6) return;
    ui.authBusy = true;
    const r = await Auth.verifyCode(authEmail(), ui.code);
    if (r.error) { ui.authBusy = false; ui.authErr = r.error; ui.code = ""; render(); const c = document.getElementById("code"); if (c) c.focus(); return; }
    await signedIn(r.user);
    ui.authBusy = false;
  }
  /* Save the action. Workshop day: it starts the programme clock (Week 2 is 14 days from now).
     At a check: saved on the check's record (history) and as the current action. */
  function commitAction() {
    const a = { when: ui.when.trim().replace(/,?$/, ","), will: ui.will.trim().replace(/\.?$/, ".") };
    if (!ui.result) {
      const date = new Date(now()).toISOString();
      store.action = { ...a, date }; store.firstAction = { ...a, date }; store.startDate = date;
      store.dirty = true; save(); pushAll();
      ui.tab = "see"; ui.chip = null; ui.readyShown = true;
      return go("home");
    }
    const prev = store.action;
    // Organization that starts at Week 2: first action written at the end of Week 2. Set the clock as if the workshop was 14 days ago,
    // so Week 4 opens 14 days from now.
    if (!store.startDate) {
      const date = new Date(now()).toISOString();
      store.startDate = new Date(now() - D.CHECKPOINTS[0].day * DAY).toISOString();
      store.firstAction = { ...a, date };
    }
    const same = !!prev && prev.when === a.when && prev.will === a.will;
    // choice = the button they tapped (first / new / keep / easier / smaller); changed = did the words actually change?
    // So the dashboard can tell "chose MAKE IT SMALLER but left it the same" from a real change.
    const choice = !prev ? "first" : ui.actChoice || "keep";
    store.action = { ...a, date: new Date(now()).toISOString() };
    ui.result.action = { ...a, choice, changed: !prev || !same };
    finish();
  }
  function buildResult() {
    const a = ui.answers.slice(), i = store.records.length;
    // All checkpoints already used (e.g. testing again via ?start): don't crash, tag it as an extra check.
    const cp = D.CHECKPOINTS[i], status = statusFor(a);
    return {
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      checkpoint: cp ? cp.key : "extra",
      date: new Date(now()).toISOString(),
      answers: a, score: sum(a), max: 10,
      status,
      abc: D.STATUS[status].abc,   // A / B / C, as on SEE IT
      roadblock: roadblockFor(a),
      tips: tipsFor(a)
    };
  }
  function finish() {
    // The check and the (possibly new) current action both go to Supabase.
    store.records.push({ ...ui.result, synced: false }); store.dirty = true; save(); pushAll();
    ui.result = null; ui.tab = "see"; ui.chip = store.records.length - 1; ui.gateway = false; ui.readyShown = true;
    go("home");
  }

  const actions = {
    // After question 05 the score comes straight up.
    begin, next() {
      if (ui.answers[ui.q] == null) return;
      if (ui.q < 4) { ui.q++; return go("q"); }
      ui.result = buildResult(); go("score");
    },
    // Tap shows the choice for a beat, then moves straight on (no Next button).
    answer(el) {
      if (ui.advancing) return;
      ui.answers[ui.q] = +el.dataset.v; ui.advancing = true; render();
      setTimeout(() => { ui.advancing = false; actions.next(); }, 220);
    },
    back() {
      if (ui.view === "q") { if (ui.q > 0) { ui.q--; return go("q"); } return go("mirror"); }
      go(store.action ? "home" : "landing");
    },
    actExample() { ui.actExOpen = !ui.actExOpen; render(); },
    qExample() { ui.popup = "qex"; render(); },
    // Sign up / sign in
    authMode(el) { ui.authMode = el.dataset.v; ui.authErr = ""; go(ui.authMode); },
    authBack() {
      ui.authErr = "";
      if (ui.view === "code") return go(ui.authMode);
      if (ui.view === "signup" || ui.view === "signin") return go("auth");
      go(store.action && store.signedIn ? "home" : "landing");
    },
    sendCode,
    resend() { if (Date.now() - ui.resentAt < 30000) return; sendCode(); },
    toGuidance() { go("guidance"); },
    afterGuidance() { ui.actMode = null; go("action"); },
    // Week 2/4/6 choice: "new" starts with empty boxes; "keep" shows the action locked; "easier"/"smaller" start from the current action.
    actChoose(el) {
      const v = el.dataset.v, a = store.action;
      ui.actChoice = v; ui.actMode = "edit";
      ui.when = v === "new" ? "" : a.when.replace(/,$/, ""); ui.will = v === "new" ? "" : a.will.replace(/\.$/, "");
      go("action");
    },
    actBack() { ui.actMode = null; go("action"); },
    tab(el) { ui.tab = el.dataset.v; ui.gateway = false; ui.popup = null; ui.periodOpen = false; render(); window.scrollTo(0, 0); },
    abc(el) { ui.popup = el.dataset.v; render(); },
    closePopup() { ui.popup = null; render(); },
    periodToggle() { ui.periodOpen = !ui.periodOpen; render(); },
    period(el) { ui.chip = +el.dataset.v; ui.periodOpen = false; render(); },
    openGateway() { ui.gateway = true; render(); window.scrollTo(0, 0); },
    closeGateway() { ui.gateway = false; render(); },
    dismissTip() { store.homeTipDismissed = true; save(); render(); },
    export: exportCSV,
    testSkip() { const nc = nextCheck(); if (!nc) return; store.demoOffsetDays += nc.left; save(); ui.readyShown = true; begin(); },
    // TEST ONLY (?demo): sign out to try Sign in (the account and checks stay saved in Supabase).
    async demoSignOut() { try { await sb.auth.signOut({ scope: "local" }); } catch (e) { /* offline */ } store.signedIn = false; save(); render(); },
    demoSkip() { store.demoOffsetDays += 14; save(); ui.readyShown = false; ui.popup = null; render(); },
    askReset() { ui.popup = "reset"; render(); },
    // TEST ONLY: clears this phone and signs out. What's already saved in Supabase stays there
    // (delete it in the Supabase dashboard, or sign up again with a different email to start fresh).
    resetAll() {
      sb.auth.signOut({ scope: "local" }).catch(() => {});
      try { localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
      store = fresh();
      Object.assign(ui, { view: "landing", tab: "see", popup: null, gateway: false, chip: null, periodOpen: false, readyShown: false,
        authMode: "signup", su: { first: "", last: "", email: "", gender: null, age: null }, siEmail: "", code: "", authErr: "" });
      render(); window.scrollTo(0, 0);
    },
    demoReset() { if (confirm("Delete all saved checks on this device?")) actions.resetAll(); }
  };

  document.addEventListener("click", e => {
    // A tap outside the period dropdown closes it.
    if (ui.periodOpen && !e.target.closest(".cc-period")) { ui.periodOpen = false; render(); return; }
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    if (el.tagName === "A") e.preventDefault();
    const fn = actions[el.dataset.act];
    if (fn) fn(el);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && ui.popup) actions.closePopup();
    if (e.key === "Escape" && ui.periodOpen) { ui.periodOpen = false; render(); }
    // Keyboard support for the tile, which is a div acting as a button.
    if ((e.key === "Enter" || e.key === " ") && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); }
  });

  /* Inputs update state without re-rendering (keeps the keyboard open). */
  function bindInputs() {
    const period = document.getElementById("period");
    if (period) period.addEventListener("change", () => { ui.chip = +period.value; render(); });
    bindAuthInputs();
    const w = document.getElementById("when"), wi = document.getElementById("will"), commit = document.getElementById("commit");
    if (w && wi && commit) {
      const preview = document.getElementById("preview");
      const upd = () => {
        ui.when = w.value; ui.will = wi.value;
        const chk = actionCheck(ui.when, ui.will);
        commit.disabled = !chk.ok;
        document.getElementById("act-note").textContent = chk.note;
        preview.innerHTML = `<p class="dx-promise">When <b class="dx-own">${esc(ui.when.trim().replace(/,$/, ""))}</b>, I will <b class="dx-own">${esc(ui.will.trim().replace(/\.$/, ""))}</b>.</p>`;
      };
      w.addEventListener("input", upd); wi.addEventListener("input", upd);
      indentStarters();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(indentStarters);
      bindHold(commit, commitAction, () => actionCheck(ui.when, ui.will).ok);
    } else if (commit) bindHold(commit, commitAction);   // KEEP IT: locked action, nothing to check
    const mirror = document.getElementById("mirror");
    if (mirror) bindHold(mirror, () => { ui.q = 0; go("q"); });
  }
  /* Sign up / sign in boxes: typing updates state without re-rendering (keeps the keyboard open). */
  let resendTimer = null;
  function bindAuthInputs() {
    clearInterval(resendTimer);
    const send = document.getElementById("sendCode");
    const clearErr = () => { if (ui.authErr) { ui.authErr = ""; const e = document.getElementById("auth-err"); if (e) e.hidden = true; } };
    [["su-first", "first"], ["su-last", "last"], ["su-email", "email"]].forEach(([id, k]) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", () => { ui.su[k] = el.value; clearErr(); send.disabled = !signupOk(); });
    });
    [["su-gender", "gender"], ["su-age", "age"]].forEach(([id, k]) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", () => {
        ui.su[k] = el.value || null; el.parentNode.classList.toggle("is-empty", !el.value); clearErr(); send.disabled = !signupOk();
      });
    });
    const si = document.getElementById("si-email");
    if (si) si.addEventListener("input", () => { ui.siEmail = si.value; clearErr(); send.disabled = !emailOk(ui.siEmail); });
    // Enter on the keyboard sends the code once the form is complete.
    document.querySelectorAll(".cc-auth .cc-input").forEach(el => el.addEventListener("keydown", e => {
      if (e.key === "Enter" && send && !send.disabled) { e.preventDefault(); sendCode(); }
    }));

    const code = document.getElementById("code");
    if (!code) return;
    const boxes = document.querySelectorAll(".cc-code-box");
    code.addEventListener("input", () => {
      ui.code = code.value.replace(/\D/g, "").slice(0, 6); code.value = ui.code; clearErr();
      boxes.forEach((b, k) => { b.textContent = ui.code[k] || ""; b.classList.toggle("is-next", k === Math.min(ui.code.length, 5)); });
      if (ui.code.length === 6) verifyCode();
    });
    code.focus();
    // Count down to "SEND A NEW CODE" without re-rendering the code boxes.
    const btn = document.querySelector('[data-act="resend"]');
    resendTimer = setInterval(() => {
      const wait = Math.ceil((ui.resentAt + 30000 - Date.now()) / 1000);
      btn.disabled = wait > 0; btn.textContent = wait > 0 ? `NEW CODE IN ${wait}S` : "SEND A NEW CODE";
      if (wait <= 0) clearInterval(resendTimer);
    }, 1000);
  }
  /* Press and hold (I'M COMMITTED, HOLD UP THE MIRROR): the bar fills over 2s; letting go early resets it. */
  function bindHold(btn, onDone, canStart = () => true) {
    const fill = btn.querySelector(".dx-hold-fill"), ms = 2000;
    let t = null;
    const start = e => {
      if (btn.disabled || t || !canStart()) return;
      e.preventDefault();
      fill.style.transition = `width ${ms}ms linear`; fill.style.width = "100%";
      t = setTimeout(() => {
        t = null;
        if (navigator.vibrate) navigator.vibrate(30);
        onDone();
      }, ms);
    };
    const stop = () => {
      if (!t) return;
      clearTimeout(t); t = null;
      fill.style.transition = "width 200ms ease"; fill.style.width = "0";
    };
    btn.addEventListener("pointerdown", start);
    ["pointerup", "pointerleave", "pointercancel"].forEach(ev => btn.addEventListener(ev, stop));
    btn.addEventListener("contextmenu", e => e.preventDefault());
    btn.addEventListener("keydown", e => { if ((e.key === " " || e.key === "Enter") && !e.repeat) start(e); });
    btn.addEventListener("keyup", stop);
  }
  /* The grey sentence starter sits inside the box; indent the first line by its width. */
  function indentStarters() {
    document.querySelectorAll(".dx-box-wrap").forEach(wrap => {
      const s = wrap.querySelector(".dx-box-starter"), box = wrap.querySelector(".dx-box");
      if (s && box) box.style.textIndent = Math.ceil(s.getBoundingClientRect().width + 1) + "px";
    });
  }

  /* ---------- Export ---------- */
  function exportCSV() {
    const head = ["organization", "checkpoint", "date", "q1", "q2", "q3", "q4", "q5", "score", "max", "status", "abc", "roadblock", "action_when", "action_will", "action_choice", "action_changed"];
    const q = s => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
    const lines = store.records.map(r => { const a = r.action || {};
      return [(store.account && store.account.orgName) || "", r.checkpoint, r.date, ...r.answers, r.score, r.max, r.status, r.abc || (D.STATUS[r.status] || {}).abc || "", r.roadblock || "", a.when, a.will, a.choice, a.changed == null ? "" : a.changed ? "yes" : "no"].map(q).join(","); });
    const blob = new Blob([head.join(",") + "\n" + lines.join("\n")], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = "change-check-results.csv";
    document.body.appendChild(link); link.click(); link.remove();
  }

  render();
  syncOnOpen();
})();

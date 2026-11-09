/* Admin dashboard — Coaching Starts With You.
   Open with …/?dashboard (forwards here) or …/admin/.
   Sign-in: email → 6-digit code (same Supabase login as the app) → Supabase checks the email is on the
   public.admins list (is_admin). Only then does the database return everyone's rows; anyone else gets nothing.
   To add an admin: Supabase → Table Editor → admins → Insert row → their email (lower case). */
(function () {
  "use strict";

  const D = window.CC_DATA;
  const SUPABASE_URL = "https://guwjgnvqygnxlpltmvop.supabase.co";
  const SUPABASE_KEY = "sb_publishable_HTh_pjczopYxfFSl7pzvyQ_4keK6ChT";
  // Own storage key: signing in or out here never touches a coach login on the same phone/browser.
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "cc-admin-auth" }
  });

  const DAY = 86400000;
  const CPS = D.CHECKPOINTS;                         // Week 2 / 4 / 6
  const RANK = { A: 3, B: 2, C: 1 };
  const OVERDUE_DAYS = 7;                            // a check open this long without being done = overdue
  const CHOICES = [["first", "First action"], ["keep", "Kept the same action"], ["new", "New action"], ["easier", "Made it easier"], ["smaller", "Made it smaller"]];

  const $dash = document.getElementById("dash");
  const $tip = document.getElementById("tip");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const svg = (d, w = 2, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 2, 20),
    back: svg('<path d="M15 6l-6 6 6 6"/>', 2, 22),
    down: svg('<path d="M6 9l6 6 6-6"/>'),
    up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>', 2.2, 16),
    same: svg('<path d="M5 12h14"/>', 2.2, 16),
    fall: svg('<path d="M12 5v14M6 13l6 6 6-6"/>', 2.2, 16),
    alert: svg('<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.5"/>', 2, 15)
  };
  const fmtDate = t => new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const fmtTime = t => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const orgName = code => (code ? (D.ORGANIZATIONS[code] ? D.ORGANIZATIONS[code].name : code) : "No organization");
  const startsAtWeek2 = code => !!(code && D.ORGANIZATIONS[code] && D.ORGANIZATIONS[code].startAtWeek2);
  const ABC_NAME = L => D.ABC[L].name;

  /* ---------- State ---------- */
  const ui = { view: "loading", email: "", code: "", err: "", busy: false, resentAt: 0,
    org: "all", check: "latest", search: "", sort: "attention", open: null, live: false, updated: null, newRows: new Set(), toast: null };
  let data = { profiles: [], checks: [] };
  let knownChecks = null;            // check ids seen so far (to spot new ones arriving live)

  /* ---------- Sign in ---------- */
  const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
  function authError(err, fallback) {
    const m = ((err && (err.code || "") + " " + (err.message || "")) || "").toLowerCase();
    if (/signup.*not allowed|otp_disabled|user not found/.test(m)) return "There's no account with this email.";
    if (/rate|too many|429|seconds/.test(m)) return "Too many tries. Wait a minute, then try again.";
    if (/fetch|network|failed to|load failed/.test(m)) return "No connection. Check your internet and try again.";
    if (/expired|invalid|otp/.test(m)) return "That code didn't work or has expired. Check it, or send a new code.";
    return fallback;
  }
  async function sendCode() {
    if (ui.busy || !emailOk(ui.email)) return;
    ui.busy = true; ui.err = ""; render();
    try {
      const { error } = await sb.auth.signInWithOtp({ email: ui.email.trim().toLowerCase(), options: { shouldCreateUser: false } });
      ui.busy = false;
      if (error) { ui.err = authError(error, "We couldn't send the code. Try again in a moment."); return render(); }
      ui.code = ""; ui.resentAt = Date.now(); ui.view = "code"; render();
    } catch (e) { ui.busy = false; ui.err = authError(e, "No connection. Check your internet and try again."); render(); }
  }
  async function verifyCode() {
    if (ui.busy || ui.code.length !== 6) return;
    ui.busy = true;
    try {
      const { data: d, error } = await sb.auth.verifyOtp({ email: ui.email.trim().toLowerCase(), token: ui.code, type: "email" });
      if (error || !d.session) throw error || new Error("invalid");
      ui.busy = false; ui.err = "";
      await enter();
    } catch (e) {
      ui.busy = false; ui.code = ""; ui.err = authError(e, "That code didn't work. Check it and try again."); render();
    }
  }
  // Logged in: only continue if Supabase says this email is on the admin list.
  async function enter() {
    ui.view = "loading"; render();
    const { data: ok, error } = await sb.rpc("is_admin");
    if (error) { ui.view = "login"; ui.err = authError(error, "We couldn't check your access. Try again."); return render(); }
    if (!ok) { await sb.auth.signOut({ scope: "local" }).catch(() => {}); ui.view = "denied"; return render(); }
    ui.view = "dash";
    await load();
    subscribe();
  }
  async function signOut() {
    sb.removeAllChannels();
    await sb.auth.signOut({ scope: "local" }).catch(() => {});
    Object.assign(ui, { view: "login", code: "", err: "", live: false });
    data = { profiles: [], checks: [] }; knownChecks = null; render();
  }

  /* ---------- Data ---------- */
  async function load() {
    const [p, c, rm] = await Promise.all([
      sb.from("profiles").select("*"),
      sb.from("checks").select("*").order("checked_at", { ascending: true }),
      sb.from("reminders").select("user_id,checkpoint,sent_at")   // reminder emails (missing table = no reminders yet)
    ]);
    if (p.error || c.error) {
      // Session gone (signed out elsewhere, expired): back to sign in.
      const { data: s } = await sb.auth.getSession();
      if (!s.session) { ui.view = "login"; ui.err = "Please sign in again."; return render(); }
      ui.err = "Couldn't load the latest data. It will retry automatically."; return render();
    }
    // Spot checks that arrived since the last load (not on the first load).
    if (knownChecks) {
      const fresh = c.data.filter(r => !knownChecks.has(r.id));
      fresh.forEach(r => ui.newRows.add(r.user_id));
      if (fresh.length) {
        const r = fresh[fresh.length - 1], who = p.data.find(x => x.id === r.user_id);
        const cp = CPS.find(x => x.key === r.checkpoint);
        showToast(`New check: ${who ? who.first_name + " " + who.last_name.charAt(0) + "." : "a coach"} · ${cp ? cp.label : r.checkpoint} · ${r.abc}`);
        setTimeout(() => { ui.newRows.clear(); }, 3200);
      }
    }
    knownChecks = new Set(c.data.map(r => r.id));
    data = { profiles: p.data, checks: c.data, reminders: rm.error ? [] : rm.data || [] };
    ui.err = ""; ui.updated = Date.now();
    render();
  }
  let reloadTimer = null;
  const reloadSoon = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(load, 500); };
  function subscribe() {
    sb.removeAllChannels();
    sb.channel("admin-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "checks" }, reloadSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, reloadSoon)
      .subscribe(status => { ui.live = status === "SUBSCRIBED"; paintLive(); });
  }
  // Safety nets: refresh when the tab comes back into view, and every 5 minutes.
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ui.view === "dash") load(); });
  setInterval(() => { if (ui.view === "dash" && !document.hidden) load(); }, 5 * 60000);

  /* ---------- The numbers ---------- */
  function model() {
    const now = Date.now();
    const q = ui.search.trim().toLowerCase();
    const inOrg = p => ui.org === "all" || (p.org || "") === ui.org;
    const profiles = data.profiles.filter(inOrg);
    const ids = new Set(profiles.map(p => p.id));
    // One check per coach per week (the latest, in case a week was ever saved twice).
    const by = {};
    data.checks.forEach(c => {
      if (!ids.has(c.user_id) || !CPS.some(cp => cp.key === c.checkpoint)) return;
      const u = (by[c.user_id] = by[c.user_id] || {});
      if (!u[c.checkpoint] || u[c.checkpoint].checked_at < c.checked_at) u[c.checkpoint] = c;
    });
    // Reminder emails sent, per coach and week.
    const sentAt = {};
    (data.reminders || []).forEach(r => { if (r.sent_at) sentAt[r.user_id + ":" + r.checkpoint] = r.sent_at; });
    const coaches = profiles.map(p => {
      const done = by[p.id] || {};
      const latest = [...CPS].reverse().map(cp => done[cp.key]).find(Boolean) || null;
      const last = Object.values(done).reduce((t, c) => Math.max(t, new Date(c.checked_at).getTime()), new Date(p.created_at).getTime());
      // Timing per week: when it opened, how many days after that it was done, and when the reminder went out.
      const timing = {};
      CPS.forEach((cp, i) => {
        const opens = opensAt(p, i, done), r = done[cp.key];
        timing[cp.key] = { opens, reminded: sentAt[p.id + ":" + cp.key] || null,
          after: r && opens != null ? Math.max(0, Math.floor((new Date(r.checked_at).getTime() - opens) / DAY)) : null };
      });
      return { p, done, latest, last, timing, next: nextState(p, done, now) };
    });

    const weeks = CPS.map(cp => {
      const rows = coaches.map(c => c.done[cp.key]).filter(Boolean);
      const n = rows.length, count = { A: 0, B: 0, C: 0 };
      rows.forEach(r => { count[r.abc]++; });
      const avg = n ? rows.reduce((s, r) => s + r.score, 0) / n : null;
      const qAvg = [1, 2, 3, 4, 5].map(i => (n ? rows.reduce((s, r) => s + r["q" + i], 0) / n : null));
      const choices = {}; let sameWords = 0;
      rows.forEach(r => {
        if (r.action_choice) choices[r.action_choice] = (choices[r.action_choice] || 0) + 1;
        if (r.action_changed === false && ["easier", "smaller", "new"].includes(r.action_choice)) sameWords++;
      });
      return { cp, n, count, avg, qAvg, choices, sameWords };
    });

    const moves = [[0, 1], [1, 2]].map(([a, b]) => {
      const res = { from: CPS[a], to: CPS[b], up: 0, same: 0, down: 0, n: 0 };
      coaches.forEach(c => {
        const x = c.done[CPS[a].key], y = c.done[CPS[b].key];
        if (!x || !y) return;
        res.n++;
        const d = RANK[y.abc] - RANK[x.abc];
        if (d > 0) res.up++; else if (d < 0) res.down++; else res.same++;
      });
      return res;
    });

    // The "Check" filter: each coach's latest check, or one chosen week.
    const rowAt = c => (ui.check === "latest" ? c.latest : c.done[ui.check]) || null;
    const road = {}, abc = { A: 0, B: 0, C: 0 }; let roadN = 0;
    coaches.forEach(c => {
      const r = rowAt(c); if (!r) return;
      roadN++; const k = r.roadblock || "none"; road[k] = (road[k] || 0) + 1; abc[r.abc]++;
    });

    // Follow-through: how many coaches got to each stage, and how many could have by now (check already open).
    const stages = [{ label: "Workshop", done: coaches.length, open: coaches.length, note: "Signed up" },
      ...CPS.map(cp => ({ label: cp.label, done: coaches.filter(c => c.done[cp.key]).length, open: coaches.filter(c => c.done[cp.key] || isOpen(c, cp, now)).length }))];

    // Timing per week: opened, reminded, done within OVERDUE_DAYS of opening ("on time"), done later, not done yet.
    const timing = CPS.map(cp => {
      const t = { cp, opened: 0, reminded: 0, onTime: 0, late: 0, waiting: 0, days: [] };
      coaches.forEach(c => {
        const x = c.timing[cp.key];
        if (x.reminded) t.reminded++;
        if (c.done[cp.key]) { t.opened++; t.days.push(x.after); if (x.after < OVERDUE_DAYS) t.onTime++; else t.late++; }
        else if (isOpen(c, cp, now) && c.next.cp === cp) { t.opened++; t.waiting++; }
      });
      t.avg = t.days.length ? t.days.reduce((s, d) => s + d, 0) / t.days.length : null;
      return t;
    });

    const counts = {
      coaches: coaches.length,
      done: CPS.map(cp => coaches.filter(c => c.done[cp.key]).length),
      ready: coaches.filter(c => c.next.kind === "ready").length,
      overdue: coaches.filter(c => c.next.kind === "overdue").length,
      complete: coaches.filter(c => c.next.kind === "complete").length
    };

    let list = coaches.filter(c => !q || (c.p.first_name + " " + c.p.last_name + " " + c.p.email).toLowerCase().includes(q));
    const order = { overdue: 0, ready: 1, upcoming: 2, waiting: 3, complete: 4 };
    list.sort(ui.sort === "name"
      ? (a, b) => (a.p.first_name + a.p.last_name).localeCompare(b.p.first_name + b.p.last_name)
      : ui.sort === "recent"
        ? (a, b) => b.last - a.last
        : (a, b) => order[a.next.kind] - order[b.next.kind] || (b.next.late || 0) - (a.next.late || 0) || (a.next.due || 0) - (b.next.due || 0));
    return { coaches, list, weeks, moves, road, roadN, abc, stages, timing, counts };
  }
  /* When check i opens for this coach (same rule as the app and the reminder emails):
     day 14 / 28 / 42 after the start, but never sooner than MIN_GAP_DAYS after the previous check was done.
     Organizations that start at Week 2: Week 2 is open from sign-up. null = no clock yet (no first action). */
  function opensAt(p, i, done) {
    let t;
    if (p.start_date) t = new Date(p.start_date).getTime() + CPS[i].day * DAY;
    else if (i === 0 && startsAtWeek2(p.org)) t = new Date(p.created_at).getTime();
    else return null;
    const prev = i > 0 && done[CPS[i - 1].key];
    if (prev) t = Math.max(t, new Date(prev.checked_at).getTime() + (D.MIN_GAP_DAYS || 0) * DAY);
    return t;
  }
  // Has this check opened for this coach yet?
  function isOpen(c, cp, now) { const t = c.timing[cp.key].opens; return t != null && now >= t; }
  const checkName = () => (ui.check === "latest" ? "each coach's latest check" : CPS.find(cp => cp.key === ui.check).label);
  // Clean whole-number axis: 0 … top in steps of 1, 2, 5, 10…
  function yTicks(max) {
    max = Math.max(1, max);
    const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000].find(s => max / s <= 5) || Math.ceil(max / 5);
    const top = Math.ceil(max / step) * step, ticks = [];
    for (let v = 0; v <= top; v += step) ticks.push(v);
    return { top, ticks };
  }
  // Where is this coach in the programme? (the next check, and whether it's open yet)
  function nextState(p, done, now) {
    const i = CPS.findIndex(cp => !done[cp.key]);
    if (i === -1) return { kind: "complete", label: "Programme complete" };
    const cp = CPS[i], due = opensAt(p, i, done);
    if (due == null) return { kind: "waiting", cp, label: "No first action yet" };
    if (now < due) return { kind: "upcoming", cp, due, label: `Opens ${fmtDate(due)}` };
    const late = Math.floor((now - due) / DAY);
    if (late >= OVERDUE_DAYS) return { kind: "overdue", cp, due, late, label: `Overdue ${late} days` };
    return { kind: "ready", cp, due, late, label: late ? `Open ${late} day${late === 1 ? "" : "s"}` : "Open today" };
  }

  /* ---------- Views: sign in ---------- */
  const errLine = () => (ui.err ? `<p class="dx-hint cc-auth-err" role="alert">${esc(ui.err)}</p>` : "");
  function vLogin() {
    return `<section class="dx-screen cc-auth dsh-auth">
      <img class="cc-logo" src="../assets/logo.png" alt="Coaching starts with you" width="720" height="258">
      <p class="dx-label dx-label--muted">ADMIN</p>
      <h1 class="dx-title">DASHBOARD</h1>
      <p class="dx-intro">Enter your admin email. We'll send you a 6-digit code.</p>
      <label class="cc-field"><span class="cc-field-label">EMAIL</span>
        <input class="cc-input" id="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" value="${esc(ui.email)}"></label>
      ${errLine()}
      <div class="dx-spacer"></div>
      <div class="cc-foot"><button class="dx-btn dx-btn--ink" id="send" data-act="send"${emailOk(ui.email) && !ui.busy ? "" : " disabled"}>${ui.busy ? "SENDING…" : `SEND MY CODE ${ICON.arrow}`}</button></div>
    </section>`;
  }
  function vCode() {
    const c = ui.code, wait = Math.ceil((ui.resentAt + 30000 - Date.now()) / 1000);
    const boxes = [0, 1, 2, 3, 4, 5].map(k => `<span class="cc-code-box${k === Math.min(c.length, 5) ? " is-next" : ""}">${esc(c[k] || "")}</span>`).join("");
    return `<section class="dx-screen cc-auth dsh-auth">
      <div class="cc-top"><button class="cc-back" data-act="toLogin" aria-label="Back">${ICON.back}</button></div>
      <h1 class="dx-title" style="margin-top:26px">CHECK YOUR EMAIL</h1>
      <div class="cc-field"><span class="cc-field-label">EMAIL</span><p class="cc-input cc-input--read">${esc(ui.email.trim().toLowerCase())}</p></div>
      <p class="cc-field-label cc-field-gap">ENTER THE 6-DIGIT CODE WE SENT YOU</p>
      <label class="cc-code"><input id="code" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" value="${esc(c)}" aria-label="6-digit code">${boxes}</label>
      ${errLine()}
      <div class="cc-links">
        <button class="cc-link" data-act="resend"${wait > 0 ? " disabled" : ""}>${wait > 0 ? `NEW CODE IN ${wait}S` : "SEND A NEW CODE"}</button>
        <button class="cc-link" data-act="toLogin">CHANGE EMAIL</button>
      </div>
    </section>`;
  }
  function vDenied() {
    return `<section class="dx-screen cc-auth dsh-auth">
      <img class="cc-logo" src="../assets/logo.png" alt="Coaching starts with you" width="720" height="258">
      <p class="dx-label dx-label--muted">ADMIN</p>
      <h1 class="dx-title">NO DASHBOARD ACCESS</h1>
      <p class="dx-intro">This email isn't on the admin list. If you should have access, ask the programme team to add you.</p>
      <div class="dx-spacer"></div>
      <div class="cc-foot"><button class="dx-btn dx-btn--outline" data-act="toLogin">USE ANOTHER EMAIL</button></div>
    </section>`;
  }
  const vLoading = () => `<section class="dx-screen cc-auth dsh-auth"><p class="dx-intro" style="margin-top:40vh;text-align:center">Loading…</p></section>`;

  /* ---------- Views: dashboard ---------- */
  // Organizations in data.js plus any found on coaches ("" = signed up through the plain link).
  function orgOptions() {
    const orgs = [...new Set([...Object.keys(D.ORGANIZATIONS), ...data.profiles.map(p => p.org || "")])];
    return [["all", "All organizations"], ...orgs.map(o => [o, orgName(o)])]
      .map(([v, l]) => `<option value="${esc(v)}"${ui.org === v ? " selected" : ""}>${esc(l)}</option>`).join("");
  }
  function vShell() {
    return `<div class="dsh">
      <header class="dsh-head">
        <div class="dsh-brand"><img class="dsh-logo" src="../assets/logo.png" alt="Coaching starts with you" width="720" height="258">
          <div><p class="dx-label dx-label--muted">ADMIN DASHBOARD</p><h1 class="dx-title dx-title--xl dsh-title">FOLLOW-THROUGH</h1></div></div>
        <div class="dsh-head-r"><span class="dsh-live" id="live"><i></i><span></span></span><span class="dsh-updated" id="updated"></span>
          <button class="dsh-link" data-act="signOut">SIGN OUT</button></div>
      </header>
      <div class="dsh-filters">
        <label class="cc-field"><span class="cc-field-label">ORGANIZATION</span>
          <span class="cc-select"><select class="cc-input" id="f-org">${orgOptions()}</select>${ICON.down}</span></label>
        <label class="cc-field"><span class="cc-field-label">CHECK</span>
          <span class="cc-select"><select class="cc-input" id="f-check">${[["latest", "Latest check"], ...CPS.map(cp => [cp.key, cp.label])]
            .map(([v, l]) => `<option value="${v}"${ui.check === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>${ICON.down}</span></label>
        <div class="dsh-spacer"></div>
        <button class="dsh-btn-sm" data-act="csv">DOWNLOAD CSV</button>
      </div>
      <div id="content"></div>
      <p class="dsh-foot">Overdue = a check that has been open for ${OVERDUE_DAYS}+ days. Each coach counts once per week (their latest check for that week).</p>
    </div>`;
  }

  function vContent(m) {
    if (ui.err && !data.profiles.length) return `<p class="dx-hint" role="alert" style="margin-top:22px">${esc(ui.err)}</p>`;
    const N = m.counts.coaches;
    const kpi = (label, value, sub, frac, dark) => `<div class="dsh-kpi${dark ? " dsh-kpi--dark" : ""}"><p class="dsh-kpi-label">${label}</p>
      <p class="dsh-kpi-value">${value}</p>${frac != null ? `<span class="dsh-meter" role="img" aria-label="${pct(frac[0], frac[1])}%"><i style="width:${pct(frac[0], frac[1])}%"></i></span>` : ""}
      ${sub ? `<p class="dsh-kpi-sub">${sub}</p>` : ""}</div>`;
    const kpis = `<div class="dsh-kpis">
      ${kpi("COACHES", N, ui.org === "all" ? "Signed up, all organizations" : esc(orgName(ui.org)), null, true)}
      ${CPS.map((cp, i) => kpi(cp.label.toUpperCase() + " DONE", `${m.counts.done[i]}<small>/ ${N}</small>`, `${pct(m.counts.done[i], N)}% of coaches`, [m.counts.done[i], N])).join("")}
      ${kpi("WAITING ON", m.counts.ready + m.counts.overdue,
        m.counts.overdue ? `<span class="dsh-flag">${ICON.alert}${m.counts.overdue} overdue</span>` : "Check open, not done yet")}
    </div>`;
    if (!N) return errBanner() + kpis + `<div class="dsh-card" style="margin-top:16px"><p class="dsh-empty" style="margin:0">No coaches have signed up${ui.org === "all" ? "" : " in this organization"} yet.</p></div>`;
    return errBanner() + kpis + `<div class="dsh-grid">
      ${cardFollow(m)}${cardBars(m)}${cardTiming(m)}${cardABC(m)}${cardScore(m)}${cardMoves(m)}${cardRoad(m)}${cardQuestions(m)}${cardChoices(m)}${cardWords(m)}${cardCoaches(m)}
    </div>`;
  }
  const errBanner = () => (ui.err ? `<p class="dx-hint" role="alert" style="margin-top:18px">${esc(ui.err)}</p>` : "");

  // Where coaches are, each week: A / B / C share (tall segmented bars, one per week).
  function cardABC(m) {
    const rows = m.weeks.map(w => {
      const label = `<span class="dsh-row-label">${esc(w.cp.label)}<small>${w.n} coach${w.n === 1 ? "" : "es"}</small></span>`;
      if (!w.n) return `<div class="dsh-seg-row">${label}<div class="dsh-seg-empty">No checks yet</div></div>`;
      const parts = ["A", "B", "C"].filter(L => w.count[L]).map(L => {
        const share = pct(w.count[L], w.n);
        return `<span class="dsh-seg-part s-${L}" style="flex:${w.count[L]}" tabindex="0"
          data-tip="<b>${w.cp.label} · ${L}</b> ${esc(ABC_NAME(L))}<br>${w.count[L]} coach${w.count[L] === 1 ? "" : "es"} (${share}%)">${share >= 14 ? share + "%" : ""}</span>`;
      }).join("");
      const aria = ["A", "B", "C"].map(L => `${L} ${w.count[L]} (${pct(w.count[L], w.n)}%)`).join(", ");
      return `<div class="dsh-seg-row">${label}<div class="dsh-seg" role="img" aria-label="${esc(w.cp.label)}: ${aria}">${parts}</div></div>`;
    }).join("");
    return `<section class="dsh-card"><h2 class="dsh-card-title">Where coaches are</h2>
      <p class="dsh-card-sub">Share of coaches at A, B and C at each check. The goal: the dark part grows week by week.</p>
      <div class="dsh-seg-rows">${rows}</div>
      <ul class="dsh-legend">${["A", "B", "C"].map(L => `<li><span class="dsh-sw s-${L}"></span><b>${L}</b>${esc(ABC_NAME(L))}</li>`).join("")}</ul>
    </section>`;
  }

  // Average score (out of 10) per week: one series, columns.
  function cardScore(m) {
    const H = 176, ticks = [0, 5, 10];
    const grid = ticks.map(t => `<i class="${t === 0 ? "base" : ""}" style="bottom:${(t / 10) * H}px"></i>`).join("");
    const axis = ticks.map(t => `<span style="bottom:${34 + (t / 10) * H}px">${t}</span>`).join("");
    const cols = m.weeks.map(w => {
      const lab = `<span class="dsh-col-lab"><b>${esc(w.cp.label)}</b><small>${w.n} coach${w.n === 1 ? "" : "es"}</small></span>`;
      if (w.avg == null) return `<div class="dsh-col"><span class="dsh-col-none">No checks</span>${lab}</div>`;
      const v = w.avg.toFixed(1);
      return `<div class="dsh-col"><span class="dsh-col-val">${v}</span><span class="dsh-col-bar" style="height:${(w.avg / 10) * H}px"></span>${lab}
        <span class="dsh-col-hit" tabindex="0" data-tip="<b>${w.cp.label}</b><br>Average score ${v} / 10<br>${w.n} coach${w.n === 1 ? "" : "es"}"></span></div>`;
    }).join("");
    return `<section class="dsh-card"><h2 class="dsh-card-title">Average score</h2>
      <p class="dsh-card-sub">Out of 10 (5 questions: Yes = 2, Partly = 1, No = 0).</p>
      <div class="dsh-cols"><div class="dsh-cols-axis">${axis}</div><div class="dsh-cols-plot">${grid}</div>${cols}</div>
    </section>`;
  }

  // Who moved up, stayed, or slipped between two checks (coaches who did both).
  function cardMoves(m) {
    const box = mv => `<div class="dsh-move"><p class="dsh-move-head">${esc(mv.from.label)} → ${esc(mv.to.label)}</p>
      ${mv.n ? [["up", "Moved up", ICON.up], ["same", "Stayed the same", ICON.same], ["down", "Slipped back", ICON.fall]].map(([k, l, ic]) =>
        `<div class="dsh-move-row">${ic}<b>${mv[k]}</b>${l}</div>`).join("") : `<p class="dsh-empty">Nobody has done both yet.</p>`}</div>`;
    return `<section class="dsh-card"><h2 class="dsh-card-title">Movement</h2>
      <p class="dsh-card-sub">Coaches whose letter went up (e.g. C → B, B → A), stayed, or went down between two checks.</p>
      <div class="dsh-moves">${m.moves.map(box).join("")}</div></section>`;
  }

  // Follow-through line: people (up) at each stage (along): Workshop → Week 2 → Week 4 → Week 6.
  // Black = completed. Grey = could have by now (the check has opened), so "not open yet" never looks like drop-off.
  function cardFollow(m) {
    const S = m.stages, { top, ticks } = yTicks(Math.max(...S.map(s => s.open)));
    const x = i => (i / (S.length - 1)) * 100, y = v => (v / top) * 100;
    // A step nobody could have reached yet (its check hasn't opened for anyone) is left off the line, not drawn as 0.
    const on = (s, i) => i === 0 || s.open > 0;
    const line = key => S.map((s, i) => (on(s, i) ? `${x(i)},${100 - y(s[key])}` : null)).filter(Boolean).join(" ");
    const gap = S.some(s => s.open !== s.done);
    return `<section class="dsh-card"><h2 class="dsh-card-title">Follow-through</h2>
      <p class="dsh-card-sub">How many coaches completed each step of the programme.</p>
      <div class="dsh-chart">
        <div class="dsh-plot">
          ${ticks.map(t => `<i class="dsh-gl${t === 0 ? " base" : ""}" style="bottom:${y(t)}%"></i><span class="dsh-yl" style="bottom:${y(t)}%">${t}</span>`).join("")}
          <svg class="dsh-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            ${gap ? `<polyline class="open" points="${line("open")}"/>` : ""}<polyline class="done" points="${line("done")}"/></svg>
          ${S.map((s, i) => `${on(s, i) ? `${gap && s.open !== s.done ? `<span class="dsh-pt open" style="left:${x(i)}%;bottom:${y(s.open)}%"></span>` : ""}
            <span class="dsh-pt" style="left:${x(i)}%;bottom:${y(s.done)}%"></span>
            <span class="dsh-pt-val" style="left:${x(i)}%;bottom:${y(s.done)}%">${s.done}</span>` : ""}
            <span class="dsh-xl" style="left:${x(i)}%">${esc(s.label)}${on(s, i) ? "" : "<small>not open yet</small>"}</span>
            <span class="dsh-hit" style="left:${x(i)}%" tabindex="0" data-tip="<b>${esc(s.label)}</b><br>${!i ? `${s.done} coaches signed up`
              : on(s, i) ? `${s.done} completed · ${s.open} could have by now` : "This check hasn't opened for anyone yet"}"></span>`).join("")}
        </div>
      </div>
      <ul class="dsh-legend"><li><span class="dsh-key"></span>Completed</li>${gap ? `<li><span class="dsh-key open"></span>Check open by now</li>` : ""}</ul>
      <table class="dsh-sr"><caption>Follow-through</caption><tr><th>Stage</th><th>Completed</th><th>Open by now</th></tr>
        ${S.map(s => `<tr><td>${esc(s.label)}</td><td>${s.done}</td><td>${s.open}</td></tr>`).join("")}</table>
    </section>`;
  }

  // A / B / C bar chart: people (up) at A, B and C (along), at the check chosen in the filter.
  function cardBars(m) {
    const n = m.abc.A + m.abc.B + m.abc.C, { top, ticks } = yTicks(Math.max(m.abc.A, m.abc.B, m.abc.C));
    const y = v => (v / top) * 100;
    const body = !n ? `<p class="dsh-empty">No checks ${ui.check === "latest" ? "yet" : "at " + esc(checkName()) + " yet"}.</p>` : `<div class="dsh-chart">
        <div class="dsh-plot">
          ${ticks.map(t => `<i class="dsh-gl${t === 0 ? " base" : ""}" style="bottom:${y(t)}%"></i><span class="dsh-yl" style="bottom:${y(t)}%">${t}</span>`).join("")}
          <div class="dsh-bars">${["A", "B", "C"].map(L => `<div class="dsh-bar-slot" tabindex="0"
            data-tip="<b>${L}</b> ${esc(ABC_NAME(L))}<br>${m.abc[L]} of ${n} coach${n === 1 ? "" : "es"} (${pct(m.abc[L], n)}%)">
            <span class="dsh-bar-val" style="bottom:${y(m.abc[L])}%">${m.abc[L]}</span>
            <span class="dsh-bar s-${L}${m.abc[L] ? "" : " is-zero"}" style="height:${y(m.abc[L])}%"></span>
            <span class="dsh-bar-x"><span class="dsh-letter is-${L}">${L}</span><small>${esc(ABC_NAME(L))}</small></span></div>`).join("")}</div>
        </div>
      </div>`;
    return `<section class="dsh-card"><h2 class="dsh-card-title">A · B · C</h2>
      <p class="dsh-card-sub">How many coaches are at A, B and C, at ${esc(checkName())} (${n} coach${n === 1 ? "" : "es"}). Change it with the Check filter at the top.</p>
      ${body}</section>`;
  }

  // Timing: who does their check when. On time = within OVERDUE_DAYS of it opening. Each coach's own clock.
  function cardTiming(m) {
    const T = m.timing, any = T.some(t => t.opened || t.reminded);
    const cell = v => `<td class="num">${v == null || v === "" ? `<span class="dsh-dash">–</span>` : v}</td>`;
    const rate = t => (t.onTime + t.late ? `${pct(t.onTime, t.onTime + t.late)}%` : null);
    const rows = [
      ["Check opened", t => t.opened || null],
      ["Reminder email sent", t => t.reminded || null],
      [`Done within ${OVERDUE_DAYS} days`, t => t.onTime || null],
      ["Done later", t => t.late || null],
      ["Open, not done yet", t => t.waiting || null],
      ["Average days to do it", t => (t.avg == null ? null : t.avg.toFixed(1))],
      ["On-time rate", rate]
    ];
    return `<section class="dsh-card"><h2 class="dsh-card-title">Timing</h2>
      <p class="dsh-card-sub">Each coach has their own clock. A check opens 14 days after the last step (never sooner than ${D.MIN_GAP_DAYS || 0} days after their previous check), and a reminder email goes out at 9 AM Eastern that day.</p>
      ${any ? `<div class="dsh-table-wrap"><table class="dsh-table"><thead><tr><th></th>${T.map(t => `<th class="num">${esc(t.cp.label.toUpperCase())}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(([l, f]) => `<tr${l === "On-time rate" ? ' class="dsh-total"' : ""}><td>${esc(l)}</td>${T.map(t => cell(f(t))).join("")}</tr>`).join("")}</tbody></table></div>`
        : `<p class="dsh-empty">Shows once the first checks open.</p>`}
    </section>`;
  }

  // Roadblocks at the chosen check: one series, horizontal bars.
  function cardRoad(m) {
    const keys = [...Object.keys(D.ROADBLOCKS).filter(k => D.ROADBLOCK_RULES.some(r => r.key === k)), "none"];
    const max = Math.max(1, ...keys.map(k => m.road[k] || 0));
    const rows = keys.map(k => {
      const n = m.road[k] || 0, R = D.ROADBLOCKS[k];
      const name = R ? R.name : "None showing", sub = R ? R.gateway : "All five answers Yes";
      return `<div class="dsh-hbar"><span class="dsh-hbar-label">${esc(name)}<small>${esc(sub)}</small></span>
        <span class="dsh-hbar-track" tabindex="0" data-tip="<b>${esc(name)}</b><br>${n} of ${m.roadN} coach${m.roadN === 1 ? "" : "es"} (${pct(n, m.roadN)}%)">
          <span class="dsh-hbar-bar${n ? "" : " is-zero"}" style="width:${(n / max) * 80}%"></span><span class="dsh-hbar-val">${n}</span></span></div>`;
    }).join("");
    return `<section class="dsh-card"><h2 class="dsh-card-title">Roadblocks</h2>
      <p class="dsh-card-sub">What's getting in the way, at ${esc(checkName())} (${m.roadN} coach${m.roadN === 1 ? "" : "es"}).</p>
      ${m.roadN ? `<div class="dsh-hbars">${rows}</div>` : `<p class="dsh-empty">Shows after the first Week 2 check.</p>`}</section>`;
  }

  // Average answer per question, per week: heatmap table (darker = more Yes).
  function cardQuestions(m) {
    const latestW = [...m.weeks].reverse().find(w => w.n);
    let lowest = -1;
    if (latestW) { let lo = 9; latestW.qAvg.forEach((v, i) => { if (v < lo) { lo = v; lowest = i; } }); }
    const cell = (v, w, i) => {
      if (v == null) return `<td class="none">–</td>`;
      const t = v / 2, c = Math.round(236 - t * (236 - 17)), ink = t > 0.5 ? "#fff" : "#111";
      return `<td style="background:rgb(${c},${c},${Math.round(234 - t * (234 - 17))});color:${ink}" tabindex="0"
        data-tip="<b>${esc(D.QUESTIONS[i].short)}</b> · ${w.cp.label}<br>Average ${v.toFixed(1)} of 2 (${w.n} coach${w.n === 1 ? "" : "es"})">${v.toFixed(1)}</td>`;
    };
    const rows = D.QUESTIONS.map((Q, i) => `<tr><th scope="row"><span class="dsh-q-num">0${i + 1}</span>${esc(Q.short)}${i === lowest ? `<span class="dsh-tag">LOWEST</span>` : ""}</th>
      ${m.weeks.map(w => cell(w.qAvg[i], w, i)).join("")}</tr>`).join("");
    return `<section class="dsh-card"><h2 class="dsh-card-title">The five questions</h2>
      <p class="dsh-card-sub">Average answer per question (0 = No, 1 = Partly, 2 = Yes). "Lowest" = the weakest question at the latest check.</p>
      <table class="dsh-heat"><thead><tr><th scope="col">Question</th>${m.weeks.map(w => `<th scope="col">${esc(w.cp.label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
      <div class="dsh-scale"><span>No</span><i aria-hidden="true"></i><span>Yes</span></div></section>`;
  }

  // What coaches decided about their action at each check.
  function cardChoices(m) {
    const used = CHOICES.filter(([k]) => m.weeks.some(w => w.choices[k]));
    const body = used.length ? `<div class="dsh-table-wrap"><table class="dsh-table"><thead><tr><th>CHOICE</th>${m.weeks.map(w => `<th class="num">${esc(w.cp.label.toUpperCase())}</th>`).join("")}</tr></thead>
      <tbody>${used.map(([k, l]) => `<tr><td>${esc(l)}</td>${m.weeks.map(w => `<td class="num">${w.choices[k] || `<span class="dsh-dash">–</span>`}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${(() => { const s = m.weeks.reduce((t, w) => t + w.sameWords, 0); return s ? `<p class="dsh-note">${s} time${s === 1 ? "" : "s"} a coach chose to change their action but kept the same words.</p>` : ""; })()}`
      : `<p class="dsh-empty">Shows after the first check.</p>`;
    return `<section class="dsh-card"><h2 class="dsh-card-title">Action choices</h2>
      <p class="dsh-card-sub">What coaches did with their action at each check.</p>${body}</section>`;
  }

  // Every coach: where they are, each week's letter, and their current action. Click a row for details.
  function cardCoaches(m) {
    const weekCell = (c, cp) => {
      const r = c.done[cp.key], t = c.timing[cp.key];
      const remind = t.reminded ? `Reminder sent ${fmtDate(t.reminded)}` : "";
      if (r) {
        const when = t.after == null ? "" : t.after === 0 ? "Same day" : `+${t.after} day${t.after === 1 ? "" : "s"}`;
        const tip = `<b>${cp.label} · ${r.abc}</b> ${esc(ABC_NAME(r.abc))}<br>Score ${r.score}/10 · done ${fmtDate(r.checked_at)}`
          + (t.after == null ? "" : `<br>${t.after === 0 ? "Done the day it opened" : `Done ${t.after} day${t.after === 1 ? "" : "s"} after it opened`}`)
          + (remind ? `<br>${remind}` : "");
        return `<span class="dsh-letter is-${r.abc}" tabindex="0" data-tip="${tip}">${r.abc}</span><span class="dsh-score">${r.score}</span>`
          + (when ? `<span class="dsh-when${t.after >= OVERDUE_DAYS ? " is-late" : ""}">${when}</span>` : "");
      }
      if (c.next.cp === cp) {
        const sub = remind ? `<span class="dsh-when">${remind}</span>` : "";
        if (c.next.kind === "overdue") return `<span class="dsh-state dsh-flag">${ICON.alert}${esc(c.next.label)}</span>${sub}`;
        return `<span class="dsh-state${c.next.kind === "ready" ? " is-ready" : ""}">${esc(c.next.label)}</span>${sub}`;
      }
      return `<span class="dsh-dash">–</span>`;
    };
    const rows = m.list.map(c => {
      const P = c.p, open = ui.open === P.id;
      const act = P.current_action_when ? `When <b>${esc(P.current_action_when.replace(/,$/, ""))}</b>, I will <b>${esc(P.current_action_will.replace(/\.$/, ""))}</b>.` : `<span class="dsh-dash">No action yet</span>`;
      const main = `<tr class="dsh-coach-row${ui.newRows.has(P.id) ? " is-new" : ""}" data-act="toggle" data-v="${P.id}" aria-expanded="${open}" tabindex="0">
        <td><span class="dsh-name">${esc(P.first_name)} ${esc(P.last_name)}</span><span class="dsh-email">${esc(P.email)}</span></td>
        <td class="dsh-org">${esc(orgName(P.org))}</td>
        ${CPS.map(cp => `<td>${weekCell(c, cp)}</td>`).join("")}
        <td class="dsh-action">${act}</td>
        <td><span class="dsh-chev">${ICON.down}</span></td></tr>`;
      return open ? main + `<tr class="dsh-detail"><td colspan="${4 + CPS.length}">${detail(c)}</td></tr>` : main;
    }).join("");
    return `<section class="dsh-card dsh-card--wide"><h2 class="dsh-card-title">Coaches</h2>
      <p class="dsh-card-sub">Every coach, their letter at each check (number = score out of 10) and their current action. Click a coach for their answers.</p>
      <div class="dsh-filters" style="margin-top:16px;padding-top:0;border-top:0">
        <label class="cc-field"><span class="cc-field-label">SEARCH</span><input class="cc-input" id="f-search" type="search" placeholder="Name or email" value="${esc(ui.search)}"></label>
        <label class="cc-field"><span class="cc-field-label">SORT BY</span><span class="cc-select"><select class="cc-input" id="f-sort">
          ${[["attention", "Needs attention first"], ["recent", "Latest activity"], ["name", "Name"]].map(([v, l]) => `<option value="${v}"${ui.sort === v ? " selected" : ""}>${l}</option>`).join("")}
        </select>${ICON.down}</span></label></div>
      ${m.list.length ? `<div class="dsh-table-wrap"><table class="dsh-table dsh-coaches"><thead><tr><th>COACH</th><th>ORGANIZATION</th>${CPS.map(cp => `<th>${esc(cp.label.toUpperCase())}</th>`).join("")}<th>CURRENT ACTION</th><th><span class="cc-sr" style="position:absolute;left:-9999px">Details</span></th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : `<p class="dsh-empty">No coach matches “${esc(ui.search)}”.</p>`}
    </section>`;
  }
  // The three written answers (question 06) of a check or of workshop day (row has reflect_well / _when / _will).
  const WORDS = [["well", "Doing well"], ["when", "Falls back when…"], ["will", "Will do differently"]];
  const wordsList = row => `<dl class="dsh-words-dl">${WORDS.map(([k, l]) => row["reflect_" + k]
    ? `<dt>${esc(l)}</dt><dd>${esc(row["reflect_" + k])}</dd>` : "").join("")}</dl>`;

  /* "In their words": the latest written answers to each of the three questions, across the coaches shown
     (organization filter), newest first, with who and when. */
  function cardWords(m) {
    const items = [];
    m.coaches.forEach(c => {
      const who = `${c.p.first_name} ${(c.p.last_name || "").charAt(0)}.`;
      if (c.p.reflect_well || c.p.reflect_when) items.push({ row: c.p, who, when: "Workshop", at: c.p.first_action_date || c.p.created_at });
      CPS.forEach(cp => { const r = c.done[cp.key]; if (r && (r.reflect_well || r.reflect_when)) items.push({ row: r, who, when: cp.label, at: r.checked_at }); });
    });
    items.sort((a, b) => (a.at < b.at ? 1 : -1));
    const LIMIT = 8;
    const col = ([k, l], i) => {
      const list = items.filter(x => x.row["reflect_" + k]).slice(0, LIMIT);
      return `<div class="dsh-words-col"><p class="dsh-words-head">${esc(D.REFLECT.items[i].q)}</p>
        ${list.length ? `<ul class="dsh-words-list">${list.map(x => `<li><span class="dsh-words-q">${k === "when" ? "When " : k === "will" ? "I will " : ""}${esc(x.row["reflect_" + k])}</span>
          <span class="dsh-words-who">${esc(x.who)} · ${esc(x.when)}</span></li>`).join("")}</ul>` : `<p class="dsh-empty">No answers yet.</p>`}</div>`;
    };
    return `<section class="dsh-card dsh-card--wide"><h2 class="dsh-card-title">In their words</h2>
      <p class="dsh-card-sub">The latest written answers to question 06 (and on workshop day), newest first. Look for patterns: the same moments and habits coming up again and again.</p>
      <div class="dsh-words">${WORDS.map(col).join("")}</div></section>`;
  }

  function detail(c) {
    const P = c.p;
    const first = (P.first_action_when ? `<p>First action (${P.first_action_date ? fmtDate(P.first_action_date) : ""}): When <b>${esc(P.first_action_when.replace(/,$/, ""))}</b>, I will <b>${esc(P.first_action_will.replace(/\.$/, ""))}</b>.</p>` : "")
      + (P.reflect_well || P.reflect_when ? `<div class="dsh-words-det"><p class="dsh-words-head">WORKSHOP DAY, IN THEIR WORDS</p>${wordsList(P)}</div>` : "");
    const boxes = CPS.map(cp => {
      const r = c.done[cp.key];
      if (!r) return `<div class="dsh-det dsh-det-empty">${esc(cp.label)}: not done</div>`;
      const ans = [r.q1, r.q2, r.q3, r.q4, r.q5];
      const dots = p => `<span class="cc-dots" role="img" aria-label="${["No", "Partly", "Yes"][p]}"><i${p > 0 ? ' class="on"' : ""}></i><i${p > 1 ? ' class="on"' : ""}></i></span>`;
      const choice = (CHOICES.find(([k]) => k === r.action_choice) || [0, ""])[1];
      return `<div class="dsh-det"><div class="dsh-det-head"><span class="dsh-letter is-${r.abc}">${r.abc}</span><b>${esc(cp.label)}</b><span>${r.score}/10 · ${fmtDate(r.checked_at)}</span></div>
        <ol class="cc-rows">${ans.map((p, i) => `<li class="cc-r"><span class="cc-num">0${i + 1}</span><span class="t">${esc(D.QUESTIONS[i].short)}</span>${dots(p)}</li>`).join("")}</ol>
        ${r.reflect_well || r.reflect_when ? `<div class="dsh-words-det">${wordsList(r)}</div>` : ""}
        <p>Roadblock: <b>${esc(r.roadblock ? D.ROADBLOCKS[r.roadblock].name : "None showing")}</b></p>
        ${r.action_when ? `<p>${esc(choice)}${r.action_changed === false && r.action_choice !== "keep" ? " (same words)" : ""}: When <b>${esc(r.action_when.replace(/,$/, ""))}</b>, I will <b>${esc(r.action_will.replace(/\.$/, ""))}</b>.</p>` : ""}</div>`;
    }).join("");
    return `${first}<div class="dsh-detail-grid" style="margin-top:10px">${boxes}</div>
      <p class="dsh-note">Signed up ${fmtDate(P.created_at)}${P.start_date ? ` · programme clock started ${fmtDate(P.start_date)}` : ""} · ${esc(P.gender)} · ${esc(P.age_bracket)}</p>`;
  }

  /* ---------- Render ---------- */
  function render() {
    hideTip();
    if (ui.view !== "dash") {
      $dash.innerHTML = { loading: vLoading, login: vLogin, code: vCode, denied: vDenied }[ui.view]();
      return bindAuth();
    }
    if (!document.getElementById("content")) { $dash.innerHTML = vShell(); bindShell(); }
    const orgSel = document.getElementById("f-org"), opts = orgOptions();
    if (orgSel.dataset.opts !== opts) { orgSel.innerHTML = opts; orgSel.dataset.opts = opts; }
    const content = document.getElementById("content");
    const search = document.getElementById("f-search"), hadFocus = search && document.activeElement === search, caret = hadFocus ? search.selectionStart : 0;
    content.innerHTML = vContent(model());
    bindContent();
    if (hadFocus) { const s = document.getElementById("f-search"); s.focus(); s.setSelectionRange(caret, caret); }
    paintLive();
  }
  function paintLive() {
    const l = document.getElementById("live"), u = document.getElementById("updated");
    if (l) { l.classList.toggle("is-on", ui.live); l.lastElementChild.textContent = ui.live ? "LIVE" : "CONNECTING"; }
    if (u) u.textContent = ui.updated ? `Updated ${fmtTime(ui.updated)}` : "";
  }
  function showToast(text) {
    const old = document.querySelector(".dsh-toast"); if (old) old.remove();
    const t = document.createElement("div"); t.className = "dsh-toast"; t.setAttribute("role", "status");
    t.innerHTML = `<i></i><span>${esc(text)}</span>`; document.body.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  /* ---------- Inputs ---------- */
  let resendTimer = null;
  function bindAuth() {
    clearInterval(resendTimer);
    const em = document.getElementById("email"), send = document.getElementById("send");
    if (em) {
      em.addEventListener("input", () => { ui.email = em.value; send.disabled = !emailOk(ui.email) || ui.busy; });
      em.addEventListener("keydown", e => { if (e.key === "Enter" && !send.disabled) { e.preventDefault(); sendCode(); } });
      if (!ui.email) em.focus();
    }
    const code = document.getElementById("code");
    if (code) {
      const boxes = document.querySelectorAll(".cc-code-box");
      code.addEventListener("input", () => {
        ui.code = code.value.replace(/\D/g, "").slice(0, 6); code.value = ui.code;
        boxes.forEach((b, k) => { b.textContent = ui.code[k] || ""; b.classList.toggle("is-next", k === Math.min(ui.code.length, 5)); });
        if (ui.code.length === 6) verifyCode();
      });
      code.focus();
      const btn = document.querySelector('[data-act="resend"]');
      resendTimer = setInterval(() => {
        const wait = Math.ceil((ui.resentAt + 30000 - Date.now()) / 1000);
        btn.disabled = wait > 0; btn.textContent = wait > 0 ? `NEW CODE IN ${wait}S` : "SEND A NEW CODE";
        if (wait <= 0) clearInterval(resendTimer);
      }, 1000);
    }
  }
  function bindShell() {
    const org = document.getElementById("f-org");
    org.addEventListener("change", () => { ui.org = org.value; ui.open = null; render(); });
    const chk = document.getElementById("f-check");
    chk.addEventListener("change", () => { ui.check = chk.value; render(); });
  }
  function bindContent() {
    const s = document.getElementById("f-search"), so = document.getElementById("f-sort");
    if (s) s.addEventListener("input", () => { ui.search = s.value; render(); });
    if (so) so.addEventListener("change", () => { ui.sort = so.value; render(); });
  }

  const actions = {
    send: sendCode,
    resend() { if (Date.now() - ui.resentAt >= 30000) sendCode(); },
    toLogin() { ui.view = "login"; ui.code = ""; ui.err = ""; render(); },
    signOut,
    toggle(el) { ui.open = ui.open === el.dataset.v ? null : el.dataset.v; render(); },
    csv: exportCSV
  };
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el);
  });
  document.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr[data-act]")) { e.preventDefault(); e.target.click(); }
    if (e.key === "Escape") hideTip();
  });

  /* ---------- Tooltip: hover with the mouse, or keyboard focus ---------- */
  function showTip(el, x, y) {
    $tip.innerHTML = el.dataset.tip; $tip.hidden = false;
    const r = $tip.getBoundingClientRect(), pad = 12;
    if (x == null) { const b = el.getBoundingClientRect(); x = b.left + b.width / 2; y = b.top; }
    let left = x + pad, top = y - r.height - pad;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - pad;
    if (top < 8) top = y + pad + 8;
    $tip.style.left = Math.max(8, left) + "px"; $tip.style.top = top + "px";
  }
  function hideTip() { $tip.hidden = true; }
  document.addEventListener("mousemove", e => {
    const el = e.target.closest && e.target.closest("[data-tip]");
    if (el) showTip(el, e.clientX, e.clientY); else if (!$tip.hidden && !(document.activeElement && document.activeElement.dataset && document.activeElement.dataset.tip)) hideTip();
  });
  document.addEventListener("focusin", e => { if (e.target.dataset && e.target.dataset.tip) showTip(e.target); });
  document.addEventListener("focusout", hideTip);
  window.addEventListener("scroll", hideTip, { passive: true });

  /* ---------- CSV: every check with the coach's details (follows the organization filter) ---------- */
  function exportCSV() {
    const inOrg = p => ui.org === "all" || (p.org || "") === ui.org;
    const P = Object.fromEntries(data.profiles.filter(inOrg).map(p => [p.id, p]));
    const head = ["first_name", "last_name", "email", "organization", "gender", "age_bracket", "signed_up", "checkpoint", "date",
      "q1", "q2", "q3", "q4", "q5", "score", "max", "status", "abc", "roadblock", "action_when", "action_will", "action_choice", "action_changed",
      "doing_well", "falls_back_when", "will_do_differently"];
    const q = s => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
    const lines = data.checks.filter(c => P[c.user_id]).map(c => { const p = P[c.user_id];
      return [p.first_name, p.last_name, p.email, p.org_name || "", p.gender, p.age_bracket, p.created_at, c.checkpoint, c.checked_at,
        c.q1, c.q2, c.q3, c.q4, c.q5, c.score, c.max_score, c.status, c.abc, c.roadblock, c.action_when, c.action_will, c.action_choice,
        c.action_changed == null ? "" : c.action_changed ? "yes" : "no", c.reflect_well, c.reflect_when, c.reflect_will].map(q).join(","); });
    const blob = new Blob([head.join(",") + "\n" + lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `coaching-checks-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- Start: already signed in on this computer? ---------- */
  (async () => {
    render();
    try {
      const { data: s } = await sb.auth.getSession();
      if (s.session) { ui.email = s.session.user.email || ""; return enter(); }
    } catch (e) { /* offline */ }
    ui.view = "login"; render();
  })();
})();

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
    org: "all", search: "", sort: "attention", open: null, live: false, updated: null, newRows: new Set(), toast: null };
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
    const [p, c] = await Promise.all([
      sb.from("profiles").select("*"),
      sb.from("checks").select("*").order("checked_at", { ascending: true })
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
    data = { profiles: p.data, checks: c.data };
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
    const coaches = profiles.map(p => {
      const done = by[p.id] || {};
      const latest = [...CPS].reverse().map(cp => done[cp.key]).find(Boolean) || null;
      const last = Object.values(done).reduce((t, c) => Math.max(t, new Date(c.checked_at).getTime()), new Date(p.created_at).getTime());
      return { p, done, latest, last, next: nextState(p, done, now) };
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

    const road = {}; let roadN = 0;
    coaches.forEach(c => { if (!c.latest) return; roadN++; const k = c.latest.roadblock || "none"; road[k] = (road[k] || 0) + 1; });

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
    return { coaches, list, weeks, moves, road, roadN, counts };
  }
  // Where is this coach in the programme? (the next check, and whether it's open yet)
  function nextState(p, done, now) {
    const i = CPS.findIndex(cp => !done[cp.key]);
    if (i === -1) return { kind: "complete", label: "Programme complete" };
    const cp = CPS[i];
    let due;
    if (p.start_date) due = new Date(p.start_date).getTime() + cp.day * DAY;
    else if (i === 0 && startsAtWeek2(p.org)) due = new Date(p.created_at).getTime();   // workshop already happened: Week 2 open from sign-up
    else return { kind: "waiting", cp, label: "No first action yet" };
    if (now < due) return { kind: "upcoming", cp, due, label: `Opens ${fmtDate(due)}` };
    const late = Math.floor((now - due) / DAY);
    if (late >= OVERDUE_DAYS) return { kind: "overdue", cp, due, late, label: `Overdue ${late} days` };
    return { kind: "ready", cp, due, late, label: late ? `Open ${late} day${late === 1 ? "" : "s"}` : "Open today" };
  }

  /* ---------- Views: sign in ---------- */
  const errLine = () => (ui.err ? `<p class="dx-hint cc-auth-err" role="alert">${esc(ui.err)}</p>` : "");
  function vLogin() {
    return `<section class="dx-screen cc-auth ad-auth">
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
    return `<section class="dx-screen cc-auth ad-auth">
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
    return `<section class="dx-screen cc-auth ad-auth">
      <img class="cc-logo" src="../assets/logo.png" alt="Coaching starts with you" width="720" height="258">
      <p class="dx-label dx-label--muted">ADMIN</p>
      <h1 class="dx-title">NO DASHBOARD ACCESS</h1>
      <p class="dx-intro">This email isn't on the admin list. If you should have access, ask the programme team to add you.</p>
      <div class="dx-spacer"></div>
      <div class="cc-foot"><button class="dx-btn dx-btn--outline" data-act="toLogin">USE ANOTHER EMAIL</button></div>
    </section>`;
  }
  const vLoading = () => `<section class="dx-screen cc-auth ad-auth"><p class="dx-intro" style="margin-top:40vh;text-align:center">Loading…</p></section>`;

  /* ---------- Views: dashboard ---------- */
  // Organizations in data.js plus any found on coaches ("" = signed up through the plain link).
  function orgOptions() {
    const orgs = [...new Set([...Object.keys(D.ORGANIZATIONS), ...data.profiles.map(p => p.org || "")])];
    return [["all", "All organizations"], ...orgs.map(o => [o, orgName(o)])]
      .map(([v, l]) => `<option value="${esc(v)}"${ui.org === v ? " selected" : ""}>${esc(l)}</option>`).join("");
  }
  function vShell() {
    return `<div class="ad">
      <header class="ad-head">
        <div class="ad-brand"><img class="ad-logo" src="../assets/logo.png" alt="Coaching starts with you" width="720" height="258">
          <div><p class="dx-label dx-label--muted">ADMIN DASHBOARD</p><h1 class="dx-title dx-title--xl ad-title">FOLLOW-THROUGH</h1></div></div>
        <div class="ad-head-r"><span class="ad-live" id="live"><i></i><span></span></span><span class="ad-updated" id="updated"></span>
          <button class="ad-link" data-act="signOut">SIGN OUT</button></div>
      </header>
      <div class="ad-filters">
        <label class="cc-field"><span class="cc-field-label">ORGANIZATION</span>
          <span class="cc-select"><select class="cc-input" id="f-org">${orgOptions()}</select>${ICON.down}</span></label>
        <div class="ad-spacer"></div>
        <button class="ad-btn-sm" data-act="csv">DOWNLOAD CSV</button>
      </div>
      <div id="content"></div>
      <p class="ad-foot">Overdue = a check that has been open for ${OVERDUE_DAYS}+ days. Each coach counts once per week (their latest check for that week).</p>
    </div>`;
  }

  function vContent(m) {
    if (ui.err && !data.profiles.length) return `<p class="dx-hint" role="alert" style="margin-top:22px">${esc(ui.err)}</p>`;
    const N = m.counts.coaches;
    const kpi = (label, value, sub, frac, dark) => `<div class="ad-kpi${dark ? " ad-kpi--dark" : ""}"><p class="ad-kpi-label">${label}</p>
      <p class="ad-kpi-value">${value}</p>${frac != null ? `<span class="ad-meter" role="img" aria-label="${pct(frac[0], frac[1])}%"><i style="width:${pct(frac[0], frac[1])}%"></i></span>` : ""}
      ${sub ? `<p class="ad-kpi-sub">${sub}</p>` : ""}</div>`;
    const kpis = `<div class="ad-kpis">
      ${kpi("COACHES", N, ui.org === "all" ? "Signed up, all organizations" : esc(orgName(ui.org)), null, true)}
      ${CPS.map((cp, i) => kpi(cp.label.toUpperCase() + " DONE", `${m.counts.done[i]}<small>/ ${N}</small>`, `${pct(m.counts.done[i], N)}% of coaches`, [m.counts.done[i], N])).join("")}
      ${kpi("WAITING ON", m.counts.ready + m.counts.overdue,
        m.counts.overdue ? `<span class="ad-flag">${ICON.alert}${m.counts.overdue} overdue</span>` : "Check open, not done yet")}
    </div>`;
    if (!N) return errBanner() + kpis + `<div class="ad-card" style="margin-top:16px"><p class="ad-empty" style="margin:0">No coaches have signed up${ui.org === "all" ? "" : " in this organization"} yet.</p></div>`;
    return errBanner() + kpis + `<div class="ad-grid">
      ${cardABC(m)}${cardScore(m)}${cardMoves(m)}${cardRoad(m)}${cardQuestions(m)}${cardChoices(m)}${cardCoaches(m)}
    </div>`;
  }
  const errBanner = () => (ui.err ? `<p class="dx-hint" role="alert" style="margin-top:18px">${esc(ui.err)}</p>` : "");

  // Where coaches are, each week: A / B / C share (tall segmented bars, one per week).
  function cardABC(m) {
    const rows = m.weeks.map(w => {
      const label = `<span class="ad-row-label">${esc(w.cp.label)}<small>${w.n} coach${w.n === 1 ? "" : "es"}</small></span>`;
      if (!w.n) return `<div class="ad-seg-row">${label}<div class="ad-seg-empty">No checks yet</div></div>`;
      const parts = ["A", "B", "C"].filter(L => w.count[L]).map(L => {
        const share = pct(w.count[L], w.n);
        return `<span class="ad-seg-part s-${L}" style="flex:${w.count[L]}" tabindex="0"
          data-tip="<b>${w.cp.label} · ${L}</b> ${esc(ABC_NAME(L))}<br>${w.count[L]} coach${w.count[L] === 1 ? "" : "es"} (${share}%)">${share >= 14 ? share + "%" : ""}</span>`;
      }).join("");
      const aria = ["A", "B", "C"].map(L => `${L} ${w.count[L]} (${pct(w.count[L], w.n)}%)`).join(", ");
      return `<div class="ad-seg-row">${label}<div class="ad-seg" role="img" aria-label="${esc(w.cp.label)}: ${aria}">${parts}</div></div>`;
    }).join("");
    return `<section class="ad-card"><h2 class="ad-card-title">Where coaches are</h2>
      <p class="ad-card-sub">Share of coaches at A, B and C at each check. The goal: the dark part grows week by week.</p>
      <div class="ad-seg-rows">${rows}</div>
      <ul class="ad-legend">${["A", "B", "C"].map(L => `<li><span class="ad-sw s-${L}"></span><b>${L}</b>${esc(ABC_NAME(L))}</li>`).join("")}</ul>
    </section>`;
  }

  // Average score (out of 10) per week: one series, columns.
  function cardScore(m) {
    const H = 176, ticks = [0, 5, 10];
    const grid = ticks.map(t => `<i class="${t === 0 ? "base" : ""}" style="bottom:${(t / 10) * H}px"></i>`).join("");
    const axis = ticks.map(t => `<span style="bottom:${34 + (t / 10) * H}px">${t}</span>`).join("");
    const cols = m.weeks.map(w => {
      const lab = `<span class="ad-col-lab"><b>${esc(w.cp.label)}</b><small>${w.n} coach${w.n === 1 ? "" : "es"}</small></span>`;
      if (w.avg == null) return `<div class="ad-col"><span class="ad-col-none">No checks</span>${lab}</div>`;
      const v = w.avg.toFixed(1);
      return `<div class="ad-col"><span class="ad-col-val">${v}</span><span class="ad-col-bar" style="height:${(w.avg / 10) * H}px"></span>${lab}
        <span class="ad-col-hit" tabindex="0" data-tip="<b>${w.cp.label}</b><br>Average score ${v} / 10<br>${w.n} coach${w.n === 1 ? "" : "es"}"></span></div>`;
    }).join("");
    return `<section class="ad-card"><h2 class="ad-card-title">Average score</h2>
      <p class="ad-card-sub">Out of 10 (5 questions: Yes = 2, Partly = 1, No = 0).</p>
      <div class="ad-cols"><div class="ad-cols-axis">${axis}</div><div class="ad-cols-plot">${grid}</div>${cols}</div>
    </section>`;
  }

  // Who moved up, stayed, or slipped between two checks (coaches who did both).
  function cardMoves(m) {
    const box = mv => `<div class="ad-move"><p class="ad-move-head">${esc(mv.from.label)} → ${esc(mv.to.label)}</p>
      ${mv.n ? [["up", "Moved up", ICON.up], ["same", "Stayed the same", ICON.same], ["down", "Slipped back", ICON.fall]].map(([k, l, ic]) =>
        `<div class="ad-move-row">${ic}<b>${mv[k]}</b>${l}</div>`).join("") : `<p class="ad-empty">Nobody has done both yet.</p>`}</div>`;
    return `<section class="ad-card"><h2 class="ad-card-title">Movement</h2>
      <p class="ad-card-sub">Coaches whose letter went up (e.g. C → B, B → A), stayed, or went down between two checks.</p>
      <div class="ad-moves">${m.moves.map(box).join("")}</div></section>`;
  }

  // Roadblocks at each coach's most recent check: one series, horizontal bars.
  function cardRoad(m) {
    const keys = [...Object.keys(D.ROADBLOCKS).filter(k => D.ROADBLOCK_RULES.some(r => r.key === k)), "none"];
    const max = Math.max(1, ...keys.map(k => m.road[k] || 0));
    const rows = keys.map(k => {
      const n = m.road[k] || 0, R = D.ROADBLOCKS[k];
      const name = R ? R.name : "None showing", sub = R ? R.gateway : "All five answers Yes";
      return `<div class="ad-hbar"><span class="ad-hbar-label">${esc(name)}<small>${esc(sub)}</small></span>
        <span class="ad-hbar-track" tabindex="0" data-tip="<b>${esc(name)}</b><br>${n} of ${m.roadN} coach${m.roadN === 1 ? "" : "es"} (${pct(n, m.roadN)}%)">
          <span class="ad-hbar-bar${n ? "" : " is-zero"}" style="width:${(n / max) * 80}%"></span><span class="ad-hbar-val">${n}</span></span></div>`;
    }).join("");
    return `<section class="ad-card"><h2 class="ad-card-title">Roadblocks</h2>
      <p class="ad-card-sub">What's getting in the way, from each coach's most recent check (${m.roadN} coach${m.roadN === 1 ? "" : "es"}).</p>
      ${m.roadN ? `<div class="ad-hbars">${rows}</div>` : `<p class="ad-empty">Shows after the first Week 2 check.</p>`}</section>`;
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
    const rows = D.QUESTIONS.map((Q, i) => `<tr><th scope="row"><span class="ad-q-num">0${i + 1}</span>${esc(Q.short)}${i === lowest ? `<span class="ad-tag">LOWEST</span>` : ""}</th>
      ${m.weeks.map(w => cell(w.qAvg[i], w, i)).join("")}</tr>`).join("");
    return `<section class="ad-card"><h2 class="ad-card-title">The five questions</h2>
      <p class="ad-card-sub">Average answer per question (0 = No, 1 = Partly, 2 = Yes). "Lowest" = the weakest question at the latest check.</p>
      <table class="ad-heat"><thead><tr><th scope="col">Question</th>${m.weeks.map(w => `<th scope="col">${esc(w.cp.label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
      <div class="ad-scale"><span>No</span><i aria-hidden="true"></i><span>Yes</span></div></section>`;
  }

  // What coaches decided about their action at each check.
  function cardChoices(m) {
    const used = CHOICES.filter(([k]) => m.weeks.some(w => w.choices[k]));
    const body = used.length ? `<div class="ad-table-wrap"><table class="ad-table"><thead><tr><th>CHOICE</th>${m.weeks.map(w => `<th class="num">${esc(w.cp.label.toUpperCase())}</th>`).join("")}</tr></thead>
      <tbody>${used.map(([k, l]) => `<tr><td>${esc(l)}</td>${m.weeks.map(w => `<td class="num">${w.choices[k] || `<span class="ad-dash">–</span>`}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${(() => { const s = m.weeks.reduce((t, w) => t + w.sameWords, 0); return s ? `<p class="ad-note">${s} time${s === 1 ? "" : "s"} a coach chose to change their action but kept the same words.</p>` : ""; })()}`
      : `<p class="ad-empty">Shows after the first check.</p>`;
    return `<section class="ad-card"><h2 class="ad-card-title">Action choices</h2>
      <p class="ad-card-sub">What coaches did with their action at each check.</p>${body}</section>`;
  }

  // Every coach: where they are, each week's letter, and their current action. Click a row for details.
  function cardCoaches(m) {
    const weekCell = (c, cp) => {
      const r = c.done[cp.key];
      if (r) return `<span class="ad-letter is-${r.abc}" tabindex="0" data-tip="<b>${cp.label} · ${r.abc}</b> ${esc(ABC_NAME(r.abc))}<br>Score ${r.score}/10 · ${fmtDate(r.checked_at)}">${r.abc}</span><span class="ad-score">${r.score}</span>`;
      if (c.next.cp === cp) {
        if (c.next.kind === "overdue") return `<span class="ad-state ad-flag">${ICON.alert}${esc(c.next.label)}</span>`;
        return `<span class="ad-state${c.next.kind === "ready" ? " is-ready" : ""}">${esc(c.next.label)}</span>`;
      }
      return `<span class="ad-dash">–</span>`;
    };
    const rows = m.list.map(c => {
      const P = c.p, open = ui.open === P.id;
      const act = P.current_action_when ? `When <b>${esc(P.current_action_when.replace(/,$/, ""))}</b>, I will <b>${esc(P.current_action_will.replace(/\.$/, ""))}</b>.` : `<span class="ad-dash">No action yet</span>`;
      const main = `<tr class="ad-coach-row${ui.newRows.has(P.id) ? " is-new" : ""}" data-act="toggle" data-v="${P.id}" aria-expanded="${open}" tabindex="0">
        <td><span class="ad-name">${esc(P.first_name)} ${esc(P.last_name)}</span><span class="ad-email">${esc(P.email)}</span></td>
        <td class="ad-org">${esc(orgName(P.org))}</td>
        ${CPS.map(cp => `<td>${weekCell(c, cp)}</td>`).join("")}
        <td class="ad-action">${act}</td>
        <td><span class="ad-chev">${ICON.down}</span></td></tr>`;
      return open ? main + `<tr class="ad-detail"><td colspan="${4 + CPS.length}">${detail(c)}</td></tr>` : main;
    }).join("");
    return `<section class="ad-card ad-card--wide"><h2 class="ad-card-title">Coaches</h2>
      <p class="ad-card-sub">Every coach, their letter at each check (number = score out of 10) and their current action. Click a coach for their answers.</p>
      <div class="ad-filters" style="margin-top:16px;padding-top:0;border-top:0">
        <label class="cc-field"><span class="cc-field-label">SEARCH</span><input class="cc-input" id="f-search" type="search" placeholder="Name or email" value="${esc(ui.search)}"></label>
        <label class="cc-field"><span class="cc-field-label">SORT BY</span><span class="cc-select"><select class="cc-input" id="f-sort">
          ${[["attention", "Needs attention first"], ["recent", "Latest activity"], ["name", "Name"]].map(([v, l]) => `<option value="${v}"${ui.sort === v ? " selected" : ""}>${l}</option>`).join("")}
        </select>${ICON.down}</span></label></div>
      ${m.list.length ? `<div class="ad-table-wrap"><table class="ad-table ad-coaches"><thead><tr><th>COACH</th><th>ORGANIZATION</th>${CPS.map(cp => `<th>${esc(cp.label.toUpperCase())}</th>`).join("")}<th>CURRENT ACTION</th><th><span class="cc-sr" style="position:absolute;left:-9999px">Details</span></th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : `<p class="ad-empty">No coach matches “${esc(ui.search)}”.</p>`}
    </section>`;
  }
  function detail(c) {
    const P = c.p;
    const first = P.first_action_when ? `<p>First action (${P.first_action_date ? fmtDate(P.first_action_date) : ""}): When <b>${esc(P.first_action_when.replace(/,$/, ""))}</b>, I will <b>${esc(P.first_action_will.replace(/\.$/, ""))}</b>.</p>` : "";
    const boxes = CPS.map(cp => {
      const r = c.done[cp.key];
      if (!r) return `<div class="ad-det ad-det-empty">${esc(cp.label)}: not done</div>`;
      const ans = [r.q1, r.q2, r.q3, r.q4, r.q5];
      const dots = p => `<span class="cc-dots" role="img" aria-label="${["No", "Partly", "Yes"][p]}"><i${p > 0 ? ' class="on"' : ""}></i><i${p > 1 ? ' class="on"' : ""}></i></span>`;
      const choice = (CHOICES.find(([k]) => k === r.action_choice) || [0, ""])[1];
      return `<div class="ad-det"><div class="ad-det-head"><span class="ad-letter is-${r.abc}">${r.abc}</span><b>${esc(cp.label)}</b><span>${r.score}/10 · ${fmtDate(r.checked_at)}</span></div>
        <ol class="cc-rows">${ans.map((p, i) => `<li class="cc-r"><span class="cc-num">0${i + 1}</span><span class="t">${esc(D.QUESTIONS[i].short)}</span>${dots(p)}</li>`).join("")}</ol>
        <p>Roadblock: <b>${esc(r.roadblock ? D.ROADBLOCKS[r.roadblock].name : "None showing")}</b></p>
        ${r.action_when ? `<p>${esc(choice)}${r.action_changed === false && r.action_choice !== "keep" ? " (same words)" : ""}: When <b>${esc(r.action_when.replace(/,$/, ""))}</b>, I will <b>${esc(r.action_will.replace(/\.$/, ""))}</b>.</p>` : ""}</div>`;
    }).join("");
    return `${first}<div class="ad-detail-grid" style="margin-top:10px">${boxes}</div>
      <p class="ad-note">Signed up ${fmtDate(P.created_at)}${P.start_date ? ` · programme clock started ${fmtDate(P.start_date)}` : ""} · ${esc(P.gender)} · ${esc(P.age_bracket)}</p>`;
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
    const old = document.querySelector(".ad-toast"); if (old) old.remove();
    const t = document.createElement("div"); t.className = "ad-toast"; t.setAttribute("role", "status");
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
      "q1", "q2", "q3", "q4", "q5", "score", "max", "status", "abc", "roadblock", "action_when", "action_will", "action_choice", "action_changed"];
    const q = s => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
    const lines = data.checks.filter(c => P[c.user_id]).map(c => { const p = P[c.user_id];
      return [p.first_name, p.last_name, p.email, p.org_name || "", p.gender, p.age_bracket, p.created_at, c.checkpoint, c.checked_at,
        c.q1, c.q2, c.q3, c.q4, c.q5, c.score, c.max_score, c.status, c.abc, c.roadblock, c.action_when, c.action_will, c.action_choice,
        c.action_changed == null ? "" : c.action_changed ? "yes" : "no"].map(q).join(","); });
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

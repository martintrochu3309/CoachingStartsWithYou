/* PREVIEW ONLY: a pretend Supabase that lives in this browser, used by preview.html and admin/preview.html.
   Lets you click through sign-up, the code screen, checks and the dashboard on your own computer:
   no real emails (any 6 digits work as the code), nothing sent to the real database.
   Only switches on when the page is opened from this computer (a file, localhost or 127.0.0.1). */
(function () {
  "use strict";
  const LOCAL = location.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(location.hostname);
  window.CC_PREVIEW_LOCAL = LOCAL;
  if (!LOCAL) return;

  const DBK = "cc-preview-db", SK = "cc-preview-session";
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } };
  const db = () => read(DBK, { users: {}, profiles: {}, checks: {} });
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + Math.random());
  const fail = (code, message) => ({ data: { user: null, session: null }, error: { code, message } });

  // from("table").select().eq(…).order(…).maybeSingle() / .upsert(row): enough of the real API for the app and dashboard.
  function query(table, extra) {
    const filters = []; let one = false, ord = null, up = null;
    const run = () => {
      const d = db();
      d[table] = d[table] || {};                     // e.g. "reminders": empty until something is saved
      if (up) {
        (Array.isArray(up) ? up : [up]).forEach(r => {
          const old = d[table][r.id] || {};
          d[table][r.id] = Object.assign({}, old, r, { created_at: old.created_at || new Date().toISOString(), updated_at: new Date().toISOString() });
        });
        write(DBK, d);
        return Promise.resolve({ data: null, error: null });
      }
      let rows = Object.values(d[table]).concat(extra ? extra(table) : []);
      filters.forEach(([k, v]) => { rows = rows.filter(r => r[k] === v); });
      if (ord) rows.sort((a, b) => (a[ord[0]] > b[ord[0]] ? 1 : -1) * ord[1]);
      return Promise.resolve({ data: one ? rows[0] || null : rows, error: null });
    };
    const q = {
      select() { return q; },
      eq(k, v) { filters.push([k, v]); return q; },
      order(k, o) { ord = [k, o && o.ascending === false ? -1 : 1]; return q; },
      maybeSingle() { one = true; return q; },
      upsert(row) { up = row; return q; },
      then(res, rej) { return run().then(res, rej); }
    };
    return q;
  }

  // opts.extra(table): extra sample rows (the dashboard preview adds sample coaches).
  // opts.anyEmail: sign-in works for any email (dashboard preview: you're always an admin).
  window.CC_FAKE_SUPABASE = function (opts) {
    opts = opts || {};
    return { createClient() {
      const auth = {
        async getSession() { return { data: { session: read(SK, null) } }; },
        async signInWithOtp({ email, options }) {
          options = options || {};
          const d = db(); let u = Object.values(d.users).find(x => x.email === email);
          if (!u && options.shouldCreateUser === false && !opts.anyEmail) return fail("otp_disabled", "Signups not allowed for otp");
          if (!u) { u = { id: newId(), email, user_metadata: options.data || {} }; d.users[u.id] = u; write(DBK, d); }
          return { data: {}, error: null };
        },
        async verifyOtp({ email, token }) {
          const u = Object.values(db().users).find(x => x.email === email);
          if (!u || !/^\d{6}$/.test(token)) return fail("otp_expired", "Token has expired or is invalid");
          const session = { user: u, access_token: "preview" };
          write(SK, session);
          return { data: { session, user: u }, error: null };
        },
        async signOut() { try { localStorage.removeItem(SK); } catch (e) { /* blocked */ } return { error: null }; }
      };
      return {
        auth,
        from: t => query(t, opts.extra),
        rpc: async () => ({ data: true, error: null }),        // preview: always an admin
        channel() { const c = { on: () => c, subscribe: cb => { if (cb) cb("SUBSCRIBED"); return c; } }; return c; },
        removeAllChannels() {}
      };
    } };
  };

  // Start over: wipes the pretend accounts and checks (not the real database).
  window.CC_PREVIEW_RESET = () => { try { localStorage.removeItem(DBK); localStorage.removeItem(SK); localStorage.removeItem("changecheck.v1"); } catch (e) { /* blocked */ } location.reload(); };
})();

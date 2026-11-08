// Coaching Starts With You: daily check reminders.
// Runs from a Supabase schedule at 13:00 and 14:00 UTC and only sends at 9:00 AM New York time
// (that covers both winter and summer time). One email per coach per check, the first 9 AM after
// the check opens; recorded in public.reminders so nobody gets the same reminder twice. No follow-up nudges.
//
// Test without sending anything:  …/functions/v1/send-reminders?dry   → how many reminders would go out right now (counts only).
// Needs the Edge Function secret RESEND_API_KEY (a Resend key with sending access).

import { createClient } from "npm:@supabase/supabase-js@2";

const DAY = 86_400_000;
// Same as js/data.js: CHECKPOINTS and MIN_GAP_DAYS. Change them together.
const CPS = [
  { key: "week2", label: "Week 2", day: 14 },
  { key: "week4", label: "Week 4", day: 28 },
  { key: "week6", label: "Week 6", day: 42 },
];
const GAP = 7 * DAY;                      // a check opens at least 7 days after the previous one was done
const WINDOW = 3 * DAY;                   // only remind for checks that opened in the last 3 days (catches a missed day)
const APP_URL = "https://coaching-startswithyou.com/";
const FROM = "Coaching Starts With You <team@mail.coaching-startswithyou.com>";

type Profile = { id: string; email: string; first_name: string; start_date: string | null };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { "Content-Type": "application/json" } });

// When check i opens for this coach (same rule as the app).
function opensAt(start: number, i: number, done: Record<string, number>): number {
  let t = start + CPS[i].day * DAY;
  const prev = i > 0 ? done[CPS[i - 1].key] : 0;
  if (prev) t = Math.max(t, prev + GAP);
  return t;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function emailHtml(first: string, label: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
  <p style="margin:0;font-size:12px;letter-spacing:.2em;color:#646461;font-weight:700">COACHING STARTS WITH YOU</p>
  <h1 style="margin:16px 0 0;font-size:26px;line-height:1.1;font-style:italic">Your ${esc(label)} check is ready.</h1>
  <p style="margin:16px 0 0;font-size:16px;line-height:1.5;color:#333">Hi ${esc(first)},</p>
  <p style="margin:8px 0 0;font-size:16px;line-height:1.5;color:#333">Five honest questions about your coaching, then your action for the next two weeks. It takes about two minutes.</p>
  <p style="margin:24px 0 0"><a href="${APP_URL}" style="display:inline-block;padding:16px 28px;border-radius:28px;background:#111;color:#fff;text-decoration:none;font-size:12px;font-weight:700;letter-spacing:.18em">TAKE MY CHECK &rarr;</a></p>
  <p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#8a8a86">You're getting this because you're taking part in Coaching Starts With You. Questions: <a href="mailto:info@dailyxcellence.com" style="color:#646461">info@dailyxcellence.com</a></p>
</div>`;
}
const emailText = (first: string, label: string) =>
  `Hi ${first},\n\nYour ${label} check is ready. Five honest questions about your coaching, then your action for the next two weeks. It takes about two minutes.\n\nTake my check: ${APP_URL}\n\nYou're getting this because you're taking part in Coaching Starts With You. Questions: info@dailyxcellence.com`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const dry = url.searchParams.has("dry");
  const hourNY = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  if (!dry && hourNY !== 9) return json({ skipped: `It's ${hourNY}:00 in New York; reminders go out at 9:00.` });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const [p, c, r] = await Promise.all([
    sb.from("profiles").select("id,email,first_name,start_date"),
    sb.from("checks").select("user_id,checkpoint,checked_at"),
    sb.from("reminders").select("user_id,checkpoint"),
  ]);
  if (p.error || c.error || r.error) return json({ error: (p.error || c.error || r.error)!.message }, 500);

  const already = new Set(r.data!.map((x) => `${x.user_id}:${x.checkpoint}`));
  const now = Date.now();
  const due: { prof: Profile; cp: (typeof CPS)[number]; opens: number }[] = [];
  for (const prof of p.data as Profile[]) {
    if (!prof.start_date) continue;                         // no clock yet (e.g. Golf coaches before their first check)
    const done: Record<string, number> = {};
    for (const x of c.data!) if (x.user_id === prof.id) done[x.checkpoint] = Math.max(done[x.checkpoint] || 0, Date.parse(x.checked_at));
    const i = CPS.findIndex((cp) => !done[cp.key]);
    if (i === -1) continue;                                 // programme complete
    const opens = opensAt(Date.parse(prof.start_date), i, done);
    if (opens > now || now - opens > WINDOW || already.has(`${prof.id}:${CPS[i].key}`)) continue;
    due.push({ prof, cp: CPS[i], opens });
  }

  // Test mode: counts only, never names or emails (the function can be called from outside).
  if (dry) {
    const counts: Record<string, number> = {};
    for (const d of due) counts[d.cp.label] = (counts[d.cp.label] || 0) + 1;
    return json({ dryRun: true, newYorkHour: hourNY, wouldSend: due.length, byCheck: counts });
  }

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ error: "The RESEND_API_KEY secret is not set." }, 500);

  const results = [];
  for (const d of due) {
    // Claim it first (one row per coach + check), so two runs can never send the same reminder twice.
    const claim = await sb.from("reminders").insert({ user_id: d.prof.id, checkpoint: d.cp.key, opens_at: new Date(d.opens).toISOString() }).select("id").single();
    if (claim.error) { results.push({ email: d.prof.email, check: d.cp.label, skipped: claim.error.message }); continue; }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: d.prof.email, subject: `Your ${d.cp.label} check is ready`,
        html: emailHtml(d.prof.first_name, d.cp.label), text: emailText(d.prof.first_name, d.cp.label) }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      await sb.from("reminders").update({ sent_at: new Date().toISOString(), email_id: body.id ?? null }).eq("id", claim.data.id);
      results.push({ email: d.prof.email, check: d.cp.label, sent: true });
    } else {
      await sb.from("reminders").delete().eq("id", claim.data.id);   // let tomorrow's run try again
      results.push({ email: d.prof.email, check: d.cp.label, error: body.message || `HTTP ${res.status}` });
    }
    await new Promise((ok) => setTimeout(ok, 600));                  // stay under Resend's rate limit
  }
  // Summary only (no emails in the response): details are in public.reminders.
  return json({ sent: results.filter((x) => "sent" in x).length, failed: results.filter((x) => "error" in x).map((x) => x.error), skipped: results.filter((x) => "skipped" in x).length });
});

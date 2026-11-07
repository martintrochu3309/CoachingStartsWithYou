# Change Check · Daily Xcellence

Coach-facing app for the Coaching Starts With You programme.
Static files, no build step. Drag the folder (or the zip) onto Netlify.

## Folder

    index.html              the app shell
    dx/                     the DailyXcellence style kit, untouched (same as Mirror 21's kit)
      dailyxcellence.css    colours, fonts, buttons, rails, cards, tabs (dx- classes)
      fonts/                Magistral bold italic + Neue Haas Display light, light italic, medium, bold
      demo.html             every kit piece with its markup
    css/change-check.css    only the pieces the kit doesn't have: score ring, A / B / C, week tiles, chart, pop-ups
    js/data.js              all wording: questions, tips, guidance, roadblocks, checkpoint days
    js/app.js               flow, scoring, saving, home tabs
    assets/                 icons and the X mark
    manifest.json, sw.js    home-screen install and offline cache

Brand changes go in dx/dailyxcellence.css, so they match Mirror 21 and Pocket Mirror.
Fonts are licensed: confirm the web licence before the app goes public.

## Flow

Landing → 5 questions → your example (not scored) → score /10 → status guidance + up to two tips
→ action line (hold to commit, initial check only) → home.

Home tabs: See it (week tiles + Overall), Own it (A / B / C + roadblock + gateway), Change it (action, tips, countdown).
Later checks open from the pop-up or the Change it tab when the countdown ends, and skip the action line.

## Rules built in

- Score: Yes 2, Partly 1, No 0, out of 10.
- Status from question 4 only: Yes = Owning it, Partly = Renting it, No = Not started.
  At the initial check, No shows "Starting point" instead of Not started.
- Tips: Partly / No answers, No first, max two.
- Roadblock: questions 1–2 → Unawareness, 3–4 → Habit, 5 → Lack of skill or confidence.
  The group with the most missing points wins. All Yes = no roadblock shown.
- Checkpoints: day 0, 14, 28, 42 after the initial check (change in js/data.js).

## Testing

Open the site with `?demo` on the end of the address (e.g. yoursite.netlify.app/?demo).
A yellow bar appears with "+14 days" to jump to the next check and "Reset" to clear everything.

## Saving

Results are saved on the coach's phone only (localStorage), one record per check:
checkpoint, date, answers, score, status, roadblock, tips, evidence, evidence tag.
Coaches should add the app to their Home Screen, otherwise iPhone Safari may clear
the data after about a week without opening it. "Export my results" downloads a CSV.
Supabase can be added later by sending the same records to a table.

## Updating

Each time you upload a new version, change VERSION at the top of sw.js (now cc-v2 → cc-v3),
so phones pick up the new files.

/* Change Check — content and programme settings.
   Edit wording here; app.js reads everything from this file. */
window.CC_DATA = {

  /* ORGANIZATIONS — each one gets its own link: the app's address + ?org=<code>, e.g. …/?org=golf-department
     The code in the link is saved on the coach's account (Supabase later: filter the dashboard by it),
     and the sign-up screen shows the name, locked.
     startAtWeek2:
       true  = their workshop already happened without the app. After sign-up they go straight into the Week 2 check
               (mirror → questions) and write their action for the first time at the end of it.
               Week 4 opens 14 days after they finish Week 2.
       false = the normal programme. On workshop day they sign up and write their action; Week 2 opens 14 days later.
     The plain link (no ?org=, or a code not listed here) = no organization, normal programme. */
  ORGANIZATIONS: {
    "golf-department": { name: "Golf Department", startAtWeek2: true }
  },

  /* Checkpoints: day = days after the workshop (the moment they commit to their first action at sign-up).
     There's no check on workshop day: the workshop is the starting point. */
  CHECKPOINTS: [
    { key: "week2",   label: "Week 2",        short: "Wk 2",    day: 14 },
    { key: "week4",   label: "Week 4",        short: "Wk 4",    day: 28 },
    { key: "week6",   label: "Week 6",        short: "Wk 6",    day: 42 }
  ],
  /* A check never opens sooner than this many days after the previous one was done, so a coach who is very late
     doesn't do two checks back to back. On time = no difference. (Same rule in admin/admin.js and
     supabase/functions/send-reminders/index.ts: change all three together.) */
  MIN_GAP_DAYS: 7,

  QUESTIONS: [
    { stage: "See it", short: "Ask before telling",
      text: "Before I step in, do I ask what the player sees before I tell them what I see?",
      opts: [
        "I ask what the player noticed and listen before deciding how to respond.",
        "I ask sometimes, but when rushed I often give my view first.",
        "I usually give feedback before checking what the player noticed."
      ] },
    /* defs = short definitions shown on the question screen (between "See an example" and YES/PARTLY/NO)
       and at the top of its "See an example" pop-up. */
    { stage: "See it", short: "Don't know it or don't own it",
      text: "When a player needs help, do I decide whether to teach or coach before I step in?",
      defs: [["TEACH", "They don't know it yet."], ["COACH", "They know it, but don't own it."]],
      opts: [
        "I decide whether to teach or coach before I step in.",
        "I decide with some players, but often go straight to a fix.",
        "I usually step in without deciding which it is."
      ] },
    { stage: "Own it", short: "Resist the quick answer",
      text: "When a player could work it out, do I still give them the chance, even when I'm rushed or frustrated?",
      opts: [
        "When a player could work it out, I give them the chance, even under pressure.",
        "I give them the chance when things are calm, but step in when I'm rushed or frustrated.",
        "I usually give the answer, even when the player could work it out."
      ] },
    { stage: "Change it", short: "What I committed to",
      text: "Have I followed through on my chosen action when the opportunity came up?",
      opts: [
        "I put my chosen action into practice on most or all relevant opportunities.",
        "I have tried it, but apply it inconsistently or have slipped back.",
        "I have not acted on it despite relevant opportunities."
      ] },
    { stage: "Change it", short: "More capable without me",
      text: "Are my players becoming more capable without me?",
      opts: [
        "I deliberately give players appropriate chances to decide and solve problems.",
        "I do this with some players or in some situations, but not regularly.",
        "I usually direct the solution and leave little room for player decisions."
      ] }
  ],

  /* One quick tip per question, shown for Partly or No answers (max two, lowest first). */
  TIPS: [
    "At the next appropriate mistake, ask \"What did you notice?\" Pause and listen before deciding how to respond.",
    "Before intervening, ask yourself: does this player not know it, or not own it? Teach the first, coach the second.",
    "When you feel yourself rushing to answer, pause and give the player a question or a choice.",
    "Name the precise behaviour, the next situation where it matters, and what you'll do when it happens.",
    "Before the session ends, ask \"What will you do on your own next time?\" Then listen to the player's plan."
  ],

  /* Status comes from question 4 alone. */
  STATUS: {
    /* today = the big word under "TODAY, YOU…" on the result screen
       abc   = the circled letter on SEE IT (the same A/B/C as on OWN IT) */
    owning: { name: "Owning it", letter: "O", abc: "A", today: "Own it",
      lede: "You report applying your chosen change consistently. That's a positive sign of follow-through. Now protect it when things get difficult.",
      steps: [["Keep", "Identify the coaching situation most likely to pull you back into the old habit."],
              ["Stretch", "Use your lowest-scoring question as your next area for growth."],
              ["Check", "Ask a colleague to observe a relevant moment and give specific feedback."]] },
    renting: { name: "Renting it", letter: "R", abc: "B", today: "Rent it",
      lede: "You believe in the change, but you're not yet following through. A slip is information about what needs to change.",
      steps: [["Reset", "Identify the moment, pressure or distraction that led to the slip."],
              ["Re-anchor", "Reconnect with why the chosen behaviour matters."],
              ["Simplify", "Make the next action smaller and more specific."]] },
    notstarted: { name: "Not started", letter: "N", abc: "C", today: "Not started it",
      lede: "You haven't acted on your chosen change yet. This is a starting point, not a verdict. First identify what got in the way.",
      steps: [["Choose", "Name one specific behaviour, not a broad ambition."],
              ["Shrink", "One player, one opportunity, one visible action."],
              ["Prepare", "Decide exactly when and how you'll act."]] }
  },

  /* Your action, at Week 2/4/6: the two choices (first = black button = what the method recommends).
     (head/line are no longer shown on the action screen: the verdict now comes after the action, on the result screens.)
     Each choice key is saved as-is, so the dashboard can see what each A/B/C decided:
       new     → empty boxes                       (A: NEW ACTION)
       keep    → action locked, hold to commit      (A: KEEP IT · B: KEEP GOING · C: TRY AGAIN)
       easier  → boxes filled in, to adjust         (B: MAKE IT EASIER)
       smaller → boxes filled in, to shrink         (C: MAKE IT SMALLER) */
  ACTION_REVIEW: {
    /* head = the bold verdict under the action card */
    owning:     { head: "Today, you own it.", line: "You're doing it. Move on to your next change, or keep protecting this one.",
                  choices: [["new", "NEW ACTION"], ["keep", "KEEP IT"]] },
    renting:    { head: "Today, you rent it.", line: "You've started. Keep going, or make it easier to stick to.",
                  choices: [["keep", "KEEP GOING"], ["easier", "MAKE IT EASIER"]] },
    notstarted: { head: "Today, you haven't started.", line: "It hasn't happened yet. Make it smaller so you can do it this week, or give it another go.",
                  choices: [["smaller", "MAKE IT SMALLER"], ["keep", "TRY AGAIN"]] }
  },
  /* The writing screen after each choice: title and the line under it. */
  ACTION_EDIT: {
    /* first = workshop day, straight after sign-up */
    first:   ["YOUR ACTION", "The one change you're taking from the workshop. Make it one moment and one thing you'll do. If someone watching couldn't see it, it's still an intention."],
    new:     ["YOUR NEXT ACTION", "Make it one moment and one thing you'll do. If someone watching couldn't see it, it's still an intention."],
    easier:  ["MAKE IT EASIER", "Keep the idea, make it easier to stick to: a clearer moment, or a simpler thing to do."],
    smaller: ["MAKE IT SMALLER", "Shrink it: one player, one moment, one thing you'll do this week."]
  },

  /* A/B/C pop-ups on Own it. reads = what the coach reads ([label, quote]; label empty if only one);
     next = [stage, what to do]. */
  ABC: {
    A: { name: "Actively change",
      reads: [["", "I did what I said I'd do, and someone noticed."]],
      next: ["Protect it", "Name the situation most likely to pull you back, then choose your next change."] },
    B: { name: "Believe, but don't follow through",
      reads: [["If you answered No", "I meant to. I thought about it. I didn't do it."],
              ["If you answered Partly", "I did it when it was easy. You're renting it. Keep going."]],
      next: ["Change it", "Write one \"When… I will…\" and do it."] },
    C: { name: "Cling to comfort",
      reads: [["", "I haven't really thought about it since the session."]],
      next: ["See it", "Name one moment in your coaching to notice over the next two weeks."] }
  },
  GAP_LINE: "The biggest gap isn't between C and B. It's between B and A.",

  ROADBLOCKS: {
    unawareness: { name: "Unawareness", looks: "You don't realise you're doing it.",
      gateway: "Self-monitoring and feedback",
      detail: "Track what you actually do. Notice each moment you step in, and ask someone to tell you what they see.", stage: "See it" },
    motivation: { name: "Low motivation", looks: "You're not convinced it matters. This is where excuses live.",
      gateway: "Personal meaning",
      detail: "The reason has to be your own. Name what changes for your players if you get this right.", stage: "Own it" },
    skill: { name: "Lack of skill or confidence", looks: "You don't know how, or don't believe you can.",
      gateway: "Practice with feedback",
      detail: "Small wins build belief. Try it with one player, then ask for feedback on how it went.", stage: "Change it" },
    habit: { name: "Habit", looks: "Under pressure, autopilot beats intention.",
      gateway: "A plan for the moment",
      detail: "Decide in advance: \"When this happens, I will…\" so the new response is ready before the pressure arrives.", stage: "Change it" },
    environment: { name: "Environment", looks: "Time, workload and the people around you pull you back.",
      gateway: "Reshape the setting and get support",
      detail: "Adjust time or session design where you can, and find someone who notices.", stage: "Change it" }
  },

  /* Which questions point to which roadblock. The group with the most missing points wins;
     ties go to the earlier group. Low motivation and Environment are kept for a later barrier tap. */
  ROADBLOCK_RULES: [
    { key: "unawareness", questions: [0, 1] },
    { key: "habit",       questions: [2, 3] },
    { key: "skill",       questions: [4] }
  ],

  /* Sign up. The keys are what gets saved (Supabase later); the labels are what people see. */
  GENDERS: [["woman", "Woman"], ["man", "Man"], ["nonbinary", "Non-binary"], ["undisclosed", "Prefer not to say"]],
  AGE_BRACKETS: ["18–24", "25–34", "35–44", "45–54", "55–64", "65+"],

  ACTION_EXAMPLE: "When a player misses a putt, I will ask what they noticed before I give any feedback.",

  /* Question 06: three short written answers on one screen, after questions 01–05 (and on workshop day,
     before the first action). "when" and "will" become the action: When <when>, I will <will>.
     starter = the grey words inside the box, so the answer already reads as part of the action. */
  REFLECT: {
    title: "NAME IT",
    help: "Three short answers. A few words is enough. Your action comes from them.",
    items: [
      { key: "well", q: "What are you doing particularly well in your coaching?", starter: "" },
      { key: "when", q: "When do you fall back into a coaching habit you want to change?", starter: "When " },
      { key: "will", q: "What one area of your coaching are you committed to working on?", starter: "I will " }
    ],
    /* One complete example (one coach's three answers), shown under "See an example". */
    example: { well: "Building trust with my players.", when: "a player repeats the same mistake", will: "ask what they noticed before I give feedback" }
  },

  /* COACHING GUIDE — the book button next to the tabs. Read-only: no scores, boxes or commitments.
     Each section starts closed; tapping it shows the explanation and the practical reminders.
     reminders = [bold opening phrase, the rest]. */
  GUIDE: {
    title: "COACHING GUIDE",
    sub: "Becoming a better coach starts with you.",
    sections: [
      { key: "see", name: "SEE IT", tag: "AWARENESS", lead: "Be honest with yourself about how you coach.",
        body: ["Reflect on your sessions. Have honest conversations. Ask for feedback and be prepared to hear what you might not want to hear."],
        line: "You can't improve what you're unwilling to see.",
        reminders: [["Ask before telling.", "Aim for more questions."],
                    ["Listen to understand.", "Don't just prepare your next instruction."],
                    ["Check understanding.", "If they can't answer, you may have said too much."]] },
      { key: "own", name: "OWN IT", tag: "ACCEPTANCE", lead: "None of us has all the answers.",
        body: ["Accept that you won't always get it right. Experience doesn't mean you've stopped learning. Some of your greatest lessons will come from getting things wrong."],
        line: "You can't change what you're unwilling to own.",
        reminders: [["Look in before you look out.", "Examine your contribution first."],
                    ["Take responsibility.", "Focus on what you can control."],
                    ["Learn from others.", "Observe coaches who do something better than you."]] },
      { key: "change", name: "CHANGE IT", tag: "ACTION", lead: "Improvement comes from what you do consistently.",
        body: ["Not your goals. Not your intentions. Your daily disciplines.",
               "Choose one behaviour. Practise it. Repeat it. Make sure there's evidence of what you've changed."],
        line: "Don't tell yourself what you're going to do. Show yourself what you've done.",
        reminders: [["Start with one behaviour.", "Don't try to change everything."],
                    ["Decide your moment before the session,", "not during it."],
                    ["Practise with the next player,", "not next week."],
                    ["Teach it once, then coach it.", "Give players the knowledge they need before expecting them to take ownership."],
                    ["Finish with player ownership.", "End each session with the player explaining what they're working on."]] }
    ],
    more: { label: "CONTINUE YOUR DEVELOPMENT", name: "POCKET MIRROR", tag: "FREE",
      hook: "One minute with yourself.",
      line: ["Listens that turn", "intentions into actions."],   /* two lines under the hook */
      image: "assets/pocket-mirror.jpg", imageAlt: "The Pocket Mirror app on two phones: One minute with yourself, and a new card unlocked.",
      button: "Open Pocket Mirror", url: "https://thepocketmirror.netlify.app/" }   /* button = what screen readers say; the whole tile is the link */
  }
};

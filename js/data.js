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

  QUESTIONS: [
    { stage: "See it", short: "Ask before telling",
      text: "Before I step in, do I ask what the player sees before I tell them what I see?",
      opts: [
        "I ask what the player noticed and listen before deciding how to respond.",
        "I ask sometimes, but when rushed I often give my view first.",
        "I usually give feedback before checking what the player noticed."
      ] },
    { stage: "See it", short: "Don't know it or don't own it",
      text: "Before I intervene, do I check whether the player doesn't know it, so I teach, or doesn't own it, so I coach?",
      opts: [
        "I check whether the player doesn't know it or doesn't own it before intervening.",
        "I make the distinction with some players, but sometimes go straight to a fix.",
        "I generally intervene without first checking which it is."
      ] },
    { stage: "Own it", short: "Resist the quick answer",
      text: "When I feel the urge to give the answer because it's quicker, do I pause and give the player an opportunity to think?",
      opts: [
        "I notice the urge and give the player room to think when appropriate.",
        "I pause sometimes, but under pressure I still give answers quickly.",
        "I usually give the answer rather than letting the player work it out."
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

  /* Your action, at Week 2/4/6: what the coach reads, and the two choices (first = black button = what the method recommends).
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

  ACTION_EXAMPLE: "When a player misses a putt, I will ask what they noticed before I give any feedback."
};

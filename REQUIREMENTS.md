# Requirements log

A chronological, numbered record of every actual request made in this
project's chat history — reconstructed by reading all 77 of your messages
in this session's transcript (not from my own memory or summaries), so
this is the source of truth for "what did I ask for," not a paraphrase of
one. Pure acknowledgments and small talk ("sounds cool ty", "shipped in
main?", "what is a bundler") are left out on purpose to keep this a
signal, not a chat log — everything else is here, including things that
were later reversed, reverted, or never actually finished. Like
`CLAUDE.md`, this file isn't linked from `index.html`/`style.css`/`js/*`
and `.nojekyll` keeps GitHub Pages from turning it into a page either, so
it's repo-only, same as that file.

Two items below are flagged **(still open)** — asked for, discussed, and
never actually built. If the thing you remembered asking for and not
getting is one of these two, that's probably it.

## Sept 14 — first pass: naming, gestures, filters, theme

1. *(04:02)* Rename the app from "Recall" to "Anki", including the
   browser tab title.
2. *(04:02)* Stop double-tap from triggering browser zoom — specifically
   double-tap, not pinch-zoom.
3. *(04:02)* Disable text selection on the page.
4. *(04:02)* Rework the filters: "weak first" → **Weaker** (every card
   below "Got it", weakest first), "strong" → **Strongest** (only "Got
   it"/"Almost", strongest first), **Active** → only active cards,
   **Non-active** → only inactive cards, **Original** → sorted by id.
5. *(04:02)* Add an "up" arrow on the deck screen that appears once you
   scroll down, to jump back to the top.
6. *(04:02)* Add a confirmation warning before "Unselect all" actually
   unselects everything.
7. *(04:17)* Bug: the up-arrow wasn't showing on desktop.
8. *(04:17)* Bug: the "Weaker" tab was actually showing non-graded cards.
9. *(04:17)* Add a separate filter tab specifically for non-graded cards.
10. *(04:17)* Drop the word "first" from filter labels — just "Weaker" /
    "Strongest".
11. *(04:39)* Show a card count next to each filter label (e.g. "Weaker
    (42)"). Also clarified #2: lock double-tap zoom specifically, not
    pinch-zoom.
12. *(04:45)* Plan a way to share the app with other people: keep the
    built-in decks as they are, but add an "upload deck" button so anyone
    can upload their own CSV in the same format, stored entirely in
    localStorage.
13. *(04:53)* Let someone delete an uploaded deck, with a warning first.
14. *(05:28)* Add a "Play these" button to study only the cards matching
    the currently selected filter (e.g. just "Weakest"), instead of
    always drawing from the whole deck.
15. *(05:38)* Bug: the up-arrow still wasn't showing (recurrence of #7).
16. *(05:48)* Bug: the layout resizes awkwardly when the current filter
    matches zero cards.
17. *(05:53)* Move the up-arrow to the middle of the screen and make it
    bigger. On a custom deck, remove the "Yours"/"active" text labels
    next to the card count (numbers only), and even when every card is
    active, keep showing "10/10" instead of switching to plain "10
    cards".
18. *(13:43)* Fix the sort-toggle button looking disabled when set to
    "Original" even though it's active. Make the "Play these" button
    stand out with a stronger background.
19. *(13:49)* Plan a way to add/remove individual cards, but only on
    user-uploaded decks, never the built-in ones.
20. *(14:24)* Asked for more improvement ideas ("what else can we do").
21. *(17:16)* Cards switched off ("non-active") shouldn't be drawn into
    the play pool of any *other* filter — fine to still see them (dimmed)
    in the list, just not to actually study them.
22. *(17:16)* The theme reads too much like "Matrix" (near-black,
    saturated green) — wants it to feel more "mint," described as cuter.
23. *(17:35)* Correction: wants a **pink** direction, not the mint one
    (typo — "link" meant "pink").
24. *(17:39)* On top of the pink theme, wants a small decorative touch —
    a splash, hearts, stars, or flowers.
25. *(17:41–17:43)* Rejected the decorative attempt outright — the star
    looked like a stray character next to the title, and the message
    that went with it read as childish/ugly.
26. *(17:45)* Reverted the whole theme change — disliked the new palette
    too, wanted the previous one back. *(Net effect of #22–26: the pink
    direction was tried and fully abandoned. Don't reintroduce a pink
    accent without being asked again.)*
27. *(19:04)* Asked for spaced repetition to be explained before adopting
    it — specifically questioned why it'd beat manually picking
    "weakest" and occasionally randoming through everything active.
28. *(19:08)* Wants uneven repetition under manual control: some cards
    should come up a lot, others rarely, based on personal mastery —
    worried a real spaced-repetition algorithm would space a card too far
    out after just one good answer.
29. *(19:12)* **(still open)** Floated turning that into a separate study
    mode alongside "choose a pool + choose a count." Never built as its
    own mode — the closest thing that shipped is the Weakest/Strongest
    filters plus the rolling 7-attempt average, which is manual, not an
    automatic "due" scheduler.
30. *(19:16)* Wants historical per-card attempt tracking, plus a small
    calendar showing how many cards were studied each day (a "racha" /
    streak) — the original ask behind what later became the activity
    heatmap.
31. *(19:17)* Said to just go ahead and ship whatever, but it has to live
    on the home screen.
32. *(20:11)* Rejected/reverted whatever had just been pushed at that
    point.
33. *(Sept 15, 00:40)* Repeated #21 (non-active cards must not enter
    another filter's play pool) — it had been implemented once, but got
    reverted when the theme change shipped, so redo it.
34. *(00:43)* Bug: the "Play these" count wasn't decreasing when a card
    got unchecked, and playing "Non-graded" still pulled in a non-active
    card.
35. *(03:36)* Cards graded before ending a session early should still
    count toward the score — they weren't.
36. *(03:36)* The Undo button's arrow icon looks wrong — should be
    horizontal, not vertical.
37. *(03:39)* Flagged what looked like a grading bug (newly-missed cards
    showing yellow instead of red) and asked for it to be analyzed.

## Sept 15 — multiple choice mode, code organization

38. *(14:03)* Wants to introduce another kind of exercise beyond
    flashcards.
39. *(14:04)* Specifically wants a multiple-choice mode where the wrong
    answers are kanji that actually look alike (shared radical/shape),
    not random ones.
40. *(14:15)* Flagged a worry that hand-picked distractor pools would cap
    every session at 10 questions.
41. *(14:26)* Confirmed multiple choice must not affect existing scoring,
    and reported lag when picking an answer.
42. *(14:33)* Reiterated: multiple choice must stay fully separate from
    scoring, and asked why lag had been introduced — didn't want it.
43. *(14:45)* Delete "Deck 2" from the app entirely.
44. *(14:49)* Disliked the new "continue" button popping into the layout
    after answering in multiple choice (it shifted the page) — wants
    tap-anywhere-to-continue instead.
45. *(17:50)* Felt the codebase was too cramped in one file and asked for
    it to be split up in a way that's actually navigable — couldn't find
    the multiple-choice logic.
46. *(18:07)* Asked for an audit of whether the code is clean, scalable,
    efficient, and human-readable, with some general JS best practices to
    weigh (batching DOM reads/writes, cleaning up event listeners, a
    simple state-object pattern, localStorage-based persistence).
47. *(18:39)* Suggested that when a confusable-kanji group has more than
    4 members, the multiple-choice distractor pool for that question
    should be drawn randomly from the whole group, not a fixed subset —
    and supplied a 23-group confusable-kanji list to use as the starting
    data.
48. *(20:24)* Add 気 and 長 as a confusable pair.
49. *(Sept 16, 03:49)* Add another look-alike pair as a confusable group
    (both share an "X" shape and several top strokes).

## Sept 16 — per-filter counts, confusable-kanji tooling, MC polish, README

50. *(03:52)* Wants the 10/25/50/100/All count buttons to apply to
    whichever filter is currently selected, not always the whole deck —
    and to gray out any count bigger than what that filter actually has.
51. *(03:52)* Wants the confusable-kanji list moved into its own file (so
    it's easy to edit/import), and a way to study just the confusable
    kanji in both flashcards and multiple choice.
52. *(04:20)* Confirmed removing the now-redundant "Play these" button
    (superseded by #50), and flagged a bug: "Non-active" cards should be
    playable when that filter is selected.
53. *(04:29)* Clarified the real bug was in "Non-graded", not
    "Non-active" — when only non-active cards match, every count should
    show grayed out rather than swapping to a text message ("every card
    here has been studied").
54. *(04:34)* Reported the grayed-out numbers still weren't showing for
    that same case.
55. *(04:37)* In multiple choice, the prompt should show only the
    meaning, not the bracketed on/kun readings after it (e.g. "Water",
    not "Water [kun: みず, on: すい]").
56. *(04:41)* Asked whether the confusable-kanji distractors would still
    work under the new per-filter count system.
57. *(04:45)* In multiple choice: don't require a second tap to advance
    after a correct answer — auto-advance, keep the green/red flash, and
    make the green a true green rather than mint-tinted. Keep
    tap-to-continue only for wrong answers, highlighting the correct
    option green and the picked one red.
58. *(04:53)* Bug: after a correct answer, the option in that same grid
    position stayed green forever on the next question. Also: replace
    the two results-screen buttons ("Study again" / "Choose another
    deck") with a single button that goes back to the deck.
59. *(05:07)* Asked for an internal README explaining the whole project
    technically for a future Claude session, deliberately kept off the
    published site, containing the phrase "ai slop" somewhere.
60. *(14:03)* Asked why every reply showed a "+295" diff — question about
    `CLAUDE.md` being re-injected into context every turn.
    **(still open)** — I offered to rename it to something that isn't
    Claude Code's auto-loaded convention, to stop the repeated injection;
    never confirmed or acted on.

## Sept 17–18 — CSV import, activity heatmap, home-screen cleanup

61. *(Sept 17, 04:21)* When uploading a CSV with only front/back columns,
    asked whether the app can fill in the rest itself.
62. *(04:23)* Pushed back on `id: null` being fine for those auto-filled
    cards, and asked for exact-duplicate rows to just be dropped on
    import.
63. *(04:40)* Asked for ideas for other Japanese-learning app features,
    given the app already has flashcards and multiple choice.
64. *(Sept 18, 06:58)* Asked me to keep asking questions until I
    understood, then requested an activity heatmap: colored by how many
    cards were played that day (a heavy day should look visibly stronger
    than a light one), placed on the home screen below the deck list,
    spanning more than just the current month.
65. *(13:34)* Revised the heatmap: show one month at a time, swipe
    sideways to change months (blocking future months), rows as weeks
    and columns as days, day-of-week headers Monday-Sunday (M T W T F S
    S).
66. *(13:42)* Corrected the previous fix: blocking navigation into a
    future *month* didn't mean hiding the remaining days of the
    *current* month too — the full month should still render, and the
    calendar has to be the very last element on the home screen, below
    the upload-deck button.
67. *(13:45)* Remove the "Deck list." tagline text, and add a small,
    subdued gray divider line between the deck list and the upload-CSV
    button.
68. *(13:47)* Remove the "Flashcard activity" label above the calendar
    too.
69. *(18:31)* Clarified they meant only the label text, not the calendar
    itself, after thinking it had been deleted (it hadn't).

## Sept 22 — this document

70. *(05:17)* Create this requirements document, in order, covering
    everything asked across the whole chat — flagged that something
    asked for earlier never got done, but said it isn't urgent.

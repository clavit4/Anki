# Recall

A tiny, personal flashcard app. Random order, self-graded, no daily card limit,
no account, no tracking. Runs entirely as static files — no build step, no
server, no framework.

## Files

```
index.html        the app shell
style.css         dark / mint theme
app.js            all the logic (deck loading, quiz flow, scoring)
decks/deck1.csv   sample deck — replace with your own
decks/deck2.csv   sample deck — replace with your own
```

## Deploy it on GitHub Pages

1. Create a new **public** GitHub repo (Pages on a free plan needs the repo
   to be public — a private repo works too if you're on GitHub Pro/Team/Enterprise).
2. Add these files to the repo, keeping the `decks/` folder as-is.
3. Push to the `main` branch.
4. In the repo: **Settings → Pages → Build and deployment → Source**, choose
   *Deploy from a branch*, branch `main`, folder `/ (root)`. Save.
5. GitHub gives you a URL like `https://your-username.github.io/your-repo/`.
   Give it a minute the first time.
6. Open that URL on your phone. Optionally use your browser's
   "Add to Home Screen" so it opens like an app.

## Updating your decks

Each CSV needs a `front,back` header, then one card per row:

```csv
front,back
Capital of Japan,Tokyo
"Author of ""Hamlet""",William Shakespeare
```

- If a field contains a comma, wrap the whole field in double quotes.
- If a field itself contains a double quote, double it up (`""`) inside the
  quoted field, as in the example above.
- Blank lines are ignored.

To update a deck: edit the CSV (directly on github.com, with a git client, or
however you like) and push/commit to `main`. GitHub Pages redeploys
automatically, usually within a minute — just reload the page on your phone.

### Adding, renaming, or removing decks

Open `app.js` and edit the `DECKS` array at the top:

```js
const DECKS = [
  { id: 'deck1', name: 'Deck 1', file: 'decks/deck1.csv' },
  { id: 'deck2', name: 'Deck 2', file: 'decks/deck2.csv' },
];
```

`name` is what's shown in the app; `file` is the path to the CSV. Add as many
entries as you want, each pointing at its own CSV file inside (or outside)
`decks/`.

## How a session works

1. Pick a deck.
2. Pick how many cards: fixed options up to 100 (only the ones that fit the
   deck are shown), plus an "All" option for the full deck.
3. Cards are pulled in random order, no repeats within the session. Tap a
   card (or press space) to reveal the answer, then mark it "Got it" or
   "Missed it" — or use the left/right arrow keys once it's flipped.
4. At the end you get a score and a list of anything you missed, with
   buttons to run the same deck again or go pick a different one.

Nothing is saved between sessions right now — refreshing or closing the tab
resets everything. That was a deliberate call for this first version; if you
later want streaks or per-card history, that would mean storing results in
the browser's `localStorage`, which is a natural next step whenever you want it.

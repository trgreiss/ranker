# Ranker

Rank any list by repeatedly choosing between two or three items at a time.

Paste a list (one item per line), then click the cards from most to least preferred. Ranker picks each comparison so the whole list is ordered in as few clicks as practical. A 500-item list takes about 2,050 picks.

## Features

- Rank lists of any length; blank lines and duplicates are skipped
- Paste rows from a spreadsheet: the first column is the item's name and any other columns appear as smaller details on each card (for example "1994, Quentin Tarantino" under "Pulp Fiction"). Plain one-per-line lists work as before.
- Spreadsheet rankings copy and download as tab-separated rows with a rank column, so they paste straight back into a spreadsheet
- Undo, plus automatic save and resume in the browser (refreshing mid-ranking is safe)
- Progress bar with an estimate of picks remaining
- Copy or download the final ranking as text
- Light and dark themes
- No build step, no dependencies, no server: plain HTML, CSS and JavaScript

## Running it

Open `index.html` through any static web server, for example:

```bash
python -m http.server 8765
```

then visit <http://localhost:8765>. Opening the file directly from disk also works, but some browsers then block saving progress.

The repository root is a complete static site, so it can be published as-is with GitHub Pages (Settings → Pages → deploy from the main branch, root folder).

## How the ranking works

Ranker uses a **3-way merge sort** built around 3-item questions:

1. The shuffled list is split into groups of three, and each group is ranked with one question. Three unrelated items have 6 possible orders, so each of these questions carries as much information as a question can.
2. Sorted groups are then merged three at a time. Each question takes one item from near the front of each group, so usually none of the three has been compared before, and a single answer settles up to three comparisons.
3. Everything that follows from earlier answers (if A beats B and B beats C, then A beats C) is inferred automatically and never asked.

Two-item questions appear only when two items are the only useful comparison left.

Average number of picks, from the simulator:

| Items | Theoretical minimum | Ranker | Pairwise sorting |
|------:|--------------------:|-------:|-----------------:|
| 50    | 83                  | 113    | 217              |
| 100   | 204                 | 290    | 530              |
| 500   | 1,458               | 2,055  | 3,796            |
| 1,000 | 3,300               | 4,627  | 8,590            |

The theoretical minimum is log₂(n!) / log₂(6), the information needed to fix an order divided by the most a 3-item question can reveal.

If an answer contradicts earlier ones, the part that conflicts is ignored, so the ranking always completes.

## Files

| File         | Purpose |
|--------------|---------|
| `index.html` | Page markup |
| `styles.css` | Material Design–style theme (light and dark) |
| `app.js`     | UI: input, comparison cards, undo, saving, results, theme toggle |
| `ranker.js`  | Ranking engine with no DOM code; runs in the browser or Node |
| `sim.js`     | Simulator and test suite comparing the engine with other algorithms |

## Testing

```bash
node sim.js
```

The simulator ranks random hidden orderings, checks every result is correct, compares the engine against ternary insertion, ternary merge-insertion and pairwise sorting, and tests undo, save/resume, the progress estimate, and random (inconsistent) answers. It exits non-zero if any check fails.

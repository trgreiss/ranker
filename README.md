# Ranker

Rank any list by repeatedly choosing between two or three items at a time.

Paste a list (one item per line), then click the cards from most to least preferred. Ranker picks each comparison so the whole list is ordered in as few clicks as practical. A 500-item list takes about 2,050 picks.

## Features

- Rank lists of any length; blank lines and duplicates are skipped
- Paste rows from a spreadsheet: the first column is the item's name and any other columns appear as smaller details on each card (for example "1994, Quentin Tarantino" under "Pulp Fiction")
- Spreadsheet rankings copy and download as tab-separated rows with a rank column, so they paste straight back into a spreadsheet
- Ratings cut down the picks: paste a column of ratings and items more than 1 point apart are ordered by rating without being shown to you (see below)
- Import from Letterboxd: every film you've logged as watched, with your star ratings
- Undo, plus automatic save and resume (refreshing mid-ranking is safe)
- Progress bar with an estimate of picks remaining
- Copy or download the final ranking as text
- Light and dark themes
- Private: everything runs in your browser, and nothing you paste or import is uploaded

## Using it

Ranker is a static site of plain HTML, CSS and JavaScript, with no build step and no dependencies. Open `index.html` in a browser, or host the repository root on any static host such as GitHub Pages. Progress is saved in your browser's local storage.

## Ratings

If one of the pasted columns holds ratings, Ranker finds it and uses it. A rating is written as stars (`★★★½`, as Letterboxd shows them) or as a number from 0 to 10, such as `4.5`, `8`, `7,5`, `8/10` or `3.5/5` (the number before the slash is used). Rows without a rating are fine. A column counts as ratings when every filled cell reads as one. A column of all-different whole numbers (1, 2, 3, …) looks like a rank or a count, so it's used only when its header names it a rating.

A first row such as `Film  Year  My rating` is treated as column names when it names the rating column (rating, rated, score, stars or grade). It's left out of the ranking and added back as a header, with a Rank column, when you copy or download the result.

When a rating column is found, a checkbox under the list shows which column will be used and can turn it off. The setting is remembered.

Ratings are hidden on the comparison cards so they don't sway your picks; the other columns still appear as details. They're kept in the copied and downloaded results.

## Importing from Letterboxd

1. On Letterboxd, open [Settings → Data](https://letterboxd.com/settings/data/) and choose **Export your data**.
2. In Ranker, open **Import films from Letterboxd** and choose the downloaded .zip (or its `watched.csv` and `ratings.csv`).

The list fills with one row per watched film: title, year and your rating in stars, ready to edit before you start. Cards show each film's title and year, but not your rating. The file is read in the browser and never uploaded.

Ranker reads the export file rather than your Letterboxd profile because Letterboxd's pages can't be read from another site in the browser.

### How ratings are used

Two rated items more than 1 point (1 star) apart are never compared: a 3½★ film is placed above a 2★ film automatically, and so is an 8/10 film above a 6.5/10 one. Only items within 1 point of each other are shown (3½★ against 2½★–4½★), and unrated items are compared with anything. Your answers can still order a 3★ film above a 3½★ one.

The gap is always 1 point on the scale you used. On a 10-point scale that's a narrower band than 1 star on a 5-star scale, so more pairs are settled by rating and you're asked fewer questions.

Rated items start the sort in rating order, so merges mostly interleave neighbouring rating bands. The questions are still asked in a mixed order rather than from the highest rated down (see below). From the simulator, with a typical spread of ratings:

| Items | No ratings | 5 stars, all rated | 5 stars, 20% unrated | 10 points, all rated |
|------:|-----------:|-------------------:|---------------------:|---------------------:|
| 100   | 290        | 236                | 258                  | 190                  |
| 500   | 2,055      | 1,792              | 1,956                | 1,619                |

The progress estimate doesn't account for ratings, so it overestimates a little when they're used.

## How the ranking works

Ranker uses a **3-way merge sort** built around 3-item questions:

1. The shuffled list is split into groups of three, and each group is ranked with one question. Three unrelated items have 6 possible orders, so each of these questions carries as much information as a question can.
2. Sorted groups are then merged three at a time. Each question takes one item from near the front of each group, so usually none of the three has been compared before, and a single answer settles up to three comparisons.
3. Everything that follows from earlier answers (if A beats B and B beats C, then A beats C) is inferred automatically and never asked.

Two-item questions appear only when two items are the only useful comparison left.

Groups and merges that don't depend on each other can be worked on in any order, so each question is drawn from a random one of those ready to ask, and the cards within a question are shuffled. Only the order changes: the questions and their number are the same as working through the list front to back.

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
| `items.js`   | Parses the pasted list and finds a rating column; no DOM code |
| `letterboxd.js` | Reads a Letterboxd data export (.zip or CSV); no DOM code |
| `sim.js`     | Simulator and test suite comparing the engine with other algorithms |
| `test-items.js` | Tests for list parsing and rating-column detection |
| `test-letterboxd.js` | Tests for the Letterboxd export reader |

## Testing

The tests run with [Node.js](https://nodejs.org/):

```bash
node sim.js
node test-items.js
node test-letterboxd.js
```

The simulator ranks random hidden orderings, checks every result is correct, compares the engine against ternary insertion, ternary merge-insertion and pairwise sorting, and tests undo, save/resume, the progress estimate, and random (inconsistent) answers. With ratings it also checks that no question shows two rated items more than 1 point apart. `test-items.js` checks rating-column detection and `test-letterboxd.js` reads synthetic export zips and CSVs. All exit non-zero if any check fails.

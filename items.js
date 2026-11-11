// Parses the pasted list. No DOM code; works as a browser global (window.Items) or a Node module.
//
// Rows pasted from a spreadsheet arrive tab-separated. The first column is the item's label and
// any other columns are details shown beneath it. Items are stored as the tab-joined row.
//
// One detail column may be recognised as a rating, so items more than 1 point apart are ordered
// without being compared. A rating cell is stars ("★★★½") or a number from 0 to 10, optionally
// written as "8/10" or "3.5/5" (the number before the slash is used).
(function (root) {
  'use strict';

  const STARS = /^(★{1,5}½?|½)$/;
  const NUMBER = /^(\d{1,2}(?:[.,]\d+)?)(?:\s*\/\s*(\d{1,3}))?$/;
  const HEADER = /\b(rating|rated|score|stars?|grade)\b/i;
  const MAX_RATING = 10;

  // A cell's rating, or null if the cell doesn't read as one.
  function parseRating(cell) {
    if (STARS.test(cell)) return cell.replace('½', '').length + (cell.endsWith('½') ? 0.5 : 0);
    const m = cell.match(NUMBER);
    if (!m) return null;
    const value = Number(m[1].replace(',', '.'));
    if (value > MAX_RATING || (m[2] && value > Number(m[2]))) return null;
    return value;
  }

  function starText(rating) {
    return '★'.repeat(Math.floor(rating)) + (rating % 1 ? '½' : '');
  }

  // Picks the detail column that holds ratings, if any. rows: arrays of cells, header excluded.
  // Returns { column, score } or null. A column qualifies when every filled cell is a rating and at
  // least two are filled. Columns of distinct whole numbers look like ranks or counts, so they
  // only qualify with a rating-like header. Ties go to a named column, then one with stars or
  // decimals, then the rightmost.
  function ratingColumn(rows, header) {
    const width = Math.max(0, ...rows.map((r) => r.length));
    let best = null;
    for (let col = 1; col < width; col++) {
      const cells = rows.map((r) => r[col] || '').filter(Boolean);
      const values = cells.map(parseRating);
      if (values.length < 2 || values.some((v) => v == null)) continue;
      const named = !!(header && HEADER.test(header[col] || ''));
      const wholeAndDistinct = values.every(Number.isInteger) && new Set(values).size === values.length;
      if (wholeAndDistinct && values.length >= 3 && !named) continue;
      const fractional = cells.some((c, i) => STARS.test(c) || !Number.isInteger(values[i]));
      const score = (named ? 4 : 0) + (fractional ? 2 : 0) + col / width;
      if (!best || score > best.score) best = { column: col, score };
    }
    return best;
  }

  function parse(text) {
    let rows = [];
    let unlabeled = 0;
    for (const line of text.split(/\r?\n/)) {
      const cells = line.split('\t').map((c) => c.trim());
      while (cells.length > 1 && !cells[cells.length - 1]) cells.pop();
      if (!cells[0]) {
        if (cells.length > 1) unlabeled++;
        continue;
      }
      rows.push(cells);
    }

    // A first row naming a rating column ("Title  Year  Rating") is a header, not an item.
    let header = null;
    let found = ratingColumn(rows);
    if (rows.length > 2 && rows[0].some((c, i) => i > 0 && HEADER.test(c))) {
      const withHeader = ratingColumn(rows.slice(1), rows[0]);
      if (withHeader && HEADER.test(rows[0][withHeader.column] || '')) {
        header = rows[0];
        rows = rows.slice(1);
        found = withHeader;
      }
    }

    const seen = new Set();
    const items = [];
    const ratings = [];
    let dupes = 0;
    let detailColumns = 0;
    for (const cells of rows) {
      const item = cells.join('\t');
      if (seen.has(item.toLowerCase())) { dupes++; continue; }
      seen.add(item.toLowerCase());
      items.push(item);
      ratings.push(found ? parseRating(cells[found.column] || '') : null);
      detailColumns = Math.max(detailColumns, cells.length - 1);
    }
    const rated = ratings.filter((r) => r != null).length;
    return {
      items,
      dupes,
      unlabeled,
      detailColumns,
      header: header ? header.join('\t') : null,
      ratingColumn: found ? found.column : null,
      ratingName: found ? (header && header[found.column]) || `column ${found.column + 1}` : null,
      ratings: rated ? ratings : null,
      rated,
    };
  }

  const api = { parse, parseRating, starText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Items = api;
})(typeof self !== 'undefined' ? self : this);

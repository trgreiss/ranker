// Tests for items.js: list parsing and rating-column detection. Usage: node test-items.js
'use strict';
const { parse, parseRating } = require('./items.js');

let failures = 0;
function check(name, actual, want) {
  if (JSON.stringify(actual) === JSON.stringify(want)) console.log(`ok   ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}\n  got  ${JSON.stringify(actual)}\n  want ${JSON.stringify(want)}`);
  }
}
const rows = (...lines) => lines.map((l) => l.join('\t')).join('\n');
const summary = (p) => ({ items: p.items.length, column: p.ratingColumn, name: p.ratingName, header: p.header, ratings: p.ratings });

check('rating cells', ['★★★½', '½', '4.5', '8', '7,5', '8/10', '3.5/5', '0', '10', '11', '1994', '9/5', 'good', ''].map(parseRating),
  [3.5, 0.5, 4.5, 8, 7.5, 8, 3.5, 0, 10, null, null, null, null, null]);

check('plain list has no ratings', summary(parse('Alpha\nBeta\nGamma')),
  { items: 3, column: null, name: null, header: null, ratings: null });

check('numeric column without header', summary(parse(rows(
  ['Heat', '1995', '4.5'],
  ['Alien', '1979', '4'],
  ['Cats', '2019', '1'],
  ['Unrated', '2001']))),
{ items: 4, column: 2, name: 'column 3', header: null, ratings: [4.5, 4, 1, null] });

check('header row names the rating column and is dropped', summary(parse(rows(
  ['Film', 'Year', 'My rating'],
  ['Heat', '1995', '9'],
  ['Alien', '1979', '8'],
  ['Cats', '2019', '2']))),
{ items: 3, column: 2, name: 'My rating', header: 'Film\tYear\tMy rating', ratings: [9, 8, 2] });

check('distinct whole numbers look like ranks, not ratings', summary(parse(rows(
  ['A', '1'], ['B', '2'], ['C', '3'], ['D', '4']))).column, null);

check('distinct whole numbers count under a rating header', summary(parse(rows(
  ['Name', 'Score'], ['A', '1'], ['B', '2'], ['C', '3']))).column, 1);

check('stars or decimals beat a plain whole-number column', summary(parse(rows(
  ['Show', 'Seasons', 'Stars'],
  ['A', '3', '★★★½'],
  ['B', '3', '★★'],
  ['C', '5', '★★★★★']).replace(/^Show.*\n/, ''))).column, 2);

check('one non-rating cell disqualifies the column', summary(parse(rows(
  ['A', '4'], ['B', 'n/a'], ['C', '3']))).column, null);

check('letterboxd rows with a missing year keep the rating column', summary(parse(rows(
  ['Heat', '1995', '★★★★½'],
  ['Mystery', '', '★★'],
  ['Alien', '1979']))),
{ items: 3, column: 2, name: 'column 3', header: null, ratings: [4.5, 2, null] });

check('duplicates skipped after header removal', summary(parse(rows(
  ['Film', 'Rating'], ['Heat', '4'], ['heat', '4'], ['Alien', '3']))).ratings, [4, 3]);

console.log(failures ? `\n${failures} failures` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;

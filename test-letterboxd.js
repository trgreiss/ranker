// Tests for letterboxd.js using synthetic exports. Usage: node test-letterboxd.js
'use strict';
const zlib = require('zlib');
const { readExport, parseCsv } = require('./letterboxd.js');

// Minimal zip writer: deflated or stored entries, CRCs left at zero (the reader ignores them).
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, text, store } of entries) {
    const nameBuf = Buffer.from(name);
    const raw = Buffer.from(text);
    const data = store ? raw : zlib.deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const WATCHED = '﻿Date,Name,Year,Letterboxd URI\r\n'
  + '2024-01-02,Heat,1995,https://boxd.it/a1\r\n'
  + '2024-01-03,"Crouching Tiger, Hidden Dragon",2000,https://boxd.it/a2\r\n'
  + '2024-01-04,"The ""Burbs""",1989,https://boxd.it/a3\r\n'
  + '2024-01-05,Unrated Film,2010,https://boxd.it/a4\r\n';
const RATINGS = 'Date,Name,Year,Letterboxd URI,Rating\n'
  + '2024-01-02,Heat,1995,https://boxd.it/a1,4.5\n'
  + '2024-01-03,"Crouching Tiger, Hidden Dragon",2000,https://boxd.it/OTHER,3\n' // URI differs: match by name+year
  + '2024-01-04,"The ""Burbs""",1989,https://boxd.it/a3,0.5\n'
  + '2024-01-06,Rated Only,2020,https://boxd.it/a5,2.5\n';
const DECOY = 'Date,Name,Year,Letterboxd URI\n2024-01-01,Should Not Appear,1999,https://boxd.it/zz\n';

const expected = [
  { title: 'Heat', year: '1995', rating: 4.5 },
  { title: 'Crouching Tiger, Hidden Dragon', year: '2000', rating: 3 },
  { title: 'The "Burbs"', year: '1989', rating: 0.5 },
  { title: 'Unrated Film', year: '2010', rating: null },
  { title: 'Rated Only', year: '2020', rating: 2.5 },
];

let failures = 0;
function check(name, actual, want) {
  const ok = JSON.stringify(actual) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.error(`FAIL ${name}\n  got  ${JSON.stringify(actual)}\n  want ${JSON.stringify(want)}`);
  } else console.log(`ok   ${name}`);
}

(async () => {
  check('csv with quotes, commas and line breaks', parseCsv('a,"b, c","d ""e""\nf"\r\n1,2,3'), [['a', 'b, c', 'd "e"\nf'], ['1', '2', '3']]);

  const zip = makeZip([
    { name: 'profile.csv', text: 'Username\nsomeone\n' },
    { name: 'lists/watched.csv', text: DECOY },
    { name: 'watched.csv', text: WATCHED },
    { name: 'ratings.csv', text: RATINGS, store: true },
  ]);
  check('zip export', await readExport([new File([zip], 'letterboxd-someone-2026-11-11.zip')]), expected);

  check('csv files chosen directly', await readExport([
    new File([RATINGS], 'ratings.csv'),
    new File([WATCHED], 'watched.csv'),
  ]), expected);

  check('watched.csv only', (await readExport([new File([WATCHED], 'watched.csv')])).map((f) => f.rating), [null, null, null, null]);

  for (const [name, files] of [
    ['unrelated file', [new File(['x'], 'notes.txt')]],
    ['not a zip', [new File(['not a zip at all'], 'export.zip')]],
    ['empty export', [new File(['Date,Name,Year,Letterboxd URI\n'], 'watched.csv')]],
  ]) {
    try {
      await readExport(files);
      failures++;
      console.error(`FAIL ${name}: expected an error`);
    } catch (e) {
      console.log(`ok   ${name} rejected: ${e.message}`);
    }
  }

  console.log(failures ? `\n${failures} failures` : '\nall checks passed');
  process.exitCode = failures ? 1 : 0;
})();

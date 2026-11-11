// Reads a Letterboxd data export (letterboxd.com/settings/data → Export your data) into films.
// Accepts the downloaded .zip, or its watched.csv and ratings.csv chosen directly.
// No DOM code and no dependencies; works as a browser global (window.Letterboxd) or a Node module.
// Unzipping uses the built-in DecompressionStream (all current browsers, Node 18+).
(function (root) {
  'use strict';

  class ExportError extends Error {}

  // RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((f) => f.trim()));
  }

  // Rows as objects keyed by the header row.
  function csvRecords(text) {
    const [header, ...rows] = parseCsv(text);
    if (!header) return [];
    const keys = header.map((h) => h.trim());
    return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] || '').trim()])));
  }

  // Minimal zip reader: returns { path: text } for entries whose path passes `want`.
  async function readZip(buffer, want) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new ExportError("That file isn't a readable .zip.");
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder('utf-8');
    const out = {};
    for (let n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new ExportError("That .zip looks damaged.");
      const method = view.getUint16(p + 10, true);
      const size = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const skip = nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
      const local = view.getUint32(p + 42, true);
      const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      p += 46 + skip;
      if (!want(name)) continue;
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) out[name] = decoder.decode(data);
      else if (method === 8) out[name] = await inflateText(data);
      else throw new ExportError(`Can't unzip ${name} (compression method ${method}).`);
    }
    return out;
  }

  async function inflateText(data) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  }

  const baseName = (path) => path.split('/').pop().toLowerCase();

  // watched.csv: Date, Name, Year, Letterboxd URI. ratings.csv adds Rating (0.5–5).
  // Every rated film counts as watched, even if it's missing from watched.csv.
  function filmsFrom(watchedCsv, ratingsCsv) {
    const films = new Map();
    const keyOf = (r) => r['Letterboxd URI'] || `${r.Name}\u0000${r.Year}`;
    const add = (r) => {
      if (!r.Name) return null;
      const key = keyOf(r);
      if (!films.has(key)) films.set(key, { title: r.Name, year: r.Year || '', rating: null });
      return films.get(key);
    };
    for (const r of csvRecords(watchedCsv || '')) add(r);
    // Ratings may carry a different URI than watched.csv, so match on name and year as a fallback.
    const byNameYear = new Map([...films.values()].map((f) => [`${f.title}\u0000${f.year}`, f]));
    for (const r of csvRecords(ratingsCsv || '')) {
      const rating = Number(r.Rating);
      const film = films.get(keyOf(r)) || byNameYear.get(`${r.Name}\u0000${r.Year}`) || add(r);
      if (film && rating >= 0.5 && rating <= 5) film.rating = Math.round(rating * 2) / 2;
    }
    return [...films.values()];
  }

  // files: File/Blob objects with a name: one .zip export, or watched.csv and/or ratings.csv.
  // Returns [{ title, year, rating }] with rating in stars or null.
  async function readExport(files) {
    files = [...files];
    let watched = null;
    let ratings = null;
    for (const file of files) {
      const name = file.name.toLowerCase();
      if (name.endsWith('.zip')) {
        // Use the top-level files; lists/ and deleted/ hold other CSVs with the same names.
        const entries = await readZip(await file.arrayBuffer(), (p) => !p.includes('/') && /^(watched|ratings)\.csv$/i.test(p));
        for (const [path, text] of Object.entries(entries)) {
          if (baseName(path) === 'watched.csv') watched = text;
          else ratings = text;
        }
      } else if (name.endsWith('.csv') && name.includes('watched')) watched = await file.text();
      else if (name.endsWith('.csv') && name.includes('rating')) ratings = await file.text();
    }
    if (watched == null && ratings == null) {
      throw new ExportError('Choose the .zip from Letterboxd\'s "Export your data", or its watched.csv and ratings.csv.');
    }
    const films = filmsFrom(watched, ratings);
    if (!films.length) throw new ExportError('No watched films found in that export.');
    return films;
  }

  const api = { readExport, readZip, parseCsv, filmsFrom, ExportError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Letterboxd = api;
})(typeof self !== 'undefined' ? self : this);

// UI wiring for the ranker. Engine lives in ranker.js.
(function () {
  'use strict';

  const STORAGE_KEY = 'ranker.session.v1';
  const DRAFT_KEY = 'ranker.draft.v1';
  const THEME_KEY = 'ranker.theme';
  // Pause after the final pick so the completed order is visible, then a short lockout once the
  // next cards appear so a click aimed at the old cards doesn't land on the new ones.
  const SUBMIT_DELAY_MS = 450;
  const NEW_QUERY_LOCK_MS = 300;
  const $ = (id) => document.getElementById(id);

  let ranker = null;
  let query = [];  // ids shown on screen, in display order
  let picks = [];  // ids clicked so far, most preferred first
  let submitting = false;
  let lockedUntil = 0;

  function store(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage unavailable; the session just won't survive a reload */ }
  }

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }

  // Rows pasted from a spreadsheet arrive tab-separated. The first column is the item's label;
  // any other columns are details shown beneath it. Items are stored as the tab-joined row.
  function parseItems(text) {
    const seen = new Set();
    const items = [];
    let dupes = 0;
    let unlabeled = 0;
    let detailColumns = 0;
    for (const line of text.split(/\r?\n/)) {
      const cells = line.split('\t').map((c) => c.trim());
      while (cells.length > 1 && !cells[cells.length - 1]) cells.pop();
      if (!cells[0]) {
        if (cells.length > 1) unlabeled++;
        continue;
      }
      const item = cells.join('\t');
      if (seen.has(item.toLowerCase())) { dupes++; continue; }
      seen.add(item.toLowerCase());
      items.push(item);
      detailColumns = Math.max(detailColumns, cells.length - 1);
    }
    return { items, dupes, unlabeled, detailColumns };
  }

  function splitItem(item) {
    const [label, ...rest] = item.split('\t');
    return { label, details: rest.filter(Boolean).join(', ') };
  }

  // Label in normal text with any details in a smaller line below.
  function labelNodes(item, detailsClass) {
    const { label, details } = splitItem(item);
    const title = document.createElement('span');
    title.className = 'item-label';
    title.textContent = label;
    if (!details) return [title];
    const sub = document.createElement('span');
    sub.className = detailsClass;
    sub.textContent = details;
    return [title, sub];
  }

  function show(view) {
    for (const v of ['input', 'compare', 'result']) $('view-' + v).hidden = v !== view;
  }

  // ---- Input view ----

  function updateInputStatus() {
    const { items, dupes, unlabeled, detailColumns } = parseItems($('items').value);
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const parts = [plural(items.length, 'item')];
    if (detailColumns) parts.push(`${plural(detailColumns, 'extra column')} shown as details`);
    if (dupes) parts.push(`${plural(dupes, 'duplicate')} will be skipped`);
    if (unlabeled) parts.push(`${plural(unlabeled, 'row')} with an empty first column will be skipped`);
    $('input-status').textContent = parts.join(' · ');
    $('start').disabled = items.length < 2;
  }

  function showInput() {
    show('input');
    updateInputStatus();
    $('items').focus();
  }

  function start() {
    const { items } = parseItems($('items').value);
    if (items.length < 2) return;
    ranker = Ranker.createRanker(items);
    save();
    next();
  }

  // ---- Compare view ----

  function save() {
    store(STORAGE_KEY, ranker ? ranker.serialize() : null);
  }

  function next() {
    picks = [];
    submitting = false;
    if (ranker.isDone()) return showResult();
    const fresh = ranker.nextQuery();
    const changed = fresh.join() !== query.join();
    query = fresh;
    show('compare');
    renderCompare();
    if (changed) {
      lockedUntil = performance.now() + NEW_QUERY_LOCK_MS;
      $('cards').classList.remove('entering');
      void $('cards').offsetWidth; // restart the fade-in animation
      $('cards').classList.add('entering');
    }
  }

  function renderCompare() {
    const done = ranker.comparisons();
    const left = ranker.estimateRemaining();
    const pct = (done / (done + left)) * 100;
    $('progress-bar').style.width = pct.toFixed(1) + '%';
    $('progress-text').textContent = `${done} done · about ${left} to go`;
    $('prompt').textContent = query.length === 2 ? 'Which do you prefer?' : 'Click from most to least preferred';
    $('undo').disabled = done === 0 && picks.length === 0;

    const cards = $('cards');
    // Only a new question fades in (next() re-adds the class); re-renders after a pick don't.
    cards.classList.remove('entering');
    cards.replaceChildren();
    query.forEach((id) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      const pickIndex = picks.indexOf(id);
      if (pickIndex >= 0) {
        card.classList.add('picked');
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = pickIndex + 1;
        card.append(badge);
      }
      card.append(...labelNodes(ranker.items[id], 'card-details'));
      card.addEventListener('click', () => pick(id));
      cards.append(card);
    });
  }

  function pick(id) {
    if (submitting || performance.now() < lockedUntil) return;
    const at = picks.indexOf(id);
    if (at >= 0) picks = picks.slice(0, at); // clicking a picked card un-picks it and later picks
    else picks.push(id);
    if (picks.length === query.length - 1) {
      // The last card is implied.
      picks.push(query.find((q) => !picks.includes(q)));
      submitting = true;
      renderCompare();
      setTimeout(() => {
        ranker.answer(picks);
        save();
        next();
      }, SUBMIT_DELAY_MS);
      return;
    }
    renderCompare();
  }

  function undo() {
    if (submitting) return;
    if (picks.length) {
      picks.pop();
      renderCompare();
      return;
    }
    if (ranker.undo()) {
      save();
      next();
    }
  }

  function editList() {
    if (ranker.comparisons() > 0 && !confirm('Start over? Your progress on this list will be lost.')) return;
    $('items').value = ranker.items.join('\n');
    ranker = null;
    save();
    showInput();
  }

  // ---- Result view ----

  function showResult() {
    show('result');
    const result = ranker.result();
    const list = $('result');
    list.replaceChildren(...result.map((item) => {
      const li = document.createElement('li');
      li.append(...labelNodes(item, 'result-details'));
      return li;
    }));
  }

  // Tabular lists export as tab-separated rows with a rank column, so they paste back into a
  // spreadsheet; plain lists export as "1. item".
  function resultText() {
    const result = ranker.result();
    const tabular = result.some((item) => item.includes('\t'));
    return result.map((item, i) => (tabular ? `${i + 1}\t${item}` : `${i + 1}. ${item}`)).join('\n');
  }

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(resultText());
      flash($('copy'), 'Copied');
    } catch (e) {
      flash($('copy'), 'Copy failed');
    }
  }

  function downloadResult() {
    const url = URL.createObjectURL(new Blob([resultText() + '\n'], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ranking.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function flash(button, text) {
    const original = button.textContent;
    button.textContent = text;
    setTimeout(() => (button.textContent = original), 1200);
  }

  // ---- Wiring ----

  $('items').addEventListener('input', () => {
    updateInputStatus();
    store(DRAFT_KEY, $('items').value);
  });
  $('start').addEventListener('click', start);
  $('undo').addEventListener('click', undo);
  $('restart').addEventListener('click', editList);
  $('copy').addEventListener('click', copyResult);
  $('download').addEventListener('click', downloadResult);
  $('result-undo').addEventListener('click', undo);
  $('again').addEventListener('click', editList);

  // The saved theme is applied by an inline script in index.html before first paint.
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    $('theme-toggle').setAttribute('aria-label', label);
    $('theme-toggle').title = label;
  }
  setTheme(document.documentElement.dataset.theme);
  $('theme-toggle').addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* not remembered */ }
  });

  const saved = load(STORAGE_KEY);
  if (saved && Array.isArray(saved.items) && saved.items.length >= 2) {
    ranker = Ranker.createRanker(saved.items, saved);
    next();
  } else {
    $('items').value = load(DRAFT_KEY) || '';
    showInput();
  }
})();

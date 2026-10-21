// Ranking engine: orders a list using queries of 2–3 items.
// Pure logic, no DOM. Works as a browser global (window.Ranker) or a Node module.
//
// Algorithm: 3-way merge sort.
//   1. Split the (shuffled) list into groups of 3 and rank each group with one query.
//      A triple of unrelated items has 6 possible orders, so this uses a query fully.
//   2. Repeatedly merge 3 sorted runs at a time. Each merge query takes one item from near the
//      front of each run, so all three relations are usually unknown and every answer teaches
//      up to three new facts. Transitive inference fills in everything that follows.
// Simulated at n = 500 it needs about 2,040 queries, versus about 2,500 for ternary binary
// insertion, 3,800 for pairwise sorting, and a theoretical floor of 1,458 (see sim.js).
(function (root) {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Transitive closure of "better than" over indices 0..M-1, stored as bitsets.
  function createClosure(M) {
    const W = (M + 31) >>> 5;
    const worse = Array.from({ length: M }, () => new Uint32Array(W)); // worse[u] holds v when u beats v
    const better = Array.from({ length: M }, () => new Uint32Array(W));
    const has = (bits, v) => ((bits[v >>> 5] >>> (v & 31)) & 1) === 1;
    const members = (bits) => {
      const out = [];
      for (let k = 0; k < W; k++) {
        for (let w = bits[k]; w !== 0; w &= w - 1) out.push((k << 5) + (31 - Math.clz32(w & -w)));
      }
      return out;
    };
    const less = (u, v) => has(worse[u], v);
    return {
      less,
      known: (u, v) => less(u, v) || less(v, u),
      // Record "u beats v" plus every consequence. Ignored if it contradicts what is known.
      add(u, v) {
        if (u === v || less(u, v) || less(v, u)) return;
        const above = better[u].slice();
        above[u >>> 5] |= 1 << (u & 31);
        const below = worse[v].slice();
        below[v >>> 5] |= 1 << (v & 31);
        for (const x of members(above)) for (let k = 0; k < W; k++) worse[x][k] |= below[k];
        for (const y of members(below)) for (let k = 0; k < W; k++) better[y][k] |= above[k];
      },
    };
  }

  // Expected queries per merged item, measured with sim.js; used only for progress estimates.
  const RATE = { 2: 0.63, 3: 0.76 };
  const WINDOW = 3; // how far past each run's first unresolved item a query may reach

  // The merge schedule depends only on n, so it can be planned up front for progress estimates.
  // Returns { runSizes, merges: [{ k, size }] } in execution order.
  function planMerges(n) {
    let runs = [];
    for (let i = 0; i < n; i += 3) runs.push(Math.min(3, n - i));
    const runSizes = runs.slice();
    const merges = [];
    while (runs.length > 1) {
      const next = [];
      for (let i = 0; i < runs.length; ) {
        const k = groupSize(runs.length - i);
        const size = runs.slice(i, i + k).reduce((s, x) => s + x, 0);
        if (k > 1) merges.push({ k, size });
        next.push(size);
        i += k;
      }
      runs = next;
    }
    return { runSizes, merges };
  }

  // Merge in threes; a single leftover run waits for the next level, and 2 or 4 leftovers
  // pair up so no merge is ever a lopsided 3-with-1.
  function groupSize(left) {
    if (left === 1) return 1;
    if (left === 2 || left === 4) return 2;
    return 3;
  }

  function choose(arr, k, start, prefix, out) {
    if (prefix.length === k) { out.push(prefix.slice()); return; }
    for (let i = start; i < arr.length; i++) {
      prefix.push(arr[i]);
      choose(arr, k, i + 1, prefix, out);
      prefix.pop();
    }
  }

  // Merge 2–3 sorted runs (arrays of ids, best first). Yields queries; receives them ordered.
  function* mergeRuns(runs, state) {
    const ids = runs.flat();
    const local = new Map(ids.map((id, i) => [id, i]));
    const C = createClosure(ids.length);
    const R = runs.map((r) => r.map((id) => local.get(id)));
    for (const r of R) for (let i = 0; i + 1 < r.length; i++) C.add(r[i], r[i + 1]);
    const head = R.map(() => 0); // first item in each run not yet placed against all others

    // u's insertion slot in run Q is narrowed to [lo, hi]; lo === hi means it is placed.
    const placedIn = (u, Q) => {
      let lo = 0;
      while (lo < Q.length && C.less(Q[lo], u)) lo++;
      let hi = Q.length;
      while (hi > lo && C.less(u, Q[hi - 1])) hi--;
      return lo === hi;
    };
    const resolved = (k, u) => R.every((Q, q) => q === k || placedIn(u, Q));

    for (;;) {
      for (let k = 0; k < R.length; k++) {
        while (head[k] < R[k].length && resolved(k, R[k][head[k]])) head[k]++;
      }
      state.unresolved = R.reduce((s, r, k) => s + r.length - head[k], 0);
      // Candidates: a few items from the front of each run, tagged with their distance from it.
      const cands = [];
      R.forEach((r, k) => {
        for (let i = head[k]; i < Math.min(r.length, head[k] + WINDOW); i++) cands.push({ u: r[i], cost: i - head[k] });
      });
      // Pick the query that settles the most unknown relations, preferring front-most items.
      let best = null;
      let bestScore = 0;
      const combos = [];
      choose(cands, 3, 0, [], combos);
      choose(cands, 2, 0, [], combos);
      for (const sel of combos) {
        let unknown = 0;
        for (let a = 0; a < sel.length; a++) {
          for (let b = a + 1; b < sel.length; b++) if (!C.known(sel[a].u, sel[b].u)) unknown++;
        }
        if (unknown === 0) continue;
        const score = unknown * 100 - sel.reduce((s, c) => s + c.cost, 0);
        if (score > bestScore) { bestScore = score; best = sel; }
      }
      if (!best) break; // every cross-run relation is known
      const order = yield best.map((c) => ids[c.u]);
      const ranked = order.map((id) => local.get(id));
      for (let a = 0; a < ranked.length; a++) {
        for (let b = a + 1; b < ranked.length; b++) C.add(ranked[a], ranked[b]);
      }
    }
    const merged = ids.map((_, i) => i).sort((u, v) => (u === v ? 0 : C.less(u, v) ? -1 : 1));
    return merged.map((i) => ids[i]);
  }

  // Full sort. `state` is updated in place so callers can estimate remaining work.
  function* mergeSort3(ids, state) {
    const plan = planMerges(ids.length);
    state.plan = plan;
    state.groupsDone = 0;
    state.mergeIndex = 0;
    state.unresolved = 0;
    let runs = [];
    for (let i = 0; i < ids.length; i += 3) {
      const group = ids.slice(i, i + 3);
      runs.push(group.length === 1 ? group : (yield group).slice());
      state.groupsDone++;
    }
    while (runs.length > 1) {
      const next = [];
      for (let i = 0; i < runs.length; ) {
        const k = groupSize(runs.length - i);
        const group = runs.slice(i, i + k);
        if (k === 1) next.push(group[0]);
        else {
          next.push(yield* mergeRuns(group, state));
          state.mergeIndex++;
          state.unresolved = 0;
        }
        i += k;
      }
      runs = next;
    }
    return runs[0] || [];
  }

  // Approximate queries still needed, given mergeSort3's state.
  function estimateRemaining(state) {
    const { plan } = state;
    let total = plan.runSizes.slice(state.groupsDone).filter((s) => s > 1).length;
    plan.merges.forEach((m, i) => {
      if (i > state.mergeIndex) total += RATE[m.k] * m.size;
      else if (i === state.mergeIndex) total += RATE[m.k] * (state.groupsDone < plan.runSizes.length ? m.size : state.unresolved);
    });
    return Math.max(1, Math.round(total));
  }

  function sameMembers(a, b) {
    if (a.length !== b.length) return false;
    const s = new Set(a);
    return s.size === b.length && b.every((v) => s.has(v));
  }

  // items: array of strings. opts: { seed, answers } (answers from a previous serialize()).
  function createRanker(items, opts) {
    opts = opts || {};
    const seed = opts.seed != null ? opts.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
    const order = shuffle(items.map((_, i) => i), mulberry32(seed));
    let answers = [];
    let gen, state, step;

    // Undo and resume work by replaying the answer log from the start.
    function replay(log) {
      state = {};
      gen = mergeSort3(order, state);
      step = gen.next();
      answers = [];
      for (const a of log) {
        if (step.done || !sameMembers(step.value, a)) break; // stop at the first mismatch
        answers.push(a);
        step = gen.next(a);
      }
    }

    replay(opts.answers || []);

    return {
      items,
      // Ids to show, in a seeded random display order.
      nextQuery() {
        if (step.done) return null;
        return shuffle(step.value, mulberry32(seed ^ Math.imul(answers.length + 1, 0x9e3779b1)));
      },
      // ordered: the query's ids, most preferred first.
      answer(ordered) {
        if (step.done) throw new Error('Ranking is already complete');
        if (!sameMembers(step.value, ordered)) throw new Error('Answer must contain exactly the queried items');
        answers.push(ordered.slice());
        step = gen.next(ordered.slice());
      },
      undo() {
        if (answers.length === 0) return false;
        replay(answers.slice(0, -1));
        return true;
      },
      isDone: () => !!step.done,
      comparisons: () => answers.length,
      estimateRemaining: () => (step.done ? 0 : estimateRemaining(state)),
      result: () => (step.done ? step.value.map((i) => items[i]) : null),
      serialize: () => ({ items, seed, answers: answers.map((a) => a.slice()) }),
    };
  }

  const api = { createRanker, mergeSort3, mulberry32, shuffle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ranker = api;
})(typeof self !== 'undefined' ? self : this);

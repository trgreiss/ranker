// Simulator: runs ranking algorithms against hidden random orderings and counts queries.
// Usage: node sim.js [trials]
'use strict';
const { createRanker, mergeSort3, mulberry32, shuffle } = require('./ranker.js');

const TRIALS = Number(process.argv[2]) || 20;
const SIZES = [10, 50, 100, 500, 1000];

// Pivots that cut insertion slots lo..hi into three parts of at most ceil(s/3).
function pivotsFor(lo, hi) {
  const s = hi - lo + 1;
  const base = Math.floor(s / 3);
  const rem = s % 3;
  const j1 = lo + base + (rem === 2 ? 1 : 0) - 1;
  return [j1, j1 + base + (rem >= 1 ? 1 : 0)];
}

// Ternary search insert of x into chain within slots lo..hi.
function* insertInto(chain, x, lo, hi) {
  while (lo < hi) {
    if (hi - lo === 1) {
      if ((yield [x, chain[lo]])[0] === x) hi = lo;
      else lo = hi;
    } else {
      const [j1, j2] = pivotsFor(lo, hi);
      const rank = (yield [x, chain[j1], chain[j2]]).indexOf(x);
      if (rank === 0) hi = j1;
      else if (rank === 1) { lo = j1 + 1; hi = j2; }
      else lo = j2 + 1;
    }
  }
  chain.splice(lo, 0, x);
}

// Alternative: binary insertion using a new item plus two pivots per query.
function* ternaryInsertion(ids) {
  if (ids.length <= 1) return ids.slice();
  const chain = (yield ids.slice(0, 3)).slice();
  for (const x of ids.slice(3)) yield* insertInto(chain, x, 0, chain.length);
  return chain;
}

// Alternative: ternary merge-insertion (Ford–Johnson style). Rank disjoint triples, recursively
// rank the triple winners, then insert the other members below their winner.
function* mergeInsertion3(ids) {
  const n = ids.length;
  if (n <= 1) return ids.slice();
  if (n <= 3) return (yield ids.slice()).slice();
  const triples = [];
  for (let i = 0; i + 3 <= n; i += 3) triples.push((yield ids.slice(i, i + 3)).slice());
  const winners = yield* mergeInsertion3(triples.map((t) => t[0]));
  const chain = winners.slice();
  const tripleOf = new Map(triples.map((t) => [t[0], t]));
  for (let k = winners.length - 1; k >= 0; k--) {
    const [w, m, l] = tripleOf.get(winners[k]);
    yield* insertInto(chain, m, chain.indexOf(w) + 1, chain.length);
    yield* insertInto(chain, l, chain.indexOf(m) + 1, chain.length);
  }
  for (const x of ids.slice(triples.length * 3)) yield* insertInto(chain, x, 0, chain.length);
  return chain;
}

// Baseline: pairwise binary insertion (near-optimal for 2-item comparisons).
function* pairwiseInsertion(ids) {
  const chain = [];
  for (const x of ids) {
    let lo = 0;
    let hi = chain.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((yield [x, chain[mid]])[0] === x) hi = mid;
      else lo = mid + 1;
    }
    chain.splice(lo, 0, x);
  }
  return chain;
}

function runGenerator(gen, rank) {
  let count = 0;
  let step = gen.next();
  while (!step.done) {
    count++;
    step = gen.next(step.value.slice().sort((a, b) => rank[a] - rank[b]));
  }
  return { count, result: step.value };
}

// Information-theoretic floor: log2(n!) bits at log2(6) bits per triple.
function lowerBound(n) {
  let bits = 0;
  for (let k = 2; k <= n; k++) bits += Math.log2(k);
  return Math.ceil(bits / Math.log2(6));
}

const algorithms = {
  mergeSort3: (ids) => mergeSort3(ids, {}),
  mergeInsertion3,
  ternaryInsertion,
  pairwise: pairwiseInsertion,
};

let failures = 0;
const rand = mulberry32(12345);
console.log(`trials per size: ${TRIALS}  (mean / max queries)\n`);
for (const n of SIZES) {
  const stats = {};
  for (const name of Object.keys(algorithms)) stats[name] = { sum: 0, max: 0 };
  const trials = n >= 1000 ? Math.ceil(TRIALS / 4) : TRIALS;
  for (let t = 0; t < trials; t++) {
    const ids = shuffle([...Array(n).keys()], rand);
    const rank = new Array(n); // rank[id] = true position, 0 = most preferred
    shuffle([...Array(n).keys()], rand).forEach((id, pos) => (rank[id] = pos));
    for (const [name, make] of Object.entries(algorithms)) {
      const { count, result } = runGenerator(make(ids), rank);
      if (result.length !== n || !result.every((id, i) => rank[id] === i)) {
        failures++;
        console.error(`FAIL ${name} n=${n}`);
      }
      stats[name].sum += count;
      stats[name].max = Math.max(stats[name].max, count);
    }
  }
  const row = Object.entries(stats)
    .map(([name, s]) => `${name} ${(s.sum / trials).toFixed(0)}/${s.max}`)
    .join(' | ');
  console.log(`n=${n}  floor ${lowerBound(n)} | ${row}`);
}

// Engine checks: correct result, undo and serialize/resume consistent, estimate roughly right.
let worstEstimateError = 0;
for (let t = 0; t < 30; t++) {
  const n = 1 + Math.floor(rand() * 300);
  const items = [...Array(n).keys()].map((i) => `item ${i}`);
  const rank = shuffle([...Array(n).keys()], rand);
  const answerFor = (q) => q.slice().sort((a, b) => rank[a] - rank[b]);
  let r = createRanker(items, { seed: t });
  const initialEstimate = r.estimateRemaining();
  while (!r.isDone()) {
    const before = { q: r.nextQuery().join(), est: r.estimateRemaining(), count: r.comparisons() };
    r.answer(answerFor(r.nextQuery()));
    if (rand() < 0.1) {
      r.undo();
      if (r.nextQuery().join() !== before.q || r.estimateRemaining() !== before.est || r.comparisons() !== before.count) {
        failures++;
        console.error('FAIL undo did not restore state');
        break;
      }
      r.answer(answerFor(r.nextQuery()));
    }
    if (rand() < 0.05) r = createRanker(items, r.serialize());
  }
  if (n >= 50) worstEstimateError = Math.max(worstEstimateError, Math.abs(initialEstimate / r.comparisons() - 1));
  if (!r.result().every((s, i) => rank[Number(s.split(' ')[1])] === i)) {
    failures++;
    console.error(`FAIL engine result n=${n}`);
  }
}
console.log(`\nworst initial-estimate error (n >= 50): ${(worstEstimateError * 100).toFixed(1)}%`);
if (worstEstimateError > 0.15) { failures++; console.error('FAIL estimate off by more than 15%'); }

// Inconsistent answers (random clicks) must still terminate with every item ranked once.
for (let t = 0; t < 10; t++) {
  const items = [...Array(60).keys()].map((i) => `item ${i}`);
  const r = createRanker(items, { seed: 100 + t });
  let guard = 0;
  while (!r.isDone() && guard++ < 10000) r.answer(shuffle(r.nextQuery(), rand));
  if (!r.isDone() || new Set(r.result()).size !== items.length) {
    failures++;
    console.error('FAIL random answers did not produce a complete ranking');
  }
}

console.log(failures ? `\n${failures} failures` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;

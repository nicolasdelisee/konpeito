/**
 * Measures the handwriting recogniser outside the browser.
 *
 * Glyphs are rendered with the same font the browser will use (via
 * tools/render-kana.py), turned into templates, then matched against
 * *simulated* handwriting: the reference skeleton, randomly distorted and
 * partially erased. That is a proxy for a real hand, not a substitute — treat
 * the figures as an upper bound.
 *
 *     node test-recognizer.js            # hiragana + katakana, 5 essais/kana
 *     node test-recognizer.js 3          # 3 essais/kana (plus rapide)
 */
const { execFileSync } = require('child_process');
const path = require('path');

const R = require('./recognizer.js');

const BOX = 64;
const TRIES = Number(process.argv[2]) || 5;

// ------------------------------------------------------------------ fixtures

function loadKanaRows() {
  const fs = require('fs');
  const src = `${fs.readFileSync(path.join(__dirname, 'kana.js'), 'utf8')}\n;({ALL_CARDS})`;
  return (0, eval)(src).ALL_CARDS;
}

const cards = loadKanaRows().filter((card) => card.char.length === 1);

let bitmaps;
try {
  bitmaps = JSON.parse(
    execFileSync('python3', [path.join(__dirname, 'tools', 'render-kana.py'), String(BOX)], {
      input: cards.map((c) => c.char).join('\n'),
      maxBuffer: 1 << 28,
    }).toString(),
  );
} catch (error) {
  console.log('⚠️  Rendu impossible (python3 + Pillow + une police japonaise requis).');
  console.log('   Ce test est un outil de dev : l’app génère ses gabarits dans le navigateur.');
  console.log(`   Détail : ${String(error.message).split('\n')[0]}`);
  process.exit(0);
}

// ------------------------------------------------------------------ helpers

/** Deterministic RNG so a regression is reproducible. */
function mulberry32(seed) {
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Distorts a skeleton the way a shaky hand and a mouse would.
 *
 * The per-axis scaling is deliberately wide: a hand routinely draws a kana much
 * wider or narrower than the font does, and an earlier version of this test
 * only varied it by ±10%. That kept every simulated shape at the font's own
 * proportions and hid a real bug — see images/bug1.png, a perfectly legible デ
 * ranked 19th because its proportions differed from the printed glyph.
 */
function fakeHandwriting(points, rng) {
  const angle = (rng() - 0.5) * 0.2; // ±6°
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const scaleX = 0.75 + rng() * 0.55;
  const scaleY = 0.75 + rng() * 0.55;
  const shear = (rng() - 0.5) * 0.18;
  const jitter = 1.6;
  return points
    .filter(() => rng() > 0.25) // a hand does not trace every pixel
    .map(([x, y]) => {
      const nx = (x - BOX / 2) * scaleX + (y - BOX / 2) * shear;
      const ny = (y - BOX / 2) * scaleY;
      return [
        nx * cos - ny * sin + (rng() - 0.5) * jitter,
        nx * sin + ny * cos + (rng() - 0.5) * jitter,
      ];
    });
}

const fails = [];
const check = (label, cond, extra = '') => {
  if (!cond) fails.push(`${label} ${extra}`);
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label} ${extra}`);
};

// ------------------------------------------------------- build the templates

console.log(`Gabarits : ${cards.length} kana rendus en ${BOX}×${BOX}\n`);

const templates = cards.map((card) => {
  const grid = Uint8Array.from(bitmaps[card.char]);
  const ink = grid.reduce((sum, v) => sum + v, 0);
  const skeleton = R.thin(grid, BOX, BOX);
  const bones = skeleton.reduce((sum, v) => sum + v, 0);
  return {
    key: card.char,
    script: card.script,
    romaji: card.romaji,
    ink,
    bones,
    rawPoints: R.inkPoints(skeleton, BOX, BOX),
    ...R.shapeFromBitmap(grid, BOX, BOX),
  };
});

const empty = templates.filter((t) => t.points.length < 12);
check('tous les kana produisent un squelette exploitable', empty.length === 0, empty.map((t) => t.key).join(' '));
const notThinned = templates.filter((t) => t.bones >= t.ink * 0.6);
check('l’amincissement réduit bien la matière', notThinned.length === 0, notThinned.map((t) => t.key).join(' '));
const ratio = templates.reduce((s, t) => s + t.bones / t.ink, 0) / templates.length;
console.log(`       squelette moyen : ${Math.round(ratio * 100)}% des pixels d’origine\n`);

// -------------------------------------------------- simulated handwriting

function evaluate(pool, label) {
  const rng = mulberry32(42);
  let top1 = 0;
  let top3 = 0;
  let total = 0;
  const misses = new Map();

  for (const template of pool) {
    for (let i = 0; i < TRIES; i += 1) {
      const shape = R.shapeFromPoints(fakeHandwriting(template.rawPoints, rng));
      const ranked = R.rank(shape, pool);
      const position = ranked.findIndex((r) => r.key === template.key);
      total += 1;
      if (position === 0) top1 += 1;
      if (position >= 0 && position < 3) top3 += 1;
      else {
        const confusedWith = ranked[0].key;
        const pair = `${template.key}→${confusedWith}`;
        misses.set(pair, (misses.get(pair) || 0) + 1);
      }
    }
  }

  const pct = (n) => Math.round((n / total) * 100);
  console.log(`${label} (${pool.length} kana, ${total} tracés simulés)`);
  console.log(`       top-1 : ${pct(top1)}%   top-3 : ${pct(top3)}%`);
  const worst = [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (worst.length) console.log(`       ratés : ${worst.map(([p, n]) => `${p} ×${n}`).join('  ')}`);
  console.log('');
  return { top1: pct(top1), top3: pct(top3) };
}

const hiragana = templates.filter((t) => t.script === 'hiragana');
const katakana = templates.filter((t) => t.script === 'katakana');

const hira = evaluate(hiragana, 'Hiragana seuls');
const kata = evaluate(katakana, 'Katakana seuls');

check('hiragana : top-3 exploitable', hira.top3 >= 80, `(${hira.top3}%)`);
check('katakana : top-3 exploitable', kata.top3 >= 80, `(${kata.top3}%)`);
check('hiragana : top-1 correct', hira.top1 >= 55, `(${hira.top1}%)`);
check('katakana : top-1 correct', kata.top1 >= 55, `(${kata.top1}%)`);

// --------------------------------------------------------- confusion pairs

function closestPairs(pool, count) {
  const pairs = [];
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      pairs.push([pool[i], pool[j], R.distance(pool[i], pool[j])]);
    }
  }
  return pairs.sort((a, b) => a[2] - b[2]).slice(0, count);
}

console.log('Paires de gabarits les plus proches (les confusions attendues) :');
for (const [a, b, d] of closestPairs(hiragana, 6)) {
  console.log(`       ${a.key} / ${b.key}  (${a.romaji}/${b.romaji})  d=${d.toFixed(3)}`);
}
for (const [a, b, d] of closestPairs(katakana, 6)) {
  console.log(`       ${a.key} / ${b.key}  (${a.romaji}/${b.romaji})  d=${d.toFixed(3)}`);
}
console.log('');

// dakuten must not collapse onto their base kana
for (const [base, marked] of [['か', 'が'], ['は', 'ば'], ['ハ', 'バ'], ['し', 'じ']]) {
  const a = templates.find((t) => t.key === base);
  const b = templates.find((t) => t.key === marked);
  const rankedFromMarked = R.rank(b, templates.filter((t) => t.script === a.script));
  check(
    `${marked} ne se confond pas avec ${base}`,
    rankedFromMarked[0].key === marked,
    `(1er: ${rankedFromMarked[0].key}, 2e: ${rankedFromMarked[1].key})`,
  );
}

// ------------------------------------------------ un vrai tracé, à la main

/**
 * images/bug1.png : un デ tracé à la souris, parfaitement lisible, que le
 * moteur classait 19e — il finissait donc refusé. Les tracés simulés ne
 * pouvaient pas révéler ce cas : ils gardent les proportions de la police et
 * son épaisseur de trait. Ce gabarit-là vient d'une vraie main.
 */
const sample = JSON.parse(
  require('fs').readFileSync(path.join(__dirname, 'fixtures', 'bug1-de.json'), 'utf8'),
);
const sampleGrid = new Uint8Array(sample.w * sample.h);
for (const [x, y] of sample.ink) sampleGrid[y * sample.w + x] = 1;
const samplePool = templates.filter((t) => t.script === sample.script);
const sampleRanked = R.rank(R.shapeFromBitmap(sampleGrid, sample.w, sample.h), samplePool);
const samplePos = sampleRanked.findIndex((r) => r.key === sample.expected) + 1;
check(
  `tracé réel de ${sample.expected} accepté (top 3 sur ${samplePool.length} kana)`,
  samplePos > 0 && samplePos <= 3,
  `(${samplePos}e — proposé : ${sampleRanked.slice(0, 3).map((r) => r.key).join(' ')})`,
);

// --------------------------------------------------------- stroke input path

const squareStrokes = [
  [
    { x: 10, y: 10 },
    { x: 50, y: 10 },
  ],
  [
    { x: 10, y: 30 },
    { x: 50, y: 30 },
  ],
];
const fromStrokes = R.shapeFromStrokes(squareStrokes);
check('un tracé multi-traits produit une forme', fromStrokes && fromStrokes.points.length > 10);
// les deux traits doivent être représentés, pas seulement le premier
const bands = new Set(fromStrokes.points.map((p) => (p[1] < 0 ? 'haut' : 'bas')));
check('les deux traits sont représentés', bands.size === 2, `(${[...bands].join('+')})`);
// La garantie de l'échantillonnage : aucun morceau du tracé n'est laissé de
// côté — tout point du tracé dense est à moins d'un pas d'un point gardé.
const dense = R.normalize(R.densifyStrokes(squareStrokes, Math.hypot(40, 20) / 100));
const uncovered = dense.map((p) => {
  let best = Infinity;
  for (const q of fromStrokes.points) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
  return best;
});
check(
  'aucune partie du tracé n’est laissée de côté',
  Math.max(...uncovered) <= R.POINT_SPACING,
  `(pire écart ${Math.max(...uncovered).toFixed(3)} pour un pas de ${R.POINT_SPACING})`,
);
check('un tracé vide ne casse rien', R.shapeFromStrokes([]) === null);
check('un point isolé ne casse rien', R.shapeFromStrokes([[{ x: 5, y: 5 }]]) !== null);

// invariance: the same drawing, moved and resized, must score identically
const moved = squareStrokes.map((s) => s.map((p) => ({ x: p.x * 2 + 120, y: p.y * 2 - 40 })));
const gapAfterMove = Math.abs(
  R.distance(fromStrokes, R.shapeFromStrokes(moved)) - 0,
);
check('invariance à la position et à l’échelle', gapAfterMove < 1e-9, `(écart ${gapAfterMove.toExponential(1)})`);

// ------------------------------------------- le mode écriture dans l'app

console.log('\nMode écriture, bout en bout (faux DOM + canvas simulé) :');

const { createDom } = require('./test-dom.js');
const PAD = 280;
const { id, El } = createDom({ glyphBitmaps: bitmaps, box: BOX, padSize: PAD });
const load = (file) => require('fs').readFileSync(path.join(__dirname, file), 'utf8');
(0, eval)(`${load('kana.js')}\n${load('recognizer.js')}\n${load('app.js')}`);

const fakeTarget = (cls, data) => Object.assign(new El(), { _class: cls, dataset: data });
const byChar = (char) => templates.find((t) => t.key === char);

/** Replays a skeleton onto the pad as real pointer events. */
function drawOnPad(points) {
  const canvas = id('pad');
  const scale = PAD / BOX;
  for (const [x, y] of points) {
    canvas.fire('pointerdown', { clientX: x * scale, clientY: y * scale, pointerId: 1 });
    canvas.fire('pointerup', { pointerId: 1 });
  }
}

id('mode-picker').fire('click', { target: fakeTarget('mode', { mode: 'writing' }) });
check('note explicative affichée en mode écriture', id('mode-note').hidden === false);
id('start-btn').fire('click');
check('le pad est affiché', id('writing-panel').hidden === false);
check('le modèle est caché avant de valider', id('pad-model').hidden === true);
check('la consigne montre le romaji', /^[a-z]+$/.test(id('prompt').textContent), id('prompt').textContent);

// 1) on trace exactement le kana demandé
let expected = cards.find(
  (c) => c.script === 'hiragana' && c.romaji === id('prompt').textContent,
);
drawOnPad(byChar(expected.char).rawPoints);
id('pad-check').fire('click');
check(
  `tracé fidèle de ${expected.char} reconnu`,
  /Reconnu du premier coup/.test(id('feedback').textContent),
  `→ « ${id('feedback').textContent} »`,
);
check('le modèle est révélé après validation', id('pad-model').hidden === false);
check('le modèle montre le bon kana', id('pad-model-kana').textContent === expected.char);
check('rien n’avance tant qu’on n’a pas continué', id('screen-quiz').hidden === false);

// 2) on trace un kana franchement différent
document.fireKey('Enter');
expected = cards.find((c) => c.script === 'hiragana' && c.romaji === id('prompt').textContent);
const farthest = hiragana
  .filter((t) => t.key !== expected.char)
  .sort((a, b) => R.distance(b, byChar(expected.char)) - R.distance(a, byChar(expected.char)))[0];
drawOnPad(farthest.rawPoints);
id('pad-check').fire('click');
check(
  `tracé de ${farthest.key} refusé quand on demande ${expected.char}`,
  /On dirait plutôt/.test(id('feedback').textContent),
  `→ « ${id('feedback').textContent} »`,
);

// 3) valider une zone vide ne compte pas de réponse
document.fireKey('Enter');
const before = id('score-ko').textContent;
id('pad-check').fire('click');
check('valider sans rien tracer ne compte pas d’erreur', id('score-ko').textContent === before);
check('… et le dit', /Trace le kana/.test(id('kbd-hint').textContent), id('kbd-hint').textContent);

// ------------------------------------------------- le mode grille à compléter

id('quit-btn').fire('click');
id('presets').fire('click', { target: fakeTarget('preset', { preset: 'starter' }) });
id('mode-picker').fire('click', { target: fakeTarget('mode', { mode: 'chart' }) });
check('la note annonce les cases vidées', /cases vidées/.test(id('mode-note').textContent));

id('start-btn').fire('click');
check('la grille est affichée', id('chart-panel').hidden === false);
check('la carte de consigne laisse la place à la grille', id('prompt-card').hidden === true);

const isBlank = (c) => c.className.includes('is-blank');
const isVoid = (c) => c.className.includes('is-void');
const allCells = id('chart').querySelectorAll('.cell');
const blanks = allCells.filter(isBlank);
check('50 emplacements (10 colonnes × 5 voyelles)', allCells.length === 50, `(${allCells.length})`);
check('4 emplacements sans kana', allCells.filter(isVoid).length === 4, `(${allCells.filter(isVoid).length})`);
check('20 cases vidées, comme la longueur de session', blanks.length === 20, `(${blanks.length})`);
check(
  'les 26 autres montrent leur kana',
  allCells.filter((c) => !isBlank(c) && !isVoid(c)).every((c) => /^[ぁ-ゖ]$/.test(c.textContent)),
);
check('une case est sélectionnée d’office', id('chart').querySelectorAll('.is-active').length === 1);
check('la consigne nomme la case', /^Trace « .+ »$/.test(id('chart-hint').textContent), id('chart-hint').textContent);

// un tracé faux révèle quand même le kana attendu : c'est là qu'on apprend
const firstCell = id('chart').querySelectorAll('.is-active')[0];
const firstChar = firstCell.dataset.card.split(':')[1];
const wrongFor = hiragana
  .filter((t) => t.key !== firstChar)
  .sort((a, b) => R.distance(b, byChar(firstChar)) - R.distance(a, byChar(firstChar)))[0];
drawOnPad(wrongFor.rawPoints);
id('pad-check').fire('click');
check('un tracé faux marque la case en erreur', firstCell.className.includes('is-ko'), firstCell.className);
check('… et révèle le kana attendu', firstCell.textContent === firstChar, `(${firstCell.textContent})`);

// on remplit le reste correctement
let done = 1;
document.fireKey('Enter');
while (!id('screen-quiz').hidden && done < 25) {
  const active = id('chart').querySelectorAll('.is-active')[0];
  if (!active) {
    fails.push('aucune case sélectionnée en cours de grille');
    break;
  }
  const char = active.dataset.card.split(':')[1];
  drawOnPad(byChar(char).rawPoints);
  id('pad-check').fire('click');
  if (!active.className.includes('is-ok')) fails.push(`case ${char} non validée`);
  if (active.textContent !== char) fails.push(`case ${char} vide après validation`);
  document.fireKey('Enter');
  done += 1;
}
check('la grille se termine une fois toutes les cases remplies', done === 20, `(${done})`);
check('écran de fin atteint', id('screen-end').hidden === false);
check('19 bonnes sur 20', id('result-pct').textContent === 95, `(${id('result-pct').textContent}%)`);

// 4) les yōon ne sont pas traçables : le mode doit le signaler
id('back-btn').fire('click');
id('mode-picker').fire('click', { target: fakeTarget('mode', { mode: 'writing' }) });
id('quit-btn').fire('click');
id('family-picker')
  .querySelectorAll('.row-chip')
  .forEach((chip) => {
    const wanted = chip.dataset.row === 'kya';
    if ((chip.getAttribute('aria-pressed') === 'true') !== wanted) chip.fire('click');
  });
check('paquet yōon seul : départ bloqué', id('start-btn').disabled === true);
check('… avec une explication', /yōon/.test(id('mode-note').textContent), id('mode-note').textContent);

console.log(fails.length ? `\n❌ ${fails.length} échec(s):\n- ${fails.join('\n- ')}` : '\n✅ tout passe');
process.exit(fails.length ? 1 : 0);

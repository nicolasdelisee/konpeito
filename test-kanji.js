/**
 * Kanji tab: checks the hand-written data in kanji.js, then renders the list
 * and a few cards against the fake DOM.
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const fails = [];
const check = (label, cond, extra = '') => {
  if (!cond) fails.push(`${label} ${extra}`);
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label} ${extra}`);
};

const { createDom } = require('./test-dom.js');

const { id, document, memory } = createDom();

// A location whose hash changes fire `hashchange`, like a browser's.
const hashListeners = [];
let currentHash = '';
global.window.location = {
  get hash() {
    return currentHash;
  },
  set hash(value) {
    currentHash = value.startsWith('#') ? value : `#${value}`;
    hashListeners.forEach((fn) => fn());
  },
};
global.window.addEventListener = (type, fn) => {
  if (type === 'hashchange') hashListeners.push(fn);
};

const load = (file) => fs.readFileSync(path.join(DIR, file), 'utf8');
(0, eval)(
  `${load('kanji.js')}\n${load('kanji-app.js')}\n` +
    ';Object.assign(globalThis.__scope||(globalThis.__scope={}),' +
    '{KANJI,KANJI_GROUPS,ALL_WORDS,parseRuby,kanjiIn,suggestNext,wordsElsewhere,kanjiStore})',
);
const { KANJI, KANJI_GROUPS, ALL_WORDS, parseRuby, kanjiIn, suggestNext, wordsElsewhere } =
  globalThis.__scope;

// ---------------------------------------------------------------------- data
console.log('Données :');
const KATAKANA = /^[゠-ヿ]+$/;
const HIRAGANA = /^[ぁ-ゟ]+(\.[ぁ-ゟ]+)?$/;
const KANA_ONLY = /^[ぁ-ゟ゠-ヿ]+$/;
const groupIds = new Set(KANJI_GROUPS.map((group) => group.id));
const problems = [];

KANJI.forEach((card) => {
  const where = `${card.k} :`;
  if (!groupIds.has(card.g)) problems.push(`${where} groupe inconnu ${card.g}`);
  if (!Number.isInteger(card.strokes) || card.strokes < 1) problems.push(`${where} nombre de traits`);
  if (!card.fr) problems.push(`${where} pas de sens`);
  card.on.forEach((r) => KATAKANA.test(r) || problems.push(`${where} ON pas en katakana : ${r}`));
  card.kun.forEach((r) => HIRAGANA.test(r) || problems.push(`${where} KUN mal formé : ${r}`));
  if (card.words.length < 2) problems.push(`${where} moins de deux mots`);
  card.words.forEach((word) => {
    if (!word.w.includes(card.k)) problems.push(`${where} le mot ${word.w} ne contient pas le kanji`);
    if (!['on', 'kun', 'sp'].includes(word.y)) problems.push(`${where} ${word.w} : lecture ${word.y}`);
    if (!word.r || !word.fr) problems.push(`${where} ${word.w} incomplet`);
  });
  if (card.phrases.length < 2) problems.push(`${where} moins de deux phrases`);
  card.phrases.forEach(({ jp, fr }) => {
    if (!fr) problems.push(`${where} phrase sans traduction`);
    const segments = parseRuby(jp);
    const bare = segments.filter((s) => s.text).map((s) => s.text).join('');
    if (kanjiIn(bare).length) problems.push(`${where} kanji sans lecture dans « ${jp} »`);
    if (/[[\]]/.test(bare)) problems.push(`${where} crochet orphelin dans « ${jp} »`);
    segments
      .filter((s) => s.base)
      .forEach((s) => KANA_ONLY.test(s.reading) || problems.push(`${where} lecture « ${s.reading} »`));
    if (!segments.some((s) => s.base && s.base.includes(card.k))) {
      problems.push(`${where} la phrase n’utilise pas le kanji : « ${jp} »`);
    }
  });
  (card.see || []).forEach((k) => k !== card.k || problems.push(`${where} se cite lui-même`));
});
problems.forEach((p) => console.log(`       ${p}`));
check('fiches bien formées', problems.length === 0, `(${problems.length} problème(s))`);
check('pas de doublon', new Set(KANJI.map((c) => c.k)).size === KANJI.length, `(${KANJI.length} kanji)`);
check('chaque groupe a des kanji', KANJI_GROUPS.every((g) => KANJI.some((c) => c.g === g.id)));

// ------------------------------------------------------------------ analysis
console.log('Liens entre fiches :');
check(
  'parseRuby découpe les lectures',
  JSON.stringify(parseRuby('毎日[まいにち]、パン')) ===
    JSON.stringify([{ base: '毎日', reading: 'まいにち' }, { text: '、パン' }]),
);
check('々 n’est pas un kanji à apprendre', kanjiIn('時々').join('') === '時');

const elsewhere = wordsElsewhere('日').map((w) => w.w);
check('日 se retrouve dans les mots d’autres fiches', elsewhere.includes('日本人') && elsewhere.includes('日本語'), `(${elsewhere.join(' ')})`);
check('… sans répéter ceux de sa propre fiche', !elsewhere.includes('毎日'));

const fromNothing = suggestNext(new Set());
check('sans rien savoir, on propose un kanji', !!fromNothing, fromNothing && fromNothing.card.k);
const afterWater = suggestNext(new Set(['水', '日', '大']));
check(
  'la suggestion débloque des mots lisibles',
  afterWater.words.every((w) => kanjiIn(w.w).every((k) => ['水', '日', '大', afterWater.card.k].includes(k))),
  `(${afterWater.card.k} → ${afterWater.words.map((w) => w.w).join(' ')})`,
);
check('ALL_WORDS sans doublon', new Set(ALL_WORDS.map((w) => w.w)).size === ALL_WORDS.length);

// ----------------------------------------------------------------- rendering
console.log('Affichage :');
const view = id('kanji-view');
check('onglet kana affiché au départ', view.hidden === true && id('kana-view').hidden === false);

window.location.hash = '#kanji';
check('onglet kanji ouvert', view.hidden === false && id('kana-view').hidden === true);
check('onglet kanji marqué actif', id('tab-kanji').getAttribute('aria-current') === 'page');
const tiles = (view.innerHTML.match(/class="kj-open kj-tile/g) || []).length;
check('une tuile par kanji', tiles === KANJI.length, `(${tiles})`);
check('une suggestion est proposée', view.innerHTML.includes('À apprendre ensuite'));

window.location.hash = '#kanji/水';
const html = view.innerHTML;
check('la fiche de 水 s’ouvre', html.includes('kj-glyph') && html.includes('>水</p>'));
check('lectures ON et KUN', html.includes('スイ') && html.includes('みず'));
check('les mots sont listés', html.includes('水着') && html.includes('maillot de bain'));
check('les phrases ont des furigana', html.includes('<rt>すいちゅう</rt>'));
check('le kanji de la fiche ressort dans les phrases', html.includes('<span class="kj-target">水</span>'));
check('中 est un lien vers sa fiche', html.includes('data-k="中"'));
check('mode auto : rien n’est appris, toutes les lectures visibles', !html.includes('kj-ruby is-hidden'));

// Mark 水 as learned from the card itself.
const learnBtn = Object.assign(new (require('./test-dom.js').El)(), { _class: 'kj-learn' });
view.fire('click', { target: learnBtn });
check('水 marqué comme appris', globalThis.__scope.kanjiStore.learned.includes('水'));
check('… et enregistré', JSON.parse(memory.get('konpeito.kanji.v1')).learned.includes('水'));
check('furigana masqués sur les kanji appris', view.innerHTML.includes('kj-ruby is-hidden'));
check('le bouton dit « Appris »', view.innerHTML.includes('✓ Appris'));
check('水 est lisible', view.innerHTML.includes('✓ tu peux le lire'));

window.location.hash = '#kanji/inconnu';
check('kanji inconnu → retour à la liste', view.innerHTML.includes('kj-tiles'));

document.fireKey('ArrowRight'); // no card open: nothing happens
check('flèches sans effet sur la liste', window.location.hash === '#kanji/inconnu');
window.location.hash = '#kanji/水';
document.fireKey('ArrowRight');
check('flèche droite → kanji suivant', window.location.hash === '#kanji/木', window.location.hash);

window.location.hash = '#kana';
check('retour à l’onglet kana', view.hidden === true && id('kana-view').hidden === false);

console.log(fails.length ? `\n❌ ${fails.length} échec(s)` : '\n✅ tout passe');
process.exitCode = fails.length ? 1 : 0;

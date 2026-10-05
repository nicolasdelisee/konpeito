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

const { El, id, document, memory } = createDom();

// A location that behaves like a browser's: the hash reads back percent-encoded
// (#kanji/水 → #kanji/%E6%B0%B4), and only a real change fires `hashchange`.
const hashListeners = [];
let currentHash = '';
global.window.location = {
  get hash() {
    return currentHash;
  },
  set hash(value) {
    const next = encodeURI(value.startsWith('#') ? value : `#${value}`).replace(/%25/g, '%');
    if (next === currentHash) return;
    currentHash = next;
    hashListeners.forEach((fn) => fn());
  },
};
global.window.addEventListener = (type, fn) => {
  if (type === 'hashchange') hashListeners.push(fn);
};

const load = (file) => fs.readFileSync(path.join(DIR, file), 'utf8');
(0, eval)(
  // The kana quiz shares the page and the keyboard: load it too.
  `${load('kana.js')}\n${load('recognizer.js')}\n${load('app.js')}\n` +
    `${load('kanji.js')}\n${load('romaji.js')}\n${load('kanji-app.js')}\n` +
    ';Object.assign(globalThis.__scope||(globalThis.__scope={}),' +
    '{KANJI,KANJI_GROUPS,ALL_WORDS,parseRuby,kanjiIn,suggestNext,wordsElsewhere,kanjiStore,' +
    'buildExam,toKana,sameReading,currentExam:()=>exam})',
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
  if (![5, 4, 3, 2, 1].includes(card.n)) problems.push(`${where} niveau JLPT ${card.n}`);
  if (!Number.isInteger(card.strokes) || card.strokes < 1)
    problems.push(`${where} nombre de traits`);
  if (!card.fr) problems.push(`${where} pas de sens`);
  card.on.forEach((r) => KATAKANA.test(r) || problems.push(`${where} ON pas en katakana : ${r}`));
  card.kun.forEach((r) => HIRAGANA.test(r) || problems.push(`${where} KUN mal formé : ${r}`));
  if (card.words.length < 2) problems.push(`${where} moins de deux mots`);
  card.words.forEach((word) => {
    if (!word.w.includes(card.k))
      problems.push(`${where} le mot ${word.w} ne contient pas le kanji`);
    if (!['on', 'kun', 'sp'].includes(word.y))
      problems.push(`${where} ${word.w} : lecture ${word.y}`);
    if (!word.r || !word.fr) problems.push(`${where} ${word.w} incomplet`);
  });
  if (card.phrases.length < 2) problems.push(`${where} moins de deux phrases`);
  card.phrases.forEach(({ jp, fr }) => {
    if (!fr) problems.push(`${where} phrase sans traduction`);
    const segments = parseRuby(jp);
    const bare = segments
      .filter((s) => s.text)
      .map((s) => s.text)
      .join('');
    if (kanjiIn(bare).length) problems.push(`${where} kanji sans lecture dans « ${jp} »`);
    if (/[[\]]/.test(bare)) problems.push(`${where} crochet orphelin dans « ${jp} »`);
    segments
      .filter((s) => s.base)
      .forEach(
        (s) => KANA_ONLY.test(s.reading) || problems.push(`${where} lecture « ${s.reading} »`),
      );
    if (!segments.some((s) => s.base && s.base.includes(card.k))) {
      problems.push(`${where} la phrase n’utilise pas le kanji : « ${jp} »`);
    }
  });
  (card.see || []).forEach((k) => k !== card.k || problems.push(`${where} se cite lui-même`));
});
problems.forEach((p) => console.log(`       ${p}`));
check('fiches bien formées', problems.length === 0, `(${problems.length} problème(s))`);
check(
  'pas de doublon',
  new Set(KANJI.map((c) => c.k)).size === KANJI.length,
  `(${KANJI.length} kanji)`,
);
{
  const seen = new Map();
  const clashes = [];
  KANJI.forEach((card) =>
    card.words.forEach((word) => {
      const other = seen.get(word.w);
      if (other && (other.r !== word.r || other.fr !== word.fr)) clashes.push(word.w);
      seen.set(word.w, word);
    }),
  );
  check(
    'un même mot a la même lecture et le même sens partout',
    !clashes.length,
    clashes.join(' '),
  );
  const phrases = KANJI.flatMap((card) => card.phrases.map((p) => p.jp));
  check('pas de phrase en double', new Set(phrases).size === phrases.length);
}
check(
  'chaque groupe a des kanji',
  KANJI_GROUPS.every((g) => KANJI.some((c) => c.g === g.id)),
);

// ------------------------------------------------------------------ analysis
console.log('Liens entre fiches :');
check(
  'parseRuby découpe les lectures',
  JSON.stringify(parseRuby('毎日[まいにち]、パン')) ===
    JSON.stringify([{ base: '毎日', reading: 'まいにち' }, { text: '、パン' }]),
);
check('々 n’est pas un kanji à apprendre', kanjiIn('時々').join('') === '時');

const elsewhere = wordsElsewhere('日').map((w) => w.w);
check(
  '日 se retrouve dans les mots d’autres fiches',
  elsewhere.includes('日本人') && elsewhere.includes('日本語'),
  `(${elsewhere.join(' ')})`,
);
check('… sans répéter ceux de sa propre fiche', !elsewhere.includes('毎日'));

const fromNothing = suggestNext(new Set());
check('sans rien savoir, on propose un kanji', !!fromNothing, fromNothing && fromNothing.card.k);
const afterWater = suggestNext(new Set(['水', '日', '大']));
check(
  'la suggestion débloque des mots lisibles',
  afterWater.words.length > 0 &&
    afterWater.words.every((w) =>
      kanjiIn(w.w).every((k) => ['水', '日', '大', afterWater.card.k].includes(k)),
    ),
  `(${afterWater.card.k} → ${afterWater.words.map((w) => w.w).join(' ')})`,
);
check('ALL_WORDS sans doublon', new Set(ALL_WORDS.map((w) => w.w)).size === ALL_WORDS.length);

// ----------------------------------------------------------------- rendering
console.log('Affichage :');
const view = id('kanji-view');
check('les kanji sont la page d’accueil', view.hidden === false && id('kana-view').hidden === true);
window.location.hash = '#kana';
check('#kana ouvre les kana', view.hidden === true && id('kana-view').hidden === false);

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
check(
  'le kanji de la fiche ressort dans les phrases',
  html.includes('<span class="kj-target">水</span>'),
);
check('中 est un lien vers sa fiche', html.includes('data-k="中"'));
check(
  'mode auto : rien n’est appris, toutes les lectures visibles',
  !html.includes('kj-ruby is-hidden'),
);

// Mark 水 as learned from the card itself.
const learnBtn = Object.assign(new (require('./test-dom.js').El)(), { _class: 'kj-learn' });
view.fire('click', { target: learnBtn });
check('水 marqué comme appris', globalThis.__scope.kanjiStore.learned.includes('水'));
check('… et enregistré', JSON.parse(memory.get('konpeito.kanji.v1')).learned.includes('水'));
check('furigana masqués sur les kanji appris', view.innerHTML.includes('kj-ruby is-hidden'));
check('le bouton dit « Appris »', view.innerHTML.includes('✓ Appris'));
check('水 est lisible', view.innerHTML.includes('✓ tu peux le lire'));

const levelBtn = (level) => Object.assign(new El(), { _class: 'kj-level', dataset: { level } });
// A stand-in N4 card, so that filtering on N5 has something to leave out.
KANJI.push({ ...KANJI[0], k: '試', n: 4, fr: 'essai' });
window.location.hash = '#kanji';
view.fire('click', { target: levelBtn('5') });
check(
  'filtre N5 : toutes les tuiles N5',
  (view.innerHTML.match(/class="kj-open kj-tile/g) || []).length ===
    KANJI.filter((c) => c.n === 5).length,
);
check('… le niveau est annoncé', view.innerHTML.includes('du niveau N5'));
check('les niveaux sans fiche sont « à venir »', view.innerHTML.includes('à venir'));
view.fire('click', { target: levelBtn('all') });
check('filtre « Tous »', globalThis.__scope.kanjiStore.level === 'all');
check('… qui montre aussi le N4', view.innerHTML.includes('data-k="試"'));
KANJI.pop();

window.location.hash = '#kanji/%E0';
check('une adresse mal encodée ne casse rien', view.innerHTML.includes('kj-tiles'));

window.location.hash = '#kanji/inconnu';
check('kanji inconnu → retour à la liste', view.innerHTML.includes('kj-tiles'));

document.fireKey('ArrowRight'); // no card open: nothing happens
check(
  'flèches sans effet sur la liste',
  decodeURIComponent(window.location.hash) === '#kanji/inconnu',
);
window.location.hash = '#kanji/水';
document.fireKey('ArrowRight');
check(
  'flèche droite → kanji suivant',
  decodeURIComponent(window.location.hash) === '#kanji/木',
  window.location.hash,
);

// -------------------------------------------------------------------- romaji
console.log('Saisie en romaji :');
{
  const { toKana: kana, sameReading: same } = globalThis.__scope;
  const cases = [
    ['suichuu', 'すいちゅう'],
    ['gakkou', 'がっこう'],
    ['konnichiwa', 'こんにちわ'],
    ["kon'ya", 'こんや'],
    ['sinbun', 'しんぶん'],
    ['matcha', 'まっちゃ'],
    ['kyou', 'きょう'],
    ['onna no hito', 'おんなのひと'],
    ['HITO', 'ひと'],
    ['スイ', 'すい'],
    ['hon', 'ほん'],
  ];
  const wrong = cases.filter(([a, b]) => kana(a) !== b);
  check('conversion romaji → kana', !wrong.length, wrong.map(([a]) => `${a}→${kana(a)}`).join(' '));
  check('ぢ/じ et づ/ず équivalents', same('hanaji', 'はなぢ') && same('tsuzuku', 'つづく'));
  check('réponse vide refusée', !same('', ''));
  const accepted = [
    ['sennen', 'せんえん'], // nn as ん, as the hint used to say
    ['kinnyoubi', 'きんようび'],
    ["kin'youbi", 'きんようび'],
    ['kon’ya', 'こんや'], // curly apostrophe, as phones type it
    ['kyō', 'きょう'],
    ['ōkii', 'おおきい'],
    ['ｓｕｉ', 'すい'],
    ['jya', 'じゃ'],
    ['konnichiwa', 'こんにちわ'],
  ];
  const refused = accepted.filter(([a, b]) => !same(a, b));
  check('orthographes courantes acceptées', !refused.length, refused.map(([a]) => a).join(' '));
  check(
    'une mauvaise lecture reste fausse',
    !same('sennen', 'せんねんまえ') && !same('mizu', 'すい'),
  );
}

// --------------------------------------------------------------------- exams
console.log('Examens :');
const click = (cls, dataset = {}) =>
  view.fire('click', { target: Object.assign(new El(), { _class: cls, dataset }) });
const store = globalThis.__scope.kanjiStore;
const { currentExam, buildExam } = globalThis.__scope;

store.learned = ['水'];
window.location.hash = '#kanji';
check('pas d’examen avant 5 kanji', !view.innerHTML.includes('kj-exam-btn'));
check(
  '… mais on annonce le premier',
  view.innerHTML.includes('Premier examen à 5 kanji appris : encore 4'),
);
window.location.hash = '#kanji/examen/5';
check('examen pas encore ouvert → liste', !currentExam() && view.innerHTML.includes('kj-tiles'));

// Learn the fifth one from its card: the banner shows up.
store.learned = ['日', '大', '水', '一'];
window.location.hash = '#kanji/人';
click('kj-learn');
check(
  '5ᵉ kanji appris → bannière d’examen',
  view.innerHTML.includes('L’examen sur les 5 est prêt'),
);
check(
  'l’ordre d’apprentissage est gardé',
  store.learned.join('') === '日大水一人',
  store.learned.join(''),
);

click('kj-exam-start', { n: '5' });
let ex = currentExam();
check('l’examen démarre', !!ex && decodeURIComponent(window.location.hash) === '#kanji/examen/5');
check('3 questions par kanji', ex.questions.length === 15, `(${ex.questions.length})`);
check(
  'chaque kanji est interrogé, avec une lecture à écrire',
  ['日', '大', '水', '一', '人'].every((k) => ex.questions.some((q) => q.typed && q.card.k === k)),
  ex.questions.map((q) => q.kind).join(', '),
);
check(
  'pas de lecture en QCM en plus de la lecture écrite',
  !ex.questions.some((q) => q.kind === 'Lecture'),
);
check(
  'les lectures demandées donnent le sens du mot',
  ex.questions.filter((q) => q.typed).every((q) => q.hint),
);
check(
  'quatre propositions distinctes, une seule bonne',
  ex.questions
    .filter((q) => !q.typed)
    .every((q) => q.options.length === 4 && new Set(q.options).size === 4 && q.answer >= 0),
);
check(
  'les mots demandés ne contiennent que des kanji de l’examen',
  ex.questions
    .filter((q) => q.typed || q.kind === 'Sens du mot')
    .every((q) => kanjiIn(q.prompt).every((k) => '日大水一人'.includes(k))),
);

// Furigana toggling must not restart the exam.
const firstPrompt = ex.questions[0].prompt;
click('kj-furi', { furi: 'always' });
check(
  'changer les furigana ne relance pas l’examen',
  currentExam() === ex && ex.questions[0].prompt === firstPrompt,
);

// One wrong answer, then all right: clicks, keys and typed readings.
const typeAnswer = (text) =>
  view.fire('submit', { target: { elements: { answer: { value: text } } } });
let digitsIgnored = true;
ex.questions.forEach((q, i) => {
  if (q.typed) {
    document.fireKey('1'); // digits belong to the input, not to an option
    digitsIgnored = digitsIgnored && ex.chosen === null;
    typeAnswer('');
    digitsIgnored = digitsIgnored && ex.chosen === null;
    typeAnswer(i === 0 ? 'zzz' : globalThis.__scope.toKana(q.expected).toUpperCase());
  } else {
    const pick = i === 0 ? (q.answer + 1) % 4 : q.answer;
    if (i % 2) document.fireKey(String(pick + 1));
    else click('kj-choice', { i: String(pick) });
  }
  if (i === 0) check('mauvaise réponse corrigée', view.innerHTML.includes('feedback ko'));
  if (i % 2) document.fireKey('Enter');
  else click('kj-exam-next');
});
check('saisie : ni un chiffre ni une réponse vide ne comptent', digitsIgnored);
check('examen terminé', ex.done && view.innerHTML.includes('Examen des 5 kanji'));
check('score 14 / 15', ex.score === 14 && view.innerHTML.includes('<strong>93</strong>%'));
check(
  'l’erreur est listée avec un lien vers sa fiche',
  view.innerHTML.includes('À revoir') && view.innerHTML.includes(`data-k="${ex.missed[0].card.k}"`),
);
check(
  'meilleur score enregistré',
  JSON.parse(memory.get('konpeito.kanji.v1')).exams['5'].best === 93,
);

window.location.hash = '#kanji';
check('le score apparaît dans la liste', view.innerHTML.includes('kj-exam-badge is-passed">93 %'));
check('quitter efface l’examen en cours', currentExam() === null);

// A big exam stays bounded and always covers the latest five.
store.learned = KANJI.map((c) => c.k);
const big = buildExam(70);
const latest = store.learned.slice(65, 70);
check('examen plafonné à 40 questions', big.questions.length === 40, `(${big.questions.length})`);
check(
  'les 5 derniers kanji y sont toujours',
  latest.every((k) => big.questions.some((q) => q.card.k === k)),
);
store.learned = [];

// --------------------------------------------------- kana and kanji, one page
console.log('Cohabitation avec le quiz kana :');
window.location.hash = '#kana';
id('start-btn').fire('click');
const kanaScore = () => `${id('score-ok').textContent}/${id('score-ko').textContent}`;
const before = kanaScore();
window.location.hash = '#kanji';
['1', '2', 'Enter', ' ', 'Backspace'].forEach((key) => document.fireKey(key));
check(
  'sur l’onglet kanji, le clavier ne répond pas au quiz kana caché',
  kanaScore() === before,
  kanaScore(),
);
window.location.hash = '#kana';
document.fireKey('1');
check('… mais le quiz kana répond toujours sur son onglet', kanaScore() !== before, kanaScore());

window.location.hash = '#kana';
check('retour à l’onglet kana', view.hidden === true && id('kana-view').hidden === false);

console.log(fails.length ? `\n❌ ${fails.length} échec(s)` : '\n✅ tout passe');
process.exitCode = fails.length ? 1 : 0;

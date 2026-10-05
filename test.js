/**
 * Headless smoke test: runs app.js against a minimal fake DOM and plays real
 * sessions in the three modes.
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

const { El, id, memory } = createDom();

// Progression enregistrée sous l'ancien nom du projet : elle doit survivre.
memory.set(
  'kanasucre.v1',
  JSON.stringify({ settings: {}, stats: { 'hiragana:あ': { ok: 3, ko: 1 } } }),
);

const load = (file) => fs.readFileSync(path.join(DIR, file), 'utf8');
(0, eval)(
  `${load('kana.js')}\n${load('recognizer.js')}\n${load('app.js')}\n` +
    ';Object.assign(globalThis.__scope||(globalThis.__scope={}),{ALL_CARDS})',
);
const { ALL_CARDS } = globalThis.__scope;

check('progression de l’ancien nom relue', id('weak-list').children.length === 1);

// ------------------------------------------------------------------ rendering
const chips = id('family-picker').querySelectorAll('.row-chip');
check('les 26 rangées sont rendues', chips.length === 26, `(${chips.length})`);
const pressed = chips.filter((c) => c.getAttribute('aria-pressed') === 'true');
check(
  'seules les 10 rangées de base sont pré-cochées',
  pressed.length === 10 && pressed.every((c) => !/^(ga|za|da|ba|pa|kya|sha)/.test(c.dataset.row)),
  `(${pressed.length} cochées)`,
);
check('paquet par défaut annoncé', /46 cartes/.test(id('deck-info').textContent), id('deck-info').textContent);
check(
  'le résumé dit ce qui va se passer',
  id('hero-summary').textContent === '20 questions · hiragana, les 46 de base · tu choisis la bonne lecture',
  `« ${id('hero-summary').textContent} »`,
);

// ------------------------------------------- puces, presets, carte de progression
const fakeTarget = (cls, data) => Object.assign(new El(), { _class: cls, dataset: data });

check('les puces montrent les kana', /^[\u3041-\u3096]+$/.test(chips[0].textContent), chips[0].textContent);
check('la lecture reste en infobulle', chips[0].title === 'a i u e o', String(chips[0].title));
check('un grain par kana du paquet', id('mastery').children.length === 46, `(${id('mastery').children.length})`);
check(
  'あ, vu 4 fois dont 1 raté, est « en cours »',
  id('mastery').children[0].className.includes('is-learning'),
  id('mastery').children[0].className,
);
check('le décompte de maîtrise est annoncé', /0 kana sur 46/.test(id('mastery-caption').textContent), id('mastery-caption').textContent);

id('presets').fire('click', { target: fakeTarget('preset', { preset: 'all' }) });
check(
  'le résumé suit les réglages',
  /hiragana et katakana, toutes les séries/.test(id('hero-summary').textContent),
  `« ${id('hero-summary').textContent} »`,
);
check('preset « tout » : 208 cartes', /208 cartes/.test(id('deck-info').textContent), id('deck-info').textContent);
check('… et la carte de progression suit', id('mastery').children.length === 208);
id('presets').fire('click', { target: fakeTarget('preset', { preset: 'katakana' }) });
check('preset katakana : les puces basculent', /^[\u30a1-\u30fa]+$/.test(chips[0].textContent), chips[0].textContent);
id('presets').fire('click', { target: fakeTarget('preset', { preset: 'starter' }) });
check('preset « les 46 de base » : retour au paquet de départ', /46 cartes/.test(id('deck-info').textContent));

// --------------------------------------------------------- mode kana → romaji
function playChoiceSession(modeLabel, expectedValue, alwaysCorrect) {
  id('start-btn').fire('click');
  let asked = 0;
  const seenPrompts = new Set();
  while (!id('screen-quiz').hidden && asked < 40) {
    const choices = id('choices').querySelectorAll('.choice');
    const values = choices.map((c) => c.dataset.value);
    if (choices.length !== 4) fails.push(`${modeLabel}: ${choices.length} choix au lieu de 4`);
    if (new Set(values).size !== values.length)
      fails.push(`${modeLabel}: doublon dans les choix ${values.join('/')}`);
    const answer = expectedValue();
    if (!values.includes(answer))
      fails.push(`${modeLabel}: bonne réponse absente (${answer} ∉ ${values.join('/')})`);
    seenPrompts.add(id('prompt').textContent);
    const target = alwaysCorrect
      ? choices.find((c) => c.dataset.value === answer)
      : choices.find((c) => c.dataset.value !== answer);
    target.fire('click');
    if (!alwaysCorrect) document.fireKey('Enter');
    asked += 1;
  }
  return { asked, variety: seenPrompts.size };
}

const romajiOf = () => {
  const shown = id('prompt').textContent;
  return ALL_CARDS.find((c) => c.char === shown && c.script === 'hiragana').romaji;
};

let run = playChoiceSession('kana→romaji', romajiOf, false);
check('la consigne du mode est affichée pendant le quiz', /1 à 4/.test(id('quiz-howto').textContent), id('quiz-howto').textContent);
check('session de 20 questions terminée', run.asked === 20, `(${run.asked} posées)`);
check('écran de fin affiché', id('screen-end').hidden === false);
check('score 0% après 20 erreurs', id('result-pct').textContent === 0, `(${id('result-pct').textContent}%)`);
check('bouton "réviser mes erreurs" proposé', id('review-btn').hidden === false);
check('les kana ratés sont listés', id('missed-list').children.length > 0);
check('variété des questions', run.variety > 8, `(${run.variety} kana différents)`);

// les erreurs remontent dans "à retravailler"
check('panneau "à retravailler" visible', id('weak-card').hidden === false);
check('top faiblesses rempli', id('weak-list').children.length > 0);

// -------------------------------------------------------- mode romaji → kana
id('mode-picker').fire('click', {
  target: Object.assign(new El(), { _class: 'mode', dataset: { mode: 'romaji-kana' } }),
});
const kanaOf = () => {
  const shown = id('prompt').textContent;
  return ALL_CARDS.find((c) => c.romaji === shown && c.script === 'hiragana').char;
};
run = playChoiceSession('romaji→kana', kanaOf, true);
check('session romaji→kana terminée', run.asked === 20, `(${run.asked})`);
check('score 100% après 20 bonnes réponses', id('result-pct').textContent === 100, `(${id('result-pct').textContent}%)`);
check('pas de révision proposée sans erreur', id('review-btn').hidden === true);

// ------------------------------------------------------------- mode saisie
id('mode-picker').fire('click', {
  target: Object.assign(new El(), { _class: 'mode', dataset: { mode: 'typing' } }),
});
id('start-btn').fire('click');
let typed = 0;
const alias = { shi: 'si', chi: 'ti', tsu: 'tu', fu: 'hu' };
while (!id('screen-quiz').hidden && typed < 30) {
  const card = ALL_CARDS.find((c) => c.char === id('prompt').textContent && c.script === 'hiragana');
  // alterne romaji canonique et romanisation alternative (si → shi…)
  id('typing-input').value = typed % 2 && alias[card.romaji] ? alias[card.romaji] : card.romaji;
  id('typing-form').fire('submit');
  if (/se lit/.test(id('feedback').textContent))
    fails.push(`saisie: "${id('typing-input').value}" refusé pour ${card.char}`);
  document.fireKey('Enter');
  typed += 1;
}
check('session de saisie terminée', typed === 20, `(${typed})`);
check('saisie: 100% (alias romaji acceptés)', id('result-pct').textContent === 100, `(${id('result-pct').textContent}%)`);

// ------------------------------------------------- stress: paquet complet
id('script-picker').fire('click', { target: fakeTarget('pill', { script: 'katakana' }) });
id('family-picker')
  .querySelectorAll('.row-chip')
  .forEach((chip) => {
    if (chip.getAttribute('aria-pressed') === 'false') chip.fire('click');
  });
id('length-picker').fire('click', { target: fakeTarget('pill', { length: '0' }) });
check('paquet complet sélectionné', /208 cartes/.test(id('deck-info').textContent), id('deck-info').textContent);

for (const mode of ['kana-romaji', 'romaji-kana']) {
  id('mode-picker').fire('click', { target: fakeTarget('mode', { mode }) });
  id('start-btn').fire('click');
  const problems = [];
  const promptsSeen = new Set();
  for (let i = 0; i < 400; i += 1) {
    const shown = id('prompt').textContent;
    promptsSeen.add(shown + '·' + id('prompt-label').textContent);
    const choices = id('choices').querySelectorAll('.choice');
    const values = choices.map((c) => c.dataset.value);
    if (values.length !== 4) problems.push(`${values.length} choix`);
    if (new Set(values).size !== values.length) problems.push(`doublon: ${values.join('/')}`);

    // La bonne réponse est la seule proposition qui soit une lecture valide
    // du prompt — c'est l'invariant qui compte, dans les deux sens.
    const valid =
      mode === 'romaji-kana'
        ? values.filter((v) => ALL_CARDS.some((c) => c.char === v && c.romaji === shown))
        : values.filter((v) => v === ALL_CARDS.find((c) => c.char === shown).romaji);
    if (valid.length !== 1) {
      problems.push(`${valid.length} réponses valides pour « ${shown} » parmi ${values.join('/')}`);
      break;
    }
    if (mode === 'romaji-kana') {
      const scripts = new Set(
        values.map((v) => (ALL_CARDS.find((c) => c.char === v) || {}).script),
      );
      if (scripts.size > 1) problems.push(`syllabaires mélangés pour « ${shown} »: ${values.join('/')}`);
      const asked = /katakana/.test(id('prompt-label').textContent) ? 'katakana' : 'hiragana';
      const answerScript = ALL_CARDS.find((c) => c.char === valid[0]).script;
      if (id('prompt-label').textContent !== 'Quel kana ?' && answerScript !== asked)
        problems.push(`libellé « ${id('prompt-label').textContent} » mais réponse en ${answerScript}`);
    }
    const answer = valid[0];
    const target = choices.find((c) => c.dataset.value === answer);
    (i % 3 === 0 ? choices.find((c) => c !== target) : target).fire('click');
    if (i % 3 === 0) document.fireKey('Enter');
  }
  check(`stress ${mode}: 400 questions sans anomalie`, problems.length === 0, problems.slice(0, 3).join(' | '));
  check(`stress ${mode}: mode sans fin ne s'arrête pas`, id('screen-quiz').hidden === false);
  check(`stress ${mode}: bonne couverture du paquet`, promptsSeen.size > 100, `(${promptsSeen.size} prompts distincts)`);
  id('quit-btn').fire('click');
}

// --------------------------------------------------------------- persistance
const saved = JSON.parse(memory.get('konpeito.v1'));
check('réglages persistés', saved.settings.mode === 'romaji-kana', `(mode=${saved.settings.mode}, ${saved.settings.rows.length} rangées, ${saved.settings.scripts.length} syllabaires)`);
check('statistiques persistées', Object.keys(saved.stats).length > 20, `(${Object.keys(saved.stats).length} kana suivis)`);
check('progression de l’ancien nom migrée sous le nouveau', Boolean(saved.stats['hiragana:あ']));

console.log(
  fails.length ? `\n❌ ${fails.length} échec(s):\n- ${fails.join('\n- ')}` : '\n✅ tout passe',
);
process.exit(fails.length ? 1 : 0);

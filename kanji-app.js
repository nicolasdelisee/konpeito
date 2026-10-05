/* global KANJI, KANJI_GROUPS, KANJI_LEVELS, toKana, sameReading */

/**
 * The kanji tab: a list of cards, and one page per kanji.
 *
 * The only state is which kanji you have learnt (in the order you learnt
 * them), how furigana are shown, and your best exam scores.
 * Everything else — which words you can already read, which kanji to learn
 * next, where a kanji turns up elsewhere — is derived from that and from the
 * data in kanji.js.
 */
const KANJI_STORAGE_KEY = 'konpeito.kanji.v1';
const KANJI_RUN = /[㐀-鿿豈-﫿々]/;
const RUBY_PATTERN = /([㐀-鿿豈-﫿々]+)\[([^\]]+)\]/g;

const FURIGANA_MODES = {
  auto: 'Sur les kanji pas encore appris',
  always: 'Partout',
  never: 'Nulle part — touche un mot pour voir sa lecture',
};

const READING_TAGS = {
  on: { label: 'ON', hint: 'lecture d’origine chinoise, surtout dans les mots composés' },
  kun: { label: 'KUN', hint: 'lecture japonaise, souvent pour un mot seul ou avec des kana' },
  sp: { label: 'spécial', hint: 'lecture propre à ce mot : à retenir en entier' },
};

const KANJI_BY_CHAR = new Map(KANJI.map((card) => [card.k, card]));

const kanjiStore = loadKanjiStore();

// ---------------------------------------------------------------- persistence

function loadKanjiStore() {
  const empty = { learned: [], furigana: 'auto', exams: {}, level: 'all' };
  try {
    const parsed = JSON.parse(localStorage.getItem(KANJI_STORAGE_KEY) || 'null');
    if (!parsed) return empty;
    return {
      learned: (parsed.learned || []).filter((k) => KANJI_BY_CHAR.has(k)),
      furigana: FURIGANA_MODES[parsed.furigana] ? parsed.furigana : 'auto',
      exams: parsed.exams || {},
      level: KANJI_LEVELS.includes(parsed.level) ? parsed.level : 'all',
    };
  } catch (error) {
    console.warn('Kanji appris illisibles, on repart de zéro.', error);
    return empty;
  }
}

function saveKanjiStore() {
  try {
    localStorage.setItem(KANJI_STORAGE_KEY, JSON.stringify(kanjiStore));
  } catch (error) {
    console.warn('Impossible d’enregistrer les kanji appris.', error);
  }
}

function learnedSet() {
  return new Set(kanjiStore.learned);
}

/** Learning order matters: exam N covers the first N kanji you learnt. */
function toggleLearned(k) {
  kanjiStore.learned = kanjiStore.learned.includes(k)
    ? kanjiStore.learned.filter((char) => char !== k)
    : [...kanjiStore.learned, k];
  saveKanjiStore();
}

// ------------------------------------------------------------------ analysis

/** Distinct kanji of a text, in order. 々 only repeats the previous one. */
function kanjiIn(text) {
  return [...new Set([...text].filter((ch) => KANJI_RUN.test(ch) && ch !== '々'))];
}

/** `毎日[まいにち]、パン` → [{ base: '毎日', reading: 'まいにち' }, { text: '、パン' }] */
function parseRuby(jp) {
  const segments = [];
  let last = 0;
  for (const match of jp.matchAll(RUBY_PATTERN)) {
    if (match.index > last) segments.push({ text: jp.slice(last, match.index) });
    segments.push({ base: match[1], reading: match[2] });
    last = match.index + match[0].length;
  }
  if (last < jp.length) segments.push({ text: jp.slice(last) });
  return segments;
}

/** Every word of every card, once, with the card it belongs to. */
const ALL_WORDS = (() => {
  const seen = new Map();
  KANJI.forEach((card) => {
    card.words.forEach((word) => {
      if (!seen.has(word.w)) seen.set(word.w, { ...word, owner: card.k });
    });
  });
  return [...seen.values()];
})();

function canRead(text, learned) {
  return kanjiIn(text).every((k) => learned.has(k));
}

/** Words of other cards that use this kanji: the links between cards. */
function wordsElsewhere(k) {
  const own = new Set(KANJI_BY_CHAR.get(k).words.map((word) => word.w));
  return ALL_WORDS.filter((word) => word.owner !== k && !own.has(word.w) && word.w.includes(k));
}

/**
 * The kanji that unlocks the most words given what you know: every word it
 * would make fully readable. Ties go to the earlier kanji of the list.
 */
function suggestNext(learned, pool = KANJI) {
  let best = null;
  pool.forEach((card) => {
    if (learned.has(card.k)) return;
    const withIt = new Set([...learned, card.k]);
    const unlocked = ALL_WORDS.filter((word) => word.w.includes(card.k) && canRead(word.w, withIt));
    if (!best || unlocked.length > best.words.length) best = { card, words: unlocked };
  });
  return best;
}

// ----------------------------------------------------------------- rendering

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

/** 'おお.きい' → おお<span class="kj-okuri">きい</span> */
function formatReading(reading) {
  const [stem, okurigana] = reading.split('.');
  return okurigana
    ? `${escapeHtml(stem)}<span class="kj-okuri">${escapeHtml(okurigana)}</span>`
    : escapeHtml(stem);
}

function rubyHidden(base, learned) {
  if (kanjiStore.furigana === 'always') return false;
  if (kanjiStore.furigana === 'never') return true;
  return canRead(base, learned);
}

/** A sentence with its furigana; the kanji of the current card stands out. */
function renderPhrase(jp, current, learned) {
  return parseRuby(jp)
    .map((segment) => {
      if (segment.text) return escapeHtml(segment.text);
      const base = [...segment.base]
        .map((ch) => (ch === current ? `<span class="kj-target">${ch}</span>` : escapeHtml(ch)))
        .join('');
      const hidden = rubyHidden(segment.base, learned) ? ' is-hidden' : '';
      return `<ruby class="kj-ruby${hidden}">${base}<rt>${escapeHtml(segment.reading)}</rt></ruby>`;
    })
    .join('');
}

/** One chip per other kanji of the word: a link if it has a card. */
function kanjiChips(text, current, learned) {
  return kanjiIn(text)
    .filter((k) => k !== current)
    .map((k) => {
      const card = KANJI_BY_CHAR.get(k);
      if (!card) {
        return `<span class="kj-chip is-missing" title="Pas encore de fiche">${escapeHtml(k)}</span>`;
      }
      const state = learned.has(k) ? ' is-learned' : '';
      return `<button type="button" class="kj-open kj-chip${state}" data-k="${k}" title="${escapeHtml(card.fr)}">${k}</button>`;
    })
    .join('');
}

function renderWord(word, current, learned) {
  const tag = READING_TAGS[word.y];
  const chips = kanjiChips(word.w, current, learned);
  const readable = canRead(word.w, learned)
    ? '<span class="kj-readable">✓ tu peux le lire</span>'
    : '';
  return `<li class="kj-word">
    <span class="kj-word-jp">${escapeHtml(word.w)}</span>
    <span class="kj-word-r">${escapeHtml(word.r)}</span>
    <span class="kj-word-fr">${escapeHtml(word.fr)}</span>
    <span class="kj-tag is-${word.y}" title="${escapeHtml(tag.hint)}">${tag.label}</span>
    ${chips || readable ? `<span class="kj-word-links">${chips}${readable}</span>` : ''}
  </li>`;
}

function renderFuriganaPicker() {
  const pills = Object.keys(FURIGANA_MODES)
    .map(
      (mode) =>
        `<button type="button" class="pill kj-furi" data-furi="${mode}" aria-pressed="${kanjiStore.furigana === mode}">${{ auto: 'Auto', always: 'Toujours', never: 'Jamais' }[mode]}</button>`,
    )
    .join('');
  return `<div class="kj-furi-picker">
    <span class="kj-furi-label">Furigana</span>
    <div class="pill-group">${pills}</div>
    <p class="muted">${escapeHtml(FURIGANA_MODES[kanjiStore.furigana])}.</p>
  </div>`;
}

/** The kanji of the selected JLPT level, or all of them. */
function visibleKanji() {
  const { level } = kanjiStore;
  return level === 'all' ? KANJI : KANJI.filter((card) => card.n === level);
}

/** N5 → N1; a level without cards yet stays visible, greyed out. */
function renderLevelPicker(learned) {
  const pill = (value, label, cards) => {
    const done = cards.filter((card) => learned.has(card.k)).length;
    const detail = cards.length ? `${done}/${cards.length}` : 'à venir';
    return `<button type="button" class="pill kj-level" data-level="${value}" aria-pressed="${kanjiStore.level === value}"${cards.length ? '' : ' disabled'}>
        ${label} <span class="kj-level-count">${detail}</span>
      </button>`;
  };
  const levels = KANJI_LEVELS.map((n) =>
    pill(
      n,
      `N${n}`,
      KANJI.filter((card) => card.n === n),
    ),
  ).join('');
  return `<div class="kj-levels">
      <span class="kj-furi-label">Niveau JLPT</span>
      <div class="pill-group">${pill('all', 'Tous', KANJI)}${levels}</div>
    </div>`;
}

function renderList() {
  const learned = learnedSet();
  const pool = visibleKanji();
  const next = suggestNext(learned, pool);
  const count = pool.filter((card) => learned.has(card.k)).length;
  const scope = kanjiStore.level === 'all' ? '' : ` du niveau N${kanjiStore.level}`;

  let suggestion = '';
  if (next) {
    const sample = next.words
      .slice(0, 4)
      .map((word) => escapeHtml(word.w))
      .join('、');
    const why = next.words.length
      ? `${count ? 'Avec ce que tu sais déjà, il' : 'Pour commencer : il'} te fait lire ${next.words.length} mot${next.words.length > 1 ? 's' : ''} : <span class="jp">${sample}</span>${next.words.length > 4 ? '…' : ''}`
      : 'Un bon point de départ.';
    suggestion = `<p class="hero-label">À apprendre ensuite</p>
      <button type="button" class="kj-open kj-next" data-k="${next.card.k}">
        <span class="kj-next-k">${next.card.k}</span>
        <span class="kj-next-text"><strong>${escapeHtml(next.card.fr)}</strong><span>${why}</span></span>
      </button>`;
  }

  const groups = KANJI_GROUPS.map((group) => {
    const cards = pool.filter((card) => card.g === group.id);
    if (!cards.length) return '';
    const tiles = cards
      .map(
        (card) =>
          `<button type="button" class="kj-open kj-tile${learned.has(card.k) ? ' is-learned' : ''}" data-k="${card.k}">
            <span class="kj-tile-k">${card.k}</span>
            <span class="kj-tile-fr">${escapeHtml(card.fr.split(/[,;]/)[0])}</span>
          </button>`,
      )
      .join('');
    return `<div class="card"><h2>${escapeHtml(group.label)}</h2><div class="kj-tiles">${tiles}</div></div>`;
  }).join('');

  return `<div class="card hero kj-summary">
      <p class="hero-summary">${count ? `Tu as appris <strong>${count}</strong> kanji sur ${pool.length}${scope}.` : `${pool.length} kanji${scope}, une fiche chacun.`}</p>
      ${suggestion}
    </div>
    <div class="card">${renderLevelPicker(learned)}</div>
    ${renderExamsBlock()}
    <div class="card">${renderFuriganaPicker()}</div>
    <p class="settings-intro">Touche un kanji pour ouvrir sa fiche</p>
    ${groups}`;
}

function renderCard(card) {
  const learned = learnedSet();
  const index = KANJI.indexOf(card);
  const prev = KANJI[index - 1];
  const next = KANJI[index + 1];
  const group = KANJI_GROUPS.find((item) => item.id === card.g);
  const isLearned = learned.has(card.k);

  const readings = [
    ['on', card.on],
    ['kun', card.kun],
  ]
    .filter(([, list]) => list.length)
    .map(
      ([type, list]) => `<div class="kj-reading">
        <span class="kj-tag is-${type}">${READING_TAGS[type].label}</span>
        <span class="kj-reading-list">${list.map(formatReading).join('<span class="kj-sep">、</span>')}</span>
        <span class="kj-reading-hint">${READING_TAGS[type].hint}</span>
      </div>`,
    )
    .join('');

  // Words you can already read first: they are the ones that stick.
  const words = [...card.words]
    .sort((a, b) => canRead(b.w, learned) - canRead(a.w, learned))
    .map((word) => renderWord(word, card.k, learned))
    .join('');

  const phrases = card.phrases
    .map(
      (phrase) => `<div class="kj-phrase">
        <p class="kj-phrase-jp">${renderPhrase(phrase.jp, card.k, learned)}</p>
        <p class="kj-phrase-fr">${escapeHtml(phrase.fr)}</p>
      </div>`,
    )
    .join('');

  const notes = (card.notes || []).length
    ? `<div class="card"><h2>À savoir</h2><ul class="kj-notes">${card.notes
        .map((note) => `<li>${escapeHtml(note)}</li>`)
        .join('')}</ul></div>`
    : '';

  const elsewhere = wordsElsewhere(card.k);
  const elsewhereBlock = elsewhere.length
    ? `<h3 class="weak-title">On le retrouve aussi dans</h3>
      <ul class="kj-elsewhere">${elsewhere
        .map(
          (
            word,
          ) => `<li><button type="button" class="kj-open kj-elsewhere-btn" data-k="${word.owner}">
            <span class="jp">${escapeHtml(word.w)}</span>
            <span class="kj-word-r">${escapeHtml(word.r)}</span>
            <span class="kj-word-fr">${escapeHtml(word.fr)}</span>
          </button></li>`,
        )
        .join('')}</ul>`
    : '';
  const see = (card.see || []).length
    ? `<h3 class="weak-title">À rapprocher de</h3><div class="kj-see">${kanjiChips(card.see.join(''), card.k, learned)}</div>`
    : '';
  const links = elsewhereBlock || see ? `<div class="card">${elsewhereBlock}${see}</div>` : '';

  const arrow = (target, label) =>
    target
      ? `<button type="button" class="pad-btn kj-open" data-k="${target.k}" title="${escapeHtml(target.fr)}">${label}</button>`
      : '';

  return `<div class="kj-nav">
      <button type="button" class="link-btn kj-back">← Tous les kanji</button>
      <span class="kj-arrows">${arrow(prev, `‹ ${prev ? prev.k : ''}`)}${arrow(next, `${next ? next.k : ''} ›`)}</span>
    </div>

    <div class="card hero kj-hero">
      <p class="kj-glyph" lang="ja">${card.k}</p>
      <p class="kj-meaning">${escapeHtml(card.fr)}</p>
      <p class="muted">${card.strokes} trait${card.strokes > 1 ? 's' : ''} · ${escapeHtml(group.label)} · JLPT N${card.n}</p>
      <button type="button" class="kj-learn pill" aria-pressed="${isLearned}">${isLearned ? '✓ Appris' : 'Je l’ai appris'}</button>
    </div>
    ${renderExamBanner(card)}

    <div class="card"><h2>Lectures</h2>${readings}</div>

    <div class="card"><h2>Mots</h2><ul class="kj-words">${words}</ul></div>

    <div class="card">
      <h2>Phrases</h2>
      ${phrases}
      ${renderFuriganaPicker()}
    </div>

    ${notes}
    ${links}`;
}

// ---------------------------------------------------------------------- exams

/** An exam unlocks every EXAM_STEP kanji and covers all those learnt before. */
const EXAM_STEP = 5;
const EXAM_PER_KANJI = 3;
const EXAM_MAX_QUESTIONS = 40;
const EXAM_PASS = 0.8;

/** Lives only while an exam is on screen. */
let exam = null;

function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function examSizes() {
  const sizes = [];
  for (let n = EXAM_STEP; n <= kanjiStore.learned.length; n += EXAM_STEP) sizes.push(n);
  return sizes;
}

/**
 * Three wrong answers: the `near` candidates first (same exam, shared kanji —
 * the ones you could actually mix up), then anything else.
 */
function pickOptions(answer, near, far) {
  // « une femme » and « une femme (poli) » would both be right: keep only one.
  const core = (text) =>
    text
      .replace(/\(.*?\)/g, '')
      .trim()
      .toLowerCase();
  const clashes = (a, b) => core(a).startsWith(core(b)) || core(b).startsWith(core(a));
  const wrong = [];
  [...shuffled(near), ...shuffled(far)].forEach((option) => {
    if (wrong.length >= 3 || !option || clashes(option, answer)) return;
    if (wrong.some((taken) => clashes(taken, option))) return;
    wrong.push(option);
  });
  const options = shuffled([answer, ...wrong]);
  return { options, answer: options.indexOf(answer) };
}

/**
 * The question kinds a kanji can be asked in, given the kanji of the exam.
 * `typed` is the reading to write, when the kanji has a word for it; the
 * multiple-choice reading question only stands in when it does not.
 */
function questionsFor(card, cards, known) {
  const others = cards.filter((other) => other !== card);
  const readable = ALL_WORDS.filter((word) => word.w.includes(card.k) && canRead(word.w, known));
  // Readings with katakana (なまビール) or alternatives (なに / なん) stay multiple choice.
  const writable = readable.filter((word) => /^[\u3041-\u309f]+$/.test(word.r));
  const kinds = [];
  const add = (kind, make) => kinds.push({ kind, make });

  add('Kanji', () => ({
    kind: 'Retrouver le kanji',
    label: 'Quel kanji veut dire…',
    prompt: card.fr,
    text: true,
    jpOptions: true,
    ...pickOptions(
      card.k,
      [...(card.see || []), ...others.map((other) => other.k)],
      KANJI.map((other) => other.k),
    ),
    explain: `${card.fr} = ${card.k}`,
    card,
  }));

  if (writable.length) {
    const word = shuffled(writable)[0];
    kinds.typed = {
      kind: 'Écrire',
      make: () => ({
        kind: 'Lecture à écrire',
        label: 'Écris la lecture de ce mot',
        prompt: word.w,
        typed: true,
        hint: word.fr,
        expected: word.r,
        accepted: [word.r, ...(word.alt || [])],
        explain: `${word.w} se lit ${word.r} — ${word.fr}`,
        card,
      }),
    };
  }

  add('Sens', () => ({
    kind: 'Sens du kanji',
    label: 'Que veut dire ce kanji ?',
    prompt: card.k,
    big: true,
    ...pickOptions(
      card.fr,
      others.map((other) => other.fr),
      KANJI.map((other) => other.fr),
    ),
    explain: `${card.k} = ${card.fr}`,
    card,
  }));

  if (readable.length) {
    const nearWords = ALL_WORDS.filter(
      (word) => canRead(word.w, known) || kanjiIn(word.w).some((k) => known.has(k)),
    );
    add('Lecture', () => {
      const word = shuffled(readable)[0];
      return {
        kind: 'Lecture',
        jpOptions: true,
        hint: word.fr,
        label: 'Comment se lit ce mot ?',
        prompt: word.w,
        big: true,
        ...pickOptions(
          word.r,
          nearWords
            .filter((other) => kanjiIn(other.w).some((k) => word.w.includes(k)))
            .map((o) => o.r),
          nearWords.map((other) => other.r),
        ),
        explain: `${word.w} se lit ${word.r} — ${word.fr}`,
        card,
      };
    });
    add('Sens du mot', () => {
      const word = shuffled(readable)[0];
      return {
        kind: 'Sens du mot',
        label: 'Que veut dire ce mot ?',
        prompt: word.w,
        big: true,
        ...pickOptions(
          word.fr,
          nearWords
            .filter((other) => kanjiIn(other.w).some((k) => word.w.includes(k)))
            .map((o) => o.fr),
          nearWords.map((other) => other.fr),
        ),
        explain: `${word.w} (${word.r}) = ${word.fr}`,
        card,
      };
    });
  }

  add('Phrase', () => {
    const phrase = shuffled(card.phrases)[0];
    return {
      kind: 'Phrase',
      label: 'Que veut dire cette phrase ?',
      prompt: phrase.jp,
      phrase: true,
      ...pickOptions(
        phrase.fr,
        others.flatMap((other) => other.phrases.map((p) => p.fr)),
        KANJI.flatMap((other) => other.phrases.map((p) => p.fr)),
      ),
      explain: phrase.fr,
      card,
    };
  });

  return kinds;
}

/**
 * Every kanji of the exam gets EXAM_PER_KANJI questions of different kinds,
 * one of them a reading to write whenever possible. Past EXAM_MAX_QUESTIONS,
 * the latest step is always in, the rest is drawn.
 */
function buildExam(size) {
  const cards = kanjiStore.learned.slice(0, size).map((k) => KANJI_BY_CHAR.get(k));
  const known = new Set(cards.map((card) => card.k));
  const latest = cards.slice(-EXAM_STEP);
  const older = shuffled(cards.slice(0, -EXAM_STEP));

  const slots = [];
  [...latest, ...older].forEach((card) => {
    const kinds = questionsFor(card, cards, known);
    const picks = kinds.typed
      ? [kinds.typed, ...shuffled(kinds.filter((k) => k.kind !== 'Lecture'))]
      : shuffled(kinds);
    picks.slice(0, EXAM_PER_KANJI).forEach(({ make }) => slots.push(make));
  });
  const questions = slots.slice(0, EXAM_MAX_QUESTIONS).map((make) => make());

  return {
    size,
    questions: shuffled(questions),
    index: 0,
    chosen: null,
    correct: false,
    score: 0,
    missed: [],
    done: false,
  };
}

/** `choice` is an option index, or the text typed for a reading. */
function answerExam(choice) {
  if (!exam || exam.done || exam.chosen !== null) return;
  const question = exam.questions[exam.index];
  if (question.typed && !toKana(choice)) return;
  exam.chosen = choice;
  exam.correct = question.typed
    ? question.accepted.some((reading) => sameReading(choice, reading))
    : choice === question.answer;
  if (exam.correct) exam.score += 1;
  else if (question.typed) {
    exam.missed.push({
      ...question,
      explain: `${question.explain} (tu as écrit ${toKana(choice)})`,
    });
  } else exam.missed.push(question);
}

function nextExamQuestion() {
  if (!exam || exam.chosen === null) return;
  exam.index += 1;
  exam.chosen = null;
  if (exam.index < exam.questions.length) return;
  exam.done = true;
  const pct = Math.round((exam.score / exam.questions.length) * 100);
  const previous = kanjiStore.exams[exam.size];
  if (!previous || pct > previous.best) {
    kanjiStore.exams[exam.size] = { best: pct, date: new Date().toISOString().slice(0, 10) };
    saveKanjiStore();
  }
}

function renderExamPrompt(question, learned) {
  if (question.phrase)
    return `<p class="kj-exam-phrase">${renderPhrase(question.prompt, '', learned)}</p>`;
  if (question.text) return `<p class="kj-exam-meaning">« ${escapeHtml(question.prompt)} »</p>`;
  // 金 alone is きん or かね: the meaning tells which reading is asked for.
  const hint = question.hint ? `<p class="prompt-hint">${escapeHtml(question.hint)}</p>` : '';
  return `<p class="kj-exam-prompt${question.prompt.length > 3 ? ' is-long' : ''}">${escapeHtml(question.prompt)}</p>${hint}`;
}

function renderExam() {
  const learned = learnedSet();
  const total = exam.questions.length;

  if (exam.done) {
    const pct = Math.round((exam.score / total) * 100);
    const passed = pct >= EXAM_PASS * 100;
    const missed = exam.missed
      .map(
        (question) => `<li class="kj-missed">
          <button type="button" class="kj-open kj-chip" data-k="${question.card.k}" title="Ouvrir la fiche">${question.card.k}</button>
          <span><span class="kj-missed-kind">${escapeHtml(question.kind)}</span>${escapeHtml(question.explain)}</span>
        </li>`,
      )
      .join('');
    return `<div class="kj-nav"><button type="button" class="link-btn kj-back">← Tous les kanji</button></div>
      <div class="card result-card">
        <p class="result-emoji">${passed ? (pct === 100 ? '🏆' : '🎉') : '🍡'}</p>
        <h2>Examen des ${exam.size} kanji</h2>
        <p class="result-score"><strong>${pct}</strong>% de bonnes réponses</p>
        <p class="muted">${exam.score} sur ${total}. ${passed ? 'Réussi : tu peux passer aux suivants !' : `Il faut ${EXAM_PASS * 100} % pour le réussir. Relis les fiches ci-dessous, puis retente.`}</p>
      </div>
      ${missed ? `<div class="card"><h2>À revoir</h2><ul class="kj-missed-list">${missed}</ul></div>` : ''}
      <div class="end-actions">
        <button type="button" class="primary kj-exam-start" data-n="${exam.size}">Repasser l’examen</button>
        <button type="button" class="link-btn kj-back">Retour aux kanji</button>
      </div>`;
  }

  const question = exam.questions[exam.index];
  const answered = exam.chosen !== null;
  const choices = (question.options || [])
    .map((option, i) => {
      let state = '';
      if (answered && i === question.answer) state = ' is-ok';
      else if (answered && i === exam.chosen) state = ' is-ko';
      else if (answered) state = ' is-dim';
      const jp = question.jpOptions ? ' is-jp' : '';
      return `<button type="button" class="choice kj-choice${jp}${state}" data-i="${i}"${answered ? ' disabled' : ''}><span class="num">${i + 1}</span>${escapeHtml(option)}</button>`;
    })
    .join('');
  const correct = answered && exam.correct;
  const typedNote =
    answered && question.typed && !correct ? ` · tu as écrit ${toKana(exam.chosen)}` : '';
  const feedback = answered
    ? `<p class="feedback ${correct ? 'ok' : 'ko'}">${correct ? '✓ ' : '✗ '}${escapeHtml(question.explain + typedNote)}</p>
       <div class="end-actions"><button type="button" class="primary kj-exam-next">${exam.index + 1 < total ? 'Suivant' : 'Voir le résultat'}</button></div>`
    : '';

  return `<div class="kj-nav">
      <button type="button" class="link-btn kj-back">← Quitter l’examen</button>
      <span class="muted kj-exam-count">Examen des ${exam.size} kanji · ${exam.index + 1} / ${total}</span>
    </div>
    <div class="progress"><div class="progress-fill" style="width: ${(exam.index / total) * 100}%"></div></div>
    <div class="card prompt-card kj-exam-card">
      <p class="prompt-label">${escapeHtml(question.label)}</p>
      ${renderExamPrompt(question, learned)}
    </div>
    ${question.typed ? renderTyping(answered) : `<div class="choices kj-choices${question.phrase ? ' is-text' : ''}">${choices}</div>`}
    ${feedback}
    <p class="kbd-hint">${question.typed ? 'Entrée pour valider, puis pour continuer.' : 'Touches 1 à 4 pour répondre, Entrée pour continuer.'}</p>`;
}

/** The answer box: romaji or kana, converted live as you type. */
function renderTyping(answered) {
  const value = answered ? escapeHtml(exam.chosen) : '';
  return `<form class="typing kj-typing" id="kj-typing" autocomplete="off">
      <input id="kj-answer" class="kj-answer" name="answer" type="text" value="${value}"
        autocapitalize="off" autocorrect="off" spellcheck="false" lang="ja"
        placeholder="en romaji ou en kana…"${answered ? ' disabled' : ''} />
      ${answered ? '' : '<button class="primary" type="submit">Valider</button>'}
    </form>
    <p class="kj-preview" id="kj-preview">${answered ? escapeHtml(toKana(exam.chosen)) : ''}</p>
    ${answered ? '' : '<p class="muted kj-typing-hint">suichuu → すいちゅう · ん : nn ou n’ · っ : double la consonne (gakkou)</p>'}`;
}

/** The exams block of the list: what is open, and how far the next one is. */
function renderExamsBlock() {
  const count = kanjiStore.learned.length;
  const sizes = examSizes();
  const nextSize = (Math.floor(count / EXAM_STEP) + 1) * EXAM_STEP;
  const missing = nextSize - count;
  const upcoming =
    nextSize <= KANJI.length
      ? `<p class="muted">${sizes.length ? 'Prochain examen' : 'Premier examen'} à ${nextSize} kanji appris : encore ${missing}.</p>`
      : '';
  const buttons = sizes
    .map((size) => {
      const result = kanjiStore.exams[size];
      const badge = result
        ? `<span class="kj-exam-badge${result.best >= EXAM_PASS * 100 ? ' is-passed' : ''}">${result.best} %</span>`
        : '<span class="kj-exam-badge">à passer</span>';
      return `<button type="button" class="kj-exam-start kj-exam-btn" data-n="${size}">
          <strong>${size} kanji</strong>${badge}
        </button>`;
    })
    .reverse()
    .join('');
  return `<div class="card">
      <h2>Examens</h2>
      <p class="muted">Un examen tous les ${EXAM_STEP} kanji appris, qui reprend tous ceux d’avant : sens, lectures, mots et phrases.</p>
      ${buttons ? `<div class="kj-exam-list">${buttons}</div>` : ''}
      ${upcoming}
    </div>`;
}

/** On a card, right after reaching a step: the way to the exam. */
function renderExamBanner(card) {
  const count = kanjiStore.learned.length;
  const isLatest = kanjiStore.learned[count - 1] === card.k;
  if (!count || count % EXAM_STEP || !isLatest || kanjiStore.exams[count]) return '';
  return `<div class="card kj-exam-banner">
      <p><strong>🎉 ${count} kanji appris !</strong> L’examen sur les ${count} est prêt.</p>
      <button type="button" class="primary kj-exam-start" data-n="${count}">Passer l’examen</button>
    </div>`;
}

// ------------------------------------------------------------------- routing

const kanjiEl = {};

/**
 * Kanji are the home page: no hash or `#kanji` → the list, `#kanji/水` → a
 * card, `#kanji/examen/10` → an exam. `#kana` (or anything else) → the kana tab.
 */
function currentRoute() {
  const hash = decodeURIComponent((window.location && window.location.hash) || '');
  if (hash === '' || hash === '#') return { view: 'kanji', card: null };
  const match = /^#kanji(?:\/(.+))?$/.exec(hash);
  if (!match) return { view: 'kana' };
  const examMatch = /^examen\/(\d+)$/.exec(match[1] || '');
  if (examMatch && examSizes().includes(Number(examMatch[1]))) {
    return { view: 'kanji', exam: Number(examMatch[1]) };
  }
  const card = match[1] && KANJI_BY_CHAR.get(match[1]);
  return { view: 'kanji', card: card || null };
}

function renderRoute() {
  const route = currentRoute();
  const isKanji = route.view === 'kanji';
  kanjiEl.kanaView.hidden = isKanji;
  kanjiEl.kanjiView.hidden = !isKanji;
  kanjiEl.tabKana.setAttribute('aria-current', isKanji ? 'false' : 'page');
  kanjiEl.tabKanji.setAttribute('aria-current', isKanji ? 'page' : 'false');
  document.body.classList[isKanji ? 'add' : 'remove']('view-kanji');
  if (!route.exam) exam = null;
  if (!isKanji) return;
  if (route.exam) {
    // Re-rendering (furigana, a revealed reading…) must not restart the exam.
    if (!exam || exam.size !== route.exam) exam = buildExam(route.exam);
    kanjiEl.kanjiView.innerHTML = renderExam();
    const input = document.getElementById('kj-answer');
    if (input && !input.disabled && input.focus) input.focus();
    return;
  }
  kanjiEl.kanjiView.innerHTML = route.card ? renderCard(route.card) : renderList();
}

function goTo(hash) {
  if (window.location.hash === hash) renderRoute();
  else window.location.hash = hash;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function onKanjiClick(event) {
  const target = event.target;
  const start = target.closest('.kj-exam-start');
  if (start) {
    exam = null;
    goTo(`#kanji/examen/${start.dataset.n}`);
    return;
  }
  const choice = target.closest('.kj-choice');
  if (choice) {
    answerExam(Number(choice.dataset.i));
    renderRoute();
    return;
  }
  if (target.closest('.kj-exam-next')) {
    nextExamQuestion();
    renderRoute();
    return;
  }
  const open = target.closest('.kj-open');
  if (open) {
    goTo(`#kanji/${open.dataset.k}`);
    return;
  }
  if (target.closest('.kj-back')) {
    goTo('#kanji');
    return;
  }
  const level = target.closest('.kj-level');
  if (level) {
    kanjiStore.level = level.dataset.level === 'all' ? 'all' : Number(level.dataset.level);
    saveKanjiStore();
    renderRoute();
    return;
  }
  const furi = target.closest('.kj-furi');
  if (furi) {
    kanjiStore.furigana = furi.dataset.furi;
    saveKanjiStore();
    renderRoute();
    return;
  }
  if (target.closest('.kj-learn')) {
    const { card } = currentRoute();
    if (card) toggleLearned(card.k);
    renderRoute();
    return;
  }
  const ruby = target.closest('.kj-ruby');
  if (!ruby) return;
  if (ruby.classList.contains('is-revealed')) ruby.classList.remove('is-revealed');
  else ruby.classList.add('is-revealed');
}

function onKanjiKey(event) {
  if (kanjiEl.kanjiView.hidden) return;
  if (exam && !exam.done) {
    const index = Number(event.key) - 1;
    const typing = exam.questions[exam.index].typed;
    if (exam.chosen === null && typing) return; // the input handles it
    if (exam.chosen === null && Number.isInteger(index) && index >= 0 && index < 4) {
      answerExam(index);
      renderRoute();
    } else if (exam.chosen !== null && (event.key === 'Enter' || event.key === ' ')) {
      if (event.preventDefault) event.preventDefault();
      nextExamQuestion();
      renderRoute();
    }
    return;
  }
  const { card } = currentRoute();
  if (!card) return;
  const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
  const target = step && KANJI[KANJI.indexOf(card) + step];
  if (target) goTo(`#kanji/${target.k}`);
}

function bindKanji() {
  Object.assign(kanjiEl, {
    kanaView: document.getElementById('kana-view'),
    kanjiView: document.getElementById('kanji-view'),
    tabKana: document.getElementById('tab-kana'),
    tabKanji: document.getElementById('tab-kanji'),
  });
  kanjiEl.kanjiView.addEventListener('click', onKanjiClick);
  kanjiEl.kanjiView.addEventListener('submit', (event) => {
    event.preventDefault();
    const field = event.target.elements && event.target.elements.answer;
    answerExam(field ? field.value : '');
    renderRoute();
  });
  kanjiEl.kanjiView.addEventListener('input', (event) => {
    if (event.target.id !== 'kj-answer') return;
    document.getElementById('kj-preview').textContent = toKana(event.target.value);
  });
  document.addEventListener('keydown', onKanjiKey);
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}

bindKanji();

/* global KANJI, KANJI_GROUPS */

/**
 * The kanji tab: a list of cards, and one page per kanji.
 *
 * The only state is which kanji you have learnt and how furigana are shown.
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
  const empty = { learned: [], furigana: 'auto' };
  try {
    const parsed = JSON.parse(localStorage.getItem(KANJI_STORAGE_KEY) || 'null');
    if (!parsed) return empty;
    return {
      learned: (parsed.learned || []).filter((k) => KANJI_BY_CHAR.has(k)),
      furigana: FURIGANA_MODES[parsed.furigana] ? parsed.furigana : 'auto',
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

function toggleLearned(k) {
  const learned = learnedSet();
  if (learned.has(k)) learned.delete(k);
  else learned.add(k);
  // Kept in dataset order, so the saved list reads like the page.
  kanjiStore.learned = KANJI.map((card) => card.k).filter((char) => learned.has(char));
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
function suggestNext(learned) {
  let best = null;
  KANJI.forEach((card) => {
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

function renderList() {
  const learned = learnedSet();
  const next = suggestNext(learned);
  const count = learned.size;

  let suggestion = '';
  if (next) {
    const sample = next.words.slice(0, 4).map((word) => escapeHtml(word.w)).join('、');
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
    const tiles = KANJI.filter((card) => card.g === group.id)
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
      <p class="hero-summary">${count ? `Tu as appris <strong>${count}</strong> kanji sur ${KANJI.length}.` : `${KANJI.length} kanji du quotidien, une fiche chacun.`}</p>
      ${suggestion}
    </div>
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
          (word) => `<li><button type="button" class="kj-open kj-elsewhere-btn" data-k="${word.owner}">
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
      <p class="muted">${card.strokes} trait${card.strokes > 1 ? 's' : ''} · ${escapeHtml(group.label)}</p>
      <button type="button" class="kj-learn pill" aria-pressed="${isLearned}">${isLearned ? '✓ Appris' : 'Je l’ai appris'}</button>
    </div>

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

// ------------------------------------------------------------------- routing

const kanjiEl = {};

/** `#kanji` → the list, `#kanji/水` → a card, anything else → the kana tab. */
function currentRoute() {
  const hash = decodeURIComponent((window.location && window.location.hash) || '');
  const match = /^#kanji(?:\/(.+))?$/.exec(hash);
  if (!match) return { view: 'kana' };
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
  if (!isKanji) return;
  kanjiEl.kanjiView.innerHTML = route.card ? renderCard(route.card) : renderList();
}

function goTo(hash) {
  if (window.location.hash === hash) renderRoute();
  else window.location.hash = hash;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function onKanjiClick(event) {
  const target = event.target;
  const open = target.closest('.kj-open');
  if (open) {
    goTo(`#kanji/${open.dataset.k}`);
    return;
  }
  if (target.closest('.kj-back')) {
    goTo('#kanji');
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
  document.addEventListener('keydown', onKanjiKey);
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}

bindKanji();

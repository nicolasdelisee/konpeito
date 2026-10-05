/* global KANA_ROWS, FAMILIES, ROMAJI_ALIASES, ALL_CARDS, Recognizer */

const STORAGE_KEY = 'konpeito.v1';
/** Progress saved before the project was renamed — migrated on first save. */
const LEGACY_STORAGE_KEY = 'kanasucre.v1';
const CHOICE_COUNT = 4;
const GLYPH_BOX = 64; // reference bitmap the templates are built from
const JP_FONT =
  '"Noto Sans CJK JP", "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", "MS Gothic", sans-serif';
/** How far down the ranking the expected kana may sit and still count. */
const WRITING_TOLERANCE = 3;

const DEFAULT_SETTINGS = {
  scripts: ['hiragana'],
  rows: KANA_ROWS.filter((row) => row.family === 'base').map((row) => row.id),
  mode: 'kana-romaji',
  length: 20,
};

/** Persisted across sessions: settings + per-card success stats. */
const store = loadStore();

/** Lives only for the current quiz run. */
let session = null;

const el = {};

// ---------------------------------------------------------------- persistence

function loadStore() {
  const empty = { settings: { ...DEFAULT_SETTINGS }, stats: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      stats: parsed.stats || {},
    };
  } catch (error) {
    console.warn('Progression illisible, on repart de zéro.', error);
    return empty;
  }
}

function saveStore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (error) {
    // Private browsing or a full quota: the quiz still works, just without memory.
    console.warn('Impossible d’enregistrer la progression.', error);
  }
}

function statsFor(card) {
  return store.stats[card.id] || { ok: 0, ko: 0 };
}

function recordAnswer(card, isCorrect) {
  const entry = store.stats[card.id] || { ok: 0, ko: 0 };
  if (isCorrect) entry.ok += 1;
  else entry.ko += 1;
  store.stats[card.id] = entry;
  saveStore();
}

// ----------------------------------------------------------------- deck logic

function currentDeck() {
  const { scripts, rows } = store.settings;
  return ALL_CARDS.filter(
    (card) => scripts.includes(card.script) && rows.includes(card.rowId),
  );
}

/**
 * Cards seen rarely or missed often come back more frequently.
 * Deliberately simple — no real SRS scheduling, just a weighted draw.
 */
function weightOf(card) {
  const { ok, ko } = statsFor(card);
  const attempts = ok + ko;
  let weight = 1;
  if (attempts === 0) weight += 1.5;
  else weight += 3 * (ko / attempts);
  if (session && session.recentMisses.has(card.id)) weight += 2.5;
  return weight;
}

function pickCard(deck) {
  const pool = deck.length > 1 ? deck.filter((card) => card !== session.lastCard) : deck;
  const total = pool.reduce((sum, card) => sum + weightOf(card), 0);
  let ticket = Math.random() * total;
  for (const card of pool) {
    ticket -= weightOf(card);
    if (ticket <= 0) return card;
  }
  return pool[pool.length - 1];
}

/** Wrong answers, drawn from lookalikes first so the choices stay meaningful. */
function pickDistractors(card, deck, valueOf) {
  const answer = valueOf(card);
  const taken = new Set([answer]);
  const eligible = (pool) =>
    pool.filter((other) => {
      const value = valueOf(other);
      if (taken.has(value)) return false;
      // Never offer a second card that would also be a correct reading.
      return other.romaji !== card.romaji;
    });

  const sameRow = eligible(deck.filter((other) => other.rowId === card.rowId));
  const sameScript = eligible(deck.filter((other) => other.script === card.script));
  // Last resort for tiny decks — stays inside the scripts the deck already uses.
  const scripts = new Set(deck.map((other) => other.script));
  const fallback = eligible(ALL_CARDS.filter((other) => scripts.has(other.script)));

  const picked = [];
  for (const pool of [shuffle(sameRow), shuffle(sameScript), shuffle(deck), shuffle(fallback)]) {
    for (const other of pool) {
      if (picked.length >= CHOICE_COUNT - 1) break;
      const value = valueOf(other);
      if (taken.has(value)) continue;
      taken.add(value);
      picked.push(other);
    }
    if (picked.length >= CHOICE_COUNT - 1) break;
  }
  return picked;
}

function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalize(value) {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function acceptedAnswers(card) {
  return [card.romaji, ...(ROMAJI_ALIASES[card.romaji] || [])];
}

// ---------------------------------------------------------- handwriting

const templateCache = new Map();

/**
 * Draws one kana into a GLYPH_BOX bitmap with the same font the page uses, so
 * the reference shape matches what you see on screen.
 */
function renderGlyph(char) {
  const canvas = document.createElement('canvas');
  canvas.width = GLYPH_BOX;
  canvas.height = GLYPH_BOX;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';

  const room = GLYPH_BOX * 0.9;
  let size = GLYPH_BOX * 0.78;
  let box = { width: 0, height: 0, left: 0, ascent: 0 };
  // Two-character kana (きゃ) are wider than tall: shrink until they fit.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    ctx.font = `${size}px ${JP_FONT}`;
    const m = ctx.measureText(char);
    box = {
      width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
      height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
      left: m.actualBoundingBoxLeft,
      ascent: m.actualBoundingBoxAscent,
    };
    if (box.width <= room && box.height <= room) break;
    size *= Math.min(room / (box.width || 1), room / (box.height || 1));
  }

  ctx.fillText(char, (GLYPH_BOX - box.width) / 2 + box.left, (GLYPH_BOX - box.height) / 2 + box.ascent);
  const { data } = ctx.getImageData(0, 0, GLYPH_BOX, GLYPH_BOX);
  const grid = new Uint8Array(GLYPH_BOX * GLYPH_BOX);
  for (let i = 0; i < grid.length; i += 1) grid[i] = data[i * 4 + 3] > 96 ? 1 : 0;
  return grid;
}

function templateFor(char) {
  if (!templateCache.has(char)) {
    templateCache.set(char, {
      key: char,
      ...Recognizer.shapeFromBitmap(renderGlyph(char), GLYPH_BOX, GLYPH_BOX),
    });
  }
  return templateCache.get(char);
}

/** Only single kana can be drawn — yōon (きゃ) are two characters. */
function writableCards(deck) {
  const seen = new Set();
  return deck.filter((card) => {
    if (card.char.length !== 1 || seen.has(card.char)) return false;
    seen.add(card.char);
    return true;
  });
}

/**
 * Without a Japanese font every glyph renders as the same empty box, and the
 * ranking would be meaningless. Two different kana must produce two different
 * shapes.
 */
function handwritingAvailable(cards) {
  if (cards.length < 2) return false;
  const first = templateFor(cards[0].char);
  const last = templateFor(cards[cards.length - 1].char);
  return first.points.length >= 12 && last.points.length >= 12 && Recognizer.distance(first, last) > 0.03;
}

/**
 * Candidates the drawing is ranked against, per script. A three-kana deck would
 * make the ranking meaningless, so short lists are topped up with other kana of
 * the same syllabary.
 */
function buildWritingTemplates(deck) {
  const MIN_CANDIDATES = 8;
  const groups = { hiragana: [], katakana: [] };
  const seen = new Set();
  for (const card of deck) {
    groups[card.script].push(templateFor(card.char));
    seen.add(card.char);
  }
  for (const script of ['hiragana', 'katakana']) {
    if (!groups[script].length) continue;
    for (const card of ALL_CARDS) {
      if (groups[script].length >= MIN_CANDIDATES) break;
      if (card.script !== script || card.char.length !== 1 || seen.has(card.char)) continue;
      groups[script].push(templateFor(card.char));
      seen.add(card.char);
    }
  }
  return groups;
}

// ------------------------------------------------------------- the chart

/**
 * The gojūon chart, transposed from the data: each row of `kana.js` is a
 * *column* here (the consonant), and the vowel is simply the last letter of the
 * romaji. ん has no vowel and lands in the free middle slot of the W column —
 * which is where printed charts float it anyway.
 */
const CHART_SECTIONS = [
  { family: 'base', title: 'Seion', vowels: ['a', 'i', 'u', 'e', 'o'] },
  { family: 'dakuten', title: 'Dakuon', vowels: ['a', 'i', 'u', 'e', 'o'] },
  { family: 'yoon', title: 'Yōon', vowels: ['a', 'u', 'o'] },
];

const SCRIPT_TITLES = { hiragana: 'Hiragana', katakana: 'Katakana' };

function chartVowel(card) {
  return card.romaji === 'n' ? 'u' : card.romaji.slice(-1);
}

function chartColumnHeader(romaji) {
  return romaji.slice(0, -1).toUpperCase() || '—';
}

/** ぢ/づ share their romaji with じ/ず — printed charts label them di/du. */
function chartCellLabel(card, header) {
  return card.ambiguous ? header.toLowerCase() + chartVowel(card) : card.romaji;
}

function buildChartModel(script) {
  return CHART_SECTIONS.map((section) => ({
    ...section,
    columns: KANA_ROWS.filter(
      (row) => row.family === section.family && store.settings.rows.includes(row.id),
    ).map((row) => {
      const header = chartColumnHeader(row.kana[0][2]);
      return {
        header,
        cards: ALL_CARDS.filter((card) => card.rowId === row.id && card.script === script),
      };
    }),
  })).filter((section) => section.columns.length);
}

/** Draws every selected script as its own chart, blanks included. */
function renderChart() {
  el.chart.innerHTML = '';
  session.cells = new Map();
  const blanks = new Set(session.blanks.map((card) => card.id));

  for (const script of ['hiragana', 'katakana']) {
    if (!store.settings.scripts.includes(script)) continue;
    const sections = buildChartModel(script);
    if (!sections.length) continue;

    if (store.settings.scripts.length > 1) {
      const title = document.createElement('h3');
      title.className = 'chart-script';
      title.textContent = SCRIPT_TITLES[script];
      el.chart.appendChild(title);
    }

    for (const section of sections) {
      const block = document.createElement('div');
      block.className = 'chart-section';

      const caption = document.createElement('p');
      caption.className = 'chart-caption';
      caption.textContent = section.title;
      block.appendChild(caption);

      const table = document.createElement('table');
      table.className = 'chart-table';

      const head = document.createElement('tr');
      head.appendChild(document.createElement('th'));
      for (const column of section.columns) {
        const th = document.createElement('th');
        th.textContent = column.header;
        head.appendChild(th);
      }
      table.appendChild(head);

      for (const vowel of section.vowels) {
        const line = document.createElement('tr');
        const rowHead = document.createElement('th');
        rowHead.textContent = vowel;
        line.appendChild(rowHead);

        // Yōon boxes are wider: two characters do not fit in a square.
        const wide = section.family === 'yoon' ? ' is-wide' : '';
        for (const column of section.columns) {
          const td = document.createElement('td');
          const card = column.cards.find((item) => chartVowel(item) === vowel);
          if (!card) {
            const hole = document.createElement('span');
            hole.className = `cell is-void${wide}`;
            td.appendChild(hole);
          } else if (blanks.has(card.id)) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `cell is-blank${wide}`;
            button.dataset.card = card.id;
            button.textContent = chartCellLabel(card, column.header);
            button.addEventListener('click', () => selectCell(card.id));
            session.cells.set(card.id, button);
            td.appendChild(button);
          } else {
            const filled = document.createElement('span');
            filled.className = `cell${wide}`;
            filled.textContent = card.char;
            filled.title = chartCellLabel(card, column.header);
            td.appendChild(filled);
          }
          line.appendChild(td);
        }
        table.appendChild(line);
      }
      block.appendChild(table);
      el.chart.appendChild(block);
    }
  }
}

/** Weighted draw without replacement — the shakiest kana get emptied first. */
function pickBlanks(deck, count) {
  const pool = deck.slice();
  const chosen = [];
  while (chosen.length < count && pool.length) {
    const total = pool.reduce((sum, card) => sum + weightOf(card), 0);
    let ticket = Math.random() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i += 1) {
      ticket -= weightOf(pool[i]);
      if (ticket <= 0) {
        index = i;
        break;
      }
    }
    chosen.push(pool.splice(index, 1)[0]);
  }
  return chosen;
}

function selectCell(cardId) {
  if (session.awaitingNext || session.done.has(cardId)) return;
  const card = ALL_CARDS.find((item) => item.id === cardId);
  session.current = card;
  for (const [id, cell] of session.cells) cell.classList.remove('is-active');
  const active = session.cells.get(cardId);
  if (active) active.classList.add('is-active');
  el.chartHint.textContent = `Trace « ${active ? active.textContent : card.romaji} »`;
  clearPad();
  el.padModel.hidden = true;
  el.feedback.textContent = '';
  el.feedback.className = 'feedback';
  el.kbdHint.textContent = 'Entrée pour valider · Retour arrière pour annuler un trait';
}

/** Fills the cell in, right or wrong: seeing the kana in place is the point. */
function markChartCell(card, isCorrect) {
  const cell = session.cells.get(card.id);
  session.done.add(card.id);
  if (!cell) return;
  cell.classList.remove('is-active', 'is-blank');
  cell.classList.add(isCorrect ? 'is-ok' : 'is-ko');
  cell.textContent = card.char;
  cell.disabled = true;
}

const pad = { strokes: [], drawing: false, ctx: null, size: 280 };

function resizePad() {
  const canvas = el.pad;
  const size = canvas.clientWidth || 280;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  pad.ctx = ctx;
  pad.size = size;
  redrawPad();
}

function redrawPad() {
  const ctx = pad.ctx;
  if (!ctx) return;
  const size = pad.size;
  const styles = getComputedStyle(document.body);
  ctx.clearRect(0, 0, size, size);

  ctx.save();
  ctx.strokeStyle = styles.getPropertyValue('--border').trim() || '#ddd';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(size / 2, 8);
  ctx.lineTo(size / 2, size - 8);
  ctx.moveTo(8, size / 2);
  ctx.lineTo(size - 8, size / 2);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = styles.getPropertyValue('--text').trim() || '#333';
  ctx.lineWidth = 7;
  for (const stroke of pad.strokes) {
    if (stroke.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke[0].x, stroke[0].y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (const point of stroke.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }
  el.padPlaceholder.hidden = pad.strokes.length > 0;
}

function clearPad() {
  pad.strokes = [];
  pad.drawing = false;
  redrawPad();
}

function padPoint(event) {
  const rect = el.pad.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function bindPad() {
  el.pad.addEventListener('pointerdown', (event) => {
    if (!session || session.awaitingNext) return;
    event.preventDefault();
    el.pad.setPointerCapture(event.pointerId);
    pad.drawing = true;
    pad.strokes.push([padPoint(event)]);
    redrawPad();
  });

  el.pad.addEventListener('pointermove', (event) => {
    if (!pad.drawing) return;
    const stroke = pad.strokes[pad.strokes.length - 1];
    const point = padPoint(event);
    const previous = stroke[stroke.length - 1];
    if (Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5) return;
    stroke.push(point);
    // Incremental draw: repainting the whole pad on every move is wasteful.
    pad.ctx.beginPath();
    pad.ctx.moveTo(previous.x, previous.y);
    pad.ctx.lineTo(point.x, point.y);
    pad.ctx.stroke();
  });

  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    el.pad.addEventListener(type, () => {
      pad.drawing = false;
    });
  }

  el.padUndo.addEventListener('click', () => {
    if (session && session.awaitingNext) return;
    pad.strokes.pop();
    redrawPad();
  });
  el.padClear.addEventListener('click', () => {
    if (session && session.awaitingNext) return;
    clearPad();
  });
  el.padCheck.addEventListener('click', () => submitWriting());
  window.addEventListener('resize', () => {
    if (session && session.mode === 'writing' && !el.quiz.hidden) resizePad();
  });
}

function submitWriting() {
  if (session.awaitingNext) {
    nextQuestion();
    return;
  }
  if (!pad.strokes.length) {
    el.kbdHint.textContent = 'Trace le kana avant de valider';
    return;
  }

  const card = session.current;
  const shape = Recognizer.shapeFromStrokes(pad.strokes);
  const ranked = Recognizer.rank(shape, session.writingTemplates[card.script]);
  const position = ranked.findIndex((entry) => entry.key === card.char);
  const isCorrect = position >= 0 && position < WRITING_TOLERANCE;

  const readingOf = (char) => {
    const match = ALL_CARDS.find((other) => other.char === char);
    return match ? match.romaji : '?';
  };

  let message;
  if (position === 0) message = '✓ Reconnu du premier coup';
  else if (isCorrect)
    message = `✓ Accepté — mais ton tracé passe d’abord pour ${ranked[0].key} (${readingOf(ranked[0].key)})`;
  else message = `✗ On dirait plutôt ${ranked[0].key} (${readingOf(ranked[0].key)})`;

  el.padModelKana.textContent = card.char;
  el.padModel.hidden = false;
  if (session.mode === 'chart') markChartCell(card, isCorrect);
  resolveAnswer(isCorrect, message);
}

// -------------------------------------------------------------- setup screen

/** The row spelled out in the syllabary currently selected. */
function rowGlyphs(row) {
  const index = store.settings.scripts.includes('hiragana') ? 0 : 1;
  return row.kana.map((entry) => entry[index]).join('');
}

/** One-click decks, so you rarely have to touch the 26 chips. */
const PRESETS = {
  starter: { scripts: ['hiragana'], families: ['base'] },
  hiragana: { scripts: ['hiragana'], families: ['base', 'dakuten', 'yoon'] },
  katakana: { scripts: ['katakana'], families: ['base', 'dakuten', 'yoon'] },
  all: { scripts: ['hiragana', 'katakana'], families: ['base', 'dakuten', 'yoon'] },
};

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  store.settings.scripts = [...preset.scripts];
  store.settings.rows = KANA_ROWS.filter((row) => preset.families.includes(row.family)).map(
    (row) => row.id,
  );
  saveStore();
  renderSetup();
}

function renderFamilies() {
  el.familyPicker.innerHTML = '';
  for (const family of FAMILIES) {
    const rows = KANA_ROWS.filter((row) => row.family === family.id);
    const block = document.createElement('div');
    block.className = 'family';

    const head = document.createElement('div');
    head.className = 'family-head';
    head.innerHTML = `<strong>${family.label}</strong><span>${family.hint}</span>`;

    const toggleAll = document.createElement('button');
    toggleAll.type = 'button';
    toggleAll.className = 'link-btn';
    toggleAll.textContent = 'Tout';
    toggleAll.addEventListener('click', () => {
      const ids = rows.map((row) => row.id);
      const allOn = ids.every((id) => store.settings.rows.includes(id));
      store.settings.rows = allOn
        ? store.settings.rows.filter((id) => !ids.includes(id))
        : Array.from(new Set([...store.settings.rows, ...ids]));
      saveStore();
      renderSetup();
    });
    head.appendChild(toggleAll);

    const list = document.createElement('div');
    list.className = 'rows';
    for (const row of rows) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'row-chip';
      chip.dataset.row = row.id;
      // The kana themselves read faster than their romaji; the label stays as
      // the tooltip. Text is refreshed by renderSetup when the script changes.
      chip.title = row.label;
      chip.textContent = rowGlyphs(row);
      chip.addEventListener('click', () => {
        const selected = store.settings.rows;
        store.settings.rows = selected.includes(row.id)
          ? selected.filter((id) => id !== row.id)
          : [...selected, row.id];
        saveStore();
        renderSetup();
      });
      list.appendChild(chip);
    }

    block.append(head, list);
    el.familyPicker.appendChild(block);
  }
}

/** Plain-French recap of what pressing "Commencer" will actually do. */
const MODE_SUMMARY = {
  'kana-romaji': 'tu choisis la bonne lecture',
  'romaji-kana': 'tu retrouves le bon kana',
  typing: 'tu tapes la lecture au clavier',
  writing: 'tu traces le kana',
  chart: 'tu remplis la grille au tracé',
};

const MODE_HOWTO = {
  'kana-romaji': 'Clique la bonne lecture — ou tape 1 à 4.',
  'romaji-kana': 'Clique le bon kana — ou tape 1 à 4.',
  typing: 'Tape la lecture, puis Entrée.',
  writing: 'Trace le kana au doigt ou à la souris, puis Valider.',
  chart: 'Clique une case rose, trace le kana dans la zone de tracé, puis Valider.',
};

function describeScripts() {
  const { scripts } = store.settings;
  if (scripts.length === 2) return 'hiragana et katakana';
  if (scripts.length === 1) return scripts[0];
  return 'aucun syllabaire';
}

function describeSeries() {
  const selected = KANA_ROWS.filter((row) => store.settings.rows.includes(row.id));
  if (!selected.length) return 'aucune série';
  if (selected.length === KANA_ROWS.length) return 'toutes les séries';
  const base = KANA_ROWS.filter((row) => row.family === 'base');
  if (selected.length === base.length && selected.every((row) => row.family === 'base')) {
    return 'les 46 de base';
  }
  return `${selected.length} rangées`;
}

function renderHero(usable) {
  const { mode, length } = store.settings;
  const unit = mode === 'chart' ? 'cases à remplir' : 'questions';
  const count = Math.min(length || usable.length, usable.length);
  const size = length ? `${count} ${unit}` : `sans fin (${usable.length} ${unit})`;
  el.heroSummary.textContent = usable.length
    ? `${size} · ${describeScripts()}, ${describeSeries()} · ${MODE_SUMMARY[mode]}`
    : 'Choisis au moins un syllabaire et une série ci-dessous.';
}

function renderSetup() {
  el.scriptPicker.querySelectorAll('.pill').forEach((pill) => {
    pill.setAttribute(
      'aria-pressed',
      String(store.settings.scripts.includes(pill.dataset.script)),
    );
  });
  el.familyPicker.querySelectorAll('.row-chip').forEach((chip) => {
    chip.setAttribute('aria-pressed', String(store.settings.rows.includes(chip.dataset.row)));
    const row = KANA_ROWS.find((item) => item.id === chip.dataset.row);
    if (row) chip.textContent = rowGlyphs(row);
  });
  el.modePicker.querySelectorAll('.mode').forEach((mode) => {
    mode.setAttribute('aria-pressed', String(store.settings.mode === mode.dataset.mode));
  });
  el.lengthPicker.querySelectorAll('.pill').forEach((pill) => {
    pill.setAttribute(
      'aria-pressed',
      String(store.settings.length === Number(pill.dataset.length)),
    );
  });

  const deck = currentDeck();
  const writable = writableCards(deck);
  const isChart = store.settings.mode === 'chart';
  const isWriting = store.settings.mode === 'writing' || isChart;
  const usable = isWriting ? writable : deck;

  el.deckInfo.textContent = deck.length
    ? `${usable.length} carte${usable.length > 1 ? 's' : ''} dans le paquet`
    : 'Choisis au moins un syllabaire et une série.';
  el.startBtn.disabled = usable.length < 2;

  el.modeNote.hidden = !isWriting;
  if (isWriting) {
    const blanks = Math.min(store.settings.length || writable.length, writable.length);
    if (writable.length < 2) {
      el.modeNote.textContent =
        'Le tracé ne gère que les kana simples : les yōon (きゃ) s’écrivent en deux caractères. Sélectionne d’autres séries.';
    } else if (isChart) {
      el.modeNote.textContent = `La grille complète s’affiche, ${blanks} cases vidées — les plus fragiles d’abord. Les yōon restent visibles mais ne sont jamais à remplir : ils s’écrivent en deux caractères.`;
    } else {
      el.modeNote.textContent = `Tracé comparé aux ${writable.length} kana de ta sélection. Reconnaissance approximative : un tracé proche est accepté, avec le détail de ce qu’il évoque.`;
    }
  }

  renderHero(usable);
  renderMastery(deck);
  renderWeakList();
}

/** How solid a kana is, from your own answers. */
function masteryOf(card) {
  const { ok, ko } = statsFor(card);
  const attempts = ok + ko;
  if (!attempts) return { level: 'unseen', ok, attempts };
  const rate = ok / attempts;
  if (rate < 0.5) return { level: 'weak', ok, attempts };
  if (attempts < 3 || rate < 0.85) return { level: 'learning', ok, attempts };
  return { level: 'strong', ok, attempts };
}

/** One sugar grain per kana of the deck, coloured by how well you know it. */
function renderMastery(deck) {
  el.mastery.innerHTML = '';
  let strong = 0;
  for (const card of deck) {
    const { level, ok, attempts } = masteryOf(card);
    if (level === 'strong') strong += 1;
    const grain = document.createElement('span');
    grain.className = level === 'unseen' ? 'grain' : `grain is-${level}`;
    grain.textContent = card.char;
    grain.title = attempts
      ? `${card.char} · ${card.romaji} — ${ok}/${attempts}`
      : `${card.char} · ${card.romaji} — jamais vu`;
    el.mastery.appendChild(grain);
  }
  el.masteryCaption.textContent = deck.length
    ? `${strong} kana sur ${deck.length} bien en place.`
    : 'Un grain par kana : il se colore quand tu le maîtrises.';
}

function weakestCards(limit) {
  return ALL_CARDS.map((card) => ({ card, ...statsFor(card) }))
    .filter((entry) => entry.ok + entry.ko > 0 && entry.ko > 0)
    .map((entry) => ({ ...entry, rate: entry.ok / (entry.ok + entry.ko) }))
    .sort((a, b) => a.rate - b.rate || b.ko - a.ko)
    .slice(0, limit);
}

function renderWeakList() {
  const weak = weakestCards(6);
  el.weakBlock.hidden = weak.length === 0;
  el.weakList.innerHTML = '';
  for (const entry of weak) {
    el.weakList.appendChild(
      weakRow(entry.card, Math.round(entry.rate * 100), `${entry.ok}/${entry.ok + entry.ko}`),
    );
  }
}

function weakRow(card, pct, detail) {
  const li = document.createElement('li');
  li.innerHTML = `
    <span class="weak-kana">${card.char}</span>
    <span class="weak-romaji">${card.romaji}</span>
    <span class="weak-bar"><span style="width:${pct}%"></span></span>
    <span class="weak-pct">${detail}</span>`;
  return li;
}

// --------------------------------------------------------------------- quiz

function startSession(deckOverride) {
  let deck = deckOverride && deckOverride.length >= 2 ? deckOverride : currentDeck();
  const mode = store.settings.mode;

  // Handwriting is judged against the kana you selected — the same principle as
  // the multiple-choice distractors, which also come from your own deck.
  const drawn = mode === 'writing' || mode === 'chart';
  let writingTemplates = null;
  if (drawn) {
    deck = writableCards(deck);
    if (!handwritingAvailable(deck)) {
      renderSetup();
      return;
    }
    writingTemplates = buildWritingTemplates(deck);
  }

  if (deck.length < 2) return;

  session = {
    deck,
    writingTemplates,
    done: new Set(),
    blanks: [],
    cells: new Map(),
    mode,
    length: store.settings.length,
    answered: 0,
    ok: 0,
    ko: 0,
    streak: 0,
    bestStreak: 0,
    missed: new Map(),
    recentMisses: new Set(),
    lastCard: null,
    current: null,
    awaitingNext: false,
  };

  if (mode === 'chart') {
    // "Sans fin" means every drawable cell of the chart.
    session.blanks = pickBlanks(deck, store.settings.length || deck.length);
    session.length = session.blanks.length;
  }

  el.howto.textContent = MODE_HOWTO[mode] || '';
  showScreen('quiz');
  el.chartPanel.hidden = mode !== 'chart';
  // In chart mode the grid replaces the prompt card: the cell is the question.
  el.promptCard.hidden = mode === 'chart';
  // Chart mode needs room: the page widens and the pad moves beside the grid.
  el.app.className = mode === 'chart' ? 'app is-wide' : 'app';
  el.quiz.className = mode === 'chart' ? 'screen is-chart' : 'screen';
  el.chartHint.hidden = mode !== 'chart';
  el.writingPanel.className = mode === 'chart' ? 'writing is-chart' : 'writing';
  if (mode === 'chart') {
    el.choices.hidden = true;
    el.typingForm.hidden = true;
    renderChart();
  }
  // The canvas has no measurable width until its screen is visible.
  if (drawn) {
    el.writingPanel.hidden = false;
    resizePad();
  }
  nextQuestion();
}

function nextQuestion() {
  if (session.mode === 'chart') {
    const next = session.blanks.find((card) => !session.done.has(card.id));
    if (!next) {
      endSession();
      return;
    }
    session.awaitingNext = false;
    el.promptCard.classList.remove('is-ok', 'is-ko');
    updateCounters();
    selectCell(next.id);
    return;
  }

  if (session.length && session.answered >= session.length) {
    endSession();
    return;
  }

  const isRomajiPrompt = session.mode === 'romaji-kana';
  // A romaji prompt must map to a single kana — ぢ/づ share theirs with じ/ず.
  const pool = isRomajiPrompt
    ? session.deck.filter((card) => !card.ambiguous)
    : session.deck;
  const card = pickCard(pool.length >= 2 ? pool : session.deck);

  session.current = card;
  session.lastCard = card;
  session.awaitingNext = false;

  el.promptCard.classList.remove('is-ok', 'is-ko');
  el.feedback.textContent = '';
  el.feedback.className = 'feedback';
  el.promptHint.textContent = '';
  updateCounters();

  if (session.mode === 'writing') {
    const bothScripts = store.settings.scripts.length > 1;
    el.promptLabel.textContent = bothScripts ? `Écris ce ${card.script}` : 'Écris ce kana';
    el.prompt.textContent = card.romaji;
    el.prompt.className = 'prompt romaji';
    el.choices.hidden = true;
    el.choices.innerHTML = '';
    el.typingForm.hidden = true;
    el.writingPanel.hidden = false;
    el.padModel.hidden = true;
    clearPad();
    el.kbdHint.textContent = 'Entrée pour valider · Retour arrière pour annuler un trait';
    return;
  }

  el.writingPanel.hidden = true;

  if (session.mode === 'typing') {
    el.promptLabel.textContent = 'Tape la lecture';
    el.prompt.textContent = card.char;
    el.prompt.className = 'prompt';
    el.choices.hidden = true;
    el.choices.innerHTML = '';
    el.typingForm.hidden = false;
    el.typingInput.value = '';
    el.typingInput.disabled = false;
    el.typingInput.focus();
    el.kbdHint.textContent = 'Entrée pour valider';
    return;
  }

  el.typingForm.hidden = true;
  el.choices.hidden = false;

  const valueOf = isRomajiPrompt ? (c) => c.char : (c) => c.romaji;
  const bothScripts = store.settings.scripts.length > 1;
  el.promptLabel.textContent = isRomajiPrompt
    ? bothScripts
      ? `Quel ${card.script} ?`
      : 'Quel kana ?'
    : 'Quelle est la lecture ?';
  el.prompt.textContent = isRomajiPrompt ? card.romaji : card.char;
  el.prompt.className = isRomajiPrompt ? 'prompt romaji' : 'prompt';

  // A romaji reads the same in both syllabaries: keep every option in the
  // script being asked, otherwise half the choices are eliminable on sight.
  const optionPool =
    isRomajiPrompt && bothScripts
      ? session.deck.filter((other) => other.script === card.script)
      : session.deck;
  const options = shuffle([
    card,
    ...pickDistractors(card, optionPool.length >= CHOICE_COUNT ? optionPool : session.deck, valueOf),
  ]);
  el.choices.innerHTML = '';
  options.forEach((option, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.dataset.value = valueOf(option);
    button.innerHTML = `<span class="num">${index + 1}</span>${valueOf(option)}`;
    button.addEventListener('click', () => submitChoice(button));
    el.choices.appendChild(button);
  });
  el.kbdHint.textContent = 'Touches 1 à 4 pour répondre';
}

function submitChoice(button) {
  if (session.awaitingNext) return;
  const card = session.current;
  const expected = session.mode === 'romaji-kana' ? card.char : card.romaji;
  const isCorrect = button.dataset.value === expected;

  el.choices.querySelectorAll('.choice').forEach((choice) => {
    choice.disabled = true;
    if (choice.dataset.value === expected) choice.classList.add('is-ok');
    else if (choice === button) choice.classList.add('is-ko');
    else choice.classList.add('is-dim');
  });

  resolveAnswer(isCorrect);
}

function submitTyping() {
  if (session.awaitingNext) {
    nextQuestion();
    return;
  }
  const value = normalize(el.typingInput.value);
  if (!value) return;
  const isCorrect = acceptedAnswers(session.current).includes(value);
  el.typingInput.disabled = true;
  resolveAnswer(isCorrect);
}

function resolveAnswer(isCorrect, message) {
  const card = session.current;
  recordAnswer(card, isCorrect);
  session.answered += 1;

  if (isCorrect) {
    session.ok += 1;
    session.streak += 1;
    session.bestStreak = Math.max(session.bestStreak, session.streak);
    session.recentMisses.delete(card.id);
    el.promptCard.classList.add('is-ok');
    sugarBurst();
    el.feedback.className = 'feedback ok';
    el.feedback.textContent = message || pickPraise(session.streak);
    el.kbdHint.textContent = '';
  } else {
    session.ko += 1;
    session.streak = 0;
    session.recentMisses.add(card.id);
    session.missed.set(card.id, (session.missed.get(card.id) || 0) + 1);
    el.promptCard.classList.add('is-ko');
    el.feedback.className = 'feedback ko';
    el.feedback.textContent = message || `${card.char} se lit « ${card.romaji} »`;
    el.kbdHint.textContent = 'Entrée ou Espace pour continuer';
  }

  updateCounters();
  session.awaitingNext = true;

  // In writing mode you need a moment to compare your strokes with the model,
  // so nothing moves on until you ask for it.
  if (session.mode === 'writing' || session.mode === 'chart') {
    el.kbdHint.textContent = 'Entrée ou Espace pour continuer';
    return;
  }

  if (isCorrect) {
    // Guard on the question index so a stale timer can never skip a question
    // the player already moved past with the keyboard.
    const tick = session.answered;
    window.setTimeout(() => {
      if (session && session.awaitingNext && session.answered === tick) nextQuestion();
    }, 650);
  }
}

/** A handful of sugar grains flying out of the card on a right answer. */
function sugarBurst() {
  const colors = [
    'var(--accent)',
    'var(--candy-mint)',
    'var(--candy-lemon)',
    'var(--candy-lilac)',
    'var(--candy-light)',
  ];
  el.burst.innerHTML = '';
  for (let i = 0; i < 8; i += 1) {
    const grain = document.createElement('span');
    grain.className = `grain-pop pop-${i}`;
    grain.style.background = colors[i % colors.length];
    grain.style.animationDelay = `${i * 18}ms`;
    el.burst.appendChild(grain);
  }
  window.setTimeout(() => {
    el.burst.innerHTML = '';
  }, 900);
}

function pickPraise(streak) {
  if (streak >= 15) return `✓ Imparable — ${streak} d'affilée 🍡`;
  if (streak >= 8) return `✓ En feu — ${streak} d'affilée 🔥`;
  if (streak >= 4) return `✓ Bien vu — ${streak} d'affilée`;
  return '✓ Correct';
}

function updateCounters() {
  el.scoreOk.textContent = session.ok;
  el.scoreKo.textContent = session.ko;
  el.scoreStreak.textContent = session.streak;
  el.streakChip.classList.remove('is-hot');
  // Re-adding on the next tick is what replays the pop animation.
  if (session.streak >= 3) window.setTimeout(() => el.streakChip.classList.add('is-hot'), 0);
  el.progress.hidden = !session.length;
  if (session.length) {
    el.progressFill.style.width = `${(session.answered / session.length) * 100}%`;
  }
}

// ---------------------------------------------------------------- end screen

function endSession() {
  const total = session.answered;
  const pct = total ? Math.round((session.ok / total) * 100) : 0;

  el.resultPct.textContent = pct;
  el.resultEmoji.textContent = pct >= 90 ? '🏆' : pct >= 70 ? '🍡' : pct >= 50 ? '🌱' : '💪';
  el.resultTitle.textContent =
    pct >= 90 ? 'Presque parfait !' : pct >= 70 ? 'Bien joué !' : 'Encore un tour ?';
  el.resultDetail.textContent = `${session.ok} bonne${session.ok > 1 ? 's' : ''} réponse${
    session.ok > 1 ? 's' : ''
  } sur ${total} · meilleure série : ${session.bestStreak}`;

  const missedCards = [...session.missed.entries()]
    .map(([id, count]) => ({ card: ALL_CARDS.find((c) => c.id === id), count }))
    .filter((entry) => entry.card)
    .sort((a, b) => b.count - a.count);

  el.missedCard.hidden = missedCards.length === 0;
  el.missedList.innerHTML = '';
  for (const { card, count } of missedCards) {
    const rate = statsFor(card);
    const attempts = rate.ok + rate.ko;
    el.missedList.appendChild(
      weakRow(
        card,
        attempts ? Math.round((rate.ok / attempts) * 100) : 0,
        `${count} erreur${count > 1 ? 's' : ''}`,
      ),
    );
  }

  el.reviewBtn.hidden = missedCards.length < 2;
  el.reviewBtn.dataset.ids = missedCards.map(({ card }) => card.id).join(',');

  showScreen('end');
  renderWeakList();
}

// ------------------------------------------------------------------ plumbing

function showScreen(name) {
  if (name !== 'quiz') {
    el.app.className = 'app';
    el.quiz.className = 'screen';
  }
  el.setup.hidden = name !== 'setup';
  el.quiz.hidden = name !== 'quiz';
  el.end.hidden = name !== 'end';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function onKeyDown(event) {
  if (el.quiz.hidden || !session) return;
  // The kanji tab hides the whole kana view, quiz included: its keys are not ours.
  if (document.getElementById('kana-view').hidden) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (session.awaitingNext && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    nextQuestion();
    return;
  }

  if (session.mode === 'writing' || session.mode === 'chart') {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitWriting();
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      pad.strokes.pop();
      redrawPad();
    }
    return;
  }

  if (session.mode === 'typing' || session.awaitingNext) return;

  const index = Number(event.key) - 1;
  if (Number.isInteger(index) && index >= 0 && index < CHOICE_COUNT) {
    const button = el.choices.querySelectorAll('.choice')[index];
    if (button) {
      event.preventDefault();
      submitChoice(button);
    }
  }
}

function bind() {
  Object.assign(el, {
    setup: document.getElementById('screen-setup'),
    quiz: document.getElementById('screen-quiz'),
    end: document.getElementById('screen-end'),
    scriptPicker: document.getElementById('script-picker'),
    familyPicker: document.getElementById('family-picker'),
    modePicker: document.getElementById('mode-picker'),
    lengthPicker: document.getElementById('length-picker'),
    deckInfo: document.getElementById('deck-info'),
    heroSummary: document.getElementById('hero-summary'),
    howto: document.getElementById('quiz-howto'),
    modeNote: document.getElementById('mode-note'),
    writingPanel: document.getElementById('writing-panel'),
    app: document.getElementById('app'),
    chartPanel: document.getElementById('chart-panel'),
    chart: document.getElementById('chart'),
    chartHint: document.getElementById('chart-hint'),
    pad: document.getElementById('pad'),
    padPlaceholder: document.getElementById('pad-placeholder'),
    padUndo: document.getElementById('pad-undo'),
    padClear: document.getElementById('pad-clear'),
    padCheck: document.getElementById('pad-check'),
    padModel: document.getElementById('pad-model'),
    padModelKana: document.getElementById('pad-model-kana'),
    startBtn: document.getElementById('start-btn'),
    presets: document.getElementById('presets'),
    weakCard: document.getElementById('weak-card'),
    weakBlock: document.getElementById('weak-block'),
    weakList: document.getElementById('weak-list'),
    mastery: document.getElementById('mastery'),
    masteryCaption: document.getElementById('mastery-caption'),
    burst: document.getElementById('burst'),
    streakChip: document.getElementById('streak-chip'),
    resetStats: document.getElementById('reset-stats'),
    quitBtn: document.getElementById('quit-btn'),
    scoreOk: document.getElementById('score-ok'),
    scoreKo: document.getElementById('score-ko'),
    scoreStreak: document.getElementById('score-streak'),
    progress: document.getElementById('progress'),
    progressFill: document.getElementById('progress-fill'),
    promptCard: document.getElementById('prompt-card'),
    promptLabel: document.getElementById('prompt-label'),
    prompt: document.getElementById('prompt'),
    promptHint: document.getElementById('prompt-hint'),
    choices: document.getElementById('choices'),
    typingForm: document.getElementById('typing-form'),
    typingInput: document.getElementById('typing-input'),
    feedback: document.getElementById('feedback'),
    kbdHint: document.getElementById('kbd-hint'),
    resultEmoji: document.getElementById('result-emoji'),
    resultTitle: document.getElementById('result-title'),
    resultPct: document.getElementById('result-pct'),
    resultDetail: document.getElementById('result-detail'),
    missedCard: document.getElementById('missed-card'),
    missedList: document.getElementById('missed-list'),
    againBtn: document.getElementById('again-btn'),
    reviewBtn: document.getElementById('review-btn'),
    backBtn: document.getElementById('back-btn'),
  });

  el.scriptPicker.addEventListener('click', (event) => {
    const pill = event.target.closest('.pill');
    if (!pill) return;
    const script = pill.dataset.script;
    const selected = store.settings.scripts;
    store.settings.scripts = selected.includes(script)
      ? selected.filter((item) => item !== script)
      : [...selected, script];
    saveStore();
    renderSetup();
  });

  el.presets.addEventListener('click', (event) => {
    const preset = event.target.closest('.preset');
    if (preset) applyPreset(preset.dataset.preset);
  });

  el.modePicker.addEventListener('click', (event) => {
    const mode = event.target.closest('.mode');
    if (!mode) return;
    store.settings.mode = mode.dataset.mode;
    saveStore();
    renderSetup();
  });

  el.lengthPicker.addEventListener('click', (event) => {
    const pill = event.target.closest('.pill');
    if (!pill) return;
    store.settings.length = Number(pill.dataset.length);
    saveStore();
    renderSetup();
  });

  el.startBtn.addEventListener('click', () => startSession());
  el.againBtn.addEventListener('click', () => startSession());
  el.backBtn.addEventListener('click', () => {
    session = null;
    showScreen('setup');
    renderSetup();
  });
  el.quitBtn.addEventListener('click', () => {
    session = null;
    showScreen('setup');
    renderSetup();
  });

  el.reviewBtn.addEventListener('click', () => {
    const ids = (el.reviewBtn.dataset.ids || '').split(',').filter(Boolean);
    startSession(ALL_CARDS.filter((card) => ids.includes(card.id)));
  });

  el.resetStats.addEventListener('click', () => {
    if (!window.confirm('Effacer toutes tes statistiques ?')) return;
    store.stats = {};
    saveStore();
    renderSetup();
  });

  el.typingForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitTyping();
  });

  bindPad();
  document.addEventListener('keydown', onKeyDown);
}

bind();
renderFamilies();
renderSetup();

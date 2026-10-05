/**
 * Romaji → hiragana, for answers typed on a Latin keyboard.
 *
 * Accepts both Hepburn and Kunrei spellings (shi / si, tsu / tu, ji / zi…),
 * doubled consonants for っ (kitte → きって) and `nn` or `n'` for ん. Anything
 * already in kana goes through untouched — katakana are folded to hiragana —
 * so a Japanese IME works too.
 */
const ROMAJI_TABLE = (() => {
  const table = {
    a: 'あ',
    i: 'い',
    u: 'う',
    e: 'え',
    o: 'お',
    ya: 'や',
    yu: 'ゆ',
    yo: 'よ',
    wa: 'わ',
    wo: 'を',
    shi: 'し',
    si: 'し',
    chi: 'ち',
    ti: 'ち',
    tsu: 'つ',
    tu: 'つ',
    fu: 'ふ',
    hu: 'ふ',
    ji: 'じ',
    zi: 'じ',
    di: 'ぢ',
    du: 'づ',
    sha: 'しゃ',
    shu: 'しゅ',
    sho: 'しょ',
    she: 'しぇ',
    cha: 'ちゃ',
    chu: 'ちゅ',
    cho: 'ちょ',
    che: 'ちぇ',
    ja: 'じゃ',
    ju: 'じゅ',
    jo: 'じょ',
    je: 'じぇ',
    '-': 'ー',
  };
  const rows = {
    k: 'かきくけこ',
    s: 'さしすせそ',
    t: 'たちつてと',
    n: 'なにぬねの',
    h: 'はひふへほ',
    m: 'まみむめも',
    r: 'らりるれろ',
    g: 'がぎぐげご',
    z: 'ざじずぜぞ',
    d: 'だぢづでど',
    b: 'ばびぶべぼ',
    p: 'ぱぴぷぺぽ',
  };
  Object.entries(rows).forEach(([consonant, kana]) => {
    [...'aiueo'].forEach((vowel, index) => {
      if (!table[consonant + vowel]) table[consonant + vowel] = kana[index];
    });
    // kya, sya, nya… : the i-column kana plus a small ya / yu / yo.
    const iKana = kana[1];
    ['a', 'u', 'o'].forEach((vowel, index) => {
      const key = `${consonant}y${vowel}`;
      if (!table[key]) table[key] = iKana + 'ゃゅょ'[index];
    });
  });
  table.cya = 'ちゃ';
  table.cyu = 'ちゅ';
  table.cyo = 'ちょ';
  return table;
})();

const VOWELS = 'aiueo';

function toKana(input) {
  const text = String(input)
    .toLowerCase()
    .replace(/\s+/g, '')
    // Katakana → hiragana: same layout, 0x60 code points apart.
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === 'n') {
      if (next === "'") {
        out += 'ん';
        i += 2;
        continue;
      }
      // konnichiwa, onna: before a vowel, the second n starts the next kana.
      if (next === 'n') {
        const after = text[i + 2];
        out += 'ん';
        i += after !== undefined && (VOWELS.includes(after) || after === 'y') ? 1 : 2;
        continue;
      }
      if (next === undefined || (!VOWELS.includes(next) && next !== 'y')) {
        out += 'ん';
        i += 1;
        continue;
      }
    }
    // kitte, zasshi, matcha : a doubled consonant is a small っ.
    if (/[a-z]/.test(ch) && !VOWELS.includes(ch) && (next === ch || (ch === 't' && next === 'c'))) {
      out += 'っ';
      i += 1;
      continue;
    }
    const match = [3, 2, 1].map((len) => text.slice(i, i + len)).find((key) => ROMAJI_TABLE[key]);
    if (match) {
      out += ROMAJI_TABLE[match];
      i += match.length;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** ぢ/じ and づ/ず sound the same: nobody should lose a point over them. */
function sameReading(typed, expected) {
  const fold = (text) => toKana(text).replace(/ぢ/g, 'じ').replace(/づ/g, 'ず');
  return fold(typed) !== '' && fold(typed) === fold(expected);
}

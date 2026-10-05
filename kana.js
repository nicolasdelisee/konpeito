/**
 * Kana dataset.
 *
 * Each row holds the hiragana / katakana pair for the same sound, so the data
 * is written once and both syllabaries are derived from it.
 *
 * Tuple format: [hiragana, katakana, romaji]
 * `ambiguous: true` marks a romaji shared by two kana (ぢ/じ, づ/ず): those
 * cards are never used as a prompt in the "romaji → kana" mode.
 */
const KANA_ROWS = [
  // ---------------------------------------------------------------- gojūon
  {
    id: 'a',
    family: 'base',
    label: 'a i u e o',
    kana: [
      ['あ', 'ア', 'a'],
      ['い', 'イ', 'i'],
      ['う', 'ウ', 'u'],
      ['え', 'エ', 'e'],
      ['お', 'オ', 'o'],
    ],
  },
  {
    id: 'ka',
    family: 'base',
    label: 'ka ki ku ke ko',
    kana: [
      ['か', 'カ', 'ka'],
      ['き', 'キ', 'ki'],
      ['く', 'ク', 'ku'],
      ['け', 'ケ', 'ke'],
      ['こ', 'コ', 'ko'],
    ],
  },
  {
    id: 'sa',
    family: 'base',
    label: 'sa shi su se so',
    kana: [
      ['さ', 'サ', 'sa'],
      ['し', 'シ', 'shi'],
      ['す', 'ス', 'su'],
      ['せ', 'セ', 'se'],
      ['そ', 'ソ', 'so'],
    ],
  },
  {
    id: 'ta',
    family: 'base',
    label: 'ta chi tsu te to',
    kana: [
      ['た', 'タ', 'ta'],
      ['ち', 'チ', 'chi'],
      ['つ', 'ツ', 'tsu'],
      ['て', 'テ', 'te'],
      ['と', 'ト', 'to'],
    ],
  },
  {
    id: 'na',
    family: 'base',
    label: 'na ni nu ne no',
    kana: [
      ['な', 'ナ', 'na'],
      ['に', 'ニ', 'ni'],
      ['ぬ', 'ヌ', 'nu'],
      ['ね', 'ネ', 'ne'],
      ['の', 'ノ', 'no'],
    ],
  },
  {
    id: 'ha',
    family: 'base',
    label: 'ha hi fu he ho',
    kana: [
      ['は', 'ハ', 'ha'],
      ['ひ', 'ヒ', 'hi'],
      ['ふ', 'フ', 'fu'],
      ['へ', 'ヘ', 'he'],
      ['ほ', 'ホ', 'ho'],
    ],
  },
  {
    id: 'ma',
    family: 'base',
    label: 'ma mi mu me mo',
    kana: [
      ['ま', 'マ', 'ma'],
      ['み', 'ミ', 'mi'],
      ['む', 'ム', 'mu'],
      ['め', 'メ', 'me'],
      ['も', 'モ', 'mo'],
    ],
  },
  {
    id: 'ya',
    family: 'base',
    label: 'ya yu yo',
    kana: [
      ['や', 'ヤ', 'ya'],
      ['ゆ', 'ユ', 'yu'],
      ['よ', 'ヨ', 'yo'],
    ],
  },
  {
    id: 'ra',
    family: 'base',
    label: 'ra ri ru re ro',
    kana: [
      ['ら', 'ラ', 'ra'],
      ['り', 'リ', 'ri'],
      ['る', 'ル', 'ru'],
      ['れ', 'レ', 're'],
      ['ろ', 'ロ', 'ro'],
    ],
  },
  {
    id: 'wa',
    family: 'base',
    label: 'wa wo n',
    kana: [
      ['わ', 'ワ', 'wa'],
      ['を', 'ヲ', 'wo'],
      ['ん', 'ン', 'n'],
    ],
  },

  // --------------------------------------------------------------- dakuten
  {
    id: 'ga',
    family: 'dakuten',
    label: 'ga gi gu ge go',
    kana: [
      ['が', 'ガ', 'ga'],
      ['ぎ', 'ギ', 'gi'],
      ['ぐ', 'グ', 'gu'],
      ['げ', 'ゲ', 'ge'],
      ['ご', 'ゴ', 'go'],
    ],
  },
  {
    id: 'za',
    family: 'dakuten',
    label: 'za ji zu ze zo',
    kana: [
      ['ざ', 'ザ', 'za'],
      ['じ', 'ジ', 'ji'],
      ['ず', 'ズ', 'zu'],
      ['ぜ', 'ゼ', 'ze'],
      ['ぞ', 'ゾ', 'zo'],
    ],
  },
  {
    id: 'da',
    family: 'dakuten',
    label: 'da ji zu de do',
    kana: [
      ['だ', 'ダ', 'da'],
      ['ぢ', 'ヂ', 'ji', { ambiguous: true }],
      ['づ', 'ヅ', 'zu', { ambiguous: true }],
      ['で', 'デ', 'de'],
      ['ど', 'ド', 'do'],
    ],
  },
  {
    id: 'ba',
    family: 'dakuten',
    label: 'ba bi bu be bo',
    kana: [
      ['ば', 'バ', 'ba'],
      ['び', 'ビ', 'bi'],
      ['ぶ', 'ブ', 'bu'],
      ['べ', 'ベ', 'be'],
      ['ぼ', 'ボ', 'bo'],
    ],
  },
  {
    id: 'pa',
    family: 'dakuten',
    label: 'pa pi pu pe po',
    kana: [
      ['ぱ', 'パ', 'pa'],
      ['ぴ', 'ピ', 'pi'],
      ['ぷ', 'プ', 'pu'],
      ['ぺ', 'ペ', 'pe'],
      ['ぽ', 'ポ', 'po'],
    ],
  },

  // ------------------------------------------------------------------ yōon
  {
    id: 'kya',
    family: 'yoon',
    label: 'kya kyu kyo',
    kana: [
      ['きゃ', 'キャ', 'kya'],
      ['きゅ', 'キュ', 'kyu'],
      ['きょ', 'キョ', 'kyo'],
    ],
  },
  {
    id: 'sha',
    family: 'yoon',
    label: 'sha shu sho',
    kana: [
      ['しゃ', 'シャ', 'sha'],
      ['しゅ', 'シュ', 'shu'],
      ['しょ', 'ショ', 'sho'],
    ],
  },
  {
    id: 'cha',
    family: 'yoon',
    label: 'cha chu cho',
    kana: [
      ['ちゃ', 'チャ', 'cha'],
      ['ちゅ', 'チュ', 'chu'],
      ['ちょ', 'チョ', 'cho'],
    ],
  },
  {
    id: 'nya',
    family: 'yoon',
    label: 'nya nyu nyo',
    kana: [
      ['にゃ', 'ニャ', 'nya'],
      ['にゅ', 'ニュ', 'nyu'],
      ['にょ', 'ニョ', 'nyo'],
    ],
  },
  {
    id: 'hya',
    family: 'yoon',
    label: 'hya hyu hyo',
    kana: [
      ['ひゃ', 'ヒャ', 'hya'],
      ['ひゅ', 'ヒュ', 'hyu'],
      ['ひょ', 'ヒョ', 'hyo'],
    ],
  },
  {
    id: 'mya',
    family: 'yoon',
    label: 'mya myu myo',
    kana: [
      ['みゃ', 'ミャ', 'mya'],
      ['みゅ', 'ミュ', 'myu'],
      ['みょ', 'ミョ', 'myo'],
    ],
  },
  {
    id: 'rya',
    family: 'yoon',
    label: 'rya ryu ryo',
    kana: [
      ['りゃ', 'リャ', 'rya'],
      ['りゅ', 'リュ', 'ryu'],
      ['りょ', 'リョ', 'ryo'],
    ],
  },
  {
    id: 'gya',
    family: 'yoon',
    label: 'gya gyu gyo',
    kana: [
      ['ぎゃ', 'ギャ', 'gya'],
      ['ぎゅ', 'ギュ', 'gyu'],
      ['ぎょ', 'ギョ', 'gyo'],
    ],
  },
  {
    id: 'ja',
    family: 'yoon',
    label: 'ja ju jo',
    kana: [
      ['じゃ', 'ジャ', 'ja'],
      ['じゅ', 'ジュ', 'ju'],
      ['じょ', 'ジョ', 'jo'],
    ],
  },
  {
    id: 'bya',
    family: 'yoon',
    label: 'bya byu byo',
    kana: [
      ['びゃ', 'ビャ', 'bya'],
      ['びゅ', 'ビュ', 'byu'],
      ['びょ', 'ビョ', 'byo'],
    ],
  },
  {
    id: 'pya',
    family: 'yoon',
    label: 'pya pyu pyo',
    kana: [
      ['ぴゃ', 'ピャ', 'pya'],
      ['ぴゅ', 'ピュ', 'pyu'],
      ['ぴょ', 'ピョ', 'pyo'],
    ],
  },
];

const FAMILIES = [
  { id: 'base', label: 'Gojūon — les 46 de base', hint: 'À apprendre en premier' },
  { id: 'dakuten', label: 'Dakuten & handakuten', hint: 'が ざ だ ば ぱ' },
  { id: 'yoon', label: 'Yōon — sons contractés', hint: 'きゃ しゅ ちょ…' },
];

/** Alternative romanisations accepted in "saisie libre" mode. */
const ROMAJI_ALIASES = {
  shi: ['si'],
  chi: ['ti'],
  tsu: ['tu'],
  fu: ['hu'],
  ji: ['zi', 'di', 'dzi'],
  zu: ['du', 'dzu'],
  sha: ['sya'],
  shu: ['syu'],
  sho: ['syo'],
  cha: ['tya'],
  chu: ['tyu'],
  cho: ['tyo'],
  ja: ['zya', 'jya'],
  ju: ['zyu', 'jyu'],
  jo: ['zyo', 'jyo'],
  n: ['nn'],
  wo: ['o'],
};

/** Flattens the rows into one card per kana and per script. */
function buildAllCards() {
  const cards = [];
  for (const row of KANA_ROWS) {
    row.kana.forEach(([hira, kata, romaji, opts], index) => {
      for (const [script, char] of [
        ['hiragana', hira],
        ['katakana', kata],
      ]) {
        cards.push({
          id: `${script}:${char}`,
          char,
          romaji,
          script,
          rowId: row.id,
          family: row.family,
          order: index,
          ambiguous: Boolean(opts && opts.ambiguous),
        });
      }
    });
  }
  return cards;
}

const ALL_CARDS = buildAllCards();

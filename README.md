# こんぺいとう · Konpeitō

Petit quiz pour apprendre les hiragana et les katakana, et fiches pour réviser
les kanji. Aucun build, aucune
dépendance : des fichiers statiques et c'est tout.

Le 金平糖 est un petit bonbon de sucre à facettes, qu'on grignote grain par
grain — c'est à peu près comme ça qu'on apprend les kana.

## Lancer

```bash
xdg-open index.html
```

Ça suffit — le site marche en `file://`. Pour une URL propre (ou pour tester
depuis le téléphone sur le même Wi-Fi) :

```bash
python3 -m http.server 8000   # puis http://localhost:8000
```

## Ce qu'il y a dedans

- **208 cartes** : les 46 kana de base, les 25 dakuten/handakuten et les 33 yōon,
  en hiragana comme en katakana.
- **Cinq modes** : kana → romaji (QCM), romaji → kana (QCM), saisie libre au
  clavier — qui accepte les romanisations alternatives (`si` pour し, `tu` pour つ,
  `sya` pour しゃ…) —, **écriture à main levée** à la souris ou au doigt, et
  **grille à compléter**.
- **Sélection fine** : quatre paquets d'un clic (les 46 de base, tout l'hiragana,
  tout le katakana, tout), ou rangée par rangée — les puces affichent les kana
  eux-mêmes, pas leur romaji.
- **Carte de progression** : un grain de sucre par kana, qui se colore à mesure
  que tu le maîtrises (jamais vu → fragile → en cours → acquis).
- **Répétition ciblée** : chaque kana raté revient plus souvent, et l'écran de
  réglages affiche tes six kana les moins sûrs. Tout est stocké dans le
  `localStorage` du navigateur.
- **Clavier** : touches `1` à `4` pour répondre, `Entrée` / `Espace` pour
  enchaîner, `Retour arrière` pour annuler un trait en mode écriture.

L'écran d'accueil s'ouvre sur une phrase qui résume la prochaine session — « 20
questions · hiragana, les 46 de base · tu choisis la bonne lecture » — et le
bouton pour la lancer. Les réglages viennent après, numérotés, chacun avec un
exemple concret de ce qu'il change. Pendant le quiz, une ligne rappelle en
permanence ce qu'on attend de toi.

## Kanji

L'onglet principal propose une fiche par kanji — les 99 du JLPT N5 pour
commencer, rangés par thème (nombres, jours, temps, gens…). Chaque fiche
donne le sens, le nombre de traits, les lectures ON et KUN, quelques mots
courants et deux phrases simples, plus les pièges à connaître (あの日 se lit
あのひ, 大人 se lit おとな…).

Tu marques les kanji que tu as appris, et tout le reste s'en déduit :

- **Furigana automatiques** : la lecture ne s'affiche que sur les kanji que tu
  n'as pas encore appris. Un mot dont tu connais tous les kanji reste nu — touche-le
  pour vérifier. Les modes « toujours » et « jamais » existent aussi.
- **Liens entre fiches** : chaque mot montre ses autres kanji, cliquables, et
  chaque fiche liste les mots d'autres fiches où le kanji revient.
- **Prochain kanji conseillé** : celui qui te rend lisibles le plus de nouveaux
  mots avec ce que tu sais déjà.

**Examens** : à 5, 10, 15… kanji appris, un examen reprend *tous* les kanji
appris jusque-là, dans l'ordre où tu les as appris. Trois questions par kanji
(40 au plus, les cinq derniers toujours inclus) :

- une **lecture à écrire**, en romaji ou en kana — `suichuu` devient すいちゅう
  pendant la frappe, les orthographes Hepburn et Kunrei passent toutes les deux,
  et le sens du mot est donné pour lever l'ambiguïté (金 : きん ou かね ?) ;
- deux questions en QCM parmi : sens du kanji, kanji à retrouver d'après son
  sens, sens d'un mot, sens d'une phrase.

Les mots demandés n'utilisent que des kanji de l'examen ; dans les phrases, les
autres gardent leurs furigana. Réussi à 80 %, et le meilleur score reste affiché.

**Niveaux JLPT** : chaque fiche porte son niveau (`n` dans `kanji.js`), et la
liste se filtre par niveau, les thèmes restant à l'intérieur. Le N5 est complet
(99 kanji) ; les niveaux suivants s'ajoutent fiche par fiche. Le JLPT ne publie
plus de liste officielle depuis 2010 : on suit les listes officieuses usuelles.

Les données sont dans `kanji.js`, écrites à la main ; `test-kanji.js` vérifie
que chaque kanji d'une phrase porte bien sa lecture.

## Grille à compléter

La grille gojūon complète s'affiche — colonnes = consonnes, lignes = voyelles,
comme les charts qu'on imprime. Quelques cases sont vidées et n'affichent que
leur lecture : tu cliques, tu traces le kana, la case se remplit.

L'intérêt par rapport aux autres modes est le **contexte** : voir あ か さ た な
alignés dans une colonne fait entrer le système (consonne × voyelle) bien mieux
qu'un tirage carte par carte.

Sur un écran large, la page s'élargit et la zone de tracé se place **à droite de
la grille**, collée au défilement : on ne fait jamais l'aller-retour entre la
case cliquée et l'endroit où l'on dessine. En dessous de 900 px tout s'empile, et
la grille défile horizontalement dans sa propre carte — 46 cases ne tiennent pas
sur un téléphone, mais la page, elle, ne part jamais de travers.

Le nombre de cases vidées suit le réglage « longueur de session », et elles sont
piochées en priorité parmi tes kana les plus fragiles. Une case ratée se remplit
quand même avec le bon kana, en rouge : c'est là qu'on apprend.

La grille se déduit entièrement des données : chaque rangée de `kana.js` devient
une *colonne*, et la voyelle est la dernière lettre du romaji. ん n'ayant pas de
voyelle, il atterrit dans la case libre du milieu de la colonne W — exactement là
où les charts imprimés le posent. Les yōon (きゃ) restent affichés en référence
mais ne sont jamais à remplir : ils s'écrivent en deux caractères, que le moteur
de reconnaissance ne gère pas.

## Reconnaissance d'écriture

Aucun modèle entraîné, aucun fichier de données : les formes de référence sont
générées au démarrage à partir de la police du système.

```
kana de référence  →  glyphe dessiné dans un <canvas>  →  amincissement  →  nuage de points
ton tracé          →  polylignes du pointeur           →  ré-échantillonnage → nuage de points
                                          ↓
                              distance de Chamfer symétrique
```

L'amincissement (Zhang-Suen) est la clé : un glyphe de police est une *surface
pleine*, alors qu'un tracé est une *ligne médiane*. Éroder le glyphe jusqu'à son
squelette rend les deux comparables.

Trois choix portent l'essentiel de la précision, tous mesurés :

- Les points sont gardés à **espacement constant**, pas en nombre constant. Un
  tracé au doigt donne ~480 points de squelette là où un glyphe en donne ~100, et
  le chamfer compare mal deux nuages de densités différentes.
- L'échelle vient de la **dispersion des points** (2σ), pas de la boîte
  englobante : un trait qui dépasse déplace une boîte, il ne bouge presque pas un
  écart-type.
- Le score ajoute à la moyenne **les 5 % de points les plus mal appariés**. La
  moyenne seule dilue les marques petites mais décisives : les dakuten pèsent 3
  points sur 35, donc les ignorer ne coûtait presque rien, et テ marquait comme デ.

**Ce que ça vaut.** Sur des tracés simulés (le squelette de référence déformé,
incliné, étiré et partiellement effacé) : **98 % au premier rang et 100 % dans
les trois premiers**, dans les deux syllabaires. Une vraie main fera moins bien —
ces chiffres restent une borne haute, et `fixtures/bug1-de.json` est là pour ça :
un tracé réel, conservé comme test de non-régression.

Comme le quiz sait déjà quel kana il a demandé, il n'a pas besoin d'un verdict
absolu : un tracé est accepté s'il arrive dans les **trois premiers**, et le
retour dit toujours ce que ton tracé évoque d'autre (« Accepté — mais ton tracé
passe d'abord pour ツ »). Mieux vaut un faux positif occasionnel qu'un refus
injuste dû à l'algorithme.

Le classement se fait contre **les kana de ta sélection** (complétés jusqu'à huit
candidats si le paquet est très petit), pas contre les 104 : même principe que
les leurres du QCM.

Limites connues : les yōon (きゃ) ne sont pas traçables — deux caractères. Et les
paires visuellement proches restent les points faibles, exactement celles que
l'œil confond aussi : シ/ツ, ン/ソ, ク/タ, は/ほ, さ/き.

## Fichiers

| Fichier              | Rôle                                                          |
| -------------------- | ------------------------------------------------------------- |
| `index.html`         | Structure des trois écrans (réglages, quiz, résultats)         |
| `style.css`          | Deux thèmes (Konpeitō, Sakura), clair/sombre automatique       |
| `theme.js`           | Bouton de bascule entre les thèmes, mémorisé                   |
| `kana.js`            | Le jeu de données — une ligne par rangée, hiragana + katakana   |
| `recognizer.js`      | Reconnaissance d'écriture : amincissement, nuages, comparaison |
| `app.js`             | Tirage pondéré, modes de quiz, score, persistance             |
| `kanji.js`           | Les fiches de kanji : lectures, mots, phrases, pièges          |
| `romaji.js`          | Conversion romaji → hiragana des réponses tapées               |
| `kanji-app.js`       | L’onglet kanji : liste, fiche, furigana, liens entre fiches    |
| `test-kanji.js`      | Vérifie les données kanji et l’affichage des fiches            |
| `test.js`            | Tests des quiz au clavier (faux DOM)                          |
| `test-recognizer.js` | Mesure de la reconnaissance + mode écriture bout en bout       |
| `test-dom.js`        | Faux DOM partagé par les deux suites                          |
| `tools/render-kana.py` | Rend les kana en bitmaps pour les tests (dev uniquement)     |
| `fixtures/`          | Tracés réels conservés comme tests de non-régression           |

`recognizer.js` ne touche pas au DOM : c'est du calcul pur, réutilisable tel quel
si l'app change un jour de charpente.

## Tests

```bash
node test.js              # parcours des quiz, invariants du QCM
node test-recognizer.js   # reconnaissance ; nécessite python3 + Pillow
node test-recognizer.js 2 # version rapide (2 tracés simulés par kana)
node test-kanji.js        # données et fiches kanji
```

`test.js` simule un DOM minimal, joue de vraies sessions et vérifie les
invariants du QCM sur 800 tirages : quatre propositions distinctes, une seule
lecture correcte, pas de mélange des syllabaires.

`test-recognizer.js` rend les 104 kana avec la police du système, mesure les taux
de reconnaissance, sort la liste des paires les plus confondables, puis rejoue le
mode écriture de bout en bout avec de vrais événements pointeur. Il se met en
pause proprement si Pillow ou la police manquent — l'app, elle, n'en a pas besoin.

Une note sur la méthode : le banc d'essai simulé s'est révélé trop indulgent. Il
ne déformait les tracés que de ±10 % par axe, ce qui les laissait aux
proportions exactes de la police — et masquait un défaut bien réel (un デ
lisible classé 19e, `images/bug1.png`). Le banc déforme désormais de ±25 % par
axe, et les vrais tracés qui prennent le moteur en défaut rejoignent
`fixtures/`. Un banc qu'on n'a pas vu échouer ne prouve pas grand-chose.

## Détail d'implémentation

ぢ/づ se lisent comme じ/ず. Ces cartes sont marquées `ambiguous` : elles sont
posées en question dans le sens kana → romaji, mais jamais dans l'autre sens, où
la réponse serait indécidable.

## Pistes pour la suite

- Un mode « paires piégeuses » (シ/ツ, ン/ソ, は/ほ) tirées deux à deux.
- L'ordre des traits, en passant les gabarits sur KanjiVG : mêmes nuages de
  points, mais avec le tracé exact et son ordre — ça permettrait de corriger la
  façon d'écrire, pas seulement le résultat.
- Des mots simples une fois les deux syllabaires acquis (ねこ, すし, テレビ).

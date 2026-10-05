/**
 * Skin toggle: the candy theme (default) or Sakura.
 *
 * Light or dark still follows the system; the skin only swaps the palette.
 * The <head> applies the saved skin before the first paint, this file only
 * wires the button.
 */
const SKIN_KEY = 'konpeito.skin';
const SKINS = {
  konpeito: {
    next: 'sakura',
    label: '🌸 Sakura',
    title: 'Passer au thème Sakura',
    tagline: 'Un grain de sucre à la fois.',
  },
  sakura: {
    next: 'konpeito',
    label: '🍬 Konpeitō',
    title: 'Revenir au thème Konpeitō',
    tagline: 'Un pétale à la fois.',
  },
};

function applySkin(skin) {
  const name = SKINS[skin] ? skin : 'konpeito';
  document.documentElement.dataset.skin = name;
  const button = document.getElementById('skin-toggle');
  button.textContent = SKINS[name].label;
  button.title = SKINS[name].title;
  button.setAttribute('aria-label', SKINS[name].title);
  document.getElementById('tagline').textContent = SKINS[name].tagline;
}

function toggleSkin() {
  const next = SKINS[document.documentElement.dataset.skin || 'konpeito'].next;
  applySkin(next);
  try {
    localStorage.setItem(SKIN_KEY, next);
  } catch (error) {
    // Private browsing: the skin just won't be remembered.
  }
}

applySkin(document.documentElement.dataset.skin);
document.getElementById('skin-toggle').addEventListener('click', toggleSkin);

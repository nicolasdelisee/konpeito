/**
 * Light / dark toggle for the Sakura theme.
 *
 * The <head> script applies the saved theme (or the system preference on a
 * first visit) before the first paint; this file only wires the button. Once
 * you pick one, it sticks, whatever the system says afterwards.
 */
const THEME_KEY = 'konpeito.theme';
const THEMES = {
  light: { next: 'dark', label: '🌙 Sombre', title: 'Passer au thème sombre' },
  dark: { next: 'light', label: '🌸 Clair', title: 'Passer au thème clair' },
};

function applyTheme(theme) {
  const name = THEMES[theme] ? theme : 'light';
  document.documentElement.dataset.theme = name;
  const button = document.getElementById('theme-toggle');
  button.textContent = THEMES[name].label;
  button.title = THEMES[name].title;
  button.setAttribute('aria-label', THEMES[name].title);
}

function toggleTheme() {
  const next = THEMES[document.documentElement.dataset.theme || 'light'].next;
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (error) {
    // Private browsing: the choice just won't be remembered.
  }
}

applyTheme(document.documentElement.dataset.theme);
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

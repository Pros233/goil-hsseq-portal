/* ============================================================
   GOIL HSSEQ – Dark / Light Mode Toggle
   ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY = 'goilTheme';

  var MOON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/></svg>';
  var SUN_SVG  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';

  function getTheme() {
    return localStorage.getItem(STORAGE_KEY) || 'dark';
  }

  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.classList.add('light-mode');
    } else {
      document.documentElement.classList.remove('light-mode');
    }
    updateButtons(theme);
  }

  function updateButtons(theme) {
    var buttons = document.querySelectorAll('.goil-theme-btn');
    buttons.forEach(function (btn) {
      btn.innerHTML = theme === 'dark' ? SUN_SVG : MOON_SVG;
      btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      btn.setAttribute('aria-label', btn.title);
    });
  }

  function toggle() {
    var next = getTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  // Inject theme.css if not already present
  function ensureThemeCSS() {
    if (document.querySelector('link[data-goil-theme]')) return;
    var inPages = window.location.pathname.indexOf('/pages/') >= 0;
    var href = (inPages ? '../' : '') + 'assets/css/theme.css';
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-goil-theme', '1');
    document.head.appendChild(link);
  }

  // Create and return a toggle button element
  function createButton() {
    var btn = document.createElement('button');
    btn.className = 'goil-theme-btn';
    btn.type = 'button';
    btn.innerHTML = getTheme() === 'dark' ? SUN_SVG : MOON_SVG;
    btn.title = getTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    btn.setAttribute('aria-label', btn.title);
    btn.addEventListener('click', toggle);
    return btn;
  }

  // Inject button into topbar-right or nav-right
  function injectButton() {
    var targets = [
      document.querySelector('.topbar-right'),
      document.querySelector('.nav-right'),
      document.querySelector('.uc-primary')
    ];
    for (var i = 0; i < targets.length; i++) {
      if (targets[i]) {
        targets[i].insertBefore(createButton(), targets[i].firstChild);
        break;
      }
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  // Apply theme immediately (synchronous) to prevent flash
  applyTheme(getTheme());
  ensureThemeCSS();

  // Inject button after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButton);
  } else {
    injectButton();
  }

  window.GoilTheme = { toggle: toggle, apply: applyTheme, getTheme: getTheme };
})();

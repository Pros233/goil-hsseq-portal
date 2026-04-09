/* ============================================================
   GOIL HSSEQ – Auth Guard  (Supabase session check)
   ============================================================ */
(function () {
  'use strict';

  var SUPABASE_STORAGE_KEY = 'sb-qpldcpendvdobtbkygxo-auth-token';

  // ── Helpers ────────────────────────────────────────────────────────────────

  function getLoginPath() {
    return window.location.pathname.indexOf('/pages/') >= 0
      ? '../index.html'
      : 'index.html';
  }

  function redirect(path) {
    window.location.replace(path);
  }

  // Determine base path for assets (pages/ is one level deep)
  var inPages = window.location.pathname.indexOf('/pages/') >= 0;
  var base    = inPages ? '../' : './';

  // ── Apply theme immediately (prevent flash) ────────────────────────────────

  function applyTheme() {
    var theme = localStorage.getItem('goilTheme') || 'dark';
    if (theme === 'light') {
      document.documentElement.classList.add('light-mode');
    }
  }

  function ensureThemeCSS() {
    if (document.querySelector('link[data-goil-theme]')) return;
    var link = document.createElement('link');
    link.rel  = 'stylesheet';
    link.href = base + 'assets/css/theme.css';
    link.setAttribute('data-goil-theme', '1');
    document.head.appendChild(link);
  }

  applyTheme();
  ensureThemeCSS();

  // ── Check Supabase session from localStorage ───────────────────────────────

  function getSupabaseSession() {
    try {
      var raw = localStorage.getItem(SUPABASE_STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      // Session object may be nested under 'currentSession' or at root
      var session = parsed.currentSession || parsed;
      if (!session || !session.access_token) return null;
      // Check expiry
      if (session.expires_at && session.expires_at < Math.floor(Date.now() / 1000)) {
        return null;
      }
      return session;
    } catch (e) {
      return null;
    }
  }

  // ── Enforce authentication ─────────────────────────────────────────────────

  function enforceAuth() {
    // "Keep me signed in" was unchecked: if this is a fresh browser open
    // (sessionStorage is empty), clear the stored token and force re-login.
    if (localStorage.getItem('goilNoRemember') === '1' &&
        !sessionStorage.getItem('goilActive')) {
      localStorage.removeItem('sb-qpldcpendvdobtbkygxo-auth-token');
      localStorage.removeItem('goilUserProfile');
      localStorage.removeItem('goilNoRemember');
      redirect(getLoginPath());
      return;
    }

    var session = getSupabaseSession();

    if (!session) {
      redirect(getLoginPath());
      return;
    }

    // Load cached profile for role
    var profile = {};
    try {
      var raw = localStorage.getItem('goilUserProfile');
      if (raw) profile = JSON.parse(raw);
    } catch (e) {}

    // Apply role class to <body> for CSS-driven role gating
    var role = profile.role || 'submitter';
    document.body.classList.add('role-' + role);

    // Keep session-active marker alive across page navigations
    sessionStorage.setItem('goilActive', '1');

    // Expose auth context globally
    window.GOIL_AUTH_CONTEXT = {
      session: session,
      profile: profile,
      role:    role,
      isAdmin: role === 'admin'
    };

    // ── Register Service Worker ──────────────────────────────────────────────
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register(base + 'sw.js', { scope: '/' })
        .catch(function () {});
    }

    // ── Inject theme toggle script ───────────────────────────────────────────
    function injectScript(src, onload) {
      var el = document.createElement('script');
      el.src = src;
      if (onload) el.onload = onload;
      document.head.appendChild(el);
    }

    injectScript(base + 'assets/js/theme.js');

    // ── Load Supabase CDN then the sync module ───────────────────────────────
    injectScript(
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
      function () {
        injectScript(base + 'assets/js/goil-supabase.js');
      }
    );
  }

  enforceAuth();
})();

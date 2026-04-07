(function () {
  "use strict";

  function loadFromStorage(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function getLoginPath() {
    return window.location.pathname.indexOf("/pages/") >= 0 ? "../index.html" : "index.html";
  }

  function enforceAuth() {
    var auth = loadFromStorage("goilAuth", null);
    if (!auth || auth.authenticated !== true) {
      window.location.replace(getLoginPath());
      return;
    }

    window.GOIL_AUTH_CONTEXT = {
      auth: auth,
      user: loadFromStorage("goilUser", { username: "HSSEQ User" })
    };

    // Determine asset base path (pages are one level deep)
    var inPages = window.location.pathname.indexOf("/pages/") >= 0;
    var base    = inPages ? "../" : "./";

    // ── Register Service Worker ──────────────────────────────────────────────
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register(base + "sw.js", { scope: "/" })
        .catch(function () {});
    }

    // ── Load Supabase CDN then the sync module ───────────────────────────────
    function injectScript(src, onload) {
      var el = document.createElement("script");
      el.src = src;
      if (onload) el.onload = onload;
      document.head.appendChild(el);
    }

    injectScript(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
      function () {
        injectScript(base + "assets/js/goil-supabase.js");
      }
    );
  }

  enforceAuth();
})();

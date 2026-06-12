(function () {
  'use strict';

  var FONT_KEY = 'goilFontScale';
  var ZOOM_KEY = 'goilZoomScale';
  var THEME_KEY = 'goilTheme';
  var FONT_MIN = 0.9;
  var FONT_MAX = 1.1;
  var DATA_EXPORT_KEYS = [
    'goil_inspection_meta',
    'goil_audit_trail',
    'goil_checklist_snapshots',
    'goil_inspection_records',
    'goil_notifications',
    'goil_corrective_actions_store',
    'goil_facility_details',
    'goil_checklist_session',
    'goil_corrective_action_session',
    'goil_current_section',
    'goil_review_state',
    'goil_ca_context',
    'goil_focus_item_code',
    'goilAuth',
    'goilUser',
    'goilAssessmentDrafts',
    'goilSubmittedAssessments',
    'goilFindings',
    'goilActions',
    'goilAuditLog',
    'goilDashboardCache'
  ];

  function clamp(value, min, max) {
    var n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function getProfile() {
    var ctx = window.GOIL_AUTH_CONTEXT || {};
    var profile = ctx.profile || readJSON('goilUserProfile', {}) || {};
    var session = ctx.session || {};
    var email = profile.email || (session.user && session.user.email) || '';
    return {
      fullName: profile.full_name || profile.fullName || email || 'HSSEQ User',
      email: email
    };
  }

  function initialsFromProfile(profile) {
    var source = String((profile && profile.fullName) || (profile && profile.email) || 'HSSEQ User').trim();
    if (!source) return 'HU';
    var parts = source.replace(/[^A-Za-z0-9@.\s_-]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'HU';
    if (parts.length === 1 && parts[0].indexOf('@') >= 0) {
      parts = parts[0].split(/[@._-]+/).filter(Boolean);
    }
    return parts.slice(0, 2).map(function (part) {
      return String(part || '').charAt(0).toUpperCase();
    }).join('') || 'HU';
  }

  function getFontScale() {
    return clamp(localStorage.getItem(FONT_KEY) || 1, FONT_MIN, FONT_MAX);
  }

  function getZoomScale() {
    return clamp(localStorage.getItem(ZOOM_KEY) || 1, 0.9, 1.15);
  }

  function applyFontScale(scale) {
    var value = clamp(scale, FONT_MIN, FONT_MAX);
    localStorage.setItem(FONT_KEY, String(value));
    document.documentElement.style.setProperty('--goil-font-scale', String(value));
  }

  function applyZoomScale(scale) {
    var value = clamp(scale, 0.9, 1.15);
    localStorage.setItem(ZOOM_KEY, String(value));
    if (document.body) {
      document.body.style.zoom = String(value);
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.style.zoom = String(value);
      }, { once: true });
    }
  }

  function applyTheme(theme) {
    var next = theme === 'light' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    if (window.GoilTheme && typeof window.GoilTheme.apply === 'function') {
      window.GoilTheme.apply(next);
    } else if (next === 'light') {
      document.documentElement.classList.add('light-mode');
    } else {
      document.documentElement.classList.remove('light-mode');
    }
    syncControls();
  }

  function currentTheme() {
    if (window.GoilTheme && typeof window.GoilTheme.getTheme === 'function') {
      return window.GoilTheme.getTheme();
    }
    return localStorage.getItem(THEME_KEY) || 'dark';
  }

  function getLoginPath() {
    return window.location.pathname.indexOf('/pages/') >= 0
      ? '../index.html'
      : 'index.html';
  }

  function signOut() {
    localStorage.removeItem('sb-qpldcpendvdobtbkygxo-auth-token');
    localStorage.removeItem('goilUserProfile');
    localStorage.removeItem('goilNoRemember');
    sessionStorage.removeItem('goilActive');

    try {
      if (window.supabase && window.supabase.createClient) {
        window.supabase.createClient(
          'https://qpldcpendvdobtbkygxo.supabase.co',
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwbGRjcGVuZHZkb2J0Ymt5Z3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1ODE3OTksImV4cCI6MjA5MTE1Nzc5OX0.MZJFtZO6pjwj_Ni1CpIjJTxaubprS79Kmf-lr1fkMYg'
        ).auth.signOut();
      }
    } catch (error) {}

    window.location.href = getLoginPath();
  }

  function collectTransferPayload() {
    var payload = {
      app: 'GOIL HSSEQ',
      type: 'local-storage-transfer',
      version: 1,
      exportedAt: new Date().toISOString(),
      origin: window.location.origin || 'null',
      path: window.location.pathname || '',
      storage: {}
    };

    DATA_EXPORT_KEYS.forEach(function (key) {
      var raw = localStorage.getItem(key);
      if (raw != null) payload.storage[key] = raw;
    });

    return payload;
  }

  function downloadTransferFile() {
    var payload = collectTransferPayload();
    var fileName = 'goil-hsseq-transfer-' + payload.exportedAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '') + '.json';
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    window.alert('GOIL app data exported. Import this file in the localhost version to bring your saved records across.');
  }

  function importTransferPayload(payload) {
    if (!payload || payload.type !== 'local-storage-transfer' || typeof payload.storage !== 'object') {
      throw new Error('This file is not a valid GOIL HSSEQ transfer export.');
    }

    Object.keys(payload.storage).forEach(function (key) {
      if (DATA_EXPORT_KEYS.indexOf(key) < 0) return;
      var value = payload.storage[key];
      if (typeof value === 'string') {
        localStorage.setItem(key, value);
      }
    });
  }

  function readTransferFile(file, done) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var text = String(reader.result || '');
        var parsed = JSON.parse(text);
        done(null, parsed);
      } catch (error) {
        done(error || new Error('Unable to read transfer file.'));
      }
    };
    reader.onerror = function () {
      done(reader.error || new Error('Unable to read transfer file.'));
    };
    reader.readAsText(file);
  }

  function createButton(label, attrs) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    Object.keys(attrs || {}).forEach(function (key) {
      btn.setAttribute(key, attrs[key]);
    });
    return btn;
  }

  function createControls() {
    var profile = getProfile();
    var host = document.createElement('div');
    host.className = 'goil-user-tools';

    var avatar = document.createElement('button');
    avatar.type = 'button';
    avatar.className = 'goil-user-badge';
    avatar.textContent = initialsFromProfile(profile);
    avatar.title = profile.fullName;
    avatar.setAttribute('aria-label', profile.fullName);

    var prefsBtn = document.createElement('button');
    prefsBtn.type = 'button';
    prefsBtn.className = 'goil-pref-btn';
    prefsBtn.setAttribute('aria-label', 'Preferences');
    prefsBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8.5A3.5 3.5 0 1012 15.5A3.5 3.5 0 0012 8.5Z" stroke="currentColor" stroke-width="1.8"></path><path d="M19.4 15A1.7 1.7 0 0019.74 16.87L19.78 16.98A2 2 0 0119.3 19.18L19.2 19.28A2 2 0 0117 19.76L16.89 19.72A1.7 1.7 0 0015 20.06A1.7 1.7 0 0014 21.6V21.8A2 2 0 0112 23H12A2 2 0 0110 21.8V21.64A1.7 1.7 0 009 20.06A1.7 1.7 0 007.11 19.72L7 19.76A2 2 0 014.8 19.28L4.7 19.18A2 2 0 014.22 16.98L4.26 16.87A1.7 1.7 0 003.92 15A1.7 1.7 0 002.4 14H2.2A2 2 0 011 12V12A2 2 0 012.2 10H2.36A1.7 1.7 0 003.92 9A1.7 1.7 0 004.26 7.13L4.22 7.02A2 2 0 014.7 4.82L4.8 4.72A2 2 0 017 4.24L7.11 4.28A1.7 1.7 0 009 3.94A1.7 1.7 0 0010 2.4V2.2A2 2 0 0112 1H12A2 2 0 0114 2.2V2.36A1.7 1.7 0 0015 3.94A1.7 1.7 0 0016.89 4.28L17 4.24A2 2 0 0119.2 4.72L19.3 4.82A2 2 0 0119.78 7.02L19.74 7.13A1.7 1.7 0 0020.08 9A1.7 1.7 0 0021.6 10H21.8A2 2 0 0123 12V12A2 2 0 0121.8 14H21.64A1.7 1.7 0 0020.08 15A1.7 1.7 0 0019.4 15Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"></path></svg>';

    var menu = document.createElement('div');
    menu.className = 'goil-pref-menu';
    menu.hidden = true;
    menu.innerHTML = ''
      + '<div class="goil-pref-head"><div class="goil-pref-name"></div><div class="goil-pref-email"></div></div>'
      + '<div class="goil-pref-group"><span class="goil-pref-label">Theme</span><div class="goil-pref-row"><button type="button" class="goil-pref-chip" data-theme="dark">Dark</button><button type="button" class="goil-pref-chip" data-theme="light">Light</button></div></div>'
      + '<div class="goil-pref-group"><span class="goil-pref-label">Font Size</span><div class="goil-pref-row"><button type="button" class="goil-pref-chip" data-font="0.9">A-</button><button type="button" class="goil-pref-chip" data-font="1">A</button><button type="button" class="goil-pref-chip" data-font="1.1">A+</button></div></div>'
      + '<div class="goil-pref-group"><span class="goil-pref-label">Zoom</span><div class="goil-pref-row"><button type="button" class="goil-pref-chip" data-zoom="0.9">90%</button><button type="button" class="goil-pref-chip" data-zoom="1">100%</button><button type="button" class="goil-pref-chip" data-zoom="1.1">110%</button></div></div>'
      + '<div class="goil-pref-group"><span class="goil-pref-label">Data Transfer</span><div class="goil-pref-row goil-pref-transfer-row"><button type="button" class="goil-pref-transfer" data-export-data="1">Export Data</button><button type="button" class="goil-pref-transfer" data-import-data="1">Import Data</button></div><div class="goil-pref-note">Use Export on the file version, then Import on localhost.</div></div>'
      + '<button type="button" class="goil-pref-signout" data-signout="1"><span class="goil-pref-signout-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M15 7V5.8C15 4.11985 15 3.27976 14.673 2.63803C14.3854 2.07354 13.9265 1.6146 13.362 1.32698C12.7202 1 11.8802 1 10.2 1H7.8C6.11984 1 5.27976 1 4.63803 1.32698C4.07354 1.6146 3.6146 2.07354 3.32698 2.63803C3 3.27976 3 4.11984 3 5.8V18.2C3 19.8802 3 20.7202 3.32698 21.362C3.6146 21.9265 4.07354 22.3854 4.63803 22.673C5.27976 23 6.11984 23 7.8 23H10.2C11.8802 23 12.7202 23 13.362 22.673C13.9265 22.3854 14.3854 21.9265 14.673 21.362C15 20.7202 15 19.8802 15 18.2V17M10 12H21M21 12L18 9M21 12L18 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg></span><span class="goil-pref-signout-copy"><span class="goil-pref-signout-title">Sign Out</span><span class="goil-pref-signout-sub">End your session</span></span></button>';

    var importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = 'application/json,.json';
    importInput.hidden = true;
    importInput.setAttribute('aria-hidden', 'true');
    menu.appendChild(importInput);

    menu.querySelector('.goil-pref-name').textContent = profile.fullName;
    menu.querySelector('.goil-pref-email').textContent = profile.email || 'Signed in user';

    function closeMenu() {
      menu.hidden = true;
      prefsBtn.classList.remove('active');
    }

    prefsBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
      prefsBtn.classList.toggle('active', !menu.hidden);
      syncControls();
    });

    menu.addEventListener('click', function (event) {
      var themeBtn = event.target.closest('[data-theme]');
      if (themeBtn) {
        applyTheme(themeBtn.getAttribute('data-theme'));
        closeMenu();
        return;
      }
      var fontBtn = event.target.closest('[data-font]');
      if (fontBtn) {
        applyFontScale(fontBtn.getAttribute('data-font'));
        syncControls();
        closeMenu();
        return;
      }
      var zoomBtn = event.target.closest('[data-zoom]');
      if (zoomBtn) {
        applyZoomScale(zoomBtn.getAttribute('data-zoom'));
        syncControls();
        closeMenu();
        return;
      }
      var signoutBtn = event.target.closest('[data-signout]');
      if (signoutBtn) {
        closeMenu();
        signOut();
        return;
      }
      var exportBtn = event.target.closest('[data-export-data]');
      if (exportBtn) {
        closeMenu();
        downloadTransferFile();
        return;
      }
      var importBtn = event.target.closest('[data-import-data]');
      if (importBtn) {
        importInput.value = '';
        importInput.click();
        return;
      }
    });

    importInput.addEventListener('change', function () {
      var file = importInput.files && importInput.files[0];
      if (!file) return;
      closeMenu();
      readTransferFile(file, function (error, payload) {
        if (error) {
          window.alert(error.message || 'Unable to import GOIL app data.');
          return;
        }
        try {
          importTransferPayload(payload);
          window.alert('GOIL app data imported. The page will now reload.');
          window.location.reload();
        } catch (importError) {
          window.alert(importError.message || 'Unable to import GOIL app data.');
        }
      });
    });

    document.addEventListener('click', function (event) {
      if (!host.contains(event.target)) {
        closeMenu();
      }
    });

    host.appendChild(avatar);
    host.appendChild(prefsBtn);
    host.appendChild(menu);
    return host;
  }

  function findMountTarget() {
    return document.querySelector('.goil-page-tools')
      || document.querySelector('.topbar-right')
      || document.querySelector('.nav-right')
      || document.querySelector('.topbar-actions')
      || document.querySelector('.pr-topbar-actions')
      || document.querySelector('header.rm-topbar')
      || document.querySelector('header.topbar')
      || document.querySelector('nav.topbar')
      || document.querySelector('header.fp-topbar')
      || document.querySelector('header.amc-topbar')
      || document.querySelector('.rm-topbar')
      || document.querySelector('.fp-topbar')
      || document.querySelector('.amc-topbar')
      || document.querySelector('.topbar');
  }

  function syncControls() {
    var theme = currentTheme();
    var font = String(getFontScale());
    var zoom = String(getZoomScale());
    document.querySelectorAll('.goil-pref-chip[data-theme], .goil-pref-chip[data-font], .goil-pref-chip[data-zoom]').forEach(function (button) {
      var active = false;
      if (button.hasAttribute('data-theme')) active = button.getAttribute('data-theme') === theme;
      if (button.hasAttribute('data-font')) active = button.getAttribute('data-font') === font;
      if (button.hasAttribute('data-zoom')) active = button.getAttribute('data-zoom') === zoom;
      button.classList.toggle('active', active);
    });
  }

  function mountControls() {
    if (document.querySelector('.goil-user-tools')) return;
    var target = findMountTarget();
    if (!target) return;
    var controls = createControls();
    if (
      target.matches('header.rm-topbar, header.topbar, nav.topbar, header.fp-topbar, header.amc-topbar, .rm-topbar, .fp-topbar, .amc-topbar, .topbar')
      && !target.matches('.goil-page-tools, .topbar-right, .nav-right, .topbar-actions, .pr-topbar-actions')
    ) {
      controls.style.marginLeft = 'auto';
    }
    target.appendChild(controls);
    syncControls();
  }

  applyFontScale(getFontScale());
  applyZoomScale(getZoomScale());

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountControls);
  } else {
    mountControls();
  }

  window.GoilUserTools = {
    applyTheme: applyTheme,
    applyFontScale: applyFontScale,
    applyZoomScale: applyZoomScale
  };
})();

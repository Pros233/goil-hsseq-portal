/* ============================================================
   GOIL HSSEQ – Supabase Sync
   Backs up localStorage inspection data to Supabase and
   pulls in records created on other devices/sessions.
   ============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL     = 'https://qpldcpendvdobtbkygxo.supabase.co';
  var SUPABASE_ANON    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwbGRjcGVuZHZkb2J0Ymt5Z3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1ODE3OTksImV4cCI6MjA5MTE1Nzc5OX0.MZJFtZO6pjwj_Ni1CpIjJTxaubprS79Kmf-lr1fkMYg';

  // localStorage keys (must match workflow-core.js)
  var LS_RECORDS       = 'goil_inspection_records';
  var LS_NOTIFICATIONS = 'goil_notifications';

  // Supabase table names
  var TBL_RECORDS      = 'inspection_records';
  var TBL_NOTIFS       = 'notifications';

  // Sync interval when online (ms)
  var SYNC_INTERVAL    = 2 * 60 * 1000; // 2 minutes

  var db = null;
  var syncTimer = null;
  var isSyncing = false;

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    var sb = window.supabase;
    if (!sb || typeof sb.createClient !== 'function') {
      console.warn('[GoilSync] Supabase library not loaded.');
      return;
    }

    db = sb.createClient(SUPABASE_URL, SUPABASE_ANON);
    console.log('[GoilSync] Connected to Supabase.');

    // Sync immediately then on a timer
    sync();
    syncTimer = setInterval(sync, SYNC_INTERVAL);

    // Re-sync whenever the browser comes back online
    window.addEventListener('online', function () {
      console.log('[GoilSync] Back online – syncing...');
      sync();
    });

    // Show offline/online indicator on the page
    window.addEventListener('offline', function () { showBanner('offline'); });
    window.addEventListener('online',  function () { showBanner('online');  });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function readLS(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') || []; }
    catch (e) { return []; }
  }

  function writeLS(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.warn('[GoilSync] localStorage write failed:', e.message); }
  }

  function recordKey(rec) {
    var ref = rec.inspectionRef || rec.inspection_ref || rec.referenceNo || '';
    var ver = rec.version       || rec.version_number  || 1;
    return ref + '::' + String(ver);
  }

  function currentUserEmail() {
    var ctx = window.GOIL_AUTH_CONTEXT;
    return (ctx && ctx.user && (ctx.user.email || ctx.user.username)) || '';
  }

  // ── Push (localStorage → Supabase) ─────────────────────────────────────────

  async function push() {
    var records = readLS(LS_RECORDS);
    if (!records.length) return 0;

    var rows = records
      .map(function (r) {
        var ref = r.inspectionRef || r.inspection_ref || r.referenceNo || '';
        if (!ref) return null;
        return {
          inspection_ref: ref,
          version_number: r.version || r.version_number || 1,
          user_email:     currentUserEmail(),
          record_data:    r,
          synced_at:      new Date().toISOString()
        };
      })
      .filter(Boolean);

    if (!rows.length) return 0;

    var res = await db
      .from(TBL_RECORDS)
      .upsert(rows, { onConflict: 'inspection_ref,version_number' });

    if (res.error) {
      console.warn('[GoilSync] Push error:', res.error.message);
      return 0;
    }

    // Push notifications too
    var notifs = readLS(LS_NOTIFICATIONS);
    if (notifs.length) {
      var nRows = notifs
        .map(function (n) {
          if (!n.id) return null;
          return {
            notif_id:   n.id,
            user_email: currentUserEmail(),
            notif_data: n,
            synced_at:  new Date().toISOString()
          };
        })
        .filter(Boolean);

      if (nRows.length) {
        await db
          .from(TBL_NOTIFS)
          .upsert(nRows, { onConflict: 'notif_id' })
          .then(function (r) {
            if (r.error) console.warn('[GoilSync] Notif push error:', r.error.message);
          });
      }
    }

    console.log('[GoilSync] Pushed ' + rows.length + ' record(s) to Supabase.');
    return rows.length;
  }

  // ── Pull (Supabase → localStorage) ─────────────────────────────────────────

  async function pull() {
    var res = await db
      .from(TBL_RECORDS)
      .select('inspection_ref, version_number, record_data, synced_at')
      .order('synced_at', { ascending: false });

    if (res.error) {
      console.warn('[GoilSync] Pull error:', res.error.message);
      return 0;
    }

    var remote = res.data || [];
    if (!remote.length) return 0;

    var local       = readLS(LS_RECORDS);
    var localIndex  = {};
    local.forEach(function (r) { localIndex[recordKey(r)] = r; });

    var added = 0;
    remote.forEach(function (row) {
      var rec = row.record_data;
      if (!rec) return;
      var key = recordKey(rec);
      if (!localIndex[key]) {
        localIndex[key] = rec;
        added++;
      }
    });

    if (added > 0) {
      writeLS(LS_RECORDS, Object.values(localIndex));
      console.log('[GoilSync] Pulled ' + added + ' new record(s) from Supabase.');
    }

    return added;
  }

  // ── Full sync ──────────────────────────────────────────────────────────────

  async function sync() {
    if (!db || !navigator.onLine || isSyncing) return;
    isSyncing = true;
    try {
      await push();
      await pull();
    } catch (e) {
      console.warn('[GoilSync] Sync failed:', e.message);
    } finally {
      isSyncing = false;
    }
  }

  // ── Offline / online banner ────────────────────────────────────────────────

  function showBanner(state) {
    var existing = document.getElementById('goil-sync-banner');
    if (existing) existing.remove();

    var banner = document.createElement('div');
    banner.id = 'goil-sync-banner';

    var isOffline = state === 'offline';
    banner.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:16px', 'z-index:99999',
      'padding:10px 18px', 'border-radius:6px',
      'font-family:Barlow,sans-serif', 'font-size:13px', 'font-weight:600',
      'letter-spacing:.4px', 'pointer-events:none',
      'animation:goilBannerIn .3s ease',
      isOffline
        ? 'background:#3a1a0a;color:#F47920;border:1px solid rgba(244,121,32,.4)'
        : 'background:#0d2b1a;color:#3FB950;border:1px solid rgba(63,185,80,.4)'
    ].join(';');

    banner.textContent = isOffline
      ? '⚠ Offline – changes saved locally'
      : '✓ Back online – syncing...';

    if (!document.getElementById('goil-sync-style')) {
      var style = document.createElement('style');
      style.id = 'goil-sync-style';
      style.textContent = '@keyframes goilBannerIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}';
      document.head.appendChild(style);
    }

    document.body.appendChild(banner);
    setTimeout(function () {
      if (banner.parentNode) banner.remove();
    }, isOffline ? 0 : 3000); // offline banner stays; online banner fades after 3s
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  window.GoilSupabase = { sync: sync, push: push, pull: pull };

  // ── Boot ───────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Small delay so Supabase CDN has time to define window.supabase
    setTimeout(init, 100);
  }

})();

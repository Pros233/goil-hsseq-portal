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

  function parseTime(value) {
    var stamp = Date.parse(value || '');
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function getRecordMoment(rec, syncedAt) {
    if (!rec || typeof rec !== 'object') return parseTime(syncedAt);
    var stamps = [
      rec.lastUpdatedAt,
      rec.last_updated_at,
      rec.updatedAt,
      rec.updated_at,
      rec.publishedAt,
      rec.published_at,
      rec.final_submitted_at,
      rec.correctiveSubmittedAt,
      rec.corrective_submitted_at,
      rec.checklistSubmittedAt,
      rec.checklist_submitted_at,
      rec.submissionRiskCalculatedAt,
      rec.submission_risk_calculated_at,
      rec.overallRiskCalculatedAt,
      rec.overall_risk_calculated_at,
      rec.snapshotBackfilledAt,
      rec.snapshot_backfilled_at,
      syncedAt
    ];
    return stamps.reduce(function (maxStamp, value) {
      var stamp = parseTime(value);
      return stamp > maxStamp ? stamp : maxStamp;
    }, 0);
  }

  function getChecklistPayloadRank(rec) {
    if (!rec || typeof rec !== 'object') return 0;
    var checklist = rec.checklistSnapshot && typeof rec.checklistSnapshot === 'object'
      ? rec.checklistSnapshot
      : rec.checklist_snapshot;
    if (!checklist || typeof checklist !== 'object') return 0;
    var rank = 1;
    if (checklist.catalog && typeof checklist.catalog === 'object') rank += 1;
    if (checklist.sectionStates && typeof checklist.sectionStates === 'object') rank += 1;
    if (Array.isArray(checklist.sectionsMeta) && checklist.sectionsMeta.length) rank += 1;
    return rank;
  }

  function getCorrectivePayloadRank(rec) {
    if (!rec || typeof rec !== 'object') return 0;
    var items = [];
    if (Array.isArray(rec.correctiveItems)) items = rec.correctiveItems;
    else if (Array.isArray(rec.corrective_items)) items = rec.corrective_items;
    else if (rec.correctiveSession && Array.isArray(rec.correctiveSession.items)) items = rec.correctiveSession.items;
    else if (rec.corrective_session && Array.isArray(rec.corrective_session.items)) items = rec.corrective_session.items;
    if (!items.length) return 0;

    var hasDetailedItem = items.some(function (item) {
      if (!item || typeof item !== 'object') return false;
      var code = String(item.sourceCode || item.code || '').trim();
      var sectionId = String(item.sectionId || '').trim().toLowerCase();
      var question = String(item.sourceQuestion || item.issue || '').trim().toLowerCase();
      if (sectionId && sectionId !== 'summary') return true;
      if (code && !/^(A\d+|ITEM-\d+)$/i.test(code)) return true;
      return question && question.indexOf('assessment generated corrective actions') < 0;
    });

    return hasDetailedItem ? 3 : 1;
  }

  function getStatusRank(rec) {
    if (!rec || typeof rec !== 'object') return 0;
    var status = String(rec.status || rec.currentStatus || '').trim().toLowerCase();
    if (rec.is_published || rec.final_submitted_at || rec.publishedAt || status === 'published') return 50;
    if (status.indexOf('reopened') >= 0 || status.indexOf('revised') >= 0) return 40;
    if (status.indexOf('pending_corrective') >= 0 || status.indexOf('pending corrective') >= 0) return 30;
    if (status.indexOf('draft') >= 0 || status.indexOf('progress') >= 0) return 20;
    return status ? 10 : 0;
  }

  function isRemotePreferred(localRec, remoteRec, remoteSyncedAt) {
    var localMoment = getRecordMoment(localRec);
    var remoteMoment = getRecordMoment(remoteRec, remoteSyncedAt);
    var localRank = getStatusRank(localRec);
    var remoteRank = getStatusRank(remoteRec);
    var localChecklistRank = getChecklistPayloadRank(localRec);
    var remoteChecklistRank = getChecklistPayloadRank(remoteRec);
    var localCorrectiveRank = getCorrectivePayloadRank(localRec);
    var remoteCorrectiveRank = getCorrectivePayloadRank(remoteRec);

    if (remoteMoment !== localMoment) return remoteMoment > localMoment;
    if (remoteRank !== localRank) return remoteRank > localRank;
    if (remoteChecklistRank !== localChecklistRank) return remoteChecklistRank > localChecklistRank;
    if (remoteCorrectiveRank !== localCorrectiveRank) return remoteCorrectiveRank > localCorrectiveRank;
    return false;
  }

  function shouldPushLocal(localRec, remoteRec, remoteSyncedAt) {
    if (!remoteRec) return true;
    if (isRemotePreferred(localRec, remoteRec, remoteSyncedAt)) return false;

    var localMoment = getRecordMoment(localRec);
    var remoteMoment = getRecordMoment(remoteRec, remoteSyncedAt);
    var localRank = getStatusRank(localRec);
    var remoteRank = getStatusRank(remoteRec);
    var localChecklistRank = getChecklistPayloadRank(localRec);
    var remoteChecklistRank = getChecklistPayloadRank(remoteRec);
    var localCorrectiveRank = getCorrectivePayloadRank(localRec);
    var remoteCorrectiveRank = getCorrectivePayloadRank(remoteRec);

    if (localMoment !== remoteMoment) return localMoment > remoteMoment;
    if (localRank !== remoteRank) return localRank > remoteRank;
    if (localChecklistRank !== remoteChecklistRank) return localChecklistRank > remoteChecklistRank;
    if (localCorrectiveRank !== remoteCorrectiveRank) return localCorrectiveRank > remoteCorrectiveRank;
    return false;
  }

  function emitRecordsSynced(detail) {
    try {
      window.dispatchEvent(new CustomEvent('goil:synced-records', { detail: detail || {} }));
    } catch (e) {}
  }

  async function fetchRemoteRecordIndex() {
    var res = await db
      .from(TBL_RECORDS)
      .select('inspection_ref, version_number, record_data, synced_at');

    if (res.error) {
      console.warn('[GoilSync] Remote index error:', res.error.message);
      return {};
    }

    return (res.data || []).reduce(function (index, row) {
      var rec = row && row.record_data;
      if (!rec) return index;
      var key = recordKey(rec);
      index[key] = row;
      return index;
    }, {});
  }

  function currentUserEmail() {
    var ctx = window.GOIL_AUTH_CONTEXT;
    return (ctx && ctx.user && (ctx.user.email || ctx.user.username)) || '';
  }

  // ── Push (localStorage → Supabase) ─────────────────────────────────────────

  async function push() {
    var records = readLS(LS_RECORDS);
    if (!records.length) return 0;

    var remoteIndex = await fetchRemoteRecordIndex();

    var rows = records
      .map(function (r) {
        var ref = r.inspectionRef || r.inspection_ref || r.referenceNo || '';
        if (!ref) return null;
        var key = recordKey(r);
        var remoteRow = remoteIndex[key];
        if (!shouldPushLocal(r, remoteRow && remoteRow.record_data, remoteRow && remoteRow.synced_at)) {
          return null;
        }
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
    var updated = 0;
    remote.forEach(function (row) {
      var rec = row.record_data;
      if (!rec) return;
      var key = recordKey(rec);
      if (!localIndex[key]) {
        localIndex[key] = rec;
        added++;
        return;
      }
      if (isRemotePreferred(localIndex[key], rec, row.synced_at)) {
        localIndex[key] = rec;
        updated++;
      }
    });

    if (added > 0 || updated > 0) {
      writeLS(LS_RECORDS, Object.values(localIndex));
      console.log('[GoilSync] Pulled ' + added + ' new and ' + updated + ' updated record(s) from Supabase.');
      emitRecordsSynced({ added: added, updated: updated, total: added + updated });
    }

    return added + updated;
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

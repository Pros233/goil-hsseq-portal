(function () {
  'use strict';

  var KEYS = {
    profile: 'goilUserProfile'
  };

  var state = {
    activeQueue: '',
    records: []
  };

  function loadFromStorage(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function saveToStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function resolveUserDisplay() {
    var profile = loadFromStorage(KEYS.profile, {});
    return profile.full_name || profile.email || '';
  }

  function logout() {
    // Sign out from Supabase (clears server session + localStorage token)
    try {
      var ctx = window.GOIL_AUTH_CONTEXT;
      if (ctx && ctx.session) {
        var sb = window.supabase;
        if (sb && sb.createClient) {
          var SUPABASE_URL  = 'https://qpldcpendvdobtbkygxo.supabase.co';
          var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwbGRjcGVuZHZkb2J0Ymt5Z3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1ODE3OTksImV4cCI6MjA5MTE1Nzc5OX0.MZJFtZO6pjwj_Ni1CpIjJTxaubprS79Kmf-lr1fkMYg';
          sb.createClient(SUPABASE_URL, SUPABASE_ANON).auth.signOut();
        }
      }
    } catch (e) {}
    localStorage.removeItem('goilUserProfile');
    window.location.href = '../index.html';
  }

  function statusClass(status) {
    if (!status) return 'status-tag status-draft';
    if (status.indexOf('Published') >= 0) return 'status-tag status-published';
    if (status.indexOf('Pending') >= 0 || status.indexOf('Submitted') >= 0) return 'status-tag status-pending';
    if (status.indexOf('Reopened') >= 0) return 'status-tag status-reopen';
    return 'status-tag status-draft';
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stripVersionSuffix(ref) {
    return String(ref || '')
      .trim()
      .replace(/(?:\s*\/\s*|[-_ ]+)v(?:ersion)?[-_ ]?\d+$/i, '')
      .replace(/[-_ ]+$/, '')
      .trim();
  }

  function bindModuleNav() {
    var launchRiskBtn = document.getElementById('launchRiskBtn');
    if (launchRiskBtn) {
      launchRiskBtn.addEventListener('click', function () {
        window.location.href = 'risk-inspection.html?v=20260318-masterrefdeep6&_=' + Date.now();
      });
    }

    var riskModuleCard = document.getElementById('riskModuleCard');
    if (riskModuleCard) {
      riskModuleCard.addEventListener('click', function (event) {
        if (event.target && event.target.closest('button')) return;
        window.location.href = 'risk-inspection.html?v=20260318-masterrefdeep6&_=' + Date.now();
      });
    }

    var openKpiBtn = document.getElementById('openKpiBtn');
    if (openKpiBtn) {
      openKpiBtn.addEventListener('click', function () {
        window.location.href = 'kpi.html';
      });
    }

    var openIncidentBtn = document.getElementById('openIncidentBtn');
    if (openIncidentBtn) {
      openIncidentBtn.addEventListener('click', function () {
        window.location.href = 'incident-reporting.html';
      });
    }
  }

  function renderQueueCards() {
    if (!window.GoilWorkflow) return;
    var counts = window.GoilWorkflow.getQueueCounts();
    var map = {
      qDraft: counts.draft,
      qPending: counts.pendingCorrective,
      qAwaiting: counts.awaitingReview,
      qPublished: counts.published,
      qOverdue: counts.overdueCorrective
    };
    Object.keys(map).forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.textContent = String(map[id]);
    });

    var cards = document.querySelectorAll('.queue-card');
    cards.forEach(function (card) {
      if (card.getAttribute('data-queue') === state.activeQueue) card.classList.add('active');
      else card.classList.remove('active');
    });
  }

  function uniqueValues(records, field) {
    var seen = {};
    var values = [];
    records.forEach(function (record) {
      var value = record[field] || '';
      if (!value || seen[value]) return;
      seen[value] = true;
      values.push(value);
    });
    values.sort();
    return values;
  }

  function fillSelectOptions(id, values) {
    var select = document.getElementById(id);
    if (!select) return;
    var first = select.options[0] ? select.options[0].outerHTML : '<option value="">All</option>';
    select.innerHTML = first + values.map(function (value) {
      return '<option value="' + esc(value) + '">' + esc(value) + '</option>';
    }).join('');
  }

  function collectFilters() {
    var byId = function (id) {
      var node = document.getElementById(id);
      return node ? String(node.value || '').trim() : '';
    };

    return {
      queue: state.activeQueue,
      search: byId('fltSearch'),
      facilityType: byId('fltFacilityType'),
      location: byId('fltLocation'),
      status: byId('fltStatus'),
      inspector: byId('fltInspector'),
      riskLevel: byId('fltRisk'),
      dateFrom: byId('fltDate')
    };
  }

  function renderRecords() {
    if (!window.GoilWorkflow) return;
    var tbody = document.getElementById('recordsTbody');
    if (!tbody) return;

    var filters = collectFilters();
    var records = window.GoilWorkflow.listRecords(filters);
    state.records = records;

    if (!records.length) {
      tbody.innerHTML = '<tr><td colspan="11" style="color:#A0A0A0">No inspection records match the current filters.</td></tr>';
      return;
    }

    tbody.innerHTML = records.map(function (record) {
      var parentRefRaw = (window.RiskModuleUtils && typeof RiskModuleUtils.getParentInspectionReference === 'function')
        ? (RiskModuleUtils.getParentInspectionReference(record) || '-')
        : (record.inspectionRef || record.assessment_reference || record.referenceNo || '-');
      var parentRef = stripVersionSuffix(parentRefRaw) || '-';
      var version = record.version || record.version_number || 1;
      var displayRef = (window.RiskModuleUtils && typeof RiskModuleUtils.formatDisplayReference === 'function')
        ? RiskModuleUtils.formatDisplayReference(parentRef, version)
        : (String(parentRef) + '-v' + String(version));
      return '<tr>' +
        '<td title="Versioned: ' + esc(displayRef) + '">' + esc(parentRef) + '</td>' +
        '<td>v' + esc(version) + '</td>' +
        '<td>' + esc(record.facilityName || '-') + '</td>' +
        '<td>' + esc(record.facilityType || '-') + '</td>' +
        '<td>' + esc(record.location || '-') + '</td>' +
        '<td>' + esc(record.inspectionDate || '-') + '</td>' +
        '<td>' + esc(record.inspector || '-') + '</td>' +
        '<td>' + esc((record.overallRiskLevel || '-') + (record.overallRiskScore != null && record.overallRiskScore !== '' ? ' (' + record.overallRiskScore + ')' : '')) + '</td>' +
        '<td><span class="' + statusClass(record.status || '') + '">' + esc(record.status || '-') + '</span></td>' +
        '<td>' + esc(record.checklistSubmittedAt ? new Date(record.checklistSubmittedAt).toLocaleString() : '-') + '</td>' +
        '<td>' + esc(record.correctiveSubmittedAt ? new Date(record.correctiveSubmittedAt).toLocaleString() : '-') + '</td>' +
      '</tr>';
    }).join('');
  }

  function renderNotifications() {
    if (!window.GoilWorkflow) return;
    var listNode = document.getElementById('notifList');
    if (!listNode) return;

    var notifications = window.GoilWorkflow.getNotifications().slice().sort(function (a, b) {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    if (!notifications.length) {
      listNode.innerHTML = '<div class="notif-item"><div class="notif-title">No notifications</div><div class="notif-meta">Workflow reminders and publishing alerts will appear here.</div></div>';
      return;
    }

    listNode.innerHTML = notifications.slice(0, 30).map(function (item) {
      var at = item.createdAt ? new Date(item.createdAt).toLocaleString() : '-';
      var due = item.dueAt ? ' · Due: ' + item.dueAt : '';
      return '<div class="notif-item">' +
        '<div class="notif-title">' + esc(item.title || 'Notification') + '</div>' +
        '<div class="notif-meta">' + esc(item.message || '') + '</div>' +
        '<div class="notif-meta">Ref: ' + esc(item.referenceNo || '-') + ' · ' + esc(at + due) + '</div>' +
      '</div>';
    }).join('');
  }

  function bindFilters(records) {
    fillSelectOptions('fltFacilityType', uniqueValues(records, 'facilityType'));
    fillSelectOptions('fltLocation', uniqueValues(records, 'location'));
    fillSelectOptions('fltStatus', uniqueValues(records, 'status'));
    fillSelectOptions('fltInspector', uniqueValues(records, 'inspector'));

    ['fltSearch', 'fltFacilityType', 'fltLocation', 'fltStatus', 'fltInspector', 'fltRisk', 'fltDate'].forEach(function (id) {
      var node = document.getElementById(id);
      if (!node) return;
      node.addEventListener('input', renderRecords);
      node.addEventListener('change', renderRecords);
    });
  }

  function bindQueueCards() {
    var cards = document.querySelectorAll('.queue-card');
    cards.forEach(function (card) {
      card.addEventListener('click', function () {
        var queue = card.getAttribute('data-queue') || '';
        state.activeQueue = state.activeQueue === queue ? '' : queue;
        renderQueueCards();
        renderRecords();
      });
    });
  }

  function initWorkflowDashboard() {
    if (!window.GoilWorkflow) return;
    window.GoilWorkflow.refreshOverdueNotifications();
    var records = window.GoilWorkflow.getRecords();
    bindQueueCards();
    bindFilters(records);
    renderQueueCards();
    renderRecords();
    renderNotifications();
  }

  function init() {
    var emailNode = document.getElementById('portalUserEmail');
    if (emailNode) emailNode.textContent = resolveUserDisplay();

    var logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    bindModuleNav();
  }

  document.addEventListener('DOMContentLoaded', init);
})();

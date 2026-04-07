(function (window) {
  'use strict';

  var ACTION_KEY = 'goil_corrective_actions_store';

  function safeJSON(raw, fallback) {
    try {
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function readJSON(key, fallback) {
    return safeJSON(localStorage.getItem(key) || '', fallback);
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function toDate(value) {
    if (!value) return null;
    var d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function fmtDate(value) {
    var d = toDate(value);
    if (!d) return '-';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function fmtDateTime(value) {
    var d = toDate(value);
    if (!d) return '-';
    return d.toLocaleString();
  }

  function normalizeReference(value) {
    return String(value == null ? '' : value).trim();
  }

  function normalizeVersionNumber(value) {
    var version = Number(value);
    if (!Number.isFinite(version) || version < 1) return 1;
    return Math.floor(version);
  }

  function stripVersionSuffix(referenceNo) {
    var value = normalizeReference(referenceNo);
    if (!value) return '';
    return value
      .replace(/(?:\s*\/\s*|[-_ ]+)v(?:ersion)?[-_ ]?\d+$/i, '')
      .replace(/[-_ ]+$/, '')
      .trim();
  }

  function parseVersionFromToken(value) {
    var token = String(value == null ? '' : value);
    if (!token) return 0;
    var match = token.match(/(?:^|[^A-Z0-9])V(?:ERSION)?[-_ ]?(\d+)(?:$|[^0-9])/i) || token.match(/-v(\d+)$/i);
    if (!match) return 0;
    var parsed = Number(match[1]);
    if (!Number.isFinite(parsed) || parsed < 1) return 0;
    return Math.floor(parsed);
  }

  function getParentInspectionReference(record) {
    if (!record || typeof record !== 'object') return '';
    return stripVersionSuffix(normalizeReference(
      record.master_reference ||
      record.master_assessment_id ||
      record.parent_assessment_id ||
      record.assessment_family_id ||
      record.assessment_family_reference ||
      record.assessment_reference ||
      record.inspectionRef ||
      record.referenceNo ||
      ''
    ));
  }

  function getRecordVersionNumber(record) {
    if (!record || typeof record !== 'object') return 1;
    return normalizeVersionNumber(
      record.version_number ||
      record.version ||
      record.versionCurrent ||
      parseVersionFromToken(
        record.assessment_version_id ||
        record.assessment_record_id ||
        record.display_reference ||
        record.displayReference ||
        record.snapshotId
      ) ||
      1
    );
  }

  function formatDisplayReference(referenceNo, versionNumber) {
    var base = stripVersionSuffix(referenceNo) || '-';
    var version = normalizeVersionNumber(versionNumber);
    return base + '-v' + String(version);
  }

  function formatDisplayReferenceForRecord(record) {
    return formatDisplayReference(getParentInspectionReference(record), getRecordVersionNumber(record));
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getStatusSet() {
    if (window.GoilWorkflow && window.GoilWorkflow.STATUS) return window.GoilWorkflow.STATUS;
    return {
      DRAFT: 'Draft',
      IN_PROGRESS: 'In Progress',
      PENDING_CORRECTIVE: 'Checklist Submitted / Pending Corrective Action',
      REOPENED: 'Reopened for Revision',
      REVISED_CHECKLIST_SUBMITTED: 'Revised Checklist Submitted',
      PUBLISHED: 'Fully Submitted / Published to Register'
    };
  }

  function getRecords() {
    if (!window.GoilWorkflow || !window.GoilWorkflow.getRecords) return [];
    var records = window.GoilWorkflow.getRecords();
    if (!Array.isArray(records)) return [];
    return records.slice().sort(function (a, b) {
      return new Date(b.lastUpdatedAt || 0) - new Date(a.lastUpdatedAt || 0);
    });
  }

  function isPublishedRecord(record) {
    if (!record || typeof record !== 'object') return false;
    var statusSet = getStatusSet();
    var status = String(record.assessment_status || record.status || '').trim();
    if (status === statusSet.PUBLISHED || status === 'Fully Submitted / Published to Register') return true;
    return record.is_published === true;
  }

  function getPublishedRecords(records) {
    var list = Array.isArray(records) ? records : getRecords();
    return list.filter(function (record) {
      return isPublishedRecord(record);
    });
  }

  function getLatestRecordsByMaster(records) {
    var list = Array.isArray(records) ? records : getRecords();
    if (window.GoilWorkflow && typeof window.GoilWorkflow.getLatestRecordsByMaster === 'function') {
      var latest = window.GoilWorkflow.getLatestRecordsByMaster(list);
      return Array.isArray(latest) ? latest : [];
    }
    var map = {};
    list.forEach(function (record, idx) {
      var key = stripVersionSuffix(String(
        (record && (
          record.master_assessment_id ||
          record.parent_assessment_id ||
          record.assessment_family_id ||
          record.assessment_family_reference ||
          record.master_reference ||
          record.assessment_id ||
          record.assessment_reference ||
          record.inspectionRef
        )) ||
        ''
      ).trim());
      if (!key) key = '__UNREF__' + String(idx);
      var prev = map[key];
      if (!prev) {
        map[key] = record;
        return;
      }
      var prevVersion = Number(prev.version || prev.version_number || 1);
      if (!Number.isFinite(prevVersion) || prevVersion < 1) prevVersion = 1;
      var currVersion = Number(record.version || record.version_number || 1);
      if (!Number.isFinite(currVersion) || currVersion < 1) currVersion = 1;
      if (currVersion > prevVersion) {
        map[key] = record;
        return;
      }
      if (currVersion === prevVersion) {
        var prevTime = new Date(prev.lastUpdatedAt || prev.last_updated_at || 0).getTime();
        var currTime = new Date(record.lastUpdatedAt || record.last_updated_at || 0).getTime();
        if (currTime > prevTime) map[key] = record;
      }
    });
    return Object.keys(map).map(function (key) { return map[key]; });
  }

  function getPublishedLatestRecordsByMaster(records) {
    return getLatestRecordsByMaster(getPublishedRecords(records));
  }

  function getSnapshots() {
    if (!window.GoilWorkflow || !window.GoilWorkflow.getSnapshots) return [];
    var snapshots = window.GoilWorkflow.getSnapshots();
    if (!Array.isArray(snapshots)) return [];
    return snapshots.slice().sort(function (a, b) {
      return new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0);
    });
  }

  function sectionIndexFromSession(session, sectionId) {
    var sections = Array.isArray(session && session.sectionsMeta) ? session.sectionsMeta : [];
    if (!sectionId) return 0;
    var idx = sections.findIndex(function (section) { return section && section.id === sectionId; });
    return idx >= 0 ? idx : 0;
  }

  function findRecord(referenceNo, versionNumber) {
    var records = getRecords();
    if (!referenceNo) return records[0] || null;
    var targetRef = stripVersionSuffix(normalizeReference(referenceNo));
    var matches = records.filter(function (record) {
      var parentRef = getParentInspectionReference(record);
      var localRef = stripVersionSuffix(normalizeReference(record.inspectionRef || record.assessment_reference || ''));
      return parentRef === targetRef || localRef === targetRef;
    });
    if (!matches.length) return null;
    if (versionNumber != null && versionNumber !== '') {
      var version = Number(versionNumber);
      var exact = matches.find(function (record) { return Number(record.version || 0) === version; });
      if (exact) return exact;
    }
    return matches.sort(function (a, b) { return Number(b.version || 0) - Number(a.version || 0); })[0];
  }

  function isOverdueRecord(record) {
    if (window.GoilWorkflow && window.GoilWorkflow.isRecordOverdue) {
      return !!window.GoilWorkflow.isRecordOverdue(record);
    }
    if (!record) return false;
    var status = String(record.status || '');
    if (status.indexOf('Pending') < 0 && status.indexOf('Submitted') < 0) return false;
    var due = toDate(record.correctiveDueDate);
    if (!due) return false;
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    return due < now;
  }

  function riskRank(level) {
    var ranks = { Low: 1, Medium: 2, Moderate: 2, High: 3, Critical: 4 };
    return ranks[level] || 0;
  }

  function highestRisk(levels) {
    var best = 'Low';
    (levels || []).forEach(function (level) {
      if (riskRank(level) > riskRank(best)) best = level;
    });
    return best;
  }

  function upsertAction(store, action) {
    var idx = store.findIndex(function (item) { return item.actionId === action.actionId; });
    if (idx >= 0) store[idx] = Object.assign({}, store[idx], action);
    else store.push(action);
  }

  function isPastDue(dateText) {
    var due = toDate(dateText);
    if (!due) return false;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    return due < today;
  }

  function deriveActionStatus(record, existingStatus, actionDueDate) {
    var STATUS = getStatusSet();
    if (existingStatus) return existingStatus;
    if (record.status === STATUS.PUBLISHED) return 'Verified Closed';
    if (isPastDue(actionDueDate || record.correctiveDueDate)) return 'Overdue';
    if (record.status === STATUS.REOPENED || record.status === STATUS.DRAFT || record.status === STATUS.IN_PROGRESS) return 'In Progress';
    return 'Open';
  }

  function parseRiskLevelFromScore(score) {
    var n = Number(score || 0);
    if (n >= 17) return 'Critical';
    if (n >= 10) return 'High';
    if (n >= 5) return 'Medium';
    return 'Low';
  }

  function normalizeRiskLevel(level) {
    var token = String(level || '').trim().toLowerCase();
    if (token === 'critical' ) return 'Critical';
    if (token === 'high') return 'High';
    if (token === 'medium' || token === 'moderate') return 'Medium';
    if (token === 'low') return 'Low';
    return 'Low';
  }

  function scoreFromRiskLevel(level) {
    var normalized = normalizeRiskLevel(level);
    if (normalized === 'Critical') return 17;
    if (normalized === 'High') return 10;
    if (normalized === 'Medium') return 5;
    return 1;
  }

  function actionRiskUnits(action) {
    var score = Number(action && action.riskScore);
    if (Number.isFinite(score) && score > 0) return score;
    var level = normalizeRiskLevel((action && (action.riskLevel || action.priority)) || 'Low');
    if (level === 'Critical') return 8;
    if (level === 'High') return 5;
    if (level === 'Medium') return 3;
    return 1;
  }

  function actionOpenWeight(status) {
    var normalized = String(status || '').toLowerCase();
    if (normalized === 'verified closed' || normalized === 'closed') return 0;
    if (normalized === 'closed pending verification') return 0.4;
    return 1;
  }

  function idSafe(value, fallback) {
    var out = String(value == null ? '' : value)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!out) return fallback || 'ITEM';
    return out;
  }

  function deriveSnapshotCorrectiveItems(snapshot, record) {
    if (!snapshot || !snapshot.checklist) return [];
    var checklist = snapshot.checklist || {};
    var sectionStates = checklist.sectionStates && typeof checklist.sectionStates === 'object' ? checklist.sectionStates : {};
    var catalog = checklist.catalog && typeof checklist.catalog === 'object' ? checklist.catalog : {};
    var items = [];

    Object.keys(sectionStates).forEach(function (sectionId) {
      var ss = sectionStates[sectionId] || {};
      var responses = ss.responses && typeof ss.responses === 'object' ? ss.responses : {};
      var comments = ss.comments && typeof ss.comments === 'object' ? ss.comments : {};
      Object.keys(responses).forEach(function (code) {
        var response = responses[code];
        if (response !== 'N' && response !== 'P') return;
        var meta = catalog[code] || {};
        var level = meta.crit && response === 'N' ? 'Critical' : (response === 'N' ? 'High' : 'Medium');
        var priority = meta.crit ? 'Critical' : (response === 'N' ? 'High' : 'Medium');
        var issue = meta.question || code;
        var recommendation = meta.action || meta.question || code;
        items.push({
          sourceType: 'checklist',
          sourceCode: code,
          sourceComment: comments[code] || '',
          issue: issue,
          recommendedAction: recommendation,
          description: recommendation,
          riskLevel: normalizeRiskLevel(level),
          priority: priority,
          riskScore: actionRiskUnits({ riskLevel: level }),
          sectionId: meta.sectionId || sectionId,
          sectionLabel: meta.sectionLabel || sectionId
        });
      });
    });

    var findings = Array.isArray(checklist.findings) ? checklist.findings : [];
    findings.forEach(function (finding, idx) {
      var findingCode = (finding && finding.findingId) || ('FND-' + String(idx + 1));
      var level = normalizeRiskLevel((finding && finding.riskLevel) || parseRiskLevelFromScore(finding && finding.riskScore));
      var priority = level === 'Critical' ? 'Critical' : level === 'High' ? 'High' : level === 'Medium' ? 'Medium' : 'Low';
      var findingIssue = (finding && finding.observation) || findingCode;
      var findingRecommendation = (finding && finding.recommendedAction) || findingIssue || 'Additional finding requires corrective action';
      items.push({
        sourceType: 'finding',
        sourceCode: findingCode,
        sourceComment: (finding && finding.observation) || '',
        issue: findingIssue,
        recommendedAction: findingRecommendation,
        description: findingRecommendation,
        riskLevel: level,
        priority: priority,
        riskScore: actionRiskUnits({ riskLevel: level }),
        sectionId: (finding && finding.linkedSectionId) || 'general',
        sectionLabel: (finding && finding.linkedSectionLabel) || 'General Finding'
      });
    });

    if (!items.length && Number(record.failedCount || 0) > 0) {
      var summaryIssue = 'Assessment generated corrective actions from failed/non-compliant findings.';
      var summaryRecommendation = record.correctiveSummary || (record.failedCount + ' corrective finding(s) require closure');
      items.push({
        sourceType: 'summary',
        sourceCode: 'A1',
        sourceComment: '',
        issue: summaryIssue,
        recommendedAction: summaryRecommendation,
        description: summaryRecommendation,
        riskLevel: normalizeRiskLevel(record.overallRiskLevel || 'Medium'),
        priority: normalizeRiskLevel(record.overallRiskLevel || 'Medium'),
        riskScore: actionRiskUnits({ riskLevel: normalizeRiskLevel(record.overallRiskLevel || 'Medium') }),
        sectionId: 'summary',
        sectionLabel: 'Assessment Summary'
      });
    }

    return items;
  }

  function buildActionId(record, item, index) {
    return (record.inspectionRef || 'REF') + '-V' + (record.version || 1) + '-' + idSafe(item.sourceCode, 'A' + String(index + 1));
  }

  function seedActionsFromRecords(records) {
    var stored = readJSON(ACTION_KEY, []);
    if (!Array.isArray(stored)) stored = [];

    var merged = stored.slice();
    var snapshots = getSnapshots();
    var snapshotByKey = {};
    snapshots.forEach(function (snapshot) {
      var key = String(snapshot.inspectionRef || '') + '::' + String(snapshot.version || '');
      if (!snapshotByKey[key]) snapshotByKey[key] = snapshot;
    });

    (records || []).forEach(function (record) {
      var failedCount = Number(record.failedCount || 0);
      var key = String(record.inspectionRef || '') + '::' + String(record.version || '');
      var snapshot = snapshotByKey[key] || null;
      if (!snapshot && window.GoilWorkflow && window.GoilWorkflow.getMeta) {
        var activeMeta = window.GoilWorkflow.getMeta({});
        if (activeMeta && activeMeta.referenceNo === record.inspectionRef) {
          var activeChecklist = readJSON('goil_checklist_session', {});
          if (activeChecklist && typeof activeChecklist === 'object') {
            snapshot = {
              inspectionRef: record.inspectionRef,
              version: record.version,
              checklist: activeChecklist
            };
          }
        }
      }
      var correctiveItems = deriveSnapshotCorrectiveItems(snapshot, record);

      if (failedCount <= 0 && correctiveItems.length === 0) return;

      // Remove legacy single-summary synthetic row once richer itemized actions exist.
      if (correctiveItems.length > 1) {
        var legacyId = (record.inspectionRef || 'REF') + '-V' + (record.version || 1) + '-A1';
        merged = merged.filter(function (row) { return row.actionId !== legacyId; });
      }

      correctiveItems.forEach(function (item, idx) {
        var actionId = buildActionId(record, item, idx);
        var existing = stored.find(function (row) { return row.actionId === actionId; }) || {};
        var issueText = existing.issue || item.issue || item.sourceComment || item.sourceCode || '';
        var recommendedAction = existing.recommendedAction || existing.description || item.recommendedAction || item.description || record.correctiveSummary || (failedCount + ' corrective finding(s) require closure');
        var owner = existing.originalAssessor || record.inspector || record.assessor_name || 'Unknown Assessor';
        var resolvedRiskScore = Number(existing.riskScore || item.riskScore || actionRiskUnits({ riskLevel: item.riskLevel || record.overallRiskLevel || 'Low' }));
        if (!Number.isFinite(resolvedRiskScore) || resolvedRiskScore < 0) resolvedRiskScore = 0;
        var resolvedRiskLevel = resolvedRiskScore > 0
          ? parseRiskLevelFromScore(resolvedRiskScore)
          : normalizeRiskLevel(item.riskLevel || record.overallRiskLevel || 'Low');

        upsertAction(merged, {
          actionId: actionId,
          inspectionRef: record.inspectionRef || '-',
          facilityName: record.facilityName || 'Unknown Facility',
          location: record.location || '',
          originalAssessor: owner,
          correctiveCreatedBy: existing.correctiveCreatedBy || owner,
          riskLevel: resolvedRiskLevel,
          riskScore: resolvedRiskScore,
          dueDate: existing.dueDate || item.dueDate || record.correctiveDueDate || '',
          latestAssessmentDate: record.inspectionDate || '',
          issue: issueText,
          recommendedAction: recommendedAction,
          description: recommendedAction,
          priority: existing.priority || item.priority || normalizeRiskLevel(record.overallRiskLevel || 'Medium'),
          status: deriveActionStatus(record, existing.status, existing.dueDate || item.dueDate || record.correctiveDueDate),
          sourceCode: item.sourceCode || '',
          sourceType: item.sourceType || '',
          sourceComment: item.sourceComment || '',
          sectionId: item.sectionId || '',
          sectionLabel: item.sectionLabel || '',
          closureMethod: existing.closureMethod || existing.closedHow || '',
          closureMethodOther: existing.closureMethodOther || '',
          closedHow: existing.closedHow || '',
          closureComments: existing.closureComments || '',
          closureDate: existing.closureDate || '',
          closedBy: existing.closedBy || '',
          verifiedClosedBy: existing.verifiedClosedBy || '',
          verifiedClosedAt: existing.verifiedClosedAt || '',
          evidenceName: existing.evidenceName || '',
          evidenceUploadedAt: existing.evidenceUploadedAt || ''
        });
      });
    });

    writeJSON(ACTION_KEY, merged);
    return merged.sort(function (a, b) {
      return new Date(b.latestAssessmentDate || 0) - new Date(a.latestAssessmentDate || 0);
    });
  }

  function getActions() {
    return seedActionsFromRecords(getRecords());
  }

  function actionVersionFromId(actionId) {
    var match = String(actionId || '').match(/-V(\d+)-/i);
    if (!match) return 1;
    var parsed = Number(match[1]);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return Math.floor(parsed);
  }

  function recordScopeKey(record) {
    if (!record || typeof record !== 'object') return '';
    var ref = normalizeReference(record.inspectionRef || record.assessment_reference || record.assessmentReference || getParentInspectionReference(record) || '');
    if (!ref) return '';
    var version = getRecordVersionNumber(record);
    return stripVersionSuffix(ref) + '::' + String(normalizeVersionNumber(version));
  }

  function actionScopeKey(action) {
    if (!action || typeof action !== 'object') return '';
    var ref = normalizeReference(action.inspectionRef || action.assessment_reference || action.assessmentReference || '');
    if (!ref) return '';
    var version = normalizeVersionNumber(action.version_number || action.version || actionVersionFromId(action.actionId));
    return stripVersionSuffix(ref) + '::' + String(version);
  }

  function filterActionsByRecords(actions, records) {
    var sourceActions = Array.isArray(actions) ? actions : [];
    var sourceRecords = Array.isArray(records) ? records : [];
    if (!sourceActions.length || !sourceRecords.length) return [];

    var allowedKeys = new Set();
    sourceRecords.forEach(function (record) {
      var key = recordScopeKey(record);
      if (key) allowedKeys.add(key);
    });
    if (!allowedKeys.size) return [];

    return sourceActions.filter(function (action) {
      var key = actionScopeKey(action);
      return !!(key && allowedKeys.has(key));
    });
  }

  function getPublishedActions(options) {
    var opts = options || {};
    var allActions = Array.isArray(opts.actions) ? opts.actions : getActions();
    var allRecords = Array.isArray(opts.records) ? opts.records : getRecords();
    var scopedRecords = opts.latestByMaster === false
      ? getPublishedRecords(allRecords)
      : getPublishedLatestRecordsByMaster(allRecords);
    return filterActionsByRecords(allActions, scopedRecords);
  }

  function purgeUnpublishedActions(options) {
    var opts = options || {};
    var allActions = Array.isArray(opts.actions) ? opts.actions : getActions();
    var publishedActions = getPublishedActions({
      actions: allActions,
      records: opts.records,
      latestByMaster: opts.latestByMaster
    });
    if (publishedActions.length !== allActions.length) {
      saveActions(publishedActions);
    }
    return publishedActions;
  }

  function isActionForRecord(action, record) {
    if (!action || !record) return false;
    if (String(action.inspectionRef || '') !== String(record.inspectionRef || record.assessment_reference || '')) return false;
    var version = Number(record.version || record.version_number || 1);
    var token = '-V' + String(version) + '-';
    return String(action.actionId || '').indexOf(token) >= 0;
  }

  function getRiskSnapshotForRecord(record, actions) {
    var initialScore = Number(record && record.overallRiskScore);
    if (!Number.isFinite(initialScore)) {
      initialScore = scoreFromRiskLevel((record && record.overallRiskLevel) || 'Low');
    }
    var initialLevel = parseRiskLevelFromScore(initialScore);
    var sourceActions = (Array.isArray(actions) ? actions : getActions()).filter(function (action) {
      return isActionForRecord(action, record);
    });
    if (!sourceActions.length) {
      return {
        initialScore: initialScore,
        initialLevel: initialLevel,
        residualScore: initialScore,
        residualLevel: initialLevel,
        riskReduction: 0,
        openCount: 0,
        closedCount: 0
      };
    }

    var totalUnits = sourceActions.reduce(function (acc, action) {
      return acc + actionRiskUnits(action);
    }, 0);
    var openUnits = sourceActions.reduce(function (acc, action) {
      return acc + (actionRiskUnits(action) * actionOpenWeight(action.status));
    }, 0);
    var residualScore = totalUnits > 0
      ? Math.max(0, Math.round((initialScore * (openUnits / totalUnits)) * 10) / 10)
      : initialScore;
    var reduction = Math.max(0, Math.round((initialScore - residualScore) * 10) / 10);
    var closedCount = sourceActions.filter(function (action) {
      var s = String(action.status || '').toLowerCase();
      return s === 'closed' || s === 'verified closed';
    }).length;
    var openCount = sourceActions.length - closedCount;

    return {
      initialScore: initialScore,
      initialLevel: initialLevel,
      residualScore: residualScore,
      residualLevel: parseRiskLevelFromScore(residualScore),
      riskReduction: reduction,
      openCount: openCount,
      closedCount: closedCount
    };
  }

  function getDashboardMetrics() {
    var records = getLatestRecordsByMaster(getRecords());
    var actions = getActions();
    var status = getStatusSet();

    var criticalFindings = actions.filter(function (action) {
      var isHigh = action.riskLevel === 'High' || action.riskLevel === 'Critical';
      var s = String(action.status || '').toLowerCase();
      return isHigh && s !== 'closed' && s !== 'verified closed';
    }).length;
    if (!criticalFindings) {
      criticalFindings = records.reduce(function (acc, record) {
        var explicit = Number(record.criticalFindingsCount || 0);
        if (explicit > 0) return acc + explicit;
        if (record.overallRiskLevel === 'Critical') return acc + Number(record.failedCount || 0);
        return acc;
      }, 0);
    }

    var overdueCorrective = actions.filter(function (action) { return action.status === 'Overdue'; }).length;
    var unpublished = records.filter(function (record) { return !record.is_published; }).length;
    var pendingFinal = records.filter(function (record) {
      return !record.is_published && (record.status === status.PENDING_CORRECTIVE || record.status === status.REVISED_CHECKLIST_SUBMITTED);
    }).length;

    var recentPublished = records.filter(function (record) {
      if (!record.is_published) return false;
      var d = toDate(record.publishedAt || record.correctiveSubmittedAt);
      if (!d) return false;
      return (Date.now() - d.getTime()) <= 1000 * 60 * 60 * 24 * 14;
    }).length;

    var latestByFacility = {};
    records.forEach(function (record) {
      var keyFacility = String(record.facilityName || '').trim();
      if (!keyFacility) return;
      var prev = latestByFacility[keyFacility];
      if (!prev || new Date(record.lastUpdatedAt || 0) > new Date(prev.lastUpdatedAt || 0)) {
        latestByFacility[keyFacility] = record;
      }
    });
    var highRiskFacilities = Object.keys(latestByFacility).filter(function (facilityName) {
      var row = latestByFacility[facilityName];
      var risk = getRiskSnapshotForRecord(row, actions);
      return risk.residualLevel === 'High' || risk.residualLevel === 'Critical';
    }).length;

    var urgent = [];
    records.filter(function (record) { return isOverdueRecord(record); }).slice(0, 6).forEach(function (record) {
      urgent.push({
        title: (record.facilityName || '-') + ' · Overdue corrective action',
        meta: (record.inspectionRef || '-') + ' · Due ' + (record.correctiveDueDate || '-') + ' · ' + (record.overallRiskLevel || 'Unrated')
      });
    });

    records.filter(function (record) {
      var risk = getRiskSnapshotForRecord(record, actions);
      return risk.residualLevel === 'Critical' || risk.residualLevel === 'High';
    }).slice(0, 6).forEach(function (record) {
      var risk = getRiskSnapshotForRecord(record, actions);
      urgent.push({
        title: (record.facilityName || '-') + ' · Residual ' + (risk.residualLevel || 'High') + ' risk',
        meta: (record.inspectionRef || '-') + ' · Initial ' + risk.initialScore + ' / Residual ' + risk.residualScore + ' · Status: ' + (record.status || '-')
      });
    });

    return {
      records: records,
      actions: actions,
      criticalFindings: criticalFindings,
      overdueCorrective: overdueCorrective,
      unpublished: unpublished,
      pendingFinal: pendingFinal,
      recentPublished: recentPublished,
      highRiskFacilities: highRiskFacilities,
      urgentItems: urgent.slice(0, 10)
    };
  }

  function getFolderCounts() {
    var records = getRecords();
    var latestByMaster = getLatestRecordsByMaster(records);
    var publishedLatestByMaster = getPublishedLatestRecordsByMaster(records);
    var publishedActions = getPublishedActions({ records: records, latestByMaster: true });

    // Dashboard card: keep "Critical Items" aligned to published operational risk load.
    var criticalItems = publishedActions.filter(function (action) {
      var status = String(action.status || '').toLowerCase();
      var isOpen = status === 'open' || status === 'in progress' || status === 'overdue' || status === 'closed pending verification';
      if (!isOpen) return false;
      var level = normalizeRiskLevel(action.riskLevel || action.priority || '');
      return level === 'High' || level === 'Critical';
    }).length;

    // Corrections card: must reflect the same scope as Corrections register (published only).
    var correctiveOpenOrOverdue = publishedActions.filter(function (action) {
      var status = String(action.status || '').toLowerCase();
      return status === 'open' || status === 'in progress' || status === 'overdue' || status === 'closed pending verification';
    }).length;

    // Uncompleted card: distinct master references whose latest record is not published.
    var unpublishedMasterCount = latestByMaster.filter(function (record) {
      return !record.is_published;
    }).length;

    // Published card: same master-reference scope as Published Register default latest view.
    var publishedMasterCount = publishedLatestByMaster.length;

    // Facility Profile card: unique facilities with published master records.
    var publishedFacilitiesCount = uniqueFacilities(publishedLatestByMaster).length;

    return {
      dashboard: criticalItems,
      uncompleted: unpublishedMasterCount,
      published: publishedMasterCount,
      corrections: correctiveOpenOrOverdue,
      facilities: publishedFacilitiesCount
    };
  }

  function saveActions(actions) {
    writeJSON(ACTION_KEY, Array.isArray(actions) ? actions : []);
  }

  function summarizeActionsByFacility(actions) {
    var map = new Map();
    (actions || []).forEach(function (action) {
      var key = action.facilityName || 'Unknown Facility';
      if (!map.has(key)) {
        map.set(key, {
          facilityName: key,
          open: 0,
          overdue: 0,
          closed: 0,
          latestAssessmentDate: action.latestAssessmentDate || '',
          highestRisk: action.riskLevel || 'Low'
        });
      }
      var row = map.get(key);
      if (action.status === 'Closed' || action.status === 'Verified Closed') row.closed += 1;
      else if (action.status === 'Overdue') row.overdue += 1;
      else row.open += 1;

      if (toDate(action.latestAssessmentDate) && toDate(action.latestAssessmentDate) > toDate(row.latestAssessmentDate)) {
        row.latestAssessmentDate = action.latestAssessmentDate;
      }
      row.highestRisk = highestRisk([row.highestRisk, action.riskLevel]);
    });

    return Array.from(map.values()).sort(function (a, b) {
      return (b.overdue - a.overdue) || (b.open - a.open);
    });
  }

  function uniqueFacilities(records) {
    var set = new Set((records || []).map(function (r) { return r.facilityName; }).filter(Boolean));
    return Array.from(set).sort();
  }

  function startNewAssessmentContext() {
    [
      'goil_facility_details',
      'goil_checklist_session',
      'goil_current_section',
      'goil_review_state',
      'goil_corrective_action_session'
    ].forEach(function (key) {
      localStorage.removeItem(key);
    });

    if (!window.GoilWorkflow) return;
    var metaKey = window.GoilWorkflow.KEYS && window.GoilWorkflow.KEYS.meta ? window.GoilWorkflow.KEYS.meta : 'goil_inspection_meta';
    localStorage.removeItem(metaKey);

    var meta = window.GoilWorkflow.getMeta({});
    var now = window.GoilWorkflow.nowIso ? window.GoilWorkflow.nowIso() : new Date().toISOString();
    meta.status = window.GoilWorkflow.STATUS.DRAFT;
    meta.versionCurrent = 0;
    meta.versionHistory = [];
    meta.checklistLocked = false;
    meta.revisionOpen = false;
    meta.reopenReason = '';
    meta.lastSnapshotId = '';
    meta.checklistSubmittedAt = '';
    meta.correctiveSubmittedAt = '';
    meta.publishedToRegisterAt = '';
    meta.overallRisk = {};
    meta.overallRiskCalculatedAt = '';
    meta.facilityName = '';
    meta.facilityType = '';
    meta.location = '';
    meta.inspectionDate = '';
    meta.inspectorName = '';
    meta.lastPage = 'facility';
    meta.createdAt = now;
    meta.lastUpdatedAt = now;
    window.GoilWorkflow.saveMeta(meta);
    if (typeof window.GoilWorkflow.initializeDraftRecord === 'function') {
      window.GoilWorkflow.initializeDraftRecord({});
    }
  }

  function goFacilityDetails() {
    startNewAssessmentContext();
    window.location.href = 'GOIL_Facility_Details.html?v=20260318-masterrefdeep6&_=' + Date.now();
  }

  function hydrateFacilityFromRecord(record) {
    var payload = {
      assessorName: record.assessor_name || record.inspector || '',
      assessmentDate: record.assessment_date || record.inspectionDate || '',
      assessmentType: '',
      facilityType: record.facility_type || record.facilityType || '',
      zone: record.location || '',
      nameVal: record.facility_name || record.facilityName || '',
      nameOther: '',
      nameDisplay: record.facility_name || record.facilityName || ''
    };
    writeJSON('goil_facility_details', payload);
  }

  function hydrateMetaFromRecord(record) {
    if (!window.GoilWorkflow) return;
    var meta = window.GoilWorkflow.getMeta({});
    meta.referenceNo = record.assessment_reference || record.inspectionRef || meta.referenceNo;
    meta.versionCurrent = Number(record.version_number || record.version || meta.versionCurrent || 1);
    meta.status = record.assessment_status || record.status || meta.status;
    meta.lastPage = (meta.status === window.GoilWorkflow.STATUS.PENDING_CORRECTIVE || meta.status === window.GoilWorkflow.STATUS.REVISED_CHECKLIST_SUBMITTED)
      ? 'corrective'
      : (meta.status === window.GoilWorkflow.STATUS.PUBLISHED ? 'home' : 'checklist');
    meta.facilityName = record.facility_name || record.facilityName || meta.facilityName || '';
    meta.facilityType = record.facility_type || record.facilityType || meta.facilityType || '';
    meta.location = record.location || meta.location || '';
    meta.inspectionDate = record.assessment_date || record.inspectionDate || meta.inspectionDate || '';
    meta.inspectorName = record.assessor_name || record.inspector || meta.inspectorName || '';
    meta.overallRisk = {
      level: record.overall_risk_level || record.overallRiskLevel || '',
      score: Number(record.overall_risk_score != null ? record.overall_risk_score : record.overallRiskScore || 0)
    };
    meta.overallRiskCalculatedAt = record.last_updated_at || record.lastUpdatedAt || meta.overallRiskCalculatedAt || '';
    meta.checklistSubmittedAt = record.checklist_submitted_at || record.checklistSubmittedAt || '';
    meta.correctiveSubmittedAt = record.corrective_action_submitted_at || record.correctiveSubmittedAt || '';
    meta.publishedToRegisterAt = record.final_submitted_at || record.publishedAt || '';
    meta.checklistLocked = meta.status === window.GoilWorkflow.STATUS.PUBLISHED || meta.status === window.GoilWorkflow.STATUS.PENDING_CORRECTIVE || meta.status === window.GoilWorkflow.STATUS.REVISED_CHECKLIST_SUBMITTED;
    window.GoilWorkflow.saveMeta(meta);
  }

  function hydrateChecklistAndCorrectiveFromRecord(record) {
    var snapshots = getSnapshots();
    var snapshot = snapshots.find(function (item) {
      return item.inspectionRef === record.inspectionRef && Number(item.version || 0) === Number(record.version || 0);
    });
    var sectionIndex = Number(record.current_section_index || record.currentSectionIndex || 0);
    if (!Number.isFinite(sectionIndex) || sectionIndex < 0) sectionIndex = 0;

    if (snapshot && snapshot.checklist) {
      writeJSON('goil_checklist_session', snapshot.checklist);
      if (!Number.isFinite(sectionIndex) || sectionIndex < 0) {
        sectionIndex = sectionIndexFromSession(snapshot.checklist, record.current_section_id || record.currentSectionId || '');
      }
    }
    localStorage.setItem('goil_current_section', String(sectionIndex));

    var actions = getActions().filter(function (action) {
      if (String(action.inspectionRef || '') !== String(record.inspectionRef || '')) return false;
      return String(action.actionId || '').indexOf('-V' + String(record.version || 1) + '-') >= 0;
    });
    if (actions.length) {
      var items = actions.map(function (action, idx) {
        return {
          id: action.actionId || ('CA-' + String(idx + 1).padStart(3, '0')),
          sourceCode: action.sourceCode || action.actionId || ('ITEM-' + (idx + 1)),
          sourceQuestion: action.issue || action.sourceComment || action.sourceCode || action.actionId || '',
          sectionId: action.sectionId || 'summary',
          sectionLabel: action.sectionLabel || 'Assessment Summary',
          sourceResponse: action.riskLevel === 'Critical' || action.riskLevel === 'High' ? 'N' : 'P',
          sourceComment: action.sourceComment || '',
          correctiveAction: action.recommendedAction || action.description || '',
          responsiblePerson: action.closedBy || '',
          dueDate: action.dueDate || '',
          priority: action.priority || action.riskLevel || '',
          assessorReviewComments: action.closureComments || '',
          evidence: action.evidenceName ? [{
            name: action.evidenceName,
            type: '',
            size: 0,
            caption: action.closureComments || 'Closure evidence',
            uploadedAt: action.evidenceUploadedAt || ''
          }] : [],
          createdAt: record.checklistSubmittedAt || record.lastUpdatedAt || new Date().toISOString(),
          updatedAt: record.lastUpdatedAt || new Date().toISOString(),
          changeHistory: []
        };
      });
      writeJSON('goil_corrective_action_session', {
        status: record.status || '',
        createdAt: record.checklistSubmittedAt || record.lastUpdatedAt || new Date().toISOString(),
        lastSavedAt: new Date().toISOString(),
        sourceChecklistSubmittedAt: record.checklistSubmittedAt || '',
        overallRisk: {
          score: Number(record.overallRiskScore || 0),
          level: record.overallRiskLevel || '',
          calculatedAt: record.lastUpdatedAt || '',
          summary: '',
          source: 'System-generated based on checklist findings and additional findings.'
        },
        items: items
      });
    }
  }

  function openAssessmentRecord(referenceNo, versionNumber) {
    var record = findRecord(referenceNo, versionNumber);
    if (!record) {
      window.location.href = 'GOIL_Checklist_Section1.html?v=20260318-masterrefdeep6&_=' + Date.now();
      return;
    }
    hydrateFacilityFromRecord(record);
    hydrateMetaFromRecord(record);
    hydrateChecklistAndCorrectiveFromRecord(record);

    var status = getStatusSet();
    var stepText = String(record.current_step || record.currentStage || '').toLowerCase();

    if (record.status === status.PENDING_CORRECTIVE || record.status === status.REVISED_CHECKLIST_SUBMITTED) {
      window.location.href = 'GOIL_Corrective_Action.html?v=20260318-masterrefdeep6&_=' + Date.now();
      return;
    }
    if (record.status === status.PUBLISHED) {
      window.location.href = 'GOIL_Review_Submit.html?v=20260318-masterrefdeep6&_=' + Date.now();
      return;
    }
    if (stepText.indexOf('facility') >= 0) {
      window.location.href = 'GOIL_Facility_Details.html?v=20260318-masterrefdeep6&_=' + Date.now();
      return;
    }
    if (stepText.indexOf('review') >= 0) {
      window.location.href = 'GOIL_Review_Submit.html?v=20260318-masterrefdeep6&_=' + Date.now();
      return;
    }
    window.location.href = 'GOIL_Checklist_Section1.html?v=20260318-masterrefdeep6&_=' + Date.now();
  }

  function resumeLatestIncomplete() {
    var status = getStatusSet();
    var incomplete = getLatestRecordsByMaster(getRecords()).filter(function (record) { return record.status !== status.PUBLISHED; });
    if (!incomplete.length) {
      goFacilityDetails();
      return;
    }
    openAssessmentRecord(incomplete[0].inspectionRef, incomplete[0].version);
  }

  function goChecklist(referenceNo, versionNumber) {
    openAssessmentRecord(referenceNo, versionNumber);
  }

  function goLanding() {
    window.location.href = 'risk-inspection.html?v=20260318-masterrefdeep6&_=' + Date.now();
  }

  function goPortal() {
    window.location.href = 'portal.html?v=20260318-masterrefdeep6&_=' + Date.now();
  }

  function normalizeRole(role) {
    return String(role || '').trim().toLowerCase();
  }

  function getCurrentUser() {
    return readJSON('goilUser', {});
  }

  function isOverrideRole(role) {
    var normalized = normalizeRole(role);
    return normalized === 'admin' || normalized === 'supervisor' || normalized === 'reviewer';
  }

  function canUserCloseAction(action, user) {
    var actor = user || getCurrentUser();
    var role = normalizeRole(actor.role || actor.userRole || actor.accessRole);
    if (isOverrideRole(role)) return true;

    var userId = String(actor.email || actor.username || actor.id || '').trim().toLowerCase();
    var ownerId = String(action && (action.originalAssessorEmail || action.originalAssessor || action.correctiveCreatedBy) || '').trim().toLowerCase();
    if (userId && ownerId) return userId === ownerId;

    var userName = String(actor.fullName || actor.name || actor.displayName || '').trim().toLowerCase();
    var ownerName = String(action && action.originalAssessor || '').trim().toLowerCase();
    return !!(userName && ownerName && userName === ownerName);
  }

  function canUserVerifyAction(action, user) {
    var actor = user || getCurrentUser();
    var role = normalizeRole(actor.role || actor.userRole || actor.accessRole);
    return isOverrideRole(role) || canUserCloseAction(action, actor);
  }

  window.RiskModuleUtils = {
    ACTION_KEY: ACTION_KEY,
    STATUS: getStatusSet,
    safeJSON: safeJSON,
    readJSON: readJSON,
    writeJSON: writeJSON,
    toDate: toDate,
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    isPublishedRecord: isPublishedRecord,
    getPublishedRecords: getPublishedRecords,
    getPublishedLatestRecordsByMaster: getPublishedLatestRecordsByMaster,
    getParentInspectionReference: getParentInspectionReference,
    getRecordVersionNumber: getRecordVersionNumber,
    formatDisplayReference: formatDisplayReference,
    formatDisplayReferenceForRecord: formatDisplayReferenceForRecord,
    esc: esc,
    getRecords: getRecords,
    getLatestRecordsByMaster: getLatestRecordsByMaster,
    isOverdueRecord: isOverdueRecord,
    riskRank: riskRank,
    highestRisk: highestRisk,
    scoreFromRiskLevel: scoreFromRiskLevel,
    getSnapshots: getSnapshots,
    getActions: getActions,
    getPublishedActions: getPublishedActions,
    purgeUnpublishedActions: purgeUnpublishedActions,
    filterActionsByRecords: filterActionsByRecords,
    getRiskSnapshotForRecord: getRiskSnapshotForRecord,
    isActionForRecord: isActionForRecord,
    saveActions: saveActions,
    summarizeActionsByFacility: summarizeActionsByFacility,
    uniqueFacilities: uniqueFacilities,
    startNewAssessmentContext: startNewAssessmentContext,
    getDashboardMetrics: getDashboardMetrics,
    getFolderCounts: getFolderCounts,
    goFacilityDetails: goFacilityDetails,
    goChecklist: goChecklist,
    openAssessmentRecord: openAssessmentRecord,
    resumeLatestIncomplete: resumeLatestIncomplete,
    getCurrentUser: getCurrentUser,
    canUserCloseAction: canUserCloseAction,
    canUserVerifyAction: canUserVerifyAction,
    isOverrideRole: isOverrideRole,
    goLanding: goLanding,
    goPortal: goPortal
  };
})(window);

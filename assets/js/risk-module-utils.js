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

  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? {} : value));
  }

  function normalizeCorrectiveResponse(value) {
    var response = String(value == null ? '' : value).trim().toUpperCase();
    if (!response) return '';
    if (response === 'NO' || response === 'NON-COMPLIANT' || response === 'NON COMPLIANT') return 'N';
    if (response === 'PARTIAL') return 'P';
    if (response === 'YES' || response === 'COMPLIANT') return 'Y';
    if (response === 'NA' || response === 'N/A' || response === 'NOT APPLICABLE') return 'NA';
    if (response === 'N' || response === 'P' || response === 'Y') return response;
    return '';
  }

  function normalizeCorrectiveItems(items) {
    if (!Array.isArray(items)) return [];
    return items
      .filter(function (item) { return item && typeof item === 'object'; })
      .map(function (item, idx) {
        var normalizedResponse = normalizeCorrectiveResponse(
          item.sourceResponse || item.response || item.status
        );
        return {
          id: item.id || item.actionId || ('CA-' + String(idx + 1).padStart(3, '0')),
          sourceCode: item.sourceCode || item.code || item.actionId || ('ITEM-' + String(idx + 1)),
          sourceQuestion: item.sourceQuestion || item.issue || item.question || item.sourceComment || item.sourceCode || item.code || '',
          sectionId: item.sectionId || '',
          sectionLabel: item.sectionLabel || '',
          sourceResponse: normalizedResponse,
          sourceComment: item.sourceComment || item.comment || item.issue || '',
          correctiveAction: item.correctiveAction || item.recommendedAction || item.description || '',
          responsiblePerson: item.responsiblePerson || item.closedBy || '',
          dueDate: item.dueDate || '',
          priority: item.priority || item.riskLevel || '',
          assessorReviewComments: item.assessorReviewComments || item.closureComments || '',
          evidence: Array.isArray(item.evidence) ? clone(item.evidence) : [],
          createdAt: item.createdAt || '',
          updatedAt: item.updatedAt || '',
          changeHistory: Array.isArray(item.changeHistory) ? clone(item.changeHistory) : []
        };
      });
  }

  function getRecordCorrectiveItems(record) {
    if (!record || typeof record !== 'object') return [];
    if (Array.isArray(record.correctiveItems)) return normalizeCorrectiveItems(record.correctiveItems);
    if (Array.isArray(record.corrective_items)) return normalizeCorrectiveItems(record.corrective_items);
    if (record.correctiveSession && Array.isArray(record.correctiveSession.items)) {
      return normalizeCorrectiveItems(record.correctiveSession.items);
    }
    if (record.corrective_session && Array.isArray(record.corrective_session.items)) {
      return normalizeCorrectiveItems(record.corrective_session.items);
    }
    return [];
  }

  function isSummaryCorrectiveItem(item) {
    if (!item || typeof item !== 'object') return true;
    var sourceCode = String(item.sourceCode || item.code || '').trim();
    var sectionId = String(item.sectionId || '').trim().toLowerCase();
    var question = String(item.sourceQuestion || item.issue || '').trim().toLowerCase();
    if (sectionId && sectionId !== 'summary') return false;
    if (sourceCode && !/^(A\d+|ITEM-\d+)$/i.test(sourceCode)) return false;
    if (question && question.indexOf('assessment generated corrective actions') < 0) return false;
    return true;
  }

  function correctivePayloadRank(items) {
    var normalized = normalizeCorrectiveItems(items);
    if (!normalized.length) return 0;
    var hasDetailedItem = normalized.some(function (item) { return !isSummaryCorrectiveItem(item); });
    return (hasDetailedItem ? 100 : 10) + normalized.length;
  }

  function choosePreferredCorrectiveItems() {
    var best = [];
    var bestRank = 0;
    for (var i = 0; i < arguments.length; i += 1) {
      var candidate = normalizeCorrectiveItems(arguments[i]);
      var candidateRank = correctivePayloadRank(candidate);
      if (candidateRank > bestRank) {
        best = candidate;
        bestRank = candidateRank;
      }
    }
    return best;
  }

  function correctivePayloadMatchesRecord(payload, recordRef, recordVersion) {
    if (!payload || !Array.isArray(payload.items) || !payload.items.length) return false;
    var payloadRef = stripVersionSuffix(normalizeReference(payload.inspectionRef || payload.referenceNo || ''));
    var payloadVersion = normalizeVersionNumber(payload.version || payload.version_number || 1);
    if (payloadRef && recordRef && payloadRef !== recordRef) return false;
    return payloadVersion === recordVersion;
  }

  function buildCorrectiveSessionPayload(items, record, recordRef, recordVersion, seed) {
    var normalizedItems = normalizeCorrectiveItems(items);
    if (!normalizedItems.length) return null;
    var base = seed && typeof seed === 'object' ? seed : {};
    return {
      inspectionRef: recordRef,
      version: recordVersion,
      facilityName: record.facility_name || record.facilityName || base.facilityName || '',
      assessmentDate: record.assessment_date || record.inspectionDate || base.assessmentDate || '',
      status: record.status || base.status || '',
      createdAt: base.createdAt || record.checklistSubmittedAt || record.lastUpdatedAt || new Date().toISOString(),
      lastSavedAt: new Date().toISOString(),
      sourceChecklistSubmittedAt: base.sourceChecklistSubmittedAt || record.checklistSubmittedAt || '',
      overallRisk: base.overallRisk || {
        score: Number(record.overallRiskScore || 0),
        level: record.overallRiskLevel || '',
        calculatedAt: record.lastUpdatedAt || '',
        summary: '',
        source: 'System-generated based on checklist findings and additional findings.'
      },
      items: normalizedItems
    };
  }

  function mapCorrectiveItemsToActions(record) {
    var fallbackRiskLevel = normalizeRiskLevel((record && record.overallRiskLevel) || 'Medium');
    return getRecordCorrectiveItems(record).map(function (item) {
      var response = normalizeCorrectiveResponse(item.sourceResponse);
      var resolvedLevel = normalizeRiskLevel(
        item.priority ||
        item.riskLevel ||
        (response === 'N' ? 'High' : response === 'P' ? 'Medium' : fallbackRiskLevel)
      );
      return {
        sourceType: 'record-corrective',
        sourceCode: item.sourceCode || '',
        sourceQuestion: item.sourceQuestion || '',
        sourceResponse: response,
        sourceComment: item.sourceComment || '',
        issue: item.sourceQuestion || item.sourceComment || item.sourceCode || '',
        recommendedAction: item.correctiveAction || item.sourceQuestion || item.sourceCode || '',
        description: item.correctiveAction || item.sourceQuestion || item.sourceCode || '',
        riskLevel: resolvedLevel,
        priority: item.priority || resolvedLevel,
        riskScore: Number(item.riskScore || actionRiskUnits({ riskLevel: resolvedLevel })) || actionRiskUnits({ riskLevel: resolvedLevel }),
        sectionId: item.sectionId || '',
        sectionLabel: item.sectionLabel || '',
        dueDate: item.dueDate || ''
      };
    });
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

  function getAuthContext() {
    return window.GOIL_AUTH_CONTEXT && typeof window.GOIL_AUTH_CONTEXT === 'object'
      ? window.GOIL_AUTH_CONTEXT
      : {};
  }

  function isAdminLikeRole(role) {
    var normalized = normalizeRole(role);
    return normalized === 'admin' || normalized === 'administrator' || normalized === 'super-admin' || normalized === 'super admin';
  }

  function findSnapshotForRecord(record, snapshotList) {
    if (!record || typeof record !== 'object') return null;
    var ref = stripVersionSuffix(normalizeReference(
      record.inspectionRef ||
      record.assessment_reference ||
      record.assessmentReference ||
      getParentInspectionReference(record) ||
      ''
    ));
    if (!ref) return null;
    var version = getRecordVersionNumber(record);
    var list = Array.isArray(snapshotList) ? snapshotList : getSnapshots();
    for (var i = list.length - 1; i >= 0; i -= 1) {
      var snapshot = list[i] || {};
      var snapshotRef = stripVersionSuffix(normalizeReference(snapshot.inspectionRef || snapshot.referenceNo || ''));
      var snapshotVersion = normalizeVersionNumber(
        snapshot.version ||
        snapshot.version_number ||
        parseVersionFromToken(snapshot.snapshotId) ||
        0
      );
      if (snapshotRef === ref && snapshotVersion === version) return snapshot;
    }
    return null;
  }

  function buildEmbeddedSnapshotFromRecord(record) {
    if (!record || typeof record !== 'object') return null;
    var checklist = null;
    if (record.checklistSnapshot && typeof record.checklistSnapshot === 'object') {
      checklist = clone(record.checklistSnapshot);
    } else if (record.checklist_snapshot && typeof record.checklist_snapshot === 'object') {
      checklist = clone(record.checklist_snapshot);
    }
    if (!checklist || typeof checklist !== 'object') return null;
    return {
      snapshotId: String(record.snapshotId || record.lastSnapshotId || '').trim(),
      inspectionRef: stripVersionSuffix(normalizeReference(
        record.inspectionRef ||
        record.assessment_reference ||
        record.assessmentReference ||
        getParentInspectionReference(record) ||
        ''
      )),
      version: getRecordVersionNumber(record),
      submissionRisk: record.submissionRisk && typeof record.submissionRisk === 'object'
        ? clone(record.submissionRisk)
        : null,
      checklist: checklist
    };
  }

  function snapshotScopeKey(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return '';
    var ref = stripVersionSuffix(normalizeReference(
      snapshot.inspectionRef ||
      snapshot.referenceNo ||
      snapshot.assessment_reference ||
      snapshot.assessmentReference ||
      ''
    ));
    if (!ref) return '';
    var version = normalizeVersionNumber(
      snapshot.version ||
      snapshot.version_number ||
      parseVersionFromToken(snapshot.snapshotId) ||
      0
    );
    return ref + '::' + String(version);
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
    return base + '-V' + String(version);
  }

  function shouldDisplayVersionForRecord(record) {
    return isPublishedRecord(record) && getRecordVersionNumber(record) >= 1;
  }

  function getPublishedDisplayVersionNumber(record, recordList) {
    if (!record || typeof record !== 'object') return 1;
    var rawVersion = getRecordVersionNumber(record);
    if (!isPublishedRecord(record)) return rawVersion;

    var parentRef = getParentInspectionReference(record);
    if (!parentRef) return rawVersion;

    var targetStamp = String(
      record.final_submitted_at ||
      record.publishedAt ||
      record.correctiveSubmittedAt ||
      record.lastUpdatedAt ||
      record.last_updated_at ||
      ''
    );
    var records = getPublishedRecords(recordList).filter(function (item) {
      return getParentInspectionReference(item) === parentRef;
    });
    if (!records.length) return rawVersion;

    records.sort(function (a, b) {
      var aPublished = toDate(
        a.final_submitted_at ||
        a.publishedAt ||
        a.correctiveSubmittedAt ||
        a.lastUpdatedAt ||
        a.last_updated_at
      );
      var bPublished = toDate(
        b.final_submitted_at ||
        b.publishedAt ||
        b.correctiveSubmittedAt ||
        b.lastUpdatedAt ||
        b.last_updated_at
      );
      var aTs = aPublished ? aPublished.getTime() : 0;
      var bTs = bPublished ? bPublished.getTime() : 0;
      if (aTs !== bTs) return aTs - bTs;
      return getRecordVersionNumber(a) - getRecordVersionNumber(b);
    });

    var matchIndex = records.findIndex(function (item) {
      var itemVersion = getRecordVersionNumber(item);
      if (itemVersion !== rawVersion) return false;
      var itemStamp = String(
        item.final_submitted_at ||
        item.publishedAt ||
        item.correctiveSubmittedAt ||
        item.lastUpdatedAt ||
        item.last_updated_at ||
        ''
      );
      if (targetStamp && itemStamp) return itemStamp === targetStamp;
      return String(item.inspectionRef || item.assessment_reference || '') === String(record.inspectionRef || record.assessment_reference || '');
    });
    if (matchIndex < 0) {
      matchIndex = records.findIndex(function (item) {
        return getRecordVersionNumber(item) === rawVersion;
      });
    }
    return matchIndex >= 0 ? (matchIndex + 1) : rawVersion;
  }

  function getVisibleVersionLabel(record) {
    if (!shouldDisplayVersionForRecord(record)) return '';
    return 'V' + String(getPublishedDisplayVersionNumber(record));
  }

  function formatDisplayReferenceForRecord(record, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var base = getParentInspectionReference(record);
    if (opts.publishedOnly && !shouldDisplayVersionForRecord(record)) return base || '-';
    return formatDisplayReference(base, getRecordVersionNumber(record));
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

  function normalizePublishedVersionSequences() {
    if (!window.GoilWorkflow || !window.GoilWorkflow.KEYS) return;

    var recordKey = window.GoilWorkflow.KEYS.records || 'goil_inspection_records';
    var snapshotKey = window.GoilWorkflow.KEYS.snapshots || 'goil_checklist_snapshots';
    var auditKey = window.GoilWorkflow.KEYS.audit || 'goil_audit_trail';
    var metaKey = window.GoilWorkflow.KEYS.meta || 'goil_inspection_meta';
    var records = readJSON(recordKey, []);
    if (!Array.isArray(records) || !records.length) return;

    var snapshots = readJSON(snapshotKey, []);
    if (!Array.isArray(snapshots)) snapshots = [];

    var auditTrail = readJSON(auditKey, []);
    if (!Array.isArray(auditTrail)) auditTrail = [];

    var actions = readJSON(ACTION_KEY, []);
    if (!Array.isArray(actions)) actions = [];
    var meta = readJSON(metaKey, null);

    var families = {};
    records.forEach(function (record, idx) {
      if (!isPublishedRecord(record)) return;
      var parentRef = getParentInspectionReference(record);
      if (!parentRef) return;
      if (!families[parentRef]) families[parentRef] = [];
      families[parentRef].push({ record: record, idx: idx });
    });

    var mutated = false;

    function publishedStamp(record) {
      var stamp = record && (
        record.final_submitted_at ||
        record.publishedAt ||
        record.correctiveSubmittedAt ||
        record.lastUpdatedAt ||
        record.last_updated_at ||
        ''
      );
      var parsed = toDate(stamp);
      return parsed ? parsed.getTime() : 0;
    }

    Object.keys(families).forEach(function (parentRef) {
      var family = families[parentRef].slice().sort(function (a, b) {
        var aTime = publishedStamp(a.record);
        var bTime = publishedStamp(b.record);
        if (aTime !== bTime) return aTime - bTime;
        return getRecordVersionNumber(a.record) - getRecordVersionNumber(b.record);
      });

      var reopenCount = auditTrail.filter(function (entry) {
        return String(entry && entry.action || '') === 'inspection_reopened_for_revision' &&
          stripVersionSuffix(normalizeReference(entry && entry.inspectionRef || '')) === parentRef;
      }).length;
      var expectedCount = Math.max(1, reopenCount + 1);
      if (expectedCount > family.length) expectedCount = family.length;

      var wasTrimmed = false;
      if (family.length > expectedCount) {
        wasTrimmed = true;
        if (expectedCount <= 1) {
          family = [family[family.length - 1]];
        } else {
          var keepEntries = [family[0]];
          var tail = family.slice(family.length - (expectedCount - 1));
          tail.forEach(function (entry) {
            if (keepEntries.indexOf(entry) < 0) keepEntries.push(entry);
          });
          family = keepEntries;
        }
      }

      family.forEach(function (entry, index) {
        var desiredVersion = index + 1;
        var currentVersion = getRecordVersionNumber(entry.record);
        if (currentVersion === desiredVersion) return;
        mutated = true;

        entry.record.version = desiredVersion;
        entry.record.version_number = desiredVersion;
        entry.record.versionCurrent = desiredVersion;

        if (entry.record.display_reference) {
          entry.record.display_reference = formatDisplayReference(parentRef, desiredVersion);
        }
        if (entry.record.displayReference) {
          entry.record.displayReference = formatDisplayReference(parentRef, desiredVersion);
        }

        snapshots.forEach(function (snapshot) {
          var snapshotRef = stripVersionSuffix(normalizeReference(snapshot.inspectionRef || snapshot.referenceNo || ''));
          if (snapshotRef !== parentRef) return;
          if (normalizeVersionNumber(snapshot.version || snapshot.version_number || parseVersionFromToken(snapshot.snapshotId) || 0) !== currentVersion) return;
          snapshot.version = desiredVersion;
          snapshot.version_number = desiredVersion;
        });

        actions.forEach(function (action) {
          var actionRef = stripVersionSuffix(normalizeReference(action.inspectionRef || action.assessment_reference || action.assessmentReference || ''));
          if (actionRef !== parentRef) return;
          var actionVersion = normalizeVersionNumber(action.version_number || action.version || actionVersionFromId(action.actionId));
          if (actionVersion !== currentVersion) return;
          action.version = desiredVersion;
          action.version_number = desiredVersion;
          if (action.actionId) {
            action.actionId = String(action.actionId).replace(/-V\d+-/i, '-V' + String(desiredVersion) + '-');
          }
        });
      });

      if (meta && stripVersionSuffix(normalizeReference(meta.referenceNo || '')) === parentRef && family.length) {
        meta.versionCurrent = getRecordVersionNumber(family[family.length - 1].record);
        writeJSON(metaKey, meta);
      }

      // Remove discarded records/snapshots/actions whenever the family was trimmed.
      // Previously this only ran for expectedCount===2; now it covers all trim cases,
      // preventing orphaned old-version entries from causing duplicate action IDs.
      if (wasTrimmed) {
        var keepVersions = new Set(family.map(function (e) { return getRecordVersionNumber(e.record); }));
        records = records.filter(function (record) {
          if (!isPublishedRecord(record)) return true;
          var rRef = getParentInspectionReference(record);
          if (rRef !== parentRef) return true;
          return keepVersions.has(getRecordVersionNumber(record));
        });
        snapshots = snapshots.filter(function (snapshot) {
          var sRef = stripVersionSuffix(normalizeReference(snapshot.inspectionRef || snapshot.referenceNo || ''));
          if (sRef !== parentRef) return true;
          return keepVersions.has(normalizeVersionNumber(snapshot.version || snapshot.version_number || parseVersionFromToken(snapshot.snapshotId) || 0));
        });
        actions = actions.filter(function (action) {
          var aRef = stripVersionSuffix(normalizeReference(action.inspectionRef || action.assessment_reference || action.assessmentReference || ''));
          if (aRef !== parentRef) return true;
          return keepVersions.has(normalizeVersionNumber(action.version_number || action.version || actionVersionFromId(action.actionId)));
        });
        mutated = true;
      }
    });

    // Deduplicate actions by actionId — renaming during version normalisation can
    // produce collisions when old-version entries share the same renamed ID.
    var seenActionIds = {};
    var dedupedActions = [];
    actions.forEach(function (action) {
      var id = action && action.actionId;
      if (!id) { dedupedActions.push(action); return; }
      if (!Object.prototype.hasOwnProperty.call(seenActionIds, id)) {
        seenActionIds[id] = dedupedActions.length;
        dedupedActions.push(action);
      } else {
        // Keep the entry with the higher version number (more up-to-date).
        var existingIdx = seenActionIds[id];
        var existingV = normalizeVersionNumber(dedupedActions[existingIdx].version_number || dedupedActions[existingIdx].version || 0);
        var incomingV = normalizeVersionNumber(action.version_number || action.version || 0);
        if (incomingV > existingV) dedupedActions[existingIdx] = action;
      }
    });
    if (dedupedActions.length !== actions.length) {
      actions = dedupedActions;
      mutated = true;
    }

    if (mutated) {
      writeJSON(recordKey, records);
      writeJSON(snapshotKey, snapshots);
      writeJSON(ACTION_KEY, actions);
    }
  }

  function getRecords() {
    normalizePublishedVersionSequences();
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
      var localRefs = [
        record.inspectionRef,
        record.assessment_reference,
        record.assessmentReference,
        record.referenceNo,
        record.master_reference,
        record.masterReference,
        record.master_assessment_id,
        record.parent_assessment_id,
        record.assessment_family_id,
        record.assessment_family_reference,
        record.display_reference,
        record.displayReference
      ].map(function (value) {
        return stripVersionSuffix(normalizeReference(value || ''));
      }).filter(Boolean);
      return parentRef === targetRef || localRefs.indexOf(targetRef) >= 0;
    });
    if (!matches.length) return null;
    if (versionNumber != null && versionNumber !== '') {
      var version = normalizeVersionNumber(versionNumber);
      var exact = matches.find(function (record) {
        return normalizeVersionNumber(record.version || record.version_number || 0) === version;
      });
      if (exact) return exact;
    }
    return matches.sort(function (a, b) {
      return normalizeVersionNumber(b.version || b.version_number || 0) - normalizeVersionNumber(a.version || a.version_number || 0);
    })[0];
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
    if (isPastDue(actionDueDate || record.correctiveDueDate)) return 'Overdue';
    if (record.status === STATUS.REOPENED || record.status === STATUS.DRAFT || record.status === STATUS.IN_PROGRESS) return 'In Progress';
    if (record.status === STATUS.PUBLISHED || record.status === STATUS.PENDING_CORRECTIVE || record.status === STATUS.REVISED_CHECKLIST_SUBMITTED || record.status === STATUS.REVISED_CORRECTIVE_SUBMITTED) return 'Open';
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

  function checklistRiskScore(item, response) {
    if (!item || (response !== 'N' && response !== 'P')) return 0;
    var sev = Number(item.sev != null ? item.sev : item.severity);
    var lik = Number(
      response === 'N'
        ? (item.likN != null ? item.likN : item.likelihoodNo)
        : (item.likP != null ? item.likP : item.likelihoodPartial)
    );
    if (!Number.isFinite(sev) || sev < 1) sev = 1;
    if (!Number.isFinite(lik) || lik < 1) lik = 1;
    return Math.round(sev * lik * 10) / 10;
  }

  function deriveSubmissionRiskFromChecklist(checklist) {
    if (window.GoilWorkflow && typeof window.GoilWorkflow.deriveSubmissionRisk === 'function') {
      return window.GoilWorkflow.deriveSubmissionRisk(checklist || {});
    }

    var catalog = checklist && checklist.catalog && typeof checklist.catalog === 'object' ? checklist.catalog : {};
    var sectionStates = checklist && checklist.sectionStates && typeof checklist.sectionStates === 'object' ? checklist.sectionStates : {};
    var totalScore = 0;
    var contributingCount = 0;

    Object.keys(sectionStates).forEach(function (sectionId) {
      var sectionState = sectionStates[sectionId] || {};
      var responses = sectionState.responses && typeof sectionState.responses === 'object' ? sectionState.responses : {};
      Object.keys(responses).forEach(function (code) {
        var response = responses[code];
        if (response !== 'N' && response !== 'P') return;
        var score = checklistRiskScore(catalog[code] || {}, response);
        if (!Number.isFinite(score) || score <= 0) return;
        totalScore += score;
        contributingCount += 1;
      });
    });

    var average = contributingCount ? Math.round((totalScore / contributingCount) * 10) / 10 : null;
    return {
      score: average,
      level: contributingCount ? parseRiskLevelFromScore(average) : 'Low',
      totalScore: Math.round(totalScore * 10) / 10,
      contributingCount: contributingCount,
      calculatedAt: new Date().toISOString(),
      source: 'Average checklist risk score across all items marked N or P at submission.'
    };
  }

  function getSubmissionRiskForRecord(record, snapshot) {
    var resolvedSnapshot = snapshot || findSnapshotForRecord(record) || buildEmbeddedSnapshotFromRecord(record);
    var rawScore = record && record.submission_risk_score != null
      ? record.submission_risk_score
      : (record && record.submissionRiskScore);
    var score = (rawScore === null || rawScore === undefined || rawScore === '')
      ? null
      : Number(rawScore);
    var level = String(
      (record && (record.submission_risk_level || record.submissionRiskLevel)) ||
      ''
    ).trim();
    var calculatedAt = String(
      (record && (record.submission_risk_calculated_at || record.submissionRiskCalculatedAt)) ||
      ''
    ).trim();

    if (resolvedSnapshot && resolvedSnapshot.checklist) {
      var derived = deriveSubmissionRiskFromChecklist(resolvedSnapshot.checklist);
      score = (derived.score === null || derived.score === undefined || derived.score === '')
        ? null
        : Number(derived.score);
      level = derived.level || level;
      calculatedAt = (resolvedSnapshot.submissionRisk && resolvedSnapshot.submissionRisk.calculatedAt) || calculatedAt || derived.calculatedAt || '';
    } else if (resolvedSnapshot && resolvedSnapshot.submissionRisk) {
      score = (resolvedSnapshot.submissionRisk.score === null || resolvedSnapshot.submissionRisk.score === undefined || resolvedSnapshot.submissionRisk.score === '')
        ? null
        : Number(resolvedSnapshot.submissionRisk.score);
      level = resolvedSnapshot.submissionRisk.level || level;
      calculatedAt = resolvedSnapshot.submissionRisk.calculatedAt || calculatedAt;
    }

    if (score != null && (!Number.isFinite(score) || score < 0)) {
      score = null;
    }

    if (score != null && (!Number.isFinite(score) || score < 0)) score = null;
    if (score != null && score <= 0) score = null;
    if (score != null) score = Math.round(score * 10) / 10;

    if (score != null) level = parseRiskLevelFromScore(score);
    else level = 'Low';

    return {
      score: score,
      level: level,
      calculatedAt: calculatedAt
    };
  }

  function formatSubmissionRiskDisplay(riskOrLevel, maybeScore) {
    var level = riskOrLevel && typeof riskOrLevel === 'object'
      ? riskOrLevel.level
      : riskOrLevel;
    var score = riskOrLevel && typeof riskOrLevel === 'object'
      ? riskOrLevel.score
      : maybeScore;
    var normalizedLevel = normalizeRiskLevel(level || 'Low');
    var numericScore = (score === null || score === undefined || score === '') ? null : Number(score);
    if (numericScore == null || !Number.isFinite(numericScore) || numericScore <= 0) return normalizedLevel;
    var formattedScore = Number.isInteger(numericScore) ? String(numericScore) : String(Math.round(numericScore * 10) / 10);
    return normalizedLevel + ' (' + formattedScore + ')';
  }

  function formatResidualRiskDisplay(riskOrLevel, maybeScore) {
    var level = riskOrLevel && typeof riskOrLevel === 'object'
      ? riskOrLevel.level
      : riskOrLevel;
    var score = riskOrLevel && typeof riskOrLevel === 'object'
      ? riskOrLevel.score
      : maybeScore;
    var normalizedLevel = String(level || '').trim();
    var numericScore = (score === null || score === undefined || score === '') ? null : Number(score);
    if (normalizedLevel === '-') return '-';
    if (numericScore == null || !Number.isFinite(numericScore)) {
      return normalizeRiskLevel(normalizedLevel || 'Low');
    }
    if (numericScore <= 0) return normalizeRiskLevel(normalizedLevel || 'Low');
    var resolvedLevel = normalizedLevel ? normalizeRiskLevel(normalizedLevel) : parseRiskLevelFromScore(numericScore);
    var formattedScore = Number.isInteger(numericScore) ? String(numericScore) : String(Math.round(numericScore * 10) / 10);
    return resolvedLevel + ' (' + formattedScore + ')';
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

  function isClosedActionStatus(status) {
    var normalized = String(status || '').toLowerCase();
    return normalized === 'closed' || normalized === 'verified closed';
  }

  function hasConfirmedClosure(action) {
    if (!action || typeof action !== 'object') return false;
    if (!isClosedActionStatus(action.status)) return false;
    return !!(
      action.closedBy ||
      action.verifiedClosedBy ||
      action.closureDate ||
      action.verifiedClosedAt ||
      action.closureOutcome ||
      action.closedHow ||
      action.closureMethod
    );
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
    if (!snapshot || !snapshot.checklist) return mapCorrectiveItemsToActions(record);
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
        // In this workflow, both non-compliance ("N") and partial compliance ("P")
        // remain actionable deviations. Risk scoring and corrective-action counts
        // must stay aligned to the submitted checklist state.
        if (response !== 'N' && response !== 'P') return;
        var meta = catalog[code] || {};
        var exactRiskScore = checklistRiskScore(meta, response);
        var level = exactRiskScore > 0
          ? parseRiskLevelFromScore(exactRiskScore)
          : (meta.crit ? 'Critical' : 'High');
        var priority = level;
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
          riskScore: exactRiskScore > 0 ? exactRiskScore : actionRiskUnits({ riskLevel: level }),
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
        riskScore: Number(finding && finding.riskScore) > 0 ? Number(finding.riskScore) : actionRiskUnits({ riskLevel: level }),
        sectionId: (finding && finding.linkedSectionId) || 'general',
        sectionLabel: (finding && finding.linkedSectionLabel) || 'General Finding'
      });
    });

    if (!items.length) {
      items = mapCorrectiveItemsToActions(record);
    }

    if (!items.length && Number(record.failedCount || 0) > 0) {
      var summaryIssue = 'Assessment generated corrective actions from failed/non-compliant findings.';
      var summaryRecommendation = record.correctiveSummary || (record.failedCount + ' corrective finding(s) require closure');
      var summaryRisk = getSubmissionRiskForRecord(record, snapshot);
      items.push({
        sourceType: 'summary',
        sourceCode: 'A1',
        sourceComment: '',
        issue: summaryIssue,
        recommendedAction: summaryRecommendation,
        description: summaryRecommendation,
        riskLevel: normalizeRiskLevel(summaryRisk.level || record.overallRiskLevel || 'Medium'),
        priority: normalizeRiskLevel(summaryRisk.level || record.overallRiskLevel || 'Medium'),
        riskScore: Number(summaryRisk.score || record.overallRiskScore || 0) || actionRiskUnits({ riskLevel: normalizeRiskLevel(summaryRisk.level || record.overallRiskLevel || 'Medium') }),
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

    // Safety-net: deduplicate by actionId in case a previous normalisation pass
    // created collisions (e.g. after version renumbering without audit trail).
    var _seenIds = {};
    stored = stored.filter(function (action) {
      var id = action && action.actionId;
      if (!id) return true;
      if (_seenIds[id]) return false;
      _seenIds[id] = true;
      return true;
    });

    var merged = stored.slice();
    var snapshots = getSnapshots();
    var snapshotByKey = {};
    snapshots.forEach(function (snapshot) {
      var key = snapshotScopeKey(snapshot);
      if (!key) return;
      snapshotByKey[key] = snapshot;
    });

    (records || []).forEach(function (record) {
      var failedCount = Number(record.failedCount || 0);
      var recordRef = stripVersionSuffix(normalizeReference(record.inspectionRef || record.assessment_reference || ''));
      var recordVersion = normalizeVersionNumber(record.version || record.version_number || 1);
      var key = recordRef + '::' + String(recordVersion);
      var snapshot = snapshotByKey[key] || null;
      if (!snapshot) {
        snapshot = buildEmbeddedSnapshotFromRecord(record);
      }
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
      var existingRowsForVersion = merged.filter(function (row) {
        var rowRef = stripVersionSuffix(normalizeReference(row.inspectionRef || row.assessment_reference || row.assessmentReference || ''));
        if (rowRef !== recordRef) return false;
        var rowVersion = normalizeVersionNumber(row.version_number || row.version || actionVersionFromId(row.actionId));
        return rowVersion === recordVersion;
      });
      var canConfidentlyRebuild = !!(
        snapshot &&
        snapshot.checklist &&
        typeof snapshot.checklist === 'object' &&
        snapshot.checklist.sectionStates &&
        snapshot.checklist.catalog
      );
      if (correctiveItems.length === 0 && existingRowsForVersion.length && (!canConfidentlyRebuild || failedCount > 0)) {
        return;
      }
      var correctiveItemIds = correctiveItems.map(function (item, idx) {
        return buildActionId(record, item, idx);
      });

      merged = merged.filter(function (row) {
        var rowRef = stripVersionSuffix(normalizeReference(row.inspectionRef || row.assessment_reference || row.assessmentReference || ''));
        if (rowRef !== recordRef) return true;
        var rowVersion = normalizeVersionNumber(row.version_number || row.version || actionVersionFromId(row.actionId));
        if (rowVersion !== recordVersion) return true;
        return correctiveItemIds.indexOf(row.actionId) >= 0;
      });

      // Remove legacy single-summary synthetic row once richer itemized actions exist.
      if (correctiveItems.length > 1) {
        var legacyId = (record.inspectionRef || 'REF') + '-V' + (record.version || 1) + '-A1';
        merged = merged.filter(function (row) { return row.actionId !== legacyId; });
      }

      if (failedCount <= 0 && correctiveItems.length === 0) return;

      correctiveItems.forEach(function (item, idx) {
        var actionId = buildActionId(record, item, idx);
        var existing = stored.find(function (row) { return row.actionId === actionId; }) || {};
        var issueText = existing.issue || item.issue || item.sourceComment || item.sourceCode || '';
        var recommendedAction = existing.recommendedAction || existing.description || item.recommendedAction || item.description || record.correctiveSummary || (failedCount + ' corrective finding(s) require closure');
        var owner = existing.originalAssessor || record.inspector || record.assessor_name || 'Unknown Assessor';
        var hasRealClosure = !!(existing.closureDate || existing.closedBy || existing.verifiedClosedAt || existing.verifiedClosedBy || existing.closureOutcome || existing.closedHow || existing.closureMethod);
        var effectiveExistingStatus = hasRealClosure ? existing.status : (isClosedActionStatus(existing.status) ? '' : existing.status);
        var resolvedRiskScore = Number(existing.riskScore || item.riskScore || actionRiskUnits({ riskLevel: item.riskLevel || record.overallRiskLevel || 'Low' }));
        if (!Number.isFinite(resolvedRiskScore) || resolvedRiskScore < 0) resolvedRiskScore = 0;
        var resolvedRiskLevel = resolvedRiskScore > 0
          ? parseRiskLevelFromScore(resolvedRiskScore)
          : normalizeRiskLevel(item.riskLevel || record.overallRiskLevel || 'Low');

        upsertAction(merged, {
          actionId: actionId,
          inspectionRef: record.inspectionRef || '-',
          master_reference: recordRef,
          version: recordVersion,
          version_number: recordVersion,
          facilityName: record.facilityName || 'Unknown Facility',
          location: record.location || '',
          originalAssessor: owner,
          correctiveCreatedBy: existing.correctiveCreatedBy || owner,
          riskLevel: resolvedRiskLevel,
          riskScore: resolvedRiskScore,
          dueDate: existing.dueDate || item.dueDate || record.correctiveDueDate || '',
          latestAssessmentDate: record.inspectionDate || '',
          issue: issueText,
          sourceQuestion: item.sourceQuestion || item.issue || '',
          recommendedAction: recommendedAction,
          description: recommendedAction,
          priority: existing.priority || item.priority || normalizeRiskLevel(record.overallRiskLevel || 'Medium'),
          status: deriveActionStatus(record, effectiveExistingStatus, existing.dueDate || item.dueDate || record.correctiveDueDate),
          sourceCode: item.sourceCode || '',
          sourceResponse: item.sourceResponse || '',
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
    var snapshots = getSnapshots();
    var snapshot = snapshots.find(function (item) {
      return String(item.inspectionRef || '') === String(record && record.inspectionRef || '') &&
        normalizeVersionNumber(item.version || item.version_number || parseVersionFromToken(item.snapshotId) || 0) ===
          normalizeVersionNumber(record && (record.version || record.version_number || 0));
    }) || buildEmbeddedSnapshotFromRecord(record) || null;
    var submissionRisk = getSubmissionRiskForRecord(record, snapshot);
    var initialScore = Number(submissionRisk.score || 0);
    if (!Number.isFinite(initialScore)) {
      initialScore = Number(record && record.overallRiskScore);
    }
    if (!Number.isFinite(initialScore)) {
      initialScore = scoreFromRiskLevel((record && record.overallRiskLevel) || 'Low');
    }
    var initialLevel = submissionRisk.level || parseRiskLevelFromScore(initialScore);
    var sourceActions = (Array.isArray(actions) ? actions : getActions()).filter(function (action) {
      return isActionForRecord(action, record);
    });
    if (!sourceActions.length) {
      if (initialScore == null || initialScore <= 0) {
        return {
          initialScore: initialScore,
          initialLevel: initialLevel,
          residualScore: null,
          residualLevel: 'Low',
          riskReduction: null,
          openCount: 0,
          closedCount: 0
        };
      }
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

    var openActions = sourceActions.filter(function (action) {
      return !hasConfirmedClosure(action);
    });
    var closedCount = sourceActions.length - openActions.length;

    if (openActions.length) {
      var weightedScoreTotal = 0;
      var weightedCount = 0;
      openActions.forEach(function (action) {
        var weight = Number(actionOpenWeight(action && action.status));
        if (!Number.isFinite(weight) || weight <= 0) return;
        weightedScoreTotal += actionRiskUnits(action) * weight;
        weightedCount += weight;
      });
      var residualScore = weightedCount > 0
        ? Math.round((weightedScoreTotal / weightedCount) * 10) / 10
        : null;
      var residualLevel = residualScore != null ? parseRiskLevelFromScore(residualScore) : 'Low';
      var reduction = (initialScore > 0 && residualScore != null)
        ? Math.max(0, Math.round((initialScore - residualScore) * 10) / 10)
        : null;

      return {
        initialScore: initialScore,
        initialLevel: initialLevel,
        residualScore: residualScore,
        residualLevel: residualLevel,
        riskReduction: reduction,
        openCount: openActions.length,
        closedCount: closedCount
      };
    }

    var finalReduction = initialScore > 0 ? Math.round(initialScore * 10) / 10 : null;

    return {
      initialScore: initialScore,
      initialLevel: initialLevel,
      residualScore: null,
      residualLevel: 'Low',
      riskReduction: finalReduction,
      openCount: 0,
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
      return isHigh && !(hasConfirmedClosure(action) || s === 'closed' || s === 'verified closed');
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

    // Drop orphaned records that have no valid inspectionRef (keyed __UNREF__ during grouping).
    function hasValidRef(record) {
      return !!(record && String(
        record.inspectionRef || record.assessment_reference || record.assessmentReference || ''
      ).trim());
    }
    latestByMaster = latestByMaster.filter(hasValidRef);
    publishedLatestByMaster = publishedLatestByMaster.filter(hasValidRef);

    // For non-admin users scope all counts to their own assessments only.
    // Admins see the full org-wide picture.
    var currentUser = getCurrentUser();
    var userRole = normalizeRole(currentUser.role || currentUser.userRole || currentUser.accessRole);
    var isAdmin = isAdminLikeRole(userRole) || !!(getAuthContext() && getAuthContext().isAdmin);

    // Build candidate identity strings once, used for both record- and action-level filters.
    var userCandidates = [];
    if (!isAdmin) {
      userCandidates = [
        currentUser.email,
        currentUser.username,
        currentUser.full_name,
        currentUser.fullName,
        currentUser.name,
        currentUser.displayName
      ].map(function (v) { return String(v || '').trim().toLowerCase(); }).filter(Boolean);
    }

    function ownedByCurrentUser(ownerStr) {
      if (isAdmin) return true;
      if (!userCandidates.length) return true; // can't determine — include
      var owner = String(ownerStr || '').trim().toLowerCase();
      return !owner || userCandidates.indexOf(owner) >= 0;
    }

    var unpublishedPool = latestByMaster.filter(function (record) {
      if (record.is_published) return false;
      return ownedByCurrentUser(record.assessor_name || record.inspector || record.assessor);
    });

    // Scope published actions to current user's records so the action-based counts
    // (Critical Items, Open/Overdue) reflect the user's own portfolio, not the
    // entire org when pulled from Supabase.
    // Published count and Facilities count remain org-wide so they match the Register.
    if (!isAdmin && userCandidates.length) {
      publishedActions = publishedActions.filter(function (action) {
        return ownedByCurrentUser(action.originalAssessor || action.assessor_name || action.inspector);
      });
    }

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

    // Published card: same master-reference scope as Published Register default latest view.
    var publishedMasterCount = publishedLatestByMaster.length;

    // Facility Profile card: unique facilities with published master records.
    var publishedFacilitiesCount = uniqueFacilities(publishedLatestByMaster).length;

    return {
      dashboard: criticalItems,
      uncompleted: unpublishedPool.length,
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
      if (hasConfirmedClosure(action)) row.closed += 1;
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
      startTime: record.start_time || record.startTime || '',
      locationCoordinates: record.location_coordinates || record.locationCoordinates || '',
      locationLatitude: record.location_latitude || record.locationLatitude || '',
      locationLongitude: record.location_longitude || record.locationLongitude || '',
      locationAccuracy: record.location_accuracy || record.locationAccuracy || '',
      locationStatus: record.location_status || record.locationStatus || '',
      locationCapturedAt: record.location_captured_at || record.locationCapturedAt || '',
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
    var submissionRisk = getSubmissionRiskForRecord(record);
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
    meta.startTime = record.start_time || record.startTime || meta.startTime || '';
    meta.locationCoordinates = record.location_coordinates || record.locationCoordinates || meta.locationCoordinates || '';
    meta.locationLatitude = record.location_latitude || record.locationLatitude || meta.locationLatitude || '';
    meta.locationLongitude = record.location_longitude || record.locationLongitude || meta.locationLongitude || '';
    meta.locationAccuracy = record.location_accuracy || record.locationAccuracy || meta.locationAccuracy || '';
    meta.locationStatus = record.location_status || record.locationStatus || meta.locationStatus || '';
    meta.locationCapturedAt = record.location_captured_at || record.locationCapturedAt || meta.locationCapturedAt || '';
    meta.inspectorName = record.assessor_name || record.inspector || meta.inspectorName || '';
    meta.overallRisk = {
      level: record.overall_risk_level || record.overallRiskLevel || '',
      score: Number(record.overall_risk_score != null ? record.overall_risk_score : record.overallRiskScore || 0)
    };
    meta.submissionRisk = {
      level: submissionRisk.level || '',
      score: Number(submissionRisk.score || 0),
      calculatedAt: submissionRisk.calculatedAt || ''
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
    var snapshot = findSnapshotForRecord(record, snapshots);
    var recordRef = stripVersionSuffix(normalizeReference(
      record && (record.inspectionRef || record.assessment_reference || record.assessmentReference || getParentInspectionReference(record) || '')
    ));
    var recordVersion = getRecordVersionNumber(record);
    if (!snapshot) {
      var targetSnapshotId = String(
        record.snapshotId ||
        record.lastSnapshotId ||
        record.assessment_version_id ||
        ''
      ).trim();
      if (targetSnapshotId) {
        snapshot = snapshots.find(function (item) {
          return String(item && item.snapshotId || '').trim() === targetSnapshotId;
        }) || null;
      }
    }
    if (!snapshot) {
      snapshot = buildEmbeddedSnapshotFromRecord(record);
    }
    var actions = getActions().filter(function (action) {
      if (!isActionForRecord(action, record)) return false;
      return normalizeVersionNumber(action.version_number || action.version || actionVersionFromId(action.actionId)) ===
        normalizeVersionNumber(record.version || record.version_number || 1);
    });
    var sectionIndex = Number(record.current_section_index || record.currentSectionIndex || 0);
    if (!Number.isFinite(sectionIndex) || sectionIndex < 0) sectionIndex = 0;

    if (snapshot && snapshot.checklist) {
      var hydratedChecklist = clone(snapshot.checklist);
      if (!hydratedChecklist.sectionStates || typeof hydratedChecklist.sectionStates !== 'object') {
        hydratedChecklist.sectionStates = {};
      }
      hydratedChecklist.inspectionRef = recordRef;
      hydratedChecklist.version = recordVersion;
      hydratedChecklist.sourceSnapshotId = String(
        snapshot.snapshotId ||
        hydratedChecklist.sourceSnapshotId ||
        ''
      ).trim();
      writeJSON('goil_checklist_session', hydratedChecklist);
      if (!Number.isFinite(sectionIndex) || sectionIndex < 0) {
        sectionIndex = sectionIndexFromSession(hydratedChecklist, record.current_section_id || record.currentSectionId || '');
      }
    } else {
      localStorage.removeItem('goil_checklist_session');
    }
    localStorage.setItem('goil_current_section', String(sectionIndex));

    var existingPayload = readJSON('goil_corrective_action_session', {});
    var existingItems = correctivePayloadMatchesRecord(existingPayload, recordRef, recordVersion)
      ? normalizeCorrectiveItems(existingPayload.items)
      : [];
    var recordItems = getRecordCorrectiveItems(record);
    var actionItems = actions.map(function (action, idx) {
      return normalizeCorrectiveItems([{
        id: action.actionId || ('CA-' + String(idx + 1).padStart(3, '0')),
        sourceCode: action.sourceCode || action.actionId || ('ITEM-' + (idx + 1)),
        sourceQuestion: action.sourceQuestion || action.issue || action.sourceComment || action.sourceCode || action.actionId || '',
        sectionId: action.sectionId || 'summary',
        sectionLabel: action.sectionLabel || 'Assessment Summary',
        sourceResponse: action.sourceResponse || (action.riskLevel === 'Critical' || action.riskLevel === 'High' ? 'N' : 'P'),
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
      }])[0];
    }).filter(Boolean);
    var preferredItems = choosePreferredCorrectiveItems(recordItems, existingItems, actionItems);

    if (preferredItems.length) {
      var payload = buildCorrectiveSessionPayload(preferredItems, record, recordRef, recordVersion, existingPayload);
      if (payload) {
        writeJSON('goil_corrective_action_session', payload);
      }
    }
  }

  function prepareAssessmentRecord(referenceNo, versionNumber) {
    var record = findRecord(referenceNo, versionNumber);
    if (!record) return null;
    try {
      hydrateFacilityFromRecord(record);
    } catch (error) {
      console.error('hydrateFacilityFromRecord failed', error);
    }
    try {
      hydrateMetaFromRecord(record);
    } catch (error) {
      console.error('hydrateMetaFromRecord failed', error);
    }
    try {
      hydrateChecklistAndCorrectiveFromRecord(record);
    } catch (error) {
      console.error('hydrateChecklistAndCorrectiveFromRecord failed', error);
    }
    return record;
  }

  function buildAssessmentPageUrl(page, referenceNo, versionNumber, extraParams) {
    var params = [];
    params.push('v=20260318-masterrefdeep6');

    var ref = normalizeReference(referenceNo);
    if (ref) params.push('ref=' + encodeURIComponent(stripVersionSuffix(ref)));

    var version = normalizeVersionNumber(versionNumber || 1);
    if (version >= 1) params.push('version=' + encodeURIComponent(String(version)));

    if (extraParams && typeof extraParams === 'object') {
      Object.keys(extraParams).forEach(function (key) {
        var value = extraParams[key];
        if (value == null || value === '') return;
        params.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
      });
    }

    params.push('_=' + Date.now());
    return page + '?' + params.join('&');
  }

  function buildAssessmentRegisterUrl(referenceNo, versionNumber, extraParams) {
    var params = [];
    params.push('v=20260601-assessmentregister5');

    var ref = normalizeReference(referenceNo);
    if (ref) params.push('ref=' + encodeURIComponent(stripVersionSuffix(ref)));

    var version = normalizeVersionNumber(versionNumber || 1);
    if (version >= 1) params.push('version=' + encodeURIComponent(String(version)));

    if (extraParams && typeof extraParams === 'object') {
      Object.keys(extraParams).forEach(function (key) {
        var value = extraParams[key];
        if (value == null || value === '') return;
        params.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
      });
    }

    params.push('_=' + Date.now());
    return 'risk-assessment-register.html?' + params.join('&');
  }

  function openAssessmentRecord(referenceNo, versionNumber) {
    var record = prepareAssessmentRecord(referenceNo, versionNumber);
    if (!record) {
      window.location.href = 'GOIL_Checklist_Section1.html?v=20260318-masterrefdeep6&_=' + Date.now();
      return;
    }

    var status = getStatusSet();
    var stepText = String(record.current_step || record.currentStage || '').toLowerCase();
    var recordRef = record.inspectionRef || record.assessment_reference || referenceNo || '';
    var recordVersion = normalizeVersionNumber(record.version || record.version_number || versionNumber || 1);

    if (record.status === status.PENDING_CORRECTIVE || record.status === status.REVISED_CHECKLIST_SUBMITTED) {
      window.location.href = buildAssessmentPageUrl('GOIL_Corrective_Action.html', recordRef, recordVersion);
      return;
    }
    if (record.status === status.PUBLISHED) {
      window.location.href = buildAssessmentPageUrl('GOIL_Review_Submit.html', recordRef, recordVersion);
      return;
    }
    if (stepText.indexOf('facility') >= 0) {
      window.location.href = 'GOIL_Facility_Details.html?v=20260318-masterrefdeep6&_=' + Date.now();
      return;
    }
    if (stepText.indexOf('review') >= 0) {
      window.location.href = buildAssessmentPageUrl('GOIL_Review_Submit.html', recordRef, recordVersion);
      return;
    }
    window.location.href = buildAssessmentPageUrl('GOIL_Checklist_Section1.html', recordRef, recordVersion);
  }

  function viewAssessmentChecklist(referenceNo, versionNumber) {
    var record = null;
    try {
      record = prepareAssessmentRecord(referenceNo, versionNumber);
    } catch (error) {
      console.error('viewAssessmentChecklist failed to prepare record', error);
    }
    if (!record) {
      try {
        record = findRecord(referenceNo, versionNumber);
      } catch (error) {
        console.error('viewAssessmentChecklist failed to find record fallback', error);
      }
    }

    var recordRef = (record && (record.inspectionRef || record.assessment_reference)) || referenceNo || '';
    var recordVersion = normalizeVersionNumber(
      (record && (record.version || record.version_number)) || versionNumber || 1
    );
    var recordFacility = String(
      (record && (
        record.facilityName ||
        record.facility_name ||
        record.stationName ||
        record.station_name
      )) || ''
    ).trim();
    try {
      localStorage.setItem('goil_pending_record_route', JSON.stringify({
        ref: stripVersionSuffix(normalizeReference(recordRef)),
        version: recordVersion,
        facility: recordFacility,
        readonly: 1,
        target: 'assessment-register',
        source: 'urgent-view',
        requestedAt: Date.now()
      }));
    } catch (error) {}
    window.location.href = buildAssessmentRegisterUrl(
      recordRef,
      recordVersion,
      {
        readonly: 1,
        source: 'urgent-view',
        facility: recordFacility
      }
    );
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
    window.location.href = 'dashboard.html?_=' + Date.now();
  }

  function normalizeRole(role) {
    return String(role || '').trim().toLowerCase();
  }

  function getCurrentUser() {
    var ctx = getAuthContext();
    var profile = readJSON('goilUserProfile', null) || ctx.profile || null;
    var legacy = readJSON('goilUser', {});
    if (profile && (profile.email || profile.id || (ctx.session && ctx.session.user && ctx.session.user.email))) {
      return {
        id:        profile.id       || (ctx.session && ctx.session.user && ctx.session.user.id) || legacy.id || '',
        email:     profile.email    || (ctx.session && ctx.session.user && ctx.session.user.email) || legacy.email || '',
        username:  profile.full_name || profile.email || legacy.username || legacy.email || '',
        full_name: profile.full_name || legacy.full_name || legacy.fullName || '',
        role:      normalizeRole(profile.role || ctx.role || legacy.role || legacy.userRole || legacy.accessRole || 'submitter') || 'submitter',
        office:    profile.office    || legacy.office || ''
      };
    }
    return legacy;
  }

  function isOverrideRole(role) {
    var normalized = normalizeRole(role);
    return isAdminLikeRole(normalized) || normalized === 'supervisor' || normalized === 'reviewer';
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

  function canUserReopenRecord(record, user) {
    var actor = user || getCurrentUser();
    var role = normalizeRole(actor.role || actor.userRole || actor.accessRole);
    return isAdminLikeRole(role) || !!(getAuthContext() && getAuthContext().isAdmin);
  }

  function canUserReviseRecord(record, user) {
    var actor = user || getCurrentUser();
    var role = normalizeRole(actor.role || actor.userRole || actor.accessRole);
    if (isAdminLikeRole(role) || !!(getAuthContext() && getAuthContext().isAdmin)) return true;

    var recordOwner = String(record && (record.assessor_name || record.inspector || record.assessor) || '').trim().toLowerCase();
    if (!recordOwner) return false;

    var candidates = [
      actor.email,
      actor.username,
      actor.full_name,
      actor.fullName,
      actor.name,
      actor.displayName
    ].map(function (value) {
      return String(value || '').trim().toLowerCase();
    }).filter(Boolean);

    return candidates.indexOf(recordOwner) >= 0;
  }

  function canUserEditRecord(record, user) {
    var actor = user || getCurrentUser();
    var role = normalizeRole(actor.role || actor.userRole || actor.accessRole);
    if (isAdminLikeRole(role) || !!(getAuthContext() && getAuthContext().isAdmin)) return true;

    var recordOwner = String(record && (record.assessor_name || record.inspector || record.assessor) || '').trim().toLowerCase();
    if (!recordOwner) return true; // legacy records with no owner set — allow

    var candidates = [
      actor.email,
      actor.username,
      actor.full_name,
      actor.fullName,
      actor.name,
      actor.displayName
    ].map(function (value) {
      return String(value || '').trim().toLowerCase();
    }).filter(Boolean);

    return candidates.indexOf(recordOwner) >= 0;
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
    getPublishedDisplayVersionNumber: getPublishedDisplayVersionNumber,
    shouldDisplayVersionForRecord: shouldDisplayVersionForRecord,
    getVisibleVersionLabel: getVisibleVersionLabel,
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
    formatResidualRiskDisplay: formatResidualRiskDisplay,
    saveActions: saveActions,
    summarizeActionsByFacility: summarizeActionsByFacility,
    uniqueFacilities: uniqueFacilities,
    startNewAssessmentContext: startNewAssessmentContext,
    getDashboardMetrics: getDashboardMetrics,
    getFolderCounts: getFolderCounts,
    goFacilityDetails: goFacilityDetails,
    goChecklist: goChecklist,
    openAssessmentRecord: openAssessmentRecord,
    viewAssessmentChecklist: viewAssessmentChecklist,
    prepareAssessmentRecord: prepareAssessmentRecord,
    resumeLatestIncomplete: resumeLatestIncomplete,
    getCurrentUser: getCurrentUser,
    canUserCloseAction: canUserCloseAction,
    canUserReopenRecord: canUserReopenRecord,
    canUserReviseRecord: canUserReviseRecord,
    canUserEditRecord: canUserEditRecord,
    canUserVerifyAction: canUserVerifyAction,
    hasConfirmedClosure: hasConfirmedClosure,
    isOverrideRole: isOverrideRole,
    getSubmissionRiskForRecord: getSubmissionRiskForRecord,
    formatSubmissionRiskDisplay: formatSubmissionRiskDisplay,
    goLanding: goLanding,
    goPortal: goPortal
  };
})(window);

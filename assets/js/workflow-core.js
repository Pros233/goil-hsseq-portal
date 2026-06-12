(function (window) {
  'use strict';

  var KEYS = {
    meta: 'goil_inspection_meta',
    audit: 'goil_audit_trail',
    snapshots: 'goil_checklist_snapshots',
    records: 'goil_inspection_records',
    notifications: 'goil_notifications'
  };
  var SESSION_KEYS = {
    facility: 'goil_facility_details',
    checklist: 'goil_checklist_session',
    corrective: 'goil_corrective_action_session'
  };

  var STATUS = {
    DRAFT: 'Draft',
    IN_PROGRESS: 'In Progress',
    PENDING_CORRECTIVE: 'Checklist Submitted / Pending Corrective Action',
    REOPENED: 'Reopened for Revision',
    REVISED_CHECKLIST_SUBMITTED: 'Revised Checklist Submitted',
    REVISED_CORRECTIVE_SUBMITTED: 'Revised Corrective Action Submitted',
    AWAITING_REVIEW: 'Awaiting Review',
    PUBLISHED: 'Fully Submitted / Published to Register'
  };

  var PENDING_SET = [STATUS.PENDING_CORRECTIVE, STATUS.REVISED_CHECKLIST_SUBMITTED];

  function nowIso() {
    return new Date().toISOString();
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

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj || {}));
  }

  function hasChecklistPayload(checklist) {
    return !!(
      checklist &&
      typeof checklist === 'object' &&
      checklist.catalog &&
      typeof checklist.catalog === 'object' &&
      checklist.sectionStates &&
      typeof checklist.sectionStates === 'object'
    );
  }

  function normalizeCorrectiveItemsPayload(items) {
    if (!Array.isArray(items)) return [];
    return items
      .filter(function (item) { return item && typeof item === 'object'; })
      .map(function (item) { return clone(item); });
  }

  function getRecordCorrectiveItems(record) {
    if (!record || typeof record !== 'object') return [];
    if (Array.isArray(record.correctiveItems)) return normalizeCorrectiveItemsPayload(record.correctiveItems);
    if (Array.isArray(record.corrective_items)) return normalizeCorrectiveItemsPayload(record.corrective_items);
    if (record.correctiveSession && Array.isArray(record.correctiveSession.items)) {
      return normalizeCorrectiveItemsPayload(record.correctiveSession.items);
    }
    if (record.corrective_session && Array.isArray(record.corrective_session.items)) {
      return normalizeCorrectiveItemsPayload(record.corrective_session.items);
    }
    return [];
  }

  function normalizeRole(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getAuthContext() {
    return window.GOIL_AUTH_CONTEXT && typeof window.GOIL_AUTH_CONTEXT === 'object'
      ? window.GOIL_AUTH_CONTEXT
      : {};
  }

  function isAdminRole(role) {
    var normalized = normalizeRole(role);
    if (!normalized) {
      var ctx = getAuthContext();
      if (ctx && ctx.isAdmin === true) return true;
      normalized = normalizeRole(ctx.role || (ctx.profile && ctx.profile.role));
    }
    return normalized === 'admin' || normalized === 'administrator' || normalized === 'super-admin' || normalized === 'super admin';
  }

  function resolveActorName(actor, fallback) {
    if (actor && typeof actor === 'object') {
      return actor.full_name || actor.fullName || actor.username || actor.email || fallback || 'Unknown User';
    }
    if (typeof actor === 'string' && actor.trim()) return actor.trim();
    var ctx = getAuthContext();
    if (ctx.profile) {
      return ctx.profile.full_name || ctx.profile.email || fallback || 'Unknown User';
    }
    var profile = readJSON('goilUserProfile', {});
    return profile.full_name || profile.email || fallback || 'Unknown User';
  }

  function resolveActorRole(actor) {
    if (actor && typeof actor === 'object') {
      var actorRole = normalizeRole(actor.role || actor.userRole || actor.accessRole);
      if (actorRole) return actorRole;
    }
    var ctx = getAuthContext();
    var ctxRole = normalizeRole(ctx.role || (ctx.profile && ctx.profile.role));
    if (ctxRole) return ctxRole;
    var profile = readJSON('goilUserProfile', {});
    if (profile && profile.role) return normalizeRole(profile.role);
    var legacy = readJSON('goilUser', {});
    return normalizeRole(legacy.role || legacy.userRole || legacy.accessRole);
  }

  function slugify(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function generateReferenceNo() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    var rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return 'IRA-' + y + m + day + '-' + rand;
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

  function findSnapshotForRecord(record, snapshots) {
    if (!record || typeof record !== 'object') return null;
    var ref = stripVersionSuffix(normalizeReference(
      record.assessment_reference ||
      record.master_reference ||
      record.inspectionRef ||
      record.referenceNo ||
      ''
    ));
    if (!ref) return null;
    var version = normalizeVersionNumber(
      record.version_number ||
      record.version ||
      record.versionCurrent ||
      1
    );
    var list = Array.isArray(snapshots) ? snapshots : getSnapshots();
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

  function getLatestPublishedVersion(referenceNo) {
    var ref = stripVersionSuffix(normalizeReference(referenceNo));
    if (!ref) return 0;
    var records = getStoredRecords();
    var latest = 0;
    records.forEach(function (record) {
      var recordRef = stripVersionSuffix(normalizeReference(
        record && (
          record.inspectionRef ||
          record.assessment_reference ||
          record.referenceNo ||
          ''
        )
      ));
      if (recordRef !== ref) return;
      var status = String(record && (record.status || record.assessment_status) || '').trim();
      if ((record && record.is_published !== true) && status !== STATUS.PUBLISHED) return;
      var version = normalizeVersionNumber(record && (record.version || record.version_number || 0));
      if (version > latest) latest = version;
    });
    return latest;
  }

  function isRevisionVersionContext(meta, status) {
    var currentStatus = status || (meta && meta.status) || '';
    return !!(
      (meta && meta.revisionOpen) ||
      currentStatus === STATUS.REOPENED ||
      currentStatus === STATUS.REVISED_CHECKLIST_SUBMITTED ||
      currentStatus === STATUS.REVISED_CORRECTIVE_SUBMITTED
    );
  }

  function resolveAssessmentVersion(meta, status) {
    var currentStatus = status || (meta && meta.status) || STATUS.DRAFT;
    var storedVersion = Number(meta && meta.versionCurrent || 0);
    if (!Number.isFinite(storedVersion) || storedVersion < 1) storedVersion = 0;
    var latestPublishedVersion = getLatestPublishedVersion(meta && meta.referenceNo);
    var revisionContext = isRevisionVersionContext(meta, currentStatus);

    if (revisionContext) {
      return latestPublishedVersion > 0 ? latestPublishedVersion + 1 : (storedVersion || 1);
    }

    if (currentStatus === STATUS.PUBLISHED) {
      if (storedVersion > latestPublishedVersion) return storedVersion;
      return latestPublishedVersion > 0 ? latestPublishedVersion : (storedVersion || 1);
    }

    if (latestPublishedVersion > 0) {
      if (storedVersion > latestPublishedVersion) return storedVersion;
      return storedVersion || latestPublishedVersion;
    }

    return storedVersion || 1;
  }

  function resolveSubmissionRiskFromSnapshot(snapshot, fallbackCalculatedAt) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    if (snapshot.checklist) {
      var derived = deriveSubmissionRisk(snapshot.checklist);
      derived.calculatedAt = (snapshot.submissionRisk && snapshot.submissionRisk.calculatedAt) || fallbackCalculatedAt || derived.calculatedAt;
      return derived;
    }
    if (snapshot.submissionRisk) {
      var rawScore = snapshot.submissionRisk.score;
      var score = (rawScore === null || rawScore === undefined || rawScore === '') ? null : Number(rawScore);
      if (score != null && (!Number.isFinite(score) || score < 0)) score = null;
      if (score != null && score <= 0) score = null;
      if (score != null) score = Math.round(score * 10) / 10;
      return {
        score: score,
        level: score != null ? (snapshot.submissionRisk.level || parseRiskLevelFromScore(score)) : 'Low',
        totalScore: Number(snapshot.submissionRisk.totalScore || 0),
        contributingCount: Number(snapshot.submissionRisk.contributingCount || 0),
        calculatedAt: snapshot.submissionRisk.calculatedAt || fallbackCalculatedAt || '',
        source: snapshot.submissionRisk.source || 'Locked checklist submission risk snapshot.'
      };
    }
    return null;
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

  function deriveSubmissionRisk(session) {
    var catalog = session && session.catalog && typeof session.catalog === 'object' ? session.catalog : {};
    var sectionStates = session && session.sectionStates && typeof session.sectionStates === 'object' ? session.sectionStates : {};
    var totalScore = 0;
    var contributingCount = 0;

    Object.keys(sectionStates).forEach(function (sectionId) {
      var ss = sectionStates[sectionId] || {};
      var responses = ss.responses && typeof ss.responses === 'object' ? ss.responses : {};
      Object.keys(responses).forEach(function (code) {
        var response = responses[code];
        if (response !== 'N' && response !== 'P') return;
        var score = checklistRiskScore(catalog[code] || {}, response);
        if (!Number.isFinite(score) || score <= 0) return;
        totalScore += score;
        contributingCount += 1;
      });
    });

    var averageScore = contributingCount
      ? Math.round((totalScore / contributingCount) * 10) / 10
      : null;

    return {
      score: averageScore,
      level: contributingCount ? parseRiskLevelFromScore(averageScore) : 'Low',
      totalScore: Math.round(totalScore * 10) / 10,
      contributingCount: contributingCount,
      calculatedAt: nowIso(),
      source: 'Average checklist risk score across all items marked N or P at submission.'
    };
  }

  function formatDisplayReference(referenceNo, versionNumber) {
    var base = stripVersionSuffix(referenceNo) || '-';
    var version = normalizeVersionNumber(versionNumber);
    return base + '-V' + String(version);
  }

  function getMeta(facility) {
    var meta = readJSON(KEYS.meta, {});
    if (!meta.referenceNo) meta.referenceNo = generateReferenceNo();
    if (!meta.status) meta.status = STATUS.DRAFT;
    if (!meta.createdAt) meta.createdAt = nowIso();
    if (!meta.versionCurrent) meta.versionCurrent = 0;
    if (!Array.isArray(meta.versionHistory)) meta.versionHistory = [];
    if (facility && typeof facility === 'object') {
      if (facility.nameDisplay) meta.facilityName = facility.nameDisplay;
      if (facility.facilityType) meta.facilityType = facility.facilityType;
      if (facility.assessorName) meta.inspectorName = facility.assessorName;
      if (facility.zone) meta.location = facility.zone;
      if (facility.assessmentDate) meta.inspectionDate = facility.assessmentDate;
      if (facility.startTime) meta.startTime = facility.startTime;
      if (facility.locationCoordinates) meta.locationCoordinates = facility.locationCoordinates;
      if (facility.locationLatitude) meta.locationLatitude = facility.locationLatitude;
      if (facility.locationLongitude) meta.locationLongitude = facility.locationLongitude;
      if (facility.locationAccuracy) meta.locationAccuracy = facility.locationAccuracy;
      if (facility.locationStatus) meta.locationStatus = facility.locationStatus;
      if (facility.locationCapturedAt) meta.locationCapturedAt = facility.locationCapturedAt;
    }
    return meta;
  }

  function saveMeta(meta) {
    if (!meta) return;
    meta.lastUpdatedAt = nowIso();
    writeJSON(KEYS.meta, meta);
  }

  function appendAudit(action, actor, details) {
    var list = readJSON(KEYS.audit, []);
    if (!Array.isArray(list)) list = [];
    list.push({
      at: nowIso(),
      action: action,
      actor: actor || 'Unknown User',
      ...(details || {})
    });
    writeJSON(KEYS.audit, list);
  }

  function getSnapshots() {
    var list = readJSON(KEYS.snapshots, []);
    return Array.isArray(list) ? list : [];
  }

  function saveSnapshots(list) {
    writeJSON(KEYS.snapshots, Array.isArray(list) ? list : []);
  }

  function backfillEmbeddedSnapshots(records, snapshots) {
    var recordList = Array.isArray(records) ? records : [];
    var snapshotList = Array.isArray(snapshots) ? snapshots : getSnapshots();
    if (!recordList.length || !snapshotList.length) return recordList;

    var mutated = false;
    var backfilledAt = nowIso();
    var nextRecords = recordList.map(function (rawRecord) {
      var record = rawRecord && typeof rawRecord === 'object' ? rawRecord : {};
      var snapshot = findSnapshotForRecord(record, snapshotList);
      if (!snapshot || !hasChecklistPayload(snapshot.checklist)) return record;

      var existingChecklist = hasChecklistPayload(record.checklistSnapshot)
        ? record.checklistSnapshot
        : record.checklist_snapshot;
      var existingCorrectiveItems = getRecordCorrectiveItems(record);
      var snapshotCorrectiveItems = getRecordCorrectiveItems(snapshot);
      var existingSnapshotId = normalizeReference(record.snapshotId || record.lastSnapshotId || '');
      var resolvedSnapshotId = normalizeReference(snapshot.snapshotId || '');
      var changed = false;
      var nextRecord = record;

      if (!hasChecklistPayload(existingChecklist)) {
        if (nextRecord === record) nextRecord = Object.assign({}, record);
        nextRecord.checklistSnapshot = clone(snapshot.checklist);
        nextRecord.checklist_snapshot = clone(snapshot.checklist);
        changed = true;
      }
      if (resolvedSnapshotId && existingSnapshotId !== resolvedSnapshotId) {
        if (nextRecord === record) nextRecord = Object.assign({}, record);
        nextRecord.snapshotId = resolvedSnapshotId;
        nextRecord.lastSnapshotId = resolvedSnapshotId;
        changed = true;
      }
      if (!existingCorrectiveItems.length && snapshotCorrectiveItems.length) {
        if (nextRecord === record) nextRecord = Object.assign({}, record);
        nextRecord.correctiveItems = clone(snapshotCorrectiveItems);
        nextRecord.corrective_items = clone(snapshotCorrectiveItems);
        changed = true;
      }
      if (!changed) return record;

      nextRecord.snapshotBackfilledAt = backfilledAt;
      nextRecord.snapshot_backfilled_at = backfilledAt;
      mutated = true;
      return nextRecord;
    });

    if (mutated) {
      writeJSON(KEYS.records, nextRecords);
    }
    return nextRecords;
  }

  function getStoredRecords() {
    var list = readJSON(KEYS.records, []);
    if (!Array.isArray(list)) return [];
    return backfillEmbeddedSnapshots(list);
  }

  function findStoredRecordByReferenceVersion(referenceNo, versionNumber) {
    var ref = stripVersionSuffix(normalizeReference(referenceNo));
    var version = normalizeVersionNumber(versionNumber);
    if (!ref || !version) return null;
    var records = getStoredRecords();
    for (var i = 0; i < records.length; i += 1) {
      var item = normalizeRecord(records[i] || {});
      var itemRef = stripVersionSuffix(normalizeReference(
        item.master_reference ||
        item.assessment_reference ||
        item.inspectionRef ||
        ''
      ));
      var itemVersion = normalizeVersionNumber(item.version || item.version_number || 0);
      if (itemRef === ref && itemVersion === version) return item;
    }
    return null;
  }

  function hasMeaningfulValue(value) {
    if (value == null) return false;
    if (typeof value === 'number') return Number.isFinite(value);
    var text = String(value).trim();
    if (!text) return false;
    var lowered = text.toLowerCase();
    return lowered !== '-' && lowered !== 'n/a' && lowered !== 'null' && lowered !== 'undefined';
  }

  function familyKeyForRecord(record, idx) {
    var normalized = record || {};
    var ref = stripVersionSuffix(normalizeReference(normalized.inspectionRef || normalized.assessment_reference || ''));
    var master = stripVersionSuffix(normalizeReference(
      normalized.master_assessment_id ||
      normalized.parent_assessment_id ||
      normalized.assessment_family_id ||
      normalized.assessment_family_reference ||
      normalized.master_reference ||
      ref
    ));
    return master || ref || ('UNREF-' + String(idx));
  }

  function enrichFamilyRecords(records) {
    var list = Array.isArray(records) ? records.slice() : [];
    if (!list.length) return [];

    var grouped = {};
    list.forEach(function (record, idx) {
      var key = familyKeyForRecord(record, idx);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(record);
    });

    Object.keys(grouped).forEach(function (key) {
      grouped[key].sort(function (a, b) { return compareRecordFreshness(b, a); });
    });

    function familyValue(family, keys) {
      for (var i = 0; i < family.length; i += 1) {
        var record = family[i] || {};
        for (var j = 0; j < keys.length; j += 1) {
          var value = record[keys[j]];
          if (hasMeaningfulValue(value)) return String(value).trim();
        }
      }
      return '';
    }

    return list.map(function (record, idx) {
      var family = grouped[familyKeyForRecord(record, idx)] || [];
      var facilityName = hasMeaningfulValue(record.facilityName || record.facility_name)
        ? String(record.facilityName || record.facility_name).trim()
        : familyValue(family, ['facilityName', 'facility_name']);
      var facilityType = hasMeaningfulValue(record.facilityType || record.facility_type)
        ? String(record.facilityType || record.facility_type).trim()
        : familyValue(family, ['facilityType', 'facility_type']);
      var location = hasMeaningfulValue(record.location || record.zone || record.site)
        ? String(record.location || record.zone || record.site).trim()
        : familyValue(family, ['location', 'zone', 'site']);
      var inspector = hasMeaningfulValue(record.inspector || record.assessor_name)
        ? String(record.inspector || record.assessor_name).trim()
        : familyValue(family, ['inspector', 'assessor_name']);
      var inspectionDate = hasMeaningfulValue(record.inspectionDate || record.assessment_date)
        ? String(record.inspectionDate || record.assessment_date).trim()
        : familyValue(family, ['inspectionDate', 'assessment_date']);
      var startTime = hasMeaningfulValue(record.startTime || record.start_time)
        ? String(record.startTime || record.start_time).trim()
        : familyValue(family, ['startTime', 'start_time']);
      var locationCoordinates = hasMeaningfulValue(record.locationCoordinates || record.location_coordinates)
        ? String(record.locationCoordinates || record.location_coordinates).trim()
        : familyValue(family, ['locationCoordinates', 'location_coordinates']);
      var locationLatitude = hasMeaningfulValue(record.locationLatitude || record.location_latitude)
        ? String(record.locationLatitude || record.location_latitude).trim()
        : familyValue(family, ['locationLatitude', 'location_latitude']);
      var locationLongitude = hasMeaningfulValue(record.locationLongitude || record.location_longitude)
        ? String(record.locationLongitude || record.location_longitude).trim()
        : familyValue(family, ['locationLongitude', 'location_longitude']);
      var locationAccuracy = hasMeaningfulValue(record.locationAccuracy || record.location_accuracy)
        ? String(record.locationAccuracy || record.location_accuracy).trim()
        : familyValue(family, ['locationAccuracy', 'location_accuracy']);
      var locationStatus = hasMeaningfulValue(record.locationStatus || record.location_status)
        ? String(record.locationStatus || record.location_status).trim()
        : familyValue(family, ['locationStatus', 'location_status']);
      var locationCapturedAt = hasMeaningfulValue(record.locationCapturedAt || record.location_captured_at)
        ? String(record.locationCapturedAt || record.location_captured_at).trim()
        : familyValue(family, ['locationCapturedAt', 'location_captured_at']);

      return {
        ...record,
        facility_name: facilityName,
        facilityName: facilityName,
        facility_type: facilityType,
        facilityType: facilityType,
        location: location,
        site: location,
        assessor_name: inspector,
        inspector: inspector,
        assessment_date: inspectionDate,
        inspectionDate: inspectionDate,
        start_time: startTime,
        startTime: startTime,
        location_coordinates: locationCoordinates,
        locationCoordinates: locationCoordinates,
        location_latitude: locationLatitude,
        locationLatitude: locationLatitude,
        location_longitude: locationLongitude,
        locationLongitude: locationLongitude,
        location_accuracy: locationAccuracy,
        locationAccuracy: locationAccuracy,
        location_status: locationStatus,
        locationStatus: locationStatus,
        location_captured_at: locationCapturedAt,
        locationCapturedAt: locationCapturedAt
      };
    });
  }

  function getRecords() {
    syncCurrentRecordFromSession();
    var records = getStoredRecords();
    if (!Array.isArray(records) || !records.length) return [];

    var byKey = {};
    records.forEach(function (record, idx) {
      var normalized = normalizeRecord(record);
      var version = normalizeVersionNumber(normalized.version || normalized.version_number || 1);
      var key = familyKeyForRecord(normalized, idx) + '::' + String(version);
      var prev = byKey[key];
      if (!prev || compareRecordFreshness(prev, normalized) < 0) {
        byKey[key] = normalized;
      }
    });

    var normalizedList = Object.keys(byKey).map(function (key) { return byKey[key]; })
      .sort(function (a, b) { return new Date(b.lastUpdatedAt || 0) - new Date(a.lastUpdatedAt || 0); });
    var enrichedList = enrichFamilyRecords(normalizedList);
    saveRecords(enrichedList);
    return enrichedList;
  }

  function saveRecords(list) {
    writeJSON(KEYS.records, Array.isArray(list) ? list : []);
  }

  function getNotifications() {
    var list = readJSON(KEYS.notifications, []);
    return Array.isArray(list) ? list : [];
  }

  function saveNotifications(list) {
    writeJSON(KEYS.notifications, Array.isArray(list) ? list : []);
  }

  function notify(type, title, message, referenceNo, dueAt) {
    var list = getNotifications();
    list.push({
      id: 'NTF-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      type: type,
      title: title,
      message: message,
      referenceNo: referenceNo || '',
      dueAt: dueAt || '',
      status: 'unread',
      createdAt: nowIso(),
      readAt: ''
    });
    saveNotifications(list);
  }

  function markNotificationRead(id) {
    var list = getNotifications();
    list.forEach(function (item) {
      if (item.id === id && item.status !== 'read') {
        item.status = 'read';
        item.readAt = nowIso();
      }
    });
    saveNotifications(list);
  }

  function getEarliestDueDate(correctiveItems) {
    if (!Array.isArray(correctiveItems)) return '';
    var dates = correctiveItems
      .map(function (item) { return item && item.dueDate ? item.dueDate : ''; })
      .filter(Boolean)
      .sort();
    return dates.length ? dates[0] : '';
  }

  function resolveCurrentSection(checklistSession, index) {
    var sections = Array.isArray(checklistSession && checklistSession.sectionsMeta) ? checklistSession.sectionsMeta : [];
    var safeIndex = Number(index);
    if (!Number.isFinite(safeIndex) || safeIndex < 0 || safeIndex >= sections.length) return { id: '', label: '' };
    var section = sections[safeIndex] || {};
    return {
      id: String(section.id || ''),
      label: String(section.label || section.short || section.id || '')
    };
  }

  function resolveCurrentStep(status, meta, section) {
    if (status === STATUS.PUBLISHED) return 'Published Register';
    if (status === STATUS.PENDING_CORRECTIVE || status === STATUS.REVISED_CHECKLIST_SUBMITTED) return 'Corrective Action';
    if (status === STATUS.REOPENED || status === STATUS.REVISED_CORRECTIVE_SUBMITTED) return 'Assessment Checklist';

    if (meta && meta.lastPage === 'facility') return 'Facility Details';
    if (meta && meta.lastPage === 'review') return 'Review & Submit';
    if (meta && meta.lastPage === 'corrective') return 'Corrective Action';

    var label = String((section && section.label) || '').toLowerCase();
    if (label.indexOf('finding') >= 0) return 'Additional Findings';
    return 'Assessment Checklist';
  }

  function normalizeRecord(record) {
    record = record || {};

    var ref = stripVersionSuffix(normalizeReference(record.assessment_reference || record.master_reference || record.inspectionRef || record.referenceNo || ''));
    var version = normalizeVersionNumber(
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

    var facilityName = record.facility_name || record.facilityName || '';
    var facilityType = record.facility_type || record.facilityType || '';
    var location = record.location || record.site || '';
    var assessorName = record.assessor_name || record.inspector || '';
    var assessmentDate = record.assessment_date || record.inspectionDate || '';
    var startTime = record.start_time || record.startTime || '';
    var locationCoordinates = record.location_coordinates || record.locationCoordinates || '';
    var locationLatitude = record.location_latitude || record.locationLatitude || '';
    var locationLongitude = record.location_longitude || record.locationLongitude || '';
    var locationAccuracy = record.location_accuracy || record.locationAccuracy || '';
    var locationStatus = record.location_status || record.locationStatus || '';
    var locationCapturedAt = record.location_captured_at || record.locationCapturedAt || '';
    var status = record.assessment_status || record.status || STATUS.DRAFT;
    var riskLevel = record.overall_risk_level || record.overallRiskLevel || '';
    var riskScore = Number(record.overall_risk_score != null ? record.overall_risk_score : record.overallRiskScore || 0);
    if (!Number.isFinite(riskScore)) riskScore = 0;
    var riskToken = String(riskLevel || '').trim().toLowerCase();
    if (riskScore > 0) {
      riskLevel = parseRiskLevelFromScore(riskScore);
    } else if (riskToken === 'critical' ) {
      riskLevel = 'Critical';
    } else if (riskToken === 'high') {
      riskLevel = 'High';
    } else if (riskToken === 'medium' || riskToken === 'moderate') {
      riskLevel = 'Medium';
    } else {
      riskLevel = 'Low';
    }
    var submissionRiskLevel = record.submission_risk_level || record.submissionRiskLevel || '';
    var submissionRiskCalculatedAt = record.submission_risk_calculated_at || record.submissionRiskCalculatedAt || '';
    var recordSnapshot = findSnapshotForRecord({
      assessment_reference: ref,
      master_reference: ref,
      inspectionRef: ref,
      version_number: version,
      version: version
    });
    var resolvedSubmissionRisk = resolveSubmissionRiskFromSnapshot(recordSnapshot, submissionRiskCalculatedAt);
    var submissionRiskRaw = resolvedSubmissionRisk
      ? resolvedSubmissionRisk.score
      : (record.submission_risk_score != null
        ? record.submission_risk_score
        : record.submissionRiskScore);
    var submissionRiskScore = (submissionRiskRaw === null || submissionRiskRaw === undefined || submissionRiskRaw === '')
      ? null
      : Number(submissionRiskRaw);
    if (submissionRiskScore != null && (!Number.isFinite(submissionRiskScore) || submissionRiskScore < 0)) submissionRiskScore = null;
    if (submissionRiskScore != null && submissionRiskScore <= 0) submissionRiskScore = null;
    if (resolvedSubmissionRisk) {
      submissionRiskLevel = resolvedSubmissionRisk.level || submissionRiskLevel;
      submissionRiskCalculatedAt = resolvedSubmissionRisk.calculatedAt || submissionRiskCalculatedAt;
    }
    if (submissionRiskScore != null) {
      submissionRiskLevel = parseRiskLevelFromScore(submissionRiskScore);
    } else {
      submissionRiskLevel = 'Low';
    }
    var checklistSubmittedAt = record.checklist_submitted_at || record.checklistSubmittedAt || '';
    var correctiveSubmittedAt = record.corrective_action_submitted_at || record.correctiveSubmittedAt || '';
    var finalSubmittedAt = record.final_submitted_at || record.publishedAt || '';
    var isPublished = record.is_published;
    if (typeof isPublished !== 'boolean') isPublished = status === STATUS.PUBLISHED || !!finalSubmittedAt;
    var lastUpdatedAt = record.last_updated_at || record.lastUpdatedAt || nowIso();
    var currentStep = record.current_step || record.currentStage || record.current_stage || '';
    var currentSection = record.current_section || '';
    var currentSectionId = record.current_section_id || '';
    var currentSectionIndex = Number(record.current_section_index || record.currentSectionIndex || 0);
    if (!Number.isFinite(currentSectionIndex) || currentSectionIndex < 0) currentSectionIndex = 0;
    var failedCount = Number(record.failedCount || record.failed_count || 0);
    if (!Number.isFinite(failedCount) || failedCount < 0) failedCount = 0;
    var criticalFindingsCount = Number(record.criticalFindingsCount || record.critical_findings_count || 0);
    if (!Number.isFinite(criticalFindingsCount) || criticalFindingsCount < 0) criticalFindingsCount = 0;
    var additionalFindingsCount = Number(record.additionalFindingsCount || record.additional_findings_count || 0);
    if (!Number.isFinite(additionalFindingsCount) || additionalFindingsCount < 0) additionalFindingsCount = 0;
    var answeredCount = Number(record.answeredCount || record.answered_count || 0);
    if (!Number.isFinite(answeredCount) || answeredCount < 0) answeredCount = 0;
    var totalItemCount = Number(record.totalItemCount || record.total_item_count || 0);
    if (!Number.isFinite(totalItemCount) || totalItemCount < 0) totalItemCount = 0;
    var correctiveItems = getRecordCorrectiveItems(record);
    if (!correctiveItems.length && recordSnapshot) {
      correctiveItems = getRecordCorrectiveItems(recordSnapshot);
    }
    if (failedCount <= 0 && correctiveItems.length) {
      failedCount = correctiveItems.length;
    }

    var facilityId = record.facility_id || '';
    if (!facilityId) {
      var facilityToken = slugify((facilityName || 'facility') + '-' + (facilityType || '') + '-' + (location || ''));
      facilityId = 'FAC-' + (facilityToken || 'unknown');
    }

    var familyReference = stripVersionSuffix(normalizeReference(
      record.master_assessment_id ||
      record.parent_assessment_id ||
      record.assessment_family_id ||
      record.assessment_family_reference ||
      record.master_reference ||
      ref
    ));
    if (!familyReference) familyReference = ref;
    if (!familyReference) familyReference = 'ASSESS-' + Date.now();

    var assessmentId = stripVersionSuffix(normalizeReference(record.master_assessment_id || record.assessment_id || familyReference));
    // Legacy migration: older builds stored assessment_id as "<ref>-V<version>".
    if (ref && assessmentId && assessmentId.toUpperCase().indexOf(ref.toUpperCase() + '-V') === 0) {
      assessmentId = ref;
    }
    if (!assessmentId) assessmentId = familyReference;
    var canonicalReference = stripVersionSuffix(ref || familyReference || assessmentId);
    if (!canonicalReference) canonicalReference = assessmentId;

    var assessmentVersionId = normalizeReference(
      record.assessment_version_id ||
      record.assessment_record_id ||
      (assessmentId + '-v' + String(version))
    );
    if (!assessmentVersionId) assessmentVersionId = assessmentId + '-v' + String(version);
    var displayReference = formatDisplayReference(canonicalReference, version);
    var snapshotId = normalizeReference(
      record.snapshotId ||
      record.lastSnapshotId ||
      (recordSnapshot && recordSnapshot.snapshotId) ||
      ''
    );
    var lastSnapshotId = normalizeReference(
      record.lastSnapshotId ||
      record.snapshotId ||
      (recordSnapshot && recordSnapshot.snapshotId) ||
      ''
    );
    var checklistSnapshot = null;
    if (record.checklistSnapshot && typeof record.checklistSnapshot === 'object') {
      checklistSnapshot = clone(record.checklistSnapshot);
    } else if (record.checklist_snapshot && typeof record.checklist_snapshot === 'object') {
      checklistSnapshot = clone(record.checklist_snapshot);
    } else if (recordSnapshot && recordSnapshot.checklist && typeof recordSnapshot.checklist === 'object') {
      checklistSnapshot = clone(recordSnapshot.checklist);
    }
    var snapshotBackfilledAt = normalizeReference(
      record.snapshotBackfilledAt ||
      record.snapshot_backfilled_at ||
      ''
    );

    return {
      assessment_id: assessmentId,
      master_assessment_id: assessmentId,
      parent_assessment_id: assessmentId,
      assessment_family_id: assessmentId,
      assessment_version_id: assessmentVersionId,
      assessment_record_id: assessmentVersionId,
      assessment_family_reference: assessmentId,
      master_reference: canonicalReference,
      display_reference: displayReference,
      assessment_reference: canonicalReference,
      version_status: status,
      facility_id: facilityId,
      facility_name: facilityName,
      facility_type: facilityType,
      location: location,
      assessor_name: assessorName,
      assessment_date: assessmentDate,
      start_time: startTime,
      location_coordinates: locationCoordinates,
      location_latitude: locationLatitude,
      location_longitude: locationLongitude,
      location_accuracy: locationAccuracy,
      location_status: locationStatus,
      location_captured_at: locationCapturedAt,
      current_step: currentStep || 'Assessment Checklist',
      current_section: currentSection,
      current_section_id: currentSectionId,
      current_section_index: currentSectionIndex,
      assessment_status: status,
      overall_risk_score: riskScore,
      overall_risk_level: riskLevel,
      submission_risk_score: submissionRiskScore,
      submission_risk_level: submissionRiskLevel,
      submission_risk_calculated_at: submissionRiskCalculatedAt,
      checklist_submitted_at: checklistSubmittedAt,
      corrective_action_submitted_at: correctiveSubmittedAt,
      final_submitted_at: finalSubmittedAt,
      is_published: !!isPublished,
      version_number: version,
      last_updated_at: lastUpdatedAt,
      failed_count: failedCount,
      critical_findings_count: criticalFindingsCount,
      additional_findings_count: additionalFindingsCount,
      answered_count: answeredCount,
      total_item_count: totalItemCount,
      corrective_items: correctiveItems,
      corrective_summary: record.correctiveSummary || record.corrective_summary || '',
      corrective_due_date: record.correctiveDueDate || record.corrective_due_date || '',
      revision: !!record.revision,
      reopenReason: record.reopenReason || '',
      snapshotId: snapshotId,
      lastSnapshotId: lastSnapshotId,
      checklist_snapshot: checklistSnapshot,
      snapshot_backfilled_at: snapshotBackfilledAt,

      // Backward compatible aliases consumed by existing pages
      inspectionRef: canonicalReference,
      masterReference: canonicalReference,
      displayReference: displayReference,
      versionStatus: status,
      version: version,
      facilityName: facilityName,
      facilityType: facilityType,
      inspector: assessorName,
      inspectionDate: assessmentDate,
      startTime: startTime,
      locationCoordinates: locationCoordinates,
      locationLatitude: locationLatitude,
      locationLongitude: locationLongitude,
      locationAccuracy: locationAccuracy,
      locationStatus: locationStatus,
      locationCapturedAt: locationCapturedAt,
      status: status,
      currentStage: currentStep || 'Assessment Checklist',
      overallRiskScore: riskScore,
      overallRiskLevel: riskLevel,
      submissionRiskScore: submissionRiskScore,
      submissionRiskLevel: submissionRiskLevel,
      submissionRiskCalculatedAt: submissionRiskCalculatedAt,
      checklistSubmittedAt: checklistSubmittedAt,
      correctiveSubmittedAt: correctiveSubmittedAt,
      publishedAt: finalSubmittedAt,
      lastUpdatedAt: lastUpdatedAt,
      failedCount: failedCount,
      criticalFindingsCount: criticalFindingsCount,
      additionalFindingsCount: additionalFindingsCount,
      answeredCount: answeredCount,
      totalItemCount: totalItemCount,
      correctiveItems: correctiveItems,
      correctiveSummary: record.correctiveSummary || record.corrective_summary || '',
      correctiveDueDate: record.correctiveDueDate || record.corrective_due_date || '',
      checklistSnapshot: checklistSnapshot,
      snapshotBackfilledAt: snapshotBackfilledAt
    };
  }

  function upsertRecord(record) {
    var records = getStoredRecords();
    var normalized = normalizeRecord(record);
    var idx = records.findIndex(function (item) {
      var itemMaster = stripVersionSuffix(normalizeReference(
        item.master_assessment_id ||
        item.parent_assessment_id ||
        item.assessment_family_id ||
        item.assessment_family_reference ||
        item.master_reference ||
        item.assessment_reference ||
        item.inspectionRef
      ));
      var targetMaster = stripVersionSuffix(normalizeReference(
        normalized.master_assessment_id ||
        normalized.parent_assessment_id ||
        normalized.assessment_family_id ||
        normalized.assessment_family_reference ||
        normalized.master_reference ||
        normalized.assessment_reference ||
        normalized.inspectionRef
      ));
      return itemMaster === targetMaster && Number(item.version || item.version_number || 0) === Number(normalized.version || normalized.version_number || 0);
    });
    if (idx >= 0) records[idx] = { ...records[idx], ...normalized };
    else records.push(normalized);
    saveRecords(records);
    return normalized;
  }

  function parseRiskLevelFromScore(score) {
    var n = Number(score || 0);
    if (n >= 17) return 'Critical';
    if (n >= 10) return 'High';
    if (n >= 5) return 'Medium';
    return 'Low';
  }

  function deriveChecklistMetrics(session) {
    var stats = {
      totalItems: 0,
      answeredItems: 0,
      failedChecklistItems: 0,
      criticalChecklistFindings: 0,
      additionalFindings: 0,
      criticalAdditionalFindings: 0,
      failedCount: 0,
      criticalFindingsCount: 0
    };
    if (!session || typeof session !== 'object') return stats;

    var catalog = session.catalog && typeof session.catalog === 'object' ? session.catalog : {};
    var sectionStates = session.sectionStates && typeof session.sectionStates === 'object' ? session.sectionStates : {};

    stats.totalItems = Object.keys(catalog).length;

    Object.keys(sectionStates).forEach(function (sectionId) {
      var ss = sectionStates[sectionId] || {};
      var responses = ss.responses && typeof ss.responses === 'object' ? ss.responses : {};
      Object.keys(responses).forEach(function (code) {
        var response = responses[code];
        if (!response) return;
        stats.answeredItems += 1;
        if (response !== 'N' && response !== 'P') return;
        stats.failedChecklistItems += 1;
        var item = catalog[code] || {};
        if (item.crit) stats.criticalChecklistFindings += 1;
      });
    });

    var findings = Array.isArray(session.findings) ? session.findings : [];
    stats.additionalFindings = findings.length;
    findings.forEach(function (finding) {
      var level = String((finding && finding.riskLevel) || parseRiskLevelFromScore(finding && finding.riskScore)).toLowerCase();
      if (level === 'critical') stats.criticalAdditionalFindings += 1;
    });

    stats.failedCount = stats.failedChecklistItems + stats.additionalFindings;
    stats.criticalFindingsCount = stats.criticalChecklistFindings + stats.criticalAdditionalFindings;
    if (!stats.totalItems) stats.totalItems = stats.answeredItems;
    return stats;
  }

  function resolveStageFromStatus(status) {
    if (status === STATUS.PUBLISHED) return 'Published Register';
    if (status === STATUS.PENDING_CORRECTIVE || status === STATUS.REVISED_CHECKLIST_SUBMITTED) return 'Corrective Action';
    if (status === STATUS.REOPENED || status === STATUS.REVISED_CORRECTIVE_SUBMITTED) return 'Reopened / Revision';
    return 'Assessment Checklist';
  }

  function syncCurrentRecordFromSession() {
    var facility = readJSON(SESSION_KEYS.facility, {});
    var checklistSession = readJSON(SESSION_KEYS.checklist, {});
    var correctiveSession = readJSON(SESSION_KEYS.corrective, {});
    var meta = getMeta(facility);

    var metrics = deriveChecklistMetrics(checklistSession);
    var submissionRisk = deriveSubmissionRisk(checklistSession);
    var currentSectionIndex = Number(localStorage.getItem('goil_current_section') || 0);
    if (!Number.isFinite(currentSectionIndex) || currentSectionIndex < 0) currentSectionIndex = 0;
    var currentSection = resolveCurrentSection(checklistSession, currentSectionIndex);
    var hasFacility = !!(facility && (facility.nameDisplay || facility.facilityType || facility.assessorName || facility.assessmentDate || facility.startTime || facility.locationCoordinates));
    var hasActivity =
      hasFacility ||
      metrics.answeredItems > 0 ||
      metrics.additionalFindings > 0 ||
      !!meta.checklistSubmittedAt ||
      !!meta.correctiveSubmittedAt ||
      !!meta.publishedToRegisterAt ||
      meta.status !== STATUS.DRAFT;

    if (!hasActivity) return null;

    var status = meta.status || STATUS.DRAFT;
    var currentVersion = resolveAssessmentVersion(meta, status);
    var existingPublished = findStoredRecordByReferenceVersion(meta.referenceNo, currentVersion);
    if (
      existingPublished &&
      (existingPublished.is_published === true || String(existingPublished.status || existingPublished.assessment_status || '').trim() === STATUS.PUBLISHED) &&
      (status === STATUS.PUBLISHED || !!meta.publishedToRegisterAt)
    ) {
      return existingPublished;
    }

    var now = nowIso();
    if ((status === STATUS.DRAFT || !status) && metrics.answeredItems > 0) {
      status = STATUS.IN_PROGRESS;
      meta.status = status;
      saveMeta(meta);
    }
    var version = resolveAssessmentVersion(meta, status);
    if (meta.versionCurrent !== version) {
      meta.versionCurrent = version;
      saveMeta(meta);
    }
    var currentStep = resolveCurrentStep(status, meta, currentSection);

    var dueDate = getEarliestDueDate(correctiveSession && correctiveSession.items);
    var existing = getStoredRecords().find(function (item) {
      return item.inspectionRef === meta.referenceNo && Number(item.version) === Number(version);
    }) || {};
    var liveChecklistSnapshot = (
      checklistSession &&
      typeof checklistSession === 'object' &&
      checklistSession.sectionStates &&
      checklistSession.catalog
    ) ? clone(checklistSession) : null;
    var snapshotToken = normalizeReference(
      meta.lastSnapshotId ||
      existing.snapshotId ||
      existing.lastSnapshotId ||
      ''
    );

    return upsertRecord({
      inspectionRef: meta.referenceNo,
      version: version,
      facilityName: facility.nameDisplay || meta.facilityName || existing.facilityName || '',
      facilityType: facility.facilityType || meta.facilityType || existing.facilityType || '',
      location: facility.zone || meta.location || existing.location || '',
      inspectionDate: facility.assessmentDate || meta.inspectionDate || existing.inspectionDate || '',
      startTime: facility.startTime || meta.startTime || existing.startTime || '',
      locationCoordinates: facility.locationCoordinates || meta.locationCoordinates || existing.locationCoordinates || '',
      locationLatitude: facility.locationLatitude || meta.locationLatitude || existing.locationLatitude || '',
      locationLongitude: facility.locationLongitude || meta.locationLongitude || existing.locationLongitude || '',
      locationAccuracy: facility.locationAccuracy || meta.locationAccuracy || existing.locationAccuracy || '',
      locationStatus: facility.locationStatus || meta.locationStatus || existing.locationStatus || '',
      locationCapturedAt: facility.locationCapturedAt || meta.locationCapturedAt || existing.locationCapturedAt || '',
      inspector: facility.assessorName || meta.inspectorName || existing.inspector || '',
      status: status,
      currentStage: currentStep,
      current_section: currentSection.label || '',
      current_section_id: currentSection.id || '',
      current_section_index: currentSectionIndex,
      overallRiskLevel: ((meta.overallRisk || {}).level) || existing.overallRiskLevel || '',
      overallRiskScore: ((meta.overallRisk || {}).score) || existing.overallRiskScore || 0,
      submissionRiskLevel: submissionRisk.level || existing.submissionRiskLevel || '',
      submissionRiskScore: submissionRisk.score != null ? submissionRisk.score : (existing.submissionRiskScore != null ? existing.submissionRiskScore : null),
      submissionRiskCalculatedAt: submissionRisk.calculatedAt || existing.submissionRiskCalculatedAt || '',
      correctiveSummary: metrics.failedCount + ' failed/non-compliant finding(s)',
      correctiveDueDate: dueDate || existing.correctiveDueDate || '',
      failedCount: metrics.failedCount,
      criticalFindingsCount: metrics.criticalFindingsCount,
      additionalFindingsCount: metrics.additionalFindings,
      answeredCount: metrics.answeredItems,
      totalItemCount: metrics.totalItems,
      correctiveItems: Array.isArray(correctiveSession.items) ? clone(correctiveSession.items) : [],
      is_published: status === STATUS.PUBLISHED,
      final_submitted_at: meta.publishedToRegisterAt || existing.publishedAt || '',
      checklistSubmittedAt: meta.checklistSubmittedAt || existing.checklistSubmittedAt || '',
      correctiveSubmittedAt: meta.correctiveSubmittedAt || existing.correctiveSubmittedAt || '',
      publishedAt: meta.publishedToRegisterAt || existing.publishedAt || '',
      lastUpdatedAt: meta.lastSavedAt || checklistSession.lastSaved || meta.lastUpdatedAt || now,
      revision: isRevisionVersionContext(meta, status) || !!existing.revision,
      reopenReason: meta.reopenReason || existing.reopenReason || '',
      snapshotId: snapshotToken,
      lastSnapshotId: snapshotToken,
      checklistSnapshot: liveChecklistSnapshot || existing.checklistSnapshot || existing.checklist_snapshot || null
    });
  }

  function initializeDraftRecord(seedFacility) {
    var facility = seedFacility && typeof seedFacility === 'object' ? seedFacility : {};
    var meta = getMeta(facility);
    var now = nowIso();
    var version = resolveAssessmentVersion(meta, STATUS.DRAFT);
    meta.versionCurrent = version;

    meta.status = STATUS.DRAFT;
    meta.lastPage = 'facility';
    meta.lastUpdatedAt = now;
    if (facility.nameDisplay) meta.facilityName = facility.nameDisplay;
    if (facility.facilityType) meta.facilityType = facility.facilityType;
    if (facility.assessorName) meta.inspectorName = facility.assessorName;
    if (facility.zone) meta.location = facility.zone;
    if (facility.assessmentDate) meta.inspectionDate = facility.assessmentDate;
    if (facility.startTime) meta.startTime = facility.startTime;
    if (facility.locationCoordinates) meta.locationCoordinates = facility.locationCoordinates;
    if (facility.locationLatitude) meta.locationLatitude = facility.locationLatitude;
    if (facility.locationLongitude) meta.locationLongitude = facility.locationLongitude;
    if (facility.locationAccuracy) meta.locationAccuracy = facility.locationAccuracy;
    if (facility.locationStatus) meta.locationStatus = facility.locationStatus;
    if (facility.locationCapturedAt) meta.locationCapturedAt = facility.locationCapturedAt;
    saveMeta(meta);

    return upsertRecord({
      inspectionRef: meta.referenceNo,
      version: version,
      facilityName: meta.facilityName || '',
      facilityType: meta.facilityType || '',
      location: meta.location || '',
      inspectionDate: meta.inspectionDate || '',
      startTime: meta.startTime || '',
      locationCoordinates: meta.locationCoordinates || '',
      locationLatitude: meta.locationLatitude || '',
      locationLongitude: meta.locationLongitude || '',
      locationAccuracy: meta.locationAccuracy || '',
      locationStatus: meta.locationStatus || '',
      locationCapturedAt: meta.locationCapturedAt || '',
      inspector: meta.inspectorName || '',
      status: STATUS.DRAFT,
      currentStage: 'Facility Details',
      current_section: 'Facility Details',
      current_section_id: 'facility',
      current_section_index: 0,
      overallRiskLevel: '',
      overallRiskScore: 0,
      submissionRiskLevel: 'Low',
      submissionRiskScore: null,
      submissionRiskCalculatedAt: '',
      correctiveSummary: '',
      correctiveDueDate: '',
      failedCount: 0,
      criticalFindingsCount: 0,
      additionalFindingsCount: 0,
      answeredCount: 0,
      totalItemCount: 0,
      is_published: false,
      final_submitted_at: '',
      checklistSubmittedAt: '',
      correctiveSubmittedAt: '',
      publishedAt: '',
      lastUpdatedAt: now,
      revision: false,
      reopenReason: ''
    });
  }

  function lockChecklistSnapshot(params) {
    var facility = params && params.facility ? params.facility : {};
    var actor = (params && params.actor) || facility.assessorName || 'Unknown User';
    var checklistSession = params && params.checklistSession ? params.checklistSession : {};
    var overallRisk = params && params.overallRisk ? params.overallRisk : {};
    var correctiveItems = params && params.correctiveItems ? params.correctiveItems : [];
    var failedCount = Number(params && params.failedCount ? params.failedCount : 0);
    var metrics = deriveChecklistMetrics(checklistSession);
    var submissionRisk = deriveSubmissionRisk(checklistSession);

    var meta = getMeta(facility);
    var now = nowIso();
    var isRevision = isRevisionVersionContext(meta, meta.status);
    var targetStatus = isRevision ? STATUS.REVISED_CHECKLIST_SUBMITTED : STATUS.PENDING_CORRECTIVE;
    var version = resolveAssessmentVersion(meta, targetStatus);
    var snapshotId = 'SNP-' + meta.referenceNo + '-V' + version + '-' + Date.now();

    var snapshot = {
      snapshotId: snapshotId,
      inspectionRef: meta.referenceNo,
      version: version,
      submittedAt: now,
      submittedBy: actor,
      statusAtSubmit: targetStatus,
      facility: clone(facility),
      overallRisk: clone(overallRisk),
      submissionRisk: clone(submissionRisk),
      checklist: clone(checklistSession),
      correctiveItems: normalizeCorrectiveItemsPayload(correctiveItems),
      failedCount: failedCount
    };

    var snapshots = getSnapshots().filter(function (item) {
      var itemRef = stripVersionSuffix(normalizeReference(item && (item.inspectionRef || item.referenceNo || '')));
      var itemVersion = normalizeVersionNumber(
        item && (item.version || item.version_number || parseVersionFromToken(item.snapshotId)) || 0
      );
      return !(itemRef === stripVersionSuffix(normalizeReference(meta.referenceNo || '')) && itemVersion === version);
    });
    snapshots.push(snapshot);
    saveSnapshots(snapshots);

    meta.versionCurrent = version;
    meta.checklistLocked = true;
    meta.revisionOpen = false;
    meta.reopenReason = '';
    meta.checklistSubmittedAt = now;
    meta.status = targetStatus;
    meta.lastSnapshotId = snapshotId;
    meta.overallRisk = clone(overallRisk || {});
    meta.overallRiskCalculatedAt = overallRisk && overallRisk.calculatedAt ? overallRisk.calculatedAt : now;
    meta.submissionRisk = clone(submissionRisk);
    meta.versionHistory.push({
      version: version,
      snapshotId: snapshotId,
      submittedAt: now,
      submittedBy: actor,
      revision: isRevision
    });
    saveMeta(meta);

    var dueDate = getEarliestDueDate(correctiveItems);
    upsertRecord({
      inspectionRef: meta.referenceNo,
      version: version,
      facilityName: facility.nameDisplay || meta.facilityName || '',
      facilityType: facility.facilityType || meta.facilityType || '',
      location: facility.zone || meta.location || '',
      inspectionDate: facility.assessmentDate || meta.inspectionDate || '',
      startTime: facility.startTime || meta.startTime || '',
      locationCoordinates: facility.locationCoordinates || meta.locationCoordinates || '',
      locationLatitude: facility.locationLatitude || meta.locationLatitude || '',
      locationLongitude: facility.locationLongitude || meta.locationLongitude || '',
      locationAccuracy: facility.locationAccuracy || meta.locationAccuracy || '',
      locationStatus: facility.locationStatus || meta.locationStatus || '',
      locationCapturedAt: facility.locationCapturedAt || meta.locationCapturedAt || '',
      inspector: facility.assessorName || meta.inspectorName || '',
      status: meta.status,
      currentStage: resolveStageFromStatus(meta.status),
      current_section: 'Review & Submit',
      current_section_id: 'review',
      current_section_index: Number(localStorage.getItem('goil_current_section') || 0),
      overallRiskLevel: (overallRisk && overallRisk.level) || '',
      overallRiskScore: (overallRisk && overallRisk.score) || 0,
      submissionRiskLevel: submissionRisk.level || '',
      submissionRiskScore: submissionRisk.score != null ? submissionRisk.score : null,
      submissionRiskCalculatedAt: submissionRisk.calculatedAt || now,
      correctiveSummary: failedCount + ' failed/non-compliant finding(s)',
      correctiveDueDate: dueDate,
      failedCount: failedCount,
      criticalFindingsCount: metrics.criticalFindingsCount,
      additionalFindingsCount: metrics.additionalFindings,
      answeredCount: metrics.answeredItems,
      totalItemCount: metrics.totalItems,
      correctiveItems: normalizeCorrectiveItemsPayload(correctiveItems),
      snapshotId: snapshotId,
      lastSnapshotId: snapshotId,
      checklistSnapshot: clone(checklistSession),
      is_published: false,
      final_submitted_at: '',
      checklistSubmittedAt: now,
      correctiveSubmittedAt: '',
      publishedAt: '',
      lastUpdatedAt: now,
      revision: isRevision,
      reopenReason: params && params.reopenReason ? params.reopenReason : ''
    });

    notify(
      'pending_corrective',
      'Corrective Action Pending',
      'Checklist submitted for ' + (facility.nameDisplay || meta.referenceNo) + '. Complete corrective action.',
      meta.referenceNo,
      dueDate
    );

    appendAudit('checklist_snapshot_locked', actor, {
      inspectionRef: meta.referenceNo,
      version: version,
      snapshotId: snapshotId,
      status: meta.status,
      failedCount: failedCount
    });

    return { meta: meta, snapshot: snapshot, version: version };
  }

  function finalizeCorrectiveSubmission(params) {
    var facility = params && params.facility ? params.facility : {};
    var actor = (params && params.actor) || facility.assessorName || 'Unknown User';
    var correctiveSession = params && params.correctiveSession ? params.correctiveSession : { items: [] };
    var overallRisk = params && params.overallRisk ? params.overallRisk : {};

    var meta = getMeta(facility);
    var submissionRisk = meta && meta.submissionRisk && typeof meta.submissionRisk === 'object'
      ? meta.submissionRisk
      : null;
    var now = nowIso();
    var version = resolveAssessmentVersion(meta, STATUS.PUBLISHED);
    var latestPublishedVersion = getLatestPublishedVersion(meta.referenceNo);
    var isRevision = latestPublishedVersion > 0 && version > latestPublishedVersion;
    var existingRecord = findStoredRecordByReferenceVersion(meta.referenceNo, version) || {};
    var snapshotList = getSnapshots();
    var publishedSnapshot = findSnapshotForRecord({
      assessment_reference: meta.referenceNo,
      master_reference: meta.referenceNo,
      inspectionRef: meta.referenceNo,
      version_number: version,
      version: version
    }, snapshotList);
    if (!publishedSnapshot) {
      var targetSnapshotId = normalizeReference(meta.lastSnapshotId || existingRecord.snapshotId || existingRecord.lastSnapshotId || '');
      if (targetSnapshotId) {
        publishedSnapshot = snapshotList.find(function (item) {
          return normalizeReference(item && item.snapshotId || '') === targetSnapshotId;
        }) || null;
      }
    }
    var liveChecklist = readJSON(SESSION_KEYS.checklist, {});
    var checklistSnapshot = publishedSnapshot && publishedSnapshot.checklist && typeof publishedSnapshot.checklist === 'object'
      ? clone(publishedSnapshot.checklist)
      : (
        existingRecord.checklistSnapshot && typeof existingRecord.checklistSnapshot === 'object'
          ? clone(existingRecord.checklistSnapshot)
          : (
            existingRecord.checklist_snapshot && typeof existingRecord.checklist_snapshot === 'object'
              ? clone(existingRecord.checklist_snapshot)
              : (
                liveChecklist && typeof liveChecklist === 'object' && liveChecklist.sectionStates && liveChecklist.catalog
                  ? clone(liveChecklist)
                  : null
              )
          )
      );
    var publishedSnapshotId = normalizeReference(
      (publishedSnapshot && publishedSnapshot.snapshotId) ||
      meta.lastSnapshotId ||
      existingRecord.snapshotId ||
      existingRecord.lastSnapshotId ||
      ''
    );

    if (isRevision) {
      meta.lastRevisionStatus = STATUS.REVISED_CORRECTIVE_SUBMITTED;
      appendAudit('revised_corrective_action_submitted', actor, {
        inspectionRef: meta.referenceNo,
        version: version
      });
    }

    meta.versionCurrent = version;
    meta.status = STATUS.PUBLISHED;
    meta.correctiveSubmittedAt = now;
    meta.publishedToRegisterAt = now;
    meta.lastPage = 'home';
    if (overallRisk && Object.keys(overallRisk).length) {
      meta.overallRisk = clone(overallRisk);
      meta.overallRiskCalculatedAt = overallRisk.calculatedAt || now;
    }
    saveMeta(meta);

    upsertRecord({
      inspectionRef: meta.referenceNo,
      version: version,
      facilityName: facility.nameDisplay || meta.facilityName || '',
      facilityType: facility.facilityType || meta.facilityType || '',
      location: facility.zone || meta.location || '',
      inspectionDate: facility.assessmentDate || meta.inspectionDate || '',
      startTime: facility.startTime || meta.startTime || '',
      locationCoordinates: facility.locationCoordinates || meta.locationCoordinates || '',
      locationLatitude: facility.locationLatitude || meta.locationLatitude || '',
      locationLongitude: facility.locationLongitude || meta.locationLongitude || '',
      locationAccuracy: facility.locationAccuracy || meta.locationAccuracy || '',
      locationStatus: facility.locationStatus || meta.locationStatus || '',
      locationCapturedAt: facility.locationCapturedAt || meta.locationCapturedAt || '',
      inspector: facility.assessorName || meta.inspectorName || '',
      status: STATUS.PUBLISHED,
      currentStage: resolveStageFromStatus(STATUS.PUBLISHED),
      current_section: 'Published Register',
      current_section_id: 'published',
      current_section_index: Number(localStorage.getItem('goil_current_section') || 0),
      overallRiskLevel: (overallRisk && overallRisk.level) || ((meta.overallRisk || {}).level || ''),
      overallRiskScore: (overallRisk && overallRisk.score) || ((meta.overallRisk || {}).score || 0),
      submissionRiskLevel: (submissionRisk && submissionRisk.level) || '',
      submissionRiskScore: submissionRisk && submissionRisk.score != null ? submissionRisk.score : null,
      submissionRiskCalculatedAt: (submissionRisk && submissionRisk.calculatedAt) || '',
      correctiveSummary: Array.isArray(correctiveSession.items) ? correctiveSession.items.length + ' corrective item(s)' : '',
      correctiveDueDate: getEarliestDueDate(correctiveSession.items),
      failedCount: Array.isArray(correctiveSession.items) ? correctiveSession.items.length : 0,
      criticalFindingsCount: (meta.overallRisk && meta.overallRisk.level === 'Critical')
        ? Array.isArray(correctiveSession.items) ? correctiveSession.items.length : 0
        : 0,
      correctiveItems: Array.isArray(correctiveSession.items) ? clone(correctiveSession.items) : [],
      snapshotId: publishedSnapshotId,
      lastSnapshotId: publishedSnapshotId,
      checklistSnapshot: checklistSnapshot,
      is_published: true,
      final_submitted_at: now,
      checklistSubmittedAt: meta.checklistSubmittedAt || '',
      correctiveSubmittedAt: now,
      publishedAt: now,
      lastUpdatedAt: now,
      revision: isRevision
    });

    notify(
      'published',
      'Inspection Published',
      'Inspection ' + meta.referenceNo + ' has been fully submitted and published.',
      meta.referenceNo,
      ''
    );

    appendAudit('inspection_published', actor, {
      inspectionRef: meta.referenceNo,
      version: version,
      correctiveCount: Array.isArray(correctiveSession.items) ? correctiveSession.items.length : 0,
      publishedAt: now
    });

    return { meta: meta };
  }

  function reopenForRevision(params) {
    var reason = String((params && params.reason) || '').trim();
    var facility = params && params.facility ? params.facility : {};
    var actorInput = params && params.actor;
    var actor = resolveActorName(actorInput, facility.assessorName || 'Unknown User');
    var actorRole = resolveActorRole(actorInput);

    if (!reason) {
      return { ok: false, error: 'Reopen reason is required.' };
    }
    if (!isAdminRole(actorRole)) {
      return { ok: false, error: 'Only Admin can reopen a published assessment for revision.' };
    }

    var meta = getMeta(facility);
    meta.status = STATUS.REOPENED;
    meta.revisionOpen = true;
    meta.checklistLocked = false;
    meta.reopenedAt = nowIso();
    meta.reopenReason = reason;
    meta.lastPage = 'checklist';
    saveMeta(meta);

    var nextVersion = getLatestPublishedVersion(meta.referenceNo) + 1;
    if (!Number.isFinite(nextVersion) || nextVersion < 1) nextVersion = 1;
    meta.versionCurrent = nextVersion;
    saveMeta(meta);

    upsertRecord({
      inspectionRef: meta.referenceNo,
      version: nextVersion,
      facilityName: facility.nameDisplay || meta.facilityName || '',
      facilityType: facility.facilityType || meta.facilityType || '',
      location: facility.zone || meta.location || '',
      inspectionDate: facility.assessmentDate || meta.inspectionDate || '',
      startTime: facility.startTime || meta.startTime || '',
      locationCoordinates: facility.locationCoordinates || meta.locationCoordinates || '',
      locationLatitude: facility.locationLatitude || meta.locationLatitude || '',
      locationLongitude: facility.locationLongitude || meta.locationLongitude || '',
      locationAccuracy: facility.locationAccuracy || meta.locationAccuracy || '',
      locationStatus: facility.locationStatus || meta.locationStatus || '',
      locationCapturedAt: facility.locationCapturedAt || meta.locationCapturedAt || '',
      inspector: facility.assessorName || meta.inspectorName || '',
      status: STATUS.REOPENED,
      currentStage: resolveStageFromStatus(STATUS.REOPENED),
      current_section: 'Assessment Checklist',
      current_section_id: 'checklist',
      current_section_index: Number(localStorage.getItem('goil_current_section') || 0),
      is_published: false,
      lastUpdatedAt: nowIso(),
      revision: true,
      reopenReason: reason
    });

    appendAudit('inspection_reopened_for_revision', actor, {
      inspectionRef: meta.referenceNo,
      version: nextVersion,
      reason: reason
    });

    notify(
      'reopened',
      'Inspection Reopened',
      'Inspection ' + meta.referenceNo + ' was reopened for revision.',
      meta.referenceNo,
      ''
    );

    return { ok: true, meta: meta };
  }

  function isChecklistLocked(metaObj) {
    var meta = metaObj || getMeta({});
    if (meta.revisionOpen || meta.status === STATUS.REOPENED) return false;
    return !!meta.checklistLocked;
  }

  function asDate(value) {
    if (!value) return null;
    var d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  function isRecordOverdue(record) {
    if (!record || PENDING_SET.indexOf(record.status) < 0) return false;
    var due = asDate(record.correctiveDueDate);
    if (!due) return false;
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    return due < now;
  }

  function compareRecordFreshness(a, b) {
    var aVersion = normalizeVersionNumber(a && (a.version || a.version_number));
    var bVersion = normalizeVersionNumber(b && (b.version || b.version_number));
    if (aVersion !== bVersion) return aVersion - bVersion;

    var aPublished = !!(
      a && (
        a.is_published === true ||
        String(a.status || a.assessment_status || '').trim() === STATUS.PUBLISHED ||
        a.final_submitted_at ||
        a.publishedAt
      )
    );
    var bPublished = !!(
      b && (
        b.is_published === true ||
        String(b.status || b.assessment_status || '').trim() === STATUS.PUBLISHED ||
        b.final_submitted_at ||
        b.publishedAt
      )
    );
    if (aPublished !== bPublished) return aPublished ? 1 : -1;

    var aUpdated = asDate(a && (
      a.final_submitted_at ||
      a.publishedAt ||
      a.correctiveSubmittedAt ||
      a.corrective_action_submitted_at ||
      a.checklistSubmittedAt ||
      a.checklist_submitted_at ||
      a.lastUpdatedAt ||
      a.last_updated_at ||
      a.createdAt
    ));
    var bUpdated = asDate(b && (
      b.final_submitted_at ||
      b.publishedAt ||
      b.correctiveSubmittedAt ||
      b.corrective_action_submitted_at ||
      b.checklistSubmittedAt ||
      b.checklist_submitted_at ||
      b.lastUpdatedAt ||
      b.last_updated_at ||
      b.createdAt
    ));
    var aTime = aUpdated ? aUpdated.getTime() : 0;
    var bTime = bUpdated ? bUpdated.getTime() : 0;
    return aTime - bTime;
  }

  function getLatestRecordsByMaster(records) {
    var source = Array.isArray(records) ? records : [];
    var byMaster = {};
    source.forEach(function (record, idx) {
      var key = stripVersionSuffix(normalizeReference(
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
      ));
      if (!key) key = '__UNREF__' + String(idx);
      var prev = byMaster[key];
      if (!prev || compareRecordFreshness(prev, record) < 0) {
        byMaster[key] = record;
      }
    });
    return Object.keys(byMaster).map(function (key) { return byMaster[key]; });
  }

  function getQueueCounts() {
    var records = getLatestRecordsByMaster(getRecords());
    var counts = {
      draft: 0,
      pendingCorrective: 0,
      awaitingReview: 0,
      published: 0,
      overdueCorrective: 0
    };

    records.forEach(function (record) {
      if (record.is_published) counts.published += 1;
      if (record.status === STATUS.DRAFT || record.status === STATUS.IN_PROGRESS || record.status === STATUS.REOPENED) counts.draft += 1;
      if (PENDING_SET.indexOf(record.status) >= 0) counts.pendingCorrective += 1;
      if (record.status === STATUS.AWAITING_REVIEW) counts.awaitingReview += 1;
      if (isRecordOverdue(record)) counts.overdueCorrective += 1;
    });

    return counts;
  }

  function matchText(haystack, needle) {
    if (!needle) return true;
    var source = String(haystack || '').toLowerCase();
    return source.indexOf(String(needle).toLowerCase()) >= 0;
  }

  function listRecords(filters) {
    filters = filters || {};
    var records = getRecords();
    var includeVersions = !!filters.includeVersions;
    if (!includeVersions) {
      records = getLatestRecordsByMaster(records);
    }
    return records.filter(function (record) {
      if (filters.search) {
        var hit =
          matchText(record.inspectionRef, filters.search) ||
          matchText(record.display_reference, filters.search) ||
          matchText(record.facilityName, filters.search) ||
          matchText(record.inspector, filters.search);
        if (!hit) return false;
      }
      if (filters.facilityType && record.facilityType !== filters.facilityType) return false;
      if (filters.location && record.location !== filters.location) return false;
      if (filters.status && record.status !== filters.status) return false;
      if (filters.inspector && record.inspector !== filters.inspector) return false;
      if (filters.riskLevel && record.overallRiskLevel !== filters.riskLevel) return false;
      if (filters.queue) {
        if (filters.queue === 'draft' && !(record.status === STATUS.DRAFT || record.status === STATUS.IN_PROGRESS || record.status === STATUS.REOPENED)) return false;
        if (filters.queue === 'pending' && PENDING_SET.indexOf(record.status) < 0) return false;
        if (filters.queue === 'awaiting' && record.status !== STATUS.AWAITING_REVIEW) return false;
        if (filters.queue === 'published' && record.status !== STATUS.PUBLISHED) return false;
        if (filters.queue === 'overdue' && !isRecordOverdue(record)) return false;
      }
      if (filters.dateFrom) {
        var dateFrom = asDate(filters.dateFrom);
        var dateVal = asDate(record.inspectionDate || record.checklistSubmittedAt || record.lastUpdatedAt);
        if (dateFrom && dateVal && dateVal < dateFrom) return false;
      }
      if (filters.dateTo) {
        var dateTo = asDate(filters.dateTo);
        var dateTarget = asDate(record.inspectionDate || record.checklistSubmittedAt || record.lastUpdatedAt);
        if (dateTo && dateTarget && dateTarget > dateTo) return false;
      }
      return true;
    }).sort(function (a, b) {
      return new Date(b.lastUpdatedAt || 0) - new Date(a.lastUpdatedAt || 0);
    });
  }

  function refreshOverdueNotifications() {
    var records = getLatestRecordsByMaster(getRecords());
    records.forEach(function (record) {
      if (!isRecordOverdue(record)) return;
      var notifications = getNotifications();
      var exists = notifications.some(function (item) {
        return item.type === 'overdue_corrective' && item.referenceNo === record.inspectionRef && item.status !== 'read';
      });
      if (!exists) {
        notify(
          'overdue_corrective',
          'Overdue Corrective Action',
          'Inspection ' + record.inspectionRef + ' has overdue corrective action items.',
          record.inspectionRef,
          record.correctiveDueDate || ''
        );
      }
    });
  }

  function clearAllWorkflowData() {
    [KEYS.meta, KEYS.audit, KEYS.snapshots, KEYS.records, KEYS.notifications].forEach(function (key) {
      localStorage.removeItem(key);
    });
  }

  function clearActiveAssessmentSession(options) {
    var opts = options && typeof options === 'object' ? options : {};
    [
      SESSION_KEYS.facility,
      SESSION_KEYS.checklist,
      SESSION_KEYS.corrective,
      'goil_current_section',
      'goil_review_state'
    ].forEach(function (key) {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    });

    if (opts.preserveMeta) {
      var meta = getMeta({});
      meta.lastPage = 'home';
      meta.lastUpdatedAt = nowIso();
      saveMeta(meta);
      return;
    }

    localStorage.removeItem(KEYS.meta);
  }

  window.GoilWorkflow = {
    KEYS: KEYS,
    STATUS: STATUS,
    nowIso: nowIso,
    readJSON: readJSON,
    writeJSON: writeJSON,
    getMeta: getMeta,
    saveMeta: saveMeta,
    appendAudit: appendAudit,
    getSnapshots: getSnapshots,
    getRecords: getRecords,
    initializeDraftRecord: initializeDraftRecord,
    getNotifications: getNotifications,
    markNotificationRead: markNotificationRead,
    lockChecklistSnapshot: lockChecklistSnapshot,
    finalizeCorrectiveSubmission: finalizeCorrectiveSubmission,
    reopenForRevision: reopenForRevision,
    deriveSubmissionRisk: deriveSubmissionRisk,
    isChecklistLocked: isChecklistLocked,
    getQueueCounts: getQueueCounts,
    listRecords: listRecords,
    getLatestRecordsByMaster: getLatestRecordsByMaster,
    formatDisplayReference: formatDisplayReference,
    refreshOverdueNotifications: refreshOverdueNotifications,
    clearAllWorkflowData: clearAllWorkflowData,
    isRecordOverdue: isRecordOverdue,
    clearActiveAssessmentSession: clearActiveAssessmentSession
  };
})(window);

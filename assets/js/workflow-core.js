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

  function formatDisplayReference(referenceNo, versionNumber) {
    var base = stripVersionSuffix(referenceNo) || '-';
    var version = normalizeVersionNumber(versionNumber);
    return base + '-v' + String(version);
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

  function getStoredRecords() {
    var list = readJSON(KEYS.records, []);
    return Array.isArray(list) ? list : [];
  }

  function getRecords() {
    syncCurrentRecordFromSession();
    var records = getStoredRecords();
    if (!Array.isArray(records) || !records.length) return [];

    var byKey = {};
    records.forEach(function (record, idx) {
      var normalized = normalizeRecord(record);
      var ref = stripVersionSuffix(normalizeReference(normalized.inspectionRef || normalized.assessment_reference || ''));
      var master = stripVersionSuffix(normalizeReference(
        normalized.master_assessment_id ||
        normalized.parent_assessment_id ||
        normalized.assessment_family_id ||
        normalized.assessment_family_reference ||
        normalized.master_reference ||
        ref
      ));
      var version = normalizeVersionNumber(normalized.version || normalized.version_number || 1);
      var key = (master || ref || ('UNREF-' + String(idx))) + '::' + String(version);
      var prev = byKey[key];
      if (!prev || compareRecordFreshness(prev, normalized) < 0) {
        byKey[key] = normalized;
      }
    });

    var normalizedList = Object.keys(byKey).map(function (key) { return byKey[key]; })
      .sort(function (a, b) { return new Date(b.lastUpdatedAt || 0) - new Date(a.lastUpdatedAt || 0); });
    saveRecords(normalizedList);
    return normalizedList;
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
      current_step: currentStep || 'Assessment Checklist',
      current_section: currentSection,
      current_section_id: currentSectionId,
      current_section_index: currentSectionIndex,
      assessment_status: status,
      overall_risk_score: riskScore,
      overall_risk_level: riskLevel,
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
      corrective_summary: record.correctiveSummary || record.corrective_summary || '',
      corrective_due_date: record.correctiveDueDate || record.corrective_due_date || '',
      revision: !!record.revision,
      reopenReason: record.reopenReason || '',

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
      status: status,
      currentStage: currentStep || 'Assessment Checklist',
      overallRiskScore: riskScore,
      overallRiskLevel: riskLevel,
      checklistSubmittedAt: checklistSubmittedAt,
      correctiveSubmittedAt: correctiveSubmittedAt,
      publishedAt: finalSubmittedAt,
      lastUpdatedAt: lastUpdatedAt,
      failedCount: failedCount,
      criticalFindingsCount: criticalFindingsCount,
      additionalFindingsCount: additionalFindingsCount,
      answeredCount: answeredCount,
      totalItemCount: totalItemCount,
      correctiveSummary: record.correctiveSummary || record.corrective_summary || '',
      correctiveDueDate: record.correctiveDueDate || record.corrective_due_date || ''
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
    var currentSectionIndex = Number(localStorage.getItem('goil_current_section') || 0);
    if (!Number.isFinite(currentSectionIndex) || currentSectionIndex < 0) currentSectionIndex = 0;
    var currentSection = resolveCurrentSection(checklistSession, currentSectionIndex);
    var hasFacility = !!(facility && (facility.nameDisplay || facility.facilityType || facility.assessorName || facility.assessmentDate));
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
    var now = nowIso();
    var versionBase = Number(meta.versionCurrent || 0);
    if (!Number.isFinite(versionBase) || versionBase < 0) versionBase = 0;
    var isRevisionWorking = !!meta.revisionOpen || status === STATUS.REOPENED || status === STATUS.REVISED_CORRECTIVE_SUBMITTED;
    var version = isRevisionWorking ? (versionBase + 1) : versionBase;
    if (version < 1) version = 1;

    if ((status === STATUS.DRAFT || !status) && metrics.answeredItems > 0) {
      status = STATUS.IN_PROGRESS;
      meta.status = status;
      saveMeta(meta);
    }
    var currentStep = resolveCurrentStep(status, meta, currentSection);

    var dueDate = getEarliestDueDate(correctiveSession && correctiveSession.items);
    var existing = getStoredRecords().find(function (item) {
      return item.inspectionRef === meta.referenceNo && Number(item.version) === Number(version);
    }) || {};

    return upsertRecord({
      inspectionRef: meta.referenceNo,
      version: version,
      facilityName: facility.nameDisplay || meta.facilityName || existing.facilityName || '',
      facilityType: facility.facilityType || meta.facilityType || existing.facilityType || '',
      location: facility.zone || meta.location || existing.location || '',
      inspectionDate: facility.assessmentDate || meta.inspectionDate || existing.inspectionDate || '',
      inspector: facility.assessorName || meta.inspectorName || existing.inspector || '',
      status: status,
      currentStage: currentStep,
      current_section: currentSection.label || '',
      current_section_id: currentSection.id || '',
      current_section_index: currentSectionIndex,
      overallRiskLevel: ((meta.overallRisk || {}).level) || existing.overallRiskLevel || '',
      overallRiskScore: ((meta.overallRisk || {}).score) || existing.overallRiskScore || 0,
      correctiveSummary: metrics.failedCount + ' failed/non-compliant finding(s)',
      correctiveDueDate: dueDate || existing.correctiveDueDate || '',
      failedCount: metrics.failedCount,
      criticalFindingsCount: metrics.criticalFindingsCount,
      additionalFindingsCount: metrics.additionalFindings,
      answeredCount: metrics.answeredItems,
      totalItemCount: metrics.totalItems,
      is_published: status === STATUS.PUBLISHED,
      final_submitted_at: meta.publishedToRegisterAt || existing.publishedAt || '',
      checklistSubmittedAt: meta.checklistSubmittedAt || existing.checklistSubmittedAt || '',
      correctiveSubmittedAt: meta.correctiveSubmittedAt || existing.correctiveSubmittedAt || '',
      publishedAt: meta.publishedToRegisterAt || existing.publishedAt || '',
      lastUpdatedAt: meta.lastSavedAt || checklistSession.lastSaved || meta.lastUpdatedAt || now,
      revision: !!meta.revisionOpen || status === STATUS.REOPENED || !!existing.revision,
      reopenReason: meta.reopenReason || existing.reopenReason || ''
    });
  }

  function initializeDraftRecord(seedFacility) {
    var facility = seedFacility && typeof seedFacility === 'object' ? seedFacility : {};
    var meta = getMeta(facility);
    var now = nowIso();
    var version = Number(meta.versionCurrent || 0);
    if (!Number.isFinite(version) || version < 1) version = 1;

    meta.status = STATUS.DRAFT;
    meta.lastPage = 'facility';
    meta.lastUpdatedAt = now;
    if (facility.nameDisplay) meta.facilityName = facility.nameDisplay;
    if (facility.facilityType) meta.facilityType = facility.facilityType;
    if (facility.assessorName) meta.inspectorName = facility.assessorName;
    if (facility.zone) meta.location = facility.zone;
    if (facility.assessmentDate) meta.inspectionDate = facility.assessmentDate;
    saveMeta(meta);

    return upsertRecord({
      inspectionRef: meta.referenceNo,
      version: version,
      facilityName: meta.facilityName || '',
      facilityType: meta.facilityType || '',
      location: meta.location || '',
      inspectionDate: meta.inspectionDate || '',
      inspector: meta.inspectorName || '',
      status: STATUS.DRAFT,
      currentStage: 'Facility Details',
      current_section: 'Facility Details',
      current_section_id: 'facility',
      current_section_index: 0,
      overallRiskLevel: '',
      overallRiskScore: 0,
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

    var meta = getMeta(facility);
    var now = nowIso();
    var isRevision = !!meta.revisionOpen || meta.status === STATUS.REOPENED;
    var version = Number(meta.versionCurrent || 0) + 1;
    var snapshotId = 'SNP-' + meta.referenceNo + '-V' + version + '-' + Date.now();

    var snapshot = {
      snapshotId: snapshotId,
      inspectionRef: meta.referenceNo,
      version: version,
      submittedAt: now,
      submittedBy: actor,
      statusAtSubmit: isRevision ? STATUS.REVISED_CHECKLIST_SUBMITTED : STATUS.PENDING_CORRECTIVE,
      facility: clone(facility),
      overallRisk: clone(overallRisk),
      checklist: clone(checklistSession),
      failedCount: failedCount
    };

    var snapshots = getSnapshots();
    snapshots.push(snapshot);
    saveSnapshots(snapshots);

    meta.versionCurrent = version;
    meta.checklistLocked = true;
    meta.revisionOpen = false;
    meta.reopenReason = '';
    meta.checklistSubmittedAt = now;
    meta.status = isRevision ? STATUS.REVISED_CHECKLIST_SUBMITTED : STATUS.PENDING_CORRECTIVE;
    meta.lastSnapshotId = snapshotId;
    meta.overallRisk = clone(overallRisk || {});
    meta.overallRiskCalculatedAt = overallRisk && overallRisk.calculatedAt ? overallRisk.calculatedAt : now;
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
      inspector: facility.assessorName || meta.inspectorName || '',
      status: meta.status,
      currentStage: resolveStageFromStatus(meta.status),
      current_section: 'Review & Submit',
      current_section_id: 'review',
      current_section_index: Number(localStorage.getItem('goil_current_section') || 0),
      overallRiskLevel: (overallRisk && overallRisk.level) || '',
      overallRiskScore: (overallRisk && overallRisk.score) || 0,
      correctiveSummary: failedCount + ' failed/non-compliant finding(s)',
      correctiveDueDate: dueDate,
      failedCount: failedCount,
      criticalFindingsCount: metrics.criticalFindingsCount,
      additionalFindingsCount: metrics.additionalFindings,
      answeredCount: metrics.answeredItems,
      totalItemCount: metrics.totalItems,
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
    var now = nowIso();
    var isRevision = Number(meta.versionCurrent || 0) > 1 || meta.status === STATUS.REVISED_CHECKLIST_SUBMITTED;

    if (isRevision) {
      meta.lastRevisionStatus = STATUS.REVISED_CORRECTIVE_SUBMITTED;
      appendAudit('revised_corrective_action_submitted', actor, {
        inspectionRef: meta.referenceNo,
        version: meta.versionCurrent || 1
      });
    }

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
      version: Number(meta.versionCurrent || 1),
      facilityName: facility.nameDisplay || meta.facilityName || '',
      facilityType: facility.facilityType || meta.facilityType || '',
      location: facility.zone || meta.location || '',
      inspectionDate: facility.assessmentDate || meta.inspectionDate || '',
      inspector: facility.assessorName || meta.inspectorName || '',
      status: STATUS.PUBLISHED,
      currentStage: resolveStageFromStatus(STATUS.PUBLISHED),
      current_section: 'Published Register',
      current_section_id: 'published',
      current_section_index: Number(localStorage.getItem('goil_current_section') || 0),
      overallRiskLevel: (overallRisk && overallRisk.level) || ((meta.overallRisk || {}).level || ''),
      overallRiskScore: (overallRisk && overallRisk.score) || ((meta.overallRisk || {}).score || 0),
      correctiveSummary: Array.isArray(correctiveSession.items) ? correctiveSession.items.length + ' corrective item(s)' : '',
      correctiveDueDate: getEarliestDueDate(correctiveSession.items),
      failedCount: Array.isArray(correctiveSession.items) ? correctiveSession.items.length : 0,
      criticalFindingsCount: (meta.overallRisk && meta.overallRisk.level === 'Critical')
        ? Array.isArray(correctiveSession.items) ? correctiveSession.items.length : 0
        : 0,
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
      version: meta.versionCurrent || 1,
      correctiveCount: Array.isArray(correctiveSession.items) ? correctiveSession.items.length : 0,
      publishedAt: now
    });

    return { meta: meta };
  }

  function reopenForRevision(params) {
    var reason = String((params && params.reason) || '').trim();
    var facility = params && params.facility ? params.facility : {};
    var actor = (params && params.actor) || facility.assessorName || 'Unknown User';

    if (!reason) {
      return { ok: false, error: 'Reopen reason is required.' };
    }

    var meta = getMeta(facility);
    meta.status = STATUS.REOPENED;
    meta.revisionOpen = true;
    meta.checklistLocked = false;
    meta.reopenedAt = nowIso();
    meta.reopenReason = reason;
    meta.lastPage = 'checklist';
    saveMeta(meta);

    var nextVersion = normalizeVersionNumber(Number(meta.versionCurrent || 0) + 1);

    upsertRecord({
      inspectionRef: meta.referenceNo,
      version: nextVersion,
      facilityName: facility.nameDisplay || meta.facilityName || '',
      facilityType: facility.facilityType || meta.facilityType || '',
      location: facility.zone || meta.location || '',
      inspectionDate: facility.assessmentDate || meta.inspectionDate || '',
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

    var aUpdated = asDate(a && (a.lastUpdatedAt || a.last_updated_at || a.checklistSubmittedAt || a.createdAt));
    var bUpdated = asDate(b && (b.lastUpdatedAt || b.last_updated_at || b.checklistSubmittedAt || b.createdAt));
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
    isChecklistLocked: isChecklistLocked,
    getQueueCounts: getQueueCounts,
    listRecords: listRecords,
    getLatestRecordsByMaster: getLatestRecordsByMaster,
    formatDisplayReference: formatDisplayReference,
    refreshOverdueNotifications: refreshOverdueNotifications,
    clearAllWorkflowData: clearAllWorkflowData,
    isRecordOverdue: isRecordOverdue
  };
})(window);

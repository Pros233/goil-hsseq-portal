(function () {
  "use strict";

  var STORAGE_KEYS = {
    auth: "goilAuth",
    user: "goilUser",
    drafts: "goilAssessmentDrafts",
    submitted: "goilSubmittedAssessments",
    findings: "goilFindings",
    actions: "goilActions",
    audit: "goilAuditLog",
    dashboard: "goilDashboardCache"
  };

  var RESPONSE_FACTORS = {
    Compliant: 1,
    "Partially Compliant": 0.5,
    "Non-Compliant": 0,
    "Not Applicable": null
  };

  var ACTION_STATUSES = ["Open", "In Progress", "Pending Verification", "Closed", "Overdue", "Cancelled"];
  var ROOT_CAUSE_TAGS = [
    "Human Factors",
    "Procedure Gap",
    "Equipment Failure",
    "Training Gap",
    "Design Limitation",
    "Contractor Control",
    "Unknown"
  ];

  var state = {
    facilities: [],
    filteredFacilities: [],
    questionBank: [],
    questionBankById: {},
    templates: {},
    activeTemplate: null,
    activeAssessment: null,
    activeArea: null,
    user: { username: "HSSEQ User", role: "Inspector / Assessor" },
    autosaveTimer: null
  };

  function loadJsonData(path) {
    return fetch(path).then(function (response) {
      if (!response.ok) {
        throw new Error("Unable to load: " + path);
      }
      return response.json();
    });
  }

  function saveToStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function loadFromStorage(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function addAuditLog(eventType, detail) {
    var logs = loadFromStorage(STORAGE_KEYS.audit, []);
    logs.push({
      id: uid("AUD"),
      eventType: eventType,
      detail: detail || {},
      user: state.user.username,
      role: state.user.role,
      timestamp: new Date().toISOString()
    });

    if (logs.length > 1000) {
      logs = logs.slice(logs.length - 1000);
    }

    saveToStorage(STORAGE_KEYS.audit, logs);
  }

  function uid(prefix) {
    return [prefix, Date.now(), Math.floor(Math.random() * 100000)].join("-");
  }

  function toDate(dateString) {
    if (!dateString) return null;
    return new Date(dateString + "T00:00:00");
  }

  function toIsoDate(dateObj) {
    if (!dateObj || isNaN(dateObj.getTime())) return "";
    var month = String(dateObj.getMonth() + 1).padStart(2, "0");
    var day = String(dateObj.getDate()).padStart(2, "0");
    return [dateObj.getFullYear(), month, day].join("-");
  }

  function formatDate(dateString) {
    if (!dateString) return "-";
    var date = new Date(dateString);
    if (isNaN(date.getTime())) {
      date = toDate(dateString);
    }
    if (!date || isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  function daysBetween(fromDate, toDateValue) {
    var fromUtc = Date.UTC(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
    var toUtc = Date.UTC(toDateValue.getFullYear(), toDateValue.getMonth(), toDateValue.getDate());
    return Math.round((toUtc - fromUtc) / 86400000);
  }

  function calculateDueState(facility) {
    var today = new Date();
    var lastAssessment = toDate(facility.lastAssessmentDate);
    var nextDue = toDate(facility.nextDueDate);

    if (!nextDue && lastAssessment) {
      nextDue = new Date(lastAssessment.getTime());
      nextDue.setDate(nextDue.getDate() + 90);
    }

    if (!nextDue) {
      return {
        state: "on-track",
        label: "On Track",
        className: "due-on-track",
        dueDate: null,
        daysToDue: null
      };
    }

    var daysToDue = daysBetween(today, nextDue);
    if (daysToDue < 0) {
      return { state: "overdue", label: "Overdue", className: "due-overdue", dueDate: nextDue, daysToDue: daysToDue };
    }
    if (daysToDue === 0) {
      return { state: "due-today", label: "Due Today", className: "due-today", dueDate: nextDue, daysToDue: daysToDue };
    }
    if (daysToDue <= 30) {
      return { state: "due-soon", label: "Due Soon", className: "due-soon", dueDate: nextDue, daysToDue: daysToDue };
    }

    return { state: "on-track", label: "On Track", className: "due-on-track", dueDate: nextDue, daysToDue: daysToDue };
  }

  function calculateRiskScore(severity, likelihood) {
    var sev = Number(severity) || 1;
    var lik = Number(likelihood) || 1;
    return sev * lik;
  }

  function getRiskBand(score) {
    var numeric = Number(score) || 0;
    if (numeric >= 17) return "Critical";
    if (numeric >= 10) return "High";
    if (numeric >= 5) return "Medium";
    return "Low";
  }

  function getPriorityFromRiskBand(riskBand) {
    if (riskBand === "Critical") return "Critical";
    if (riskBand === "High") return "High";
    if (riskBand === "Medium") return "Medium";
    return "Low";
  }

  function getSuggestedDueDate(priority) {
    var days = 60;
    if (priority === "Critical") days = 7;
    if (priority === "High") days = 14;
    if (priority === "Medium") days = 30;

    var date = new Date();
    date.setDate(date.getDate() + days);
    return toIsoDate(date);
  }

  function calculateComplianceScore(questionList, responses) {
    var totals = {
      totalQuestions: questionList.length,
      applicableQuestions: 0,
      answeredQuestions: 0,
      deviations: 0,
      achievedWeightedPoints: 0,
      applicableWeight: 0,
      compliancePercent: 0,
      responseBreakdown: {
        Compliant: 0,
        "Partially Compliant": 0,
        "Non-Compliant": 0,
        "Not Applicable": 0,
        Unanswered: 0
      }
    };

    questionList.forEach(function (question) {
      var responseRecord = responses[question.questionId] || {};
      var response = responseRecord.response || "";
      var weight = Number(question.weight) || 1;

      if (!response) {
        totals.responseBreakdown.Unanswered += 1;
        totals.applicableQuestions += 1;
        totals.applicableWeight += weight;
        return;
      }

      totals.answeredQuestions += 1;

      if (response === "Not Applicable") {
        totals.responseBreakdown[response] += 1;
        return;
      }

      totals.applicableQuestions += 1;
      totals.applicableWeight += weight;

      var factor = RESPONSE_FACTORS[response];
      if (factor === null || typeof factor === "undefined") {
        factor = 0;
      }

      totals.achievedWeightedPoints += weight * factor;
      totals.responseBreakdown[response] += 1;

      if (response === "Partially Compliant" || response === "Non-Compliant") {
        totals.deviations += 1;
      }
    });

    if (totals.applicableWeight > 0) {
      totals.compliancePercent = (totals.achievedWeightedPoints / totals.applicableWeight) * 100;
    }

    return totals;
  }

  function getTemplateFileKeyByType(facilityType) {
    if (facilityType === "Fuel Station") return "fuelStation";
    if (facilityType === "LPG Plant") return "lpgPlant";
    if (facilityType === "Office") return "office";
    if (facilityType === "Office & Depot") return "officeDepot";
    return "fuelStation";
  }

  function getResponse(questionId) {
    if (!state.activeAssessment) {
      return null;
    }

    if (!state.activeAssessment.responses[questionId]) {
      state.activeAssessment.responses[questionId] = {
        questionId: questionId,
        response: "",
        comment: "",
        evidenceNote: "",
        assessorNote: "",
        immediateCorrection: "",
        immediateContainment: "",
        actionOwner: "",
        targetDueDate: "",
        rootCauseTag: "",
        severityOverride: "",
        likelihoodOverride: ""
      };
    }

    return state.activeAssessment.responses[questionId];
  }

  function appliesToFacility(question, facilityType, enabledModules) {
    var typeOk = !question.appliesToFacilityTypes || question.appliesToFacilityTypes.indexOf(facilityType) >= 0;
    if (!typeOk) {
      return false;
    }

    var appliesModules = question.appliesToModules || [];
    if (!appliesModules.length || appliesModules.indexOf("All") >= 0 || appliesModules.indexOf("Core") >= 0) {
      return true;
    }

    return appliesModules.some(function (module) {
      return enabledModules.indexOf(module) >= 0;
    });
  }

  function buildTemplateForFacility(facility) {
    var templateKey = getTemplateFileKeyByType(facility.type);
    var template = state.templates[templateKey];

    if (!template) {
      return null;
    }

    var questionIds = [];

    function addQuestionId(questionId) {
      if (questionIds.indexOf(questionId) < 0) {
        questionIds.push(questionId);
      }
    }

    (template.baseQuestionIds || []).forEach(addQuestionId);

    (facility.enabledModules || []).forEach(function (module) {
      var moduleQuestionIds = (template.moduleQuestionIds && template.moduleQuestionIds[module]) || [];
      moduleQuestionIds.forEach(addQuestionId);
    });

    var questions = questionIds
      .map(function (questionId) {
        return state.questionBankById[questionId];
      })
      .filter(Boolean)
      .filter(function (question) {
        return appliesToFacility(question, facility.type, facility.enabledModules || []);
      });

    var grouped = {};
    questions.forEach(function (question) {
      if (!grouped[question.area]) {
        grouped[question.area] = [];
      }
      grouped[question.area].push(question);
    });

    var areaOrder = (template.areaOrder || []).filter(function (areaName) {
      return Boolean(grouped[areaName]);
    });

    Object.keys(grouped).forEach(function (areaName) {
      if (areaOrder.indexOf(areaName) < 0) {
        areaOrder.push(areaName);
      }
    });

    return {
      templateId: template.templateId,
      versionNo: template.versionNo,
      state: template.state,
      effectiveDate: template.effectiveDate,
      facilityType: template.facilityType,
      includedModules: facility.enabledModules || [],
      areaOrder: areaOrder,
      questionIds: questions.map(function (question) {
        return question.questionId;
      }),
      questionsByArea: grouped,
      includedCategories: template.includedCategories || []
    };
  }

  function findDraftForFacility(facilityId) {
    var drafts = loadFromStorage(STORAGE_KEYS.drafts, {});
    return Object.values(drafts).find(function (draft) {
      return draft && draft.facilityId === facilityId && draft.status === "Draft";
    });
  }

  function createAssessmentForFacility(facility, template) {
    var now = new Date().toISOString();

    return {
      assessmentId: uid("ASM"),
      status: "Draft",
      createdAt: now,
      lastSavedAt: now,
      submittedAt: "",
      facilityId: facility.facilityId,
      facilityName: facility.name,
      facilityType: facility.type,
      zone: facility.zone,
      enabledModules: facility.enabledModules || [],
      templateId: template.templateId,
      templateVersion: template.versionNo,
      templateState: template.state,
      templateEffectiveDate: template.effectiveDate,
      responses: {},
      findings: [],
      actions: [],
      areaSummaryNote: "",
      summaryNote: ""
    };
  }

  function enqueueAutosave(reason) {
    if (state.autosaveTimer) {
      clearTimeout(state.autosaveTimer);
    }

    state.autosaveTimer = setTimeout(function () {
      persistDraft(reason || "Autosaved");
    }, 450);
  }

  function persistDraft(reason) {
    if (!state.activeAssessment) {
      return;
    }

    state.activeAssessment.lastSavedAt = new Date().toISOString();
    state.activeAssessment.status = "Draft";

    var drafts = loadFromStorage(STORAGE_KEYS.drafts, {});
    drafts[state.activeAssessment.assessmentId] = state.activeAssessment;
    saveToStorage(STORAGE_KEYS.drafts, drafts);

    syncAssessmentArtifactsToStorage();

    var autosaveNode = document.getElementById("autosaveStatus");
    if (autosaveNode) {
      autosaveNode.textContent = (reason || "Draft saved") + " at " + new Date().toLocaleTimeString();
    }

    addAuditLog("ASSESSMENT_DRAFT_SAVE", {
      assessmentId: state.activeAssessment.assessmentId,
      facilityId: state.activeAssessment.facilityId,
      reason: reason || "manual"
    });
  }

  function upsertByAssessment(existing, incomingItems) {
    var assessmentId = state.activeAssessment ? state.activeAssessment.assessmentId : "";
    var filtered = existing.filter(function (item) {
      return item.assessmentId !== assessmentId;
    });
    return filtered.concat(incomingItems);
  }

  function syncAssessmentArtifactsToStorage() {
    if (!state.activeAssessment) {
      return;
    }

    var findingsStore = loadFromStorage(STORAGE_KEYS.findings, []);
    var actionsStore = loadFromStorage(STORAGE_KEYS.actions, []);

    var nextFindings = upsertByAssessment(findingsStore, state.activeAssessment.findings);
    var nextActions = upsertByAssessment(actionsStore, state.activeAssessment.actions);

    saveToStorage(STORAGE_KEYS.findings, nextFindings);
    saveToStorage(STORAGE_KEYS.actions, nextActions);
  }

  function generateFindingFromResponse(question, responseData, assessmentContext) {
    if (!responseData) {
      return null;
    }

    var response = responseData.response;
    var isDeviation = response === "Partially Compliant" || response === "Non-Compliant";
    if (!isDeviation) {
      return null;
    }

    var defaultLikelihood = response === "Partially Compliant" ? question.likelihoodPartial : question.likelihoodNonCompliant;
    var severity = Number(responseData.severityOverride || question.defaultSeverity || 1);
    var likelihood = Number(responseData.likelihoodOverride || defaultLikelihood || 1);

    var riskScore = calculateRiskScore(severity, likelihood);
    var riskBand = getRiskBand(riskScore);

    var findingId = "FND-" + assessmentContext.assessmentId + "-" + question.questionId;

    return {
      findingId: findingId,
      assessmentId: assessmentContext.assessmentId,
      facilityId: assessmentContext.facilityId,
      questionId: question.questionId,
      area: question.area,
      category: question.category,
      questionText: question.text,
      response: response,
      hazardStatement: question.hazardStatement,
      consequenceStatement: question.consequenceStatement,
      severity: severity,
      likelihood: likelihood,
      riskScore: riskScore,
      riskBand: riskBand,
      criticalFlag: question.criticalFlag === true,
      immediateCorrection: responseData.immediateCorrection || "",
      correctiveActionRequired: question.recommendation || "",
      rootCauseTag: responseData.rootCauseTag || "",
      actionOwner: responseData.actionOwner || "",
      targetDueDate: responseData.targetDueDate || "",
      status: "Open",
      guidanceText: question.guidanceText || ""
    };
  }

  function getQuestionListForActiveAssessment() {
    if (!state.activeTemplate) return [];
    return state.activeTemplate.questionIds
      .map(function (qid) {
        return state.questionBankById[qid];
      })
      .filter(Boolean);
  }

  function syncActionsWithFindings(findings) {
    if (!state.activeAssessment) {
      return;
    }

    var existingActions = state.activeAssessment.actions || [];
    var activeFindingIds = findings.map(function (finding) {
      return finding.findingId;
    });

    existingActions = existingActions.filter(function (action) {
      return !action.findingId || activeFindingIds.indexOf(action.findingId) >= 0;
    });

    findings.forEach(function (finding) {
      var linkedActions = existingActions.filter(function (action) {
        return action.findingId === finding.findingId;
      });

      if (!linkedActions.length) {
        var priority = getPriorityFromRiskBand(finding.riskBand);
        existingActions.push({
          actionId: uid("ACT"),
          findingId: finding.findingId,
          assessmentId: state.activeAssessment.assessmentId,
          facilityId: state.activeAssessment.facilityId,
          questionId: finding.questionId,
          description: finding.correctiveActionRequired || "",
          owner: finding.actionOwner || "",
          dueDate: finding.targetDueDate || getSuggestedDueDate(priority),
          priority: priority,
          status: "Open",
          verifierComment: "",
          closureEvidence: "",
          statusHistory: [
            {
              status: "Open",
              changedAt: new Date().toISOString(),
              changedBy: state.user.username
            }
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    });

    var today = new Date();

    existingActions.forEach(function (action) {
      if (!action.findingId) {
        return;
      }

      var linkedFinding = findings.find(function (finding) {
        return finding.findingId === action.findingId;
      });

      if (!linkedFinding) {
        return;
      }

      action.priority = getPriorityFromRiskBand(linkedFinding.riskBand);

      if (!action.owner && linkedFinding.actionOwner) {
        action.owner = linkedFinding.actionOwner;
      }

      if (!action.dueDate && linkedFinding.targetDueDate) {
        action.dueDate = linkedFinding.targetDueDate;
      }

      var dueDate = toDate(action.dueDate);
      var isClosedState = action.status === "Closed" || action.status === "Cancelled";
      if (dueDate && dueDate < new Date(today.getFullYear(), today.getMonth(), today.getDate()) && !isClosedState) {
        if (action.status !== "Overdue") {
          action.status = "Overdue";
          action.statusHistory = action.statusHistory || [];
          action.statusHistory.push({
            status: "Overdue",
            changedAt: new Date().toISOString(),
            changedBy: "System"
          });
        }
      }
    });

    state.activeAssessment.actions = existingActions;
  }

  function syncAssessmentDerivedData() {
    if (!state.activeAssessment || !state.activeTemplate) {
      return;
    }

    var findings = [];

    state.activeTemplate.questionIds.forEach(function (questionId) {
      var question = state.questionBankById[questionId];
      if (!question) return;
      var responseRecord = getResponse(questionId);
      var finding = generateFindingFromResponse(question, responseRecord, state.activeAssessment);
      if (finding) {
        findings.push(finding);
      }
    });

    state.activeAssessment.findings = findings;
    syncActionsWithFindings(findings);
  }

  function getMandatoryIssues(areaScope) {
    if (!state.activeTemplate || !state.activeAssessment) {
      return [];
    }

    var issues = [];

    state.activeTemplate.questionIds.forEach(function (questionId) {
      var question = state.questionBankById[questionId];
      if (!question) return;
      if (areaScope && question.area !== areaScope) return;

      var responseRecord = getResponse(questionId);
      var response = responseRecord.response;

      if (!response) {
        issues.push({
          questionId: questionId,
          area: question.area,
          message: "Response is required."
        });
        return;
      }

      var isDeviation = response === "Partially Compliant" || response === "Non-Compliant";
      if (!isDeviation) {
        return;
      }

      if (!responseRecord.comment || !responseRecord.comment.trim()) {
        issues.push({
          questionId: questionId,
          area: question.area,
          message: "Comment is mandatory for deviations."
        });
      }

      if (question.evidenceRequired && (!responseRecord.evidenceNote || !responseRecord.evidenceNote.trim())) {
        issues.push({
          questionId: questionId,
          area: question.area,
          message: "Evidence note is mandatory for this deviation."
        });
      }

      if (question.criticalFlag) {
        if (!responseRecord.actionOwner || !responseRecord.actionOwner.trim()) {
          issues.push({
            questionId: questionId,
            area: question.area,
            message: "Action owner is mandatory for critical control failure."
          });
        }
        if (!responseRecord.targetDueDate) {
          issues.push({
            questionId: questionId,
            area: question.area,
            message: "Target due date is mandatory for critical control failure."
          });
        }
        if (!responseRecord.immediateContainment || !responseRecord.immediateContainment.trim()) {
          issues.push({
            questionId: questionId,
            area: question.area,
            message: "Immediate containment note is mandatory for critical control failure."
          });
        }
      }
    });

    return issues;
  }

  function renderContextHeader() {
    var titleNode = document.getElementById("currentAssessmentTitle");
    var metaNode = document.getElementById("currentAssessmentMeta");
    var badgeNode = document.getElementById("contextBadges");

    if (!titleNode || !metaNode || !badgeNode) {
      return;
    }

    if (!state.activeAssessment || !state.activeTemplate) {
      titleNode.textContent = "No active assessment selected";
      metaNode.textContent = "Launch an assessment from the Facility Register to begin.";
      badgeNode.innerHTML = "";
      return;
    }

    var facility = state.facilities.find(function (entry) {
      return entry.facilityId === state.activeAssessment.facilityId;
    });

    var dueState = facility ? calculateDueState(facility) : { label: "On Track", className: "due-on-track" };

    titleNode.textContent = state.activeAssessment.facilityName + " (" + state.activeAssessment.facilityId + ")";
    metaNode.textContent =
      state.activeAssessment.facilityType +
      " | " +
      state.activeAssessment.zone +
      " | Template " +
      state.activeAssessment.templateId +
      " v" +
      state.activeAssessment.templateVersion;

    var moduleBadges = (state.activeAssessment.enabledModules || [])
      .map(function (module) {
        return '<span class="badge badge-neutral">' + module + "</span>";
      })
      .join(" ");

    badgeNode.innerHTML =
      '<span class="badge ' +
      dueState.className +
      '">90-Day Cycle: ' +
      dueState.label +
      "</span>" +
      '<span class="badge badge-neutral">Role: ' +
      state.user.role +
      "</span>" +
      moduleBadges;
  }

  function renderFacilityTable() {
    var tableBody = document.querySelector("#facilityTable tbody");
    if (!tableBody) {
      return;
    }

    tableBody.innerHTML = "";

    if (!state.filteredFacilities.length) {
      tableBody.innerHTML = '<tr><td colspan="12">No facilities match current filters.</td></tr>';
      return;
    }

    state.filteredFacilities.forEach(function (facility) {
      var dueState = calculateDueState(facility);
      var draft = findDraftForFacility(facility.facilityId);
      var modules = (facility.enabledModules || [])
        .map(function (module) {
          return '<span class="badge badge-neutral">' + module + "</span>";
        })
        .join(" ");

      var row = document.createElement("tr");
      row.innerHTML =
        "<td>" +
        facility.facilityId +
        "</td>" +
        "<td>" +
        facility.name +
        "</td>" +
        "<td>" +
        facility.type +
        "</td>" +
        "<td>" +
        facility.zone +
        "</td>" +
        "<td>" +
        facility.status +
        "</td>" +
        "<td>" +
        modules +
        "</td>" +
        "<td>" +
        formatDate(facility.lastAssessmentDate) +
        "</td>" +
        "<td>" +
        formatDate(facility.nextDueDate) +
        "</td>" +
        "<td>" +
        facility.openCriticalCount +
        "</td>" +
        "<td>" +
        facility.currentRiskClass +
        "</td>" +
        '<td><span class="badge ' +
        dueState.className +
        '">' +
        dueState.label +
        "</span></td>" +
        '<td><button class="btn btn-primary launch-assessment" data-facility-id="' +
        facility.facilityId +
        '">' +
        (draft ? "Resume Draft" : "Launch Assessment") +
        "</button></td>";

      tableBody.appendChild(row);
    });
  }

  function updateFacilityFilters() {
    var typeValue = document.getElementById("filterType").value;
    var zoneValue = document.getElementById("filterZone").value;
    var statusValue = document.getElementById("filterStatus").value;
    var dueValue = document.getElementById("filterDueState").value;

    state.filteredFacilities = state.facilities.filter(function (facility) {
      if (typeValue !== "all" && facility.type !== typeValue) return false;
      if (zoneValue !== "all" && facility.zone !== zoneValue) return false;
      if (statusValue !== "all" && facility.status !== statusValue) return false;
      if (dueValue !== "all") {
        var dueState = calculateDueState(facility).state;
        if (dueState !== dueValue) {
          return false;
        }
      }
      return true;
    });

    renderFacilityTable();
  }

  function populateFilterOptions() {
    function setOptions(selectId, values, allLabel) {
      var select = document.getElementById(selectId);
      if (!select) return;
      select.innerHTML = '<option value="all">' + allLabel + "</option>";
      values.forEach(function (value) {
        var option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      });
    }

    var types = Array.from(
      new Set(
        state.facilities.map(function (facility) {
          return facility.type;
        })
      )
    );

    var zones = Array.from(
      new Set(
        state.facilities.map(function (facility) {
          return facility.zone;
        })
      )
    );

    var statuses = Array.from(
      new Set(
        state.facilities.map(function (facility) {
          return facility.status;
        })
      )
    );

    setOptions("filterType", types, "All Types");
    setOptions("filterZone", zones, "All Zones");
    setOptions("filterStatus", statuses, "All Status");
  }

  function renderAreaNav() {
    var areaNav = document.getElementById("areaNav");
    if (!areaNav) {
      return;
    }

    areaNav.innerHTML = "";

    if (!state.activeTemplate || !state.activeAssessment) {
      areaNav.innerHTML = '<li class="muted-text tiny">No active area list.</li>';
      return;
    }

    state.activeTemplate.areaOrder.forEach(function (areaName) {
      var questions = state.activeTemplate.questionsByArea[areaName] || [];
      var answered = questions.filter(function (question) {
        var response = getResponse(question.questionId);
        return Boolean(response.response);
      }).length;

      var areaIssues = getMandatoryIssues(areaName).length;
      var deviations = questions.filter(function (question) {
        var response = getResponse(question.questionId).response;
        return response === "Partially Compliant" || response === "Non-Compliant";
      }).length;

      var li = document.createElement("li");
      li.innerHTML =
        '<button class="area-nav-btn ' +
        (state.activeArea === areaName ? "active" : "") +
        '" data-area="' +
        areaName +
        '">' +
        "<strong>" +
        areaName +
        "</strong>" +
        '<span class="meta">Progress: ' +
        answered +
        "/" +
        questions.length +
        " | Deviations: " +
        deviations +
        " | Mandatory: " +
        areaIssues +
        "</span>" +
        "</button>";

      areaNav.appendChild(li);
    });

    var questionList = getQuestionListForActiveAssessment();
    var scoring = calculateComplianceScore(questionList, state.activeAssessment.responses);
    var overallPct = questionList.length ? (scoring.answeredQuestions / questionList.length) * 100 : 0;

    var progressText = document.getElementById("overallProgressText");
    var progressBar = document.getElementById("overallProgressBar");
    if (progressText) {
      progressText.textContent = overallPct.toFixed(0) + "%";
    }
    if (progressBar) {
      progressBar.style.width = overallPct.toFixed(1) + "%";
    }
  }

  function getFindingPreview(question, responseRecord) {
    if (!responseRecord || !responseRecord.response) {
      return "";
    }

    var isDeviation = responseRecord.response === "Partially Compliant" || responseRecord.response === "Non-Compliant";
    if (!isDeviation) {
      return "";
    }

    var severity = Number(responseRecord.severityOverride || question.defaultSeverity || 1);
    var likelihood = Number(
      responseRecord.likelihoodOverride ||
        (responseRecord.response === "Partially Compliant" ? question.likelihoodPartial : question.likelihoodNonCompliant) ||
        1
    );

    var score = calculateRiskScore(severity, likelihood);
    var band = getRiskBand(score);

    return (
      '<div class="finding-preview">' +
      "<strong>Generated Finding Preview</strong>" +
      "<span>Hazard: " +
      question.hazardStatement +
      "</span>" +
      "<span>Consequence: " +
      question.consequenceStatement +
      "</span>" +
      "<span>Risk: Severity " +
      severity +
      " × Likelihood " +
      likelihood +
      " = " +
      score +
      " (" +
      band +
      ")</span>" +
      "</div>"
    );
  }

  function renderMandatoryAlertForArea(areaName) {
    var node = document.getElementById("mandatoryAlert");
    if (!node || !state.activeTemplate) {
      return;
    }

    var issues = getMandatoryIssues(areaName);
    if (!issues.length) {
      node.classList.add("hidden");
      node.innerHTML = "";
      return;
    }

    node.classList.remove("hidden");
    node.innerHTML =
      '<strong>Unresolved mandatory items:</strong> ' +
      issues.length +
      " in this area. Complete required responses, comments, and evidence before submission.";
  }

  function renderQuestionList() {
    var container = document.getElementById("questionList");
    var areaTitle = document.getElementById("areaTitle");
    var areaMeta = document.getElementById("areaMeta");

    if (!container || !areaTitle || !areaMeta) {
      return;
    }

    container.innerHTML = "";

    if (!state.activeAssessment || !state.activeTemplate || !state.activeArea) {
      areaTitle.textContent = "Select an assessment to start";
      areaMeta.textContent = "Area-level progress and mandatory checks are shown here.";
      renderMandatoryAlertForArea();
      return;
    }

    var questions = state.activeTemplate.questionsByArea[state.activeArea] || [];
    var answered = questions.filter(function (question) {
      return Boolean(getResponse(question.questionId).response);
    }).length;

    areaTitle.textContent = state.activeArea;
    areaMeta.textContent =
      "Questions: " + questions.length + " | Answered: " + answered + " | Mandatory checks are enforced on deviations.";

    if (!questions.length) {
      container.innerHTML = '<p class="muted-text">No questions in this area for current facility configuration.</p>';
      renderMandatoryAlertForArea(state.activeArea);
      return;
    }

    var html = questions
      .map(function (question) {
        var responseRecord = getResponse(question.questionId);
        var response = responseRecord.response;
        var deviation = response === "Partially Compliant" || response === "Non-Compliant";
        var criticalFail = question.criticalFlag && deviation;

        var responseButtons = [
          { label: "Compliant", value: "Compliant", className: "compliant" },
          { label: "Partially Compliant", value: "Partially Compliant", className: "partial" },
          { label: "Non-Compliant", value: "Non-Compliant", className: "non" },
          { label: "Not Applicable", value: "Not Applicable", className: "na" }
        ]
          .map(function (option) {
            return (
              '<button type="button" class="response-btn ' +
              option.className +
              (response === option.value ? " active" : "") +
              '" data-question-id="' +
              question.questionId +
              '" data-response="' +
              option.value +
              '">' +
              option.label +
              "</button>"
            );
          })
          .join("");

        var criticalBlock =
          '<div class="critical-enforcement ' +
          (criticalFail ? "" : "hidden") +
          '" data-critical-shell="' +
          question.questionId +
          '">' +
          '<label>Action Owner *<input data-question-id="' +
          question.questionId +
          '" data-field="actionOwner" type="text" placeholder="Responsible owner" value="' +
          escapeHtml(responseRecord.actionOwner || "") +
          '" /></label>' +
          '<label>Target Due Date *<input data-question-id="' +
          question.questionId +
          '" data-field="targetDueDate" type="date" value="' +
          escapeHtml(responseRecord.targetDueDate || "") +
          '" /></label>' +
          '<label>Immediate Containment *<input data-question-id="' +
          question.questionId +
          '" data-field="immediateContainment" type="text" placeholder="Containment taken immediately" value="' +
          escapeHtml(responseRecord.immediateContainment || "") +
          '" /></label>' +
          "</div>";

        return (
          '<article class="question-card ' +
          (criticalFail ? "critical-fail" : "") +
          '">' +
          '<div class="question-head">' +
          '<div>' +
          '<p class="question-id">' +
          question.questionId +
          " | " +
          question.category +
          (question.subArea ? " | " + question.subArea : "") +
          "</p>" +
          '<p class="question-title">' +
          escapeHtml(question.text) +
          "</p>" +
          "</div>" +
          '<div class="badges">' +
          '<span class="badge badge-neutral">Weight ' +
          question.weight +
          "</span>" +
          (question.criticalFlag ? '<span class="badge badge-critical">Critical Control</span>' : "") +
          (question.evidenceRequired ? '<span class="badge badge-medium">Evidence Required</span>' : "") +
          "</div>" +
          "</div>" +
          '<div class="response-buttons">' +
          responseButtons +
          "</div>" +
          '<div class="question-meta">' +
          '<label>Comment' +
          (deviation ? " *" : "") +
          '<textarea data-question-id="' +
          question.questionId +
          '" data-field="comment" placeholder="Capture inspection observation and rationale">' +
          escapeHtml(responseRecord.comment || "") +
          "</textarea></label>" +
          '<label>Evidence Note ' +
          (question.evidenceRequired && deviation ? "*" : "") +
          '<input data-question-id="' +
          question.questionId +
          '" data-field="evidenceNote" type="text" placeholder="Photo/evidence reference placeholder" value="' +
          escapeHtml(responseRecord.evidenceNote || "") +
          '" /></label>' +
          '<label>Assessor Note<textarea data-question-id="' +
          question.questionId +
          '" data-field="assessorNote" placeholder="Optional assessor notes">' +
          escapeHtml(responseRecord.assessorNote || "") +
          "</textarea></label>" +
          '<label>Immediate Correction Taken On-Site<textarea data-question-id="' +
          question.questionId +
          '" data-field="immediateCorrection" placeholder="Describe immediate correction taken">' +
          escapeHtml(responseRecord.immediateCorrection || "") +
          "</textarea></label>" +
          "</div>" +
          getFindingPreview(question, responseRecord) +
          criticalBlock +
          (question.guidanceText ? '<p class="footer-note">Guidance: ' + escapeHtml(question.guidanceText) + "</p>" : "") +
          "</article>"
        );
      })
      .join("");

    container.innerHTML = html;
    renderMandatoryAlertForArea(state.activeArea);
  }

  function renderFindings() {
    var container = document.getElementById("findingsList");
    if (!container) {
      return;
    }

    if (!state.activeAssessment) {
      container.innerHTML = '<p class="muted-text">No active assessment selected.</p>';
      return;
    }

    var findings = state.activeAssessment.findings || [];

    if (!findings.length) {
      container.innerHTML =
        '<p class="muted-text">No findings generated yet. Findings are created automatically when responses are Partially Compliant or Non-Compliant.</p>';
      return;
    }

    container.innerHTML = findings
      .map(function (finding) {
        var question = state.questionBankById[finding.questionId];
        var response = getResponse(finding.questionId);
        var defaultLikelihood =
          response.response === "Partially Compliant" ? question.likelihoodPartial : question.likelihoodNonCompliant;

        return (
          '<article class="finding-card ' +
          (finding.criticalFlag ? "critical" : "") +
          '">' +
          '<div class="finding-head">' +
          '<div><h4>' +
          finding.findingId +
          "</h4><p class=\"muted-text tiny\">Question: " +
          finding.questionId +
          " | " +
          escapeHtml(finding.questionText) +
          "</p></div>" +
          '<div><span class="badge risk-' +
          finding.riskBand.toLowerCase() +
          '">' +
          finding.riskBand +
          " (" +
          finding.riskScore +
          ")</span>" +
          (finding.criticalFlag ? '<span class="badge badge-critical">Red Flag</span>' : "") +
          "</div>" +
          "</div>" +
          '<div class="finding-gridline">' +
          "<div><strong>Area</strong>" +
          escapeHtml(finding.area) +
          "</div>" +
          "<div><strong>Category</strong>" +
          escapeHtml(finding.category) +
          "</div>" +
          "<div><strong>Response</strong>" +
          finding.response +
          "</div>" +
          "</div>" +
          '<div class="finding-gridline">' +
          "<div><strong>Hazard Statement</strong>" +
          escapeHtml(finding.hazardStatement) +
          "</div>" +
          "<div><strong>Consequence Statement</strong>" +
          escapeHtml(finding.consequenceStatement) +
          "</div>" +
          "<div><strong>Immediate Correction</strong>" +
          escapeHtml(finding.immediateCorrection || "-") +
          "</div>" +
          "</div>" +
          '<div class="finding-gridline">' +
          '<label>Severity (Authorized Override Simulation)<select data-question-id="' +
          finding.questionId +
          '" data-override="severity">' +
          [1, 2, 3, 4, 5]
            .map(function (value) {
              return '<option value="' + value + '" ' + (Number(finding.severity) === value ? "selected" : "") + ">" + value + "</option>";
            })
            .join("") +
          "</select></label>" +
          '<label>Likelihood (Authorized Override Simulation)<select data-question-id="' +
          finding.questionId +
          '" data-override="likelihood">' +
          [1, 2, 3, 4, 5]
            .map(function (value) {
              return '<option value="' + value + '" ' + (Number(finding.likelihood) === value ? "selected" : "") + ">" + value + "</option>";
            })
            .join("") +
          "</select></label>" +
          '<label>Root Cause Tag Placeholder<select data-question-id="' +
          finding.questionId +
          '" data-field="rootCauseTag">' +
          '<option value="">Select Tag</option>' +
          ROOT_CAUSE_TAGS.map(function (tag) {
            return '<option value="' + tag + '" ' + (response.rootCauseTag === tag ? "selected" : "") + ">" + tag + "</option>";
          }).join("") +
          "</select></label>" +
          "</div>" +
          '<div class="finding-gridline">' +
          '<label>Action Owner ' +
          (finding.riskBand === "High" || finding.riskBand === "Critical" || finding.criticalFlag ? "*" : "") +
          '<input type="text" data-question-id="' +
          finding.questionId +
          '" data-field="actionOwner" value="' +
          escapeHtml(response.actionOwner || "") +
          '" placeholder="Assigned owner" /></label>' +
          '<label>Target Due Date ' +
          (finding.riskBand === "High" || finding.riskBand === "Critical" || finding.criticalFlag ? "*" : "") +
          '<input type="date" data-question-id="' +
          finding.questionId +
          '" data-field="targetDueDate" value="' +
          escapeHtml(response.targetDueDate || "") +
          '" /></label>' +
          '<label>Immediate Containment ' +
          (finding.criticalFlag ? "*" : "") +
          '<input type="text" data-question-id="' +
          finding.questionId +
          '" data-field="immediateContainment" value="' +
          escapeHtml(response.immediateContainment || "") +
          '" placeholder="Required for critical failures" /></label>' +
          "</div>" +
          '<p class="footer-note">Default likelihood guidance for this response: ' +
          defaultLikelihood +
          ". Recommendation: " +
          escapeHtml(finding.correctiveActionRequired || "N/A") +
          "</p>" +
          "</article>"
        );
      })
      .join("");
  }

  function updateActionSummary() {
    var node = document.getElementById("actionSummary");
    if (!node || !state.activeAssessment) {
      return;
    }

    var actions = state.activeAssessment.actions || [];
    var total = actions.length;
    var open = actions.filter(function (action) {
      return action.status !== "Closed" && action.status !== "Cancelled";
    }).length;
    var overdue = actions.filter(function (action) {
      return action.status === "Overdue";
    }).length;
    var closed = actions.filter(function (action) {
      return action.status === "Closed";
    }).length;

    node.innerHTML =
      "Total Actions: <strong>" +
      total +
      "</strong> | Open: <strong>" +
      open +
      "</strong> | Overdue: <strong>" +
      overdue +
      "</strong> | Closed: <strong>" +
      closed +
      "</strong>";
  }

  function renderActions() {
    var tbody = document.querySelector("#actionsTable tbody");
    if (!tbody) {
      return;
    }

    tbody.innerHTML = "";

    if (!state.activeAssessment) {
      tbody.innerHTML = '<tr><td colspan="10">No active assessment selected.</td></tr>';
      updateActionSummary();
      return;
    }

    var actions = state.activeAssessment.actions || [];

    if (!actions.length) {
      tbody.innerHTML = '<tr><td colspan="10">No actions available. Actions are generated from findings.</td></tr>';
      updateActionSummary();
      return;
    }

    tbody.innerHTML = actions
      .map(function (action) {
        var history = (action.statusHistory || [])
          .slice(-3)
          .map(function (entry) {
            return entry.status + " @ " + formatDate(entry.changedAt);
          })
          .join(" | ");

        var findingLabel = action.findingId ? action.findingId : "Standalone Action";

        return (
          "<tr>" +
          "<td>" +
          action.actionId +
          "</td>" +
          "<td>" +
          findingLabel +
          "</td>" +
          '<td><input type="text" data-action-id="' +
          action.actionId +
          '" data-action-field="description" value="' +
          escapeHtml(action.description || "") +
          '" placeholder="Action description" /></td>' +
          '<td><input type="text" data-action-id="' +
          action.actionId +
          '" data-action-field="owner" value="' +
          escapeHtml(action.owner || "") +
          '" placeholder="Owner" /></td>' +
          '<td><input type="date" data-action-id="' +
          action.actionId +
          '" data-action-field="dueDate" value="' +
          escapeHtml(action.dueDate || "") +
          '" /></td>' +
          '<td><select data-action-id="' +
          action.actionId +
          '" data-action-field="priority">' +
          ["Low", "Medium", "High", "Critical"]
            .map(function (priority) {
              return '<option value="' + priority + '" ' + (action.priority === priority ? "selected" : "") + ">" + priority + "</option>";
            })
            .join("") +
          "</select></td>" +
          '<td><select data-action-id="' +
          action.actionId +
          '" data-action-field="status">' +
          ACTION_STATUSES.map(function (status) {
            return '<option value="' + status + '" ' + (action.status === status ? "selected" : "") + ">" + status + "</option>";
          }).join("") +
          "</select></td>" +
          '<td><input type="text" data-action-id="' +
          action.actionId +
          '" data-action-field="verifierComment" value="' +
          escapeHtml(action.verifierComment || "") +
          '" placeholder="Verifier comment placeholder" /></td>' +
          '<td><input type="text" data-action-id="' +
          action.actionId +
          '" data-action-field="closureEvidence" value="' +
          escapeHtml(action.closureEvidence || "") +
          '" placeholder="Closure evidence placeholder" /></td>' +
          '<td class="audit-history">' +
          escapeHtml(history || "No history") +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    updateActionSummary();
  }

  function buildBarRows(items, valueFormatter) {
    if (!items.length) {
      return '<p class="muted-text tiny">No data yet.</p>';
    }

    var maxValue = Math.max.apply(
      null,
      items.map(function (item) {
        return item.value;
      })
    );

    return (
      '<div class="bar-list">' +
      items
        .map(function (item) {
          var width = maxValue ? (item.value / maxValue) * 100 : 0;
          return (
            '<div class="bar-row">' +
            '<div class="label"><span>' +
            escapeHtml(item.label) +
            "</span><strong>" +
            valueFormatter(item.value) +
            "</strong></div>" +
            '<div class="bar-track"><div class="bar-fill" style="width: ' +
            width.toFixed(1) +
            '%"></div></div>' +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function updateDashboardSummary() {
    var metricsNode = document.getElementById("summaryMetrics");
    var riskBarsNode = document.getElementById("riskDistributionBars");
    var areaBarsNode = document.getElementById("areaSummaryBars");
    var categoryBarsNode = document.getElementById("categorySummaryBars");
    var statusNode = document.getElementById("operationalStatusList");

    if (!metricsNode || !riskBarsNode || !areaBarsNode || !categoryBarsNode || !statusNode) {
      return;
    }

    if (!state.activeAssessment || !state.activeTemplate) {
      metricsNode.innerHTML = '<p class="muted-text">No active assessment loaded.</p>';
      riskBarsNode.innerHTML = "";
      areaBarsNode.innerHTML = "";
      categoryBarsNode.innerHTML = "";
      statusNode.innerHTML = '<li>Launch an assessment to view summary data.</li>';
      return;
    }

    var questionList = getQuestionListForActiveAssessment();
    var scoring = calculateComplianceScore(questionList, state.activeAssessment.responses);
    var findings = state.activeAssessment.findings || [];
    var actions = state.activeAssessment.actions || [];

    var riskDistribution = {
      Low: 0,
      Medium: 0,
      High: 0,
      Critical: 0
    };

    findings.forEach(function (finding) {
      riskDistribution[finding.riskBand] += 1;
    });

    var areaAgg = {};
    var categoryAgg = {};

    questionList.forEach(function (question) {
      var responseRecord = getResponse(question.questionId);
      var response = responseRecord.response || "";
      var weight = Number(question.weight) || 1;
      var area = question.area;
      var category = question.category;

      if (!areaAgg[area]) {
        areaAgg[area] = { achieved: 0, possible: 0 };
      }
      if (!categoryAgg[category]) {
        categoryAgg[category] = { achieved: 0, possible: 0 };
      }

      if (response !== "Not Applicable") {
        areaAgg[area].possible += weight;
        categoryAgg[category].possible += weight;

        var factor = RESPONSE_FACTORS[response];
        if (typeof factor === "number") {
          areaAgg[area].achieved += weight * factor;
          categoryAgg[category].achieved += weight * factor;
        }
      }
    });

    var areaRows = Object.keys(areaAgg)
      .map(function (area) {
        var row = areaAgg[area];
        var value = row.possible ? (row.achieved / row.possible) * 100 : 100;
        return { label: area, value: Number(value.toFixed(1)) };
      })
      .sort(function (a, b) {
        return b.value - a.value;
      });

    var categoryRows = Object.keys(categoryAgg)
      .map(function (category) {
        var row = categoryAgg[category];
        var value = row.possible ? (row.achieved / row.possible) * 100 : 100;
        return { label: category, value: Number(value.toFixed(1)) };
      })
      .sort(function (a, b) {
        return b.value - a.value;
      });

    var openActions = actions.filter(function (action) {
      return action.status !== "Closed" && action.status !== "Cancelled";
    }).length;

    var overdueActions = actions.filter(function (action) {
      return action.status === "Overdue";
    }).length;

    var criticalFindings = findings.filter(function (finding) {
      return finding.riskBand === "Critical" || finding.criticalFlag;
    }).length;

    var metrics = [
      { label: "Compliance %", value: scoring.compliancePercent.toFixed(1) + "%" },
      { label: "Total Questions", value: scoring.totalQuestions },
      { label: "Applicable Questions", value: scoring.applicableQuestions },
      { label: "Total Deviations", value: scoring.deviations },
      { label: "Critical Findings", value: criticalFindings },
      { label: "Open Actions", value: openActions },
      { label: "Overdue Actions", value: overdueActions },
      { label: "Last Saved", value: formatDate(state.activeAssessment.lastSavedAt) },
      { label: "Draft/Offline", value: "Draft Saved Locally" },
      { label: "Repeated Issues", value: "Phase 2 Placeholder" }
    ];

    metricsNode.innerHTML = metrics
      .map(function (metric) {
        return (
          '<article class="mini-metric"><p>' +
          metric.label +
          "</p><strong>" +
          metric.value +
          "</strong></article>"
        );
      })
      .join("");

    riskBarsNode.innerHTML = buildBarRows(
      [
        { label: "Low", value: riskDistribution.Low },
        { label: "Medium", value: riskDistribution.Medium },
        { label: "High", value: riskDistribution.High },
        { label: "Critical", value: riskDistribution.Critical }
      ],
      function (value) {
        return String(value);
      }
    );

    areaBarsNode.innerHTML = buildBarRows(areaRows, function (value) {
      return value.toFixed(1) + "%";
    });

    categoryBarsNode.innerHTML = buildBarRows(categoryRows, function (value) {
      return value.toFixed(1) + "%";
    });

    statusNode.innerHTML =
      "<li>Submitted Status: " +
      state.activeAssessment.status +
      "</li>" +
      "<li>Deviation-driven risk cards generated: " +
      findings.length +
      "</li>" +
      "<li>Assessment ID: " +
      state.activeAssessment.assessmentId +
      "</li>" +
      "<li>Compliance and risk scoring are calculated separately.</li>" +
      "<li>Historical comparability is preserved through stable question IDs.</li>";

    saveToStorage(STORAGE_KEYS.dashboard, {
      assessmentId: state.activeAssessment.assessmentId,
      compliancePercent: Number(scoring.compliancePercent.toFixed(2)),
      deviations: scoring.deviations,
      criticalFindings: criticalFindings,
      openActions: openActions,
      overdueActions: overdueActions,
      timestamp: new Date().toISOString()
    });
  }

  function renderLibrary() {
    var templateMeta = document.getElementById("templateMeta");
    var bankMeta = document.getElementById("questionBankMeta");
    var tbody = document.querySelector("#libraryTable tbody");

    if (!templateMeta || !bankMeta || !tbody) {
      return;
    }

    bankMeta.textContent =
      "Master bank contains " +
      state.questionBank.length +
      " stable question IDs with metadata for area, category, weighting, evidence rules, and risk defaults.";

    if (!state.activeTemplate || !state.activeAssessment) {
      templateMeta.innerHTML = "<p class=\"muted-text\">No active template selected. Launch an assessment to preview template mapping.</p>";
      tbody.innerHTML = state.questionBank
        .slice(0, 14)
        .map(function (question) {
          return (
            "<tr>" +
            "<td>" +
            question.questionId +
            "</td>" +
            "<td>" +
            question.area +
            "</td>" +
            "<td>" +
            question.category +
            "</td>" +
            "<td>" +
            (question.criticalFlag ? "Yes" : "No") +
            "</td>" +
            "<td>" +
            (question.evidenceRequired ? "Required on deviation" : "Optional") +
            "</td>" +
            "<td>" +
            escapeHtml(question.recommendation) +
            "</td>" +
            "</tr>"
          );
        })
        .join("");
      return;
    }

    templateMeta.innerHTML =
      "<p><strong>Template ID:</strong> " +
      state.activeTemplate.templateId +
      "</p>" +
      "<p><strong>Version:</strong> " +
      state.activeTemplate.versionNo +
      "</p>" +
      "<p><strong>State:</strong> " +
      state.activeTemplate.state +
      "</p>" +
      "<p><strong>Effective Date:</strong> " +
      formatDate(state.activeTemplate.effectiveDate) +
      "</p>" +
      "<p><strong>Facility Type:</strong> " +
      state.activeTemplate.facilityType +
      "</p>" +
      "<p><strong>Enabled Modules:</strong> " +
      (state.activeAssessment.enabledModules || []).join(", ") +
      "</p>";

    tbody.innerHTML = state.activeTemplate.questionIds
      .map(function (questionId) {
        var question = state.questionBankById[questionId];
        if (!question) return "";
        return (
          "<tr>" +
          "<td>" +
          question.questionId +
          "</td>" +
          "<td>" +
          question.area +
          "</td>" +
          "<td>" +
          question.category +
          "</td>" +
          "<td>" +
          (question.criticalFlag ? "Yes" : "No") +
          "</td>" +
          "<td>" +
          (question.evidenceRequired ? "Required on deviation" : "Optional") +
          "</td>" +
          "<td>" +
          escapeHtml(question.recommendation) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function setActiveTab(tabName) {
    var buttons = document.querySelectorAll(".tab-btn");
    var panels = document.querySelectorAll(".tab-panel");

    buttons.forEach(function (button) {
      button.classList.toggle("active", button.dataset.tab === tabName);
    });

    panels.forEach(function (panel) {
      panel.classList.toggle("active", panel.id === "tab-" + tabName);
    });
  }

  function launchAssessment(facilityId) {
    var facility = state.facilities.find(function (entry) {
      return entry.facilityId === facilityId;
    });

    if (!facility) {
      return;
    }

    var template = buildTemplateForFacility(facility);
    if (!template) {
      alert("Template mapping unavailable for selected facility type.");
      return;
    }

    var existingDraft = findDraftForFacility(facilityId);

    state.activeTemplate = template;
    state.activeAssessment = existingDraft || createAssessmentForFacility(facility, template);

    if (state.activeTemplate.areaOrder.length) {
      state.activeArea = state.activeTemplate.areaOrder[0];
    } else {
      state.activeArea = null;
    }

    syncAssessmentDerivedData();
    renderContextHeader();
    renderAreaNav();
    renderQuestionList();
    renderFindings();
    renderActions();
    updateDashboardSummary();
    renderLibrary();
    setActiveTab("execution");

    persistDraft(existingDraft ? "Draft resumed" : "Assessment launched");

    addAuditLog("ASSESSMENT_LAUNCH", {
      facilityId: facility.facilityId,
      assessmentId: state.activeAssessment.assessmentId,
      resumedDraft: Boolean(existingDraft)
    });
  }

  function exportAsJson(type) {
    if (!state.activeAssessment) {
      alert("Launch an assessment before export.");
      return;
    }

    var data;
    var fileLabel;

    if (type === "assessment") {
      data = state.activeAssessment;
      fileLabel = "assessment";
    } else if (type === "findings") {
      data = state.activeAssessment.findings || [];
      fileLabel = "findings";
    } else {
      data = state.activeAssessment.actions || [];
      fileLabel = "actions";
    }

    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      "goil-" + fileLabel + "-" + state.activeAssessment.facilityId + "-" + toIsoDate(new Date()) + ".json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    addAuditLog("EXPORT_JSON", {
      type: type,
      assessmentId: state.activeAssessment.assessmentId
    });
  }

  function printAssessment() {
    if (!state.activeAssessment) {
      alert("Launch an assessment before printing.");
      return;
    }

    setActiveTab("summary");
    window.print();

    addAuditLog("PRINT_ASSESSMENT", {
      assessmentId: state.activeAssessment.assessmentId
    });
  }

  function validateBeforeSubmit() {
    if (!state.activeAssessment || !state.activeTemplate) {
      return ["No active assessment loaded."];
    }

    var issues = getMandatoryIssues();

    var findings = state.activeAssessment.findings || [];
    var actions = state.activeAssessment.actions || [];

    findings.forEach(function (finding) {
      if (finding.riskBand === "High" || finding.riskBand === "Critical" || finding.criticalFlag) {
        var linkedActions = actions.filter(function (action) {
          return action.findingId === finding.findingId;
        });

        if (!linkedActions.length) {
          issues.push({
            questionId: finding.questionId,
            area: finding.area,
            message: "High/Critical finding requires at least one corrective action."
          });
        } else {
          linkedActions.forEach(function (action) {
            if (!action.owner || !action.owner.trim()) {
              issues.push({
                questionId: finding.questionId,
                area: finding.area,
                message: "High/Critical finding action owner is required before submission."
              });
            }
            if (!action.dueDate) {
              issues.push({
                questionId: finding.questionId,
                area: finding.area,
                message: "High/Critical finding due date is required before submission."
              });
            }
          });
        }
      }
    });

    return issues.map(function (issue) {
      return issue.questionId + " (" + issue.area + "): " + issue.message;
    });
  }

  function submitAssessment() {
    if (!state.activeAssessment) {
      alert("Launch an assessment first.");
      return;
    }

    syncAssessmentDerivedData();
    var validationIssues = validateBeforeSubmit();

    if (validationIssues.length) {
      alert("Submission blocked. Resolve mandatory issues:\n\n" + validationIssues.slice(0, 12).join("\n"));
      setActiveTab("execution");
      renderQuestionList();
      return;
    }

    var submissions = loadFromStorage(STORAGE_KEYS.submitted, []);

    state.activeAssessment.status = "Submitted";
    state.activeAssessment.submittedAt = new Date().toISOString();
    state.activeAssessment.lastSavedAt = new Date().toISOString();

    submissions = submissions.filter(function (assessment) {
      return assessment.assessmentId !== state.activeAssessment.assessmentId;
    });

    submissions.push(state.activeAssessment);
    saveToStorage(STORAGE_KEYS.submitted, submissions);

    var drafts = loadFromStorage(STORAGE_KEYS.drafts, {});
    delete drafts[state.activeAssessment.assessmentId];
    saveToStorage(STORAGE_KEYS.drafts, drafts);

    syncAssessmentArtifactsToStorage();
    updateDashboardSummary();

    addAuditLog("ASSESSMENT_SUBMITTED", {
      assessmentId: state.activeAssessment.assessmentId,
      facilityId: state.activeAssessment.facilityId,
      findings: (state.activeAssessment.findings || []).length,
      actions: (state.activeAssessment.actions || []).length
    });

    var autosaveNode = document.getElementById("autosaveStatus");
    if (autosaveNode) {
      autosaveNode.textContent = "Submitted on " + new Date().toLocaleString();
    }

    alert("Assessment submitted successfully.");
    renderFacilityTable();
    renderContextHeader();
  }

  function addStandaloneAction() {
    if (!state.activeAssessment) {
      alert("Launch an assessment first.");
      return;
    }

    var action = {
      actionId: uid("ACT"),
      findingId: "",
      assessmentId: state.activeAssessment.assessmentId,
      facilityId: state.activeAssessment.facilityId,
      questionId: "",
      description: "",
      owner: "",
      dueDate: getSuggestedDueDate("Medium"),
      priority: "Medium",
      status: "Open",
      verifierComment: "",
      closureEvidence: "",
      statusHistory: [
        {
          status: "Open",
          changedAt: new Date().toISOString(),
          changedBy: state.user.username
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    state.activeAssessment.actions.push(action);
    renderActions();
    updateDashboardSummary();
    enqueueAutosave("Standalone action added");

    addAuditLog("ACTION_CREATE", {
      assessmentId: state.activeAssessment.assessmentId,
      actionId: action.actionId,
      standalone: true
    });
  }

  function updateResponseField(questionId, field, value) {
    var response = getResponse(questionId);
    if (!response) return;

    response[field] = value;

    if (field === "targetDueDate" && !value) {
      response.targetDueDate = "";
    }

    syncAssessmentDerivedData();
    renderFindings();
    renderActions();
    updateDashboardSummary();
    renderAreaNav();
    renderMandatoryAlertForArea(state.activeArea);
    enqueueAutosave("Response updated");
  }

  function updateActionField(actionId, field, value) {
    if (!state.activeAssessment) return;

    var action = (state.activeAssessment.actions || []).find(function (entry) {
      return entry.actionId === actionId;
    });

    if (!action) return;

    var previousStatus = action.status;

    action[field] = value;
    action.updatedAt = new Date().toISOString();

    if (field === "status" && value !== previousStatus) {
      action.statusHistory = action.statusHistory || [];
      action.statusHistory.push({
        status: value,
        changedAt: new Date().toISOString(),
        changedBy: state.user.username
      });
    }

    if (action.questionId) {
      var response = getResponse(action.questionId);
      if (response) {
        if (field === "owner") {
          response.actionOwner = value;
        }
        if (field === "dueDate") {
          response.targetDueDate = value;
        }
      }
    }

    syncAssessmentDerivedData();
    renderFindings();
    renderActions();
    updateDashboardSummary();
    enqueueAutosave("Action updated");

    addAuditLog("ACTION_UPDATE", {
      actionId: action.actionId,
      field: field,
      assessmentId: state.activeAssessment.assessmentId
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function bindEvents() {
    var userNode = document.getElementById("riskUser");
    if (userNode) {
      userNode.textContent = state.user.username;
    }

    var logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        localStorage.removeItem(STORAGE_KEYS.auth);
        localStorage.removeItem(STORAGE_KEYS.user);
        window.location.href = "../index.html";
      });
    }

    var tabNav = document.getElementById("riskTabs");
    if (tabNav) {
      tabNav.addEventListener("click", function (event) {
        var button = event.target.closest(".tab-btn");
        if (!button) return;
        setActiveTab(button.dataset.tab);
      });
    }

    var table = document.getElementById("facilityTable");
    if (table) {
      table.addEventListener("click", function (event) {
        var button = event.target.closest(".launch-assessment");
        if (!button) return;
        launchAssessment(button.dataset.facilityId);
      });
    }

    ["filterType", "filterZone", "filterStatus", "filterDueState"].forEach(function (filterId) {
      var filter = document.getElementById(filterId);
      if (filter) {
        filter.addEventListener("change", updateFacilityFilters);
      }
    });

    var areaNav = document.getElementById("areaNav");
    if (areaNav) {
      areaNav.addEventListener("click", function (event) {
        var button = event.target.closest(".area-nav-btn");
        if (!button) return;
        state.activeArea = button.dataset.area;
        renderAreaNav();
        renderQuestionList();
      });
    }

    var questionList = document.getElementById("questionList");
    if (questionList) {
      questionList.addEventListener("click", function (event) {
        var responseButton = event.target.closest(".response-btn");
        if (!responseButton) return;

        var questionId = responseButton.dataset.questionId;
        var response = responseButton.dataset.response;
        var responseRecord = getResponse(questionId);

        responseRecord.response = response;

        if ((response === "Partially Compliant" || response === "Non-Compliant") && !responseRecord.targetDueDate) {
          var question = state.questionBankById[questionId];
          if (question && question.criticalFlag) {
            responseRecord.targetDueDate = getSuggestedDueDate("Critical");
          }
        }

        syncAssessmentDerivedData();
        renderQuestionList();
        renderAreaNav();
        renderFindings();
        renderActions();
        updateDashboardSummary();
        enqueueAutosave("Response option updated");
      });

      questionList.addEventListener("input", function (event) {
        var input = event.target;
        var questionId = input.dataset.questionId;
        var field = input.dataset.field;
        if (!questionId || !field) return;
        updateResponseField(questionId, field, input.value);
      });

      questionList.addEventListener("change", function (event) {
        var input = event.target;
        var questionId = input.dataset.questionId;
        var field = input.dataset.field;
        if (!questionId || !field) return;
        updateResponseField(questionId, field, input.value);
      });
    }

    var findingsList = document.getElementById("findingsList");
    if (findingsList) {
      findingsList.addEventListener("change", function (event) {
        var input = event.target;
        var questionId = input.dataset.questionId;
        if (!questionId) return;

        if (input.dataset.override === "severity") {
          var question = state.questionBankById[questionId];
          var responseRecord = getResponse(questionId);
          var selected = Number(input.value);
          responseRecord.severityOverride = selected === Number(question.defaultSeverity) ? "" : selected;
          updateResponseField(questionId, "severityOverride", responseRecord.severityOverride);
          return;
        }

        if (input.dataset.override === "likelihood") {
          var questionObj = state.questionBankById[questionId];
          var responseObj = getResponse(questionId);
          var selectedLikelihood = Number(input.value);
          var defaultLikelihood =
            responseObj.response === "Partially Compliant" ? questionObj.likelihoodPartial : questionObj.likelihoodNonCompliant;
          responseObj.likelihoodOverride = selectedLikelihood === Number(defaultLikelihood) ? "" : selectedLikelihood;
          updateResponseField(questionId, "likelihoodOverride", responseObj.likelihoodOverride);
          return;
        }

        var field = input.dataset.field;
        if (field) {
          updateResponseField(questionId, field, input.value);
        }
      });

      findingsList.addEventListener("input", function (event) {
        var input = event.target;
        var questionId = input.dataset.questionId;
        var field = input.dataset.field;
        if (!questionId || !field) return;
        updateResponseField(questionId, field, input.value);
      });
    }

    var actionsTable = document.getElementById("actionsTable");
    if (actionsTable) {
      actionsTable.addEventListener("input", function (event) {
        var input = event.target;
        var actionId = input.dataset.actionId;
        var field = input.dataset.actionField;
        if (!actionId || !field) return;
        updateActionField(actionId, field, input.value);
      });

      actionsTable.addEventListener("change", function (event) {
        var input = event.target;
        var actionId = input.dataset.actionId;
        var field = input.dataset.actionField;
        if (!actionId || !field) return;
        updateActionField(actionId, field, input.value);
      });
    }

    var saveDraftBtn = document.getElementById("saveDraftBtn");
    if (saveDraftBtn) {
      saveDraftBtn.addEventListener("click", function () {
        syncAssessmentDerivedData();
        persistDraft("Manual save");
      });
    }

    var submitBtn = document.getElementById("submitAssessmentBtn");
    if (submitBtn) {
      submitBtn.addEventListener("click", submitAssessment);
    }

    var addActionBtn = document.getElementById("addStandaloneActionBtn");
    if (addActionBtn) {
      addActionBtn.addEventListener("click", addStandaloneAction);
    }

    var printBtn = document.getElementById("printAssessmentBtn");
    if (printBtn) {
      printBtn.addEventListener("click", printAssessment);
    }

    document.querySelectorAll("[data-export]").forEach(function (button) {
      button.addEventListener("click", function () {
        exportAsJson(button.dataset.export);
      });
    });
  }

  function initializeData() {
    return Promise.all([
      loadJsonData("../assets/data/facilities.json"),
      loadJsonData("../assets/data/question-bank.json"),
      loadJsonData("../assets/data/template-fuel-station.json"),
      loadJsonData("../assets/data/template-lpg-plant.json"),
      loadJsonData("../assets/data/template-office.json"),
      loadJsonData("../assets/data/template-office-depot.json")
    ]).then(function (payload) {
      state.facilities = payload[0];
      state.filteredFacilities = payload[0].slice();
      state.questionBank = payload[1];

      state.questionBankById = {};
      state.questionBank.forEach(function (question) {
        state.questionBankById[question.questionId] = question;
      });

      state.templates = {
        fuelStation: payload[2],
        lpgPlant: payload[3],
        office: payload[4],
        officeDepot: payload[5]
      };

      populateFilterOptions();
      renderFacilityTable();
      renderLibrary();
    });
  }

  function init() {
    state.user = loadFromStorage(STORAGE_KEYS.user, state.user);

    bindEvents();

    initializeData().catch(function (error) {
      console.error(error);
      alert("Failed to load assessment data files. Check local JSON paths.");
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();

(function () {
  'use strict';

  var DRAFT_KEY = 'goil_hsseq_incident_wizard_draft_v1';
  var REPORTS_KEY = 'goil_hsseq_incident_reports_v1';
  var VALID_TYPES = ['accident', 'near_miss', 'dangerous_occurrence', 'hazard'];

  var TYPE_LABELS = {
    accident: 'Accident',
    near_miss: 'Near Miss',
    dangerous_occurrence: 'Dangerous Occurrence',
    hazard: 'Hazard / Unsafe Condition'
  };

  var TYPE_KICKERS = {
    accident: 'Accident workflow',
    near_miss: 'Near-miss workflow',
    dangerous_occurrence: 'Dangerous occurrence workflow',
    hazard: 'Hazard workflow'
  };

  var TYPE_SUBTITLES = {
    accident: 'Capture the accident details, classification, impacts, actions, and evidence without leaving this page.',
    near_miss: 'Capture the near-miss details, immediate actions, causes, and follow-up actions in one guided workflow.',
    dangerous_occurrence: 'Capture the dangerous occurrence, persons at risk, actions taken, and investigation details step by step.',
    hazard: 'Capture the hazard details, assess the risk, document immediate actions, and raise corrective actions from the same page.'
  };

  var STEP_SETS = {
    accident: ['When', 'Where', 'Description', 'Classification', 'Impacts', 'Root Causes', 'Corrective Actions', 'Attachments', 'Review'],
    accident_damage: ['When', 'Where', 'Description', 'Classification', 'Impacts', 'Root Causes', 'Corrective Actions', 'Damaged Items', 'Attachments', 'Review'],
    near_miss: ['When', 'Where', 'Details', 'Immediate Actions', 'Root Causes', 'Corrective Actions', 'Attachments', 'Review'],
    dangerous_occurrence: ['When', 'Where', 'Description', 'Persons at Risk', 'Immediate Actions', 'Root Causes', 'Corrective Actions', 'Attachments', 'Review'],
    hazard: ['When', 'Where', 'Description', 'Risk Assessment', 'Immediate Actions', 'Root Causes', 'Corrective Actions', 'Attachments', 'Review']
  };

  var STEP_COPY = {
    When: {
      title: 'When did it happen?',
      subtitle: 'Provide the date and time of the incident or hazard.'
    },
    Where: {
      title: 'Where did it happen?',
      subtitle: 'Capture the location details for the report.'
    },
    Description: {
      title: 'Description & Details',
      subtitle: 'Describe exactly what happened and add the type-specific details needed for the report.'
    },
    Details: {
      title: 'Near-miss details',
      subtitle: 'Describe the near miss and the possible consequence if conditions had changed.'
    },
    Classification: {
      title: 'Classification',
      subtitle: 'Add one or more classifications so the event can be analyzed correctly later.'
    },
    Impacts: {
      title: 'Impacts',
      subtitle: 'Record who or what was affected, along with the scale of the impact.'
    },
    'Persons at Risk': {
      title: 'Persons at Risk',
      subtitle: 'Identify who could have been affected by the dangerous occurrence.'
    },
    'Immediate Actions': {
      title: 'Immediate Actions',
      subtitle: 'List the actions taken immediately after the incident or hazard was identified.'
    },
    'Root Causes': {
      title: 'Root Causes',
      subtitle: 'Document the underlying causes that led to the incident, hazard, or near miss.'
    },
    'Corrective Actions': {
      title: 'Corrective Actions',
      subtitle: 'Add the corrective actions, responsible persons, and due dates needed to prevent recurrence.'
    },
    'Damaged Items': {
      title: 'Damaged Items',
      subtitle: 'List any equipment, materials, or property that was damaged or lost.'
    },
    'Risk Assessment': {
      title: 'Risk Assessment',
      subtitle: 'Assess severity and likelihood to calculate the hazard risk score.'
    },
    Attachments: {
      title: 'Attachments',
      subtitle: 'Add supporting files or notes that should travel with the report.'
    },
    Review: {
      title: 'Review & Submit',
      subtitle: 'Review the captured data, confirm it is correct, and submit the report.'
    }
  };

  var REGIONS = [
    'Greater Accra', 'Ashanti', 'Western', 'Eastern', 'Central', 'Northern', 'Upper East',
    'Upper West', 'Volta', 'Bono', 'Bono East', 'Ahafo', 'Oti', 'Savannah', 'North East', 'Western North'
  ];

  var FACILITY_TYPES = [
    'Depot', 'Terminal', 'Service Station', 'LPG Plant', 'Head Office', 'Warehouse', 'Workshop', 'Pipeline', 'Other'
  ];

  var STATUSES = ['Open', 'Under Investigation', 'Closed'];
  var HAZARD_CATEGORIES = ['Safety', 'Health', 'Environmental', 'Security', 'Other'];
  var LIKELIHOOD_RECURRENCE = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost Certain'];
  var CLASSIFICATION_CATEGORIES = ['Safety', 'Health', 'Environmental', 'Security'];
  var TYPES_BY_CATEGORY = {
    Safety: ['Struck by Object', 'Struck Against', 'Caught In/Between', 'Fall from Elevation', 'Fall on Same Level', 'Overexertion', 'Electrical Contact', 'Burn/Scald', 'Ergonomic', 'Vehicle Collision', 'Fire/Explosion', 'Other'],
    Health: ['Chemical Exposure', 'Biological Hazard', 'Noise-Induced Hearing Loss', 'Heat Stress', 'Respiratory Illness', 'Skin Condition', 'Ergonomic Disorder', 'Other'],
    Environmental: ['Soil Contamination', 'Water Contamination', 'Air Pollution', 'Waste Management Failure', 'Spillage', 'Other'],
    Security: ['Unauthorized Access', 'Theft', 'Vandalism', 'Civil Disturbance', 'Other']
  };
  var IMPACT_TYPES = ['Injury', 'Property Damage', 'Environmental Impact', 'Product Loss', 'Business Interruption', 'Other'];
  var PERSON_CATEGORIES = ['Employee', 'Contractor', 'Visitor', 'Public', 'Other'];
  var ACTION_STATUSES = ['Open', 'In Progress', 'Closed'];

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createEmptyClassification() {
    return { category: '', type: '', otherDescription: '' };
  }

  function createEmptyImpact() {
    return { impactType: '', personCategory: '', numberOfPersons: 1 };
  }

  function createEmptyPersonAtRisk() {
    return { personCategory: '', numberOfPersons: 1, notes: '' };
  }

  function createEmptyTextRow() {
    return { text: '' };
  }

  function createEmptyCorrectiveAction() {
    return { description: '', responsiblePerson: '', dueDate: '', status: 'Open' };
  }

  function createEmptyDamagedItem() {
    return { itemName: '', description: '', estimatedCost: '' };
  }

  function getDefaultWizardData(type) {
    return {
      __type: type || 'accident',
      incidentDate: '',
      incidentTime: '',
      region: '',
      facilityType: '',
      locationName: '',
      facilityName: '',
      status: 'Open',
      description: '',
      isVehicularAccident: false,
      vehicleType: '',
      carNumber: '',
      driverName: '',
      hasEnvironmentalImpact: false,
      productReleased: '',
      quantityReleased: '',
      hasPropertyDamage: false,
      potentialConsequence: '',
      likelihoodRecurrence: '',
      hazardCategory: '',
      hazardCategoryOther: '',
      riskSeverity: '',
      riskLikelihood: '',
      riskScore: 0,
      riskLevel: '',
      exposedPersons: '',
      existingControls: '',
      classifications: [],
      impacts: [],
      personsAtRisk: [],
      rootCauses: [],
      immediateActions: [],
      correctiveActions: [],
      damagedItems: [],
      attachments: [],
      attachmentNotes: '',
      __lastSaved: ''
    };
  }

  function normalizeWizardData(data, type) {
    var normalized = Object.assign(getDefaultWizardData(type || (data && data.__type) || 'accident'), data || {});
    normalized.__type = type || normalized.__type || 'accident';
    normalized.classifications = Array.isArray(normalized.classifications) ? normalized.classifications : [];
    normalized.impacts = Array.isArray(normalized.impacts) ? normalized.impacts : [];
    normalized.personsAtRisk = Array.isArray(normalized.personsAtRisk) ? normalized.personsAtRisk : [];
    normalized.rootCauses = Array.isArray(normalized.rootCauses) ? normalized.rootCauses : [];
    normalized.immediateActions = Array.isArray(normalized.immediateActions) ? normalized.immediateActions : [];
    normalized.correctiveActions = Array.isArray(normalized.correctiveActions) ? normalized.correctiveActions : [];
    normalized.damagedItems = Array.isArray(normalized.damagedItems) ? normalized.damagedItems : [];
    normalized.attachments = Array.isArray(normalized.attachments) ? normalized.attachments : [];
    return normalized;
  }

  function getRiskMeta(score) {
    if (!score || score <= 0) {
      return { level: '', badgeClass: '' };
    }
    if (score <= 4) return { level: 'Low', badgeClass: 'risk-low' };
    if (score <= 9) return { level: 'Medium', badgeClass: 'risk-medium' };
    if (score <= 16) return { level: 'High', badgeClass: 'risk-high' };
    return { level: 'Critical', badgeClass: 'risk-critical' };
  }

  function formatDateForDisplay(value) {
    if (!value) return 'Not set';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatDateTimeForDisplay(value) {
    if (!value) return 'Not set';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function currentClockText() {
    var now = new Date();
    var time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    var date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    return time + ' • ' + date;
  }

  function loadDraft() {
    try {
      var raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      return normalizeWizardData(JSON.parse(raw));
    } catch (error) {
      return null;
    }
  }

  function saveDraft(data) {
    try {
      data.__lastSaved = new Date().toISOString();
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    } catch (error) {
      // ignore storage errors
    }
  }

  function clearDraft() {
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch (error) {
      // ignore storage errors
    }
  }

  function loadReports() {
    try {
      return JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]');
    } catch (error) {
      return [];
    }
  }

  function saveReports(records) {
    try {
      localStorage.setItem(REPORTS_KEY, JSON.stringify(records));
    } catch (error) {
      // ignore storage errors
    }
  }

  var wizardData = normalizeWizardData(loadDraft(), 'accident');

  var profile = JSON.parse(localStorage.getItem('goilUserProfile') || '{}');
  var fullName = profile.full_name || profile.email || 'GOIL User';
  var initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(function (part) {
    return part.charAt(0).toUpperCase();
  }).join('') || 'GU';

  var topName = document.getElementById('topUserName');
  var topAvatar = document.getElementById('topUserAvatar');
  var clockNode = document.getElementById('clockNow');
  var homeView = document.getElementById('homeView');
  var reportView = document.getElementById('reportView');
  var listView = document.getElementById('listView');
  var formView = document.getElementById('formView');
  var selectedTypeLabel = document.getElementById('selectedTypeLabel');
  var reportModeHint = document.getElementById('reportModeHint');
  var backToHomeBtn = document.getElementById('backToHomeBtn');
  var startReportBtn = document.getElementById('startReportBtn');
  var reportNavHome = document.querySelector('[data-nav-view="home"]');
  var reportNavReport = document.querySelector('[data-nav-view="report"]');
  var reportNavList = document.querySelector('[data-nav-view="list"]');
  var targetNavItems = Array.prototype.slice.call(document.querySelectorAll('[data-nav-target]'));
  var wizardCards = Array.prototype.slice.call(document.querySelectorAll('.wizard-report-card'));
  var homeReportLinks = Array.prototype.slice.call(document.querySelectorAll('.home-report-link'));
  var homeCta = document.querySelector('.cta');
  var formKicker = document.getElementById('formKicker');
  var formTitle = document.getElementById('formTitle');
  var formSubtitle = document.getElementById('formSubtitle');
  var changeTypeBtn = document.getElementById('changeTypeBtn');
  var saveDraftBtn = document.getElementById('saveDraftBtn');
  var formStepTitle = document.getElementById('formStepTitle');
  var formStepCopy = document.getElementById('formStepCopy');
  var formStepCounter = document.getElementById('formStepCounter');
  var formStepper = document.getElementById('formStepper');
  var formPanelTitle = document.getElementById('formPanelTitle');
  var formPanelSubtitle = document.getElementById('formPanelSubtitle');
  var formErrorAlert = document.getElementById('formErrorAlert');
  var formFields = document.getElementById('formFields');
  var formBackBtn = document.getElementById('formBackBtn');
  var formNextBtn = document.getElementById('formNextBtn');
  var formDraftStatus = document.getElementById('formDraftStatus');
  var listSearchInput = document.getElementById('listSearchInput');
  var listSearchBtn = document.getElementById('listSearchBtn');
  var listSummaryText = document.getElementById('listSummaryText');
  var listSummaryMeta = document.getElementById('listSummaryMeta');
  var incidentListBody = document.getElementById('incidentListBody');
  var listYear = document.getElementById('listYear');
  var listFilterBtn = document.getElementById('listFilterBtn');
  var listSearchQuery = '';

  function setProfileCopy() {
  if (topName) topName.textContent = fullName;
  if (topAvatar) topAvatar.textContent = initials;
  }

  function tickClock() {
    if (clockNode) clockNode.textContent = currentClockText();
  }

  function validType(type) {
    return VALID_TYPES.indexOf(type) !== -1;
  }

  function getSteps(type) {
    if (type === 'accident') {
      return wizardData.hasPropertyDamage ? STEP_SETS.accident_damage.slice() : STEP_SETS.accident.slice();
    }
    if (type === 'near_miss') return STEP_SETS.near_miss.slice();
    if (type === 'dangerous_occurrence') return STEP_SETS.dangerous_occurrence.slice();
    return STEP_SETS.hazard.slice();
  }

  function getState() {
    var params = new URLSearchParams(window.location.search);
    var view = params.get('view');
    if (['home', 'report', 'list', 'form'].indexOf(view) === -1) view = 'home';
    var type = params.get('type');
    if (!validType(type)) type = 'accident';
    var stepValue = parseInt(params.get('step') || '0', 10);
    return {
      view: view,
      type: type,
      step: Number.isFinite(stepValue) && stepValue >= 0 ? stepValue : 0,
      hash: window.location.hash ? window.location.hash.slice(1) : ''
    };
  }

  function updateUrl(view, type, step, hash, replace) {
    var params = new URLSearchParams(window.location.search);
    params.set('view', view);
    if (type) params.set('type', type);
    else params.delete('type');
    if (view === 'form') params.set('step', String(step || 0));
    else params.delete('step');
    var next = window.location.pathname + '?' + params.toString() + (hash ? '#' + hash : '');
    if (replace) window.history.replaceState({}, '', next);
    else window.history.pushState({}, '', next);
  }

  function scrollToHashTarget(hash) {
    if (!hash) return;
    var target = document.getElementById(hash);
    if (target) {
      window.requestAnimationFrame(function () {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  function updateActiveNav(view) {
    var effectiveView = view === 'form' ? 'report' : view;
    if (reportNavHome) reportNavHome.classList.toggle('active', effectiveView === 'home');
    if (reportNavReport) reportNavReport.classList.toggle('active', effectiveView === 'report');
    if (reportNavList) reportNavList.classList.toggle('active', effectiveView === 'list');
  }

  function applySelection(type) {
    wizardCards.forEach(function (card) {
      card.classList.toggle('selected', card.getAttribute('data-report-type') === type);
    });
    if (selectedTypeLabel) selectedTypeLabel.textContent = TYPE_LABELS[type] || 'Accident';
  }

  function openHomeView(hash, replace) {
    updateUrl('home', '', 0, hash || '', !!replace);
    renderState();
  }

  function openReportView(type, replace) {
    updateUrl('report', type || getState().type, 0, '', !!replace);
    renderState();
  }

  function openListView(replace) {
    updateUrl('list', '', 0, '', !!replace);
    renderState();
  }

  function ensureWizardType(type) {
    if (!wizardData || wizardData.__type !== type) {
      var draft = loadDraft();
      if (draft && draft.__type === type) wizardData = normalizeWizardData(draft, type);
      else wizardData = getDefaultWizardData(type);
    }
    wizardData = normalizeWizardData(wizardData, type);
  }

  function openFormView(type, step, replace) {
    ensureWizardType(type);
    updateUrl('form', type, typeof step === 'number' ? step : 0, '', !!replace);
    renderState();
  }

  function riskBadge(level) {
    var score = level || '';
    if (score === 'Low') return 'risk-low';
    if (score === 'Medium') return 'risk-medium';
    if (score === 'High') return 'risk-high';
    if (score === 'Critical') return 'risk-critical';
    return '';
  }

  function renderOptions(options, selected) {
    return options.map(function (option) {
      var value = typeof option === 'string' ? option : option.value;
      var label = typeof option === 'string' ? option : option.label;
      return '<option value="' + escapeHtml(value) + '"' + (String(selected) === String(value) ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
    }).join('');
  }

  function renderFieldGroup(label, control, required, help, fullWidth) {
    return (
      '<div class="field-group' + (fullWidth ? ' full' : '') + '">' +
        '<label class="field-label">' + escapeHtml(label) + (required ? '<span class="field-required">*</span>' : '') + '</label>' +
        control +
        (help ? '<div class="field-help">' + escapeHtml(help) + '</div>' : '') +
      '</div>'
    );
  }

  function renderInput(field, type, placeholder, value, attrs) {
    return '<input class="field-input" data-field="' + escapeHtml(field) + '" type="' + escapeHtml(type) + '" value="' + escapeHtml(value || '') + '" placeholder="' + escapeHtml(placeholder || '') + '"' + (attrs || '') + '>';
  }

  function renderSelect(field, value, options, placeholder) {
    return '<select class="field-select" data-field="' + escapeHtml(field) + '">' +
      '<option value="">' + escapeHtml(placeholder || 'Select...') + '</option>' +
      renderOptions(options, value) +
    '</select>';
  }

  function renderTextarea(field, placeholder, value, rows) {
    return '<textarea class="field-textarea" data-field="' + escapeHtml(field) + '" rows="' + String(rows || 4) + '" placeholder="' + escapeHtml(placeholder || '') + '">' + escapeHtml(value || '') + '</textarea>';
  }

  function renderCheckbox(field, title, copy, checked) {
    return '<label class="checkbox-row">' +
      '<input type="checkbox" data-field="' + escapeHtml(field) + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="checkbox-copy"><strong>' + escapeHtml(title) + '</strong>' + (copy ? '<span>' + escapeHtml(copy) + '</span>' : '') + '</span>' +
    '</label>';
  }

  function computeRisk() {
    var severity = parseInt(wizardData.riskSeverity || '0', 10) || 0;
    var likelihood = parseInt(wizardData.riskLikelihood || '0', 10) || 0;
    var score = severity * likelihood;
    var meta = getRiskMeta(score);
    wizardData.riskScore = score;
    wizardData.riskLevel = meta.level;
  }

  function renderClassificationStep() {
    var rows = wizardData.classifications.map(function (entry, index) {
      var categoryOptions = renderOptions(CLASSIFICATION_CATEGORIES, entry.category);
      var typeOptions = renderOptions(TYPES_BY_CATEGORY[entry.category] || [], entry.type);
      return (
        '<div class="array-row">' +
          '<div class="array-row-head">' +
            '<div class="array-row-title">Classification ' + (index + 1) + '</div>' +
            '<div class="array-row-actions"><button class="ghost-mini-btn" type="button" data-action="remove-row" data-array="classifications" data-index="' + index + '">Remove</button></div>' +
          '</div>' +
          '<div class="field-grid">' +
            renderFieldGroup('Category', '<select class="field-select" data-array="classifications" data-index="' + index + '" data-key="category"><option value="">Select category...</option>' + categoryOptions + '</select>', false, '', false) +
            renderFieldGroup('Type', '<select class="field-select" data-array="classifications" data-index="' + index + '" data-key="type"><option value="">Select type...</option>' + typeOptions + '</select>', false, '', false) +
            (entry.type === 'Other' ? renderFieldGroup('Other description', '<input class="field-input" data-array="classifications" data-index="' + index + '" data-key="otherDescription" value="' + escapeHtml(entry.otherDescription || '') + '" placeholder="Describe the classification">' , false, '', true) : '') +
          '</div>' +
        '</div>'
      );
    }).join('');

    return (
      '<div class="subsection">' +
        '<div class="subsection-title">Add one or more classifications</div>' +
        '<div class="subsection-copy">Use the same category and type structure as the incident module so analysis stays consistent.</div>' +
        '<div class="array-list">' +
          (rows || '<div class="empty-array">No classifications added yet.</div>') +
        '</div>' +
        '<button class="mini-btn" type="button" data-action="add-row" data-array="classifications">+ Add Classification</button>' +
      '</div>'
    );
  }

  function renderImpactsStep() {
    var rows = wizardData.impacts.map(function (entry, index) {
      return (
        '<div class="array-row">' +
          '<div class="array-row-head">' +
            '<div class="array-row-title">Impact ' + (index + 1) + '</div>' +
            '<div class="array-row-actions"><button class="ghost-mini-btn" type="button" data-action="remove-row" data-array="impacts" data-index="' + index + '">Remove</button></div>' +
          '</div>' +
          '<div class="field-grid-3">' +
            renderFieldGroup('Impact type', '<select class="field-select" data-array="impacts" data-index="' + index + '" data-key="impactType"><option value="">Select impact...</option>' + renderOptions(IMPACT_TYPES, entry.impactType) + '</select>', false, '', false) +
            renderFieldGroup('Person category', '<select class="field-select" data-array="impacts" data-index="' + index + '" data-key="personCategory"><option value="">Select person...</option>' + renderOptions(PERSON_CATEGORIES, entry.personCategory) + '</select>', false, '', false) +
            renderFieldGroup('Number of persons', '<input class="field-input" data-array="impacts" data-index="' + index + '" data-key="numberOfPersons" type="number" min="1" value="' + escapeHtml(entry.numberOfPersons || 1) + '">', false, '', false) +
          '</div>' +
        '</div>'
      );
    }).join('');

    return (
      '<div class="subsection">' +
        '<div class="subsection-title">Who or what was affected?</div>' +
        '<div class="subsection-copy">Capture each distinct impact separately so the report remains structured.</div>' +
        '<div class="array-list">' + (rows || '<div class="empty-array">No impacts added yet.</div>') + '</div>' +
        '<button class="mini-btn" type="button" data-action="add-row" data-array="impacts">+ Add Impact</button>' +
      '</div>'
    );
  }

  function renderPersonsAtRiskStep() {
    var rows = wizardData.personsAtRisk.map(function (entry, index) {
      return (
        '<div class="array-row">' +
          '<div class="array-row-head">' +
            '<div class="array-row-title">Person group ' + (index + 1) + '</div>' +
            '<div class="array-row-actions"><button class="ghost-mini-btn" type="button" data-action="remove-row" data-array="personsAtRisk" data-index="' + index + '">Remove</button></div>' +
          '</div>' +
          '<div class="field-grid">' +
            renderFieldGroup('Person category', '<select class="field-select" data-array="personsAtRisk" data-index="' + index + '" data-key="personCategory"><option value="">Select person...</option>' + renderOptions(PERSON_CATEGORIES, entry.personCategory) + '</select>', false, '', false) +
            renderFieldGroup('Number of persons', '<input class="field-input" data-array="personsAtRisk" data-index="' + index + '" data-key="numberOfPersons" type="number" min="1" value="' + escapeHtml(entry.numberOfPersons || 1) + '">', false, '', false) +
            renderFieldGroup('Notes', '<textarea class="field-textarea" data-array="personsAtRisk" data-index="' + index + '" data-key="notes" rows="3" placeholder="Add any helpful notes">' + escapeHtml(entry.notes || '') + '</textarea>', false, '', true) +
          '</div>' +
        '</div>'
      );
    }).join('');

    return (
      '<div class="subsection">' +
        '<div class="subsection-title">Potentially affected persons</div>' +
        '<div class="subsection-copy">List the groups that were or could have been affected.</div>' +
        '<div class="array-list">' + (rows || '<div class="empty-array">No persons at risk added yet.</div>') + '</div>' +
        '<button class="mini-btn" type="button" data-action="add-row" data-array="personsAtRisk">+ Add Person Group</button>' +
      '</div>'
    );
  }

  function renderTextRows(arrayName, title, copy, placeholder) {
    var rows = wizardData[arrayName].map(function (entry, index) {
      return (
        '<div class="array-row">' +
          '<div class="array-row-head">' +
            '<div class="array-row-title">' + escapeHtml(title) + ' ' + (index + 1) + '</div>' +
            '<div class="array-row-actions"><button class="ghost-mini-btn" type="button" data-action="remove-row" data-array="' + escapeHtml(arrayName) + '" data-index="' + index + '">Remove</button></div>' +
          '</div>' +
          renderFieldGroup(title, '<textarea class="field-textarea" data-array="' + escapeHtml(arrayName) + '" data-index="' + index + '" data-key="text" rows="4" placeholder="' + escapeHtml(placeholder) + '">' + escapeHtml(entry.text || '') + '</textarea>', false, '', true) +
        '</div>'
      );
    }).join('');

    return (
      '<div class="subsection">' +
        '<div class="subsection-title">' + escapeHtml(title) + '</div>' +
        '<div class="subsection-copy">' + escapeHtml(copy) + '</div>' +
        '<div class="array-list">' + (rows || '<div class="empty-array">Nothing added yet.</div>') + '</div>' +
        '<button class="mini-btn" type="button" data-action="add-row" data-array="' + escapeHtml(arrayName) + '">+ Add ' + escapeHtml(title) + '</button>' +
      '</div>'
    );
  }

  function renderCorrectiveActionsStep() {
    var rows = wizardData.correctiveActions.map(function (entry, index) {
      return (
        '<div class="array-row">' +
          '<div class="array-row-head">' +
            '<div class="array-row-title">Corrective action ' + (index + 1) + '</div>' +
            '<div class="array-row-actions"><button class="ghost-mini-btn" type="button" data-action="remove-row" data-array="correctiveActions" data-index="' + index + '">Remove</button></div>' +
          '</div>' +
          '<div class="field-grid">' +
            renderFieldGroup('Description', '<textarea class="field-textarea" data-array="correctiveActions" data-index="' + index + '" data-key="description" rows="4" placeholder="Describe the corrective action">' + escapeHtml(entry.description || '') + '</textarea>', false, '', true) +
            renderFieldGroup('Responsible person', '<input class="field-input" data-array="correctiveActions" data-index="' + index + '" data-key="responsiblePerson" value="' + escapeHtml(entry.responsiblePerson || '') + '" placeholder="Enter a name">', false, '', false) +
            renderFieldGroup('Due date', '<input class="field-input" data-array="correctiveActions" data-index="' + index + '" data-key="dueDate" type="date" value="' + escapeHtml(entry.dueDate || '') + '">', false, '', false) +
            renderFieldGroup('Status', '<select class="field-select" data-array="correctiveActions" data-index="' + index + '" data-key="status">' + renderOptions(ACTION_STATUSES, entry.status || 'Open') + '</select>', false, '', false) +
          '</div>' +
        '</div>'
      );
    }).join('');

    return (
      '<div class="subsection">' +
        '<div class="subsection-title">Corrective actions</div>' +
        '<div class="subsection-copy">Create the follow-up actions that should be tracked after submission.</div>' +
        '<div class="array-list">' + (rows || '<div class="empty-array">No corrective actions added yet.</div>') + '</div>' +
        '<button class="mini-btn" type="button" data-action="add-row" data-array="correctiveActions">+ Add Corrective Action</button>' +
      '</div>'
    );
  }

  function renderDamagedItemsStep() {
    var rows = wizardData.damagedItems.map(function (entry, index) {
      return (
        '<div class="array-row">' +
          '<div class="array-row-head">' +
            '<div class="array-row-title">Damaged item ' + (index + 1) + '</div>' +
            '<div class="array-row-actions"><button class="ghost-mini-btn" type="button" data-action="remove-row" data-array="damagedItems" data-index="' + index + '">Remove</button></div>' +
          '</div>' +
          '<div class="field-grid">' +
            renderFieldGroup('Item name', '<input class="field-input" data-array="damagedItems" data-index="' + index + '" data-key="itemName" value="' + escapeHtml(entry.itemName || '') + '" placeholder="e.g. Fuel pump, dispenser, gate">', false, '', false) +
            renderFieldGroup('Estimated cost (GHS)', '<input class="field-input" data-array="damagedItems" data-index="' + index + '" data-key="estimatedCost" type="number" min="0" value="' + escapeHtml(entry.estimatedCost || '') + '" placeholder="0">', false, '', false) +
            renderFieldGroup('Description', '<textarea class="field-textarea" data-array="damagedItems" data-index="' + index + '" data-key="description" rows="4" placeholder="Describe the damage">' + escapeHtml(entry.description || '') + '</textarea>', false, '', true) +
          '</div>' +
        '</div>'
      );
    }).join('');

    return (
      '<div class="subsection">' +
        '<div class="subsection-title">Damaged or lost items</div>' +
        '<div class="subsection-copy">Add every damaged or lost item if the accident involved property damage.</div>' +
        '<div class="array-list">' + (rows || '<div class="empty-array">No damaged items added yet.</div>') + '</div>' +
        '<button class="mini-btn" type="button" data-action="add-row" data-array="damagedItems">+ Add Damaged Item</button>' +
      '</div>'
    );
  }

  function renderAttachmentsStep() {
    var attachmentList = wizardData.attachments.length
      ? '<div class="array-list">' + wizardData.attachments.map(function (file) {
          return '<div class="array-row"><div class="review-line"><strong>' + escapeHtml(file.name) + '</strong> — ' + escapeHtml(file.type || 'file') + ' — ' + escapeHtml(String(file.size || 0)) + ' bytes</div></div>';
        }).join('') + '</div>'
      : '<div class="empty-array">No files selected yet.</div>';

    return (
      '<div class="subsection">' +
        '<div class="subsection-title">Attachments</div>' +
        '<div class="subsection-copy">Upload any supporting evidence and add a note if needed.</div>' +
        '<div class="field-grid">' +
          renderFieldGroup('Supporting files', '<input class="field-input" data-field="attachments" type="file" multiple>', false, 'Files are stored only in this browser session until submission.', true) +
          renderFieldGroup('Attachment notes', '<textarea class="field-textarea" data-field="attachmentNotes" rows="4" placeholder="Add any notes about the uploaded evidence">' + escapeHtml(wizardData.attachmentNotes || '') + '</textarea>', false, '', true) +
        '</div>' +
        attachmentList +
      '</div>'
    );
  }

  function renderRiskAssessmentStep() {
    computeRisk();
    var meta = getRiskMeta(wizardData.riskScore);
    return (
      '<div class="subsection">' +
        '<div class="subsection-title">Score the hazard</div>' +
        '<div class="subsection-copy">Select severity and likelihood to calculate the risk score exactly the way the incident module works.</div>' +
        '<div class="field-grid">' +
          renderFieldGroup('Severity (1-5)', '<select class="field-select" data-field="riskSeverity"><option value="">Select severity...</option>' + renderOptions(['1', '2', '3', '4', '5'], wizardData.riskSeverity) + '</select>', true, '1 = Negligible, 5 = Catastrophic', false) +
          renderFieldGroup('Likelihood (1-5)', '<select class="field-select" data-field="riskLikelihood"><option value="">Select likelihood...</option>' + renderOptions(['1', '2', '3', '4', '5'], wizardData.riskLikelihood) + '</select>', true, '1 = Rare, 5 = Almost Certain', false) +
        '</div>' +
        (wizardData.riskScore > 0 ? (
          '<div class="risk-score-card">' +
            '<div class="risk-score-equation">' +
              '<div><div class="field-help">Risk score</div><div class="risk-score-value">' + escapeHtml(String(wizardData.riskScore)) + '</div></div>' +
              '<div class="review-line"><strong>Severity:</strong> ' + escapeHtml(String(wizardData.riskSeverity || 0)) + '</div>' +
              '<div class="review-line"><strong>Likelihood:</strong> ' + escapeHtml(String(wizardData.riskLikelihood || 0)) + '</div>' +
            '</div>' +
            '<span class="risk-badge ' + meta.badgeClass + '">' + escapeHtml(meta.level) + ' Risk</span>' +
          '</div>'
        ) : '') +
        '<div class="field-grid">' +
          renderFieldGroup('Number of exposed persons', '<input class="field-input" data-field="exposedPersons" type="number" min="0" value="' + escapeHtml(wizardData.exposedPersons || '') + '" placeholder="0">', false, '', false) +
          renderFieldGroup('Existing controls', '<textarea class="field-textarea" data-field="existingControls" rows="4" placeholder="Describe any controls already in place">' + escapeHtml(wizardData.existingControls || '') + '</textarea>', false, '', true) +
        '</div>' +
      '</div>'
    );
  }

  function renderReviewStep(type) {
    computeRisk();
    var sections = [];
    sections.push(
      '<div class="review-card">' +
        '<h4>Core Details</h4>' +
        '<div class="review-line"><strong>Type:</strong> ' + escapeHtml(TYPE_LABELS[type]) + '</div>' +
        '<div class="review-line"><strong>Date:</strong> ' + escapeHtml(formatDateForDisplay(wizardData.incidentDate)) + '</div>' +
        '<div class="review-line"><strong>Time:</strong> ' + escapeHtml(wizardData.incidentTime || 'Not set') + '</div>' +
        '<div class="review-line"><strong>Status:</strong> ' + escapeHtml(wizardData.status || 'Open') + '</div>' +
        '<div class="review-line"><strong>Location:</strong> ' + escapeHtml([wizardData.locationName, wizardData.region].filter(Boolean).join(', ') || 'Not set') + '</div>' +
      '</div>'
    );

    sections.push(
      '<div class="review-card">' +
        '<h4>Description</h4>' +
        '<div class="review-line">' + escapeHtml(wizardData.description || 'No description entered yet.') + '</div>' +
      '</div>'
    );

    if (wizardData.correctiveActions.length) {
      sections.push(
        '<div class="review-card">' +
          '<h4>Corrective Actions</h4>' +
          wizardData.correctiveActions.map(function (item) {
            return '<div class="review-line"><strong>' + escapeHtml(item.description || 'Untitled action') + '</strong><br>' +
              escapeHtml(item.responsiblePerson || 'No owner') + ' · Due ' + escapeHtml(item.dueDate || 'Not set') + ' · ' + escapeHtml(item.status || 'Open') + '</div>';
          }).join('') +
        '</div>'
      );
    }

    if (wizardData.riskScore > 0) {
      sections.push(
        '<div class="review-card">' +
          '<h4>Risk Assessment</h4>' +
          '<div class="review-line"><strong>Score:</strong> ' + escapeHtml(String(wizardData.riskScore)) + '</div>' +
          '<div class="review-line"><strong>Level:</strong> ' + escapeHtml(wizardData.riskLevel || '') + '</div>' +
          '<div class="review-line"><strong>Exposed persons:</strong> ' + escapeHtml(wizardData.exposedPersons || '0') + '</div>' +
        '</div>'
      );
    }

    sections.push(
      '<div class="review-card">' +
        '<h4>Ready to submit</h4>' +
        '<div class="review-line">Submit this report to save it locally in the HSSEQ incident register on this same page.</div>' +
      '</div>'
    );

    return '<div class="review-grid">' + sections.join('') + '</div>';
  }

  function renderFormStep(type, stepName) {
    if (stepName === 'When') {
      return (
        '<div class="field-grid">' +
          renderFieldGroup('Incident date', renderInput('incidentDate', 'date', '', wizardData.incidentDate || '', ''), true, '', false) +
          renderFieldGroup('Incident time', renderInput('incidentTime', 'time', '', wizardData.incidentTime || '', ''), false, 'Optional', false) +
        '</div>'
      );
    }

    if (stepName === 'Where') {
      return (
        '<div class="field-grid">' +
          renderFieldGroup('Region', renderSelect('region', wizardData.region, REGIONS, 'Select region...'), true, '', false) +
          renderFieldGroup('Facility type', renderSelect('facilityType', wizardData.facilityType, FACILITY_TYPES, 'Select facility type...'), true, '', false) +
          renderFieldGroup('Location name', renderInput('locationName', 'text', 'e.g. BAWKU BY-PASS, Accra Central', wizardData.locationName || '', ''), true, '', false) +
          renderFieldGroup('Facility name', renderInput('facilityName', 'text', 'Optional facility name', wizardData.facilityName || '', ''), false, '', false) +
        '</div>'
      );
    }

    if (stepName === 'Description' || stepName === 'Details') {
      var descriptionLabel = stepName === 'Details'
        ? 'Near Miss Description'
        : (type === 'accident'
          ? 'Accident Description'
          : type === 'dangerous_occurrence'
            ? 'Dangerous Occurrence Description'
            : type === 'hazard'
              ? 'Hazard Description'
              : 'Description');
      var descriptionFields = '<div class="field-grid">' +
        renderFieldGroup('Status', renderSelect('status', wizardData.status, STATUSES, 'Select status...'), false, '', false) +
        (type === 'hazard' ? renderFieldGroup('Hazard category', renderSelect('hazardCategory', wizardData.hazardCategory, HAZARD_CATEGORIES, 'Select category...'), true, '', false) : '') +
        (type === 'hazard' && wizardData.hazardCategory === 'Other' ? renderFieldGroup('Other hazard category', renderInput('hazardCategoryOther', 'text', 'Describe the category', wizardData.hazardCategoryOther || '', ''), false, '', true) : '') +
      '</div>' +
      renderFieldGroup(
        descriptionLabel,
        renderTextarea('description', 'Describe what happened in detail (minimum 20 characters)...', wizardData.description || '', 6),
        true,
        String((wizardData.description || '').length) + ' characters',
        true
      );

      if (type === 'near_miss' || type === 'dangerous_occurrence') {
        descriptionFields += '<div class="field-grid">' +
          renderFieldGroup('Potential consequence', renderTextarea('potentialConsequence', 'What could have happened?', wizardData.potentialConsequence || '', 4), false, '', true) +
          (type === 'near_miss' ? renderFieldGroup('Likelihood of recurrence', renderSelect('likelihoodRecurrence', wizardData.likelihoodRecurrence, LIKELIHOOD_RECURRENCE, 'Select likelihood...'), false, '', false) : '') +
        '</div>';
      }

      if (type === 'accident') {
        descriptionFields +=
          '<div class="subsection accident-flags">' +
            '<div class="checkbox-stack">' +
              renderCheckbox('isVehicularAccident', 'This was a vehicular accident', '', wizardData.isVehicularAccident) +
              (wizardData.isVehicularAccident ? (
                '<div class="field-grid">' +
                  renderFieldGroup('Vehicle type', renderInput('vehicleType', 'text', 'e.g. Tanker, Van', wizardData.vehicleType || '', ''), false, '', false) +
                  renderFieldGroup('Car / registration number', renderInput('carNumber', 'text', 'e.g. GR-1234-21', wizardData.carNumber || '', ''), false, '', false) +
                  renderFieldGroup('Driver name', renderInput('driverName', 'text', 'Driver full name', wizardData.driverName || '', ''), false, '', false) +
                '</div>'
              ) : '') +
              renderCheckbox('hasEnvironmentalImpact', 'There was an environmental impact (product release)', '', wizardData.hasEnvironmentalImpact) +
              (wizardData.hasEnvironmentalImpact ? (
                '<div class="field-grid">' +
                  renderFieldGroup('Product released', renderInput('productReleased', 'text', 'e.g. Diesel, Petrol, LPG', wizardData.productReleased || '', ''), false, '', false) +
                  renderFieldGroup('Quantity released (litres)', renderInput('quantityReleased', 'number', '0', wizardData.quantityReleased || '', ' min="0"'), false, '', false) +
                '</div>'
              ) : '') +
              renderCheckbox('hasPropertyDamage', 'There was property loss or damage (adds Damaged Items step)', '', wizardData.hasPropertyDamage) +
            '</div>' +
          '</div>';
      }

      return descriptionFields;
    }

    if (stepName === 'Classification') return renderClassificationStep();
    if (stepName === 'Impacts') return renderImpactsStep();
    if (stepName === 'Persons at Risk') return renderPersonsAtRiskStep();
    if (stepName === 'Immediate Actions') return renderTextRows('immediateActions', 'Immediate action', 'List the first actions taken to control the situation.', 'Describe the immediate action taken');
    if (stepName === 'Root Causes') return renderTextRows('rootCauses', 'Root cause', 'Capture each underlying cause separately for better investigation quality.', 'Describe the root cause');
    if (stepName === 'Corrective Actions') return renderCorrectiveActionsStep();
    if (stepName === 'Damaged Items') return renderDamagedItemsStep();
    if (stepName === 'Risk Assessment') return renderRiskAssessmentStep();
    if (stepName === 'Attachments') return renderAttachmentsStep();
    if (stepName === 'Review') return renderReviewStep(type);
    return '<div class="empty-array">This step is not available yet.</div>';
  }

  function renderStepper(steps, currentStep) {
    return steps.map(function (step, index) {
      var chipClass = 'step-chip';
      var meta = 'Pending';
      var indexText = String(index + 1);
      if (index < currentStep) {
        chipClass += ' done';
        meta = 'Completed';
        indexText = '✓';
      } else if (index === currentStep) {
        chipClass += ' active';
        meta = 'Current step';
      }
      return (
        '<div class="' + chipClass + '">' +
          '<div class="step-chip-head">' +
            '<span class="step-chip-index">' + escapeHtml(indexText) + '</span>' +
            '<span class="step-chip-label">' + escapeHtml(step) + '</span>' +
          '</div>' +
          '<div class="step-chip-meta">' + escapeHtml(meta) + '</div>' +
        '</div>'
      );
    }).join('');
  }

  function setFormError(message) {
    if (!formErrorAlert) return;
    if (!message) {
      formErrorAlert.hidden = true;
      formErrorAlert.textContent = '';
      return;
    }
    formErrorAlert.hidden = false;
    formErrorAlert.textContent = message;
  }

  function validateStep(type, stepName) {
    if (stepName === 'When' && !wizardData.incidentDate) {
      setFormError('Select the incident date before continuing.');
      return false;
    }
    if (stepName === 'Where' && (!wizardData.region || !wizardData.facilityType || !wizardData.locationName)) {
      setFormError('Complete the region, facility type, and location name before continuing.');
      return false;
    }
    if ((stepName === 'Description' || stepName === 'Details') && (!wizardData.description || wizardData.description.trim().length < 20)) {
      setFormError('Add a description with at least 20 characters before continuing.');
      return false;
    }
    if (type === 'hazard' && stepName === 'Description' && !wizardData.hazardCategory) {
      setFormError('Select the hazard category before continuing.');
      return false;
    }
    if (stepName === 'Risk Assessment' && (!wizardData.riskSeverity || !wizardData.riskLikelihood)) {
      setFormError('Select both severity and likelihood to calculate the risk score.');
      return false;
    }
    setFormError('');
    return true;
  }

  function saveDraftStatusText() {
    if (!formDraftStatus) return;
    if (wizardData.__lastSaved) {
      formDraftStatus.textContent = 'Draft saved ' + formatDateTimeForDisplay(wizardData.__lastSaved);
    } else {
      formDraftStatus.textContent = 'Draft is stored locally in this browser.';
    }
  }

  function renderFormView(type, step) {
    ensureWizardType(type);
    var steps = getSteps(type);
    var currentStep = step;
    if (currentStep < 0) currentStep = 0;
    if (currentStep > steps.length - 1) currentStep = steps.length - 1;
    if (currentStep !== step) updateUrl('form', type, currentStep, '', true);

    var stepName = steps[currentStep];
    var stepCopy = STEP_COPY[stepName] || { title: stepName, subtitle: '' };
    if (formKicker) formKicker.textContent = 'Incident workflow';
    if (formTitle) formTitle.textContent = 'Report Incident / Hazard';
    if (formSubtitle) formSubtitle.textContent = 'Complete the wizard to submit your report';
    if (formStepTitle) formStepTitle.textContent = stepCopy.title;
    if (formStepCopy) formStepCopy.textContent = stepCopy.subtitle;
    if (formStepCounter) formStepCounter.textContent = (currentStep + 1) + ' / ' + steps.length;
    if (formStepper) formStepper.innerHTML = renderStepper(steps, currentStep);
    var footerStepText = document.getElementById('formFooterStepText');
    if (footerStepText) footerStepText.textContent = 'Step ' + (currentStep + 1) + ' of ' + steps.length;
    var progressFill = document.getElementById('formStepperProgress');
    if (progressFill) {
      var progressPercent = steps.length > 1
        ? (((currentStep + 1) / steps.length) * 100)
        : 100;
      progressFill.style.width = Math.max(12, Math.round(progressPercent)) + '%';
    }
    if (formPanelTitle) formPanelTitle.textContent = stepCopy.title;
    if (formPanelSubtitle) formPanelSubtitle.textContent = stepCopy.subtitle;
    if (formFields) formFields.innerHTML = renderFormStep(type, stepName);
    if (formBackBtn) formBackBtn.textContent = currentStep === 0 ? 'Back to Types' : 'Back';
    if (formNextBtn) formNextBtn.textContent = currentStep === steps.length - 1 ? 'Submit Report →' : 'Next →';
    saveDraftStatusText();
    setFormError('');
  }

  function updateHomeMetrics() {
    var reports = loadReports();
    var metrics = Array.prototype.slice.call(document.querySelectorAll('#metrics .metric-card'));
    if (metrics.length < 6) return;
    var now = new Date();
    var currentMonth = now.getMonth();
    var currentYear = now.getFullYear();
    var incidents = reports.filter(function (item) { return item.type !== 'hazard'; });
    var hazards = reports.filter(function (item) { return item.type === 'hazard'; });
    var thisMonthIncidents = incidents.filter(function (item) {
      var date = new Date(item.submittedAt);
      return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
    });
    var injuries = incidents.reduce(function (total, item) {
      var impacts = (item.data && item.data.impacts) || [];
      return total + impacts.reduce(function (sum, impact) {
        if (String(impact.impactType || '').toLowerCase() === 'injury') {
          return sum + (parseInt(impact.numberOfPersons || 0, 10) || 0);
        }
        return sum;
      }, 0);
    }, 0);
    var fatalities = incidents.reduce(function (total, item) {
      var impacts = (item.data && item.data.impacts) || [];
      return total + impacts.reduce(function (sum, impact) {
        if (String(impact.impactType || '').toLowerCase() === 'fatality') {
          return sum + (parseInt(impact.numberOfPersons || 0, 10) || 0);
        }
        return sum;
      }, 0);
    }, 0);
    var spills = incidents.reduce(function (total, item) {
      var quantity = parseFloat((item.data && item.data.quantityReleased) || 0) || 0;
      return total + (quantity > 0 ? 1 : 0);
    }, 0);
    var values = [
      String(thisMonthIncidents.length),
      String(incidents.length),
      String(hazards.length),
      String(injuries),
      String(fatalities),
      String(spills)
    ];
    metrics.forEach(function (card, index) {
      var node = card.querySelector('.metric-value');
      if (node && values[index] != null) node.textContent = values[index];
    });

    var panel = document.getElementById('recent-activity');
    if (panel) {
      var body = panel.querySelector('.panel-body');
      if (body) {
        if (!reports.length) {
          body.innerHTML = '<div class="empty-state">No incidents reported yet</div>';
        } else {
          body.innerHTML = '<div class="snapshot-grid">' + reports.slice(0, 5).map(function (item) {
            return '<div class="snapshot-tile">' +
              '<div class="snapshot-label">' + escapeHtml(TYPE_LABELS[item.type] || 'Report') + '</div>' +
              '<div class="snapshot-value">' + escapeHtml(item.data.locationName || item.data.facilityName || 'Unnamed location') + '</div>' +
              '<div class="snapshot-meta">' + escapeHtml(formatDateTimeForDisplay(item.submittedAt)) + '</div>' +
            '</div>';
          }).join('') + '</div>';
        }
      }
    }
  }

  function normalizeStatusLabel(value) {
    var status = String(value || 'Open').trim();
    if (!status) status = 'Open';
    if (status === 'Under Investigation') return { text: status, className: 'investigating' };
    if (status === 'Closed') return { text: status, className: 'closed' };
    return { text: status, className: 'open' };
  }

  function renderIncidentList() {
    if (!incidentListBody) return;
    var reports = loadReports().slice();
    var selectedYear = listYear ? String(listYear.value || '') : '';
    var query = String(listSearchQuery || '').trim().toLowerCase();
    var filtered = reports.filter(function (item) {
      var yearMatch = true;
      if (selectedYear) {
        var submittedYear = '';
        if (item && item.submittedAt) {
          var date = new Date(item.submittedAt);
          if (!Number.isNaN(date.getTime())) submittedYear = String(date.getFullYear());
        }
        yearMatch = !selectedYear || submittedYear === selectedYear;
      }
      if (!yearMatch) return false;
      if (!query) return true;
      var haystack = [
        item.id,
        TYPE_LABELS[item.type] || item.type,
        item.status,
        item.data && item.data.locationName,
        item.data && item.data.facilityName,
        item.data && item.data.region,
        item.data && item.data.description
      ].join(' ').toLowerCase();
      return haystack.indexOf(query) !== -1;
    });

    if (listSummaryText) listSummaryText.textContent = 'Showing ' + filtered.length + ' of ' + reports.length + ' records';
    if (listSummaryMeta) listSummaryMeta.textContent = 'Page 1 of 1';

    if (!filtered.length) {
      incidentListBody.innerHTML = '<tr><td colspan="7" class="list-empty">No incidents found matching your criteria</td></tr>';
      return;
    }

    incidentListBody.innerHTML = filtered.map(function (item) {
      var data = item.data || {};
      var statusMeta = normalizeStatusLabel(item.status || data.status);
      var dateText = formatDateForDisplay(item.submittedAt || data.incidentDate);
      var classText = TYPE_LABELS[item.type] || 'Report';
      var locationText = [data.locationName, data.region].filter(Boolean).join(', ') || 'Not set';
      var descriptionText = data.description || 'No description provided.';
      return '<tr>' +
        '<td><div class="incident-id">' + escapeHtml(item.id || 'No ID') + '</div></td>' +
        '<td>' + escapeHtml(dateText) + '</td>' +
        '<td>' + escapeHtml(classText) + '</td>' +
        '<td><div class="incident-location">' + escapeHtml(locationText) + '</div></td>' +
        '<td><div class="incident-description">' + escapeHtml(descriptionText) + '</div></td>' +
        '<td><span class="status-pill ' + escapeHtml(statusMeta.className) + '">' + escapeHtml(statusMeta.text) + '</span></td>' +
        '<td><button class="list-action-btn" type="button" data-action="view-report" data-report-id="' + escapeHtml(item.id || '') + '">View</button></td>' +
      '</tr>';
    }).join('');
  }

  function submitReport(type) {
    computeRisk();
    var reports = loadReports();
    reports.unshift({
      id: 'IHR-' + Date.now(),
      type: type,
      submittedAt: new Date().toISOString(),
      status: wizardData.status || 'Open',
      data: clone(wizardData)
    });
    saveReports(reports);
    clearDraft();
    wizardData = getDefaultWizardData(type);
    updateHomeMetrics();
    openHomeView('recent-activity');
  }

  function getEmptyRow(arrayName) {
    if (arrayName === 'classifications') return createEmptyClassification();
    if (arrayName === 'impacts') return createEmptyImpact();
    if (arrayName === 'personsAtRisk') return createEmptyPersonAtRisk();
    if (arrayName === 'rootCauses') return createEmptyTextRow();
    if (arrayName === 'immediateActions') return createEmptyTextRow();
    if (arrayName === 'correctiveActions') return createEmptyCorrectiveAction();
    if (arrayName === 'damagedItems') return createEmptyDamagedItem();
    return {};
  }

  function rerenderForStructuralChange() {
    var state = getState();
    renderFormView(state.type, state.step);
    saveDraftStatusText();
    saveDraft(wizardData);
  }

  function handleFieldChange(target) {
    var state = getState();
    if (state.view !== 'form') return;

    if (target.matches('[data-array][data-index][data-key]')) {
      var arrayName = target.getAttribute('data-array');
      var index = parseInt(target.getAttribute('data-index') || '0', 10);
      var key = target.getAttribute('data-key');
      if (!Array.isArray(wizardData[arrayName]) || !wizardData[arrayName][index]) return;
      var nextValue = target.type === 'checkbox' ? target.checked : target.value;
      if (target.type === 'number') nextValue = target.value === '' ? '' : parseInt(target.value, 10) || 0;
      wizardData[arrayName][index][key] = nextValue;
      if (arrayName === 'classifications' && key === 'category') {
        wizardData[arrayName][index].type = '';
        wizardData[arrayName][index].otherDescription = '';
        renderFormView(state.type, state.step);
      }
      if (arrayName === 'classifications' && key === 'type') {
        renderFormView(state.type, state.step);
      }
      saveDraft(wizardData);
      saveDraftStatusText();
      return;
    }

    if (!target.matches('[data-field]')) return;
    var field = target.getAttribute('data-field');
    if (!field) return;

    if (field === 'attachments' && target.type === 'file') {
      wizardData.attachments = Array.prototype.slice.call(target.files || []).map(function (file) {
        return { name: file.name, size: file.size, type: file.type };
      });
      renderFormView(state.type, state.step);
      saveDraft(wizardData);
      saveDraftStatusText();
      return;
    }

    var value = target.type === 'checkbox' ? target.checked : target.value;
    wizardData[field] = value;

    if (field === 'hazardCategory' && value !== 'Other') wizardData.hazardCategoryOther = '';
    if (field === 'isVehicularAccident' && !value) {
      wizardData.vehicleType = '';
      wizardData.carNumber = '';
      wizardData.driverName = '';
    }
    if (field === 'hasEnvironmentalImpact' && !value) {
      wizardData.productReleased = '';
      wizardData.quantityReleased = '';
    }
    if (field === 'hasPropertyDamage' && !value) {
      wizardData.damagedItems = [];
    }
    if (field === 'riskSeverity' || field === 'riskLikelihood') {
      computeRisk();
    }

    saveDraft(wizardData);
    saveDraftStatusText();

    if (['hazardCategory', 'isVehicularAccident', 'hasEnvironmentalImpact', 'hasPropertyDamage', 'riskSeverity', 'riskLikelihood'].indexOf(field) !== -1) {
      renderFormView(state.type, state.step);
    }
  }

  function handleFormClick(event) {
    var target = event.target.closest('[data-action]');
    if (!target) return;
    var action = target.getAttribute('data-action');
    var arrayName = target.getAttribute('data-array');
    var index = parseInt(target.getAttribute('data-index') || '-1', 10);
    var state = getState();
    if (state.view !== 'form') return;
    event.preventDefault();

    if (action === 'add-row' && arrayName) {
      if (!Array.isArray(wizardData[arrayName])) wizardData[arrayName] = [];
      wizardData[arrayName].push(getEmptyRow(arrayName));
      renderFormView(state.type, state.step);
      saveDraft(wizardData);
      saveDraftStatusText();
      return;
    }

    if (action === 'remove-row' && arrayName && index > -1 && Array.isArray(wizardData[arrayName])) {
      wizardData[arrayName].splice(index, 1);
      renderFormView(state.type, state.step);
      saveDraft(wizardData);
      saveDraftStatusText();
    }
  }

  function renderState() {
    var state = getState();
    if (homeView) homeView.hidden = state.view !== 'home';
    if (reportView) reportView.hidden = state.view !== 'report';
    if (listView) listView.hidden = state.view !== 'list';
    if (formView) formView.hidden = state.view !== 'form';
    updateActiveNav(state.view);
    applySelection(state.type);
    if (reportModeHint) {
      reportModeHint.textContent =
        'Selected report type: ' + (TYPE_LABELS[state.type] || 'Accident') +
        '. Choose a report card or click Start Report to open the actual form workflow on this same page.';
    }

    if (state.view === 'form') {
      renderFormView(state.type, state.step);
      return;
    }

    if (state.view === 'home') {
      updateHomeMetrics();
      scrollToHashTarget(state.hash);
    } else if (state.view === 'list') {
      renderIncidentList();
    } else if (state.hash) {
      window.history.replaceState({}, '', window.location.pathname + window.location.search);
    }
  }

  if (homeCta) {
    homeCta.addEventListener('click', function (event) {
      event.preventDefault();
      openReportView(getState().type);
    });
  }

  homeReportLinks.forEach(function (link) {
    link.addEventListener('click', function (event) {
      event.preventDefault();
      openFormView(link.getAttribute('data-type') || 'accident', 0);
    });
  });

  wizardCards.forEach(function (card) {
    card.addEventListener('click', function (event) {
      event.preventDefault();
      openFormView(card.getAttribute('data-report-type') || 'accident', 0);
    });
  });

  if (backToHomeBtn) {
    backToHomeBtn.addEventListener('click', function () {
      window.location.href = 'incident-dashboard.html';
    });
  }

  if (changeTypeBtn) {
    changeTypeBtn.addEventListener('click', function () {
      openReportView(getState().type);
    });
  }

  if (saveDraftBtn) {
    saveDraftBtn.addEventListener('click', function () {
      saveDraft(wizardData);
      saveDraftStatusText();
    });
  }

  if (reportNavHome) {
    reportNavHome.addEventListener('click', function (event) {
      event.preventDefault();
      openHomeView('');
    });
  }

  if (reportNavReport) {
    reportNavReport.addEventListener('click', function (event) {
      event.preventDefault();
      openReportView(getState().type);
    });
  }

  if (reportNavList) {
    reportNavList.addEventListener('click', function (event) {
      event.preventDefault();
      openListView();
    });
  }

  targetNavItems.forEach(function (item) {
    item.addEventListener('click', function (event) {
      event.preventDefault();
      openHomeView(item.getAttribute('data-nav-target') || '');
    });
  });

  if (startReportBtn) {
    startReportBtn.addEventListener('click', function () {
      openFormView(getState().type, 0);
    });
  }

  if (listSearchBtn) {
    listSearchBtn.addEventListener('click', function () {
      listSearchQuery = listSearchInput ? listSearchInput.value || '' : '';
      renderIncidentList();
    });
  }

  if (listSearchInput) {
    listSearchInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        listSearchQuery = listSearchInput.value || '';
        renderIncidentList();
      }
    });
  }

  if (listYear) {
    listYear.addEventListener('change', function () {
      renderIncidentList();
    });
  }

  if (listFilterBtn) {
    listFilterBtn.addEventListener('click', function () {
      if (listSearchInput) listSearchInput.focus();
    });
  }

  if (formBackBtn) {
    formBackBtn.addEventListener('click', function () {
      var state = getState();
      if (state.step <= 0) {
        openReportView(state.type);
      } else {
        openFormView(state.type, state.step - 1);
      }
    });
  }

  if (formNextBtn) {
    formNextBtn.addEventListener('click', function () {
      var state = getState();
      var steps = getSteps(state.type);
      var stepName = steps[state.step];
      if (!validateStep(state.type, stepName)) return;
      if (state.step >= steps.length - 1) {
        submitReport(state.type);
      } else {
        openFormView(state.type, state.step + 1);
      }
    });
  }

  if (formFields) {
    formFields.addEventListener('input', function (event) { handleFieldChange(event.target); });
    formFields.addEventListener('change', function (event) { handleFieldChange(event.target); });
    formFields.addEventListener('click', handleFormClick);
  }

  if (incidentListBody) {
    incidentListBody.addEventListener('click', function (event) {
      var button = event.target.closest('[data-action="view-report"]');
      if (!button) return;
      var reportId = button.getAttribute('data-report-id');
      var reports = loadReports();
      var match = reports.find(function (item) { return item.id === reportId; });
      if (!match) return;
      wizardData = normalizeWizardData(match.data || {}, match.type || 'accident');
      openFormView(match.type || 'accident', 0);
    });
  }

  window.addEventListener('popstate', renderState);

  setProfileCopy();
  tickClock();
  setInterval(tickClock, 60000);
  updateHomeMetrics();
  renderState();
})();

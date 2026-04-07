# GOIL HSSEQ Integrated Risk Assessment & Facility Inspection App

## Project Overview
This front-end application implements the PRD operating model for the GOIL HSSEQ Department with an inspection-led workflow, deviation-triggered risk generation, and corrective action management. It is built as a responsive multi-page app using only HTML, CSS, and vanilla JavaScript with localStorage persistence.

## How This Build Reflects the PRD
- Inspection first: Area-based execution follows physical site walk order.
- Risk on deviation: Findings and risk cards are generated only for Partially Compliant and Non-Compliant responses.
- Modular by configuration: Checklist is generated from a master bank + template + enabled facility modules.
- One source of truth: Facility register, draft assessments, findings, and actions are persisted in localStorage using aligned data models.
- Actionable analytics: Summary dashboard separates compliance scoring from risk distribution and action status.
- Historical comparability: Stable question IDs are seeded in `question-bank.json` and reused by all templates.

## Folder Structure
```text
goil-hsseq-app/
├── index.html
├── pages/
│   ├── portal.html
│   ├── risk-inspection.html
│   ├── kpi.html
│   └── incident-reporting.html
├── assets/
│   ├── css/
│   │   └── styles.css
│   ├── js/
│   │   ├── auth.js
│   │   ├── auth-guard.js
│   │   ├── portal.js
│   │   └── risk-inspection.js
│   └── data/
│       ├── facilities.json
│       ├── question-bank.json
│       ├── template-fuel-station.json
│       ├── template-lpg-plant.json
│       ├── template-office.json
│       └── template-office-depot.json
└── README.md
```

## How to Run Locally
1. Open the `goil-hsseq-app` folder.
2. Serve it with any static server (recommended) to avoid browser file-fetch restrictions, for example:
   - `python3 -m http.server 8080`
   - then open `http://localhost:8080`
3. If your browser allows local JSON fetches, you can also open `index.html` directly.

## Current Implemented Features
- Login page with demo authentication and role simulation.
- Auth guard on all internal pages.
- Portal with module navigation and live summary widgets:
  - Open Draft Assessments
  - Overdue Actions
  - Critical Findings
  - Due Assessments
- Fully implemented Risk Assessment & Facility Inspection module:
  - Facility register with filters and 90-day due-state chips (On Track, Due Soon, Due Today, Overdue)
  - Assessment launch/resume by facility
  - Area navigator and progress indicators
  - Response model with required options:
    - Compliant
    - Partially Compliant
    - Non-Compliant
    - Not Applicable
  - Mandatory rules enforced for deviations (comment/evidence) and critical failures (owner/due/containment)
  - Auto-generation of finding/risk cards from deviations
  - 5x5-style risk scoring logic (`Severity × Likelihood`) and risk banding
  - Separate weighted compliance scoring from risk scoring
  - Corrective action tracking with statuses and history
  - Summary dashboard with risk distribution, category/area views, and action status
  - Checklist library/template preview
  - JSON exports for assessment/findings/actions and print-friendly summary
- Placeholder module pages for:
  - HSSEQ Program & KPI
  - Incident & Hazard Reporting

## Data Model Alignment (Front-End)
The implementation mirrors future enterprise entities in front-end objects and storage patterns:
- Facility
- FacilityModule
- Question
- TemplateVersion
- Assessment
- AssessmentResponse
- Finding
- CorrectiveAction
- Attachment (placeholder fields)
- Notification (future state)
- AuditLog

## localStorage Usage
- `goilAuth`: authentication state
- `goilUser`: logged-in user and role
- `goilAssessmentDrafts`: draft assessments keyed by assessment ID
- `goilSubmittedAssessments`: submitted assessments
- `goilFindings`: persisted findings across assessments
- `goilActions`: persisted actions across assessments
- `goilAuditLog`: front-end audit trail events
- `goilDashboardCache`: latest summary cache

## Future Enhancements (Prepared, Not Fully Implemented)
- Approval workflow and role-gated submission lifecycle
- Notifications and escalation engine
- Recurrence detection across historical assessments
- Enhanced analytics suite and zone comparisons
- Template publishing/version workflow UI
- Attachment upload, geotagging, and sync queue
- SSO and external integrations (CMMS/ERP/BI)

## Next Recommended Build Phases
1. Add approval queues and reviewer decision workflow.
2. Introduce recurrence/chronic/systemic issue detection using historical stable IDs.
3. Add notifications for due assessments and overdue critical/high actions.
4. Add backend API layer and replace localStorage with service persistence.
5. Expand KPI and Incident modules from placeholders to full capability.

## Assumptions
- This build is a front-end MVP and intentionally uses localStorage for offline-style draft persistence.
- Evidence capture is represented by structured placeholders (notes/fields) pending backend file handling.
- Role-based behavior is simulated and can be expanded into permission-based UI controls.

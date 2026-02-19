# Intake Governance Review & Prioritization Implementation Plan (Updated)

## 1) Current Intake Process Review (as implemented)

Current intake behavior is an operational workflow:

1. Submissions are created from intake forms and stored as intake submissions.
2. Intake managers review requests by operational status (`pending`, `awaiting-response`, `approved`, `rejected`).
3. Discussion happens in submission conversation threads (requester/admin messages).
4. Final disposition is operational:
   - Reject, or
   - Convert submission to project (approval).

### Evidence from current code

- Intake forms/submissions endpoints exist in `server/routes/intake.js`.
- Request list UI and status tabs exist in `src/components/Intake/IntakeRequestsList.jsx`.
- Conversion to project sets submission `status = approved` and `convertedProjectId` in `src/context/DataContext.jsx`.
- Auth user identity and role sync are based on Entra/Azure AD token roles, persisted in `Users.roles` in `server/index.js`.

## 2) Gap Analysis for Governance-Based Prioritization

To support a governance voting table, these are missing today:

- First-class governance stage distinct from operational workflow status.
- Structured criteria-based scoring model.
- Multi-member voting records (who, what, when, rationale).
- Ranked governance queue across eligible submissions.
- Governance decision outcomes beyond binary conversion.
- Scope control for "only selected initiatives go through governance."
- Optionality so governance can be enabled/disabled without breaking current intake flow.

## 3) Target Process (Two-Layer with Optional Governance Gate)

1. Submission enters operational intake queue (`pending`).
2. Intake manager triages for completeness.
3. System evaluates governance applicability:
   - If governance does not apply, continue current flow unchanged.
   - If governance applies, move to `governance-review`.
4. Governance members vote using weighted criteria.
5. System computes score and rank.
6. Governance decision recorded:
   - `approved-now`
   - `approved-backlog`
   - `needs-info`
   - `rejected`
7. `approved-now` can be converted to a project with full traceability.

## 4) How Governance/Voting Members Are Identified

### 4.1 Identity source (recommended, aligned with current app)

- Keep authentication identity from `req.user` (JWT via Entra/Azure AD).
- Keep roles from `jwt_payload.roles` with DB fallback (`Users.roles`) as currently implemented.

### 4.2 Membership model (recommended)

Use two checks, both required for voting:

1. Permission eligibility:
   - User must have governance voting permission via role/permission mapping.
2. Active board membership:
   - User must be explicitly assigned to an active governance board/committee.

This prevents "all users with a broad role" from voting unintentionally.

### 4.3 New roles/permissions

Add permissions to `RolePermissions` (role names can be adapted to your naming):

- `can_view_governance_queue`
- `can_vote_governance`
- `can_decide_governance`
- `can_manage_governance`

Optional governance roles:

- `GovernanceMember`
- `GovernanceChair`
- `GovernanceAdmin`

### 4.4 Membership tables

Add:

- `GovernanceBoard`
  - `id`, `name`, `isActive`, `createdAt`
- `GovernanceMembership`
  - `id`, `boardId`, `userOid`, `role` (`member` or `chair`), `isActive`, `effectiveFrom`, `effectiveTo`
- `GovernanceReviewParticipant` (snapshot at review start)
  - `id`, `reviewId`, `userOid`, `participantRole`, `isEligibleVoter`

Snapshotting participants prevents membership edits from altering historical quorum/vote context.

### 4.5 How the `Users` table is used

Use the existing `Users` table as the local identity profile and role cache for governance access control:

1. Provisioning and identity key:
   - On first authenticated request, user is auto-provisioned with `oid`, `tid`, `name`, `email`, `roles`.
   - `oid` is the durable identity key and should be used for governance membership/votes.
2. Role source and synchronization:
   - Primary role source remains JWT token roles.
   - DB `Users.roles` remains fallback/local cache when token roles are missing.
3. Governance membership linkage:
   - Store governance membership with `userOid` that maps to `Users.oid`.
   - Do not rely only on email for joins; email can change.
4. Vote and decision attribution:
   - Store voter identity as `voterUserOid` plus optional snapshot fields (`voterNameSnapshot`, `voterEmailSnapshot`) for immutable audit history.

## 5) Selective Scope: Only Selected Work Goes Through Governance

Governance should be selective and optional at three levels:

1. Global toggle:
   - `governanceEnabled` (default `false`).
2. Intake form policy:
   - `governanceMode` per form: `off`, `optional`, `required`.
3. Submission-level override at triage:
   - Intake manager can set `governanceRequired = true/false` with reason (audited).

### Recommended rule

- Governance applies only if:
  - Global toggle is on, and
  - Form policy is `required` or manager explicitly opts in from `optional`.

This keeps governance out of small/standard requests and avoids forcing all projects through the process.

## 6) Prioritization Model (Recommended)

Criteria (example):

- Strategic alignment (30)
- Patient/operational impact (25)
- Regulatory/safety urgency (20)
- Delivery feasibility/capacity fit (15)
- Cost efficiency (10)

Voting:

- Each eligible voter scores 1 to 5 per criterion.
- `criterion_avg = AVG(voter_scores_for_criterion)`
- `weighted_total = SUM(criterion_avg * criterion_weight)`
- Normalize to 100-point scale.

Tie-breakers:

1. Higher regulatory/safety urgency
2. Lower delivery effort
3. Earlier submission date

### 6.1 Editable criteria configuration (required)

Criteria must be admin-configurable and changeable over time without changing historical outcomes.

Required behavior:

- Admins can create/edit/reorder/enable-disable criteria and weights.
- Criteria are board-scoped (different governance boards may have different models).
- Criteria updates are versioned (draft -> published).
- Each governance review stores a criteria snapshot/version reference at review start.
- Scores for a review always use that snapshot, not the latest criteria config.

Recommended constraints:

- Enforce total active weight = 100 at publish time.
- Prevent deletion of criteria versions used by completed reviews (allow retire instead).
- Log all criteria config changes in audit.

## 7) Updated Implementation Plan

### 7.0 Execution Status (Started February 19, 2026)

Phase 0 backend foundation has been started in code with:

- Governance schema migration script and schema updates.
- Governance APIs for settings, boards, members, criteria versioning, and queue.
- Intake governance apply/skip controls and governance fields on submissions.
- Backward-compatible intake fallback when governance schema is not installed yet.

Phase 1 backend foundation has been started in code with:

- Governance review rounds (`start`), participant snapshots, vote upsert, and decision endpoints.
- Score calculation and cached `priorityScore` updates from submitted votes.
- Phase 1 DB migration script execution completed on February 19, 2026.

## Phase 0 - Optionality and Scope Controls (first)

### Data model changes

- Extend `IntakeForms`:
  - `governanceMode` (`off` | `optional` | `required`, default `off`)
  - `governanceBoardId` (nullable)
- Extend `IntakeSubmissions`:
  - `governanceRequired` (bit, default `0`)
  - `governanceStatus` (`not-started`, `in-review`, `decided`, `skipped`)
  - `governanceDecision` (nullable)
  - `governanceReason` (nullable)
  - `priorityScore` (nullable cached score)
- Add global setting (table or existing config mechanism):
  - `governanceEnabled` (default `false`)

### Behavior

- If governance is disabled or not required for submission, current intake flow remains unchanged.

## Phase 1 - Governance Data + API Foundation

### New entities

- `GovernanceBoard`
- `GovernanceMembership`
- `GovernanceReview`
  - `id`, `submissionId`, `boardId`, `reviewRound`, `status`, `decision`, `decisionReason`, `criteriaVersionId`, `criteriaSnapshotJson`, `decidedAt`
- `GovernanceReviewParticipant`
- `GovernanceCriteriaVersion`
  - `id`, `boardId`, `versionNo`, `status` (`draft`, `published`, `retired`), `criteriaJson`, `publishedAt`, `publishedByOid`
- `GovernanceVote`
  - `id`, `reviewId`, `voterUserOid`, `scoresJson`, `comment`, `conflictDeclared`, `submittedAt`

### API endpoints (example)

- `GET /api/governance/settings`
- `PUT /api/governance/settings`
- `GET /api/governance/boards`
- `POST /api/governance/boards/:id/members`
- `GET /api/governance/boards/:id/criteria/versions`
- `POST /api/governance/boards/:id/criteria/versions`
- `PUT /api/governance/boards/:id/criteria/versions/:versionId`
- `POST /api/governance/boards/:id/criteria/versions/:versionId/publish`
- `POST /api/intake/submissions/:id/governance/apply`
- `POST /api/intake/submissions/:id/governance/skip`
- `POST /api/intake/submissions/:id/governance/start`
- `GET /api/intake/submissions/:id/governance`
- `POST /api/intake/submissions/:id/governance/votes`
- `POST /api/intake/submissions/:id/governance/decide`
- `GET /api/intake/governance-queue`

## Phase 2 - UI (MVP)

1. Governance settings/admin screen:
   - Global toggle, form governance mode, board/member management.
2. Criteria configuration screen:
   - Draft criteria editor (name, weight, sort order, enabled).
   - Validation (weights total 100) and publish action.
   - Version history and active version indicator.
3. Intake manager triage updates:
   - "Requires governance" control for optional forms.
4. Governance queue:
   - Submission, submitter, form, score, vote count, decision state.
5. Governance drawer/modal:
   - Intake summary, criteria scoring, comments, vote history, decision panel.
6. Decision summary:
   - Final score, rationale, participation, decision audit.

## Phase 3 - Rules, Controls, Audit

- Quorum based on participant snapshot (for example, min 60% or min N voters).
- Only `can_vote_governance` can vote; only `can_decide_governance` can finalize.
- Voting windows and deadline handling.
- Conflict-of-interest declaration on vote (optional but recommended).
- Audit logs for:
  - scope overrides,
  - vote create/update,
  - decision events,
  - settings/criteria changes.
- Criteria version + snapshot persistence so future config changes do not rewrite past outcomes.

## Phase 4 - Rollout Strategy

1. Keep `governanceEnabled = false` initially (no workflow change).
2. Enable for one or two intake forms (`governanceMode = optional`) and pilot.
3. Measure cycle time, quorum completion, conversion rates, user feedback.
4. Expand to selected form categories only.
5. Move specific forms to `required` if policy requires it.

## 8) Acceptance Criteria (for your stated needs)

- Governance members are clearly identifiable by auth identity + permission + active board membership.
- Only selected intake/project paths enter governance based on explicit configuration.
- Governance remains optional and can be turned off globally without breaking existing intake operations.
- Prioritization criteria are editable/configurable through admin UI with versioned publishing.
- Historical governance outcomes remain stable after criteria changes.
- Audit trail captures who opted in/out, who voted, and final decision history.

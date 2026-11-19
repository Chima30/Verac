# Grant intelligence

Verac helps a grant manager investigate applications, compare them fairly, ask for missing information, and follow funded
projects to the last milestone. **Agents research and draft. People decide. The treasury enforces the money rules.**
The audit this was built from is in [GRANTS_AUDIT.md](GRANTS_AUDIT.md).

## Status, honestly

| Area | Status |
|---|---|
| Rounds, versioned rubrics, structured applications, drafts, versions, amendments | Implemented; database rules tested (migration 0019) |
| Evidence from GitHub, QoreChain and project websites | Implemented; tested with mocks and **run live** against GitHub, Diana and a refused internal address |
| Multi-agent investigation, rubric scores, reports, risk flags, clarification drafts | Implemented; rules unit-tested; **run live with Gemini** on the sample programme (`deployments/grants-sample-dryrun.json`) |
| Review workbench: decisions, conflicts of interest, overrides, comparison, allocation scenarios | Implemented; database rules tested (migration 0020) |
| Milestone evidence, agent checks, approval, funding records, release on chain confirmation | Implemented; database rules tested (migration 0021) |
| Paying a grant milestone on chain | **Only when TreasuryVault V2's real limits allow it** (recipient approved by two administrators, within the agent's per-payment cap). Larger milestones are recorded as **awaiting an authorised funding path**, with the reasons. No existing contract path funds thousands of QOR without weakening a limit, and milestones are never split to fit one. |
| Portfolio figures, alerts, weekly repository monitor, reviewer disagreement, previous grants, decision receipts | Implemented; logic unit-tested |
| Signed-in browser tests (`apps/web/e2e/grants.spec.ts`) | Written, **not run**: they need a dedicated test Supabase project with test accounts |
| Confidential documents with QoreSeal for grants | Not wired for grants yet (procurement evidence uses it). Applications are plain text; the form says so. |

## How an investigation works

One instruction in **Grants → round → Investigate with agents** starts an `agent_tasks` row of kind `grant_review`. It
advances one unit of work per call, with a worker lease, so it survives refreshes and crashed workers and never writes
twice:

1. **Grant Coordinator** plans: which submitted applications, which rubric version.
2. **Project Research Agent** (one application per step) reads public evidence only:
   * GitHub REST API: repository, languages, recent commits, contributors, pull requests, releases, CI and test indicators,
     README (as untrusted text). Nothing is cloned or executed. Stars and followers are not collected.
   * QoreChain Diana: contract code at the given addresses, receipts of the given transactions.
   * Project websites through a guarded fetcher: https only, every resolved address checked at connect time (no internal,
     loopback, link-local or metadata addresses), at most 3 redirects, 8 seconds, 256 KB, text only.
3. **Specialists** (one application per step), exchanging signed, replay-protected messages with the coordinator:
   * **Grant Review Agent**: eligibility (category, budget, per-application maximum) and missing information.
   * **Treasury / Budget Agent**: budget lines against the request, unexplained or dominant lines (rules).
   * **Milestone Agent**: deliverables that can be verified, verification methods, dates, concentration (rules).
   * **Technical Evaluation Agent**: what the evidence shows; a missing repository is not a negative finding.
   * **Grant Risk Agent**: similar submissions (5-word shingles; the later submission gets the flag), shared repositories
     or payout addresses, changed payout addresses, contradicted claims, forks, text aimed at an AI. A flag is not proof.
   * **Gemini** scores the judgement criteria only (relevance, technical or approach, feasibility, impact, capability) and
     must cite evidence ids or application sections; an uncited score is discarded as "missing", never counted as zero.
     Budget and milestone criteria are scored by rules. Without Gemini, those criteria are "not assessed" and a reviewer
     scores them.
4. **Coordinator** assembles the package: recommendation category per application (`strong_candidate`,
   `needs_clarification`, `further_review`, decided by rules), conflicting conclusions, and one possible allocation within
   the unawarded budget. Nothing is awarded, rejected or paid.

Every evidence item carries a source URL, a retrieval time and one of **VERIFIED, PARTIALLY_VERIFIED, UNVERIFIED,
CONTRADICTED, UNAVAILABLE** with a reason. Reports keep applicant claims, observed facts, AI assessments, rule results and
human decisions apart, and are append-only.

## Who can do what

| Action | Who | Enforced in |
|---|---|---|
| Open a round, edit the rubric (until locked) | Owner, administrator | `create_grant_round`, `set_grant_rubric` |
| Draft, submit, amend (only when a reviewer opens it) | The applicant | `save_grant_application`, `submit_grant_application` |
| Run an investigation | Owner, administrator | `start_grant_workflow`; the server claims it |
| Dismiss or confirm a flag | Administrator, security reviewer, with a reason | `decide_grant_flag` |
| Send a clarification (after editing the AI draft) | Owner, administrator | `send_grant_clarification` |
| Answer it | The applicant | `answer_grant_clarification` |
| Recommend or reject; override a score | Administrator without a declared conflict, with a reason | `decide_application`, `override_grant_score` |
| Award | A **different** administrator, without a conflict; the round budget is checked in the same transaction | `award_application` |
| Approve a milestone | Administrator without a conflict, with a reason | `decide_grant_milestone` |
| Request payment | Finance roles; the server checks the vault's limits | `requestMilestoneFunding`, `record_grant_funding` |
| Mark a milestone released | Nobody: a trigger does it when the linked payment is CONFIRMED on chain | `grant_follow_payment` |

## Turning it on

1. Apply `supabase/migrations/0019_grants_portal.sql`, `0020_grant_reviews.sql`, `0021_grant_milestones.sql`, in order.
2. Optional: set `GITHUB_TOKEN` (server-side, read-only public scope) for 5,000 GitHub requests per hour instead of 60.
   It never reaches the browser or Gemini.
3. Optional: call `GET /api/cron/grants-monitor` with `Authorization: Bearer $CRON_SECRET` daily, to resume unattended
   investigations and re-read funded projects' repository activity weekly.
4. For on-chain milestone payments, TreasuryVault V2 must be configured (docs/DEPLOYMENT.md) and the recipient approved on
   it by two administrators.

## Demo

**Grants → Load the sample programme** creates "SAMPLE Web3 Developer Grants" (20,000 QOR) with three fictional
applications. Then open the round and choose **Investigate with agents**. The live dry run of the same code gave:

| Application | Outcome | Why |
|---|---|---|
| Alpha (4,000 QOR) | Strong candidate, 92/100 | Repository, activity and CI verified on GitHub; explained budget; verifiable milestones |
| Beta (7,000 QOR) | Needs clarification | One-line budget ("Development"); a milestone that says "Complete the protocol."; no technical evidence (not scored, not zeroed) |
| Gamma (3,000 QOR) | Further review | Highly similar to the earlier Alpha, same repository, and a claimed contract with no code on Diana. Flagged, not rejected. |

Alpha links Verac's own public repository so its evidence is real; the report also says a link does not prove ownership.

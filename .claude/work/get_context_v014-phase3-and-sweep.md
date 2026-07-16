# get-context — v0.14 phase-3 dispatch + quality sweep + release prep (manager resuming post-compact)

## Role: manager

Orchestrating (research → dispatch → gate → merge), not building. Sequenced solo (not several
concurrent managers), so `director` docs are not returned — reassess if a second concurrent lane
opens.

`role_docs_in_portal`: none. MEMORY.md/CLAUDE.md route to these docs but never inline their bodies
— nothing here is already force-fed to this session; read all five.

```json
{
  "role": "manager",
  "role_docs": [
    "craft/workflow/research_and_plan_procedure",
    "orchestration/worker_usage_principles",
    "orchestration/multi_agent_principles",
    "orchestration/agent_coordination_protocol",
    "craft/prompt_engineering/agent_prompt_protocol"
  ],
  "role_docs_in_portal": [],
  "required": [
    "orchestration/iterative_teammate_protocol",
    "craft/workflow/teammate_execution_protocol",
    "craft/workflow/git_protocol",
    "orchestration/fix_campaign_manager_protocol",
    "craft/workflow/contract_first_procedure"
  ],
  "optional": [
    "orchestration/parallel_agent_manager_protocol",
    "craft/workflow/issue_driven/issue_driven_development_protocol",
    "orchestration/feature_build_manager_protocol"
  ],
  "trajectory_correction": [
    "The sibling repo has NO harness at all — verified: /home/shane/workspace/prompt-compose has no .claude/, no CLAUDE.md, no project_profile.yaml, and ai-first-docs is not mounted there. The usual dispatch-hygiene default ('brief the worker to run its own get-context, don't pre-feed docs' — orchestration/worker_usage_principles) does not hold as-is for this dispatch: the teammate has no local catalog to query. Decide explicitly and say so in the brief — either point the teammate at ccdeck's ai-first-docs via an absolute --docs-root, or hand-carry the specific excerpts (worktree-per-teammate isolation, append-only commit contract, gate-as-dialogue) directly. Silence here means the teammate improvises the gated-build shape from scratch.",
    "Docs-first is under-scoped in step (d): the title rename ('Prompt Compose — …') is ALREADY DONE and committed (prompt-compose@5f31d23, 'docs: rename contract titles to Prompt Compose') — re-doing it duplicates work. The real docs-first gap is the CONTENT: project_docs/prompts-ux.md in that repo currently describes the chip model in ~20 places (S5 'A chip is a chip', the insert/edit/delete-chip flows, atom-in-a-textarea framing) and project_docs/prompts-design.md has a whole '## The compose model — why chips are atoms' section — none of that is updated by a title rename. Phase 3(a) deletes the chip machinery entirely and 3(b) adds a similarity floor that has zero mentions in either doc today. contract_first_procedure requires authoring/correcting the owning doc AS PART OF the behavioral change, not after — fold real content edits to both contracts into the teammate's scope (or a same-wave doc-maintainer follow-up before merge), not just the already-done title pass.",
    "Verify-after is named only as CI ('confirm GitHub Actions CI ran green') — that's a post-hoc/remote check, not the pre-commit gate. prompt-compose is a Tauri v2 + SvelteKit sibling of ccdeck; confirm it has its own equivalent of `check_cmd` (svelte-check + cargo test, or whatever its package.json/CI workflow actually runs) and require the teammate to run that suite locally before each commit, not only lean on the CI run after push.",
    "Commit-discipline / push-policy tension: standing project rule is 'commit freely, push only when asked' (CLAUDE.md), but step (e) needs a push to exist before CI can go green on it. Resolve this explicitly in the brief (e.g. 'push is pre-authorized for this dispatch, on the worktree branch only') rather than leaving the teammate to guess whether pushing this repo is in-scope.",
    "The known worktree-fork quirk (Agent-tool worktrees fork from the default branch, not a checked-out feature branch) is lower-risk here than usual — prompt-compose only has `main` locally, clean and matching origin/main, so forking from default is actually correct base this time — but the brief should still state the expected base commit explicitly per the standing mitigation, since the quirk has recurred twice before and costs nothing to name.",
    "No issue-disposition line for phase 3: if the teammate hits a defect outside the phase-3 slice while ripping out chip machinery (plausible — it's deeply threaded through both docs and, presumably, the component tree), the brief should say fix-now-if-small / file-it / escalate rather than leaving 'stay in scope' implicit.",
    "Step 2's fix-campaign sweep and step 3's docs-sync + release aren't gated on step 1's merge-and-verify in the plan as written — confirm each phase is a hard prerequisite for the next (their memory note only says 'after phase 3 merges: run the sweep'), and name the merge-and-verify-on-trunk checkpoint between them, matching the iterative-teammate lead-owned-integration step."
  ]
}
```

## Notes for the reader (context I have that the router doesn't)

- Drop any pick above that doesn't apply — re-dispatch get-context with a tighter simulation if the
  set feels off-target.
- `project_docs/multi_agent_bindings.md` (ccdeck's own multi-agent posture — lead-assigned
  teammates, no backlog-pulling) is a project-router pointer, not a catalog stem, so the enrichment
  util below can't preview it — already known via MEMORY.md's Project router table, re-read it
  directly rather than through this file.
- The `cut-release` skill (step 3) is a Skill, not a catalog doc — invoke it directly when you reach
  release prep; no stem needed here.
- Confirmed by direct inspection this dispatch (not catalog-derived, recorded here so it isn't
  re-derived): prompt-compose is on `main` only (local + origin, clean, in sync); its two contract
  docs already carry "Prompt Compose — …" titles (commit 5f31d23) but are still chip-model prose
  throughout (prompts-ux.md ~20 chip references incl. the whole S5 section; prompts-design.md's
  "why chips are atoms" section); no "similarity"/"threshold" text exists yet in either doc.



## doc previews

| tier | stem | path | type | description |
|-|-|-|-|-|
| required | `orchestration/iterative_teammate_protocol` | ai-first-docs/orchestration/iterative_teammate_protocol.mdx | protocol | Read when running steerable teammates through a gated build lifecycle — the lead-side operational recipe complementing the event-based paradigm, covering the investigate-approve-implement-commit-update-issue pipeline, worktree-per-teammate isolation, the append-only commit durability contract that survives a lost teammate, gate-as-dialogue steering, and lead-owned integration onto trunk |
| required | `craft/workflow/teammate_execution_protocol` | ai-first-docs/craft/workflow/teammate_execution_protocol.mdx | protocol | Read the moment you're cast as a teammate in a live team — covers standing as a persistent addressable specialist rather than a one-shot callee, why plain output never crosses without an explicit SendMessage, surfacing lane boundaries live as a duty rather than guessing, and holding an approval gate as dialogue rather than a single terminal report. |
| required | `craft/workflow/git_protocol` | ai-first-docs/craft/workflow/git_protocol.mdx | protocol | Read before committing, stashing, branching, or any git operation — covers cohesive-commit discipline and Conventional Commits format, the partial-commit trap against the pre-commit index, why not to hand-stash a slice pre-commit already isolates, destructive-op consent and safety, polyrepo root-confirmation, branch and push policy, and verifying tree state after a commit |
| required | `orchestration/fix_campaign_manager_protocol` | ai-first-docs/orchestration/fix_campaign_manager_protocol.mdx | protocol | Read when orchestrating a backlog of heterogeneous fixes (a UX-audit punch list, a found-bugs sweep) rather than N identical items or one feature — covers grouping fixes by code region, how the file-disjoint boundary and pre-commit-stash trap shape wave scheduling, wave/DAG sequencing, the adaptive scan-seeded variant where workers fix local and escalate wide to build the backlog, and the audit-major-only commit cadence. |
| required | `craft/workflow/contract_first_procedure` | ai-first-docs/craft/workflow/contract_first_procedure.mdx | procedure | Read when building a new API feature end-to-end OR fixing a behavioral/timing-contract bug — covers the parallel frontend/backend workflow, API contract, type generation, mock data, coordination points, and the protocol-doc-first sequence for behavioral contracts types can't express (author the owning doc before the code) |
| optional | `orchestration/parallel_agent_manager_protocol` | ai-first-docs/orchestration/parallel_agent_manager_protocol.mdx | protocol | Read when fanning out N independent workers of similar shape — the map-reduce trajectory under live coordination, the casting call that defaults scoped-slice sweeps to cold subagents and reserves forks for items needing the full inherited context, converging the brief live instead of freezing a task-spec file, the scope-group-cast-coordinate-aggregate cycle, manager capacity (concurrency cap vs session throughput), and the fire-and-forget scaffolding this trajectory retires |
| optional | `craft/workflow/issue_driven/issue_driven_development_protocol` | ai-first-docs/craft/workflow/issue_driven/issue_driven_development_protocol.mdx | protocol | Read when you discover a problem you won't fix immediately, or need to orient in the issue lifecycle — the map for the issue_driven neighborhood covering the ledger model (discovery, diagnosis, and resolution decoupled), the three dispositions with the bug-auto-file vs feature-escalate rule, tracker eligibility, the three lifecycle stages and their docs, the atomic single-owner claim, and the issues-vs-digest reporting split |
| optional | `orchestration/feature_build_manager_protocol` | ai-first-docs/orchestration/feature_build_manager_protocol.mdx | protocol | Read when starting a non-trivial feature build — covers the manager's eight-phase trajectory (orient, build, refactor, audit, test, verify, doc-sync, cleanup), per-phase dispatch rules, skip triggers, and completion gates |
| role | `craft/workflow/research_and_plan_procedure` | ai-first-docs/craft/workflow/research_and_plan_procedure.mdx | procedure | Read before planning any feature — alignment phase, assumption verification, and research-first protocol to avoid implementation failures |
| role | `orchestration/worker_usage_principles` | ai-first-docs/orchestration/worker_usage_principles.mdx | principles | Read when delegating work to a `` `worker` `` — covers the trunk-and-branches shape now that subagents nest natively, when to delegate vs inline, model choice, and the context-window calculus that determines whether dispatch saves context or relocates it |
| role | `orchestration/multi_agent_principles` | ai-first-docs/orchestration/multi_agent_principles.mdx | principles | Read before dispatching, forking, or coordinating any subagent — the casting question that decides fork vs steerable teammate, the society-of-minds frame where a running agent's output is signal, the essence of cold / teammate / fork agents, why nesting is native but a fork can't nest and depth caps uniformly, why a worker is a pure function so open-ended waits belong to the trunk, identity discipline against message spoofing, and the both-chairs teammate ethos |
| role | `orchestration/agent_coordination_protocol` | ai-first-docs/orchestration/agent_coordination_protocol.mdx | protocol | Read before coordinating more than one agent — casting (cold/fork/teammate/named-subagent, worktree isolation), the cooperation grammar (event families, push/pull/blackboard initiative, topology, triage, subscription tuning), live-channel delivery/lifecycle, who owns a long wait (blocking command or open-ended event) and the mandatory pre-halt status report with its one-clean-done-signal recipe, reusable patterns, and worktree/merge discipline |
| role | `craft/prompt_engineering/agent_prompt_protocol` | ai-first-docs/craft/prompt_engineering/agent_prompt_protocol.mdx | protocol | Read before writing any prompt, brief, handoff, plan, or principle aimed at another agent — voice, anti-patterns, the author-receiver contract, decision-scope rule, and pointer discipline |

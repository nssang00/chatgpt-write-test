# Cito Autonomous Development Process

## Goal

Cito development should continue from an agreed product direction without requiring the user to approve every implementation detail.

The normal loop is:

```text
goal / invariant
      |
      v
plan the smallest coherent milestone
      |
      v
implement locally
      |
      v
unit + smoke + regression + latency guards
      |
      v
sanitizers where meaningful
      |
      v
batch related repository changes into one commit
      |
      v
GitHub Actions only when independent processes/nodes/OS behavior is required
      |
      v
fix failures and repeat until green
      |
      v
update architecture/test docs
      |
      v
declare the milestone complete
```

## Default decision authority

Implementation details may be decided without asking when they preserve the architecture constitution and the existing public contract.

Examples:

- internal data structures
- indexes and caches
- bounded queue sizes used only by tests/prototypes
- file/module organization
- test design
- internal packet helpers
- event-loop bookkeeping
- CI organization
- performance optimizations that preserve semantics

## Escalate before making these changes

Ask the user only when a decision would materially change the product contract:

- normal-user public API shape or semantics
- breaking wire compatibility after a wire version is declared stable
- removing a supported OS/language target
- changing the core simplicity/demand-index/single-loop principles
- introducing a mandatory broker/agent data hop
- adopting a dependency or architecture that materially changes deployment
- choosing between product tradeoffs when neither choice dominates, such as much higher memory for substantially lower p99 latency

If one option clearly preserves the constitution better, choose it and document the reasoning instead of blocking progress.

## Definition of Done for a milestone

A milestone is complete only when:

- the intended behavior is implemented
- focused unit tests exist
- a realistic smoke path exists
- the complete accepted regression suite passes
- deterministic latency invariants still pass
- sanitizer checks pass where meaningful
- required multi-process/network/OS integration tests pass
- failure/restart/boundary cases relevant to the milestone are covered
- documentation states the contract and known deferrals
- no known correctness failure is hidden behind a TODO

Performance claims additionally require measured benchmarks; structural fast-path tests alone are not presented as production latency numbers.

## CI efficiency

Do not push every small edit independently.

Related code, tests, and docs should be accumulated and committed together after local validation whenever possible. This prevents GitHub Actions from repeatedly canceling and restarting nearly complete runs.

The Linux workflow runs one `regression` CTest pass because every accepted unit, smoke, and latency test is also labeled `regression`. Separate label commands remain useful during local development for targeted iteration, but running all four labels in CI would execute the same tests multiple times.

Documentation-only changes do not trigger the expensive Linux network workflow.

## Current product priorities

When tradeoffs are otherwise equal, prefer:

1. simple normal-user API
2. low p99 latency and predictable bounded behavior
3. demand-indexed discovery instead of broad endpoint scanning
4. direct data paths and no-interest zero-work
5. single event-loop state ownership with bounded/lazy workers
6. bounded memory/state and crash isolation
7. portability across Linux and Windows
8. advanced capabilities remaining optional and out of the normal API

These priorities are defaults. A more specific architecture document or explicit user decision overrides them.

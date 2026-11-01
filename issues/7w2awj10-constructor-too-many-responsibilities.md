---
id: 7w2awj10
opened: 2026-10-17T23:58:17.000Z
closed: 2026-10-24T16:18:10.000Z
title: The constructor has too many responsibilities
status: rejected    # open | accepted | fixed | rejected | wontfix
fixed_in: []        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title:
proposal_title:
decision_title:
---

## Problem

The constructor of `Modbus_Emulator` reads files, parses, validates, registers the global layouts (a process-level side effect), builds blocks and builds servers, in that order. The step with a side effect sits in the middle of the validation, and the validation cannot be used on its own either (e.g. pre-checking a description file in an editor).

The resulting defect: the layouts are registered in layout-data's global table before blocks and servers are validated; once a later validation fails, the construction fails, but the registration has already happened, and `register_layout` can succeed only once per process. Reproduction: a description fails because of `unit_id: 300`; after correcting it, constructing again in the same process reports `register_layout can be called only once`. Retrying is impossible in scenarios such as hot reload or a GUI.

## Proposal

Split it into three phases: "load and validate (pure functions) → build (register layouts, build blocks) → build servers". Call `register_layout` only after all validation is complete, so that a failed validation no longer uses up the registration.

## Decision

The issue does not hold (rejected):

- After changing the configuration, the process should be restarted. The new process has not registered any layouts yet, so the corrected description is constructed successfully; the registration used up in the failed process goes away with that process and has no effect. Correcting a description and constructing again within the same process is not a scenario this package supports.
- To rebuild instances without touching the layouts (e.g. changing ports or IPs), make the layouts independent of the instances: register the layouts separately and let the description only reference layout names; such a description can be constructed several times in one process (see issue#cxh7ygz3). Changing the layouts amounts to replacing the whole data state, for which restarting the process is more effective.
- The proposed "all validation before registration" is not achievable either: the block placement checks (e.g. the overlap check of issue#xrstt0sk) need the block sizes, which come from compiling the layouts. No caller needs "validation usable on its own".

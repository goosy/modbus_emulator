---
id: g57sjq24
opened: 2026-10-17T23:58:18.000Z
closed: 2026-10-24T16:18:10.000Z
title: The implicit object description entry
status: rejected    # open | accepted | fixed | rejected | wontfix
labels: []
remote:
---

## Problem

The constructor accepts descriptions in object form (also mixed with paths in one list), and the controller project depends on it, but neither the spec nor the type declarations include it, and a code comment even calls it "not public". An implicit contract is easily broken during refactoring. A relative `layouts_file` in an object is resolved against the current directory, and this rule is not stated either.

## Proposal

Make the existing behavior public in the spec (including the Chinese version) and `src/index.d.ts`, and remove the "not public" wording from the code comment:

- `source` can be a path of a description file, a description object, or a list mixing both; an object has the same structure as a description file.
- A relative `layouts_file` in an object is resolved against the current directory. When another base directory is needed, the caller passes an absolute path; or registers the layouts separately as in issue#cxh7ygz3 and writes no `layouts_file` in the object.

Tests: a list mixing paths and objects; a relative `layouts_file` in an object resolved against the current directory.

## Decision

The issue does not hold (rejected): the object form of descriptions is an internal entry intentionally kept non-public, for the controllers of projects in the same series. The design already states its purpose and the rule that a relative `layouts_file` in an object is resolved against the current directory, and the tests cover it; it is not an implicit contract easily broken during refactoring.

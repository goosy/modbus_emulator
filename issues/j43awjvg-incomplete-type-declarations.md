---
id: j43awjvg
opened: 2026-10-17T23:58:23.000Z
closed: 2026-10-24T18:29:00.000Z
title: The type declarations are incomplete
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: []
remote:
---

## Problem

- `layouts` and `blocks` should be read-only, but are assignable in the declarations;
- the `Modbus_Server` interface lacks `port`, `protocol` and `is_valid_unit_id`, which are actually in use;

## Proposal

- Mark as `readonly` all properties of `Modbus_Emulator` that are fixed at construction and should not be reassigned: `unit_map`, `handler`, `layouts`, `blocks`, `servers`, `warnings`. The contents of the containers are read-only as well: `blocks` is a `ReadonlyMap`, `layouts` a `Readonly<Record>`, and `servers` and `warnings` read-only arrays; marking only `readonly` merely prevents the property from being replaced as a whole.
- Add `port`, `protocol` and `is_valid_unit_id` to `Modbus_Server`.

The outdated comment listed here earlier (the comment of `Modbus_Server` saying es-modbus is "bundled into this package") has been corrected separately, in a commit referencing this issue.

## Decision

The issue holds; fixed as proposed: the properties of `Modbus_Emulator` fixed at construction and their contents are declared read-only, and `Modbus_Server` is completed with the properties and methods actually in use.

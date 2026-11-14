---
id: nc49cdvy
opened: 2026-10-17T23:58:19.000Z
closed: 2026-10-24T12:53:23.000Z
title: The data structure of Unit_Map
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: []
remote:
---

## Problem

- Units hang directly on the instance by numeric index (`unit_map[1]`), mixed with the `unit_ids` property, so the type declaration can only be an index signature.
- The segment arrays are in attach order, unsorted, so lookup can only scan linearly.
- `unit_ids.includes` is a linear lookup.
- The even offset constraint is checked only in `Modbus_Emulator`, so callers assembling a `Unit_Map` by hand are not protected.

## Proposal

- Use a private `Map` internally; units are no longer instance properties; `unit_ids` becomes a read-only getter.
- Provide `segments(unit_id)` (the segments sorted by `start`) and `resolve(unit_id, byte)` (binary search returning the block and the offset within it, null when unmapped); the handler looks up through `resolve`.
- `attach_unit` is responsible for validating that `start` / `offset` are even, throwing a `RangeError` otherwise, and inserts segments in `start` order. For the overlap check, see issue#xrstt0sk.
- The spec / design state the relation between a server's `unit_ids` and the unit table (see below).

**Rejected alternative**

`freeze()` to freeze the unit table, forbidding later `attach_unit`.

Reason for rejection: the unit table is data, and which units a server answers is the server's configuration; the two are unrelated, and using it would only cause trouble for other instances. The mechanisms are as follows:

- The unit table is data: which block hangs on which bytes of a unit. `attach_unit` changes only the unit table. The handler looks up the unit table live on every request, so an attached block is readable and writable immediately.
- Which units a server answers is the server's configuration. The factory passes `unit_ids` to the constructor of es-modbus's `Modbus_Server`, and es-modbus copies it into the server's own set at construction; when `unit_ids` is omitted, the factory takes the unit table's `unit_ids` at the time the server is created as the default.
- From creation on, the server's set is independent of the unit table: `attach_unit` has nothing to do with it, and units attached later are not added to the set of existing servers; to add or remove units of a server, call the server's `set_unit_ids`. When a server receives a unit number outside its set, es-modbus answers with exception code 0x0B.

## Decision

The issue holds; fixed as proposed:
- the unit table uses a private `Map` and provides `segments` / `resolve`; `attach_unit` validates evenness and inserts in order;
- the mechanism is written into the spec / design: a server's `unit_ids` is independent of the unit table from creation on, and units are added or removed with the server's `set_unit_ids`, unrelated to `attach_unit`.

---
id: 99agfr7m
opened: 2026-10-27T18:41:16.423Z
closed: 2026-10-27T22:01:36.000Z
title: The layout scope is bound to the whole package instead of to each emulator instance
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [19e9f26]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title:
proposal_title:
decision_title:
---

## Problem

Location: the module-level variables `package_scope` and `time_scope_name` and `#load` in `src/emulator.js`; spec §4 "Layout scope"; the "Construction", "Binding" and "Scope" items in the design (introduced by a60df57, kept when issue#0seqxpy5 upgraded to layout-data 0.6.0).

Currently the first emulator that obtains a scope binds the whole package to that scope until the process ends:

- A later emulator giving another scope name fails at construction with `scope X: the package uses scope Y`.
- A layout holds the names of its ldata (layout-data issue#yxhoe1w3), and the emulator never returns the block names: the same description can be constructed only once in one process, whether the construction succeeds or fails, even after the earlier emulator has been `stop()`ped.
- When the scope name is omitted, the name is built from the UTC time before binding, and the caller does not know it in advance.

The design intent should be: one emulator instance binds only one set of layouts; with several instances, each uses its own and they do not mix. This simplifies the description of layouts and the separation between emulator instances.

Impact: the caller cannot construct emulators several times in one process from descriptions with independent layouts, e.g. to emulate several device models whose layouts differ slightly.

## Proposal

Direction: the binding of the scope belongs to the instance; remove the module-level `package_scope`; the scope is chosen by the caller in code (the constructor parameter `scope`, which issue#0seqxpy5 already uses in place of the description's root key `scope`). Instances are separated by their own Ldata blocks; the reuse and conflict of layouts are left to layout-data, which judges them by fingerprint within one scope; this package keeps no table of its own.

- In the constructor `new Modbus_Emulator(descriptions, scope)`, `descriptions` is unchanged, still a compiled `Description` or a list of them; `scope` defaults to `modbus_emulator` instead of taking the bound scope or a name built from the time; the scope is `get_scope(scope) ?? create_scope(scope)`, and the descriptions are loaded by one `scope.load`: layouts with the same name and the same structure are reused; the same name with a different structure, or the same structure with a different name, is an error.
- A layout holds the names of its ldata (layout-data issue#yxhoe1w3). `stop()` returns the block names to the layouts with `delete_ldata`; a construction that fails after loading returns them too. So the same description can be constructed again in the same scope after the earlier emulator is `stop()`ped; when they must run at the same time, each instance uses a different scope name.
- Device models whose layouts differ slightly: layouts with the same name but different structures go into different scopes, with different `scope`s given by the caller; using the default scope for all of them reports an error instead of binding the wrong one.
- The caller obtains an instance's scope and layouts through its `scope` and `layouts` properties; the key order of `layouts` has no meaning.

Rejected approaches:

- A layout signature (a hash of the merged `layouts` and `item_tables` of the descriptions) plus an in-process signature table, naming the scope `s` followed by the first 8 characters of the signature when there is no `scope`: layout-data issue#qpupna3c lets only the code decide the scope, and the caller cannot get an automatically generated name; layout-data already reuses layouts by the fingerprint of each layout within a scope, so reimplementing it in this package is pointless.
- Keeping the package-level binding and only returning block names: layouts with the same name but different structures still cannot be separated by different scopes in one process, so the device-model problem is not solved.
- Adding a `close()` dedicated to returning block names, with `stop()` only stopping the servers: `stop()` is already the moment the emulator ends its service; after the block names are returned the data blocks remain usable and `start()` can serve them again, so no other method is needed.

## Decision

Accepted and implemented as proposed. The package-level binding allows a description with layouts to be constructed only once per process, contrary to the design intent that "one instance binds one set of layouts". The earlier plan of choosing the scope automatically by a layout signature is dropped, since layout-data now lets the code choose the scope (issue#qpupna3c): the scope is given by the constructor parameter, defaulting to `modbus_emulator`; layout reuse is done by layout-data within the scope; `stop()` and a construction failing after loading return the block names, so the same description can be constructed again.

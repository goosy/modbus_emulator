---
id: 0seqxpy5
opened: 2026-10-29T12:28:54.912Z
closed: 2026-10-29T12:58:36.000Z
title: Upgrade the dependency to layout-data 0.6.0 and adapt; the constructor accepts compiled descriptions
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: []
remote:
---

## Problem

Location: the dependency `layout-data: 0.5.0` in `package.json`; the constructor and `#get_scope`, `#read_blocks` in `src/emulator.js`; the re-exports in `src/index.js` and `src/index.d.ts`; spec §2, §4 "Layout scope" and §5; the "Construction" and "Scope" items in the design; the README.

layout-data 0.6.0 changes the interfaces this package uses:

- `register_layout` and `yaml_file` no longer exist. Descriptions are compiled into a `Description` by `yaml` (YAML text) or `desc_file` (a description file, together with its `imports`); the scope's `load(descriptions)` accepts one `Description` or a list of them, registers their layouts (layouts with the same fingerprint and name are reused) and builds the ldata of their `blocks`, all or nothing, returning a `Registration` (`layouts`, `ldata`). It does not read files and does not accept plain objects.
- Descriptions do not specify the scope (layout-data issue#qpupna3c): the scope is chosen only in code.
- Data block entries must give `name` and `layout`, and `layout` is a layout listed in the same description; data blocks are built by `load` and can no longer reference a layout registered in the scope but not listed in the description.
- A layout holds the names of its ldata (layout-data issue#yxhoe1w3): the same ldata name of the same layout cannot be built again until `delete_ldata`.

This package stays at 0.5.0 and cannot use these interfaces. The current constructor accepts description file paths, and objects of the same structure for the controllers, which are not public (issue#g57sjq24 ruled this an intentional internal entry). The `load` of 0.6.0 accepts only `Description`, so this object entry cannot be carried over; downstream needs a stable entry that takes descriptions directly, so as not to be left unable to work while the interfaces change.

## Proposal

This issue does only the adaptation necessary to upgrade to 0.6.0, without the fix of issue#99agfr7m (removing the package-level binding, `stop()` returning block names, the default scope `modbus_emulator`):

- Upgrade the dependency to `layout-data: 0.6.0`.
- The constructor becomes `new Modbus_Emulator(descriptions, scope)`: `descriptions` is one `Description` or a list of them, the same as the first parameter of the scope's `load`, passed to it as is; this package no longer reads description files, and accepts neither paths nor plain objects. Callers compile descriptions with the re-exported `desc_file` or `yaml`, e.g. `new Modbus_Emulator(desc_file\`plant.yaml\`, "plant")`; read, parse and description errors are produced by them and already name their source, so this package does no further handling of sources. `blocks` and `servers` are concatenated in list order; with several descriptions, the error messages of this package's own checks (`unit_id`, `start`, `offset`, `servers`) name the description with `description #N: `, the same way layout-data refers to list items.
- The formerly non-public description object entry (issue#g57sjq24) is abolished along with it: `Description` is the public description type. A call that used to pass a description object turns the object into JSON text and passes it to `yaml` (JSON is a subset of YAML 1.2) to get an equivalent `Description`: `new Modbus_Emulator(yaml(JSON.stringify(object)), scope)`. YAML text has no containing file, so relative paths in its `imports` cannot be resolved; absolute paths or `file:` URLs must be written.
- `scope` replaces the description's root key `scope`; the other rules stay unchanged: this package has one scope per process, the first emulator that obtains a scope binds this package to it, and giving another name afterwards is an error; when omitted, the bound scope is taken, and when none is bound yet, a name is built from the UTC time. When the name is not an identifier, the error of `create_scope` is collected. The `scope` root key in descriptions is no longer read.
- Layouts and data blocks: the compiled descriptions are passed to one `scope.load`, whose errors are collected; `layouts` takes `Registration.layouts`, `blocks` takes `Registration.ldata`, attached to the unit table in entry order. This package checks only its own entry keys (`unit_id`, `start`, `offset`) and `servers`; `name` and `layout` are checked by layout-data. This package's own checks come before `load`, and when they fail nothing is loaded. `name` must be written; the default name `unit_<unit_id>` is removed; descriptions without layouts that only reference layouts already in the scope are no longer possible.
- Failures after `load` (overlapping data blocks within a unit, units in `unit_ids` without data blocks) do not return the block names: consistent with the current "a description with layouts can be constructed only once per process; after an error, correct it and restart the process", the constraint now applies to the block names held by layouts instead of to the layout registration.
- Re-exported interfaces: `yaml_file` is replaced by `desc_file`; the types `Layout_Item`, `Tag_Item`, `Include_Item`, `Layout_Description`, `Registered_Layouts` are replaced by 0.6.0's `Layout_Desc`, `Block_Desc`, `Description`, `Registration`.
- Documentation: the spec (including the Chinese version) §2 for the constructor and re-exported interfaces, §4 for the scope, §5 for the file format (now the layout-data description format plus this package's root key `servers`, with no `scope`); the design (including the Chinese version) "Construction" and "Scope"; the README examples and explanations; `src/index.d.ts`. Rewrite `example/emulator.yaml` in the new format.
- Tests: rewrite the existing tests for the new constructor parameters; concatenation of a `Description` list and the error prefixes; a data block missing `name` in the description; the errors of `load` being collected; the equivalent call of an object through `yaml(JSON.stringify(...))`; no new layouts and block names in the scope when the checks fail.

Rejected approaches:

- The constructor accepting both paths and `Description`: the entry would again split into public and non-public kinds, and reading files would duplicate the layout-data division of labor that "`load` does not read files"; `desc_file` already does the reading, compiling and error messages.
- Implementing the fix of issue#99agfr7m in this issue as well: the fixes and features on dev will be replayed on top of the result of this issue, and mixing them would make the replay conflict.

## Decision

Accepted and implemented as proposed. The `load` of layout-data 0.6.0 accepts only compiled `Description`s, and the constructor accepts them directly, so downstream moves smoothly from description objects to `Description` without a period of being unable to work; only the adaptation necessary for the upgrade is done, and the fix of issue#99agfr7m is implemented separately afterwards.

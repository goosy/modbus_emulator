---
id: w12ae92b
opened: 2026-10-28T17:28:21.929Z
closed: 2026-10-29T08:44:29.000Z
title: Construction only builds the instance; descriptions are loaded by emulator.load any number of times, with all checks before scope.load
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: []
remote:
---

## Problem

`new Modbus_Emulator(descriptions, scope)` loads all descriptions at construction, and loading happens only this once. This is the shape left by the old layout-data rule "register only once per scope", which has been removed (layout-data issue#yxhoe1w3): `scope.load` can be called several times, and layouts are reused by fingerprint. As a result:

- The constructor is responsible both for building the instance and for loading descriptions; an emulator's blocks and servers can only be given all at once at construction and cannot be added afterwards;
- the checks happen during construction, when the instance has not yet been handed to the caller and no listener can be attached, so diagnostics can only go into the `warnings` array and cannot be emitted as events. Only if construction completes first and the checks happen in a later load can events be used for reporting;
- the order of construction is: take the `Description`s compiled by the caller (check that each item is a `Description`, concatenate the `blocks` and `servers` of the descriptions) → check this package's keys of servers and blocks → `scope.load` → `#attach_blocks` (`attach_unit` checks overlaps within one unit) → `#check_server_units` (units in `unit_ids` must have blocks). When the last two steps fail, `load` has already taken effect, and the constructor must call `#release_blocks` to return the block names to the layouts, otherwise the same descriptions cannot be constructed again; the new layouts registered this time stay in the scope, since layout-data cannot unregister them (the Validation paragraph of doc/design.md states this explicitly). A failed construction changes the scope.

issue#7w2awj10 rejected splitting the constructor for two reasons, neither of which holds any more:

- "The block placement checks need the block sizes, which come from compiling the layouts, so all validation before registration is not achievable": layout-data's `desc_file` compiles the layouts when reading (layout-data issue#yxhoe1w3), and `Description.layouts[name].size` is available before `load` (verified with a script);
- "Constructing again within the same process is not a scenario to support": the "register only once per process" it relies on no longer exists (issue#99agfr7m).

## Proposal

- Interface: `new Modbus_Emulator(scope = "modbus_emulator")` only obtains or creates the scope and builds the handler, without reading descriptions; `emulator.load(sources)` loads one source or a group of sources, can be called any number of times, and returns the `{ blocks, servers }` added by this call.
- Sources: each source is a `Description` (compiled by `desc_file` or `yaml`) or a description file (a path string or a `file:` URL, the same as the parameter of `desc_file`); both can be mixed in a group of sources. Files are compiled by this package with `desc_file`; their errors already name the file and are merged into the `errors` of this `load`, so read and compile failures are all or nothing too; after all sources are compiled, they are passed to `scope.load` as one list of `Description`s. Prefix of the error messages of this package's own checks: a file uses its path, a `Description` uses `description #N` (N being its position in this group of sources), with no prefix when there is only one source. A source of any other type is a violation.
- Each `load` is all or nothing for the emulator: violations are collected and thrown together (an `Error` with `errors`), and `blocks`, `unit_map`, `servers`, `layouts` and the scope all keep their state from before the call. For this, all checks precede `scope.load`:
  - each block's size is taken from its description's `Description.layouts[block.layout].size`, and the overlap check is done with `{ name, size }` on a temporary `Unit_Map`; the `unit_ids` check is also done on this table;
  - `scope.load` becomes the last step that can fail, and it is itself all or nothing; afterwards the real blocks are attached to the unit table and the servers built, steps that can no longer fail;
  - on failure `#release_blocks` is no longer called (`stop()` still uses it); the statements in doc/design.md and doc/spec.md that "after a failure the layouts stay in the scope" and "after a failure the block names are returned" are changed accordingly;
  - overlap and unit errors are reported before `scope.load` and no longer together with its errors (layout conflicts, block names already taken) in the same report, consistent with the current practice of reporting block key errors alone before `load`.
- Checks across loads, which currently hold only within one construction, are changed to cover the whole state of the emulator (the temporary table consists of the blocks of the current unit table plus the blocks of this load):
  - Block names: layout-data only guarantees that block names are unique within one layout and within one `load` call; two loads may build blocks with the same name on different layouts, while `blocks` is keyed by block name. A block name equal to that of an existing block of the emulator is a violation;
  - overlap: a new block overlapping a block already in the unit table is a violation;
  - ports: a TCP address or serial port path equal to that of an existing server is a violation;
  - `unit_ids`: the units in it must have blocks after this load.
- A server without `unit_ids` answers all units of the unit table, but `create_tcp_server` / `create_rtu_server` take a snapshot of the unit table when the server is built, so units loaded later would not be answered. After each `load`, call `set_unit_ids(unit_map.unit_ids)` on the servers without `unit_ids`, so that "all units" follows the loads.
- "`blocks` and `servers` must be non-empty lists" is changed so that each may be omitted in the descriptions of a load (a description with only blocks or only servers is normal), but one load gives at least one of them; `start()` throws when there is no server at all.
- `load` stays synchronous and only builds servers without starting them; new servers loaded while running are started by calling `start()` again, and `start()` starts only the servers not yet running: es-modbus's `start()` restarts a server already started (first dropping all connections and closing the listener or serial port, then reopening), so the emulator must record which servers are started and must not call it again on all servers.
- Diagnostics (broadcast and reserved units on a serial bus) are emitted in `load` as the event `warning` with payload `{ server, message }`, when the caller can already attach listeners; the `warnings` array is removed accordingly. For a serial server without `unit_ids`, when a later load adds units, only the added units are checked again.
- Entries are numbered after the entries of the earlier loads (`blocks[i]` and `servers[i]` are the entry's position in the emulator), so server labels stay unique within the emulator.
- `stop()` returns the block names the emulator holds; the blocks still belong to the emulator, and loading a block with the same name again still reports an error under the block name rule above. The emulator records the block names it holds, and `stop()` returns only those: a block name returned earlier may since be held by another emulator, so `load` after `stop` and then `stop` again must not delete it.
- Update doc/spec.md, doc/design.md (including zh-CN), `src/index.d.ts`, the README and the tests accordingly.

Rejected alternatives:

- Accepting only `Description` (as issue#0seqxpy5 settled for the constructor): this package wraps layout-data and other packages, and is both a final program and a library for downstream. For end users, a configuration file is the most natural form, and understanding `Description` is difficult, so `load` accepts description files directly; once `load` collects the errors of `desc_file`, reading also falls under the all or nothing of one load. `Description` is kept as well, so that business programs can generate descriptions dynamically (e.g. compiled from a `JSON` string) to call this package.
- Keeping `constructor(descriptions, scope)` and adding `load` as well: two ways of writing the same thing, and the load at construction still cannot have listeners attached first.
- Only moving the checks earlier and keeping the load at construction: the scope is no longer changed by failures, but the checks are still within construction, and diagnostics still cannot be emitted as events.
- Keeping the status quo and returning block names after a failure: a failed load still leaves layouts in the scope.
- Adding a check-only method to `Unit_Map` that does not attach: it would duplicate the overlap logic of `attach_unit`, which the temporary table can already reuse.
- Making `load` asynchronous and starting new servers automatically while running: load and start failures would be mixed, and all or nothing could not cover starting; having the caller call `start()` again is clearer.
- Not checking block names across loads and relying on layout-data's check: it does not cover blocks with the same name on different layouts, and `blocks` would be silently overwritten.

## Decision

Accepted. With construction and loading separated, the caller can attach listeners before the checks, and only then can diagnostics be emitted as events; all checks precede `scope.load`, so a failed load no longer changes the scope. es-modbus's `start()` restarts servers already started, which is written into the proposal: `start()` starts only the servers not yet running.

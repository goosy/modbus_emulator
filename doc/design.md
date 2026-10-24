# modbus_emulator Design

> Chinese edition: [design.zh-CN.md](design.zh-CN.md). Keep the two in sync.
> For the requirements, see [spec.md](spec.md). This document describes the implementation.

## 1. Source Files

| File | Responsibility |
| --- | --- |
| `src/index.js` | The public interface of the package, including the forwarded API of layout-data |
| `src/unit_map.js` | `Unit_Map` and the es-modbus server handler |
| `src/server.js` | `create_tcp_server`, `create_rtu_server` |
| `src/emulator.js` | `Modbus_Emulator`: reads the description file, builds blocks and services |
| `src/index.d.ts` | Type declarations of the public interface (hand-written) |

Dependencies:

- `layout-data` (layout registration and Ldata): a runtime dependency that stays external. The Ldata objects of the blocks reach the callers: a copy bundled here would be a second copy next to the caller's own.
  - `src/index.js` forwards the part of its API that callers use (`export ... from "layout-data"`, the types in `src/index.d.ts`), so callers import it from this package and have one copy in the process.
- `es-modbus`, `yaml`: runtime dependencies that stay external. This package is a dependency of other packages and not an application, so it does not bundle them.
  - The application that uses it bundles them once, which drops the unused `Modbus_Client` and keeps one copy of the shared code and one `prebuilds` directory of the serial port bindings (they are found next to the bundle that holds them, in the `prebuilds` directory of es-modbus when it is installed as a package).
  - `Modbus_Server` is declared in `src/index.d.ts` as the small interface that callers use, because es-modbus has no declarations.
- Bundling: `rolldown.config.js` takes its `external` list from `dependencies`, so it only joins the source files of this package.
- Versions and co-development:
  - `layout-data` is pinned to a published version.
  - To co-develop with an unpublished version of a dependency (layout-data, es-modbus), reference it temporarily through yalc (`file:.yalc/<name>`), which installs the published content like an ordinary dependency, and switch back to a version number before committing or publishing.
  - Do not use pnpm `link:`: it resolves the dependency from its own repository, so a caller ends up with two instances of the same module.

## 2. Unit_Map and the Handler

- `Unit_Map` keeps a private `Map` from unit id to the segments of the unit, so no unit is an own property of the instance. `attach_unit(unit_id, block, start, offset)` checks that `start` and `offset` are even non-negative integers, so a caller that assembles a unit map is protected like the emulator, and inserts the segment `{ block, start, offset, end: start + size - offset }` at its place by `start`. Before inserting, it checks that the segment overlaps neither neighbor: the segments of a unit are sorted and never overlap, so the neighbors are the only candidates. An overlap throws an `Error` naming both blocks, and the unit map is left unchanged. A unit can hold several Ldata.
- `resolve(unit_id, byte)` finds the last segment whose `start` is at most `byte` by binary search, and the byte is mapped when it is below the `end` of that segment. The handler looks every point up through it.
- `create_handler(unit_map)` returns the handler required by es-modbus, with snake_case method names: `get_holding_register`, `get_input_register`, `set_holding_register`, `get_coil` (used for both FC 1 and FC 2), `set_coil`, and the batch methods `get_holding_registers` / `get_input_registers` / `get_coils` / `set_holding_registers` / `set_coils`, which es-modbus calls once per FC 3 / FC 4 / FC 1 and FC 2 / FC 16 / FC 15 request instead of once per point. es-modbus uses no single-point read when the batch read exists; the single-point reads are kept for the callers of the handler. The handler is an `EventEmitter` (`Object.assign(new EventEmitter(), methods)`).
- Register `addr` maps to byte `addr * 2`, read with `read_bytes` of Ldata in big-endian. Coil `addr` maps to bit `addr % 8` of byte `addr >> 3`.
- Writes go through `write_bytes` / `write_bit` of Ldata, which detects the change after each write. The bytes of a Ldata are not reachable otherwise.
- FC 6 / FC 5 call the single-point writes: a register write is one `write_bytes` of two bytes, taken from a shared two-byte array, which `write_bytes` copies at once.
- An unmapped address reads as 0 / false and a write is ignored. It is emitted as `unmapped` once per (type, unit, address), to avoid flooding the listeners when polling. The reported addresses are kept in a set of at most 1024 entries (`MAX_UNMAPPED_REPORTS`): a master that scans the whole address space would otherwise grow it to 65536 x 3 x 256 entries. When the set is full, `unmapped_limit` is emitted once, and later addresses are neither emitted nor recorded.
- Requests are validated by es-modbus first. When the handler throws, exception 0x04 is answered and es-modbus emits `handler_error` on the server.
- A batch write splits the request into runs: consecutive points held by one block at consecutive offsets; an unmapped point is reported and skipped. The blocks reached are written in nested `transaction`s, the block of the highest address outermost, so the inner ones commit first and the events follow the addresses. Inside the innermost one, a register run is one `write_bytes`, and the coils are written with `write_bit`, one call per byte and value (the bits set and the bits cleared), so `access` names only the Bools written. A block reached twice joins one transaction.
- A batch read splits the request the same way and reads in the same nested transactions: a register run is one `read_bytes`, a coil one `read_bit`, so `access` names only the Bools read; an unmapped point reads as 0 / false. Each transaction gathers the `access` of its block and emits it once at its commit.
- When a write throws, every transaction rolls back and the error reaches es-modbus (0x04). `transaction` rethrows the first error thrown by a listener at its commit; the handler catches it once all the writes are done, emits it as `listener_error` with `{ block, error }`, and the other blocks still commit, so the master gets a normal response.

## 3. Services

- `create_tcp_server(host, port, unit_map, { rtu, unit_ids, handler })`: creates a `Modbus_Server` with the handler. `unit_id` comes from the `unit_ids` option, which defaults to `unit_map.unit_ids`. es-modbus copies it into a set at construction, so the list of a server is independent of the unit map from its creation: the default is the units of the map at that time, `attach_unit` never changes it, and only `set_unit_ids` of the server does. The unit map and the units a server answers are kept apart on purpose: the first is data, the second the configuration of the server. `rtu` is passed to the option of the same name in es-modbus. The `handler` option is built with `create_handler` when omitted.
- `Modbus_Emulator` builds one handler (`emulator.handler`) after the unit map is built, and passes it to all its servers. The handler only looks things up in the unit map and has no other state, so sharing it makes the unmapped-address warning reported once across all the servers, not once per server. The handler depends on the unit map and keeps the set of reported addresses, so it cannot live at module level: several emulators in one process would share it by mistake.
- `create_rtu_server(path, unit_map, { baud_rate, parity, data_bits, stop_bits, unit_ids, handler })`: `unit_ids` is the same. `port` takes the serial port path, from which es-modbus selects the RTU transport. The parameters are checked at construction, but the port is opened only at `start()`, so construction needs no hardware.
- The factories add no listener to a server: its events are the ones of es-modbus, and its caller listens to them, `error` included.

## 4. Modbus_Emulator

- Construction: `source` is a path or a list of paths, and each file is parsed with `yaml`. An item may also be an object of the same structure: this is an internal entry for the controller of this family of projects, which assembles its description from its own configuration, and it is not part of the public interface (the specification and the type declarations name only the file paths); a relative `layouts_file` is then relative to the current directory. From every file the root keys `blocks`, `servers` and `layouts_file` are taken out: the `blocks` and `servers` lists are joined in the order of the files (with several files an error is prefixed by its file), a `layouts_file` is resolved against its own file, and the rest of the file (`layouts` and fragments, if any) stays a source as it is. These sources and the layout files are the sources of one `register_layout` call of `layout-data`, which registers them together (`blocks` and `servers` are never passed to it, or it would take them for fragments); with no source the emulator registers nothing and the blocks use the layouts already registered.
- Validation collects all violations and throws them at once: files that cannot be read, layout errors, blocks (unknown keys, the type of `name`, `unit_id` range, even `start` and `offset`, duplicate names, layout existence, and the overlap of the byte ranges in a unit: the error of `attach_unit`, prefixed by the block entry), and servers (unknown keys by protocol, protocol, port range, the serial settings of `rtu` with the values es-modbus accepts, a port already used by an earlier server, the format of `unit_ids`, and whether each listed unit has a block, which is checked after the blocks are read). When the layout registration fails, layout-data registers none of the layouts, so the layout existence of the blocks is not checked: every block would repeat it and bury the real error.
- One Ldata is created per block and attached to the unit map. The emulator registers the layouts of the description, if any (`register_layout` can succeed only once per process, so a description with layouts is constructed once per process, and descriptions that only name layouts registered beforehand any number of times), and a block is created from its layout name (`new Ldata(layout_name, block_name)`). One `Modbus_Server` is created per service, all sharing the same unit map.
- `start(options)` starts all services in parallel and waits with `Promise.allSettled` until each has a result, then handles the failures. It relies on these behaviors of es-modbus: the `start` / `stop` calls of a server are queued; `stop()` runs after an earlier `start` ends and never rejects; `stop()` on a server never started returns at once; `start()` on a running server stops it first. So by default a failure calls `stop()` on all services, including those that were running before the call (`start()` is a restart for them), and then throws. With `partial` the started services are left running. Both modes throw the same `AggregateError`, so a failure is never silent; they differ only in whether the other services are stopped.
- The label of a service, its place in the description (`servers[i]`, prefixed by its file when there are several) and its address (`modbus://host:port`, `rtu://host:port`, `serial://path`), is kept at construction. It names the service in the errors of `start()` and in the payload of the forwarded server events.
- `stop()` stops all services in parallel with `Promise.all`.
- Events: `Modbus_Emulator` extends `EventEmitter`. After creating a server, it subscribes to the es-modbus events of the server and re-emits each `<name>` as `server_<name>` with `{ server, label }` plus the `socket` or `error` argument; it subscribes to the events of the handler and re-emits them unchanged. Its listener of `error` keeps an error of a server from throwing, and it emits no `error` of its own, so an emulator without listeners never throws from an event.
- The diagnostics found at construction happen before a caller can attach a listener, so they are pushed to `warnings` (an array of strings) instead of being emitted.

## 5. Build and Test

- `pnpm build`: rolldown bundles `src/index.js` into `dist/modbus_emulator.js`.
- `pnpm test`: builds first, then runs `node --test`. The tests import `src`, except a smoke test of the bundle: it checks that `dist` exports what `src` exports, keeps layout-data external and serves a master. The tests use the es-modbus `Modbus_Client` as the master. The TCP servers under test listen on port 0 and the tests read the port the system picked, so no other process can take it between probing and listening. The RTU serial port is tested for construction only.
- `pnpm lint`: ESLint.

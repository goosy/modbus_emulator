# modbus_emulator Design

> Chinese edition: [design.zh-CN.md](design.zh-CN.md). Keep the two in sync.
> For the requirements, see [spec.md](spec.md). This document describes the implementation.

## 1. Source Files

| File | Responsibility |
| --- | --- |
| `src/index.js` | The public interface of the package, including the forwarded API of layout-data |
| `src/unit_map.js` | `Unit_Map` and the es-modbus server vector |
| `src/server.js` | `create_tcp_server`, `create_rtu_server`, and the logging of server events |
| `src/emulator.js` | `Modbus_Emulator`: reads the description file, builds blocks and services |
| `src/index.d.ts` | Type declarations of the public interface (hand-written) |

Dependencies: `layout-data` (layout registration and Ldata) is a runtime dependency and stays external, because the Ldata objects of the blocks reach the callers: a copy bundled here would be a second copy next to the caller's own. `src/index.js` forwards the part of its API that callers use (`export ... from "layout-data"`, the types in `src/index.d.ts`), so callers import it from this package and have one copy in the process. `es-modbus` and `yaml` are runtime dependencies too and stay external: this package is a dependency of other packages and not an application, so it does not bundle them. The application that uses it bundles them once, which drops the unused `Modbus_Client` and keeps one copy of the shared code and one `prebuilds` directory of the serial port bindings (they are found next to the bundle that holds them, in the `prebuilds` directory of es-modbus when it is installed as a package). `Modbus_Server` is declared in `src/index.d.ts` as the small interface that callers use, because es-modbus has no declarations. `rolldown.config.js` takes its `external` list from `dependencies`, so it only joins the source files of this package. `layout-data` is pinned to a published version; for local co-development it may be temporarily linked with pnpm `link:`, but switch it back to a version number before committing or publishing.

## 2. Unit_Map and the Vector

- `Unit_Map.attach_unit(unit_id, block, start, offset)` attaches a Ldata to the byte range `[start, start + size)` of a unit. A unit can hold several Ldata. `unit_ids` lists the attached unit ids.
- `create_vector(unit_map, { logger })` returns the vector required by es-modbus, with snake_case method names: `get_holding_register`, `get_input_register`, `set_register`, `get_coil` (used for both FC 1 and FC 2), `set_coil`.
- Register `addr` maps to byte `addr * 2`, read with `read_bytes` of Ldata in big-endian. Coil `addr` maps to bit `addr % 8` of byte `addr >> 3`.
- Writes go through `write_bytes` / `write_bit` of Ldata, which detects the change after each write. The bytes of a Ldata are not reachable otherwise.
- es-modbus calls the vector once per register or coil, so a register write is one `write_bytes` of two bytes (taken from a shared two-byte array, which `write_bytes` copies at once) and a register read is one `read_bytes` of two bytes.
- An unmapped address reads as 0 / false and a write is ignored. It is reported through `logger.warn` once per (type, unit, address), to avoid flooding the log when polling. The reported addresses are kept in a set of at most 1024 entries (`MAX_UNMAPPED_REPORTS`): a master that scans the whole address space would otherwise grow it to 65536 x 3 x 256 entries. When the set is full, one last warning says so and later addresses are neither reported nor recorded.
- Requests are validated by es-modbus first. When the vector throws, exception 0x04 is answered and the error is logged through the `vector_error` event.
- An FC 16 request writes several registers in a row within one synchronous call. A caller that wants merged notifications can coalesce them with `setImmediate` (covered by a test).

## 3. Services

- `create_tcp_server(host, port, unit_map, { rtu, unit_ids, logger })`: creates a `Modbus_Server` with the vector. `unit_id` comes from the `unit_ids` option, which defaults to `unit_map.unit_ids`. es-modbus copies it into a set at construction, so a unit attached later has no effect: attach the units before creating the servers. `rtu` is passed to the option of the same name in es-modbus. The `vector` option is built with `create_vector` when omitted.
- `Modbus_Emulator` builds one vector (`emulator.vector`) after the unit map is built, and passes it to all its servers. The vector only looks things up in the unit map and has no other state, so sharing it makes the unmapped-address warning reported once across all the servers, not once per server. The vector depends on the unit map and the logger, so it cannot live at module level: several emulators in one process would share it by mistake.
- `create_rtu_server(path, unit_map, { baud_rate, parity, data_bits, stop_bits, unit_ids, logger })`: `unit_ids` is the same. `port` takes the serial port path, from which es-modbus selects the RTU transport. The parameters are checked at construction, but the port is opened only at `start()`, so construction needs no hardware.
- `normalize_logger(logger)` turns the caller's logger into an object with `info` / `warn` / `error`, silent for missing methods. Both kinds of server log `start`, `stop`, and the connection and disconnection of a client at `info` (they are normal events), and `error` / `vector_error` / socket errors at `error`.

## 4. Modbus_Emulator

- Construction: `source` is a path or a list of paths, and each file is parsed with `yaml`. An item may also be an object of the same structure: this is an internal entry for the controller of this family of projects, which assembles its description from its own configuration, and it is not part of the public interface (the specification and the type declarations name only the file paths); a relative `layouts_file` is then relative to the current directory. From every file the root keys `blocks`, `servers` and `layouts_file` are taken out: the `blocks` and `servers` lists are joined in the order of the files (with several files an error is prefixed by its file), a `layouts_file` is resolved against its own file, and the rest of the file (`layouts` and fragments, if any) stays a source as it is. These sources and the layout files are the sources of one `register_layout` call of `layout-data`, which registers them together (`blocks` and `servers` are never passed to it, or it would take them for fragments); with no source the emulator registers nothing and the blocks use the layouts already registered.
- Validation collects all violations and throws them at once: files that cannot be read, layout errors, blocks (unknown keys, `unit_id` range, even `start` and `offset`, duplicate names, layout existence), and servers (unknown keys by protocol, protocol, port range, a port already used by an earlier server, the format of `unit_ids`, and whether each listed unit has a block, which is checked after the blocks are read). When the layout registration fails, layout-data registers none of the layouts, so the layout existence of the blocks is not checked: every block would repeat it and bury the real error.
- One Ldata is created per block and attached to the unit map. The emulator registers the layouts (`register_layout` can succeed only once per process, so one emulator per process), and a block is created from its layout name (`new Ldata(layout_name, block_name)`). One `Modbus_Server` is created per service, all sharing the same unit map.
- `start()` / `stop()` start / stop all services in parallel.

## 5. Build and Test

- `pnpm build`: rolldown bundles `src/index.js` into `dist/modbus_emulator.js`.
- `pnpm test`: builds first, then runs `node --test`. The tests use the es-modbus `Modbus_Client` as the master. The RTU serial port is tested for construction only.
- `pnpm lint`: ESLint.

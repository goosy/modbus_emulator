# modbus_emulator Design

> Chinese edition: [design.zh-CN.md](design.zh-CN.md). Keep the two in sync.
> For the requirements, see [spec.md](spec.md). This document describes the implementation.

## 1. Source Files

| File | Responsibility |
| --- | --- |
| `src/index.js` | The public interface of the package |
| `src/unit_map.js` | `Unit_Map` and the es-modbus server vector |
| `src/server.js` | `create_tcp_server`, `create_rtu_server`, and the logging of server events |
| `src/emulator.js` | `Modbus_Emulator`: reads the description file, builds devices and services |
| `src/index.d.ts` | Type declarations of the public interface (hand-written) |

Dependencies: `layout-data` (layout compilation and Ldata) and `es-modbus` (`Modbus_Server`). Both are runtime dependencies and stay external. `yaml` is a development dependency and is bundled into the library. They are declared as `dependencies` (not `devDependencies`) because the built library still imports them at run time and its public types reference them; `rolldown.config.js` takes its `external` list from `dependencies`. They are pinned to published versions; for local co-development they may be temporarily linked with pnpm `link:`, but switch them back to version numbers before committing or publishing.

## 2. Unit_Map and the Vector

- `Unit_Map.attach_unit(unit_id, block, start, offset)` attaches a Ldata to the byte range `[start, start + size)` of a unit. A unit can hold several Ldata. `unit_ids` lists the attached unit ids.
- `create_vector(unit_map, { logger })` returns the vector required by es-modbus, with snake_case method names: `get_holding_register`, `get_input_register`, `set_register`, `get_coil` (used for both FC 1 and FC 2), `set_coil`.
- Register `addr` maps to byte `addr * 2`, read with `read_bytes` of Ldata in big-endian. Coil `addr` maps to bit `addr % 8` of byte `addr >> 3`.
- Writes go through `write_bytes` / `write_bit` of Ldata, which detects the change after each write. The bytes of a Ldata are not reachable otherwise.
- es-modbus calls the vector once per register or coil, so a register write is one `write_bytes` of two bytes (taken from a shared two-byte array, which `write_bytes` copies at once) and a register read is one `read_bytes` of two bytes.
- An unmapped address reads as 0 / false and a write is ignored. It is reported through `logger.warn` once per (type, unit, address), to avoid flooding the log when polling.
- Requests are validated by es-modbus first. When the vector throws, exception 0x04 is answered and the error is logged through the `vector_error` event.
- An FC 16 request writes several registers in a row within one synchronous call. A caller that wants merged notifications can coalesce them with `setImmediate` (covered by a test).

## 3. Services

- `create_tcp_server(host, port, unit_map, { rtu, unit_ids, logger })`: creates a `Modbus_Server` with the vector. `unit_id` comes from the `unit_ids` option, which defaults to `unit_map.unit_ids`. es-modbus copies it into a set at construction, so a unit attached later has no effect: attach the units before creating the servers. `rtu` is passed to the option of the same name in es-modbus. The `vector` option is built with `create_vector` when omitted.
- `Modbus_Emulator` builds one vector (`emulator.vector`) after the unit map is built, and passes it to all its servers. The vector only looks things up in the unit map and has no other state, so sharing it makes the unmapped-address warning reported once across all the servers, not once per server. The vector depends on the unit map and the logger, so it cannot live at module level: several emulators in one process would share it by mistake.
- `create_rtu_server(path, unit_map, { baud_rate, parity, data_bits, stop_bits, unit_ids, logger })`: `unit_ids` is the same. `port` takes the serial port path, from which es-modbus selects the RTU transport. The parameters are checked at construction, but the port is opened only at `start()`, so construction needs no hardware.
- `normalize_logger(logger)` turns the caller's logger into an object with `info` / `warn` / `error`, silent for missing methods. Both kinds of server log `start`, `stop`, and the connection and disconnection of a client at `info` (they are normal events), and `error` / `vector_error` / socket errors at `error`.

## 4. Modbus_Emulator

- Construction: the description file is parsed with `yaml`. `source` may also be an object of the same structure: this is an internal entry for the controller of this family of projects, which assembles its description from its own configuration, and it is not part of the public interface (the specification and the type declarations name only the file path); a relative `layouts_file` is then relative to the current directory. The root keys `devices`, `servers` and `layouts_file` are taken out. The layout file (if any) and the rest (`layouts` and fragments, if any) are the sources of one `register_layout` call of `layout-data`, which registers them together; with no source the emulator registers nothing and the devices use the layouts already registered.
- Validation collects all violations and throws them at once: layout errors, devices (`unit_id` range, layout existence, even `start`, duplicate names), and servers (protocol, port, the format of `unit_ids`, and whether each listed unit has a device, which is checked after the devices are read).
- One Ldata is created per device and attached to the unit map. The emulator registers the layouts (`register_layout` can succeed only once per process, so one emulator per process), and a device is created from its layout name (`new Ldata(layout_name, device_name)`). One `Modbus_Server` is created per service, all sharing the same unit map.
- `start()` / `stop()` start / stop all services in parallel.

## 5. Build and Test

- `pnpm build`: rolldown bundles `src/index.js` into `dist/modbus_emulator.js`.
- `pnpm test`: builds first, then runs `node --test`. The tests use the es-modbus `Modbus_Client` as the master. The RTU serial port is tested for construction only.
- `pnpm lint`: ESLint.

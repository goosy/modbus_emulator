# modbus_emulator Specification

> Chinese edition: [spec.zh-CN.md](spec.zh-CN.md). Keep the two in sync.

## 1. Goals and Scope

modbus_emulator is a Modbus device emulator library. It provides Modbus slave services to the outside, and exposes the data through the Ldata / Ltag API of [layout-data](https://github.com/goosy/layout-data/blob/main/doc/spec-data-api.md), so that callers can apply extra computation to emulate the running of a device.

- Slave transports: Modbus TCP, RTU over TCP, RTU (serial port).
- One emulator can provide several services at the same time, sharing the same set of data blocks.
- It is published as a library. A controller or similar program can use its server part to publish its own data blocks to a host (HMI/SCADA).

Out of scope: the Modbus master (client), the business logic of a device (implemented by the caller through Ldata), and the output of diagnostics (the package emits events, and the caller decides what to do with them).

## 2. Terms

| Term | Meaning |
| --- | --- |
| Block | A named data block (Ldata), laid out in bytes and attached to a byte offset of a unit |
| Unit | A slave address identified by a unit id, which usually stands for one device or a group of process values. A unit can hold several blocks, each in a different byte range |
| Unit map (`Unit_Map`) | The mapping from unit ids to blocks and their byte ranges |

## 3. Address Mapping

- Layouts and data blocks are static. The description file is read once at construction. After the blocks (Ldata) and the unit map are built, none is added or removed and no layout changes. A running service cares only about the values, and does not handle changes of the data blocks.

- Register `addr` corresponds to byte `addr * 2` of the unit. The content of the block is read and written in big-endian.
- Coil `addr` corresponds to bit `addr % 8` of byte `addr >> 3`.
- Holding registers and input registers have the same content. Registers and coils are readable and writable.
- Writes go through the write methods of Ldata, so the `change` and `write` events of the block fire as usual.
- An FC 16 / FC 15 request is atomic: each block it reaches is written once, emitting one `write` and one `access` of kind `write`; when a write fails midway, every block reached is restored and the master gets exception 0x04. FC 6 / FC 5 write one point. This is done by the handler, so a server assembled with `create_handler` behaves the same.
- A read request emits one `access` of kind `read` per block it reaches, naming only the tags read; for coils, only the Bools of the bits read.
- An error thrown by a listener of a block (`change`, `write`, `access`) when a request is committed neither undoes its writes nor affects the other blocks: the master gets a normal response, and the handler emits `listener_error` with `{ block, error }`.
- An address in a unit with no block reads as 0 / false, and a write to it is ignored. No exception is returned, so a read across a gap still succeeds. The handler emits `unmapped` once per (type, unit, address), for at most 1024 addresses; after that, it emits `unmapped_limit` once and no further `unmapped` (see Events).
- A unit id that a service does not answer is answered with exception code 0x0B by es-modbus over `tcp`, and not answered at all on a serial bus (`rtu`, `rtu_over_tcp`). An illegal function code, an illegal quantity, or an address out of range is answered with 0x01 / 0x03 / 0x02.
- On a serial bus (`rtu`, `rtu_over_tcp`), unit 0 is the broadcast address: es-modbus executes the writes to it and never answers, so the blocks of unit 0 cannot be read through such a service. Units 248 to 255 are reserved on a serial bus. A service of these protocols that answers unit 0 or a unit from 248 to 255 gives a warning in `warnings` of the emulator; it is not an error.

## 4. Interface

- `Modbus_Emulator(source)`: the main constructor. `source` is the path of a description file (section 5), or a list of paths: the files are read together as one description. It builds the blocks and the services.
  - `blocks`: a map from block names to Ldata. `block(name)` gets one block. `unit_map`: the unit map. `servers`: the server instances, an array whose item `i` is the service entry `i` of the description (the files joined in order); the `name` of each server is its label, its place and address in the description such as `servers[1] (modbus://0.0.0.0:503)`, so a server can be found by name (`servers.find((server) => server.name === ...)`). `layouts`: the registered layouts by name (read-only). `handler`: the handler shared by all the servers. `warnings`: the diagnostics found at construction, as strings, kept here because no listener can be attached before the constructor returns; empty when there are none.
  - `start(options)`: starts all services. By default it is all or nothing: when any service fails to start, all services are stopped, so a resolved `start()` means that all of them run and a rejected one that none runs. With `{ partial: true }` it starts what it can, and the services that started keep running. In both modes a failure rejects with an `AggregateError` that lists every failed service: each item is an `Error` whose message starts with the `name` of the service, such as `servers[1] (modbus://0.0.0.0:503): ...`, with the original error as its `cause`.
  - `stop()`: stops all services.
  - Layout registration: `register_layout` succeeds once per process. A description that carries layouts (`layouts`, `layouts_file` or fragments) registers them at construction, so it can be constructed once per process, whether the construction succeeds or fails; after fixing a faulty description, restart the process. To run several emulators in one process, or to rebuild an emulator without changing the layouts (another port or host, for instance), register the layouts once with the forwarded `register_layout` and give descriptions without layouts that only name them: such descriptions can be constructed any number of times.
  - An invalid description file throws an `Error` whose `errors` property lists all violations. A file that cannot be read is one of them.
- `create_tcp_server(host, port, unit_map, { rtu, unit_ids, handler, name })`: creates a Modbus TCP service. `host` defaults to `0.0.0.0` and `port` to 502; `unit_map` is required. With `rtu: true` it uses RTU frames on the TCP socket (RTU over TCP). It returns the es-modbus `Modbus_Server`, not started.
- `create_rtu_server(path, unit_map, { baud_rate, parity, data_bits, stop_bits, unit_ids, handler, name })`: creates an RTU slave on a serial port. `unit_map` is required. The defaults are 9600, `none`, 8 and 1 for `baud_rate`, `parity`, `data_bits` and `stop_bits`. It returns a `Modbus_Server`, and the port is opened only at `start()`.
- `unit_ids`: optional, the unit ids a service answers. When it is omitted, the factory copies the unit ids of `unit_map` at the creation of the service. From then on the list belongs to the service and is independent of the unit map: `attach_unit` changes only the unit map and has nothing to do with the units a service answers. To add units to a service (or remove them), call `set_unit_ids` of its `Modbus_Server`. A unit id outside the list is answered with exception code 0x0B by es-modbus.
- `handler`: optional, the handler to serve (the result of `create_handler`). Servers of one unit map can share one. By default it is built from the unit map.
- `name`: optional, the `name` of the `Modbus_Server`, which identifies it in events and errors; es-modbus defaults it to `Modbus_Server`.
- `Unit_Map` / `create_handler(unit_map)`: the unit map and the es-modbus server handler, for callers that do not use a description file (such as a controller) and assemble things themselves.
  - `attach_unit(unit_id, block, start, offset)` places a block at byte `start` of a unit, from byte `offset` of the block. Both default to 0 and must be even non-negative integers, or it throws a `RangeError`. The byte ranges of the blocks of one unit may not overlap: an overlap throws an `Error` that names both blocks.
  - `unit_ids`: the units that have a block, in the order of their first attachment. `segments(unit_id)`: the byte ranges of a unit (`{ block, start, offset, end }`), sorted by `start`, empty for a unit without block. `resolve(unit_id, byte)`: the block that holds a byte of a unit and the byte offset in it (`{ block, offset }`), or null for an unmapped byte.
- `Ldata`, `Ltag`, `register_layout`, `get_layout`, `io_index_table`, `render_types` and the types of layout-data that go with them (`Layout`, `Layout_Tag`, `Layout_Item`, `Tag_Item`, `Include_Item`, `Layout_Description`, `Layout_Source`, `Registered_Layouts`, `Endian`, `Tag_Type`): the API of [layout-data](https://github.com/goosy/layout-data/blob/main/doc/spec-data-api.md) that callers use, forwarded as it is. The blocks are `Ldata` objects, so this package is the one place the callers take this API from: they do not depend on layout-data themselves, and the process has one copy of it, which `register_layout` needs (it succeeds once per process). The forwarded API follows the version of layout-data this package depends on.

### Events

The package reports its diagnostics as events and outputs nothing itself.

- The handler returned by `create_handler` is an `EventEmitter`:

  | Event | Payload | When |
  | --- | --- | --- |
  | `unmapped` | `{ kind, unit_id, addr }`, `kind` is `"holding_register"`, `"input_register"` or `"coil"` | an unmapped address is read or written; once per (kind, unit, address), for at most 1024 addresses |
  | `unmapped_limit` | `{ limit }` | the 1024th address was emitted; no further unmapped address is emitted |
  | `listener_error` | `{ block, error }` | a listener of a block (`change`, `write`, `access`) throws when a request is committed; the data stay written and the master gets a normal response |

- The servers are es-modbus `Modbus_Server`s with its events: `start`, `stop`, `socket_connect` (socket), `socket_disconnect` (socket), `socket_error` (error), `error` (error), `handler_error` (error), `receive` (the request frame), `send` (the response frame). The factories add no listener. An `EventEmitter` throws an `error` event that has no listener, so a caller that uses the factories must listen to `error` of each server.
- A handler that throws, or returns invalid values (a batch read of the wrong length, a register value out of range), is reported by es-modbus as `handler_error`, and the master gets exception 0x04.
- `Modbus_Emulator` is an `EventEmitter`. It forwards the event `<name>` of each server as `server_<name>` (`server_start`, `server_stop`, `server_socket_connect`, `server_socket_disconnect`, `server_socket_error`, `server_error`, `server_handler_error`, `server_receive`, `server_send`) with the payload `{ server }`, plus `socket`, `error` or `frame` when es-modbus passes one; `server.name` tells which service it comes from. It forwards the events of the handler with their names and payloads. It always listens to `error` of its servers and never emits `error` itself.

## 5. Description File

A YAML 1.2 file with three parts. The parts may also be spread over several files (the `source` list): the `blocks` and the `servers` of the files are joined in the order of the files, the layouts of all the files are registered together, and an error names its file.

The root keys of a file are `blocks`, `servers`, `layouts_file`, and the layouts and fragments of layout-data (`layouts` and the fragment names). `blocks` and `servers` belong to this package and are not passed to layout-data; the rest are the layout sources.

```yaml
# 1. layouts and fragments, in the format of layout-data
layouts:
  PUMP:
    - { name: id, type: UInt, offset: 0, init_value: 7 }
    - { name: pressure, type: Real, offset: 16, init_value: 1.5 }

# 2. the blocks
blocks:
  - { name: pump_1, unit_id: 1, layout: PUMP }               # unit_id: 0..255
  - { name: pump_2, unit_id: 1, layout: PUMP, start: 400 }   # start: byte offset in the unit, even

# 3. the services
servers:
  - { protocol: tcp, host: 0.0.0.0, port: 502 }
  - { protocol: rtu_over_tcp, port: 503 }
  - { protocol: rtu, port: COM3, baud_rate: 9600, parity: none }
```

- `blocks[].name` is a non-empty string, defaults to `unit_<unit_id>`, and block names must be unique. The byte ranges of the blocks of one unit may not overlap. `offset` (optional) is the start byte inside the block, even.
- `servers[].protocol` is one of `tcp`, `rtu_over_tcp`, `rtu`. For `tcp` and `rtu_over_tcp`, `host` defaults to `0.0.0.0` and `port` to 502; `port` is an integer from 0 to 65535 (0: chosen by the system). For `rtu`, `port` is the serial port path, with optional `baud_rate` (a positive integer, default 9600), `parity` (`none`, `odd` or `even`, default `none`), `data_bits` (5, 6, 7 or 8, default 8) and `stop_bits` (1, 1.5 or 2, default 1).
- Two `tcp` / `rtu_over_tcp` services may not use the same `host` and `port`, except port 0; services on different hosts may use the same port. Two `rtu` services may not use the same serial port path.
- A block entry has only the keys `name`, `unit_id`, `layout`, `start`, `offset`. A service entry has only `protocol`, `unit_ids`, and `host`, `port` for `tcp` / `rtu_over_tcp`, or `port`, `baud_rate`, `parity`, `data_bits`, `stop_bits` for `rtu`. Another key is an error. The root keys are not checked: a key other than `blocks`, `servers` and `layouts_file` is a fragment name of layout-data.
- `servers[].unit_ids` (optional) are the unit ids the service answers: a non-empty list of integers from 0 to 255, each of which must have a block. By default the service answers all units.
- The layouts may be kept out of the description, or split: the root key `layouts_file` names a layout file (relative to the file that names it); `layouts` and fragments may be given as well, and all of them are registered together (a name defined twice is an error). When neither is given, the blocks use the layouts already registered in the process.
- All services share one unit map and the same data blocks. `unit_ids` only decides which units each service answers.

## 6. Distribution

- Published as an ES module library with the entry `modbus_emulator`. It depends on `layout-data`, `es-modbus` and `yaml`, which stay external: the package is meant to be a dependency of other packages, and the application that uses it bundles them once.
- Node.js >= 20.11.

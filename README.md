# modbus-emulator

A Modbus device emulator library. It provides Modbus slave services (TCP, RTU over TCP, UDP, RTU over UDP, RTU) over structured data blocks, and exposes the data through the Ldata / Ltag API of [layout-data](https://github.com/goosy/layout-data/blob/main/doc/spec-data-api.md), so your code can compute on the data to emulate a running device.

## Features

- Slave transports: Modbus TCP, RTU over TCP, Modbus UDP, RTU over UDP, RTU (serial port).
- Several services at once, sharing the same data blocks.
- Blocks are described in YAML (a file or text in code), or assembled in code with `Unit_Map`.
- Writes from the master go through Ldata, so the `change` and `write` events fire as usual.

## Install

```sh
pnpm add modbus-emulator
```

Requires Node.js >= 20.11.

## Usage

### From a description file

```yaml
# plant.yaml
layouts: [PUMP]
item_tables:
  PUMP:
    - { name: id, type: UInt, offset: 0, init_value: 1 }
    - { name: pressure, type: Real, offset: 32, init_value: 1.5 }

blocks:
  - { name: pump_1, layout: PUMP }

units:
  - unit_id: 1
    endian: BE # the byte order of the device: BE (default), LE, BEBS or LEBS
    unmapped_read: zero # zero (default) | refuse: an unmapped address reads as 0, or the read is refused
    unmapped_write: ignore # ignore (default) | refuse: a write of an unmapped address is ignored, or refused
    blocks:
      pump_1: { start: 0, readonly: [id] } # start: the byte of the unit where the block starts; readonly: none (default) | all | tag names

servers:
  - { protocol: tcp, host: 0.0.0.0, port: 1502 }
```

```js
import { Modbus_Emulator } from "modbus-emulator";

const emulator = new Modbus_Emulator("plant"); // descriptions are loaded into the layout-data scope plant
emulator.on("warning", ({ message }) => console.warn(message));
emulator.load("plant.yaml"); // may be called again to add blocks and services
await emulator.start();

const pump = emulator.block("pump_1"); // a Ldata of layout-data
// ... apply your own computation to pump ...

await emulator.stop();
```

`load` takes description files, or `Description`s compiled in code with ``yaml`...` `` or ``desc_file`...` ``, mixed in a list as needed: an object of the shape of a description is compiled with `yaml(JSON.stringify(object))`. Invalid sources throw an `Error`; its `errors` property lists all violations, and the failed `load` changes nothing. A later `load` is checked against what the emulator already has (block names, units, ports), and `start()` starts only the services that are not running yet.

A block entry only defines a block. A unit entry stands for a device: it gives the byte order of the device and places blocks of its own description in the unit, each at most once, and every block of a description is placed by one of its units. A unit is declared by one `load`.

A block names a layout of its own description file; the description may take the item tables of another file with `imports: [common.yaml]` and list the layout under `layouts`. The descriptions are loaded into a [layout-data scope](https://github.com/goosy/layout-data/blob/main/doc/spec-layout.md), apart from the layouts of your code and of other libraries. The scope is chosen in code, by the argument of the constructor, `modbus_emulator` by default, and created when it does not exist. In a scope a layout of the same name and structure is shared, and a layout of the same name and another structure is an error: load such descriptions into another scope. The block names are held by their layouts until `stop()` gives them back, and `start()` binds them back, so another emulator can load the same description in a scope once the earlier emulator stopped, and `start()` refuses to start when another block holds a name of the emulator meanwhile.

### Without a description file

```js
import { Unit_Map, create_scope, create_tcp_server, yaml } from "modbus-emulator";

const scope = create_scope("plant");
scope.load(yaml`
layouts: [PUMP]
item_tables:
  PUMP:
    - { name: id, type: UInt, offset: 0, init_value: 1 }
    - { name: pressure, type: Real, offset: 32, init_value: 1.5 }
`);
const pump = scope.get_layout("PUMP").create_ldata("pump_1");

const unit_map = new Unit_Map();
unit_map.set_endian(1, "BE"); // the default
unit_map.attach_unit(1, pump, { start: 0, offset: 0, readonly: ["id"] });
unit_map.set_unmapped_write(1, "refuse"); // refuse writes of unmapped addresses with 0x02

const server = create_tcp_server(unit_map, { port: 1502 });
await server.start();
```

`load` takes compiled descriptions: read a description file with ``desc_file`pump.yaml` `` or YAML text with ``yaml`...` ``.

Take `Ldata`, `create_scope`, `get_scope`, `yaml` and `desc_file` from this package rather than from layout-data, so that there is one copy of layout-data in the process: two copies share no scope.

`create_udp_server(unit_map, options)` creates a Modbus UDP server, or RTU over UDP with `rtu: true`, with the options of `create_tcp_server`. `create_rtu_server(path, unit_map, options)` creates an RTU slave on a serial port. `create_handler(unit_map)` returns the es-modbus server handler for fully custom assembly. The factories add no listener: listen to `error` of each server, which throws when it has no listener.

### Events

The package outputs nothing itself and reports through events:

```js
emulator.on("server_start", ({ server }) => console.log(`${server.name} started`));
emulator.on("server_error", ({ server, error }) => console.error(`${server.name}: ${error.message}`));
emulator.on("unmapped", ({ kind, unit_id, addr, operation }) => console.warn(`${operation} of unmapped ${kind} ${addr} in unit ${unit_id}`));
emulator.on("request_refused", ({ kind, unit_id, addr, operation }) => console.warn(`${operation} of ${kind} ${addr} in unit ${unit_id} refused`));
```

- The emulator forwards each event `<name>` of its servers as `server_<name>` with `{ server }` and the argument of the event (`socket`, `error` or `frame`); `server.name` is the label of the service, such as `servers[0] (modbus://0.0.0.0:1502)`.
- The handler emits `unmapped` for the unmapped points of a request that succeeds, `request_refused` for the points that cause a refusal, each once per (kind, unit, address, operation) and at most 1024 times (then `unmapped_limit` / `request_refused_limit` once), and `listener_error` when a block listener throws; the emulator forwards them.
- The emulator always listens to `error` of its servers and never emits `error`, so it never throws from an event.
- The emulator emits `warning` with `{ server, message }` for the diagnostics of a `load`, such as a service on a serial bus that answers the broadcast unit 0.

## Address mapping

- A block keeps its content in big-endian; a unit serves the IO buffer of each block in the byte order of the unit, the device byte order of layout-data.
- Register `addr` is byte `addr * 2` of the unit. Holding and input registers share the same content.
- Coil `addr` is bit `addr % 8` of byte `addr >> 3` of the unit.
- Addresses with no block read as 0 / false and ignore writes (warned once per kind, unit, address and operation), unless the unit refuses them (`unmapped_read`, `unmapped_write`).
- A read-only point (`readonly` of a placement) refuses the writes: FC 5 / 15 when it writes a read-only bit, FC 6 / 16 when it writes a register with a read-only bit. A refused request reads or writes nothing and is answered with exception 0x02.

See [doc/spec.md](doc/spec.md) for the full specification, [doc/spec-descriptions.md](doc/spec-descriptions.md) for the descriptions and [doc/design.md](doc/design.md) for the implementation. Chinese editions: [doc/spec.zh-CN.md](doc/spec.zh-CN.md), [doc/spec-descriptions.zh-CN.md](doc/spec-descriptions.zh-CN.md), [doc/design.zh-CN.md](doc/design.zh-CN.md).

## Development

The package is developed with its dependencies `layout-data` and `es-modbus` in a pnpm workspace that lists their repositories and links them with `workspace:*` overrides. Install from the workspace root: `pnpm install` in this directory alone installs the dependencies from npm and drops the links.

From the workspace root:

```sh
pnpm install
pnpm --filter modbus-emulator test
pnpm --filter modbus-emulator lint
```

Or in this directory, running the tools directly:

```sh
node --test
node_modules/.bin/eslint .
```

`node --test` tests the source; `pnpm --filter modbus-emulator test` also builds the bundle and tests it.

## License

MPL-2.0

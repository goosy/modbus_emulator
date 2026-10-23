# modbus_emulator

A Modbus device emulator library. It provides Modbus slave services (TCP, RTU over TCP, RTU) over structured data blocks, and exposes the data through the Ldata / Ltag API of [layout-data](https://github.com/goosy/layout-data/blob/main/doc/spec-data-api.md), so your code can compute on the data to emulate a running device.

## Features

- Slave transports: Modbus TCP, RTU over TCP, RTU (serial port).
- Several services at once, sharing the same data blocks.
- Blocks are described in a YAML file, or assembled in code with `Unit_Map`.
- Writes from the master go through Ldata, so the `change` and `write` events fire as usual.

## Install

```sh
pnpm add modbus_emulator
```

Requires Node.js >= 20.11.

## Usage

### From a description file

```yaml
# emulator.yaml
layouts:
  PUMP:
    - { name: id, type: UInt, offset: 0, init_value: 1 }
    - { name: pressure, type: Real, offset: 32, init_value: 1.5 }

blocks:
  - { name: pump_1, unit_id: 1, layout: PUMP }

servers:
  - { protocol: tcp, host: 0.0.0.0, port: 1502 }
```

```js
import { Modbus_Emulator } from "modbus_emulator";

const emulator = new Modbus_Emulator("emulator.yaml");
await emulator.start();

const pump = emulator.block("pump_1"); // a Ldata of layout-data
// ... apply your own computation to pump ...

await emulator.stop();
```

An invalid description file throws an `Error`; its `errors` property lists all violations.

### Without a description file

```js
import { Unit_Map, Ldata, register_layout, create_tcp_server } from "modbus_emulator";

// once per process
register_layout({
	layouts: {
		PUMP: [
			{ name: "id", type: "UInt", offset: 0, init_value: 1 },
			{ name: "pressure", type: "Real", offset: 32, init_value: 1.5 },
		],
	},
});
const pump = new Ldata("PUMP", "pump_1");

const unit_map = new Unit_Map();
unit_map.attach_unit(1, pump, 0, 0);

const server = create_tcp_server("0.0.0.0", 1502, unit_map);
await server.start();
```

Take `Ldata` and `register_layout` from this package rather than from layout-data, so that there is one copy of layout-data in the process.

`create_rtu_server(path, unit_map, options)` creates an RTU slave on a serial port. `create_vector(unit_map, { logger })` returns the es-modbus server vector for fully custom assembly.

## Address mapping

- Register `addr` is byte `addr * 2` of the unit, big-endian. Holding and input registers share the same content.
- Coil `addr` is bit `addr % 8` of byte `addr >> 3`.
- Addresses with no block read as 0 / false and ignore writes (warned once per address).

See [doc/spec.md](doc/spec.md) for the full specification and [doc/design.md](doc/design.md) for the implementation. Chinese editions: [doc/spec.zh-CN.md](doc/spec.zh-CN.md), [doc/design.zh-CN.md](doc/design.zh-CN.md).

## Development

```sh
pnpm install
pnpm build   # bundle src/index.js into dist/modbus_emulator.js
pnpm test    # build, then node --test
pnpm lint
```

## License

ISC

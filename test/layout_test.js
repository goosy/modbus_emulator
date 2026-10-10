import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Modbus_Emulator } from "../src/index.js";

// register_layout can succeed only once per process, so the registration is tested in a file of its own:
// a failed registration does not use up the call, and the successful one takes the layout file and
// the layouts of the description together
const dir = mkdtempSync(join(tmpdir(), "modbus-emulator-layout-"));
const SERVERS = [{ protocol: "tcp", port: 1502 }];

test("layout errors are reported with the others", () => {
	assert.throws(() => new Modbus_Emulator({
		layouts: {
			BAD: [
				{ name: "a", type: "UInt", offset: 0, init_value: 0 },
				{ name: "a", type: "UInt", offset: 16, init_value: 0 },
			],
		},
		devices: [{ name: "a", unit_id: 1, layout: "BAD" }],
		servers: SERVERS,
	}), (e) => e.errors.some((m) => m.includes("duplicated name")) && e.errors.some((m) => m.includes("unknown layout BAD")));
});

test("layouts_file is relative to the description file and may be combined with layouts", () => {
	writeFileSync(join(dir, "pump.yaml"), `
layouts:
  PUMP:
    - { name: id, type: UInt, offset: 0, init_value: 7 }
`);
	const file = join(dir, "emulator.yaml");
	writeFileSync(file, `
layouts_file: pump.yaml
layouts:
  ONE:
    - { name: a, type: UInt, offset: 0, init_value: 5 }
devices:
  - { name: pump, unit_id: 1, layout: PUMP }
  - { name: one, unit_id: 2, layout: ONE }
servers:
  - { protocol: tcp, port: 1502 }
`);

	const emulator = new Modbus_Emulator(file);
	assert.equal(emulator.device("pump").id, 7);
	assert.equal(emulator.device("one").a, 5);
});

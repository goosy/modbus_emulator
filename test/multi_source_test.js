import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Modbus_Emulator } from "../src/index.js";

// register_layout can succeed only once per process, so this is a file of its own:
// several files are read as one description
const dir = mkdtempSync(join(tmpdir(), "modbus-emulator-sources-"));

test("several files are joined in order and their layouts are registered together", () => {
	writeFileSync(join(dir, "layouts.yaml"), `
layouts:
  PUMP:
    - { name: id, type: UInt, offset: 0, init_value: 7 }
`);
	writeFileSync(join(dir, "devices.yaml"), `
layouts_file: layouts.yaml
devices:
  - { name: pump_1, unit_id: 1, layout: PUMP }
`);
	writeFileSync(join(dir, "servers.yaml"), `
layouts:
  ONE:
    - { name: a, type: UInt, offset: 0, init_value: 5 }
devices:
  - { name: one, unit_id: 2, layout: ONE }
servers:
  - { protocol: tcp, port: 1502 }
`);

	const emulator = new Modbus_Emulator([join(dir, "devices.yaml"), join(dir, "servers.yaml")]);
	assert.deepEqual([...emulator.devices.keys()], ["pump_1", "one"]);
	assert.equal(emulator.device("pump_1").id, 7);
	assert.equal(emulator.device("one").a, 5);
	assert.equal(emulator.servers.length, 1);
	assert.deepEqual(Object.keys(emulator.layouts).sort(), ["ONE", "PUMP"]);
	assert.equal("fragments" in emulator, false);
});

test("an error names its file when there are several", () => {
	writeFileSync(join(dir, "bad.yaml"), `
devices:
  - { name: x, unit_id: 300, layout: PUMP }
`);
	assert.throws(
		() => new Modbus_Emulator([join(dir, "servers.yaml"), join(dir, "bad.yaml")]),
		(e) => e.errors.some((m) => m === `${join(dir, "bad.yaml")}: devices[1]: unit_id must be an integer from 0 to 255`),
	);
});

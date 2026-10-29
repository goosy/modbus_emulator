import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Modbus_Emulator } from "../src/index.js";

// Several description files are read and loaded together; a block names a layout of its own file
const dir = mkdtempSync(join(tmpdir(), "modbus-emulator-descriptions-"));
const path = (name) => join(dir, name);

writeFileSync(path("layouts.yaml"), `
layouts: [PUMP]
item_tables:
  PUMP:
    - { name: id, type: UInt, offset: 0, init_value: 7 }
`);
writeFileSync(path("blocks.yaml"), `
imports: [layouts.yaml]
layouts: [PUMP]
blocks:
  - { name: pump_1, unit_id: 1, layout: PUMP }
`);
writeFileSync(path("servers.yaml"), `
layouts: [ONE]
item_tables:
  ONE:
    - { name: a, type: UInt, offset: 0, init_value: 5 }
blocks:
  - { name: one, unit_id: 2, layout: ONE }
servers:
  - { protocol: tcp, port: 1502 }
`);

test("several files are joined in order and loaded together", () => {
	const emulator = new Modbus_Emulator("descriptions");
	emulator.load([path("layouts.yaml"), path("blocks.yaml"), path("servers.yaml")]);

	assert.deepEqual([...emulator.blocks.keys()], ["pump_1", "one"]);
	assert.equal(emulator.block("pump_1").id, 7);
	assert.equal(emulator.block("one").a, 5);
	assert.equal(emulator.servers.length, 1);
	assert.deepEqual(Object.keys(emulator.layouts).sort(), ["ONE", "PUMP"]);
	assert.equal(emulator.scope.name, "descriptions");
});

test("an error names its file when there are several", () => {
	writeFileSync(path("bad.yaml"), `
imports: [layouts.yaml]
layouts: [PUMP]
blocks:
  - { name: x, unit_id: 300, layout: PUMP }
`);
	assert.throws(
		() => new Modbus_Emulator("descriptions_bad").load([path("servers.yaml"), path("bad.yaml")]),
		(e) => {
			assert.deepEqual(e.errors, [`${path("bad.yaml")}: blocks[1]: unit_id must be an integer from 0 to 255`]);
			return true;
		},
	);
});

test("a block names a layout of its own file", () => {
	writeFileSync(path("foreign.yaml"), `
blocks:
  - { name: x, unit_id: 3, layout: PUMP }
`);
	assert.throws(
		() => new Modbus_Emulator("descriptions_foreign").load([path("layouts.yaml"), path("foreign.yaml"), path("servers.yaml")]),
		(e) => {
			assert.deepEqual(e.errors, [`${path("foreign.yaml")}: block x: unknown layout PUMP`]);
			return true;
		},
	);
});

test("a block name given in two files is an error naming them", () => {
	writeFileSync(path("again.yaml"), `
imports: [layouts.yaml]
layouts: [PUMP]
blocks:
  - { name: pump_1, unit_id: 3, layout: PUMP }
`);
	assert.throws(
		() => new Modbus_Emulator("descriptions_again").load([path("blocks.yaml"), path("again.yaml"), path("servers.yaml")]),
		(e) => {
			assert.deepEqual(e.errors, [`block pump_1 is listed in ${path("blocks.yaml")} and ${path("again.yaml")}`]);
			return true;
		},
	);
});

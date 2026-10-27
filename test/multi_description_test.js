import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Modbus_Emulator } from "../src/index.js";

// The package binds one scope per process, so this is a file of its own:
// several description files are read together, and the scope may be given in any of them
const dir = mkdtempSync(join(tmpdir(), "modbus-emulator-descriptions-"));

// a failed registration does not use up the scope, so this goes first
test("a layout error between the files names them", () => {
	writeFileSync(join(dir, "listed_a.yaml"), `
scope: descriptions
layouts: [P]
item_tables:
  P:
    - { name: a, type: UInt, offset: 0, init_value: 0 }
`);
	writeFileSync(join(dir, "listed_b.yaml"), `
layouts: [P]
blocks:
  - { name: a, unit_id: 1, layout: P }
servers:
  - { protocol: tcp, port: 1502 }
`);
	assert.throws(
		() => new Modbus_Emulator([join(dir, "listed_a.yaml"), join(dir, "listed_b.yaml")]),
		(e) => {
			assert.deepEqual(e.errors, [`layout P is listed in ${join(dir, "listed_a.yaml")} and ${join(dir, "listed_b.yaml")}`]);
			return true;
		},
	);
});

test("several files are joined in order and their layouts are registered together", () => {
	writeFileSync(join(dir, "layouts.yaml"), `
layouts: [PUMP]
item_tables:
  PUMP:
    - { name: id, type: UInt, offset: 0, init_value: 7 }
`);
	writeFileSync(join(dir, "blocks.yaml"), `
scope: descriptions
blocks:
  - { name: pump_1, unit_id: 1, layout: PUMP }
`);
	writeFileSync(join(dir, "servers.yaml"), `
layouts: [ONE]
item_tables:
  ONE:
    - { name: a, type: UInt, offset: 0, init_value: 5 }
blocks:
  - { name: one, unit_id: 2, layout: ONE }
servers:
  - { protocol: tcp, port: 1502 }
`);

	const emulator = new Modbus_Emulator([join(dir, "layouts.yaml"), join(dir, "blocks.yaml"), join(dir, "servers.yaml")]);
	assert.deepEqual([...emulator.blocks.keys()], ["pump_1", "one"]);
	assert.equal(emulator.block("pump_1").id, 7);
	assert.equal(emulator.block("one").a, 5);
	assert.equal(emulator.servers.length, 1);
	assert.deepEqual(Object.keys(emulator.layouts).sort(), ["ONE", "PUMP"]);
	assert.equal("fragments" in emulator, false);
	assert.equal(emulator.scope.name, "descriptions");
});

test("an error names its file when there are several", () => {
	writeFileSync(join(dir, "bad.yaml"), `
blocks:
  - { name: x, unit_id: 300, layout: PUMP }
`);
	assert.throws(
		() => new Modbus_Emulator([join(dir, "servers.yaml"), join(dir, "bad.yaml")]),
		(e) => e.errors.some((m) => m === `${join(dir, "bad.yaml")}: blocks[1]: unit_id must be an integer from 0 to 255`),
	);
});

test("the files that give a scope must give the same name", () => {
	writeFileSync(join(dir, "other.yaml"), `
scope: other
`);
	assert.throws(
		() => new Modbus_Emulator([join(dir, "blocks.yaml"), join(dir, "servers.yaml"), join(dir, "other.yaml")]),
		(e) => {
			assert.deepEqual(e.errors, [`${join(dir, "other.yaml")}: scope other differs from scope descriptions of ${join(dir, "blocks.yaml")}`]);
			return true;
		},
	);
});

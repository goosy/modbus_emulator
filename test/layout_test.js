import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Modbus_Emulator, create_scope, desc_file, get_scope, yaml } from "../src/index.js";

// The package binds one scope per process, so the load is tested in a file of its own: a failed load
// does not bind it, the successful load takes the item tables of an imported file and binds the package,
// and the layouts are reused while the block names are held
const dir = mkdtempSync(join(tmpdir(), "modbus-emulator-layout-"));
const SERVERS = "servers:\n  - { protocol: tcp, port: 1502 }";

test("an error of the load is collected, and does not bind the package", () => {
	create_scope("first").load(yaml("layouts: [P]\nitem_tables:\n  P:\n    - { name: a, type: UInt, offset: 0 }"));
	const other = yaml(`
layouts: [P]
item_tables:
  P:
    - { name: b, type: UInt, offset: 0 }
blocks:
  - { name: a, unit_id: 1, layout: P }
  - { name: b, unit_id: 300, layout: P }
${SERVERS}
`);

	// the checks of the package fail first, and nothing is loaded
	assert.throws(() => new Modbus_Emulator(other, "first"), (e) => {
		assert.deepEqual(e.errors, ["blocks[1]: unit_id must be an integer from 0 to 255"]);
		return true;
	});
	assert.throws(() => new Modbus_Emulator(yaml(`
layouts: [P]
item_tables:
  P:
    - { name: b, type: UInt, offset: 0 }
blocks:
  - { name: a, unit_id: 1, layout: P }
${SERVERS}
`), "first"), (e) => e.errors.length === 1 && e.errors[0].includes("P"));
});

const file = join(dir, "emulator.yaml");

test("a description takes the item tables of the files it imports", () => {
	writeFileSync(join(dir, "pump.yaml"), `
item_tables:
  PUMP:
    - { name: id, type: UInt, offset: 0, init_value: 7 }
`);
	writeFileSync(file, `
imports: [pump.yaml]
layouts: [PUMP, ONE]
item_tables:
  ONE:
    - { name: a, type: UInt, offset: 0, init_value: 5 }
blocks:
  - { name: pump, unit_id: 1, layout: PUMP }
  - { name: one, unit_id: 2, layout: ONE }
${SERVERS}
`);

	// the failed loads into scope first above did not bind the package
	const emulator = new Modbus_Emulator(desc_file(file), "plant");
	assert.equal(emulator.block("pump").id, 7);
	assert.equal(emulator.block("one").a, 5);
	assert.equal(emulator.scope, get_scope("plant"));
	assert.deepEqual(Object.keys(emulator.layouts).sort(), ["ONE", "PUMP"]);
});

test("a description is constructed once: its block names are held by the layouts", () => {
	assert.throws(() => new Modbus_Emulator(desc_file(file), "plant"), (e) => {
		assert.equal(e.errors.length, 2, JSON.stringify(e.errors));
		return true;
	});
});

test("the layouts are reused by descriptions of other block names, any number of times", () => {
	const description = (name) => yaml(`
layouts: [ONE]
item_tables:
  ONE:
    - { name: a, type: UInt, offset: 0, init_value: 5 }
blocks:
  - { name: ${name}, unit_id: 2, layout: ONE }
${SERVERS}
`);
	const first = new Modbus_Emulator(description("one_1"), "plant");
	const second = new Modbus_Emulator(description("one_2"));

	assert.equal(first.block("one_1").layout, get_scope("plant").get_layout("ONE"));
	assert.equal(second.block("one_2").layout, first.block("one_1").layout);
	assert.equal(second.scope, get_scope("plant"));
});

test("once bound, another scope is an error, even an existing one", () => {
	const description = yaml(`layouts: [P]\nitem_tables:\n  P:\n    - { name: a, type: UInt, offset: 0 }\nblocks:\n  - { name: x, unit_id: 1, layout: P }\n${SERVERS}`);
	assert.throws(() => new Modbus_Emulator(description, "first"), (e) => {
		assert.deepEqual(e.errors, ["scope first: the package uses scope plant"]);
		return true;
	});
});

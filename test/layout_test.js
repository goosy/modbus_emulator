import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Modbus_Emulator, get_scope } from "./target.js";

// The layouts of the descriptions loaded into a scope: a layout error loads nothing, a layout file is
// loaded with the other files, and layout-data reuses or refuses the layouts already in the scope
const dir = mkdtempSync(join(tmpdir(), "modbus-emulator-layout-"));
const SERVERS = [{ protocol: "tcp", port: 1502 }];
let file_seq = 0;

/** Writes a description file of a description given as data and returns its path. JSON is YAML. */
const write_description = (description) => {
	const path = join(dir, `description_${++file_seq}.yaml`);
	writeFileSync(path, JSON.stringify(description));
	return path;
};

test("a layout error is reported, and nothing is loaded", () => {
	const emulator = new Modbus_Emulator("layout_bad");
	assert.throws(() => emulator.load(write_description({
		layouts: ["BAD"],
		item_tables: {
			BAD: [
				{ name: "a", type: "UInt", offset: 0, init_value: 0 },
				{ name: "a", type: "UInt", offset: 16, init_value: 0 },
			],
		},
		blocks: [{ name: "a", unit_id: 1, layout: "BAD" }],
		servers: SERVERS,
	})), (e) => e.errors.length > 0 && e.errors.every((m) => m.includes("duplicated name")));
	assert.throws(() => get_scope("layout_bad").get_layout("BAD"));
	assert.equal(emulator.blocks.size, 0);
});

const file = join(dir, "emulator.yaml");
const layout_file = join(dir, "pump.yaml");
writeFileSync(layout_file, `
layouts: [PUMP]
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
servers:
  - { protocol: tcp, port: 1502 }
`);

test("a layout file is an item of the list, loaded with the other files", () => {
	const emulator = new Modbus_Emulator("plant");
	emulator.load([layout_file, file]);

	assert.equal(emulator.block("pump").id, 7);
	assert.equal(emulator.block("one").a, 5);
	assert.equal(emulator.scope, get_scope("plant"));
	assert.deepEqual(Object.keys(emulator.layouts).sort(), ["ONE", "PUMP"]);
	assert.equal(emulator.layouts.PUMP, emulator.scope.get_layout("PUMP"));
});

test("another layout of a name in the scope is an error", () => {
	const other = write_description({
		layouts: ["PUMP"],
		item_tables: { PUMP: [{ name: "id", type: "UInt", offset: 0, init_value: 8 }] },
		blocks: [{ name: "other", unit_id: 1, layout: "PUMP" }],
		servers: SERVERS,
	});
	assert.throws(() => new Modbus_Emulator("plant").load(other), (e) => {
		assert.deepEqual(e.errors, [`${other}: another layout of a different structure is already named plant.PUMP`]);
		return true;
	});
});

test("an overlap of the blocks fails before loading: the scope is left as it was", () => {
	const description = {
		layouts: ["ONE"],
		item_tables: { ONE: [{ name: "a", type: "UInt", offset: 0, init_value: 5 }] },
		blocks: [{ name: "x", unit_id: 1, layout: "ONE" }, { name: "y", unit_id: 1, layout: "ONE" }],
		servers: SERVERS,
	};
	const emulator = new Modbus_Emulator("overlap");
	assert.throws(() => emulator.load(write_description(description)),
		(e) => e.errors.length === 1 && e.errors[0].startsWith("blocks[1]: unit 1: "));
	assert.throws(() => emulator.scope.get_layout("ONE"), /ONE/);

	description.blocks[1].start = 2;
	emulator.load(write_description(description));
	assert.deepEqual([...emulator.blocks.keys()], ["x", "y"]);
});

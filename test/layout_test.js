import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Modbus_Emulator, desc_file, get_scope } from "../src/index.js";

// The layouts of the descriptions loaded into a scope: a layout error loads nothing, a layout file is
// loaded with the other descriptions, and layout-data reuses or refuses the layouts already in the scope
const dir = mkdtempSync(join(tmpdir(), "modbus-emulator-layout-"));
const SERVERS = [{ protocol: "tcp", port: 1502 }];
let file_seq = 0;
// the file of each compiled description, which the errors of the load name
const paths = new Map();

/** Writes a description file of a description given as data and compiles it, remembering its path. JSON is YAML. */
const write_description = (description) => {
	const path = join(dir, `description_${++file_seq}.yaml`);
	writeFileSync(path, JSON.stringify(description));
	const compiled = desc_file(path);
	paths.set(compiled, path);
	return compiled;
};

test("a layout error is reported by the compilation, and nothing is loaded", () => {
	assert.throws(() => new Modbus_Emulator(write_description({
		layouts: ["BAD"],
		item_tables: {
			BAD: [
				{ name: "a", type: "UInt", offset: 0, init_value: 0 },
				{ name: "a", type: "UInt", offset: 16, init_value: 0 },
			],
		},
		blocks: [{ name: "a", unit_id: 1, layout: "BAD" }],
		servers: SERVERS,
	}), "layout_bad"), (e) => e.errors.length > 0 && e.errors.every((m) => m.includes("duplicated name")));
	assert.equal(get_scope("layout_bad"), undefined);
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

test("a layout file is an item of the list, loaded with the other descriptions", () => {
	const emulator = new Modbus_Emulator([desc_file(layout_file), desc_file(file)], "plant");

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
	assert.throws(() => new Modbus_Emulator(other, "plant"), (e) => {
		assert.deepEqual(e.errors, [`${paths.get(other)}: another layout of a different structure is already named plant.PUMP`]);
		return true;
	});
});

test("a construction that fails after loading gives the block names back", () => {
	const description = {
		layouts: ["ONE"],
		item_tables: { ONE: [{ name: "a", type: "UInt", offset: 0, init_value: 5 }] },
		blocks: [{ name: "x", unit_id: 1, layout: "ONE" }, { name: "y", unit_id: 1, layout: "ONE" }],
		servers: SERVERS,
	};
	assert.throws(() => new Modbus_Emulator(write_description(description), "overlap"),
		(e) => e.errors.length === 1 && e.errors[0].startsWith("blocks[1]: unit 1: "));
	assert.throws(() => get_scope("overlap").get_layout("ONE").get_ldata("x"), /unknown ldata overlap\.ONE\.x/);

	description.blocks[1].start = 2;
	const emulator = new Modbus_Emulator(write_description(description), "overlap");
	assert.deepEqual([...emulator.blocks.keys()], ["x", "y"]);
});

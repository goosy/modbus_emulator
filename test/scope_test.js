import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Modbus_Emulator, desc_file, get_scope } from "./target.js";

// The scope is chosen in code: the descriptions are loaded into the scope of the name given, by default
// modbus_emulator, where layout-data reuses a layout of the same structure and name; stop() gives the
// block names back, so another emulator can load the same description in the scope
const SERVERS = [{ protocol: "tcp", port: 1502 }];
const dir = mkdtempSync(join(tmpdir(), "modbus-emulator-scope-"));
let file_seq = 0;
// the file of each compiled description, which the errors of the load name
const paths = new Map();

/**
 * Writes a description file of one layout with an item of the init value, and one block of it, and compiles
 * it, remembering its path. JSON is YAML.
 */
const description_of = (layout, init_value, block = "block") => {
	const file = join(dir, `description_${++file_seq}.yaml`);
	writeFileSync(file, JSON.stringify({
		layouts: [layout],
		item_tables: { [layout]: [{ name: "id", type: "UInt", offset: 0, init_value }] },
		blocks: [{ name: block, unit_id: 1, layout }],
		servers: SERVERS,
	}));
	const description = desc_file(file);
	paths.set(description, file);
	return description;
};

/** An emulator in the scope of a name, with a description loaded. */
const emulator_of = (description, scope) => {
	const emulator = new Modbus_Emulator(scope);
	emulator.load(description);
	return emulator;
};

const errors_of = (description, scope) => {
	try {
		emulator_of(description, scope);
	} catch (e) {
		return e.errors;
	}
	assert.fail("the load did not fail");
};

test("without a scope name the descriptions are loaded into the scope modbus_emulator", async () => {
	const emulator = emulator_of(description_of("DEFAULT", 7));

	assert.equal(emulator.scope, get_scope("modbus_emulator"));
	assert.equal(emulator.block("block").id, 7);
	await emulator.stop();
});

test("another emulator loads a description in its scope once the first emulator stopped", async () => {
	const description = description_of("SHARED", 1);
	const first = emulator_of(description, "shared");

	assert.deepEqual(errors_of(description, "shared"), [`${paths.get(description)}: block block: ldata shared.SHARED.block already exists`]);
	await first.stop();
	const second = emulator_of(description, "shared");

	assert.equal(second.scope, first.scope);
	assert.equal(second.layouts.SHARED, first.layouts.SHARED);
	assert.notEqual(second.block("block"), first.block("block"));
	second.block("block").id = 9;
	assert.equal(first.block("block").id, 1);
});

test("a stopped emulator keeps its blocks, whose names its layouts no longer hold", async () => {
	const emulator = emulator_of(description_of("STOPPED", 3), "stopped");
	const layout = emulator.scope.get_layout("STOPPED");

	assert.equal(layout.get_ldata("block"), emulator.block("block"));
	await emulator.stop();
	assert.throws(() => layout.get_ldata("block"), /unknown ldata stopped\.STOPPED\.block/);
	emulator.block("block").id = 4;
	assert.equal(emulator.block("block").id, 4);
});

test("layouts of the same name and different structures are loaded into different scopes", () => {
	const first = emulator_of(description_of("DIFF", 1), "diff_1");
	const second = emulator_of(description_of("DIFF", 2), "diff_2");

	assert.notEqual(second.layouts.DIFF, first.layouts.DIFF);
	assert.equal(first.block("block").id, 1);
	assert.equal(second.block("block").id, 2);
	const other = description_of("DIFF", 3, "other");
	assert.deepEqual(errors_of(other, "diff_1"), [`${paths.get(other)}: another layout of a different structure is already named diff_1.DIFF`]);
});

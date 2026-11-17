import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Modbus_Emulator, desc_file, get_scope } from "./target.js";
import { ephemeral } from "./helpers.js";

// The scope is chosen in code: the descriptions are loaded into the scope of the name given, by default
// modbus_emulator, where layout-data reuses a layout of the same structure and name; stop() gives the
// block names back, so another emulator can load the same description in the scope; start() binds them back,
// so two emulators never serve a block of the same name at once
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
		blocks: [{ name: block, layout }],
		units: [{ unit_id: 1, blocks: { [block]: {} } }],
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

/** The error of a load of a description whose block name its layout holds. */
const HELD = (description, scope, layout) => `${paths.get(description)}: block block: ldata ${scope}.${layout}.block already exists`;

/** The error of a start refused as the layout holds the name of the block for another ldata. */
const TAKEN = (layout) => `block block of layout ${layout}: the layout holds the name for another ldata`;

/** The errors of a start that is refused. */
const start_errors_of = async (emulator) => {
	try {
		await emulator.start();
	} catch (e) {
		return e.errors;
	}
	assert.fail("the start did not fail");
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

	assert.deepEqual(errors_of(description, "shared"), [HELD(description, "shared", "SHARED")]);
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

test("an emulator started again after stop() holds its block names: another emulator cannot load them", async (t) => {
	const description = description_of("RESTARTED", 1);
	const first = emulator_of(description, "restarted");
	ephemeral(first.servers[0]);
	t.after(() => first.stop());
	await first.stop();
	await first.start();

	assert.equal(first.scope.get_layout("RESTARTED").get_ldata("block"), first.block("block"));
	assert.deepEqual(errors_of(description, "restarted"), [HELD(description, "restarted", "RESTARTED")]);
	await first.stop();
	assert.ok(emulator_of(description, "restarted"));
});

test("start() starts nothing when another emulator holds a block name of the emulator", async (t) => {
	const description = description_of("TAKEN", 1);
	const first = emulator_of(description, "taken");
	ephemeral(first.servers[0]);
	t.after(() => first.stop());
	await first.stop();
	const second = emulator_of(description, "taken");
	let started = false;
	first.on("server_start", () => { started = true; });

	assert.deepEqual(await start_errors_of(first), [TAKEN("TAKEN")]);
	assert.equal(started, false);
	// the refused emulator gives back no name of the other one
	await first.stop();
	assert.equal(first.scope.get_layout("TAKEN").get_ldata("block"), second.block("block"));
	await second.stop();
});

test("start() starts nothing when the caller created an ldata of a block name of the emulator", async (t) => {
	const emulator = emulator_of(description_of("BYPASSED", 1), "bypassed");
	ephemeral(emulator.servers[0]);
	t.after(() => emulator.stop());
	await emulator.stop();
	emulator.scope.get_layout("BYPASSED").create_ldata("block");

	assert.deepEqual(await start_errors_of(emulator), [TAKEN("BYPASSED")]);
});

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Modbus_Emulator, get_scope } from "../src/index.js";

// The package binds one scope per process, so the registration is tested in a file of its own:
// neither an unknown scope nor a failed registration binds it nor uses up the call, the successful
// registration takes the layout file and the layouts of the description together, and binds the package
const dir = mkdtempSync(join(tmpdir(), "modbus-emulator-layout-"));
const SERVERS = [{ protocol: "tcp", port: 1502 }];

test("a description without layouts names an existing scope", () => {
	assert.throws(() => new Modbus_Emulator({
		scope: "nowhere",
		blocks: [{ name: "a", unit_id: 1, layout: "PUMP" }],
		servers: SERVERS,
	}), (e) => {
		assert.deepEqual(e.errors, ["unknown scope nowhere"]);
		return true;
	});
});

test("layout errors are reported with the others, without an unknown layout per block", () => {
	assert.throws(() => new Modbus_Emulator({
		scope: "first",
		layouts: ["BAD"],
		item_tables: {
			BAD: [
				{ name: "a", type: "UInt", offset: 0, init_value: 0 },
				{ name: "a", type: "UInt", offset: 16, init_value: 0 },
			],
		},
		blocks: [{ name: "a", unit_id: 1, layout: "BAD" }, { name: "b", unit_id: 300, layout: "BAD" }],
		servers: SERVERS,
	}), (e) => e.errors.some((m) => m.includes("duplicated name"))
		&& e.errors.some((m) => m.includes("blocks[1]: unit_id"))
		&& !e.errors.some((m) => m.includes("unknown layout")));
});

const file = join(dir, "emulator.yaml");
const layout_file = join(dir, "pump.yaml");

test("a layout file is an item of the list, registered with the layouts of the other files", () => {
	writeFileSync(layout_file, `
layouts: [PUMP]
item_tables:
  PUMP:
    - { name: id, type: UInt, offset: 0, init_value: 7 }
`);
	writeFileSync(file, `
scope: plant
layouts: [ONE]
item_tables:
  ONE:
    - { name: a, type: UInt, offset: 0, init_value: 5 }
blocks:
  - { name: pump, unit_id: 1, layout: PUMP }
  - { name: one, unit_id: 2, layout: ONE }
servers:
  - { protocol: tcp, port: 1502 }
`);

	// the failed registration of scope first above did not bind the package
	const emulator = new Modbus_Emulator([layout_file, file]);
	assert.equal(emulator.block("pump").id, 7);
	assert.equal(emulator.block("one").a, 5);
	assert.equal(emulator.scope, get_scope("plant"));
	assert.deepEqual(Object.keys(emulator.layouts).sort(), ["ONE", "PUMP"]);
});

test("a description with layouts is constructed once: the scope is registered", () => {
	assert.throws(() => new Modbus_Emulator([layout_file, file]), (e) => {
		assert.deepEqual(e.errors, ["register_layout can be called only once in scope plant"]);
		return true;
	});
});

test("descriptions without layouts use the layouts of the scope, any number of times", () => {
	const description = { scope: "plant", blocks: [{ name: "pump", unit_id: 1, layout: "PUMP" }], servers: SERVERS };
	const first = new Modbus_Emulator(description);
	const second = new Modbus_Emulator(description);

	assert.notEqual(first.block("pump"), second.block("pump"));
	assert.equal(first.block("pump").layout, second.block("pump").layout);
	assert.equal(second.scope, get_scope("plant"));
});

test("once bound, another scope is an error, even an existing one", () => {
	assert.throws(() => new Modbus_Emulator({ scope: "first", blocks: [{ unit_id: 1, layout: "BAD" }], servers: SERVERS }),
		(e) => {
			assert.deepEqual(e.errors, ["scope first: the package uses scope plant"]);
			return true;
		});
});

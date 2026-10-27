import assert from "node:assert/strict";
import test from "node:test";
import { Modbus_Emulator, get_scope } from "../src/index.js";

// The package binds one scope per process, so the scope named from the time is tested in a file
// of its own, where the package is not bound before
const SERVERS = [{ protocol: "tcp", port: 1502 }];
const LAYOUTS = { layouts: ["PUMP"], item_tables: { PUMP: [{ name: "id", type: "UInt", offset: 0, init_value: 7 }] } };

/** The scope name of a time: `s` and the UTC time from the year to the millisecond. */
const name_of = (time) => `s${new Date(time).toISOString().replace(/\D/g, "")}`;

test("before the binding, a description without scope and without layouts names a scope that does not exist", () => {
	assert.throws(() => new Modbus_Emulator({ blocks: [{ unit_id: 1, layout: "PUMP" }], servers: SERVERS }), (e) => {
		assert.equal(e.errors.length, 1, JSON.stringify(e.errors));
		assert.match(e.errors[0], /^unknown scope s\d{17}$/);
		return true;
	});
});

test("before the binding, a description without scope registers its layouts in a scope named from the time", () => {
	const before = Date.now();
	const emulator = new Modbus_Emulator({ ...LAYOUTS, blocks: [{ unit_id: 1, layout: "PUMP" }], servers: SERVERS });
	const after = Date.now();

	const { name } = emulator.scope;
	assert.match(name, /^s\d{17}$/);
	assert.ok(name >= name_of(before) && name <= name_of(after), name);
	assert.equal(get_scope(name), emulator.scope);
	assert.equal(emulator.block("unit_1").id, 7);
});

test("after the binding, a description without scope takes the bound scope", () => {
	const first = new Modbus_Emulator({ blocks: [{ unit_id: 1, layout: "PUMP" }], servers: SERVERS });
	const second = new Modbus_Emulator({ blocks: [{ unit_id: 2, layout: "PUMP" }], servers: SERVERS });

	assert.equal(second.scope, first.scope);
	assert.match(first.scope.name, /^s\d{17}$/);
});

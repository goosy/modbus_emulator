import assert from "node:assert/strict";
import test from "node:test";
import { Modbus_Emulator, get_scope, yaml } from "../src/index.js";

// The package binds one scope per process, so the scope named from the time is tested in a file
// of its own, where the package is not bound before
const SERVERS = "servers:\n  - { protocol: tcp, port: 1502 }";
const LAYOUTS = "layouts: [PUMP]\nitem_tables:\n  PUMP:\n    - { name: id, type: UInt, offset: 0, init_value: 7 }";
const describe_block = (name, unit_id) => yaml(`${LAYOUTS}\nblocks:\n  - { name: ${name}, unit_id: ${unit_id}, layout: PUMP }\n${SERVERS}`);

/** The scope name of a time: `s` and the UTC time from the year to the millisecond. */
const name_of = (time) => `s${new Date(time).toISOString().replace(/\D/g, "")}`;

test("a scope name that is not an identifier is the error of create_scope, and does not bind the package", () => {
	assert.throws(() => new Modbus_Emulator(describe_block("pump_0", 1), "not a name"), (e) => {
		assert.equal(e.errors.length, 1, JSON.stringify(e.errors));
		return true;
	});
});

test("before the binding, an emulator given no scope loads into a scope named from the time", () => {
	const before = Date.now();
	const emulator = new Modbus_Emulator(describe_block("pump_1", 1));
	const after = Date.now();

	const { name } = emulator.scope;
	assert.match(name, /^s\d{17}$/);
	assert.ok(name >= name_of(before) && name <= name_of(after), name);
	assert.equal(get_scope(name), emulator.scope);
	assert.equal(emulator.block("pump_1").id, 7);
});

test("after the binding, an emulator given no scope takes the bound scope", () => {
	const first = new Modbus_Emulator(describe_block("pump_2", 1));
	const second = new Modbus_Emulator(describe_block("pump_3", 2));

	assert.equal(second.scope, first.scope);
	assert.match(first.scope.name, /^s\d{17}$/);
});

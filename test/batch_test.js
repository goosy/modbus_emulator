import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test, { describe } from "node:test";
import { Modbus_Client } from "es-modbus";
import { Unit_Map, create_handler, create_tcp_server, create_scope } from "../src/index.js";
import { HOST, listening_port } from "./helpers.js";

// The batch methods of the handler over real Ldata, whose transactions, events and `access`
// are what is tested.
const UNIT = 1;

// 8 bytes: registers 0..3 of a block; its Bools are coils 48, 49 and 63 of the block
const scope = create_scope("batch_test");
scope.register_layout({
	layouts: ["BLOCK"],
	item_tables: {
		BLOCK: [
			{ name: "r", type: "Real", offset: 0, init_value: 1.5 },
			{ name: "n", type: "UInt", offset: 32, init_value: 7 },
			{ name: "c0", type: "Bool", offset: 48, init_value: false },
			{ name: "c1", type: "Bool", offset: 49, init_value: false },
			{ name: "c2", type: "Bool", offset: 63, init_value: false },
		],
	},
});

/**
 * Two blocks side by side in one unit: `a` at registers 0..3 (coils 0..63), `b` at registers 4..7
 * (coils 64..127). `log` records their events in order.
 */
function make_unit() {
	const layout = scope.get_layout("BLOCK");
	const a = layout.create_ldata("a");
	const b = layout.create_ldata("b");
	const unit_map = new Unit_Map();
	unit_map.attach_unit(UNIT, a, 0);
	unit_map.attach_unit(UNIT, b, 8);
	const log = [];
	for (const block of [a, b]) {
		block.on("write", () => log.push(`${block.name} write`));
		block.on("access", (kind, tags) => log.push(`${block.name} access ${kind} ${tags.map((tag) => tag.name)}`));
		for (const name of ["r", "n", "c0", "c1", "c2"]) {
			block.get(name).on("change", (old_value, new_value) => log.push(`${block.name}.${name} ${old_value}->${new_value}`));
		}
	}
	const handler = create_handler(unit_map);
	return { a, b, unit_map, handler, log };
}

/** Serves a unit of make_unit and returns a master of it. */
async function serve(t) {
	const unit = make_unit();
	const server = create_tcp_server(unit.unit_map, { host: HOST, port: 0, handler: unit.handler });
	await server.start();
	t.after(() => server.stop());
	const master = new Modbus_Client(HOST, { port: listening_port(server), reconnect_time: 0 });
	master.on("error", () => { });
	t.after(() => master.disconnect());
	return { ...unit, master };
}

/** The 4 registers of a block whose Real is `real`, UInt `uint` and Bools false, as written by FC 16. */
function block_registers(real, uint) {
	const bytes = Buffer.alloc(8);
	bytes.writeFloatBE(real, 0);
	bytes.writeUInt16BE(uint, 4);
	return bytes;
}

/** The bytes of FC 15 for coils: coil i is bit i % 8 of byte i >> 3. */
function coil_bytes(values) {
	const bytes = Buffer.alloc(Math.ceil(values.length / 8));
	values.forEach((value, i) => { if (value) bytes[i >> 3] |= 1 << (i % 8); });
	return bytes;
}

// registers 0..7: a.r = 1234.5, a.n = 9, b.r = -2, b.n = 8
const BOTH_BLOCKS = Buffer.concat([block_registers(1234.5, 9), block_registers(-2, 8)]);

// The logs are checked before the values: reading a tag emits an `access` of kind read.
describe("batch writes", () => {
	test("an FC 16 request across blocks writes each block once, without intermediate values", async (t) => {
		const { master, a, b, log } = await serve(t);

		assert.equal(await master.write([16, 0, 8], BOTH_BLOCKS, UNIT), true);

		assert.deepEqual(log, [
			"a access write r,n,c0,c1,c2", "a.r 1.5->1234.5", "a.n 7->9", "a write",
			"b access write r,n,c0,c1,c2", "b.r 1.5->-2", "b.n 7->8", "b write",
		]);
		assert.deepEqual([a.r, a.n, b.r, b.n], [1234.5, 9, -2, 8]);
	});

	test("an FC 15 request across blocks writes each block once and accesses only the Bools written", async (t) => {
		const { master, a, b, log } = await serve(t);
		// coils 49..112: bits 1..7 of byte 6 of a (not a.c0), byte 7 of a, bytes 0..5 of b (b.r, b.n),
		// bit 0 of byte 6 of b (not b.c1)
		const values = new Array(64).fill(false);
		values[14] = true; // a.c2, coil 63
		values[63] = true; // b.c0, coil 112

		assert.equal(await master.write([15, 49, 64], coil_bytes(values), UNIT), true);

		assert.deepEqual(log, [
			"a access write c1,c2", "a.c2 false->true", "a write",
			"b access write r,n,c0", "b.r 1.5->0", "b.n 7->0", "b.c0 false->true", "b write",
		]);
		assert.deepEqual([a.c0, a.c1, a.c2, b.c0, b.c1], [false, false, true, true, false]);
	});

	test("a write that fails midway restores every block and answers exception 0x04", async (t) => {
		const { master, a, b, log } = await serve(t);
		b.write_bytes = () => { throw new Error("refused"); };

		await assert.rejects(master.write([16, 0, 8], BOTH_BLOCKS, UNIT), { message: "response error: 4" });

		assert.deepEqual(log, []);
		assert.deepEqual([a.r, a.n, b.r, b.n], [1.5, 7, 1.5, 7]);
	});

	test("a listener error is emitted and affects neither the other block nor the response", async (t) => {
		const { master, a, b, handler, log } = await serve(t);
		const errors = [];
		handler.on("listener_error", ({ block, error }) => errors.push(`${block.name}: ${error.message}`));
		a.on("write", () => { throw new Error("listener of a"); });
		b.get("n").on("change", () => { throw new Error("listener of b"); });

		assert.equal(await master.write([16, 0, 8], BOTH_BLOCKS, UNIT), true);

		assert.ok(log.includes("a write") && log.includes("b write"));
		assert.deepEqual(errors, ["a: listener of a", "b: listener of b"]);
		assert.deepEqual([a.r, a.n, b.r, b.n], [1234.5, 9, -2, 8]);
	});

	test("the unmapped registers of a batch write are skipped and emitted", () => {
		const unmapped = [];
		const { b, handler } = make_unit();
		handler.on("unmapped", (event) => unmapped.push(event));

		handler.set_holding_registers(6, [1, 2, 3, 4], UNIT); // registers 6, 7 of b, then 8, 9 unmapped

		assert.equal(b.read_bytes(4, 4).readUInt32BE(0), 0x0001_0002);
		assert.deepEqual(unmapped, [
			{ kind: "holding_register", unit_id: UNIT, addr: 8 },
			{ kind: "holding_register", unit_id: UNIT, addr: 9 },
		]);
	});
});

describe("batch reads", () => {
	test("an FC 3 request across blocks accesses each block once", async (t) => {
		const { master, log } = await serve(t);

		// registers 2..5: a.n, the Bools of a, b.r
		const registers = await master.read([3, 2, 4], UNIT);

		assert.deepEqual(log, ["a access read n,c0,c1,c2", "b access read r"]);
		assert.deepEqual(registers, Buffer.from([0, 7, 0, 0, 0x3f, 0xc0, 0, 0]));
	});

	test("an FC 4 request reads the same content", async (t) => {
		const { master, log } = await serve(t);

		assert.deepEqual(await master.read([4, 2, 1], UNIT), Buffer.from([0, 7]));
		assert.deepEqual(log, ["a access read n"]);
	});

	test("FC 1 and FC 2 requests across blocks access only the Bools of the bits read", async (t) => {
		const { master, a, b, log } = await serve(t);
		a.c2 = true;
		b.c0 = true;
		// coils 49..112, as in the FC 15 test, taken from the bytes of the unit
		const image = Buffer.concat([a.read_bytes(), b.read_bytes()]);
		const coils = Array.from({ length: 64 }, (_, i) => ((image[(49 + i) >> 3] >> ((49 + i) % 8)) & 1) === 1);
		const expected = coil_bytes(coils);
		log.length = 0;

		for (const fc of [1, 2]) assert.deepEqual(await master.read([fc, 49, 64], UNIT), expected);

		const per_request = ["a access read c1,c2", "b access read r,n,c0"];
		assert.deepEqual(log, [...per_request, ...per_request]);
	});

	test("a listener error of an access read is emitted and the request is answered", async (t) => {
		const { master, a, handler } = await serve(t);
		const errors = [];
		handler.on("listener_error", ({ block, error }) => errors.push(`${block.name}: ${error.message}`));
		a.on("access", () => { throw new Error("listener of a"); });

		assert.deepEqual(await master.read([3, 2, 1], UNIT), Buffer.from([0, 7]));
		assert.deepEqual(errors, ["a: listener of a"]);
	});

	test("the unmapped registers and coils of a batch read read as 0 and are emitted", () => {
		const unmapped = [];
		const { handler } = make_unit();
		handler.on("unmapped", (event) => unmapped.push(event));

		assert.deepEqual(handler.get_holding_registers(6, 3, UNIT), [7, 0, 0]); // b.n, the Bools of b, then register 8
		assert.deepEqual(handler.get_coils(127, 2, UNIT), [false, false]); // coil 127 of b (b.c2), then 128
		assert.deepEqual(unmapped, [
			{ kind: "holding_register", unit_id: UNIT, addr: 8 },
			{ kind: "coil", unit_id: UNIT, addr: 128 },
		]);
	});
});

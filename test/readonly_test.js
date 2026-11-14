import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test, { describe } from "node:test";
import { Modbus_Client } from "es-modbus";
import { Modbus_Emulator, Unit_Map, create_handler, create_tcp_server, create_scope, yaml } from "./target.js";
import { HOST, ephemeral, listening_port, master_options } from "./helpers.js";

// The read-only points, the refusal of unmapped addresses and the events of a refusal
// (issue#44nqrsz7, doc/spec.md 3).
const UNIT = 1;

// 14 bytes (registers 0..6) in big-endian; coil n is bit n % 8 of byte n >> 3:
// id: register 0; status: register 1, with alarm (coil 16) and run (coil 24); pressure: registers 2, 3;
// low, high: the two bytes of register 4 (coils 64..79); register 5: padding; last: register 6
const ITEMS = `
item_tables:
  RO:
    - { name: id, type: UInt, offset: 0 }
    - name: status
      type: Word
      offset: 16
      coupling:
        - { name: run, type: Bool, offset: 8 }
        - { name: alarm, type: Bool, offset: 0 }
    - { name: pressure, type: Real, offset: 32 }
    - { name: low, type: Byte, offset: 64 }
    - { name: high, type: Byte, offset: 72 }
    - { name: last, type: UInt, offset: 96 }
`;

const scope = create_scope("readonly_test");
scope.load(yaml`
layouts: [RO]
${ITEMS}
`);
const layout = scope.get_layout("RO");

let block_seq = 0;

/** A unit map with one block at register 0 of UNIT, placed with `options`, and a handler that records its events. */
function make_unit(options = {}, endian = "BE") {
	const block = layout.create_ldata(`b${++block_seq}`);
	const unit_map = new Unit_Map();
	unit_map.set_endian(UNIT, endian);
	unit_map.attach_unit(UNIT, block, options);
	const handler = create_handler(unit_map);
	const events = [];
	for (const name of ["unmapped", "unmapped_limit", "request_refused", "request_refused_limit"]) {
		handler.on(name, (payload) => events.push({ name, ...payload }));
	}
	return { block, unit_map, handler, events };
}

/** Asserts that fn throws the refusal of the handler: an error with exception_code 0x02. */
function refused(fn) {
	assert.throws(fn, (error) => error.exception_code === 0x02);
}

const point = (name, kind, addr, operation) => ({ name, kind, unit_id: UNIT, addr, operation });

describe("read-only declarations of a unit map", () => {
	test("segments give the declaration of each placement", () => {
		const unit_map = new Unit_Map();
		const tags = ["id", "status"];
		unit_map.attach_unit(1, layout.create_ldata("seg_a"));
		unit_map.attach_unit(4, layout.create_ldata("seg_d"), { readonly: "none" });
		unit_map.attach_unit(2, layout.create_ldata("seg_b"), { readonly: "all" });
		unit_map.attach_unit(3, layout.create_ldata("seg_c"), { readonly: tags });
		tags.push("last");

		assert.equal(unit_map.segments(1)[0].readonly, "none");
		assert.equal(unit_map.segments(4)[0].readonly, "none");
		assert.equal(unit_map.segments(2)[0].readonly, "all");
		const { readonly } = unit_map.segments(3)[0];
		assert.deepEqual(readonly, ["id", "status"]);
		assert.ok(Object.isFrozen(readonly));
	});

	test("an invalid declaration throws a RangeError and attaches nothing", () => {
		const unit_map = new Unit_Map();
		const block = layout.create_ldata("invalid");
		const attach = (readonly) => () => unit_map.attach_unit(1, block, { readonly });
		const range = (message) => ({ name: "RangeError", message });
		assert.throws(attach(true), range(/readonly must be none, all or a non-empty list of tag names/));
		assert.throws(attach("id"), range(/readonly must be none, all or a non-empty list of tag names/));
		assert.throws(attach([]), range(/readonly must be none, all or a non-empty list of tag names/));
		assert.throws(attach(["id", "nothing"]), range(/block invalid: readonly names tag nothing, which layout RO does not have/));
		assert.throws(attach(["id", "id"]), range(/readonly names tag id twice/));
		assert.throws(attach([7]), range(/readonly has 7, which is not a tag name/));
		assert.deepEqual(unit_map.unit_ids, []);
	});

	test("the unmapped options of a unit default to zero and ignore, and are checked", () => {
		const unit_map = new Unit_Map();
		assert.equal(unit_map.get_unmapped_read(1), "zero");
		assert.equal(unit_map.get_unmapped_write(1), "ignore");
		unit_map.set_unmapped_read(1, "refuse");
		unit_map.set_unmapped_write(1, "refuse");
		assert.equal(unit_map.get_unmapped_read(1), "refuse");
		assert.equal(unit_map.get_unmapped_write(1), "refuse");
		assert.equal(unit_map.get_unmapped_read(2), "zero");
		// set before the unit has a block, which does not make it a unit of the map
		assert.deepEqual(unit_map.unit_ids, []);
		assert.throws(() => unit_map.set_unmapped_read(1, "ignore"), { name: "RangeError", message: /unmapped_read must be one of zero, refuse/ });
		assert.throws(() => unit_map.set_unmapped_write(1, "zero"), { name: "RangeError", message: /unmapped_write must be one of ignore, refuse/ });
		assert.throws(() => unit_map.set_unmapped_write(256, "refuse"), { name: "RangeError", message: /unit_id must be an integer/ });
	});
});

describe("read-only points", () => {
	test("a read-only Real refuses an FC 16 that writes only one of its registers, and writes nothing", () => {
		const { block, handler, events } = make_unit({ readonly: ["pressure"] });
		block.get("pressure").value = 1.5;

		refused(() => handler.set_holding_registers(1, [0xffff, 0x1234], UNIT)); // status, then the first of pressure
		refused(() => handler.set_holding_registers(3, [0, 0], UNIT)); // the second of pressure, then low / high

		assert.equal(block.get("status").value, 0);
		assert.equal(block.get("pressure").value, 1.5);
		assert.deepEqual(events, [
			point("request_refused", "holding_register", 2, "write"),
			point("request_refused", "holding_register", 3, "write"),
		]);
	});

	test("a writable tag next to the read-only ones is written as usual", () => {
		const { block, handler, events } = make_unit({ readonly: ["pressure"] });
		handler.set_holding_registers(0, [9, 0x0101], UNIT);
		handler.set_holding_register(6, 42, UNIT);
		assert.deepEqual([block.get("id").value, block.get("status").value, block.get("last").value], [9, 0x0101, 42]);
		assert.deepEqual(events, []);
	});

	test("a read-only bit of a writable composite word refuses FC 6 / 16 of the word, not FC 5 / 15 of its other bits", () => {
		const { block, handler, events } = make_unit({ readonly: ["alarm"] });

		refused(() => handler.set_holding_register(1, 0x0100, UNIT));
		refused(() => handler.set_coil(16, true, UNIT)); // alarm
		handler.set_coil(24, true, UNIT); // run
		handler.set_coils(17, [true, false, true], UNIT); // the padding bits of the word next to alarm

		assert.equal(block.get("run").value, true);
		assert.equal(block.get("alarm").value, false);
		assert.equal(block.read_bytes(2, 1)[0], 0b0000_1010);
		assert.deepEqual(events, [
			point("request_refused", "holding_register", 1, "write"),
			point("request_refused", "coil", 16, "write"),
		]);
	});

	test("a read-only composite word makes its coupled bits read-only, and listing them too is allowed", () => {
		const { block, handler } = make_unit({ readonly: ["status", "run"] });
		refused(() => handler.set_coil(24, true, UNIT));
		refused(() => handler.set_coils(20, [false, false, false, false, false], UNIT)); // a padding bit of the word
		assert.equal(block.get("run").value, false);
	});

	test("a register shared by a read-only Byte and a writable one refuses FC 6 / 16, while FC 15 writes the writable byte", () => {
		const { block, handler, events } = make_unit({ readonly: ["low"] });

		refused(() => handler.set_holding_register(4, 0x0102, UNIT));
		refused(() => handler.set_holding_registers(4, [0x0102], UNIT));
		handler.set_coils(72, [true, true, true, true, true, true, true, true], UNIT); // the whole byte of high
		handler.set_coil(73, false, UNIT);

		assert.equal(block.get("low").value, 0);
		assert.equal(block.get("high").value, 0b1111_1101);
		// one key for both refusals
		assert.deepEqual(events, [point("request_refused", "holding_register", 4, "write")]);
	});

	test("an FC 15 that reaches one read-only bit is refused as a whole", () => {
		const { block, handler, events } = make_unit({ readonly: ["low"] });
		refused(() => handler.set_coils(70, [true, true, true, true], UNIT)); // coils 70, 71 of low, then 72, 73 of high
		assert.equal(block.get("high").value, 0);
		assert.deepEqual(events, [point("request_refused", "coil", 70, "write"), point("request_refused", "coil", 71, "write")]);
	});

	test("padding is writable, except with readonly: all", () => {
		const listed = make_unit({ readonly: ["id"] });
		listed.handler.set_holding_register(5, 0xabcd, UNIT);
		assert.equal(listed.block.read_bytes(10, 2).readUInt16BE(0), 0xabcd);

		const whole = make_unit({ readonly: "all" });
		refused(() => whole.handler.set_holding_register(5, 0xabcd, UNIT));
		refused(() => whole.handler.set_coil(80, true, UNIT));
		assert.equal(whole.block.read_bytes(10, 2).readUInt16BE(0), 0);
	});

	test("read-only points are readable", () => {
		const { block, handler, events } = make_unit({ readonly: "all" });
		block.get("id").value = 7;
		block.get("run").value = true;
		assert.deepEqual(handler.get_holding_registers(0, 2, UNIT), [7, 0x0001]); // run is bit 0 of byte 3
		assert.equal(handler.get_input_register(0, UNIT), 7);
		assert.deepEqual(handler.get_coils(24, 2, UNIT), [true, false]);
		assert.equal(handler.get_coil(24, UNIT), true);
		assert.deepEqual(events, []);
	});

	test("the mask is in the bytes of the block, whatever the byte order of the unit", () => {
		// LE reorders the registers of a block: block byte i is the IO byte io[i]
		const { block, handler, events } = make_unit({ readonly: ["pressure"] }, "LE");
		const io = layout.io_index_table("LE");
		// the IO registers that hold the bytes 4..7 of the block (pressure)
		const pressure_registers = [...new Set([4, 5, 6, 7].map((byte) => io[byte] >> 1))].sort();
		for (const addr of pressure_registers) refused(() => handler.set_holding_register(addr, 1, UNIT));
		const id_register = io[0] >> 1;
		handler.set_holding_register(id_register, 0x1234, UNIT);
		assert.notEqual(block.get("id").value, 0);
		assert.equal(events.length, 2);
	});

	test("a read-only tag outside the part a placement serves has no effect", () => {
		const block = layout.create_ldata("served");
		const unit_map = new Unit_Map();
		unit_map.attach_unit(UNIT, block, { offset: 4, readonly: ["id"] }); // id is before byte 4
		const handler = create_handler(unit_map);
		handler.set_holding_registers(0, [1, 2], UNIT); // pressure
		assert.ok(block.get("pressure").value !== 0);
	});
});

describe("unmapped addresses of a unit", () => {
	test("unmapped_write: refuse refuses a write across a gap, emits each unmapped point and no unmapped", () => {
		const { block, unit_map, handler, events } = make_unit();
		unit_map.set_unmapped_write(UNIT, "refuse");

		refused(() => handler.set_holding_registers(6, [1, 2, 3], UNIT)); // last, then registers 7, 8
		refused(() => handler.set_coil(200, true, UNIT));
		assert.equal(block.get("last").value, 0);
		// the reads are not concerned
		assert.deepEqual(handler.get_holding_registers(6, 2, UNIT), [0, 0]);

		assert.deepEqual(events, [
			point("request_refused", "holding_register", 7, "write"),
			point("request_refused", "holding_register", 8, "write"),
			point("request_refused", "coil", 200, "write"),
			point("unmapped", "holding_register", 7, "read"),
		]);
	});

	test("unmapped_read: refuse refuses FC 1 / 2 / 3 / 4 that reach an unmapped address", () => {
		const { handler, unit_map, events } = make_unit();
		unit_map.set_unmapped_read(UNIT, "refuse");

		refused(() => handler.get_holding_registers(6, 2, UNIT));
		refused(() => handler.get_input_registers(7, 1, UNIT));
		refused(() => handler.get_input_register(7, UNIT));
		refused(() => handler.get_coils(110, 4, UNIT)); // coils 110, 111 of last, then 112, 113
		refused(() => handler.get_coil(112, UNIT));
		assert.deepEqual(handler.get_holding_registers(0, 7, UNIT), [0, 0, 0, 0, 0, 0, 0]);
		// the writes are ignored as before
		handler.set_holding_register(9, 1, UNIT);

		assert.deepEqual(events, [
			point("request_refused", "holding_register", 7, "read"),
			point("request_refused", "input_register", 7, "read"),
			point("request_refused", "coil", 112, "read"),
			point("request_refused", "coil", 113, "read"),
			point("unmapped", "holding_register", 9, "write"),
		]);
	});

	test("a request that meets read-only and unmapped points emits both, in the order of the addresses", () => {
		const { handler, unit_map, events } = make_unit({ readonly: ["last"] });
		unit_map.set_unmapped_write(UNIT, "refuse");
		refused(() => handler.set_holding_registers(5, [1, 2, 3], UNIT)); // padding, last, register 7
		assert.deepEqual(events.map(({ addr }) => addr), [6, 7]);
	});

	test("a request refused for a read-only point emits no unmapped for its unmapped points", () => {
		const { handler, events } = make_unit({ readonly: ["last"] });
		refused(() => handler.set_holding_registers(6, [1, 2], UNIT)); // last, register 7: ignored by default
		assert.deepEqual(events, [point("request_refused", "holding_register", 6, "write")]);
	});
});

describe("flood suppression", () => {
	test("each event has its own 1024 keys and its own limit", () => {
		const { handler, unit_map, events } = make_unit({ readonly: "all" });
		unit_map.set_unmapped_write(UNIT, "refuse");
		// 1100 refused writes: the coils of the block, then unmapped ones
		for (let addr = 0; addr < 1100; addr++) refused(() => handler.set_coil(addr, true, UNIT));
		refused(() => handler.set_coil(0, true, UNIT));
		// the reads still emit unmapped
		handler.get_holding_register(1000, UNIT);

		const refusals = events.filter(({ name }) => name === "request_refused");
		assert.equal(refusals.length, 1024);
		assert.deepEqual(refusals[1023], point("request_refused", "coil", 1023, "write"));
		assert.deepEqual(events.filter(({ name }) => name.endsWith("_limit")), [{ name: "request_refused_limit", limit: 1024 }]);
		assert.deepEqual(events.at(-1), point("unmapped", "holding_register", 1000, "read"));
	});

	test("a read and a write of one unmapped address are two keys of unmapped", () => {
		const { handler, events } = make_unit();
		handler.get_holding_register(100, UNIT);
		handler.set_holding_register(100, 1, UNIT);
		handler.get_holding_register(100, UNIT);
		assert.deepEqual(events, [
			point("unmapped", "holding_register", 100, "read"),
			point("unmapped", "holding_register", 100, "write"),
		]);
	});
});

describe("refusals through a server", () => {
	/** Serves a unit of make_unit over TCP, or RTU over TCP with `rtu`, and returns a master of it. */
	async function serve(t, unit, { rtu = false, unit_ids } = {}) {
		const server = ephemeral(create_tcp_server(unit.unit_map, { host: HOST, rtu, unit_ids, handler: unit.handler }));
		const handler_errors = [];
		server.on("handler_error", (error) => handler_errors.push(error));
		await server.start();
		t.after(() => server.stop());
		const master = new Modbus_Client(master_options(listening_port(server), rtu));
		master.on("error", () => { });
		t.after(() => master.disconnect());
		return { server, master, handler_errors };
	}

	test("the master gets exception 0x02, and the server emits no handler_error", async (t) => {
		const unit = make_unit({ readonly: ["pressure"] });
		unit.unit_map.set_unmapped_read(UNIT, "refuse");
		const { master, handler_errors } = await serve(t, unit);

		await assert.rejects(master.write([6, 2, 1], 1, UNIT), { message: "response error: 2" });
		await assert.rejects(master.write([16, 1, 2], Buffer.from([0, 1, 0, 2]), UNIT), { message: "response error: 2" });
		await assert.rejects(master.read([3, 6, 2], UNIT), { message: "response error: 2" });
		await assert.rejects(master.read([2, 110, 4], UNIT), { message: "response error: 2" });
		assert.equal(await master.write([6, 0, 1], 5, UNIT), true);

		assert.equal(unit.block.get("id").value, 5);
		assert.equal(unit.block.get("status").value, 0);
		assert.deepEqual(handler_errors, []);
	});

	test("a refused broadcast on a serial bus writes nothing and still emits request_refused", async (t) => {
		const unit = make_unit();
		// a block at unit 0 too
		const broadcast = layout.create_ldata(`b${++block_seq}`);
		unit.unit_map.attach_unit(0, broadcast, { readonly: ["id"] });
		const { master } = await serve(t, unit, { rtu: true, unit_ids: [0, UNIT] });

		// a broadcast resolves once sent, as it is never answered
		assert.equal(await master.write([6, 0, 1], 5, 0), true);
		assert.equal(await master.write([6, 6, 1], 8, 0), true);
		// a request of UNIT after the broadcasts: they are served once it is answered
		assert.deepEqual(await master.read([3, 0, 1], UNIT), Buffer.from([0, 0]));

		assert.equal(broadcast.get("id").value, 0);
		assert.equal(broadcast.get("last").value, 8);
		assert.deepEqual(unit.events, [{ name: "request_refused", kind: "holding_register", unit_id: 0, addr: 0, operation: "write" }]);
	});
});

describe("descriptions", () => {
	const description = (units) => yaml`
layouts: [RO]
${ITEMS}
blocks:
  - { name: d, layout: RO }
units:
${units}
`;

	test("the unmapped options and readonly of a description are loaded", () => {
		const emulator = new Modbus_Emulator("readonly_test_load");
		const events = [];
		emulator.on("request_refused", (event) => events.push(event));
		emulator.on("request_refused_limit", (event) => events.push(event));
		emulator.load(description(`
  - unit_id: 1
    unmapped_read: refuse
    unmapped_write: refuse
    blocks:
      d: { readonly: [status] }
`));
		const { unit_map, handler } = emulator;
		assert.equal(unit_map.get_unmapped_read(1), "refuse");
		assert.equal(unit_map.get_unmapped_write(1), "refuse");
		assert.deepEqual(unit_map.segments(1)[0].readonly, ["status"]);
		refused(() => handler.set_coil(24, true, 1));
		assert.deepEqual(events, [{ kind: "coil", unit_id: 1, addr: 24, operation: "write" }]);
	});

	test("invalid unmapped options and readonly declarations are errors of the load", () => {
		const emulator = new Modbus_Emulator("readonly_test_errors");
		assert.throws(() => emulator.load(description(`
  - unit_id: 1
    unmapped_read: ignore
    unmapped_write: zero
    blocks:
      d: { readonly: [status, nothing, status], writable: true }
  - unit_id: 2
    blocks: {}
`)), (error) => {
			assert.deepEqual(error.errors, [
				"units[0]: unmapped_read must be one of zero, refuse",
				"units[0]: unmapped_write must be one of ignore, refuse",
				"units[0].blocks.d: unknown key writable",
				"units[0].blocks.d: readonly names tag nothing, which layout RO does not have",
				"units[0].blocks.d: readonly names tag status twice",
				"units[1]: blocks must be a non-empty mapping from block names to placements",
			]);
			return true;
		});
		assert.throws(() => emulator.load(description(`
  - { unit_id: 1, blocks: { d: { readonly: yes } } }
`)), { errors: ["units[0].blocks.d: readonly must be none, all or a non-empty list of tag names"] });
	});
});

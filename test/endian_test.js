import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { Modbus_Emulator, Unit_Map, create_handler, create_scope, yaml } from "./target.js";

// A unit serves the IO buffer of its blocks in its byte order (doc/spec.md 3): the registers and the
// coils of a unit are the bytes layout-data orders for that byte order (store_tag / load_tag).
const ENDIANS = ["BE", "LE", "BEBS", "LEBS"];
const UNIT = 1;

// 8 bytes: a Real (a 4-byte value), a UInt, a Bool at bit 0 of byte 6 and a spare Bool at bit 7 of byte 7
const LAYOUT = `
layouts: [DEVICE]
item_tables:
  DEVICE:
    - { name: r, type: Real, offset: 0, init_value: 1.5 }
    - { name: n, type: UInt, offset: 32, init_value: 7 }
    - { name: c, type: Bool, offset: 48, init_value: true }
    - { name: spare, type: Bool, offset: 63, init_value: false }
`;
const TAGS = ["r", "n", "c", "spare"];
const scope = create_scope("endian_test");
scope.load(yaml(LAYOUT));
const layout = scope.get_layout("DEVICE");
let block_seq = 0;

/** A block of the layout, served by a handler at byte 0 of a unit of the byte order. */
function make_unit(endian) {
	const block = layout.create_ldata(`block_${++block_seq}`);
	const unit_map = new Unit_Map();
	unit_map.set_endian(UNIT, endian);
	unit_map.attach_unit(UNIT, block, { start: 0 });
	return { block, unit_map, handler: create_handler(unit_map) };
}

/** The IO buffer of a block in a byte order, as layout-data orders it. */
function io_buffer_of(block, endian) {
	const io = new Uint8Array(block.size);
	for (const name of TAGS) block.store_tag(name, io, endian);
	return io;
}

/** The register values of an IO buffer. */
const registers_of = (io) => Array.from({ length: io.length / 2 }, (_, i) => (io[i * 2] << 8) | io[i * 2 + 1]);

describe("byte order of a unit", () => {
	test("the registers of a unit are the IO buffer of its block", () => {
		for (const endian of ENDIANS) {
			const { block, handler } = make_unit(endian);
			const expected = registers_of(io_buffer_of(block, endian));

			assert.deepEqual(handler.get_holding_registers(0, 4, UNIT), expected, endian);
			assert.deepEqual([0, 1, 2, 3].map((addr) => handler.get_input_register(addr, UNIT)), expected, endian);
		}
	});

	test("the IO buffers of the four byte orders", () => {
		// 1.5 is 3F C0 00 00 and 7 is 00 07 in big-endian
		const registers = Object.fromEntries(ENDIANS.map((endian) => [endian, make_unit(endian).handler.get_holding_registers(0, 3, UNIT)]));

		assert.deepEqual(registers, {
			BE: [0x3fc0, 0x0000, 0x0007],
			LE: [0x0000, 0xc03f, 0x0700],
			BEBS: [0xc03f, 0x0000, 0x0700],
			LEBS: [0x0000, 0x3fc0, 0x0007],
		});
	});

	test("a write of the registers is converted back to big-endian, once per block", () => {
		for (const endian of ENDIANS) {
			const { block, handler } = make_unit(endian);
			const source = layout.create_ldata(`source_${++block_seq}`);
			source.r = -2.25;
			source.n = 300;
			const writes = [];
			block.on("write", () => writes.push(endian));

			handler.set_holding_registers(0, registers_of(io_buffer_of(source, endian)).slice(0, 3), UNIT);

			assert.equal(block.r, -2.25, endian);
			assert.equal(block.n, 300, endian);
			assert.deepEqual(writes, [endian]);
		}
	});

	test("a batch read is one access per block, naming only the tags read", () => {
		for (const endian of ENDIANS) {
			const { block, handler } = make_unit(endian);
			const accesses = [];
			block.on("access", (kind, tags) => accesses.push(`${kind} ${tags.map((tag) => tag.name)}`));

			handler.get_holding_registers(0, 3, UNIT); // the Real and the UInt
			handler.get_holding_registers(2, 1, UNIT); // the UInt alone
			// from the second register of the Real: with LE and BEBS it is in bytes 0..1 of the block, apart from the UInt
			handler.get_holding_registers(1, 2, UNIT);

			assert.deepEqual(accesses, ["read r,n", "read n", "read r,n"], endian);
		}
	});

	test("a single register is read and written in the byte order", () => {
		const { block, handler } = make_unit("LE");

		handler.set_holding_register(2, 0x2c01, UNIT); // 300 is 01 2C, swapped

		assert.equal(block.n, 300);
		assert.equal(handler.get_holding_register(2, UNIT), 0x2c01);
	});

	test("half of a 4-byte value is the register of its IO buffer", () => {
		const { block, handler } = make_unit("LEBS");

		// LEBS swaps the two registers of the Real: register 1 holds its high word, 3F C0
		handler.set_holding_register(1, 0x4000, UNIT);

		assert.equal(block.r, 2);
		assert.deepEqual(handler.get_holding_registers(0, 2, UNIT), [0x0000, 0x4000]);
	});

	test("a coil is the bit of the byte of the IO buffer", () => {
		// the Bool is in byte 6 of the block: byte 7 of the IO buffer when the bytes of a register are swapped
		const coils = { BE: 48, LE: 56, BEBS: 56, LEBS: 48 };
		for (const endian of ENDIANS) {
			const { block, handler } = make_unit(endian);
			const coil = coils[endian];

			assert.equal(handler.get_coil(coil, UNIT), true, endian);
			assert.deepEqual(handler.get_coils(coil - 1, 3, UNIT), [false, true, false], endian);
			handler.set_coils(coil, [false], UNIT);
			assert.equal(block.c, false, endian);
			handler.set_coil(coil, true, UNIT);
			assert.equal(block.c, true, endian);
		}
	});
});

describe("Unit_Map byte order", () => {
	test("a unit is BE until its byte order is set, before or after its blocks are attached", () => {
		const unit_map = new Unit_Map();
		const block = layout.create_ldata(`block_${++block_seq}`);
		unit_map.attach_unit(UNIT, block, { start: 0 });
		const handler = create_handler(unit_map);
		assert.equal(unit_map.get_endian(UNIT), "BE");
		assert.equal(handler.get_holding_register(2, UNIT), 0x0007);

		unit_map.set_endian(UNIT, "LE");
		assert.equal(unit_map.get_endian(UNIT), "LE");
		assert.equal(handler.get_holding_register(2, UNIT), 0x0700);

		unit_map.set_endian(UNIT, "BE");
		assert.equal(handler.get_holding_register(2, UNIT), 0x0007);
	});

	test("a byte order alone does not make a unit of unit_ids", () => {
		const unit_map = new Unit_Map();
		unit_map.set_endian(5, "BEBS");

		assert.deepEqual(unit_map.unit_ids, []);
		assert.equal(unit_map.get_endian(5), "BEBS");
	});

	test("an invalid unit id or byte order is a RangeError", () => {
		const unit_map = new Unit_Map();

		assert.throws(() => unit_map.set_endian(256, "LE"), { name: "RangeError", message: /unit_id must be an integer from 0 to 255/ });
		assert.throws(() => unit_map.set_endian(1, "le"), { name: "RangeError", message: /unknown byte order le/ });
		assert.equal(unit_map.get_endian(1), "BE");
	});

	test("resolve gives the offset in the IO buffer", () => {
		const { block, unit_map } = make_unit("LE");

		assert.deepEqual(unit_map.resolve(UNIT, 1), { block, offset: 1 });
	});
});

test("the units of a description serve their blocks in their byte orders", () => {
	const emulator = new Modbus_Emulator("endian_test_emulator");
	emulator.load(yaml(`${LAYOUT}
blocks:
  - { name: be, layout: DEVICE }
  - { name: le, layout: DEVICE }
units:
  - { unit_id: 1, blocks: { be: {} } }
  - { unit_id: 2, endian: LE, blocks: { le: { start: 4, offset: 4 } } }
`));
	const { handler } = emulator;

	assert.deepEqual(handler.get_holding_registers(0, 3, 1), [0x3fc0, 0x0000, 0x0007]);
	// bytes 4..7 of the IO buffer of le at bytes 4..7 of unit 2
	assert.deepEqual(handler.get_holding_registers(2, 1, 2), [0x0700]);
	assert.equal(handler.get_coil(7 * 8, 2), true);
});

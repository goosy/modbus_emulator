import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test, { describe } from "node:test";
import { Modbus_Client } from "es-modbus";
import { Unit_Map, create_tcp_server, create_rtu_server, create_handler } from "../src/index.js";
import { HOST, listening_port } from "./helpers.js";

const UNIT = 5;
const OTHER_UNIT = 9; // never attached: the server answers exception 0x0B

/**
 * A minimal Ldata stand-in: the server reads through read_bytes and read_bit
 * and writes through write_bytes and write_bit, in a transaction for a batch request;
 * check_count counts the writes. `buffer` is the content, for the assertions only.
 */
function fake_block(size) {
	const buffer = Buffer.alloc(size);
	for (let i = 0; i < size; i++) buffer[i] = i & 0xff;
	return {
		buffer,
		size,
		check_count: 0,
		read_bytes(offset = 0, length = size - offset) {
			return Buffer.from(buffer.subarray(offset, offset + length));
		},
		read_bit(offset, mask) {
			return (buffer[offset] & mask) !== 0;
		},
		write_bytes(offset, source) {
			buffer.set(source, offset);
			this.check_count++;
		},
		write_bit(offset, mask, value) {
			buffer[offset] = value ? buffer[offset] | mask : buffer[offset] & ~mask;
			this.check_count++;
		},
		transaction(fn) {
			const saved = Buffer.from(buffer);
			try {
				return fn();
			} catch (error) {
				saved.copy(buffer);
				throw error;
			}
		},
	};
}

/**
 * Starts a server with one unit: `data` at byte 0 and `command` at byte 400.
 */
async function start_server(t, options) {
	const data = fake_block(32);
	const command = fake_block(16);
	const unit_map = new Unit_Map();
	unit_map.attach_unit(UNIT, data, 0);
	unit_map.attach_unit(UNIT, command, 400);
	const server = create_tcp_server(unit_map, { host: HOST, port: 0, ...options });
	await server.start();
	t.after(() => server.stop());
	return { server, port: listening_port(server), data, command };
}

describe("create_tcp_server", () => {
	/** Starts a server and an es-modbus client in the master role. */
	async function setup(t, { rtu = false } = {}) {
		const ctx = await start_server(t, { rtu });
		const master = new Modbus_Client(HOST, { port: ctx.port, reconnect_time: 0, rtu });
		master.on("error", () => { });
		t.after(() => master.disconnect());
		return { ...ctx, master };
	}

	test("serves holding and input registers big-endian", async (t) => {
		const { master, data } = await setup(t);

		assert.deepEqual(await master.read([3, 1, 2], UNIT), data.buffer.subarray(2, 6));
		assert.deepEqual(await master.read([4, 1, 2], UNIT), data.buffer.subarray(2, 6));
	});

	test("routes addresses to the Ldata attached at them", async (t) => {
		const { master, data, command } = await setup(t);

		// register 200 is byte 400, the start of command
		assert.deepEqual(await master.read([3, 200, 2], UNIT), command.buffer.subarray(0, 4));
		assert.equal(await master.write([16, 201, 1], Buffer.from([0x12, 0x34]), UNIT), true);

		assert.deepEqual(command.buffer.subarray(2, 4), Buffer.from([0x12, 0x34]));
		assert.equal(command.check_count, 1);
		assert.equal(data.check_count, 0);
	});

	test("register writes update the buffer and check the tags", async (t) => {
		const { master, data } = await setup(t);

		assert.equal(await master.write([6, 3, 1], 0xbeef, UNIT), true);
		assert.equal(await master.write([16, 4, 2], Buffer.from([1, 2, 3, 4]), UNIT), true);

		assert.equal(data.buffer.readUInt16BE(6), 0xbeef);
		assert.deepEqual(data.buffer.subarray(8, 12), Buffer.from([1, 2, 3, 4]));
		assert.equal(data.check_count, 2); // one for FC 6, one for the run of FC 16
	});

	test("coil addr maps to bit addr % 8 of byte addr >> 3", async (t) => {
		const { master, data } = await setup(t);
		data.buffer[1] = 0b0000_0010; // coil 9 set, coils 8 and 10..15 clear

		assert.deepEqual(await master.read([1, 8, 8], UNIT), Buffer.from([0b0000_0010]));
		assert.deepEqual(await master.read([2, 9, 1], UNIT), Buffer.from([1]));

		assert.equal(await master.write([5, 12, 1], true, UNIT), true);
		assert.equal(await master.write([5, 9, 1], false, UNIT), true);
		assert.equal(data.buffer[1], 0b0001_0000);
		assert.equal(data.check_count, 2);
	});

	test("a unit that is not attached is answered with exception 0x0B", async (t) => {
		const { master } = await setup(t);

		await assert.rejects(master.read([3, 0, 1], OTHER_UNIT), { message: "response error: 11" });
	});

	test("an unmapped address reads as 0 and ignores writes", async (t) => {
		const { master, data, command } = await setup(t);
		const data_before = Buffer.from(data.buffer);
		const command_before = Buffer.from(command.buffer);

		// registers 16..199 lie between data (bytes 0..31) and command (from byte 400)
		assert.deepEqual(await master.read([3, 14, 4], UNIT), Buffer.concat([data.buffer.subarray(28, 32), Buffer.alloc(4)]));
		assert.equal(await master.write([16, 100, 2], Buffer.from([1, 2, 3, 4]), UNIT), true);
		assert.equal(await master.write([5, 1000, 1], true, UNIT), true);
		assert.deepEqual(await master.read([1, 1000, 1], UNIT), Buffer.from([0]));

		assert.deepEqual(data.buffer, data_before);
		assert.deepEqual(command.buffer, command_before);
		assert.equal(data.check_count + command.check_count, 0);
	});

	test("rtu: true serves RTU framing over the TCP socket", async (t) => {
		const { master, server, data } = await setup(t, { rtu: true });

		assert.equal(server.protocol, "rtu_over_tcp");
		assert.deepEqual(await master.read([3, 1, 2], UNIT), data.buffer.subarray(2, 6));
		assert.equal(await master.write([6, 3, 1], 0xbeef, UNIT), true);
		assert.equal(data.buffer.readUInt16BE(6), 0xbeef);
	});

	test("unit_ids limits the units a server answers", async (t) => {
		const unit_map = new Unit_Map();
		unit_map.attach_unit(UNIT, fake_block(8), 0);
		unit_map.attach_unit(OTHER_UNIT, fake_block(8), 0);
		const connect = async (unit_ids) => {
			const server = create_tcp_server(unit_map, { host: HOST, port: 0, unit_ids });
			await server.start();
			t.after(() => server.stop());
			const master = new Modbus_Client(HOST, { port: listening_port(server), reconnect_time: 0 });
			master.on("error", () => { });
			t.after(() => master.disconnect());
			return master;
		};
		const only_unit = await connect([UNIT]);
		const both = await connect();

		assert.equal((await only_unit.read([3, 0, 1], UNIT)).length, 2);
		await assert.rejects(only_unit.read([3, 0, 1], OTHER_UNIT), { message: "response error: 11" });
		// by default every unit of the map is answered
		assert.equal((await both.read([3, 0, 1], UNIT)).length, 2);
		assert.equal((await both.read([3, 0, 1], OTHER_UNIT)).length, 2);
	});

	test("the default unit_ids are the units of the map when the server is created", async (t) => {
		const unit_map = new Unit_Map();
		unit_map.attach_unit(UNIT, fake_block(8), 0);
		const server = create_tcp_server(unit_map, { host: HOST, port: 0 });
		await server.start();
		t.after(() => server.stop());
		const master = new Modbus_Client(HOST, { port: listening_port(server), reconnect_time: 0 });
		master.on("error", () => { });
		t.after(() => master.disconnect());

		unit_map.attach_unit(OTHER_UNIT, fake_block(8), 0);
		await assert.rejects(master.read([3, 0, 1], OTHER_UNIT), { message: "response error: 11" });

		// answering a later unit is the configuration of the server
		server.set_unit_ids(unit_map.unit_ids);
		assert.equal((await master.read([3, 0, 1], OTHER_UNIT)).length, 2);
	});

	test("the plain server uses the tcp protocol", async (t) => {
		const { server } = await setup(t);

		assert.equal(server.protocol, "tcp");
	});

	test("the handler emits an unmapped address once", async (t) => {
		const unmapped = [];
		const ctx = await start_server(t);
		ctx.server.handler.on("unmapped", (event) => unmapped.push(event));
		const master = new Modbus_Client(HOST, { port: ctx.port, reconnect_time: 0 });
		master.on("error", () => { });
		t.after(() => master.disconnect());

		await master.read([3, 100, 1], UNIT);
		await master.read([3, 100, 1], UNIT);

		assert.deepEqual(unmapped, [{ kind: "holding_register", unit_id: UNIT, addr: 100 }]);
	});

	test("the unmapped addresses stop after 1024, with one unmapped_limit", () => {
		const unmapped = [];
		const limits = [];
		const handler = create_handler(new Unit_Map());
		handler.on("unmapped", (event) => unmapped.push(event));
		handler.on("unmapped_limit", (event) => limits.push(event));

		for (let addr = 0; addr < 1100; addr++) handler.get_holding_register(addr, UNIT);
		handler.get_holding_register(0, UNIT);

		assert.equal(unmapped.length, 1024);
		assert.deepEqual(unmapped[1023], { kind: "holding_register", unit_id: UNIT, addr: 1023 });
		assert.deepEqual(limits, [{ limit: 1024 }]);
	});

	test("the name option names the server", () => {
		const server = create_tcp_server(new Unit_Map(), { host: HOST, port: 0, name: "plant" });

		assert.equal(server.name, "plant");
	});
});

describe("create_rtu_server", () => {
	test("creates an RTU slave on a serial port path without opening it", () => {
		const unit_map = new Unit_Map();
		unit_map.attach_unit(UNIT, fake_block(8), 0);

		const server = create_rtu_server("COM_TEST", unit_map, { baud_rate: 19200, parity: "even" });

		assert.equal(server.protocol, "rtu");
		assert.equal(server.is_tcp, false);
		assert.equal(server.port, "COM_TEST");
		assert.ok(server.is_valid_unit_id(UNIT));
		assert.ok(!server.is_valid_unit_id(OTHER_UNIT));
	});

	test("unit_ids limits the units a serial server answers", () => {
		const unit_map = new Unit_Map();
		unit_map.attach_unit(UNIT, fake_block(8), 0);
		unit_map.attach_unit(OTHER_UNIT, fake_block(8), 0);

		const server = create_rtu_server("COM_TEST", unit_map, { unit_ids: [OTHER_UNIT] });

		assert.ok(!server.is_valid_unit_id(UNIT));
		assert.ok(server.is_valid_unit_id(OTHER_UNIT));
	});

	test("an invalid serial setting or path throws", () => {
		assert.throws(() => create_rtu_server("", new Unit_Map()), /Invalid serial port path/);
		assert.throws(() => create_rtu_server("COM_TEST"), /unit_map is required/);
		assert.throws(() => create_tcp_server(), /unit_map is required/);
		assert.throws(() => create_rtu_server("COM_TEST", new Unit_Map(), { baud_rate: -1 }));
	});
});

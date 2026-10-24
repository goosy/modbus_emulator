import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtempSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { describe } from "node:test";
import { Modbus_Client } from "es-modbus";
import { Modbus_Emulator, Ldata, Ltag, register_layout, get_layout, io_index_table, render_types } from "../src/index.js";
import { HOST, hold_port, listening_port } from "./helpers.js";

const dir = mkdtempSync(join(tmpdir(), "modbus-emulator-"));
let file_seq = 0;

const LAYOUTS = `
layouts:
  PUMP:
    - { name: id, type: UInt, offset: 0, init_value: 7 }
    - name: status
      type: Word
      offset: 16
      coupling:
        - { name: run, type: Bool, offset: 8, init_value: false }
        - { name: alarm, type: Bool, offset: 0, init_value: false }
    - { name: pressure, type: Real, offset: 32, init_value: 1.5 }
  SETTING:
    - { name: limit, type: UInt, offset: 0, init_value: 100 }
    - { name: spare, type: UInt, offset: 16, init_value: 0 }
`;

/** Writes an emulator file and returns its path. */
function write_file(text) {
	const file = join(dir, `emulator_${++file_seq}.yaml`);
	writeFileSync(file, text);
	return file;
}

// register_layout can succeed only once per process: every layout of this file is registered here,
// and the descriptions below only name them (layout registration is tested in layout_test.js)
register_layout([
	write_file(LAYOUTS),
	{ layouts: { ONE: [{ name: "a", type: "UInt", offset: 0, init_value: 5 }] } },
]);

const make = (blocks_and_servers, options) => new Modbus_Emulator(write_file(blocks_and_servers), options);

const errors_of = (blocks_and_servers) => {
	try {
		make(blocks_and_servers);
	} catch (e) {
		return e.errors;
	}
	return null;
};

describe("Modbus_Emulator description", () => {
	test("creates an Ldata per block and attaches it to its unit", () => {
		const emulator = make(`
blocks:
  - { name: pump, unit_id: 1, layout: PUMP }
  - { name: setting, unit_id: 1, layout: SETTING, start: 400 }
  - { name: other, unit_id: 2, layout: PUMP }
servers:
  - { protocol: tcp, port: 1502 }
  - { protocol: rtu_over_tcp, port: 1503 }
  - { protocol: rtu, port: COM_TEST, baud_rate: 19200 }
`);

		assert.deepEqual([...emulator.blocks.keys()], ["pump", "setting", "other"]);
		assert.equal(emulator.block("pump").id, 7);
		assert.equal(emulator.block("setting").limit, 100);
		assert.deepEqual(emulator.unit_map.unit_ids, [1, 2]);
		assert.equal(emulator.unit_map[1].length, 2);
		assert.deepEqual(emulator.servers.map((server) => server.protocol), ["tcp", "rtu_over_tcp", "rtu"]);
	});

	test("a block without a name is named after its unit", () => {
		const emulator = make(`
blocks:
  - { unit_id: 3, layout: PUMP }
servers:
  - { protocol: tcp, port: 1502 }
`);

		assert.ok(emulator.block("unit_3"));
	});

	test("reports every violation at once", () => {
		const errors = errors_of(`
blocks:
  - { name: a, unit_id: 300, layout: PUMP }
  - { name: b, unit_id: 1, layout: NONE }
  - { name: c, unit_id: 1, layout: PUMP, start: 3 }
  - { name: d, unit_id: 1, layout: PUMP }
  - { name: d, unit_id: 2, layout: PUMP }
servers:
  - { protocol: udp, port: 1 }
  - { protocol: rtu, port: 5 }
  - { protocol: tcp, port: abc }
`);

		assert.equal(errors.length, 7, JSON.stringify(errors));
		assert.match(errors[0], /servers\[0\]: protocol must be one of/);
		assert.match(errors.join("\n"), /blocks\[0\]: unit_id/);
		assert.match(errors.join("\n"), /blocks\[1\]: unknown layout NONE/);
		assert.match(errors.join("\n"), /blocks\[2\]: start must be an even/);
		assert.match(errors.join("\n"), /blocks\[4\]: duplicated block name d/);
	});

	test("a server answers the units of its unit_ids, the others all units", () => {
		const emulator = make(`
blocks:
  - { name: a, unit_id: 1, layout: PUMP }
  - { name: b, unit_id: 2, layout: PUMP }
servers:
  - { protocol: tcp, port: 1502, unit_ids: [1] }
  - { protocol: rtu, port: COM_TEST, unit_ids: [2] }
  - { protocol: rtu_over_tcp, port: 1503 }
`);
		const [tcp, rtu, rtu_over_tcp] = emulator.servers;

		assert.deepEqual([1, 2].map((id) => tcp.is_valid_unit_id(id)), [true, false]);
		assert.deepEqual([1, 2].map((id) => rtu.is_valid_unit_id(id)), [false, true]);
		assert.deepEqual([1, 2].map((id) => rtu_over_tcp.is_valid_unit_id(id)), [true, true]);
	});

	test("unit_ids must be valid and name units that have a block", () => {
		const errors = errors_of(`
blocks:
  - { name: a, unit_id: 1, layout: PUMP }
servers:
  - { protocol: tcp, port: 1502, unit_ids: [] }
  - { protocol: tcp, port: 1503, unit_ids: 1 }
  - { protocol: tcp, port: 1504, unit_ids: [256] }
  - { protocol: tcp, port: 1505, unit_ids: [1, 7] }
`);

		assert.equal(errors.length, 4, JSON.stringify(errors));
		assert.match(errors.join("\n"), /servers\[0\]: unit_ids must be a non-empty list/);
		assert.match(errors.join("\n"), /servers\[1\]: unit_ids must be a non-empty list/);
		assert.match(errors.join("\n"), /servers\[2\]: unit_ids must be a non-empty list/);
		assert.match(errors.join("\n"), /servers\[3\]: unit_ids has unit 7, which has no block/);
	});

	test("offset must be even", () => {
		const errors = errors_of(`
blocks:
  - { name: a, unit_id: 1, layout: PUMP, offset: 1 }
servers:
  - { protocol: tcp, port: 1502 }
`);

		assert.deepEqual(errors, ["blocks[0]: offset must be an even non-negative byte offset"]);
	});

	test("an unknown key of a block or a server is an error", () => {
		const errors = errors_of(`
blocks:
  - { name: a, unitid: 1, unit_id: 1, layout: PUMP }
  - { name: b, unit_id: 2, layout: PUMP, sart: 4 }
servers:
  - { protocol: tcp, port: 1502, baud_rate: 9600 }
  - { protocol: rtu, port: COM_TEST, host: 0.0.0.0 }
`);

		assert.deepEqual(errors, [
			"servers[0]: unknown key baud_rate",
			"servers[1]: unknown key host",
			"blocks[0]: unknown key unitid",
			"blocks[1]: unknown key sart",
		]);
	});

	test("a TCP port is from 0 to 65535", () => {
		const errors = errors_of(`
blocks:
  - { name: a, unit_id: 1, layout: PUMP }
servers:
  - { protocol: tcp, port: 99999 }
  - { protocol: rtu_over_tcp, port: -1 }
`);

		assert.equal(errors.length, 2, JSON.stringify(errors));
		assert.match(errors.join("\n"), /servers\[0\]: port must be a TCP port number from 0 to 65535/);
		assert.match(errors.join("\n"), /servers\[1\]: port must be a TCP port number from 0 to 65535/);
	});

	test("two servers may not use the same address or serial port", () => {
		const errors = errors_of(`
blocks:
  - { name: a, unit_id: 1, layout: PUMP }
servers:
  - { protocol: tcp }
  - { protocol: rtu_over_tcp, host: 0.0.0.0, port: 502 }
  - { protocol: rtu, port: COM_TEST }
  - { protocol: rtu, port: COM_TEST }
`);

		assert.deepEqual(errors, [
			"servers[1]: port 0.0.0.0:502 is already used by servers[0]",
			"servers[3]: port COM_TEST is already used by servers[2]",
		]);
	});

	test("port 0 and the same port on different hosts may repeat", () => {
		const emulator = make(`
blocks:
  - { name: a, unit_id: 1, layout: PUMP }
servers:
  - { protocol: tcp, port: 0 }
  - { protocol: tcp, port: 0 }
  - { protocol: tcp, host: 127.0.0.1, port: 1502 }
  - { protocol: tcp, host: 0.0.0.0, port: 1502 }
`);

		assert.equal(emulator.servers.length, 4);
	});

	test("a file that cannot be read is reported in errors", () => {
		const missing = join(dir, "missing.yaml");
		const file = write_file(`
blocks:
  - { name: a, unit_id: 1, layout: PUMP }
servers:
  - { protocol: tcp, port: 1502 }
`);

		assert.throws(() => new Modbus_Emulator(missing), (e) => e.errors.length === 1
			&& e.errors[0].startsWith("cannot read the file: ENOENT"));
		assert.throws(() => new Modbus_Emulator([file, missing]), (e) => e.errors.length === 1
			&& e.errors[0].startsWith(`${missing}: cannot read the file: ENOENT`));
	});

	test("blocks and servers are required", () => {
		assert.deepEqual(errors_of("{}"), [
			"the root key `servers` must be a non-empty list",
			"the root key `blocks` must be a non-empty list",
		]);
	});
});

describe("Modbus_Emulator object description", () => {
	const SERVERS = [{ protocol: "tcp", port: 1502 }];

	test("takes the description as an object", () => {
		const emulator = new Modbus_Emulator({
			blocks: [{ name: "one", unit_id: 4, layout: "ONE" }],
			servers: SERVERS,
		});

		assert.equal(emulator.block("one").a, 5);
		assert.deepEqual(emulator.unit_map.unit_ids, [4]);
	});
});

describe("Modbus_Emulator service", () => {
	async function start(t, options) {
		const emulator = make(`
blocks:
  - { name: pump, unit_id: 1, layout: PUMP }
servers:
  - { protocol: tcp, host: ${HOST}, port: 0 }
`, options);
		await emulator.start();
		t.after(() => emulator.stop());
		const port = listening_port(emulator.servers[0]);
		const master = new Modbus_Client(HOST, { port, reconnect_time: 0 });
		master.on("error", () => { });
		t.after(() => master.disconnect());
		return { emulator, master, pump: emulator.block("pump") };
	}

	/** Whether a TCP port of HOST accepts a connection. */
	function is_listening(port) {
		return new Promise((resolve) => {
			const socket = net.connect({ host: HOST, port });
			socket.on("connect", () => {
				socket.destroy();
				resolve(true);
			});
			socket.on("error", () => resolve(false));
		});
	}

	/**
	 * An emulator of two servers, whose second one cannot listen on its port, already taken.
	 * `free()` is the port the first server listened on: it is recorded at its start, since
	 * a server stopped by the failed start no longer has an address.
	 */
	async function emulator_with_taken_port(t) {
		const { holder, port: taken } = await hold_port();
		t.after(() => new Promise((resolve) => holder.close(resolve)));
		const emulator = make(`
blocks:
  - { name: pump, unit_id: 1, layout: PUMP }
servers:
  - { protocol: tcp, host: ${HOST}, port: 0 }
  - { protocol: tcp, host: ${HOST}, port: ${taken} }
`);
		t.after(() => emulator.stop());
		let first_port;
		emulator.servers[0].once("start", () => { first_port = listening_port(emulator.servers[0]); });
		return { emulator, free: () => first_port, taken };
	}

	/** Checks the AggregateError of a start that failed on the taken port. */
	function check_start_error(e, taken) {
		assert.ok(e instanceof AggregateError);
		assert.equal(e.errors.length, 1);
		assert.ok(e.errors[0].message.startsWith(`servers[1] (modbus://${HOST}:${taken}): `), e.errors[0].message);
		assert.equal(e.errors[0].cause.code, "EADDRINUSE");
		return true;
	}

	test("a failed start stops all the servers", async (t) => {
		const { emulator, free, taken } = await emulator_with_taken_port(t);

		await assert.rejects(emulator.start(), (e) => check_start_error(e, taken));
		assert.equal(await is_listening(free()), false);
	});

	test("a failed partial start leaves the started servers running", async (t) => {
		const { emulator, free, taken } = await emulator_with_taken_port(t);

		await assert.rejects(emulator.start({ partial: true }), (e) => check_start_error(e, taken));
		assert.equal(await is_listening(free()), true);
	});

	test("a master reads what the program sets through the tags", async (t) => {
		const { master, pump } = await start(t);

		pump.run = true;
		pump.pressure = 2.5;

		const registers = await master.read([3, 0, 4], 1);
		assert.equal(registers.readUInt16BE(0), 7);
		assert.equal(registers.readUInt16BE(2), 0x0001);
		assert.equal(registers.readFloatBE(4), 2.5);
	});

	test("a write of the master changes the tags and emits the change", async (t) => {
		const { master, pump } = await start(t);
		const changes = [];
		pump.get("alarm").on("change", (old_value, new_value) => changes.push([old_value, new_value]));

		assert.equal(await master.write([5, 16, 1], true, 1), true); // coil 16 is bit 0 of byte 2: alarm

		assert.equal(pump.alarm, true);
		assert.deepEqual(changes, [[false, true]]);
	});

	test("each write of a master emits the write event of the block", async (t) => {
		const written = [];
		const { master, pump } = await start(t);
		pump.on("write", (block) => written.push(block.name));

		await master.write([6, 0, 1], 9, 1);

		assert.deepEqual(written, ["pump"]);
	});

	test("two servers share the blocks and each answers only its units", async (t) => {
		const emulator = make(`
blocks:
  - { name: a, unit_id: 1, layout: PUMP }
  - { name: b, unit_id: 2, layout: PUMP }
servers:
  - { protocol: tcp, host: ${HOST}, port: 0, unit_ids: [1] }
  - { protocol: rtu_over_tcp, host: ${HOST}, port: 0, unit_ids: [1, 2] }
`);
		await emulator.start();
		t.after(() => emulator.stop());
		const [port_a, port_b] = emulator.servers.map(listening_port);
		const connect = (port, rtu) => {
			const master = new Modbus_Client(HOST, { port, rtu, reconnect_time: 0 });
			master.on("error", () => { });
			t.after(() => master.disconnect());
			return master;
		};
		const tcp = connect(port_a, false);
		const rtu = connect(port_b, true);

		// a write over the TCP server is seen over the other one: one shared block
		assert.equal(await tcp.write([6, 0, 1], 42, 1), true);
		assert.equal(emulator.block("a").id, 42);
		assert.equal((await rtu.read([3, 0, 1], 1)).readUInt16BE(0), 42);
		assert.equal((await rtu.read([3, 0, 1], 2)).readUInt16BE(0), 7);
		await assert.rejects(tcp.read([3, 0, 1], 2), { message: "response error: 11" });
	});

	test("all the servers share one handler and the unmapped warning is reported once", async (t) => {
		const warnings = [];
		const emulator = make(`
blocks:
  - { name: a, unit_id: 1, layout: PUMP }
servers:
  - { protocol: tcp, host: ${HOST}, port: 0 }
  - { protocol: tcp, host: ${HOST}, port: 0 }
`, { logger: { warn: (message) => warnings.push(message) } });
		await emulator.start();
		t.after(() => emulator.stop());
		const masters = emulator.servers.map(listening_port).map((port) => {
			const master = new Modbus_Client(HOST, { port, reconnect_time: 0 });
			master.on("error", () => { });
			t.after(() => master.disconnect());
			return master;
		});

		for (const master of masters) await master.read([3, 1000, 1], 1);

		assert.ok(emulator.handler);
		assert.equal(warnings.length, 1);
	});

	test("the emulator can be stopped and started again", async (t) => {
		const { emulator, master, pump } = await start(t);
		await emulator.stop();
		await emulator.start();

		const retry = new Modbus_Client(HOST, { port: listening_port(emulator.servers[0]), reconnect_time: 0 });
		retry.on("error", () => { });
		t.after(() => retry.disconnect());
		assert.deepEqual(await retry.read([3, 0, 1], 1), Buffer.from([0, pump.id]));
		assert.ok(master);
	});
});

describe("layout-data forwarded by the package", () => {
	test("the forwarded Ldata is the class of the blocks, and the functions are the ones in use", () => {
		const emulator = make(`
blocks:
  - { name: pump, unit_id: 1, layout: PUMP }
servers:
  - { protocol: tcp, port: 1502 }
`);

		assert.ok(emulator.block("pump") instanceof Ldata);
		assert.equal(get_layout("PUMP"), emulator.block("pump").layout);
		assert.equal(typeof register_layout, "function");
		assert.equal(typeof io_index_table, "function");
		assert.equal(typeof render_types, "function");
		assert.equal(typeof Ltag, "function");
	});
});

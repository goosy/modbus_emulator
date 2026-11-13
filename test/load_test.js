import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Modbus_Emulator } from "./target.js";
import { HOST, ephemeral, listening_port } from "./helpers.js";

// An emulator loads descriptions any number of times, each load all or nothing, checked against what the
// earlier loads gave
const dir = mkdtempSync(join(tmpdir(), "modbus-emulator-load-"));
let file_seq = 0;

/** Writes a description of the layout ONE (2 bytes) with the blocks, units and servers given, and returns its path. */
const description_of = ({ blocks, units, servers, layout = "ONE", init_value = 5 }) => {
	const file = join(dir, `description_${++file_seq}.yaml`);
	writeFileSync(file, JSON.stringify({
		layouts: [layout],
		item_tables: { [layout]: [{ name: "a", type: "UInt", offset: 0, init_value }] },
		blocks,
		units,
		servers,
	}));
	return file;
};

/** A block entry. */
const block = (name, layout = "ONE") => ({ name, layout });

/** A unit entry that places blocks: a name places it at byte 0, [name, start] at the start given. */
const unit = (unit_id, ...placed) => ({
	unit_id,
	blocks: Object.fromEntries(placed.map((item) => (Array.isArray(item) ? [item[0], { start: item[1] }] : [item, {}]))),
});

let scope_seq = 0;
const new_emulator = () => new Modbus_Emulator(`load_test_${++scope_seq}`);

const errors_of = (emulator, description) => {
	try {
		emulator.load(description);
	} catch (e) {
		return e.errors;
	}
	assert.fail("the load did not fail");
};

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

test("the constructor loads nothing, and each load adds blocks and servers", () => {
	const emulator = new_emulator();
	assert.equal(emulator.blocks.size, 0);
	assert.equal(emulator.servers.length, 0);

	const first = emulator.load(description_of({ blocks: [block("x")], units: [unit(1, "x")] }));
	const second = emulator.load(description_of({
		blocks: [block("y")],
		units: [unit(2, ["y", 2])],
		servers: [{ protocol: "tcp", port: 1502 }],
	}));

	assert.deepEqual([...first.blocks.keys()], ["x"]);
	assert.deepEqual(first.servers, []);
	assert.deepEqual([...second.blocks.keys()], ["y"]);
	assert.deepEqual(second.servers, emulator.servers);
	assert.deepEqual([...emulator.blocks.keys()], ["x", "y"]);
	assert.deepEqual(emulator.unit_map.unit_ids, [1, 2]);
	assert.equal(emulator.unit_map.segments(2)[0].start, 2);
	assert.equal(emulator.layouts.ONE, emulator.scope.get_layout("ONE"));
});

test("a description of servers only, then one of blocks only", () => {
	const emulator = new_emulator();
	emulator.load(description_of({ servers: [{ protocol: "tcp", port: 1502 }] }));
	const [server] = emulator.servers;
	assert.equal(server.is_valid_unit_id(1), false);

	emulator.load(description_of({ blocks: [block("x")], units: [unit(1, "x")] }));
	assert.equal(server.is_valid_unit_id(1), true);
});

test("the entries are numbered after the ones of the earlier loads", () => {
	const emulator = new_emulator();
	emulator.load(description_of({ blocks: [block("x")], units: [unit(1, "x")], servers: [{ protocol: "tcp", port: 1502 }] }));

	assert.deepEqual(errors_of(emulator, description_of({
		blocks: [block("y"), { name: "z", layout: "ONE", unit_id: 2 }],
		units: [unit(300, "y", "z")],
		servers: [{ protocol: "udp" }],
	})), [
		"servers[1]: protocol must be one of tcp, rtu_over_tcp, rtu",
		"blocks[2]: unknown key unit_id",
		"units[1]: unit_id must be an integer from 0 to 255",
	]);
	emulator.load(description_of({ servers: [{ protocol: "tcp", port: 1503 }] }));
	assert.equal(emulator.servers[1].name, "servers[1] (modbus://0.0.0.0:1503)");
});

test("a failed load leaves the emulator and the scope as they were", () => {
	const emulator = new_emulator();
	emulator.load(description_of({ blocks: [block("x")], units: [unit(1, "x")], servers: [{ protocol: "tcp", port: 1502 }] }));
	const unit_ids = emulator.servers[0].unit_ids;

	// a unit of an earlier load, in a description of a layout new to the scope
	assert.deepEqual(errors_of(emulator, description_of({
		layout: "NEW",
		blocks: [block("y", "NEW"), block("z", "NEW")],
		units: [unit(2, "y"), unit(1, "z")],
		servers: [{ protocol: "tcp", port: 1503 }],
	})), ["units[2]: unit 1 is already loaded"]);

	assert.throws(() => emulator.scope.get_layout("NEW"), /NEW/);
	assert.deepEqual([...emulator.blocks.keys()], ["x"]);
	assert.deepEqual(emulator.unit_map.unit_ids, [1]);
	assert.equal(emulator.servers.length, 1);
	assert.deepEqual(Object.keys(emulator.layouts), ["ONE"]);
	assert.equal(emulator.servers[0].unit_ids, unit_ids);
});

test("a block name of an earlier load is an error, also on another layout", () => {
	const emulator = new_emulator();
	emulator.load(description_of({ blocks: [block("x")], units: [unit(1, "x")] }));

	assert.deepEqual(errors_of(emulator, description_of({ layout: "TWO", blocks: [block("x", "TWO")], units: [unit(2, "x")] })),
		["blocks[1]: the emulator already has a block x"]);
});

test("a port of a server of an earlier load is an error", () => {
	const emulator = new_emulator();
	emulator.load(description_of({ servers: [{ protocol: "tcp", port: 1502 }, { protocol: "rtu", port: "COM_TEST" }] }));

	assert.deepEqual(errors_of(emulator, description_of({
		servers: [{ protocol: "rtu_over_tcp", host: "0.0.0.0", port: 1502 }, { protocol: "rtu", port: "COM_TEST" }],
	})), [
		"servers[2]: port 0.0.0.0:1502 is already used by servers[0]",
		"servers[3]: port COM_TEST is already used by servers[1]",
	]);
});

test("unit_ids names the units of the emulator once loaded", () => {
	const emulator = new_emulator();
	emulator.load(description_of({ blocks: [block("x")], units: [unit(1, "x")] }));

	assert.deepEqual(errors_of(emulator, description_of({ servers: [{ protocol: "tcp", port: 1502, unit_ids: [1, 2] }] })),
		["servers[0]: unit_ids has unit 2, which has no block"]);
	emulator.load(description_of({
		blocks: [block("y")],
		units: [unit(2, "y")],
		servers: [{ protocol: "tcp", port: 1502, unit_ids: [1, 2] }],
	}));
	assert.equal(emulator.servers[0].is_valid_unit_id(2), true);
});

test("a server without unit_ids answers the units of the later loads, and warns of them", () => {
	const warnings = [];
	const emulator = new_emulator();
	emulator.on("warning", ({ server, message }) => warnings.push([server, message]));
	emulator.load(description_of({
		blocks: [block("x")],
		units: [unit(1, "x")],
		servers: [{ protocol: "rtu", port: "COM_TEST" }, { protocol: "tcp", port: 1502, unit_ids: [1] }],
	}));
	const [rtu, tcp] = emulator.servers;
	assert.deepEqual(warnings, []);

	emulator.load(description_of({ blocks: [block("y"), block("z")], units: [unit(0, "y"), unit(250, "z")] }));

	assert.deepEqual([0, 1, 250].map((id) => rtu.is_valid_unit_id(id)), [true, true, true]);
	assert.deepEqual([0, 1, 250].map((id) => tcp.is_valid_unit_id(id)), [false, true, false]);
	assert.deepEqual(warnings, [
		[rtu, "servers[0] (serial://COM_TEST): unit 0 is the broadcast address of a serial bus, written but never answered"],
		[rtu, "servers[0] (serial://COM_TEST): reserved units of a serial bus: 250"],
	]);
});

test("start() starts the servers that are not running", async (t) => {
	const emulator = new_emulator();
	t.after(() => emulator.stop());
	emulator.load(description_of({ blocks: [block("x")], units: [unit(1, "x")], servers: [{ protocol: "tcp", host: HOST, port: 1502 }] }));
	ephemeral(emulator.servers[0]);
	await emulator.start();
	const [first] = emulator.servers;
	const port = listening_port(first);
	const starts = [];
	emulator.on("server_start", ({ server }) => starts.push(server));

	emulator.load(description_of({ servers: [{ protocol: "tcp", host: HOST, port: 1503 }] }));
	ephemeral(emulator.servers[1]);
	await emulator.start();

	assert.deepEqual(starts, [emulator.servers[1]]);
	assert.equal(listening_port(first), port);
	assert.equal(await is_listening(listening_port(emulator.servers[1])), true);
});

test("start() without a server throws", async () => {
	const emulator = new_emulator();
	emulator.load(description_of({ blocks: [block("x")], units: [unit(1, "x")] }));

	await assert.rejects(emulator.start(), { message: "the emulator has no server: load a description of servers" });
});

test("stop() gives back only the block names its emulator holds", async () => {
	const scope = `load_test_${++scope_seq}`;
	const first = new Modbus_Emulator(scope);
	first.load(description_of({ blocks: [block("x")], units: [unit(1, "x")] }));
	await first.stop();
	const second = new Modbus_Emulator(scope);
	second.load(description_of({ blocks: [block("x")], units: [unit(1, "x")] }));

	first.load(description_of({ blocks: [block("y")], units: [unit(2, "y")] }));
	await first.stop();

	const layout = second.scope.get_layout("ONE");
	assert.equal(layout.get_ldata("x"), second.block("x"));
	assert.throws(() => layout.get_ldata("y"), /unknown ldata/);
});

test("the example description loads", () => {
	const emulator = new_emulator();
	const { blocks, servers } = emulator.load(new URL("../example/emulator.yaml", import.meta.url));

	assert.deepEqual([...blocks.keys()], ["pump_1"]);
	assert.equal(emulator.block("pump_1").pressure, 1.5);
	assert.deepEqual(emulator.unit_map.unit_ids, [1]);
	assert.equal(servers.length, 1);
});

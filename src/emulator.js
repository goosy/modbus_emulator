import { EventEmitter } from "node:events";
import { create_scope, get_scope } from "layout-data";
import { Unit_Map, create_handler } from "./unit_map.js";
import { create_tcp_server, create_rtu_server } from "./server.js";

/** The scope the descriptions are loaded into when the caller names none (doc/spec.md 4). */
const DEFAULT_SCOPE = "modbus_emulator";

// the serial settings es-modbus accepts
const PARITIES = ["none", "odd", "even"];
const DATA_BITS = [5, 6, 7, 8];
const STOP_BITS = [1, 1.5, 2];

const PROTOCOLS = ["tcp", "rtu_over_tcp", "rtu"];

// the events of an es-modbus server, forwarded as server_<name>, with the field of their argument
const SERVER_EVENTS = {
	start: null,
	stop: null,
	socket_connect: "socket",
	socket_disconnect: "socket",
	socket_error: "error",
	error: "error",
	handler_error: "error",
	receive: "frame",
	send: "frame",
};

// the units reserved on a serial bus, besides the broadcast address 0
const RESERVED_UNITS = [248, 249, 250, 251, 252, 253, 254, 255];

// the events of the handler, forwarded unchanged
const HANDLER_EVENTS = ["unmapped", "unmapped_limit", "listener_error"];
const BLOCK_KEYS = ["name", "unit_id", "layout", "start", "offset"];
const TCP_SERVER_KEYS = ["protocol", "unit_ids", "host", "port"];
const SERVER_KEYS = {
	tcp: TCP_SERVER_KEYS,
	rtu_over_tcp: TCP_SERVER_KEYS,
	rtu: ["protocol", "unit_ids", "port", "baud_rate", "parity", "data_bits", "stop_bits"],
};

/** The address of a server in its errors: modbus://host:port, rtu://host:port or serial://path. */
function address_of({ protocol, host = "0.0.0.0", port = 502 }) {
	if (protocol === "rtu") return `serial://${port}`;
	return `${protocol === "rtu_over_tcp" ? "rtu" : "modbus"}://${host}:${port}`;
}

/** Reports each key of a mapping entry that is not in the allowed list. */
function check_keys(entry, allowed, where, errors) {
	if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return;
	for (const key of Object.keys(entry)) {
		if (!allowed.includes(key)) errors.push(`${where}: unknown key ${key}`);
	}
}

/**
 * A Modbus device emulator: slave services over the data blocks described by
 * compiled descriptions (doc/spec.md 3).
 *
 * The data blocks are Ldata objects, available as `blocks` by name: a caller
 * reads and writes their tags to simulate the running of a device, and the
 * masters see the same data through the servers. The emulator forwards the
 * events of its servers and of its handler (doc/spec.md 4).
 */
export class Modbus_Emulator extends EventEmitter {
	/** @type {Unit_Map} */
	unit_map = new Unit_Map();
	/** @type {Object} The handler shared by all the servers. */
	handler;
	/** @type {Map<string, import('layout-data').Ldata>} The data blocks by block name. */
	blocks = new Map();
	/** @type {import('layout-data').Layout_Scope} The layout scope the descriptions are loaded into. */
	scope;
	/** @type {Object<string, import('layout-data').Layout>} The layouts of the descriptions, by name. */
	layouts;
	/** @type {import('es-modbus').Modbus_Server[]} Named by their labels, e.g. `servers[1] (modbus://0.0.0.0:503)`. */
	servers = [];
	/** @type {string[]} The diagnostics found at construction, before a listener can be attached. */
	warnings = [];

	/**
	 * @param {import('layout-data').Description|import('layout-data').Description[]} descriptions - A description
	 *     compiled by `desc_file` or `yaml`, or a list of them, as the scope's `load` takes them: the `blocks` and
	 *     `servers` of the descriptions are joined in order, and the descriptions are loaded together into the scope.
	 * @param {string} [scope="modbus_emulator"] - The name of the layout scope the descriptions are loaded into,
	 *     created when it does not exist.
	 * @throws {Error} With `errors`, every violation found, when the descriptions are not valid.
	 */
	constructor(descriptions, scope = DEFAULT_SCOPE) {
		super();
		const items = Array.isArray(descriptions) ? descriptions : [descriptions];
		const errors = [];
		const fail = () => {
			const error = new Error(`invalid emulator description:\n${errors.join("\n")}`);
			error.errors = errors;
			throw error;
		};
		// with several descriptions, a violation names its description as layout-data names the items of a list
		const prefixes = items.map((_, index) => (items.length > 1 ? `description #${index + 1}: ` : ""));
		const block_entries = [];
		const server_entries = [];
		for (const [index, item] of items.entries()) {
			const prefix = prefixes[index];
			// a Description always has its list of blocks; the load reports what else is wrong with it
			if (!Array.isArray(item?.blocks)) {
				errors.push(`${prefix}not a Description: compile it with desc_file or yaml`);
				continue;
			}
			for (const entry of item.blocks) block_entries.push({ entry, where: `${prefix}blocks[${block_entries.length}]` });
			// a Description keeps the root keys of this package as they are parsed
			const { servers } = item;
			if (servers === undefined) continue;
			if (!Array.isArray(servers)) errors.push(`${prefix}the root key \`servers\` must be a list`);
			else for (const entry of servers) server_entries.push({ entry, where: `${prefix}servers[${server_entries.length}]` });
		}
		if (errors.length > 0) fail();

		const checked_servers = this.#read_servers(server_entries, errors);
		const before = errors.length;
		this.#check_blocks(block_entries, errors);
		// a block that cannot be attached fails before loading: nothing is loaded then
		if (errors.length > before) fail();

		const loaded = this.#load(scope, descriptions, errors);
		if (loaded === undefined) fail();
		this.layouts = loaded.layouts;
		this.blocks = new Map(Object.entries(loaded.ldata));
		this.#attach_blocks(block_entries, errors);
		this.#check_server_units(checked_servers, errors);
		if (errors.length > 0) {
			// the block names go back to their layouts, so the descriptions can be constructed again
			this.#release_blocks();
			fail();
		}

		this.handler = create_handler(this.unit_map);
		for (const name of HANDLER_EVENTS) this.handler.on(name, (payload) => this.emit(name, payload));
		for (const { where, options } of checked_servers) {
			const server = this.#create_server(options, `${where} (${address_of(options)})`);
			// listening to error also keeps an error of the server from throwing
			for (const [name, field] of Object.entries(SERVER_EVENTS)) {
				server.on(name, (arg) => this.emit(`server_${name}`, field ? { server, [field]: arg } : { server }));
			}
			this.servers.push(server);
			this.#check_serial_units(server, options.unit_ids ?? this.unit_map.unit_ids);
		}
	}

	/**
	 * Loads the descriptions into the scope of a name, created when it does not exist: layout-data registers the
	 * layouts, reusing a layout of the same structure and name, and creates the Ldata of the blocks.
	 *
	 * @return {import('layout-data').Registration | undefined} Undefined after an error: nothing is loaded then.
	 */
	#load(name, descriptions, errors) {
		try {
			this.scope = get_scope(name) ?? create_scope(name);
			return this.scope.load(descriptions);
		} catch (e) {
			errors.push(...(e.errors ?? [e.message]));
			return undefined;
		}
	}

	/** Gives the block names back to their layouts, which then may create blocks of the same names again. */
	#release_blocks() {
		for (const [name, block] of this.blocks) block.layout.delete_ldata(name);
	}

	/** Warns of the broadcast and reserved units a server on a serial bus answers (es-modbus: protocol not tcp). */
	#check_serial_units(server, unit_ids) {
		if (server.protocol === "tcp") return;
		if (unit_ids.includes(0)) {
			this.warnings.push(`${server.name}: unit 0 is the broadcast address of a serial bus, written but never answered`);
		}
		const reserved = unit_ids.filter((id) => RESERVED_UNITS.includes(id));
		if (reserved.length > 0) {
			this.warnings.push(`${server.name}: reserved units of a serial bus: ${reserved.join(", ")}`);
		}
	}

	/**
	 * Checks the keys of the blocks that belong to this package. layout-data checked `name` and `layout` when it
	 * compiled the descriptions, and checks the block names across the descriptions when it loads them.
	 */
	#check_blocks(entries, errors) {
		if (entries.length === 0) {
			errors.push("the root key `blocks` must be a non-empty list");
			return;
		}
		for (const { entry, where } of entries) {
			check_keys(entry, BLOCK_KEYS, where, errors);
			const { unit_id, start = 0, offset = 0 } = entry;
			if (!Number.isInteger(unit_id) || unit_id < 0 || unit_id > 255) {
				errors.push(`${where}: unit_id must be an integer from 0 to 255`);
			}
			if (!Number.isInteger(start) || start < 0 || start % 2 !== 0) {
				errors.push(`${where}: start must be an even non-negative byte offset`);
			}
			if (!Number.isInteger(offset) || offset < 0 || offset % 2 !== 0) {
				errors.push(`${where}: offset must be an even non-negative byte offset`);
			}
		}
	}

	/** Attaches every block to its unit; an overlap in a unit is the error of `attach_unit`. */
	#attach_blocks(entries, errors) {
		for (const { entry: { name, unit_id, start = 0, offset = 0 }, where } of entries) {
			try {
				this.unit_map.attach_unit(unit_id, this.blocks.get(name), start, offset);
			} catch (error) {
				errors.push(`${where}: ${error.message}`);
			}
		}
	}

	#read_servers(entries, errors) {
		if (entries.length === 0) {
			errors.push("the root key `servers` must be a non-empty list");
			return [];
		}
		const result = [];
		// the earlier server of each TCP address or serial port path
		const used = new Map();
		for (const { entry: server, where } of entries) {
			const { protocol } = server ?? {};
			if (!PROTOCOLS.includes(protocol)) {
				errors.push(`${where}: protocol must be one of ${PROTOCOLS.join(", ")}`);
				continue;
			}
			check_keys(server, SERVER_KEYS[protocol], where, errors);
			let address;
			if (protocol === "rtu") {
				if (typeof server.port !== "string" || server.port === "") {
					errors.push(`${where}: port must be a serial device path`);
					continue;
				}
				const { baud_rate = 9600, parity = "none", data_bits = 8, stop_bits = 1 } = server;
				const before = errors.length;
				if (!Number.isInteger(baud_rate) || baud_rate < 1) errors.push(`${where}: baud_rate must be a positive integer`);
				if (!PARITIES.includes(parity)) errors.push(`${where}: parity must be one of ${PARITIES.join(", ")}`);
				if (!DATA_BITS.includes(data_bits)) errors.push(`${where}: data_bits must be one of ${DATA_BITS.join(", ")}`);
				if (!STOP_BITS.includes(stop_bits)) errors.push(`${where}: stop_bits must be one of ${STOP_BITS.join(", ")}`);
				if (errors.length > before) continue;
				address = server.port;
			} else {
				const { host = "0.0.0.0", port = 502 } = server;
				if (!Number.isInteger(port) || port < 0 || port > 65535) {
					errors.push(`${where}: port must be a TCP port number from 0 to 65535`);
					continue;
				}
				// port 0 is chosen by the system, a different one each time
				if (port !== 0) address = `${host}:${port}`;
			}
			if (address !== undefined) {
				if (used.has(address)) {
					errors.push(`${where}: port ${address} is already used by ${used.get(address)}`);
					continue;
				}
				used.set(address, where);
			}
			const { unit_ids } = server;
			if (unit_ids !== undefined && !(Array.isArray(unit_ids) && unit_ids.length > 0
				&& unit_ids.every((id) => Number.isInteger(id) && id >= 0 && id <= 255))) {
				errors.push(`${where}: unit_ids must be a non-empty list of integers from 0 to 255`);
				continue;
			}
			result.push({ where, options: server });
		}
		return result;
	}

	/** A server may only answer units that have a block. */
	#check_server_units(entries, errors) {
		for (const { where, options } of entries) {
			for (const id of options.unit_ids ?? []) {
				if (this.unit_map.segments(id).length === 0) errors.push(`${where}: unit_ids has unit ${id}, which has no block`);
			}
		}
	}

	#create_server(options, name) {
		const { protocol, host, port, baud_rate, parity, data_bits, stop_bits, unit_ids } = options;
		const { handler } = this;
		if (protocol === "rtu") {
			return create_rtu_server(port, this.unit_map, { baud_rate, parity, data_bits, stop_bits, unit_ids, handler, name });
		}
		return create_tcp_server(this.unit_map, { host, port, rtu: protocol === "rtu_over_tcp", unit_ids, handler, name });
	}

	/**
	 * Gets a data block by name.
	 *
	 * @param {string} name - The block name.
	 * @return {import('layout-data').Ldata|undefined}
	 */
	block(name) {
		return this.blocks.get(name);
	}

	/**
	 * Starts all the servers. By default it is all or nothing: when any server fails, all the servers are stopped.
	 *
	 * @param {Object} [options]
	 * @param {boolean} [options.partial=false] - Leave the servers that started running when others fail.
	 * @throws {AggregateError} Every failure, each an Error that names its server, with the original error as `cause`.
	 */
	async start({ partial = false } = {}) {
		const results = await Promise.allSettled(this.servers.map((server) => server.start()));
		const failures = [];
		for (const [index, result] of results.entries()) {
			if (result.status === "fulfilled") continue;
			const { reason } = result;
			failures.push(new Error(`${this.servers[index].name}: ${reason?.message ?? reason}`, { cause: reason }));
		}
		if (failures.length === 0) return;
		if (!partial) await this.stop();
		throw new AggregateError(failures, `${failures.length} of ${this.servers.length} servers failed to start`);
	}

	/**
	 * Stops all the servers, and gives the block names back to their layouts: the same descriptions can then be
	 * constructed again in the scope. The blocks keep working, and `start()` serves them again.
	 */
	async stop() {
		await Promise.all(this.servers.map((server) => server.stop()));
		this.#release_blocks();
	}
}

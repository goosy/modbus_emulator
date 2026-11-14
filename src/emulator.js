import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { create_scope, desc_file, get_scope } from "layout-data";
import { ENDIANS, READONLY_VALUES, UNMAPPED_READS, UNMAPPED_WRITES, Unit_Map, create_handler, readonly_errors } from "./unit_map.js";
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
const HANDLER_EVENTS = ["unmapped", "unmapped_limit", "request_refused", "request_refused_limit", "listener_error"];
const BLOCK_KEYS = ["name", "layout"];
const UNIT_KEYS = ["unit_id", "endian", "unmapped_read", "unmapped_write", "blocks"];
const PLACEMENT_KEYS = ["start", "offset", "readonly"];
const TCP_SERVER_KEYS = ["protocol", "unit_ids", "host", "port"];
const SERVER_KEYS = {
	tcp: TCP_SERVER_KEYS,
	rtu_over_tcp: TCP_SERVER_KEYS,
	rtu: ["protocol", "unit_ids", "port", "baud_rate", "parity", "data_bits", "stop_bits"],
};

/** Whether a source of a load is a description file: a path or a URL, as desc_file takes them. */
function is_file(source) {
	return typeof source === "string" || source instanceof URL;
}

/**
 * The label of a source in the errors: the path of a file, or the place of a Description among the sources,
 * as layout-data names the items of a list.
 */
function label_of(source, index, count) {
	if (typeof source === "string") return source;
	if (source instanceof URL) return source.protocol === "file:" ? fileURLToPath(source) : source.href;
	return count > 1 ? `description #${index + 1}` : "description";
}

/** The address of a server in its errors: modbus://host:port, rtu://host:port or serial://path. */
function address_of({ protocol, host = "0.0.0.0", port = 502 }) {
	if (protocol === "rtu") return `serial://${port}`;
	return `${protocol === "rtu_over_tcp" ? "rtu" : "modbus"}://${host}:${port}`;
}

/** Whether a value is a mapping of a description: an object that is not a list. */
function is_mapping(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Reports each key of a mapping entry that is not in the allowed list. */
function check_keys(entry, allowed, where, errors) {
	if (!is_mapping(entry)) return;
	for (const key of Object.keys(entry)) {
		if (!allowed.includes(key)) errors.push(`${where}: unknown key ${key}`);
	}
}

/** Whether a value is an even non-negative byte offset. */
function is_even_offset(value) {
	return Number.isInteger(value) && value >= 0 && value % 2 === 0;
}

/**
 * A Modbus device emulator: slave services over the data blocks described by
 * YAML files (doc/spec.md 3).
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
	layouts = {};
	/** @type {import('es-modbus').Modbus_Server[]} Named by their labels, e.g. `servers[1] (modbus://0.0.0.0:503)`. */
	servers = [];
	// the label of the server of each TCP address or serial port path
	#addresses = new Map();
	// the servers without unit_ids, which answer every unit of the unit map
	#all_unit_servers = [];
	// the servers started and not stopped since
	#started = new Set();
	// the names of the blocks whose layouts hold them for this emulator
	#held = new Set();

	/**
	 * Creates an emulator without blocks and services: `load` loads the descriptions.
	 *
	 * @param {string} [scope="modbus_emulator"] - The name of the layout scope the descriptions are loaded into,
	 *     created when it does not exist.
	 * @throws {Error} When the scope does not exist and the name is not an identifier.
	 */
	constructor(scope = DEFAULT_SCOPE) {
		super();
		this.scope = get_scope(scope) ?? create_scope(scope);
		this.handler = create_handler(this.unit_map);
		for (const name of HANDLER_EVENTS) this.handler.on(name, (payload) => this.emit(name, payload));
	}

	/**
	 * Loads descriptions, all or nothing: on an error the emulator and the scope are left as they were. It may be
	 * called any number of times. The servers are created and not started: `start()` starts them.
	 *
	 * @param {string|URL|import('layout-data').Description|Array<string|URL|import('layout-data').Description>} sources
	 *     A source or a list of them, each a description file (a path or a file: URL, compiled with `desc_file`) or a
	 *     Description (compiled by `desc_file` or `yaml`): the `blocks`, `units` and `servers` of the sources are
	 *     joined in order, and the descriptions are loaded together into the scope.
	 * @return {{blocks: Map<string, import('layout-data').Ldata>, servers: import('es-modbus').Modbus_Server[]}}
	 *     The blocks and the servers this call added.
	 * @throws {Error} With `errors`, every violation found, when the descriptions are not valid.
	 */
	load(sources) {
		const items = Array.isArray(sources) ? sources : [sources];
		const labels = items.map((item, index) => label_of(item, index, items.length));
		const errors = [];
		const fail = () => {
			const error = new Error(`invalid emulator sources ${labels.join(", ")}:\n${errors.join("\n")}`);
			error.errors = errors;
			throw error;
		};
		// with several sources, a violation names its source
		const prefixes = labels.map((label) => (items.length > 1 ? `${label}: ` : ""));
		const compiled = [];
		// for each description read, its blocks by name
		const sources_read = [];
		// the entries are numbered after the blocks, the units and the servers of the earlier loads: each unit
		// entry loaded is one unit of the unit map
		const block_entries = [];
		const unit_entries = [];
		const server_entries = [];
		for (const [index, item] of items.entries()) {
			const prefix = prefixes[index];
			let description = item;
			if (is_file(item)) {
				try {
					description = desc_file(item);
				} catch (e) {
					// the errors of desc_file name the file already; a TypeError (not a file: URL) has no errors
					errors.push(...(e.errors ?? [`${prefix}${e.message}`]));
					continue;
				}
			} else if (!Array.isArray(item?.blocks) || item.layouts === null || typeof item.layouts !== "object") {
				// a Description always has its layouts and its list of blocks; the load reports what else is wrong
				errors.push(`${prefix}not a description file or a Description: compile it with desc_file or yaml`);
				continue;
			}
			compiled.push(description);
			// the blocks of this description by name, which its units place
			const source = { blocks: new Map() };
			for (const entry of description.blocks) {
				// the size of the layout compiled by desc_file or yaml is the one of the layout the scope will hold
				const layout = description.layouts[entry.layout];
				const where = `${prefix}blocks[${this.blocks.size + block_entries.length}]`;
				block_entries.push({ entry, where });
				source.blocks.set(entry.name, { size: layout.size, layout, where });
			}
			// a Description keeps the root keys of this package as they are parsed
			const { units, servers } = description;
			if (units !== undefined) {
				if (!Array.isArray(units)) errors.push(`${prefix}the root key \`units\` must be a list`);
				else {
					for (const entry of units) {
						const where = `${prefix}units[${this.unit_map.unit_ids.length + unit_entries.length}]`;
						unit_entries.push({ entry, where, source });
					}
				}
			}
			sources_read.push(source);
			if (servers === undefined) continue;
			if (!Array.isArray(servers)) errors.push(`${prefix}the root key \`servers\` must be a list`);
			else {
				for (const entry of servers) {
					server_entries.push({ entry, where: `${prefix}servers[${this.servers.length + server_entries.length}]` });
				}
			}
		}
		if (errors.length > 0) fail();
		if (block_entries.length === 0 && server_entries.length === 0) {
			errors.push("the descriptions have neither `blocks` nor `servers`");
			fail();
		}

		const checked_servers = this.#read_servers(server_entries, errors);
		const before = errors.length;
		this.#check_blocks(block_entries, errors);
		const checked_units = this.#read_units(unit_entries, sources_read, errors);
		// an entry that cannot be placed fails here: the overlaps are not checked then
		if (errors.length > before) fail();
		const unit_map = this.#place_blocks(block_entries, checked_units, errors);
		this.#check_server_units(checked_servers, unit_map, errors);
		if (errors.length > 0) fail();

		// the last step that may fail, all or nothing itself
		const loaded = this.#load(compiled, errors);
		if (loaded === undefined) fail();

		const units_before = this.unit_map.unit_ids;
		Object.assign(this.layouts, loaded.layouts);
		const blocks = new Map();
		for (const { entry: { name } } of block_entries) {
			const block = loaded.ldata[name];
			this.blocks.set(name, block);
			this.#held.add(name);
			blocks.set(name, block);
		}
		// the byte order first, so the table of each segment is built once, at its attachment
		for (const { unit_id, endian, unmapped_read, unmapped_write, placements } of checked_units) {
			if (endian !== undefined) this.unit_map.set_endian(unit_id, endian);
			if (unmapped_read !== undefined) this.unit_map.set_unmapped_read(unit_id, unmapped_read);
			if (unmapped_write !== undefined) this.unit_map.set_unmapped_write(unit_id, unmapped_write);
			for (const { name, start, offset, readonly } of placements) {
				this.unit_map.attach_unit(unit_id, blocks.get(name), { start, offset, readonly });
			}
		}
		// the servers without unit_ids answer the units added by this load too
		const { unit_ids } = this.unit_map;
		const added_units = unit_ids.filter((id) => !units_before.includes(id));
		for (const server of this.#all_unit_servers) {
			server.set_unit_ids(unit_ids);
			this.#check_serial_units(server, added_units);
		}
		const servers = [];
		for (const { where, options, address } of checked_servers) {
			const server = this.#create_server(options, `${where} (${address_of(options)})`);
			// listening to error also keeps an error of the server from throwing
			for (const [name, field] of Object.entries(SERVER_EVENTS)) {
				server.on(name, (arg) => this.emit(`server_${name}`, field ? { server, [field]: arg } : { server }));
			}
			this.#addresses.set(address, where);
			if (options.unit_ids === undefined) this.#all_unit_servers.push(server);
			this.servers.push(server);
			servers.push(server);
			this.#check_serial_units(server, options.unit_ids ?? unit_ids);
		}
		return { blocks, servers };
	}

	/**
	 * Loads the compiled descriptions into the scope: layout-data registers the layouts, reusing a layout of the
	 * same structure and name, and creates the Ldata of the blocks.
	 *
	 * @return {import('layout-data').Registration | undefined} Undefined after an error: nothing is loaded then.
	 */
	#load(descriptions, errors) {
		try {
			return this.scope.load(descriptions);
		} catch (e) {
			errors.push(...(e.errors ?? [e.message]));
			return undefined;
		}
	}

	/** Gives the block names held for this emulator back to their layouts, which may create them again. */
	#release_blocks() {
		for (const name of this.#held) this.blocks.get(name).layout.delete_ldata(name);
		this.#held.clear();
	}

	/** Emits a warning for the broadcast and reserved units a server on a serial bus answers (es-modbus: protocol not tcp). */
	#check_serial_units(server, unit_ids) {
		if (server.protocol === "tcp") return;
		const warn = (message) => this.emit("warning", { server, message: `${server.name}: ${message}` });
		if (unit_ids.includes(0)) warn("unit 0 is the broadcast address of a serial bus, written but never answered");
		const reserved = unit_ids.filter((id) => RESERVED_UNITS.includes(id));
		if (reserved.length > 0) warn(`reserved units of a serial bus: ${reserved.join(", ")}`);
	}

	/**
	 * Checks that a block entry has only the keys of layout-data: its placement is written in the unit entries.
	 * layout-data checked `name` and `layout` when it compiled the descriptions, and checks the block names across
	 * the descriptions when it loads them.
	 */
	#check_blocks(entries, errors) {
		for (const { entry, where } of entries) check_keys(entry, BLOCK_KEYS, where, errors);
	}

	/**
	 * Reads the unit entries of a load: each unit declared once in the emulator, and each block of a description
	 * placed once by a unit of the same description.
	 *
	 * @return {Array<{unit_id: number, endian: string|undefined, unmapped_read: string|undefined,
	 *     unmapped_write: string|undefined, placements: Array<{name: string, size: number, start: number, offset: number,
	 *     readonly: string|string[], where: string}>}>} The units, in the order of their entries.
	 */
	#read_units(entries, sources, errors) {
		const result = [];
		// the entry of each unit id of this load
		const declared = new Map();
		// the placement of each block placed, by block entry
		const placed = new Map();
		for (const { entry, where, source } of entries) {
			if (!is_mapping(entry)) {
				errors.push(`${where}: a unit entry must be a mapping`);
				continue;
			}
			check_keys(entry, UNIT_KEYS, where, errors);
			const { unit_id, endian, unmapped_read, unmapped_write, blocks } = entry;
			if (!Number.isInteger(unit_id) || unit_id < 0 || unit_id > 255) {
				errors.push(`${where}: unit_id must be an integer from 0 to 255`);
			} else if (declared.has(unit_id)) {
				errors.push(`${where}: unit ${unit_id} is already declared by ${declared.get(unit_id)}`);
			} else if (this.unit_map.segments(unit_id).length > 0) {
				errors.push(`${where}: unit ${unit_id} is already loaded`);
			} else declared.set(unit_id, where);
			if (endian !== undefined && !ENDIANS.includes(endian)) {
				errors.push(`${where}: endian must be one of ${ENDIANS.join(", ")}`);
			}
			if (unmapped_read !== undefined && !UNMAPPED_READS.includes(unmapped_read)) {
				errors.push(`${where}: unmapped_read must be one of ${UNMAPPED_READS.join(", ")}`);
			}
			if (unmapped_write !== undefined && !UNMAPPED_WRITES.includes(unmapped_write)) {
				errors.push(`${where}: unmapped_write must be one of ${UNMAPPED_WRITES.join(", ")}`);
			}
			if (!is_mapping(blocks) || Object.keys(blocks).length === 0) {
				errors.push(`${where}: blocks must be a non-empty mapping from block names to placements`);
				continue;
			}
			const placements = [];
			for (const [name, placement] of Object.entries(blocks)) {
				const at = `${where}.blocks.${name}`;
				if (!is_mapping(placement)) {
					errors.push(`${at}: a placement must be a mapping, {} for none of start and offset`);
					continue;
				}
				check_keys(placement, PLACEMENT_KEYS, at, errors);
				const { start = 0, offset = 0, readonly = READONLY_VALUES[0] } = placement;
				if (!is_even_offset(start)) errors.push(`${at}: start must be an even non-negative byte offset`);
				if (!is_even_offset(offset)) errors.push(`${at}: offset must be an even non-negative byte offset`);
				const block = source.blocks.get(name);
				if (block === undefined) {
					errors.push(`${at}: the description of the unit has no block ${name}`);
					continue;
				}
				if (placed.has(block)) {
					errors.push(`${at}: block ${name} is already placed by ${placed.get(block)}`);
					continue;
				}
				placed.set(block, at);
				for (const error of readonly_errors(readonly, block.layout)) errors.push(`${at}: ${error}`);
				placements.push({ name, size: block.size, start, offset, readonly, where: at });
			}
			result.push({ unit_id, endian, unmapped_read, unmapped_write, placements });
		}
		for (const source of sources) {
			for (const [name, block] of source.blocks) {
				if (!placed.has(block)) errors.push(`${block.where}: block ${name} is placed by no unit`);
			}
		}
		return result;
	}

	/**
	 * Places the blocks of a load, by name and size, on a copy of the unit map, before anything is loaded: a block
	 * name of the emulator is an error, and an overlap in a unit is the error of `attach_unit`. The copy sets no byte
	 * order: the byte ranges do not depend on it.
	 *
	 * @return {Unit_Map} The copy, with the blocks of the emulator and the blocks of the load placed.
	 */
	#place_blocks(block_entries, units, errors) {
		const unit_map = new Unit_Map();
		for (const unit_id of this.unit_map.unit_ids) {
			for (const { block, start, offset } of this.unit_map.segments(unit_id)) {
				unit_map.attach_unit(unit_id, block, { start, offset });
			}
		}
		for (const { entry: { name }, where } of block_entries) {
			if (this.blocks.has(name)) errors.push(`${where}: the emulator already has a block ${name}`);
		}
		for (const { unit_id, placements } of units) {
			for (const { name, size, start, offset, where } of placements) {
				try {
					unit_map.attach_unit(unit_id, { name, size }, { start, offset });
				} catch (error) {
					errors.push(`${where}: ${error.message}`);
				}
			}
		}
		return unit_map;
	}

	#read_servers(entries, errors) {
		const result = [];
		// the earlier server of each TCP address or serial port path, of this load or of an earlier one
		const used = new Map(this.#addresses);
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
				if (!Number.isInteger(port) || port < 1 || port > 65535) {
					errors.push(`${where}: port must be a TCP port number from 1 to 65535`);
					continue;
				}
				address = `${host}:${port}`;
			}
			if (used.has(address)) {
				errors.push(`${where}: port ${address} is already used by ${used.get(address)}`);
				continue;
			}
			used.set(address, where);
			const { unit_ids } = server;
			if (unit_ids !== undefined && !(Array.isArray(unit_ids) && unit_ids.length > 0
				&& unit_ids.every((id) => Number.isInteger(id) && id >= 0 && id <= 255))) {
				errors.push(`${where}: unit_ids must be a non-empty list of integers from 0 to 255`);
				continue;
			}
			result.push({ where, options: server, address });
		}
		return result;
	}

	/** A server may only answer units that have a block in the unit map once loaded. */
	#check_server_units(entries, unit_map, errors) {
		for (const { where, options } of entries) {
			for (const id of options.unit_ids ?? []) {
				if (unit_map.segments(id).length === 0) errors.push(`${where}: unit_ids has unit ${id}, which has no block`);
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
	 * Starts the servers that are not running: the ones loaded since the last start, or all after `stop()`. By
	 * default it is all or nothing: when any server fails, all the servers are stopped.
	 *
	 * @param {Object} [options]
	 * @param {boolean} [options.partial=false] - Leave the servers that started running when others fail.
	 * @throws {Error} When the emulator has no server.
	 * @throws {AggregateError} Every failure, each an Error that names its server, with the original error as `cause`.
	 */
	async start({ partial = false } = {}) {
		if (this.servers.length === 0) throw new Error("the emulator has no server: load a description of servers");
		// es-modbus restarts a running server on start(): only the others are started
		const pending = this.servers.filter((server) => !this.#started.has(server));
		const results = await Promise.allSettled(pending.map((server) => server.start()));
		const failures = [];
		for (const [index, result] of results.entries()) {
			const server = pending[index];
			if (result.status === "fulfilled") {
				this.#started.add(server);
				continue;
			}
			const { reason } = result;
			failures.push(new Error(`${server.name}: ${reason?.message ?? reason}`, { cause: reason }));
		}
		if (failures.length === 0) return;
		if (!partial) await this.stop();
		throw new AggregateError(failures, `${failures.length} of ${pending.length} servers failed to start`);
	}

	/**
	 * Stops all the servers, and gives the block names back to their layouts: other emulators can then load blocks
	 * of the same names in the scope. The blocks keep working, and `start()` serves them again.
	 */
	async stop() {
		await Promise.all(this.servers.map((server) => server.stop()));
		this.#started.clear();
		this.#release_blocks();
	}
}

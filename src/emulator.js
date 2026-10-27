import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { create_scope, get_scope } from "layout-data";
import { Unit_Map, create_handler } from "./unit_map.js";
import { create_tcp_server, create_rtu_server } from "./server.js";

/**
 * The layout-data scope of the package: one per process, bound by the first emulator that gets its scope
 * (doc/spec.md 4).
 *
 * @type {import('layout-data').Layout_Scope | undefined}
 */
let package_scope;

/** A scope name made from the time in UTC, for a description without scope: `s` and the year to the millisecond. */
function time_scope_name() {
	return `s${new Date().toISOString().replace(/\D/g, "")}`;
}

/** The registered layout of the name in the scope, or undefined. */
function find_layout(scope, name) {
	try {
		return typeof name === "string" ? scope.get_layout(name) : undefined;
	} catch {
		return undefined;
	}
}

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
 * a YAML file (doc/spec.md 3).
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
	/** @type {import('layout-data').Layout_Scope} The layout scope of the blocks, named by the description. */
	scope;
	/** @type {Object<string, Object>} The layouts this emulator registered, by name; empty without layouts. */
	layouts;
	/** @type {import('es-modbus').Modbus_Server[]} Named by their labels, e.g. `servers[1] (modbus://0.0.0.0:503)`. */
	servers = [];
	/** @type {string[]} The diagnostics found at construction, before a listener can be attached. */
	warnings = [];

	/**
	 * @param {string|string[]} descriptions - The path of an emulator description file (YAML), or a list of them: the
	 *     `blocks` and `servers` of the files are joined in order, and their layouts are registered together in
	 *     the scope they name. A layout file is an item of the list like the others.
	 *     Not public: an object of the same structure is also accepted in place of a path, for the controller that
	 *     assembles it.
	 * @throws {Error} With `errors`, every violation found, when the file is not valid.
	 */
	constructor(descriptions) {
		super();
		const items = Array.isArray(descriptions) ? descriptions : [descriptions];
		const labels = items.map((item) => (typeof item === "string" ? item : "emulator description"));
		const errors = [];
		const fail = () => {
			const error = new Error(`invalid emulator file ${labels.join(", ")}:\n${errors.join("\n")}`);
			error.errors = errors;
			throw error;
		};
		// with several descriptions, a violation names its description
		const prefixes = labels.map((label) => (items.length > 1 ? `${label}: ` : ""));
		const block_entries = [];
		const server_entries = [];
		const layout_descriptions = [];
		// the scope name and the label of the first description that gives it
		let scope_name;
		let scope_label;
		for (const [index, item] of items.entries()) {
			const prefix = prefixes[index];
			let root = item;
			if (typeof item === "string") {
				let text;
				try {
					text = readFileSync(item, "utf8");
				} catch (e) {
					errors.push(`${prefix}cannot read the file: ${e.message}`);
					continue;
				}
				const doc = parseDocument(text, { version: "1.2" });
				if (doc.errors.length > 0) {
					errors.push(...doc.errors.map((e) => prefix + e.message));
					continue;
				}
				root = doc.toJS();
			}
			if (root === null || typeof root !== "object" || Array.isArray(root)) {
				errors.push(`${prefix}the root must be a mapping`);
				continue;
			}
			const { scope, blocks, servers, layouts, item_tables } = root;
			if (scope !== undefined) {
				if (typeof scope !== "string") errors.push(`${prefix}scope must be a string`);
				else if (scope_name === undefined) [scope_name, scope_label] = [scope, labels[index]];
				else if (scope !== scope_name) errors.push(`${prefix}scope ${scope} differs from scope ${scope_name} of ${scope_label}`);
			}
			for (const [key, list, entries] of [["blocks", blocks, block_entries], ["servers", servers, server_entries]]) {
				if (list === undefined) continue;
				if (!Array.isArray(list)) errors.push(`${prefix}the root key \`${key}\` must be a list`);
				else for (const entry of list) entries.push({ entry, where: `${prefix}${key}[${entries.length}]` });
			}
			// the root is a description as it is: layout-data reads only layouts and item_tables
			if (layouts !== undefined || item_tables !== undefined) layout_descriptions.push(root);
		}
		if (errors.length > 0) fail();

		const compiled = this.#get_scope(scope_name, layout_descriptions, errors);
		this.layouts = compiled?.layouts ?? {};

		const checked_servers = this.#read_servers(server_entries, errors);
		this.#read_blocks(block_entries, errors);
		this.#check_server_units(checked_servers, errors);
		if (errors.length > 0) fail();

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
	 * Gets the scope of the description into `scope`, registering the layout descriptions in it, and binds the
	 * package to it. Leaves `scope` unset on an error: no layout is known then.
	 *
	 * @return {import('layout-data').Registered_Layouts | undefined} The registration, when there was one.
	 */
	#get_scope(name = package_scope?.name ?? time_scope_name(), layout_descriptions, errors) {
		if (package_scope !== undefined && package_scope.name !== name) {
			errors.push(`scope ${name}: the package uses scope ${package_scope.name}`);
			return undefined;
		}
		let compiled;
		if (layout_descriptions.length > 0) {
			try {
				const scope = get_scope(name) ?? create_scope(name);
				compiled = scope.register_layout(layout_descriptions);
				this.scope = scope;
			} catch (e) {
				errors.push(...(e.errors ?? [e.message]));
			}
		} else {
			// without layouts the blocks use the layouts already registered in the scope
			this.scope = get_scope(name);
			if (this.scope === undefined) errors.push(`unknown scope ${name}`);
		}
		package_scope ??= this.scope;
		return compiled;
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
	 * Without a scope no layout is known: an unknown layout is then not reported, as every block would repeat
	 * the error of the scope.
	 */
	#read_blocks(entries, errors) {
		if (entries.length === 0) {
			errors.push("the root key `blocks` must be a non-empty list");
			return;
		}
		for (const { entry, where } of entries) {
			check_keys(entry, BLOCK_KEYS, where, errors);
			const { unit_id, layout, start = 0, offset = 0 } = entry ?? {};
			if (entry?.name !== undefined && (typeof entry.name !== "string" || entry.name === "")) {
				errors.push(`${where}: name must be a non-empty string`);
				continue;
			}
			const name = entry?.name ?? `unit_${unit_id}`;
			if (!Number.isInteger(unit_id) || unit_id < 0 || unit_id > 255) {
				errors.push(`${where}: unit_id must be an integer from 0 to 255`);
				continue;
			}
			if (!Number.isInteger(start) || start < 0 || start % 2 !== 0) {
				errors.push(`${where}: start must be an even non-negative byte offset`);
				continue;
			}
			if (!Number.isInteger(offset) || offset < 0 || offset % 2 !== 0) {
				errors.push(`${where}: offset must be an even non-negative byte offset`);
				continue;
			}
			if (this.blocks.has(name)) {
				errors.push(`${where}: duplicated block name ${name}`);
				continue;
			}
			if (this.scope === undefined) continue;
			const found = find_layout(this.scope, layout);
			if (found === undefined) {
				errors.push(`${where}: unknown layout ${this.scope.name}.${layout}`);
				continue;
			}
			const block = found.create_ldata(name);
			this.blocks.set(name, block);
			try {
				this.unit_map.attach_unit(unit_id, block, start, offset);
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

	/** Stops all the servers. */
	async stop() {
		await Promise.all(this.servers.map((server) => server.stop()));
	}
}

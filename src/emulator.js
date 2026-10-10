import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseDocument } from "yaml";
import { Ldata, get_layout, register_layout } from "layout-data";
import { Unit_Map, create_vector } from "./unit_map.js";
import { create_tcp_server, create_rtu_server, normalize_logger } from "./server.js";

/** Whether a layout of the name is registered in layout-data. */
function is_registered(name) {
	try {
		return typeof name === "string" && get_layout(name) !== undefined;
	} catch {
		return false;
	}
}

const PROTOCOLS = ["tcp", "rtu_over_tcp", "rtu"];

/**
 * A Modbus device emulator: slave services over the data blocks described by
 * a YAML file (doc/spec.md 3).
 *
 * The data blocks are Ldata objects, available as `devices` by name: a caller
 * reads and writes their tags to simulate the running of a device, and the
 * masters see the same data through the servers.
 */
export class Modbus_Emulator {
	/** @type {Unit_Map} */
	unit_map = new Unit_Map();
	/** @type {Object} The vector shared by all the servers. */
	vector;
	/** @type {Map<string, Ldata>} The data blocks by device name. */
	devices = new Map();
	/** @type {Object<string, Object>} The compiled layouts by name. */
	layouts;
	/** @type {Object<string, Object[]>} The layout fragments by name. */
	fragments;
	/** @type {import('es-modbus').Modbus_Server[]} */
	servers = [];

	/**
	 * @param {string} source - The path of the emulator description file (YAML). Not public: an object of the
	 *     same structure is also accepted, for the controller that assembles it; a relative `layouts_file` then
	 *     is relative to the current directory. `layouts_file` names a layout file, instead of giving the
	 *     layouts in the description.
	 * @param {Object} [options]
	 * @param {{info: Function, warn: Function, error: Function}} [options.logger] - Silent by default.
	 * @throws {Error} With `errors`, every violation found, when the file is not valid.
	 */
	constructor(source, { logger } = {}) {
		this.logger = normalize_logger(logger);
		const origin = typeof source === "string" ? source : "emulator description";
		const fail = (errors) => {
			const error = new Error(`invalid emulator file ${origin}:\n${errors.join("\n")}`);
			error.errors = errors;
			throw error;
		};
		let root = source;
		if (typeof source === "string") {
			const doc = parseDocument(readFileSync(source, "utf8"), { version: "1.2" });
			if (doc.errors.length > 0) fail(doc.errors.map((e) => e.message));
			root = doc.toJS();
		}
		if (root === null || typeof root !== "object" || Array.isArray(root)) fail(["the root must be a mapping"]);
		const { devices, servers, layouts_file, ...layout_root } = root;
		const errors = [];
		let compiled = { layouts: {}, fragments: {} };
		try {
			const sources = [];
			if (layouts_file !== undefined) {
				if (typeof layouts_file !== "string") throw new Error("layouts_file must be a path");
				sources.push(resolve(typeof source === "string" ? dirname(source) : ".", layouts_file));
			}
			if (Object.keys(layout_root).length > 0) sources.push(layout_root);
			// without sources the devices use the layouts that are already registered
			if (sources.length > 0) compiled = register_layout(sources);
		} catch (e) {
			errors.push(...(e.errors ?? [e.message]));
		}
		this.layouts = compiled.layouts;
		this.fragments = compiled.fragments;

		const server_entries = this.#read_servers(servers, errors);
		this.#read_devices(devices, errors);
		this.#check_server_units(server_entries, errors);
		if (errors.length > 0) fail(errors);

		this.vector = create_vector(this.unit_map, { logger: this.logger });
		for (const { options } of server_entries) this.servers.push(this.#create_server(options));
	}

	#read_devices(devices, errors, block_options) {
		if (!Array.isArray(devices) || devices.length === 0) {
			errors.push("the root key `devices` must be a non-empty list");
			return;
		}
		for (const [index, device] of devices.entries()) {
			const where = `devices[${index}]`;
			const { unit_id, layout, start = 0, offset = 0 } = device ?? {};
			const name = device?.name ?? `unit_${unit_id}`;
			if (!Number.isInteger(unit_id) || unit_id < 0 || unit_id > 255) {
				errors.push(`${where}: unit_id must be an integer from 0 to 255`);
				continue;
			}
			if (!is_registered(layout)) {
				errors.push(`${where}: unknown layout ${layout}`);
				continue;
			}
			if (!Number.isInteger(start) || start < 0 || start % 2 !== 0) {
				errors.push(`${where}: start must be an even non-negative byte offset`);
				continue;
			}
			if (!Number.isInteger(offset) || offset < 0) {
				errors.push(`${where}: offset must be a non-negative byte offset`);
				continue;
			}
			if (this.devices.has(name)) {
				errors.push(`${where}: duplicated device name ${name}`);
				continue;
			}
			const block = new Ldata(layout, name, block_options);
			this.devices.set(name, block);
			this.unit_map.attach_unit(unit_id, block, start, offset);
		}
	}

	#read_servers(servers, errors) {
		if (!Array.isArray(servers) || servers.length === 0) {
			errors.push("the root key `servers` must be a non-empty list");
			return [];
		}
		const result = [];
		for (const [index, server] of servers.entries()) {
			const where = `servers[${index}]`;
			const { protocol } = server ?? {};
			if (!PROTOCOLS.includes(protocol)) {
				errors.push(`${where}: protocol must be one of ${PROTOCOLS.join(", ")}`);
				continue;
			}
			if (protocol === "rtu") {
				if (typeof server.port !== "string" || server.port === "") {
					errors.push(`${where}: port must be a serial device path`);
					continue;
				}
			} else if (!Number.isInteger(server.port ?? 502)) {
				errors.push(`${where}: port must be a TCP port number`);
				continue;
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

	/** A server may only answer units that have a device. */
	#check_server_units(entries, errors) {
		for (const { where, options } of entries) {
			for (const id of options.unit_ids ?? []) {
				if (!this.unit_map.unit_ids.includes(id)) errors.push(`${where}: unit_ids has unit ${id}, which has no device`);
			}
		}
	}

	#create_server(options) {
		const { protocol, host, port, baud_rate, parity, data_bits, stop_bits, unit_ids } = options;
		const { logger, vector } = this;
		if (protocol === "rtu") {
			return create_rtu_server(port, this.unit_map, { baud_rate, parity, data_bits, stop_bits, unit_ids, vector, logger });
		}
		return create_tcp_server(host, port, this.unit_map, { rtu: protocol === "rtu_over_tcp", unit_ids, vector, logger });
	}

	/**
	 * Gets the data block of a device.
	 *
	 * @param {string} name - The device name.
	 * @return {Ldata|undefined}
	 */
	device(name) {
		return this.devices.get(name);
	}

	/** Starts all the servers; rejects with the first error. */
	async start() {
		await Promise.all(this.servers.map((server) => server.start()));
	}

	/** Stops all the servers. */
	async stop() {
		await Promise.all(this.servers.map((server) => server.stop()));
	}
}

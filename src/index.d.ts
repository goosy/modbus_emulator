import type { Buffer } from "node:buffer";
import type { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import type { Description, Ldata, Layout, Layout_Scope } from "layout-data";

export { Ldata, Ltag, create_scope, get_scope, yaml, desc_file } from "layout-data";
export type {
	Layout, Layout_Scope, Layout_Tag, Layout_Desc, Block_Desc, Description, Registration, Endian, Tag_Type,
} from "layout-data";

/** A Modbus slave service (the server of es-modbus, a dependency of this package). */
export interface Modbus_Server extends EventEmitter {
	/** Identifies the server in events and errors; the label of its service in an emulator. */
	readonly name: string;
	/** `tcp`, `rtu_over_tcp` or `rtu`. */
	readonly protocol: "tcp" | "rtu_over_tcp" | "rtu";
	/** The TCP port, or the serial port path. */
	readonly port: number | string;
	/** Whether the server answers a unit id. */
	is_valid_unit_id(unit_id: number): boolean;
	start(): Promise<unknown>;
	stop(): Promise<unknown>;
	/** Sets the unit ids the server answers: one, a list, or every id with `"all"` / `"*"` / null. */
	set_unit_ids(unit_id: number | number[] | "all" | "*" | null | undefined): void;
}

/** An address that no block holds, emitted once per (kind, unit, address). */
export interface Unmapped_Event {
	kind: "holding_register" | "input_register" | "coil";
	unit_id: number;
	addr: number;
}

/** An error a listener of a block throws when a request commits; the data stay written. */
export interface Listener_Error_Event {
	block: Ldata;
	error: unknown;
}

/**
 * The es-modbus server handler over a unit map (see `create_handler`). It emits `unmapped` once per
 * unmapped address, for at most 1024 addresses, then `unmapped_limit` once, and `listener_error`.
 */
export interface Modbus_Handler extends EventEmitter {
	get_holding_register(addr: number, unit_id: number): number;
	get_input_register(addr: number, unit_id: number): number;
	/** Reads the registers of one FC 3 request, one `access` per block. */
	get_holding_registers(addr: number, quantity: number, unit_id: number): number[];
	/** Reads the registers of one FC 4 request, one `access` per block. */
	get_input_registers(addr: number, quantity: number, unit_id: number): number[];
	set_holding_register(addr: number, value: number, unit_id: number): void;
	/** Writes the registers of one FC 16 request atomically. */
	set_holding_registers(addr: number, values: number[], unit_id: number): void;
	get_coil(addr: number, unit_id: number): boolean;
	/** Reads the coils of one FC 1 or FC 2 request, one `access` per block. */
	get_coils(addr: number, quantity: number, unit_id: number): boolean[];
	set_coil(addr: number, value: boolean, unit_id: number): void;
	/** Writes the coils of one FC 15 request atomically. */
	set_coils(addr: number, values: boolean[], unit_id: number): void;
	on(event: "unmapped", listener: (event: Unmapped_Event) => void): this;
	on(event: "unmapped_limit", listener: (event: { limit: number }) => void): this;
	on(event: "listener_error", listener: (event: Listener_Error_Event) => void): this;
	on(event: string | symbol, listener: (...args: any[]) => void): this;
}

export interface Server_Options {
	/** The address to listen on; `0.0.0.0` by default. */
	host?: string;
	/** The port number; 502 by default, 0 lets the system choose one. */
	port?: number;
	rtu?: boolean;
	unit_ids?: number[];
	handler?: Modbus_Handler;
	/** The name of the server; `Modbus_Server` by default. */
	name?: string;
}

export interface Serial_Options {
	baud_rate?: number;
	parity?: "none" | "odd" | "even";
	data_bits?: number;
	stop_bits?: number;
	unit_ids?: number[];
	handler?: Modbus_Handler;
	/** The name of the server; `Modbus_Server` by default. */
	name?: string;
}

/** A byte range [start, end) of a unit, mapped to the bytes of a block from `offset`. */
export interface Unit_Segment {
	readonly block: Ldata;
	readonly start: number;
	readonly offset: number;
	readonly end: number;
}

export class Unit_Map {
	/** The units that have a block, in the order of their first attachment. */
	readonly unit_ids: number[];
	/** The segments of a unit sorted by start; empty for a unit without block. */
	segments(unit_id: number): readonly Unit_Segment[];
	/** The block that holds a byte of a unit and the byte offset in it; null for an unmapped byte. */
	resolve(unit_id: number, byte: number): { block: Ldata, offset: number } | null;
	/** @throws {RangeError} When start or offset is not an even non-negative integer. */
	attach_unit(unit_id: number, block: Ldata, start?: number, offset?: number): void;
}

export function create_handler(unit_map: Unit_Map): Modbus_Handler;
export function create_tcp_server(unit_map: Unit_Map, options?: Server_Options): Modbus_Server;
export function create_rtu_server(path: string, unit_map: Unit_Map, options?: Serial_Options): Modbus_Server;

/**
 * The payload of a forwarded server event `server_<name>`: the server, whose `name` tells the service,
 * and the argument es-modbus passed, if any.
 */
export interface Server_Event {
	server: Modbus_Server;
	/** For `server_socket_connect` and `server_socket_disconnect`. */
	socket?: Socket;
	/** For `server_socket_error`, `server_error` and `server_handler_error`. */
	error?: Error;
	/** For `server_receive` (the request frame) and `server_send` (the response frame). */
	frame?: Buffer;
}

export type Server_Event_Name =
	| "server_start" | "server_stop" | "server_socket_connect" | "server_socket_disconnect" | "server_socket_error"
	| "server_error" | "server_handler_error" | "server_receive" | "server_send";

/** A source of `load`: a description file (a path or a file: URL), or a Description compiled by `desc_file` or `yaml`. */
export type Emulator_Source = string | URL | Description;

/** A diagnostic of a load: a server on a serial bus that answers unit 0 or a reserved unit. */
export interface Warning_Event {
	server: Modbus_Server;
	/** Starts with the name of the server. */
	message: string;
}

/**
 * The emulator forwards the events of its servers as `server_<name>`, and the events of its handler unchanged.
 * It emits `warning` for the diagnostics of a load, and never emits `error`.
 */
export class Modbus_Emulator extends EventEmitter {
	/**
	 * Creates an emulator without blocks and services: `load` loads the descriptions.
	 *
	 * @param scope - The name of the layout scope the descriptions are loaded into, created when it does not
	 *     exist; `modbus_emulator` by default.
	 */
	constructor(scope?: string);
	/**
	 * Loads sources, all or nothing, any number of times; the servers are not started. A source is a description
	 * file, compiled with `desc_file`, or a Description.
	 *
	 * @returns The blocks and the servers this call added.
	 * @throws {Error} With `errors`, every violation found; the emulator and the scope are left as they were.
	 */
	load(sources: Emulator_Source | Emulator_Source[]): { blocks: Map<string, Ldata>, servers: Modbus_Server[] };
	readonly unit_map: Unit_Map;
	readonly handler: Modbus_Handler;
	readonly blocks: ReadonlyMap<string, Ldata>;
	/** The layout scope the descriptions are loaded into. */
	readonly scope: Layout_Scope;
	/** The layouts of the descriptions, by name. */
	readonly layouts: Readonly<Record<string, Layout>>;
	/** Item `i` is the service entry `i` of the descriptions loaded, in order, named by its label. */
	readonly servers: readonly Modbus_Server[];
	block(name: string): Ldata | undefined;
	/**
	 * Starts the servers that are not running. When any fails, rejects with an `AggregateError` of every failure,
	 * after stopping all the servers, or with `partial: true` leaving the started ones running. Rejects with an
	 * `Error` when the emulator has no server.
	 */
	start(options?: { partial?: boolean }): Promise<void>;
	/** Stops all the servers and gives the block names back to their layouts; the blocks keep working. */
	stop(): Promise<void>;
	on(event: Server_Event_Name, listener: (event: Server_Event) => void): this;
	on(event: "warning", listener: (event: Warning_Event) => void): this;
	on(event: "unmapped", listener: (event: Unmapped_Event) => void): this;
	on(event: "unmapped_limit", listener: (event: { limit: number }) => void): this;
	on(event: "listener_error", listener: (event: Listener_Error_Event) => void): this;
	on(event: string | symbol, listener: (...args: any[]) => void): this;
}

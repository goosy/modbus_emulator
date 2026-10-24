import type { EventEmitter } from "node:events";
import type { Ldata, Layout } from "layout-data";

export { Ldata, Ltag, register_layout, get_layout, io_index_table, render_types } from "layout-data";
export type {
	Layout, Layout_Tag, Layout_Item, Tag_Item, Include_Item, Layout_Description,
	Layout_Source, Registered_Layouts, Endian, Tag_Type,
} from "layout-data";

/** A Modbus slave service (the server of es-modbus, a dependency of this package). */
export interface Modbus_Server extends EventEmitter {
	start(): Promise<unknown>;
	stop(): Promise<unknown>;
	/** Sets the unit ids the server answers: one, a list, or every id with `"all"` / `"*"` / null. */
	set_unit_ids(unit_id: number | number[] | "all" | "*" | null | undefined): void;
}

/**
 * The es-modbus server handler over a unit map (see `create_handler`). It emits `listener_error`
 * for an error a block listener throws when a batch request commits.
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
	on(event: "listener_error", listener: (event: { block: Ldata, error: unknown }) => void): this;
}

export interface Emulator_Logger {
	info?: (message: string) => void;
	warn?: (message: string) => void;
	error?: (message: string) => void;
}

export interface Server_Options {
	rtu?: boolean;
	unit_ids?: number[];
	handler?: Modbus_Handler;
	logger?: Emulator_Logger;
}

export interface Serial_Options {
	baud_rate?: number;
	parity?: "none" | "odd" | "even";
	data_bits?: number;
	stop_bits?: number;
	unit_ids?: number[];
	handler?: Modbus_Handler;
	logger?: Emulator_Logger;
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

export function create_handler(unit_map: Unit_Map, options?: { logger?: Emulator_Logger }): Modbus_Handler;
export function create_tcp_server(host: string | undefined, port: number | undefined, unit_map: Unit_Map, options?: Server_Options): Modbus_Server;
export function create_rtu_server(path: string, unit_map: Unit_Map, options?: Serial_Options): Modbus_Server;

export class Modbus_Emulator {
	constructor(source: string | string[], options?: {
		logger?: Emulator_Logger;
	});
	unit_map: Unit_Map;
	handler: Modbus_Handler;
	blocks: Map<string, Ldata>;
	layouts: Record<string, Layout>;
	servers: Modbus_Server[];
	block(name: string): Ldata | undefined;
	/**
	 * Starts all the servers. When any fails, rejects with an `AggregateError` of every failure, after stopping all
	 * the servers, or with `partial: true` leaving the started ones running.
	 */
	start(options?: { partial?: boolean }): Promise<void>;
	stop(): Promise<void>;
}

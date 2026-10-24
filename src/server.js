import { Modbus_Server } from "es-modbus";
import { create_handler } from "./unit_map.js";

/**
 * Creates a Modbus TCP server, or an RTU-over-TCP server with `rtu: true`.
 * The server is not started: call `server.start()`. No listener is added to it: listen to its
 * `error` event at least, which throws when it has no listener.
 *
 * @param {string} host - The address to listen on, default 0.0.0.0.
 * @param {number} port - The port number, default 502.
 * @param {Unit_Map} unit_map - The data blocks served per unit id.
 * @param {Object} [options]
 * @param {boolean} [options.rtu=false] - Use RTU framing on the accepted sockets (RTU-over-TCP).
 * @param {number[]} [options.unit_ids] - The unit ids this server answers; every unit of the unit map when omitted.
 * @param {Object} [options.handler] - The handler to serve, from `create_handler`; servers of one unit map can share it. Built from the unit map when omitted.
 * @param {string} [options.name] - The name of the server, which identifies it in events and errors; `Modbus_Server` by default.
 * @return {import('es-modbus').Modbus_Server} The server instance.
 */
export function create_tcp_server(host = "0.0.0.0", port = 502, unit_map, { rtu = false, unit_ids: _unit_ids, handler: _handler, name } = {}) {
	if (unit_map === undefined || unit_map === null) throw new Error("unit_map is required");
	const unit_ids = _unit_ids ?? unit_map.unit_ids;
	const handler = _handler ?? create_handler(unit_map);
	return new Modbus_Server(handler, { host, port, rtu, unit_id: unit_ids, name });
}

/**
 * Creates a Modbus RTU slave on a serial port.
 * The server is not started: call `server.start()`, which opens the port. No listener is added
 * to it: listen to its `error` event at least, which throws when it has no listener.
 *
 * @param {string} path - The serial device path, e.g. COM3 or /dev/ttyUSB0.
 * @param {Unit_Map} unit_map - The data blocks served per unit id.
 * @param {Object} [options]
 * @param {number} [options.baud_rate=9600]
 * @param {'none'|'odd'|'even'} [options.parity='none']
 * @param {number} [options.data_bits=8]
 * @param {number} [options.stop_bits=1]
 * @param {number[]} [options.unit_ids] - The unit ids this server answers; every unit of the unit map when omitted.
 * @param {Object} [options.handler] - The handler to serve, from `create_handler`; servers of one unit map can share it. Built from the unit map when omitted.
 * @param {string} [options.name] - The name of the server, which identifies it in events and errors; `Modbus_Server` by default.
 * @return {import('es-modbus').Modbus_Server} The server instance.
 */
export function create_rtu_server(path, unit_map, { unit_ids: _unit_ids, handler: _handler, name, ...serial } = {}) {
	if (typeof path !== "string" || path === "") throw new Error(`Invalid serial port path: ${path}`);
	if (unit_map === undefined || unit_map === null) throw new Error("unit_map is required");
	const unit_ids = _unit_ids ?? unit_map.unit_ids;
	const { baud_rate, parity, data_bits, stop_bits } = serial;
	const handler = _handler ?? create_handler(unit_map);
	return new Modbus_Server(handler, {
		port: path, baud_rate, parity, data_bits, stop_bits, unit_id: unit_ids, name,
	});
}

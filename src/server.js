import { Modbus_Server } from "es-modbus";
import { create_vector } from "./unit_map.js";

/** A logger that has the three levels used here, whatever the given one lacks is silent. */
export function normalize_logger(logger) {
	const level = (name) => (message) => logger?.[name]?.(message);
	return { info: level("info"), warn: level("warn"), error: level("error") };
}

/** Reports the events of a server through the logger. */
function log_events(server, label, logger) {
	server.on("start", () => {
		logger.info(`Modbus server listening on ${label}`);
	});
	server.on("socket_error", (err) => {
		logger.error(`client error: ${err.message}`);
	});
	server.on("socket_connect", (socket) => {
		logger.info(`client connected: ${socket.remoteAddress}:${socket.remotePort}`);
	});
	server.on("socket_disconnect", (socket) => {
		logger.info(`client disconnected: ${socket.remoteAddress}:${socket.remotePort}`);
	});
	server.on("error", (err) => {
		logger.error(`server error: ${err.message}`);
	});
	server.on("vector_error", (err) => {
		logger.error(`server request failed: ${err.message}`);
	});
	server.on("stop", () => {
		logger.info(`Modbus server ${label} stopped`);
	});
}

/**
 * Creates a Modbus TCP server, or an RTU-over-TCP server with `rtu: true`.
 * The server is not started: call `server.start()`.
 *
 * @param {string} host - The address to listen on, default 0.0.0.0.
 * @param {number} port - The port number, default 502.
 * @param {Unit_Map} unit_map - The data blocks served per unit id.
 * @param {Object} [options]
 * @param {boolean} [options.rtu=false] - Use RTU framing on the accepted sockets (RTU-over-TCP).
 * @param {number[]} [options.unit_ids] - The unit ids this server answers; every unit of the unit map when omitted.
 * @param {Object} [options.vector] - The vector to serve, from `create_vector`; servers of one unit map can share it. Built from the unit map when omitted.
 * @param {{info: Function, warn: Function, error: Function}} [options.logger] - Silent by default.
 * @return {import('es-modbus').Modbus_Server} The server instance.
 */
export function create_tcp_server(host = "0.0.0.0", port = 502, unit_map = {}, { rtu = false, unit_ids = unit_map.unit_ids, vector: _vector, logger: _logger } = {}) {
	const logger = normalize_logger(_logger);
	const vector = _vector ?? create_vector(unit_map, { logger });
	const server = new Modbus_Server(vector, { host, port, rtu, unit_id: unit_ids });
	log_events(server, `${rtu ? "rtu" : "modbus"}://${host}:${port}`, logger);
	return server;
}

/**
 * Creates a Modbus RTU slave on a serial port.
 * The server is not started: call `server.start()`, which opens the port.
 *
 * @param {string} path - The serial device path, e.g. COM3 or /dev/ttyUSB0.
 * @param {Unit_Map} unit_map - The data blocks served per unit id.
 * @param {Object} [options]
 * @param {number} [options.baud_rate=9600]
 * @param {'none'|'odd'|'even'} [options.parity='none']
 * @param {number} [options.data_bits=8]
 * @param {number} [options.stop_bits=1]
 * @param {number[]} [options.unit_ids] - The unit ids this server answers; every unit of the unit map when omitted.
 * @param {Object} [options.vector] - The vector to serve, from `create_vector`; servers of one unit map can share it. Built from the unit map when omitted.
 * @param {{info: Function, warn: Function, error: Function}} [options.logger] - Silent by default.
 * @return {import('es-modbus').Modbus_Server} The server instance.
 */
export function create_rtu_server(path, unit_map = {}, { unit_ids = unit_map.unit_ids, vector: _vector, logger: _logger, ...serial } = {}) {
	const logger = normalize_logger(_logger);
	if (typeof path !== "string" || path === "") throw new Error(`Invalid serial port path: ${path}`);
	const { baud_rate, parity, data_bits, stop_bits } = serial;
	const vector = _vector ?? create_vector(unit_map, { logger });
	const server = new Modbus_Server(vector, {
		port: path, baud_rate, parity, data_bits, stop_bits, unit_id: unit_ids,
	});
	log_events(server, `serial://${path}`, logger);
	return server;
}

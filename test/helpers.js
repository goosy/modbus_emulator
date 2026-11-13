import net from "node:net";

export const HOST = "127.0.0.1";

/**
 * Makes a TCP-family server listen on port 0 at its next start, so the system picks a free port,
 * and no other process can take it between probing and listening. The options of es-modbus do
 * not accept port 0: the server is built with a fixed port, then its `port` is set to 0, as the
 * tests of es-modbus do. Returns the server.
 */
export function ephemeral(server) {
	server.port = 0;
	return server;
}

/** The options of an es-modbus Modbus_Client, the master of a TCP port of HOST, RTU framed with `rtu`. */
export function master_options(port, rtu = false) {
	return { [rtu ? "rtu_over_tcp" : "tcp"]: `${HOST}:${port}`, reconnect_time: 0 };
}

/**
 * The TCP port a started server listens on. es-modbus keeps the configured port (0) in
 * `server.port`: the actual one is only read from its internal net server.
 */
export function listening_port(server) {
	return server.server.address().port;
}

/** Starts a plain net server on a system-picked port of HOST and returns it with that port. */
export async function hold_port() {
	const holder = net.createServer();
	await new Promise((resolve) => holder.listen(0, HOST, resolve));
	return { holder, port: holder.address().port };
}

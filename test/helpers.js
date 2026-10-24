import net from "node:net";

export const HOST = "127.0.0.1";

/**
 * The TCP port a started server listens on. A server under test listens on port 0, so the
 * system picks a free port, and no other process can take it between probing and listening.
 * es-modbus keeps the configured port (0) in `server.port`: the actual one is only read from
 * its internal net server.
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

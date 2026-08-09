import { createAdapter } from "@socket.io/postgres-adapter";
import { createServer } from "node:http";
import { Server } from "socket.io";

import { pool } from "./db/pool.js";
import { makeApp } from "./http.js";
import { startSim } from "./simulator.js";

let sockets;

function send() {
  sockets.emit("medical:update");
}

export const app = makeApp(send);
export const server = createServer(app);
sockets = new Server(server, { transports: ["websocket"] });
sockets.adapter(createAdapter(pool));

const stop = startSim(pool, send);
server.on("close", stop);

if (!process.env.VERCEL) {
  server.listen(Number(process.env.PORT) || 4000);
}

export default server;

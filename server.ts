import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { attachWebSocketHub } from "./lib/server/ws-hub";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "localhost";
const port = parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port, turbopack: dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    try {
      const parsedUrl = parse(req.url ?? "", true);
      void handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error handling request", err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  attachWebSocketHub(server);

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});

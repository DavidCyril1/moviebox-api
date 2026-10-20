import { serve } from "@hono/node-server";
import { app } from "./app.js";

const PORT = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, () => {
  console.log(`\nMovieBox API  →  http://0.0.0.0:${PORT}\n`);
});

import { spawn } from "child_process";
import fs from "fs";
import https from "https";
import { serve } from "@hono/node-server";
import { app } from "./src/app.js";

const BIN = "./cloudflared";
const CF_URL =
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64";
const CF_TOKEN =
  process.env.CF_TUNNEL_TOKEN || "";

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const get = (u, hops = 0) => {
      if (hops > 5) return reject(new Error("too many redirects"));
      https
        .get(u, (res) => {
          if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
            return get(res.headers.location, hops + 1);
          }
          if (res.statusCode !== 200) {
            return reject(new Error("HTTP " + res.statusCode));
          }
          const f = fs.createWriteStream(dest);
          res.pipe(f);
          f.on("finish", () => f.close(() => resolve()));
          f.on("error", reject);
        })
        .on("error", reject);
    };
    get(url);
  });
}

function startTunnel() {
  if (!CF_TOKEN) {
    console.log("[tunnel] Missing CF_TUNNEL_TOKEN — skip cloudflared");
    return;
  }
  console.log("[tunnel] starting cloudflared…");
  const p = spawn(BIN, ["tunnel", "--no-autoupdate", "run", "--token", CF_TOKEN], {
    stdio: "inherit",
  });
  p.on("error", (e) => console.error("[tunnel] spawn error:", e.message));
  p.on("exit", (c) => {
    console.log("[tunnel] cloudflared exited", c, "— retry in 5s");
    setTimeout(startTunnel, 5000);
  });
}

async function bootTunnel() {
  try {
    if (!CF_TOKEN) {
      console.log("[tunnel] no token — app only");
      return;
    }
    if (!fs.existsSync(BIN)) {
      console.log("[tunnel] downloading cloudflared…");
      await download(CF_URL, BIN);
      fs.chmodSync(BIN, 0o755);
      console.log("[tunnel] download ok");
    } else {
      try { fs.chmodSync(BIN, 0o755); } catch {}
    }
    startTunnel();
  } catch (e) {
    console.error("[tunnel] setup failed:", e.message);
  }
}

bootTunnel();

const PORT = Number(process.env.PORT) || 20085;
serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, () => {
  console.log("MovieBox API  →  http://0.0.0.0:" + PORT);
});

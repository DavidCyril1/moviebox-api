import { app } from "../../src/app.js";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, _ctx: Context): Promise<Response> => {
  return app.fetch(req);
};

export const config: Config = {
  path: "/*",
};

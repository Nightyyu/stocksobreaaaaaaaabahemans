import { PythonWorker } from "cloudflare:python";

export default {
  async fetch(request, env, ctx) {
    const py = new PythonWorker();
    return await py.fetch(request, env, ctx);
  },
};

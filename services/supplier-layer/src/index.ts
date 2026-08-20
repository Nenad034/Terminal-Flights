import express from "express";
import { DuffelAdapter } from "./adapters/duffel.js";
import type { SupplierAdapter } from "./adapters/adapter.js";

const PORT = process.env.SUPPLIER_LAYER_PORT ?? 4001;

const adapters: SupplierAdapter[] = [
  new DuffelAdapter(process.env.DUFFEL_API_KEY ?? "", process.env.DUFFEL_API_BASE),
];

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "supplier-layer", adapters: adapters.map((a) => a.code) });
});

// F0 skeleton endpoint — puni fan-out/de-dup/ranking dolazi u F1 (§04 Search & Shopping).
app.post("/search", async (req, res) => {
  const params = req.body;
  const results = await Promise.all(adapters.map((adapter) => adapter.search(params)));
  res.json({ offers: results.flat() });
});

app.listen(PORT, () => {
  console.log(`[supplier-layer] listening on :${PORT}`);
});

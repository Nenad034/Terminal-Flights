import express from "express";
import { AmadeusAdapter } from "./adapters/amadeus.js";
import { DuffelAdapter } from "./adapters/duffel.js";
import { SabreAdapter } from "./adapters/sabre.js";
import { TravelfusionAdapter } from "./adapters/travelfusion.js";
import { TravelportAdapter } from "./adapters/travelport.js";
import type { SupplierAdapter } from "./adapters/adapter.js";

const PORT = process.env.SUPPLIER_LAYER_PORT ?? 4001;

// Agregator: svaki dobavljač je jedan adapter iza istog SupplierAdapter
// ugovora (§03). Duffel je jedini aktivan (self-serve, bez sertifikacije) —
// ostali su registrovani kao stub-ovi (search() -> []) dok se ne obezbedi
// komercijalni/sertifikacioni pristup; videti komentare u svakom fajlu.
const adapters: SupplierAdapter[] = [
  new DuffelAdapter(process.env.DUFFEL_API_KEY ?? "", process.env.DUFFEL_API_BASE),
  new AmadeusAdapter(),
  new SabreAdapter(),
  new TravelportAdapter(),
  new TravelfusionAdapter(),
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

// Web klijent (§07 Ancillaries) traži dostupna sedišta za ponudu pre nego
// što korisnik ide na booking. 501 ako adapter ne podržava ancillaries.
app.get("/offers/:supplierOfferRef/ancillaries", async (req, res) => {
  const { supplierOfferRef } = req.params;
  const { supplierCode } = req.query;
  const adapter = adapters.find((a) => a.code === supplierCode);

  if (!adapter) {
    res.status(404).json({ error: `unknown supplier: ${supplierCode}` });
    return;
  }
  if (!adapter.getAncillaries) {
    res.status(501).json({ error: `supplier ${supplierCode} does not support ancillaries yet` });
    return;
  }

  try {
    const options = await adapter.getAncillaries(supplierOfferRef);
    res.json({ options });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Booking saga (§05) poziva ovo da napravi order kod konkretnog dobavljača.
// 501 ako adapter za taj supplierCode ne podržava createOrder (npr. jer nije
// još sertifikovan — Amadeus/Sabre/Travelport/Travelfusion stub-ovi, §03).
app.post("/orders", async (req, res) => {
  const { supplierCode, ...params } = req.body;
  const adapter = adapters.find((a) => a.code === supplierCode);

  if (!adapter) {
    res.status(404).json({ error: `unknown supplier: ${supplierCode}` });
    return;
  }
  if (!adapter.createOrder) {
    res.status(501).json({ error: `supplier ${supplierCode} does not support order creation yet` });
    return;
  }

  try {
    const order = await adapter.createOrder(params);
    res.status(201).json({ order });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Booking saga (§05/§07) poziva ovo da plati "hold" order kod dobavljača
// koji je merchant of record (Duffel). 501 ako adapter ne podržava plaćanje
// preko sebe (GDS dobavljači bi ovde bili no-op jer je naplata preko
// sopstvenog PSP-a, van supplier adaptera — nije implementirano dok ti
// adapteri nisu aktivni).
app.post("/orders/:supplierOrderRef/pay", async (req, res) => {
  const { supplierOrderRef } = req.params;
  const { supplierCode, amount, currency } = req.body;
  const adapter = adapters.find((a) => a.code === supplierCode);

  if (!adapter) {
    res.status(404).json({ error: `unknown supplier: ${supplierCode}` });
    return;
  }
  if (!adapter.payOrder) {
    res.status(501).json({ error: `supplier ${supplierCode} does not support payment via supplier-layer` });
    return;
  }

  try {
    const order = await adapter.payOrder(supplierOrderRef, amount, currency);
    res.json({ order });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Booking saga (§05/§08 Post-sale) traži kotaciju otkazivanja — koliko će se
// refundirati — pre nego što korisnik potvrdi. 501 ako adapter ne podržava
// otkazivanje (isti obrazac kao gore).
app.post("/orders/:supplierOrderRef/cancellation-quote", async (req, res) => {
  const { supplierOrderRef } = req.params;
  const { supplierCode, orderId } = req.body;
  const adapter = adapters.find((a) => a.code === supplierCode);

  if (!adapter) {
    res.status(404).json({ error: `unknown supplier: ${supplierCode}` });
    return;
  }
  if (!adapter.quoteCancellation) {
    res.status(501).json({ error: `supplier ${supplierCode} does not support cancellation yet` });
    return;
  }

  try {
    const quote = await adapter.quoteCancellation(orderId, supplierOrderRef);
    res.json({ quote });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Potvrđuje prethodno dobijenu kotaciju otkazivanja — ovo je nepovratan
// korak kod dobavljača (refund se pokreće).
app.post("/order-cancellations/:supplierCancellationRef/confirm", async (req, res) => {
  const { supplierCancellationRef } = req.params;
  const { supplierCode } = req.body;
  const adapter = adapters.find((a) => a.code === supplierCode);

  if (!adapter) {
    res.status(404).json({ error: `unknown supplier: ${supplierCode}` });
    return;
  }
  if (!adapter.confirmCancellation) {
    res.status(501).json({ error: `supplier ${supplierCode} does not support cancellation yet` });
    return;
  }

  try {
    await adapter.confirmCancellation(supplierCancellationRef);
    res.json({ confirmed: true });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`[supplier-layer] listening on :${PORT}`);
});

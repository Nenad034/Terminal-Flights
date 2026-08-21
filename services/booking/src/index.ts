import express from "express";
import { confirmCancellation, quoteCancellation } from "./cancel.js";
import { startBookingSaga } from "./saga.js";

const PORT = process.env.BOOKING_PORT ?? 4002;

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "booking" });
});

// F1 — puna saga orkestracija: QC → supplier reservation → payment → ledger
// (§05 Booking & Order).
app.post("/orders", async (req, res) => {
  try {
    const order = await startBookingSaga(req.body);
    res.status(201).json({ order });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Post-sale (§08): kotacija otkazivanja, ne menja stanje.
app.post("/orders/:orderId/cancellation-quote", async (req, res) => {
  try {
    const quote = await quoteCancellation(req.params.orderId);
    res.json({ quote });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Post-sale (§08): potvrda otkazivanja — nepovratna, refund se pokreće.
app.post("/orders/:orderId/cancellation-confirm", async (req, res) => {
  try {
    const order = await confirmCancellation(req.params.orderId, req.body.supplierCancellationRef);
    res.json({ order });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`[booking] listening on :${PORT}`);
});

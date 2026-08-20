import express from "express";
import { startBookingSaga } from "./saga.js";

const PORT = process.env.BOOKING_PORT ?? 4002;

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "booking" });
});

// F0 skeleton — puna saga orkestracija (supplier → payments → ticketing → ledger)
// dolazi u F1 (§05 Booking & Order).
app.post("/orders", async (req, res) => {
  try {
    const order = await startBookingSaga(req.body);
    res.status(201).json({ order });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`[booking] listening on :${PORT}`);
});

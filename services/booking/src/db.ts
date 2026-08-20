import { Pool } from "pg";

// OLTP konekcija (§10 Data Platform) — PostgreSQL je system of record za Order/Trip
// agregate i (kasnije) ledger (§09).
export const pool = new Pool({
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? "terminal_flights",
  user: process.env.POSTGRES_USER ?? "terminal_flights",
  password: process.env.POSTGRES_PASSWORD ?? "terminal_flights_dev",
});

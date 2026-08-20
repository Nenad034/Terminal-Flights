# Terminal Flights

Platforma za pretragu i rezervaciju letova. Puna arhitektura je opisana u
[`docs/flight-platform-architecture.html`](docs/flight-platform-architecture.html)
(22 poglavlja) i vizuelno u [`docs/00-MAPA-MODULA.html`](docs/00-MAPA-MODULA.html).

Ovaj repo je **F0 (Temelj) scaffold** prema faznom planu iz poglavlja 22 —
struktura i skeleton servisa po tehnologijama iz poglavlja 19, bez pune poslovne
logike (ta dolazi kroz F1–F4).

## Struktura monorepoa

```
apps/
  web/                 Next.js 15 + React 19 web klijent (§19)
services/
  supplier-layer/      Node/TS — Supplier Abstraction Layer (§03), Duffel adapter
  booking/              Node/TS — Booking & Order (§05), saga skeleton
  search-fanout/        Go — Search fan-out orchestrator (§04, §19)
  pricing/              Python (FastAPI) — predictive pricing / data-ML (§04, §17, §19)
packages/
  shared-types/         Deljeni TS modeli: Offer, Order, Trip (§03, §06)
infra/
  docker-compose.yml    Postgres, Redis, Kafka, OpenSearch (§10, §19)
  postgres/init/        Inicijalna OLTP šema
docs/
  flight-platform-architecture.html   Puna arhitektura
  00-MAPA-MODULA.html                 Interaktivna mapa modula
```

## Preduslovi

- Node.js 22 LTS + [pnpm](https://pnpm.io) 9.x (`corepack enable`)
- Go 1.23
- Python 3.12
- Docker Desktop (za infra: Postgres/Redis/Kafka/OpenSearch)

## Pokretanje (lokalni dev)

```bash
# 1. Instaliraj Node zavisnosti (workspace: apps/web, services/supplier-layer,
#    services/booking, packages/shared-types)
pnpm install

# 2. Podigni infrastrukturu
cp .env.example .env
pnpm infra:up

# 3. Pokreni Node servise (svaki u svom terminalu)
pnpm dev:supplier-layer   # :4001
pnpm dev:booking          # :4002
pnpm dev:web              # :3000

# 4. Go servis
cd services/search-fanout && go run .   # :4003

# 5. Python servis
cd services/pricing
python -m venv .venv && . .venv/Scripts/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 4004
```

Zaustavi infra: `pnpm infra:down`.

## Status implementacije

Svi servisi su **F0 skeletoni**: imaju `/health`, osnovnu strukturu i mesto gde
dolazi poslovna logika (označeno `TODO (F1...)` komentarima u kodu). Sledeći
korak je F1 MVP: puna Search & Shopping orkestracija, Booking saga do kraja
(payments, ticketing, ledger) — prati tok opisan u `docs/00-MAPA-MODULA.html`
(dugme "Prikaži tok kupovine karte").

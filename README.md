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

Svi servisi imaju `/health` i osnovnu strukturu (**F0**). F1 je u toku:

- **supplier-layer**: Duffel adapter potpuno implementiran (search, order
  creation, payment preko Duffel balance-a jer je Duffel merchant of record
  §07, dvofazno cancellation). Amadeus, Sabre, Travelport, Travelfusion su
  registrovani u agregatoru kao stub-ovi (`search()` vraća `[]`) dok se ne
  obezbedi komercijalni/sertifikacioni pristup — videti komentare u svakom
  `src/adapters/*.ts` fajlu za tačan status i šta nedostaje.
- **booking**: saga radi QC proveru (istekla ponuda?) → rezerviše kod
  dobavljača → plaća preko supplier-layer `/orders/:ref/pay` → upisuje status
  u Postgres → upiše minimalni dvostruki ledger zapis (`accounts_receivable`
  / `supplier_payable`, §09 — puni kontni plan sa markup/proviziju/porezom
  dolazi kad postoji stvarni komisioni model). Kompenzacija na grešku: order
  ostaje `pending`/held za manuelni review ako plaćanje padne posle uspešne
  rezervacije, `failed` ako rezervacija nikad nije uspela. Eksplicitan
  ticketing korak za GDS dobavljače ostaje `TODO (F1 nastavak)` — Duffel
  izdaje tiket automatski nakon plaćanja.
- **otkazivanje (§08 Post-sale)**: dvostepeno — `POST
  /orders/:orderId/cancellation-quote` traži kotaciju (koliko se refundira,
  bez ikakve nepovratne akcije), `POST /orders/:orderId/cancellation-confirm`
  potvrđuje (nepovratno kod dobavljača) i upisuje reverzni ledger zapis. Isti
  obrazac je izložen kroz web BFF (`/api/booking/[orderId]/cancellation-*`) i
  UI (dugme "Otkaži rezervaciju" nakon uspešne rezervacije).
- **manage booking (§12 self-service)**: `GET /orders/:orderId` (samo čitanje
  iz naše baze, ne pita dobavljača uživo — to je §08 TODO). Web stranica
  `/booking/[orderId]` prikazuje status i nudi isti quote→confirm cancel tok;
  početna strana ima lookup formu (unos order ID-a), a uspešna rezervacija
  nudi link ka toj stranici za kasniji pregled.
- **search-fanout**: de-dup (isti let od više dobavljača → zadrži najjeftiniji)
  + ranking po ceni implementirani (§04). Puniji ranking (trajanje,
  presedanja, korisnički signali) ostaje za kasnije, kad postoje stvarni
  podaci o ponašanju korisnika.
- **pricing**: i dalje F0 — predictive pricing model dolazi kasnije u F4, kad
  data warehouse ima dovoljno istorije.
- **web**: search forma prikazuje ponude (dobavljač, segmenti, cena), klik na
  ponudu otvara minimalnu formu za jednog putnika i šalje rezervaciju preko
  novog `/api/booking` BFF proxy-ja ka booking servisu. I dalje F1 skeleton —
  bez UI-ja za višeputnički checkout, plaćanje karticom (customer-facing PSP
  još ne postoji, §07) ili manage-booking.

Prati tok opisan u `docs/00-MAPA-MODULA.html` (dugme "Prikaži tok kupovine
karte").

## Testovi

`services/booking` i `services/supplier-layer` imaju vitest jedinične
testove (`pnpm test` za ceo workspace preko `--if-present`, ili
`pnpm --filter <ime> test` za jedan servis):

- **booking**: saga i otkazivanje — mock-uju `pool.query` i `fetch`, pokrivaju
  kompenzacione putanje (QC odbijanje, pad rezervacije, pad plaćanja) jer su
  se tu do sada dešavale prave greške pri ručnom testiranju.
- **supplier-layer**: Duffel adapter — mapiranje Offer/Order (search, hold
  order status derivacija, payment→ticketed prelaz), graceful degrade bez
  ključa/na grešku, dvofazno cancellation (default refund vrednosti kad
  Duffel vrati `null`).

CI (`.github/workflows/ci.yml`) ih pokreće pre build koraka. Ostali servisi
(search-fanout, pricing, web) još nemaju automatske testove.

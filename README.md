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
  creation u dva moda — plaćanje karticom korisnika pri kreiranju, §07, ili
  "hold" + odvojeno plaćanje preko Duffel balance-a — dvofazno cancellation).
  Amadeus, Sabre, Travelport, Travelfusion su
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
- **ancillaries (§07)**: sedišta (Duffel Seat Maps API) i dodatni prtljag
  (Duffel `available_services` na ponudi, `GET
  /air/offers/:id?return_available_services=true` — potvrđeno iz zvanične
  dokumentacije, "Adding Extra Bags" vodič). `GET
  /offers/:supplierOfferRef/ancillaries?supplierCode=...` na supplier-layer-u
  vraća oba tipa u jednoj ravnoj listi (`type: "seat" | "baggage"`), izloženo
  kroz `/api/ancillaries` na webu; korisnik bira sedište i količinu prtljaga
  po putniku, cena se dodaje u `totalAmount`. `POST /air/orders` `services`
  polje je sad potvrđeno iz dokumentacije (`{id, quantity}`, isti primer se
  koristi i za prtljag) — ranija napomena o nesigurnosti tog oblika više ne
  važi za ovaj deo; `metadata` sa težinom/dimenzijama torbe i dalje nije
  dokumentovan pa nije korišćen. **Mapiranje po putniku**: Duffel-ova Offer
  šema nosi svoj `passengers[]` niz (`{id, type}`, potvrđeno iz zvanične
  dokumentacije) istim redosledom kojim su poslati u search zahtevu — adapter
  ga izlaže kao `Offer.passengerIds`, a svaka ancillary opcija nosi
  `AncillaryOption.passengerIds` (od `available_services.passenger_id(s)`).
  Frontend upoređuje `offer.passengerIds[i]` sa opcijama da prikaže tačno
  onu sedište/prtljag ponudu koja važi za putnika `i`, umesto jedne deljene
  liste — ranije ograničenje na rezervacije sa 1 putnikom je uklonjeno.
- **naplata od korisnika (§07)**: arhitektura eksplicitno kaže da je Duffel
  merchant of record i sam skida sredstva sa korisnika — nema potrebe za
  sopstvenim PSP-om (Stripe/Adyen) dok ne postoji aktivan GDS dobavljač gde bi
  *mi* bili MoR. Kompletan tok je implementiran, server i klijent: `POST
  /payment-sessions` generiše Duffel "component client key"
  (`identity/component_client_keys`), izloženo kroz `/api/payment-sessions`
  BFF proxy na webu. Klijent (`@duffel/components`, tačni tipovi potvrđeni
  direktno iz instaliranog paketa, ne samo iz docs stranica) prikazuje
  `DuffelCardForm` (PCI-compliant iframe — broj kartice nikad ne prolazi kroz
  naš kod), preko `useDuffelCardFormActions().createCardForTemporaryUse()`
  tokenizuje karticu, pa `createThreeDSecureSession(clientKey, cardId,
  supplierOfferRef, services, true)` traži 3DS autentikaciju za tačan iznos.
  Kad sesija vrati `status: "ready_for_payment"`, `three_d_secure_session_id`
  ide u booking zahtev kao `cardPayment.threeDSecureSessionId` — booking saga
  pravi order kao `type: "instant"` sa `payments: [{type: "card", ...}]` i
  preskače odvoljeni balance korak jer je već plaćen. Ako dobavljač ne
  podržava kartično plaćanje preko sebe (`/payment-sessions` vrati 501, npr.
  Amadeus/Sabre/Travelport/Travelfusion stub-ovi), UI graciozno pada na
  postojeći "hold" tok bez kartice. Testirano end-to-end uživo (pravi Duffel
  401 bez API ključa potvrđuje da ceo lanac BFF → supplier-layer → adapter
  radi — vidi napomenu o Duffel ključu ispod), i vitest testovima koji
  mokuju `@duffel/components` (uspešna tokenizacija+3DS+booking, neuspeo
  3DS, neuspela tokenizacija kartice).
- **search-fanout**: de-dup (isti let od više dobavljača → zadrži najjeftiniji)
  + ranking po ceni implementirani (§04). Puniji ranking (trajanje,
  presedanja, korisnički signali) ostaje za kasnije, kad postoje stvarni
  podaci o ponašanju korisnika.
- **pricing**: i dalje F0 — predictive pricing model dolazi kasnije u F4, kad
  data warehouse ima dovoljno istorije.
- **web**: search forma ima broj putnika (1-9), prikazuje ponude, klik na
  ponudu otvara formu po jedan blok za svakog putnika i šalje rezervaciju
  preko `/api/booking` BFF proxy-ja. Svaki putnik-blok ima svoj sedište i
  prtljag izbor, ispravno mapiran na dobavljačev `passenger_id` (§07, videti
  gore) — nije više ograničeno na 1 putnika. Ima i UI za kartično plaćanje
  (§07, videti gore). I dalje F1 skeleton.

Prati tok opisan u `docs/00-MAPA-MODULA.html` (dugme "Prikaži tok kupovine
karte").

## Testovi

`services/booking`, `services/supplier-layer` i `apps/web` imaju vitest
testove (`pnpm test` za ceo workspace preko `--if-present`, ili
`pnpm --filter <ime> test` za jedan paket), `services/search-fanout` ima Go
testove (`go test ./...`):

- **booking**: saga i otkazivanje — mock-uju `pool.query` i `fetch`, pokrivaju
  kompenzacione putanje (QC odbijanje, pad rezervacije, pad plaćanja) jer su
  se tu do sada dešavale prave greške pri ručnom testiranju.
- **supplier-layer**: Duffel adapter — mapiranje Offer/Order (search, hold
  order status derivacija, payment→ticketed prelaz), graceful degrade bez
  ključa/na grešku, dvofazno cancellation (default refund vrednosti kad
  Duffel vrati `null`), ancillaries (sedišta i prtljag se dohvataju sa dva
  nezavisna Duffel poziva preko `Promise.all` — pad jednog ne sme da obori
  drugi, pokriveno testom za svaki smer), grupisanje ponovljenih
  `serviceIds` u `{id, quantity}` pri kreiranju order-a (za više komada
  istog prtljaga).
- **search-fanout**: de-dup/ranking (`dedupAndRank`) — zadržavanje
  najjeftinije ponude po itineraru, sortiranje, i orkestracija (`Search`) sa
  mock supplier-layer HTTP serverom (`httptest`) koja proverava da
  `passengers` polje stvarno stigne do supplier-layer poziva.
- **web**: `@testing-library/react` + `jsdom` (`vitest.config.ts`, `--environment
  jsdom` preko plugina), fetch mock-ovan po URL-u. `SearchForm` (search →
  izbor ponude → broj formi za putnike prati broj putnika, ancillaries
  (sedište i prtljag) ograničene na 1 putnika, booking payload, prtljag —
  količina utiče na ukupnu cenu i na broj ponovljenih ID-jeva u
  `serviceIds`, ograničenje na `maxQuantity`, quote→confirm cancel tok,
  prikaz greške sa servera, kartično plaćanje — `@duffel/components` je
  mokovan jer interno renderuje cross-origin iframe koji jsdom ne može
  smisleno da izvrši, testira se samo SearchForm-ovo ožičenje:
  tokenizacija→3DS→booking, neuspeo 3DS, neuspela tokenizacija),
  `ManageBooking` (loading/error/cancellable stanja, cancel tok),
  `OrderLookup` (navigacija, trim, prazan unos).

CI (`.github/workflows/ci.yml`) ih pokreće pre build koraka. `pricing` je
jedini servis bez automatskih testova (i dalje čist F0 placeholder).

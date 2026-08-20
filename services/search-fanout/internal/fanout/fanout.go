// Package fanout implements the parallel search orchestrator described in §03/§04:
// paralelno pita sve relevantne supplier adaptere (timeout budžet po dobavljaču),
// de-duplicira identične letove i priprema listu za ranking.
//
// Go je izabran za ovaj sloj (§19) zbog predvidljivog memory footprinta i dobrog
// concurrency modela (goroutines) pod burst saobraćajem kad se paralelno pita
// 5-8 dobavljača odjednom.
package fanout

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

// SearchParams je isti oblik zahteva koji prima supplier-layer /search endpoint.
type SearchParams struct {
	Origin        string `json:"origin"`
	Destination   string `json:"destination"`
	DepartureDate string `json:"departureDate"`
	ReturnDate    string `json:"returnDate,omitempty"`
}

// FlightSegment i PriceBreakdown prate polja koja su nam potrebna za de-dup i
// ranking (§04) — projekcija zajedničkog internog Offer modela iz
// packages/shared-types, ne puna definicija.
type FlightSegment struct {
	MarketingCarrier string `json:"marketingCarrier"`
	FlightNumber     string `json:"flightNumber"`
	DepartureAt      string `json:"departureAt"`
}

type PriceBreakdown struct {
	Currency string  `json:"currency"`
	Total    float64 `json:"total"`
}

type Offer struct {
	OfferID      string          `json:"offerId"`
	SupplierCode string          `json:"supplierCode"`
	Segments     []FlightSegment `json:"segments"`
	Price        PriceBreakdown  `json:"price"`
}

type SearchResult struct {
	Offers []Offer `json:"offers"`
}

// Orchestrator pita supplier-layer servis (koji danas agregira adaptere iznutra).
// Kad broj adaptera naraste, ovaj sloj postaje mesto gde se fan-out radi direktno
// ka pojedinačnim adapterima paralelno, sa per-supplier timeout budžetom (~3.5s).
type Orchestrator struct {
	SupplierLayerURL string
	HTTPClient       *http.Client
}

func New(supplierLayerURL string) *Orchestrator {
	return &Orchestrator{
		SupplierLayerURL: supplierLayerURL,
		HTTPClient:       &http.Client{Timeout: 5 * time.Second},
	}
}

func (o *Orchestrator) Search(ctx context.Context, params SearchParams) (*SearchResult, error) {
	body, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("marshal search params: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.SupplierLayerURL+"/search", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := o.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call supplier-layer: %w", err)
	}
	defer resp.Body.Close()

	var result SearchResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	result.Offers = dedupAndRank(result.Offers)
	return &result, nil
}

// dedupAndRank spaja identične letove koje je vratilo više dobavljača (isti
// carrier/broj leta/vreme polaska na svakom segmentu) i zadržava najjeftiniju
// ponudu po itineraru, pa sortira preostale po ukupnoj ceni rastuće.
//
// F1 skeleton ranking-a (§04): samo cena. Puni ranking (trajanje, broj
// presedanja, preferirani dobavljač, korisnički signali) dolazi kasnije —
// namerno ne izmišljamo scoring formulu bez stvarnih podataka o ponašanju
// korisnika.
func dedupAndRank(offers []Offer) []Offer {
	best := make(map[string]Offer, len(offers))

	for _, offer := range offers {
		key := itineraryKey(offer)
		existing, seen := best[key]
		if !seen || offer.Price.Total < existing.Price.Total {
			best[key] = offer
		}
	}

	deduped := make([]Offer, 0, len(best))
	for _, offer := range best {
		deduped = append(deduped, offer)
	}

	sort.Slice(deduped, func(i, j int) bool {
		return deduped[i].Price.Total < deduped[j].Price.Total
	})

	return deduped
}

func itineraryKey(offer Offer) string {
	parts := make([]string, len(offer.Segments))
	for i, seg := range offer.Segments {
		parts[i] = seg.MarketingCarrier + seg.FlightNumber + "@" + seg.DepartureAt
	}
	return strings.Join(parts, "|")
}

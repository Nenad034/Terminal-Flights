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
	"time"
)

// SearchParams je isti oblik zahteva koji prima supplier-layer /search endpoint.
type SearchParams struct {
	Origin        string `json:"origin"`
	Destination   string `json:"destination"`
	DepartureDate string `json:"departureDate"`
	ReturnDate    string `json:"returnDate,omitempty"`
}

// Offer je minimalna projekcija zajedničkog internog Offer modela (§03) —
// puna definicija živi u packages/shared-types (TypeScript strana).
type Offer struct {
	OfferID      string `json:"offerId"`
	SupplierCode string `json:"supplierCode"`
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

	// TODO (F1): de-dup po ruti/vremenu preko više izvora + ranking engine (§04).
	return &result, nil
}

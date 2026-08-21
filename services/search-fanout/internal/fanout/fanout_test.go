package fanout

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func segment(carrier, flightNumber, departureAt string) FlightSegment {
	return FlightSegment{MarketingCarrier: carrier, FlightNumber: flightNumber, DepartureAt: departureAt}
}

func TestDedupAndRank_KeepsCheapestOfDuplicateItinerary(t *testing.T) {
	same := []FlightSegment{segment("AA", "123", "2026-09-15T10:00:00Z")}
	offers := []Offer{
		{OfferID: "duffel:1", SupplierCode: "duffel", Segments: same, Price: PriceBreakdown{Currency: "EUR", Total: 250}},
		{OfferID: "amadeus:1", SupplierCode: "amadeus", Segments: same, Price: PriceBreakdown{Currency: "EUR", Total: 199}},
	}

	result := dedupAndRank(offers)

	if len(result) != 1 {
		t.Fatalf("expected 1 offer after dedup, got %d", len(result))
	}
	if result[0].SupplierCode != "amadeus" || result[0].Price.Total != 199 {
		t.Errorf("expected the cheaper amadeus offer to survive dedup, got %+v", result[0])
	}
}

func TestDedupAndRank_KeepsDistinctItinerariesSeparate(t *testing.T) {
	offers := []Offer{
		{OfferID: "1", Segments: []FlightSegment{segment("AA", "123", "2026-09-15T10:00:00Z")}, Price: PriceBreakdown{Total: 100}},
		{OfferID: "2", Segments: []FlightSegment{segment("BA", "456", "2026-09-15T12:00:00Z")}, Price: PriceBreakdown{Total: 50}},
	}

	result := dedupAndRank(offers)

	if len(result) != 2 {
		t.Fatalf("expected 2 distinct itineraries to survive dedup, got %d", len(result))
	}
}

func TestDedupAndRank_SortsAscendingByPrice(t *testing.T) {
	offers := []Offer{
		{OfferID: "expensive", Segments: []FlightSegment{segment("AA", "1", "t1")}, Price: PriceBreakdown{Total: 300}},
		{OfferID: "cheap", Segments: []FlightSegment{segment("BA", "2", "t2")}, Price: PriceBreakdown{Total: 100}},
		{OfferID: "middle", Segments: []FlightSegment{segment("CA", "3", "t3")}, Price: PriceBreakdown{Total: 200}},
	}

	result := dedupAndRank(offers)

	if len(result) != 3 {
		t.Fatalf("expected 3 offers, got %d", len(result))
	}
	if result[0].OfferID != "cheap" || result[1].OfferID != "middle" || result[2].OfferID != "expensive" {
		t.Errorf("expected ascending price order [cheap, middle, expensive], got [%s, %s, %s]",
			result[0].OfferID, result[1].OfferID, result[2].OfferID)
	}
}

func TestDedupAndRank_EmptyInput(t *testing.T) {
	result := dedupAndRank([]Offer{})
	if len(result) != 0 {
		t.Errorf("expected empty result for empty input, got %d offers", len(result))
	}
}

func TestSearch_CallsSupplierLayerAndAppliesDedup(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/search" || r.Method != http.MethodPost {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}

		var params SearchParams
		if err := json.NewDecoder(r.Body).Decode(&params); err != nil {
			t.Fatalf("failed to decode request body: %v", err)
		}
		if params.Passengers.Adults != 2 {
			t.Errorf("expected passengers.adults=2 to reach supplier-layer, got %d", params.Passengers.Adults)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(SearchResult{
			Offers: []Offer{
				{OfferID: "duffel:1", SupplierCode: "duffel", Segments: []FlightSegment{segment("AA", "1", "t1")}, Price: PriceBreakdown{Total: 250}},
				{OfferID: "amadeus:1", SupplierCode: "amadeus", Segments: []FlightSegment{segment("AA", "1", "t1")}, Price: PriceBreakdown{Total: 199}},
			},
		})
	}))
	defer server.Close()

	orchestrator := New(server.URL)
	result, err := orchestrator.Search(context.Background(), SearchParams{
		Origin:        "BEG",
		Destination:   "JFK",
		DepartureDate: "2026-09-15",
		Passengers:    Passengers{Adults: 2},
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Offers) != 1 {
		t.Fatalf("expected dedup to collapse to 1 offer, got %d", len(result.Offers))
	}
	if result.Offers[0].SupplierCode != "amadeus" {
		t.Errorf("expected cheaper amadeus offer to survive, got %s", result.Offers[0].SupplierCode)
	}
}

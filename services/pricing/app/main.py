"""Terminal Flights — Pricing / Data-ML servis.

Python (FastAPI) + Polars je izabran za ovaj sloj (§19) zbog ekosistema
(scikit-learn, PyTorch) bez alternative za predictive pricing i fraud scoring
modele opisane u §04 (Fare cache i price-tracking) i §17 (Analytics).

F0 skeleton: samo health check i placeholder endpoint. Pravi predictive
pricing model (istorijski podaci cena po ruti -> predlog "kupi sad" vs
"sačekaj") dolazi kad data warehouse (§10) ima dovoljno event istorije.
"""

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Terminal Flights — Pricing Service")


class PricePredictionRequest(BaseModel):
    origin: str
    destination: str
    departure_date: str


class PricePredictionResponse(BaseModel):
    recommendation: str
    confidence: float


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "pricing"}


@app.post("/predict-price", response_model=PricePredictionResponse)
def predict_price(_req: PricePredictionRequest) -> PricePredictionResponse:
    # TODO (F4, §04/§17): trenirati model na istorijskim cenama iz data warehouse-a.
    # Za sada vraćamo neutralnu preporuku dok nema dovoljno podataka.
    return PricePredictionResponse(recommendation="wait", confidence=0.0)

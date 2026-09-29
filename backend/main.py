"""
FastAPI application for Restaurant AI:
- Menu & Product Search
- Price Elasticity Simulation
- Customer Uplift Ranking & Campaign Targeting
- On-Demand Customer Profiles
"""

import os
from typing import List, Optional, Any, Dict
from fastapi import FastAPI, HTTPException, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .database import init_db, get_restaurant_menu, get_customers_records
from .ml import (
    simulate_price_elasticity,
    get_ranked_eligible_customers,
    build_detailed_profile_data
)

app = FastAPI(
    title="Restaurant AI — Demand & Customer Uplift API",
    description="Unified API for Restaurant Price Elasticity and Customer Uplift Intelligence",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    init_db()

# --- Request / Response Models ---
class PriceSimulationRequest(BaseModel):
    product_id: str
    proposed_price: float
    current_price: Optional[float] = None
    restaurant_id: Optional[str] = "rest_01"

class CampaignTargetingRequest(BaseModel):
    limit: Optional[Any] = 50
    top_n: Optional[Any] = None

# --- Health Check ---
@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "service": "Restaurant AI: Price Elasticity & Customer Uplift",
        "version": "2.0.0"
    }

# --- 1. Restaurant Menu & Products ---
@app.get("/api/restaurants/{restaurant_id}/menu")
@app.get("/restaurants/{restaurant_id}/menu")
@app.get("/api/restaurants/menu")
@app.get("/api/price-elasticity/products")
def get_menu(
    restaurant_id: str = "rest_01",
    search: Optional[str] = None,
    category: Optional[str] = None,
    available_only: bool = True,
    limit: int = 300
):
    menu = get_restaurant_menu(restaurant_id)

    if available_only:
        menu = [item for item in menu if item.get("available", True)]

    if category and category.lower() != "all":
        menu = [item for item in menu if item.get("category", "").lower() == category.lower()]

    if search:
        s = search.strip().lower()
        menu = [
            item for item in menu
            if s in item.get("name", "").lower()
            or s in item.get("category", "").lower()
            or s in item.get("subcategory", "").lower()
            or s in item.get("product_id", "").lower()
        ]

    return menu[:limit]

# --- 2. Price Elasticity Simulation ---
@app.post("/api/price-elasticity/simulate")
def simulate_elasticity(req: PriceSimulationRequest):
    try:
        res = simulate_price_elasticity(
            product_id=req.product_id,
            proposed_price=req.proposed_price,
            custom_current_price=req.current_price,
            restaurant_id=req.restaurant_id or "rest_01"
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# --- 3. Customer Uplift Ranking ---
@app.get("/api/customers")
def get_customers(
    limit: str = Query("20"),
    page: int = Query(1, ge=1),
    search: Optional[str] = None
):
    ranked = get_ranked_eligible_customers()

    if search:
        s = search.strip().lower()
        ranked = [c for c in ranked if s in c["customer_id"].lower()]

    total_eligible = len(ranked)

    if limit.lower() == "all":
        page_size = 20
        start = (page - 1) * page_size
        customers_page = ranked[start:start + page_size]
    else:
        try:
            num_limit = min(1000, max(1, int(limit)))
        except ValueError:
            num_limit = 20
        customers_page = ranked[:num_limit]

    return {
        "total_eligible": total_eligible,
        "limit": limit,
        "page": page,
        "customers": customers_page
    }

# --- 4. Individual Customer Uplift On-Demand ---
@app.get("/api/customers/{customer_id}/uplift")
@app.get("/customers/{customer_id}/uplift")
@app.get("/api/customers/{customer_id}")
def get_individual_customer_uplift(customer_id: str):
    records = get_customers_records()
    if not records:
        raise HTTPException(status_code=404, detail="Customer dataset empty")

    customer = next((r for r in records if str(r.get("customer_id", "")).lower() == customer_id.lower()), None)
    if not customer:
        raise HTTPException(status_code=404, detail=f"Customer {customer_id} not found")

    profile = build_detailed_profile_data(customer)
    return profile

# --- 5. Campaign Uplift Targeting ---
@app.post("/api/campaigns/uplift-targeting")
@app.post("/campaigns/uplift-targeting")
def campaign_targeting(req: CampaignTargetingRequest):
    raw_limit = req.limit or req.top_n or 50
    if str(raw_limit).lower() == "all":
        limit_val = 1000
    else:
        try:
            limit_val = min(1000, max(1, int(raw_limit)))
        except ValueError:
            limit_val = 50

    ranked = get_ranked_eligible_customers()
    top_candidates = [
        {
            "customer_id": c["customer_id"],
            "uplift_score": c["uplift_score"],
            "uplift_percentage_points": c["uplift_percentage_points"],
            "status": c["status"]
        }
        for c in ranked[:limit_val]
    ]

    return {
        "limit": limit_val,
        "total_eligible_customers": len(ranked),
        "customers": top_candidates
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)

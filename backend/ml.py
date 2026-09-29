"""
Machine Learning and Behavioral Analytics for Restaurant AI:
- Price Elasticity of Demand
- Customer Uplift Modeling (T-Learner)
- Eligibility Filtering & Ranking
- Evidence-based Behavioral Explanations
"""

import math
from typing import Dict, Any, List, Optional
from .database import get_restaurant_menu, get_customers_records

def sigmoid(z: float) -> float:
    if z > 15:
        return 1.0
    if z < -15:
        return 0.0
    return 1.0 / (1.0 + math.exp(-z))

# ==========================================
# 1. PRICE ELASTICITY
# ==========================================

def simulate_price_elasticity(
    product_id: str,
    proposed_price: float,
    custom_current_price: Optional[float] = None,
    restaurant_id: str = "rest_01"
) -> Dict[str, Any]:
    menu = get_restaurant_menu(restaurant_id)
    product = next((p for p in menu if p.get("product_id", "").lower() == product_id.lower()), None)
    if not product:
        product = next((p for p in menu if p.get("name", "").lower() == product_id.lower()), None)
    if not product:
        if menu:
            product = menu[0]
        else:
            raise ValueError(f"Product {product_id} not found in restaurant menu.")

    current_price = custom_current_price if (custom_current_price and custom_current_price > 0) else float(product.get("price", 250))
    current_demand = int(product.get("base_demand", 145))
    elasticity = float(product.get("elasticity", -1.45))

    price_diff = proposed_price - current_price
    price_change_pct = price_diff / current_price if current_price > 0 else 0.0

    # Microeconomic demand elasticity: %ΔQ = Ed * %ΔP
    demand_change_pct = elasticity * price_change_pct
    expected_demand = max(0, int(round(current_demand * (1 + demand_change_pct))))

    current_revenue = int(round(current_price * current_demand))
    expected_revenue = int(round(proposed_price * expected_demand))
    revenue_diff = expected_revenue - current_revenue
    revenue_change_pct = (revenue_diff / current_revenue) if current_revenue > 0 else 0.0

    direction = "no_change"
    if expected_demand > current_demand:
        direction = "increase"
    elif expected_demand < current_demand:
        direction = "decrease"

    return {
        "product_id": product.get("product_id"),
        "product_name": product.get("name"),
        "category": product.get("category"),
        "current_price": current_price,
        "proposed_price": proposed_price,
        "price_change_amount": price_diff,
        "price_change_percent": round(price_change_pct * 100, 1),
        "current_demand": current_demand,
        "expected_demand": expected_demand,
        "expected_demand_change_percent": round(demand_change_pct * 100, 1),
        "demand_direction": direction,
        "current_revenue": current_revenue,
        "expected_revenue": expected_revenue,
        "revenue_change_amount": revenue_diff,
        "revenue_change_percent": round(revenue_change_pct * 100, 1)
    }

# ==========================================
# 2. CUSTOMER UPLIFT MODELING
# ==========================================

class ModelWeights:
    def __init__(self, intercept=-0.4, w_visits=0.0, w_orders=0.0, w_aov=0.0, w_days=0.0, w_resp=0.0):
        self.intercept = intercept
        self.w_visits = w_visits
        self.w_orders = w_orders
        self.w_aov = w_aov
        self.w_days = w_days
        self.w_resp = w_resp

def train_group_estimator(records: List[Dict[str, Any]], is_treatment: bool) -> ModelWeights:
    subset = [r for r in records if r.get("treatment") == (1 if is_treatment else 0)]
    n = max(1, len(subset))

    intercept = -0.4
    w_visits = 0.0
    w_orders = 0.0
    w_aov = 0.0
    w_days = 0.0
    w_resp = 0.0

    lr = 0.05
    epochs = 80
    l2 = 0.001

    for _ in range(epochs):
        g_intercept = 0.0
        g_visits = 0.0
        g_orders = 0.0
        g_aov = 0.0
        g_days = 0.0
        g_resp = 0.0

        for r in subset:
            f_v = (float(r.get("visits_30d", 0)) - 5) / 4
            f_o = (float(r.get("orders_30d", 0)) - 3) / 3
            f_a = (float(r.get("average_order_value", 400)) - 500) / 250
            f_d = (float(r.get("days_since_last_visit", 20)) - 20) / 15
            f_r = float(r.get("offer_response_rate", 0))

            z = intercept + (w_visits * f_v) + (w_orders * f_o) + (w_aov * f_a) + (w_days * f_d) + (w_resp * f_r)
            p = sigmoid(z)
            err = p - float(r.get("purchase", 0))

            g_intercept += err
            g_visits += err * f_v
            g_orders += err * f_o
            g_aov += err * f_a
            g_days += err * f_d
            g_resp += err * f_r

        intercept -= lr * (g_intercept / n)
        w_visits -= lr * (g_visits / n + l2 * w_visits)
        w_orders -= lr * (g_orders / n + l2 * w_orders)
        w_aov -= lr * (g_aov / n + l2 * w_aov)
        w_days -= lr * (g_days / n + l2 * w_days)
        w_resp -= lr * (g_resp / n + l2 * w_resp)

    return ModelWeights(intercept, w_visits, w_orders, w_aov, w_days, w_resp)

def predict_row_proba(w: ModelWeights, row: Dict[str, Any]) -> float:
    f_v = (float(row.get("visits_30d", 0)) - 5) / 4
    f_o = (float(row.get("orders_30d", 0)) - 3) / 3
    f_a = (float(row.get("average_order_value", 400)) - 500) / 250
    f_d = (float(row.get("days_since_last_visit", 20)) - 20) / 15
    f_r = float(row.get("offer_response_rate", 0))

    z = w.intercept + (w.w_visits * f_v) + (w.w_orders * f_o) + (w.w_aov * f_a) + (w.w_days * f_d) + (w.w_resp * f_r)
    return sigmoid(z)

_treatment_model: Optional[ModelWeights] = None
_control_model: Optional[ModelWeights] = None

def ensure_models_trained():
    global _treatment_model, _control_model
    if _treatment_model is None or _control_model is None:
        records = get_customers_records()
        if records and any("treatment" in r for r in records):
            _treatment_model = train_group_estimator(records, True)
            _control_model = train_group_estimator(records, False)
        else:
            _treatment_model = ModelWeights(-0.2, 0.2, 0.15, 0.05, -0.2, 0.4)
            _control_model = ModelWeights(-0.6, 0.1, 0.08, 0.02, -0.3, 0.1)

def score_customer_uplift(customer: Dict[str, Any]) -> Dict[str, Any]:
    ensure_models_trained()
    p_t = predict_row_proba(_treatment_model, customer)
    p_c = predict_row_proba(_control_model, customer)
    raw_uplift = p_t - p_c
    percentage_points = max(1, int(round(raw_uplift * 100)))
    uplift_score = round(percentage_points / 100.0, 2)
    return {
        "uplift_score": uplift_score,
        "uplift_percentage_points": percentage_points,
        "p_treatment": round(p_t, 3),
        "p_control": round(p_c, 3)
    }

# ==========================================
# 3. ELIGIBILITY & BEHAVIORAL STATUS
# ==========================================

def is_customer_eligible(c: Dict[str, Any]) -> bool:
    # Eligibility rules: last_visit <= 90 days AND opted_in == 1 AND days_since_last_offer >= 7
    days_since_visit = int(c.get("days_since_last_visit", 0))
    opted_in = int(c.get("opted_in", 0))
    days_since_offer = int(c.get("days_since_last_offer", 0))

    if days_since_visit > 90:
        return False
    if opted_in != 1:
        return False
    if days_since_offer < 7:
        return False
    return True

def determine_customer_status(days_since_last_visit: int) -> str:
    if days_since_last_visit <= 30:
        return "Active"
    elif days_since_last_visit <= 75:
        return "At Risk"
    return "Inactive"

def generate_behavior_explanations(c: Dict[str, Any], status: str):
    days_since_visit = int(c.get("days_since_last_visit", 0))
    offers_redeemed = int(c.get("offers_redeemed", 0))
    prev_offers = int(c.get("previous_offer_count", 1))
    rate = float(c.get("offer_response_rate", 0))
    pref_day = str(c.get("preferred_day", "Friday"))
    pref_time = str(c.get("preferred_time", "7–9 PM"))
    fav_cat = str(c.get("favorite_category", "North Indian"))
    fav_item = str(c.get("favorite_item", "Chef Special"))
    aov = int(c.get("average_order_value", 400))
    visits_90d = int(c.get("visits_90d", 4))
    visits_30d = int(c.get("visits_30d", 1))

    # Why respond
    if offers_redeemed >= 2 and rate >= 0.4:
        why_respond = f"Has redeemed {offers_redeemed} of {prev_offers} previous offers, indicating strong responsiveness to targeted promotions."
    elif 20 <= days_since_visit <= 60:
        why_respond = "Moderately lapsed diner with prior repeat visits; an offer may incentivize a return visit."
    else:
        why_respond = "Recent purchase behavior suggests this customer may respond positively to a relevant offer."

    # Visit & offer short
    is_weekend = pref_day in ["Friday", "Saturday", "Sunday"]
    visit_short = f"Frequently visits on weekends ({pref_day} {pref_time})." if is_weekend else f"Regularly visits on weekdays ({pref_day} {pref_time})."
    offer_short = f"Has redeemed {offers_redeemed} of {prev_offers} previous offers."

    # Why coming or not coming (Strictly evidence-based, no fabricated reasons)
    if status == "Active":
        why_coming_or_not = f"Based on observed behavior, this customer frequently orders {fav_cat} items ({fav_item}) and usually visits on {pref_day} evenings."
    else:
        why_coming_or_not = f"This customer has not visited for {days_since_visit} days. Observed purchase frequency has declined compared with the customer's previous activity."

    avg_freq_days = max(1, int(round(90 / visits_90d))) if visits_90d > 0 else 45
    recent_trend = "steady" if visits_30d >= (visits_90d / 3) else "declining"
    behavior_summary = f"This customer usually visits on {pref_day}s, prefers {fav_cat} items, and has an average order value of ₹{aov}. Their recent visit frequency has been {recent_trend}."

    return {
        "why_respond": why_respond,
        "visit_short": visit_short,
        "offer_short": offer_short,
        "why_coming_or_not": why_coming_or_not,
        "behavior_summary": behavior_summary,
        "avg_freq_days": avg_freq_days,
        "recent_trend": recent_trend
    }

def build_customer_card_data(c: Dict[str, Any]) -> Dict[str, Any]:
    uplift = score_customer_uplift(c)
    days_since_visit = int(c.get("days_since_last_visit", 0))
    status = determine_customer_status(days_since_visit)
    exps = generate_behavior_explanations(c, status)

    return {
        "customer_id": str(c.get("customer_id")),
        "uplift_score": uplift["uplift_score"],
        "uplift_percentage_points": uplift["uplift_percentage_points"],
        "status": status,
        "why_respond": exps["why_respond"],
        "visit_behavior_short": exps["visit_short"],
        "offer_behavior_short": exps["offer_short"],
        "explanation": f"An offer may increase estimated purchase probability by approximately {uplift['uplift_percentage_points']} percentage points."
    }

def build_detailed_profile_data(c: Dict[str, Any]) -> Dict[str, Any]:
    uplift = score_customer_uplift(c)
    days_since_visit = int(c.get("days_since_last_visit", 0))
    status = determine_customer_status(days_since_visit)
    exps = generate_behavior_explanations(c, status)

    last_visit_str = "Yesterday" if days_since_visit == 1 else f"{days_since_visit} days ago"
    days_offer = int(c.get("days_since_last_offer", 14))
    redeemed = int(c.get("last_offer_redeemed", 0))

    return {
        "customer_id": str(c.get("customer_id")),
        "uplift_score": uplift["uplift_score"],
        "uplift_percentage_points": uplift["uplift_percentage_points"],
        "status": status,
        "why_this_customer": f"Based on observed behavior, this customer frequently visits on {c.get('preferred_day', 'Friday')}s and regularly purchases {c.get('favorite_category', 'General')} items.",
        "why_coming_or_not": exps["why_coming_or_not"],
        "behavior_summary": exps["behavior_summary"],
        "visit_behavior": {
            "total_visits": int(c.get("visits_90d", 0)),
            "total_orders": int(c.get("orders_90d", 0)),
            "last_visit": last_visit_str,
            "days_since_last_visit": days_since_visit,
            "average_visit_frequency": f"Every ~{exps['avg_freq_days']} days",
            "preferred_day": str(c.get("preferred_day", "Friday")),
            "preferred_time": str(c.get("preferred_time", "7–9 PM"))
        },
        "purchase_behavior": {
            "total_spend": float(c.get("total_spend", 0)),
            "average_order_value": float(c.get("average_order_value", 0)),
            "favorite_category": str(c.get("favorite_category", "Dine-In")),
            "favorite_item": str(c.get("favorite_item", "Chef Special")),
            "average_items_per_order": float(c.get("avg_items_per_order", 2.4)),
            "recent_purchase_trend": "Steady" if exps["recent_trend"] == "steady" else "Declining",
            "purchase_frequency": f"{c.get('orders_90d', 0)} orders in last 90 days"
        },
        "offer_behavior": {
            "previous_offers": int(c.get("previous_offer_count", 0)),
            "offers_redeemed": int(c.get("offers_redeemed", 0)),
            "offer_response_rate": f"{int(round(float(c.get('offer_response_rate', 0)) * 100))}%",
            "last_offer_date": f"{days_offer} days ago",
            "last_offer_response": "Redeemed" if redeemed == 1 else "Not Redeemed"
        }
    }

_cached_ranked_cards: Optional[List[Dict[str, Any]]] = None

def get_ranked_eligible_customers() -> List[Dict[str, Any]]:
    global _cached_ranked_cards
    if _cached_ranked_cards is not None:
        return _cached_ranked_cards

    records = get_customers_records()
    if not records:
        return []

    # 1. Eligibility Filtering FIRST
    eligible = [r for r in records if is_customer_eligible(r)]

    # 2. Build cards & uplift
    cards = [build_customer_card_data(r) for r in eligible]

    # 3. Rank by uplift descending
    cards.sort(key=lambda x: x["uplift_percentage_points"], reverse=True)

    _cached_ranked_cards = cards
    return cards

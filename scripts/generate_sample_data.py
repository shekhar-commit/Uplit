"""
Restaurant Customer Data Generator with Behavioral Profiles and Experimental Uplift
Generates realistic restaurant customer profiles for the customer-facing Uplift platform.
Includes eligibility attributes: opted_in, days_since_last_offer, and last_visit.
"""

import csv
import math
import random
import os

def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-max(min(x, 15), -15)))

CATEGORIES = [
    ("Pizza", ["Paneer Pizza", "Farmhouse Special Pizza", "Margherita Pizza", "Pepperoni Pizza"]),
    ("Biryani", ["Hyderabadi Chicken Biryani", "Mutton Dum Biryani", "Veg Dum Biryani"]),
    ("North Indian", ["Butter Chicken with Naan", "Dal Makhani & Jeera Rice", "Paneer Tikka Masala"]),
    ("Chinese & Asian", ["Chilli Chicken with Hakka Noodles", "Veg Manchurian & Fried Rice", "Crispy Spring Rolls"]),
    ("South Indian", ["Ghee Roast Dosa", "Mysore Masala Dosa", "Idli Vada Platter"]),
    ("Desserts & Beverages", ["Gulab Jamun with Ice Cream", "Chocolate Sizzler Brownie", "Mango Lassi"])
]

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
TIMES = ["12–2 PM (Lunch)", "1–3 PM (Lunch)", "7–9 PM (Dinner)", "8–10 PM (Dinner)", "4–6 PM (Evening Snack)"]

def generate_customer_data(num_rows=2000, output_path="data/sample_data.csv"):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    random.seed(42)

    rows = []
    for i in range(1, num_rows + 1):
        customer_id = f"CUST-{1000 + i}"

        # Category and favorite dish
        cat_tuple = random.choice(CATEGORIES)
        fav_category = cat_tuple[0]
        fav_item = random.choice(cat_tuple[1])

        pref_day = random.choice(DAYS)
        pref_time = random.choice(TIMES)

        # Behavioral traits
        days_since_last_visit = random.randint(1, 105)
        visits_30d = random.randint(0, 12) if days_since_last_visit <= 30 else 0
        visits_7d = random.randint(0, min(visits_30d, 3)) if days_since_last_visit <= 7 else 0
        visits_90d = visits_30d + (random.randint(1, 15) if days_since_last_visit <= 90 else 0)

        orders_30d = max(0, int(visits_30d * random.uniform(0.7, 1.0)))
        orders_90d = max(1, orders_30d + random.randint(1, 14))

        # Indian Rupee pricing (₹350 - ₹1,200 average)
        aov = round(random.uniform(280.0, 950.0), 0)
        total_spend = round(orders_90d * aov * random.uniform(0.9, 1.1), 0)

        previous_offer_count = random.randint(1, 8)
        offers_redeemed = random.randint(0, previous_offer_count)
        offer_response_rate = round(offers_redeemed / previous_offer_count, 2)

        # Eligibility criteria attributes
        opted_in = 1 if random.random() < 0.92 else 0 # 92% opted in to communications
        days_since_last_offer = random.choice([2, 3, 5, 8, 12, 16, 21, 30, 45])
        last_offer_redeemed = 1 if (offers_redeemed > 0 and random.random() < 0.7) else 0

        avg_items_per_order = round(random.uniform(1.8, 3.8), 1)

        # 50% randomized experiment allocation in backend for model training
        treatment = 1 if (hash(f"EXP_{customer_id}") % 100) < 50 else 0

        # Heterogeneous treatment response (Latent Uplift):
        base_logit = -1.3 + (0.16 * visits_30d) - (0.035 * days_since_last_visit) + (1.1 * offer_response_rate)
        
        if 8 <= days_since_last_visit <= 45 and offer_response_rate >= 0.2:
            # High Uplift (+28% to +45%)
            treatment_effect = random.uniform(1.3, 1.9)
        elif visits_30d >= 7:
            # Frequent diner: High organic baseline, smaller incremental uplift (+3% to +10%)
            treatment_effect = random.uniform(0.12, 0.4)
        elif days_since_last_visit > 60 and offer_response_rate < 0.15:
            # Dormant non-responder: low baseline, low uplift (+1% to +6%)
            treatment_effect = random.uniform(0.05, 0.25)
        else:
            # Moderate responder (+14% to +26%)
            treatment_effect = random.uniform(0.6, 1.1)

        p_control = sigmoid(base_logit)
        p_treatment = sigmoid(base_logit + treatment_effect)

        prob = p_treatment if treatment == 1 else p_control
        purchase = 1 if random.random() < prob else 0

        rows.append({
            "customer_id": customer_id,
            "visits_7d": visits_7d,
            "visits_30d": visits_30d,
            "visits_90d": visits_90d,
            "orders_30d": orders_30d,
            "orders_90d": orders_90d,
            "total_spend": int(total_spend),
            "average_order_value": int(aov),
            "days_since_last_visit": days_since_last_visit,
            "opted_in": opted_in,
            "days_since_last_offer": days_since_last_offer,
            "last_offer_redeemed": last_offer_redeemed,
            "avg_items_per_order": avg_items_per_order,
            "favorite_category": fav_category,
            "favorite_item": fav_item,
            "preferred_day": pref_day,
            "preferred_time": pref_time,
            "previous_offer_count": previous_offer_count,
            "offers_redeemed": offers_redeemed,
            "offer_response_rate": offer_response_rate,
            "treatment": treatment,
            "purchase": purchase
        })

    fieldnames = list(rows[0].keys())
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Generated {len(rows)} customer records with eligibility attributes in {output_path}")

if __name__ == "__main__":
    generate_customer_data(2000, "data/sample_data.csv")

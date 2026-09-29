"""
Database configuration, models, and data access helpers for Restaurant AI.
Supports both SQLAlchemy/Pandas and standard-library fallback.
"""

import os
import json
import csv
from typing import List, Dict, Any, Optional

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./restaurant_app.db")

try:
    from sqlalchemy import create_engine, Column, String, Integer, Float, Boolean, DateTime, ForeignKey, Text
    from sqlalchemy.orm import declarative_base, sessionmaker, Session
    from datetime import datetime

    connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
    engine = create_engine(DATABASE_URL, connect_args=connect_args)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base = declarative_base()

    class Customer(Base):
        __tablename__ = "customers"
        id = Column(String, primary_key=True, index=True)
        visits_7d = Column(Integer, default=0)
        visits_30d = Column(Integer, default=0)
        visits_90d = Column(Integer, default=0)
        orders_30d = Column(Integer, default=0)
        orders_90d = Column(Integer, default=0)
        total_spend = Column(Float, default=0.0)
        average_order_value = Column(Float, default=0.0)
        days_since_last_visit = Column(Integer, default=0)
        opted_in = Column(Integer, default=1)
        days_since_last_offer = Column(Integer, default=14)
        last_offer_redeemed = Column(Integer, default=0)
        favorite_category = Column(String, default="General")
        favorite_item = Column(String, default="Chef Special")
        preferred_day = Column(String, default="Friday")
        preferred_time = Column(String, default="7–9 PM")
        previous_offer_count = Column(Integer, default=1)
        offers_redeemed = Column(Integer, default=0)
        offer_response_rate = Column(Float, default=0.0)

    class MenuItem(Base):
        __tablename__ = "menu_items"
        product_id = Column(String, primary_key=True, index=True)
        restaurant_id = Column(String, default="rest_01", index=True)
        name = Column(String, nullable=False, index=True)
        category = Column(String, nullable=False, index=True)
        subcategory = Column(String, nullable=True)
        price = Column(Float, nullable=False)
        base_demand = Column(Integer, default=100)
        elasticity = Column(Float, default=-1.45)
        available = Column(Boolean, default=True)

    def init_db():
        Base.metadata.create_all(bind=engine)

    def get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

except ImportError:
    # Graceful fallback if SQLAlchemy is not installed in the lightweight environment
    def init_db():
        pass

    def get_db():
        yield None

# File paths for clean data access
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
MENU_FILE_PATH = os.path.join(DATA_DIR, "restaurant_menu.json")
CUSTOMER_DATA_PATH = os.path.join(DATA_DIR, "sample_data.csv")

def get_restaurant_menu(restaurant_id: str = "rest_01") -> List[Dict[str, Any]]:
    """Loads restaurant dishes dynamically from data/restaurant_menu.json."""
    if os.path.exists(MENU_FILE_PATH):
        try:
            with open(MENU_FILE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading menu: {e}")
    return []

def get_customers_records() -> List[Dict[str, Any]]:
    """Loads customer records from data/sample_data.csv."""
    if not os.path.exists(CUSTOMER_DATA_PATH):
        return []

    try:
        import pandas as pd
        df = pd.read_csv(CUSTOMER_DATA_PATH)
        return df.to_dict(orient="records")
    except ImportError:
        # Standard library CSV fallback
        records = []
        with open(CUSTOMER_DATA_PATH, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                records.append({
                    "customer_id": row.get("customer_id"),
                    "visits_7d": int(row.get("visits_7d", 0) or 0),
                    "visits_30d": int(row.get("visits_30d", 0) or 0),
                    "visits_90d": int(row.get("visits_90d", 0) or 0),
                    "orders_30d": int(row.get("orders_30d", 0) or 0),
                    "orders_90d": int(row.get("orders_90d", 0) or 0),
                    "total_spend": float(row.get("total_spend", 0) or 0),
                    "average_order_value": float(row.get("average_order_value", 0) or 0),
                    "days_since_last_visit": int(row.get("days_since_last_visit", 0) or 0),
                    "opted_in": int(row.get("opted_in", 1) or 1),
                    "days_since_last_offer": int(row.get("days_since_last_offer", 14) or 14),
                    "last_offer_redeemed": int(row.get("last_offer_redeemed", 0) or 0),
                    "favorite_category": row.get("favorite_category", "Dine-In"),
                    "favorite_item": row.get("favorite_item", "Chef Special"),
                    "preferred_day": row.get("preferred_day", "Friday"),
                    "preferred_time": row.get("preferred_time", "7–9 PM"),
                    "previous_offer_count": int(row.get("previous_offer_count", 1) or 1),
                    "offers_redeemed": int(row.get("offers_redeemed", 0) or 0),
                    "offer_response_rate": float(row.get("offer_response_rate", 0) or 0),
                    "treatment": int(row.get("treatment", 0) or 0),
                    "purchase": int(row.get("purchase", 0) or 0)
                })
        return records

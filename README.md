# Restaurant Uplift Intelligence — A/B Testing & Uplift Modeling Platform

A production-style full-stack platform designed specifically for restaurant operations to evaluate promotional effectiveness at both aggregate and individual customer levels.

---

## 1. Core Principles

### What is A/B Testing?
A/B testing is a randomized controlled trial (RCT) where eligible diners are divided into:
- **Control Group ($T=0$)**: Does not receive the promotional offer.
- **Treatment Group ($T=1$)**: Receives the promotional offer.

**Question Answered:** *"Did the offer cause an overall statistically significant change in visits, conversion, revenue, or profit?"*

### What is Uplift Modeling?
Uplift modeling (also known as Individual Treatment Effect or Incremental Modeling) predicts which specific customers will change their purchasing behavior **because** of an offer.

**Question Answered:** *"Which individual customers are actually influenced by the offer, and who would have visited anyway?"*

### Difference Between Propensity and Uplift
- **Propensity Model:** Estimates $P(Y = 1 \mid X)$ — how likely a customer is to buy. High-propensity customers are often loyal diners who would visit and pay full price anyway. Sending discounts to them results in **cannibalization**.
- **Uplift Model:** Estimates $P(Y = 1 \mid X, T=1) - P(Y = 1 \mid X, T=0)$ — the true incremental lift caused by the treatment. It identifies diners whose behavior changes solely due to the promotion.

### The Four Uplift Customer Quadrants
1. **Persuadables:** Low organic purchase probability, high purchase probability with treatment ($Uplift > 0$). **Action:** Target with offers!
2. **Sure Things:** High organic purchase probability, high treated probability ($Uplift \approx 0$). **Action:** Do not waste marketing dollars or discount margins.
3. **Lost Causes:** Low organic probability, low treated probability ($Uplift \approx 0$). **Action:** Do not target with this offer.
4. **Do-Not-Disturb:** High organic probability, but lower treated probability ($Uplift < 0$). Discounts may cheapen the brand or make diners question quality. **Action:** Never send promotional blasts.

---

## 2. Architecture & Data Flow

```
Restaurant Offer Generation
            ↓
     Candidate Offer
            ↓
     Create Experiment
            ↓
  Randomly Assign Customers (SHA-256 Deterministic Hashing)
            ↓
   Control vs Treatment
            ↓
  Collect Customer Outcomes (Purchase, Revenue, Profit)
            ↓
    Analyze A/B Test (Two-Proportion Z-Test, Welch's t-test)
            ↓
  Store Experiment Dataset (data/sample_ab_data.csv)
            ↓
    Train Uplift Model (T-Learner Architecture)
      ├─ Treatment Model (Model T)
      └─ Control Model (Model C)
            ↓
  Individual Treatment Effect (ITE) = P(Y=1|X, T=1) - P(Y=1|X, T=0)
            ↓
       Uplift Score & Quadrant Segmentation
            ↓
     Qini Curve & AUUC Validation Gate
            ↓
  High-Uplift Customer Targeting API
```

---

## 3. Technology Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Lucide React, Recharts
- **Backend:** Node.js Express (for integrated development and hosting) & Python FastAPI (in `backend/app/main.py`)
- **ML / Uplift:** Scikit-learn, Pandas, NumPy, SciPy (T-Learner, Logistic Regression, Gradient Boosting)
- **Database:** PostgreSQL (with SQLite zero-config fallback)

---

## 4. Setup & Running

### Requirements
- Node.js >= 18
- Python >= 3.10 (optional for standalone FastAPI server)

### Install Node Dependencies & Start Dev Server
```bash
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### Standalone Python FastAPI Backend
```bash
pip install -r requirements.txt
python -m uvicorn backend.app.main:app --reload --port 8000
```

### Generate Synthetic Data
```bash
python scripts/generate_sample_data.py
```
This generates 10,000+ realistic restaurant records in `data/sample_ab_data.csv` with heterogeneous treatment effects across multiple customer segments.

---

## 5. API Endpoints

### Experiments
- `GET /api/experiments`: List all experiments and participant counts.
- `POST /api/experiments`: Create an experiment with traffic split (must total 100%).
- `GET /api/experiments/{id}`: Experiment details.
- `POST /api/experiments/{id}/randomize`: Randomize diners using deterministic hashing.
- `GET /api/experiments/{id}/results`: Two-proportion z-test, p-value, 95% CI, Welch's t-test for revenue and profit.

### Uplift Modeling
- `POST /api/uplift/train`: Trains T-Learner models (Model T and Model C), computes Qini and deciles, saves artifacts.
- `GET /api/uplift/metrics`: Retrieves Qini curve points, Qini coefficient, AUUC, and decile metrics.
- `GET /api/uplift/results`: Scored customers table with pagination, segment filtering, and search.
- `POST /api/uplift/predict`: Real-time scoring of customer features.

### Data
- `POST /api/data/import-csv`: Upload and validate real experiment CSV data.
- `POST /api/data/generate-synthetic`: Seed fresh synthetic data.
- `GET /api/overview`: High-level system statistics.

---

## 6. Understanding Qini & AUUC

### Qini Curve
The Qini curve orders customers from highest predicted uplift to lowest along the x-axis ($0\%$ to $100\%$ targeted). On the y-axis, it charts cumulative incremental conversions:
$$Q(k) = n_{t,1}(k) - n_{c,1}(k) \times \frac{n_t(k)}{n_c(k)}$$

A model that outperforms random targeting arcs high above the diagonal random baseline.

### Qini Coefficient & AUUC
- **AUUC:** Total Area Under the Uplift Curve.
- **Qini Coefficient:** Normalized area between the model curve and the random baseline. A positive Qini coefficient indicates the model successfully isolates high-incrementality customers.

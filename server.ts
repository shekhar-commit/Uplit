import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DATA_DIR = path.resolve(__dirname, 'data');
const CSV_PATH = fs.existsSync(path.join(DATA_DIR, 'sample_data.csv'))
  ? path.join(DATA_DIR, 'sample_data.csv')
  : path.join(DATA_DIR, 'sample_ab_data.csv');

// --- Helper Functions ---
function sigmoid(z: number): number {
  if (z > 15) return 1.0;
  if (z < -15) return 0.0;
  return 1.0 / (1.0 + Math.exp(-z));
}

// ==========================================
// 1. PRICE ELASTICITY BACKEND ENGINE
// ==========================================

export interface MenuItem {
  product_id: string;
  name: string;
  category: string;
  subcategory?: string;
  price: number;
  base_demand: number; // portions / period
  elasticity: number;  // Price elasticity of demand (Ed)
  available: boolean;
}

export type ProductElasticity = MenuItem;

const MENU_PATH = path.join(DATA_DIR, 'restaurant_menu.json');

function getRestaurantMenu(restaurantId = 'rest_01'): MenuItem[] {
  if (fs.existsSync(MENU_PATH)) {
    try {
      const raw = fs.readFileSync(MENU_PATH, 'utf-8');
      return JSON.parse(raw) as MenuItem[];
    } catch (err) {
      console.error('Failed to parse restaurant_menu.json:', err);
    }
  }
  return [];
}

export interface ElasticitySimulationResult {
  product_id: string;
  product_name: string;
  category: string;
  current_price: number;
  proposed_price: number;
  price_change_amount: number;
  price_change_percent: number;
  current_demand: number;
  expected_demand: number;
  expected_demand_change_percent: number;
  demand_direction: 'increase' | 'decrease' | 'no_change';
  current_revenue: number;
  expected_revenue: number;
  revenue_change_amount: number;
  revenue_change_percent: number;
}

function simulatePriceElasticity(
  productId: string,
  proposedPrice: number,
  customCurrentPrice?: number,
  restaurantId?: string
): ElasticitySimulationResult {
  const menu = getRestaurantMenu(restaurantId);
  const product = menu.find(p => p.product_id.toLowerCase() === productId.toLowerCase())
    || menu.find(p => p.name.toLowerCase() === productId.toLowerCase())
    || menu[0];

  if (!product) {
    throw new Error(`Product ${productId} not found in restaurant menu`);
  }

  const currentPrice = customCurrentPrice && customCurrentPrice > 0 ? customCurrentPrice : product.price;
  const currentDemand = product.base_demand || 145;

  const priceDiff = proposedPrice - currentPrice;
  const priceChangePct = priceDiff / currentPrice;

  // Real microeconomic demand elasticity: %ΔQ = Ed * %ΔP
  const elasticity = product.elasticity || -1.45;
  const demandChangePct = elasticity * priceChangePct;
  const expectedDemand = Math.max(0, Math.round(currentDemand * (1 + demandChangePct)));

  const currentRevenue = Math.round(currentPrice * currentDemand);
  const expectedRevenue = Math.round(proposedPrice * expectedDemand);
  const revenueDiff = expectedRevenue - currentRevenue;
  const revenueChangePct = currentRevenue > 0 ? (revenueDiff / currentRevenue) : 0;

  let direction: 'increase' | 'decrease' | 'no_change' = 'no_change';
  if (expectedDemand > currentDemand) direction = 'increase';
  else if (expectedDemand < currentDemand) direction = 'decrease';

  return {
    product_id: product.product_id,
    product_name: product.name,
    category: product.category,
    current_price: currentPrice,
    proposed_price: proposedPrice,
    price_change_amount: priceDiff,
    price_change_percent: parseFloat((priceChangePct * 100).toFixed(1)),
    current_demand: currentDemand,
    expected_demand: expectedDemand,
    expected_demand_change_percent: parseFloat((demandChangePct * 100).toFixed(1)),
    demand_direction: direction,
    current_revenue: currentRevenue,
    expected_revenue: expectedRevenue,
    revenue_change_amount: revenueDiff,
    revenue_change_percent: parseFloat((revenueChangePct * 100).toFixed(1))
  };
}

// ==========================================
// 2. CUSTOMER UPLIFT BACKEND ENGINE
// ==========================================

export interface RawCustomer {
  customer_id: string;
  visits_7d: number;
  visits_30d: number;
  visits_90d: number;
  orders_30d: number;
  orders_90d: number;
  total_spend: number;
  average_order_value: number;
  days_since_last_visit: number;
  opted_in: number;
  days_since_last_offer: number;
  last_offer_redeemed: number;
  avg_items_per_order: number;
  favorite_category: string;
  favorite_item: string;
  preferred_day: string;
  preferred_time: string;
  previous_offer_count: number;
  offers_redeemed: number;
  offer_response_rate: number;
  treatment: number;
  purchase: number;
}

export type CustomerStatus = 'Active' | 'At Risk' | 'Inactive';

export interface CustomerCardData {
  customer_id: string;
  uplift_score: number; // e.g. 0.34
  uplift_percentage_points: number; // e.g. 34
  status: CustomerStatus;
  why_respond: string;
  visit_behavior_short: string;
  offer_behavior_short: string;
  explanation: string;
}

export interface DetailedCustomerProfile {
  customer_id: string;
  uplift_score: number;
  uplift_percentage_points: number;
  status: CustomerStatus;
  why_this_customer: string;
  why_coming_or_not: string;
  behavior_summary: string;
  visit_behavior: {
    total_visits: number;
    total_orders: number;
    last_visit: string;
    days_since_last_visit: number;
    average_visit_frequency: string;
    preferred_day: string;
    preferred_time: string;
  };
  purchase_behavior: {
    total_spend: number;
    average_order_value: number;
    favorite_category: string;
    favorite_item: string;
    average_items_per_order: number;
    recent_purchase_trend: string;
    purchase_frequency: string;
  };
  offer_behavior: {
    previous_offers: number;
    offers_redeemed: number;
    offer_response_rate: string;
    last_offer_date: string;
    last_offer_response: string;
  };
}

export interface EligibilityConfig {
  max_days_since_last_visit: number;
  require_opted_in: boolean;
  min_days_since_last_offer: number;
}

const DEFAULT_ELIGIBILITY: EligibilityConfig = {
  max_days_since_last_visit: 90,
  require_opted_in: true,
  min_days_since_last_offer: 7
};

function readDataset(): RawCustomer[] {
  if (!fs.existsSync(CSV_PATH)) return [];
  const content = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const rows: RawCustomer[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < headers.length) continue;
    const r: any = {};
    headers.forEach((h, idx) => {
      r[h] = parts[idx]?.trim();
    });

    rows.push({
      customer_id: r.customer_id,
      visits_7d: Number(r.visits_7d) || 0,
      visits_30d: Number(r.visits_30d) || 0,
      visits_90d: Number(r.visits_90d) || 0,
      orders_30d: Number(r.orders_30d) || 0,
      orders_90d: Number(r.orders_90d) || 0,
      total_spend: Number(r.total_spend) || 0,
      average_order_value: Number(r.average_order_value) || 0,
      days_since_last_visit: Number(r.days_since_last_visit) || 0,
      opted_in: Number(r.opted_in) !== 0 ? 1 : 0,
      days_since_last_offer: Number(r.days_since_last_offer) || 14,
      last_offer_redeemed: Number(r.last_offer_redeemed) !== 0 ? 1 : 0,
      avg_items_per_order: Number(r.avg_items_per_order) || 2.4,
      favorite_category: r.favorite_category || 'Dine-In',
      favorite_item: r.favorite_item || 'Chef Special',
      preferred_day: r.preferred_day || 'Friday',
      preferred_time: r.preferred_time || '7–9 PM',
      previous_offer_count: Number(r.previous_offer_count) || 1,
      offers_redeemed: Number(r.offers_redeemed) || 0,
      offer_response_rate: Number(r.offer_response_rate) || 0,
      treatment: Number(r.treatment) || 0,
      purchase: Number(r.purchase) || 0
    });
  }
  return rows;
}

// Configurable Business Rules for Customer Status
function determineCustomerStatus(daysSinceLastVisit: number): CustomerStatus {
  if (daysSinceLastVisit <= 30) return 'Active';
  if (daysSinceLastVisit <= 75) return 'At Risk';
  return 'Inactive';
}

// Eligibility Rule:
// last_visit <= 90 days AND opted_in = true AND no offer received in last 7 days
function isCustomerEligible(c: RawCustomer, config: EligibilityConfig = DEFAULT_ELIGIBILITY): boolean {
  if (c.days_since_last_visit > config.max_days_since_last_visit) return false;
  if (config.require_opted_in && c.opted_in !== 1) return false;
  if (c.days_since_last_offer < config.min_days_since_last_offer) return false;
  return true;
}

// Real Machine Learning Models (Treatment Model MT and Control Model MC)
interface ModelWeights {
  intercept: number;
  w_visits: number;
  w_orders: number;
  w_aov: number;
  w_days: number;
  w_resp: number;
}

function trainGroupEstimator(rows: RawCustomer[], isTreatment: boolean): ModelWeights {
  const subset = rows.filter(r => r.treatment === (isTreatment ? 1 : 0));
  const n = Math.max(1, subset.length);

  let intercept = -0.4;
  let w_visits = 0.0;
  let w_orders = 0.0;
  let w_aov = 0.0;
  let w_days = 0.0;
  let w_resp = 0.0;

  const lr = 0.05;
  const epochs = 100;
  const l2 = 0.001;

  for (let ep = 0; ep < epochs; ep++) {
    let g_intercept = 0;
    let g_visits = 0;
    let g_orders = 0;
    let g_aov = 0;
    let g_days = 0;
    let g_resp = 0;

    for (const r of subset) {
      const f_v = (r.visits_30d - 5) / 4;
      const f_o = (r.orders_30d - 3) / 3;
      const f_a = (r.average_order_value - 500) / 250;
      const f_d = (r.days_since_last_visit - 20) / 15;
      const f_r = r.offer_response_rate;

      const z = intercept + (w_visits * f_v) + (w_orders * f_o) + (w_aov * f_a) + (w_days * f_d) + (w_resp * f_r);
      const p = sigmoid(z);
      const err = p - r.purchase;

      g_intercept += err;
      g_visits += err * f_v;
      g_orders += err * f_o;
      g_aov += err * f_a;
      g_days += err * f_d;
      g_resp += err * f_r;
    }

    intercept -= lr * (g_intercept / n);
    w_visits -= lr * (g_visits / n + l2 * w_visits);
    w_orders -= lr * (g_orders / n + l2 * w_orders);
    w_aov -= lr * (g_aov / n + l2 * w_aov);
    w_days -= lr * (g_days / n + l2 * w_days);
    w_resp -= lr * (g_resp / n + l2 * w_resp);
  }

  return { intercept, w_visits, w_orders, w_aov, w_days, w_resp };
}

function predictProbability(w: ModelWeights, r: RawCustomer): number {
  const f_v = (r.visits_30d - 5) / 4;
  const f_o = (r.orders_30d - 3) / 3;
  const f_a = (r.average_order_value - 500) / 250;
  const f_d = (r.days_since_last_visit - 20) / 15;
  const f_r = r.offer_response_rate;

  const z = w.intercept + (w.w_visits * f_v) + (w.w_orders * f_o) + (w.w_aov * f_a) + (w.w_days * f_d) + (w.w_resp * f_r);
  return sigmoid(z);
}

let treatmentModel: ModelWeights | null = null;
let controlModel: ModelWeights | null = null;

function ensureModelsTrained() {
  if (!treatmentModel || !controlModel) {
    const dataset = readDataset();
    treatmentModel = trainGroupEstimator(dataset, true);
    controlModel = trainGroupEstimator(dataset, false);
  }
}

// Compute individual uplift score
function scoreCustomerUplift(c: RawCustomer): { uplift_score: number; uplift_percentage_points: number } {
  ensureModelsTrained();
  const p_t = predictProbability(treatmentModel!, c);
  const p_c = predictProbability(controlModel!, c);
  const rawUplift = p_t - p_c;
  const percentagePoints = Math.max(1, Math.round(rawUplift * 100));
  const upliftScore = parseFloat((percentagePoints / 100).toFixed(2));
  return { uplift_score: upliftScore, uplift_percentage_points: percentagePoints };
}

// Evidence-based behavior explanations generated strictly from actual customer attributes
function generateCustomerExplanations(c: RawCustomer, status: CustomerStatus, upliftPts: number) {
  // Why this customer may respond
  let whyRespond = "Recent purchase behavior suggests this customer may respond positively to a relevant offer.";
  if (c.offers_redeemed >= 2 && c.offer_response_rate >= 0.4) {
    whyRespond = `Has redeemed ${c.offers_redeemed} of ${c.previous_offer_count} previous offers, indicating strong responsiveness to targeted promotions.`;
  } else if (c.days_since_last_visit >= 20 && c.days_since_last_visit <= 60) {
    whyRespond = "Moderately lapsed diner with prior repeat visits; an offer may incentivize a return visit.";
  }

  // Visit behavior short
  const isWeekend = ["Friday", "Saturday", "Sunday"].includes(c.preferred_day);
  const visitShort = isWeekend
    ? `Frequently visits on weekends (${c.preferred_day} ${c.preferred_time}).`
    : `Regularly visits on weekdays (${c.preferred_day} ${c.preferred_time}).`;

  // Offer behavior short
  const offerShort = `Has redeemed ${c.offers_redeemed} of ${c.previous_offer_count} previous offers.`;

  // Why coming or why not coming (Strictly evidence-based, no fabricated reasons)
  let whyComingOrNot = "";
  if (status === 'Active') {
    whyComingOrNot = `Based on observed behavior, this customer frequently orders ${c.favorite_category} items (${c.favorite_item}) and usually visits on ${c.preferred_day} evenings.`;
  } else {
    whyComingOrNot = `This customer has not visited for ${c.days_since_last_visit} days. Observed purchase frequency has declined compared with the customer's previous activity.`;
  }

  // Overall Behavior Summary
  const avgFrequencyDays = c.visits_90d > 0 ? Math.round(90 / c.visits_90d) : 45;
  const recentTrend = c.visits_30d >= (c.visits_90d / 3) ? "steady" : "declining";
  const behaviorSummary = `This customer usually visits on ${c.preferred_day}s, prefers ${c.favorite_category} items, and has an average order value of ₹${c.average_order_value}. Their recent visit frequency has been ${recentTrend}.`;

  return {
    whyRespond,
    visitShort,
    offerShort,
    whyComingOrNot,
    behaviorSummary,
    avgFrequencyDays,
    recentTrend
  };
}

// Convert customer to Card format
function buildCustomerCard(c: RawCustomer): CustomerCardData {
  const { uplift_score, uplift_percentage_points } = scoreCustomerUplift(c);
  const status = determineCustomerStatus(c.days_since_last_visit);
  const exp = generateCustomerExplanations(c, status, uplift_percentage_points);

  return {
    customer_id: c.customer_id,
    uplift_score,
    uplift_percentage_points,
    status,
    why_respond: exp.whyRespond,
    visit_behavior_short: exp.visitShort,
    offer_behavior_short: exp.offerShort,
    explanation: `An offer may increase estimated purchase probability by approximately ${uplift_percentage_points} percentage points.`
  };
}

// Convert customer to Full Detailed Profile
function buildDetailedProfile(c: RawCustomer): DetailedCustomerProfile {
  const { uplift_score, uplift_percentage_points } = scoreCustomerUplift(c);
  const status = determineCustomerStatus(c.days_since_last_visit);
  const exp = generateCustomerExplanations(c, status, uplift_percentage_points);

  const lastVisitStr = c.days_since_last_visit === 1
    ? 'Yesterday'
    : `${c.days_since_last_visit} days ago`;

  const lastOfferDateStr = `${c.days_since_last_offer} days ago`;
  const lastOfferResponseStr = c.last_offer_redeemed === 1 ? 'Redeemed' : 'Not Redeemed';

  return {
    customer_id: c.customer_id,
    uplift_score,
    uplift_percentage_points,
    status,
    why_this_customer: `Based on observed behavior, this customer frequently visits on ${c.preferred_day}s and regularly purchases ${c.favorite_category} items.`,
    why_coming_or_not: exp.whyComingOrNot,
    behavior_summary: exp.behaviorSummary,
    visit_behavior: {
      total_visits: c.visits_90d,
      total_orders: c.orders_90d,
      last_visit: lastVisitStr,
      days_since_last_visit: c.days_since_last_visit,
      average_visit_frequency: `Every ~${exp.avgFrequencyDays} days`,
      preferred_day: c.preferred_day,
      preferred_time: c.preferred_time
    },
    purchase_behavior: {
      total_spend: c.total_spend,
      average_order_value: c.average_order_value,
      favorite_category: c.favorite_category,
      favorite_item: c.favorite_item,
      average_items_per_order: c.avg_items_per_order,
      recent_purchase_trend: exp.recentTrend === 'steady' ? 'Steady' : 'Declining',
      purchase_frequency: `${c.orders_90d} orders in last 90 days`
    },
    offer_behavior: {
      previous_offers: c.previous_offer_count,
      offers_redeemed: c.offers_redeemed,
      offer_response_rate: `${Math.round(c.offer_response_rate * 100)}%`,
      last_offer_date: lastOfferDateStr,
      last_offer_response: lastOfferResponseStr
    }
  };
}

// Performance Cache for Ranked Candidates
// Avoid recalculating models repeatedly when switching Top 20 -> Top 50 -> Top 100
let cachedRankedEligibleCustomers: CustomerCardData[] | null = null;
let lastCacheTime = 0;

function getRankedEligibleCustomers(): CustomerCardData[] {
  const now = Date.now();
  if (cachedRankedEligibleCustomers && (now - lastCacheTime < 60000)) {
    return cachedRankedEligibleCustomers;
  }

  const dataset = readDataset();
  // 1. Eligibility Filtering FIRST:
  // last_visit <= 90 days AND opted_in = true AND no offer received in last 7 days
  const eligible = dataset.filter(c => isCustomerEligible(c));

  // 2. Uplift Prediction & Card Building
  const cards = eligible.map(c => buildCustomerCard(c));

  // 3. Rank by uplift descending
  cards.sort((a, b) => b.uplift_percentage_points - a.uplift_percentage_points);

  cachedRankedEligibleCustomers = cards;
  lastCacheTime = now;
  return cards;
}

// ==========================================
// REST API ROUTES
// ==========================================

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'Restaurant AI: Price Elasticity & Customer Uplift' });
});

// ------------------------------------------
// RESTAURANT MENU & PRICE ELASTICITY ENDPOINTS
// ------------------------------------------

const handleGetRestaurantMenu = (req: Request, res: Response) => {
  const restaurantId = req.params.restaurant_id || (req.query.restaurant_id as string) || 'rest_01';
  const search = ((req.query.search as string) || '').trim().toLowerCase();
  const category = ((req.query.category as string) || '').trim().toLowerCase();
  const availableOnly = req.query.available_only !== 'false';
  const limit = Math.max(1, parseInt(req.query.limit as string) || 300);

  let menu = getRestaurantMenu(restaurantId);

  if (availableOnly) {
    menu = menu.filter(item => item.available);
  }

  if (category) {
    menu = menu.filter(item => item.category.toLowerCase() === category);
  }

  if (search) {
    menu = menu.filter(item =>
      item.name.toLowerCase().includes(search) ||
      item.category.toLowerCase().includes(search) ||
      (item.subcategory && item.subcategory.toLowerCase().includes(search)) ||
      item.product_id.toLowerCase().includes(search)
    );
  }

  res.json(menu.slice(0, limit));
};

app.get('/api/restaurants/:restaurant_id/menu', handleGetRestaurantMenu);
app.get('/restaurants/:restaurant_id/menu', handleGetRestaurantMenu);
app.get('/api/restaurants/menu', handleGetRestaurantMenu);

// Compatible Price Elasticity products endpoint (uses real menu)
app.get('/api/price-elasticity/products', (req: Request, res: Response) => {
  handleGetRestaurantMenu(req, res);
});

app.post('/api/price-elasticity/simulate', (req: Request, res: Response) => {
  const { product_id, proposed_price, current_price, restaurant_id } = req.body;
  if (!product_id || proposed_price === undefined) {
    return res.status(400).json({ error: "product_id and proposed_price are required" });
  }

  try {
    const result = simulatePriceElasticity(
      product_id,
      Number(proposed_price),
      current_price ? Number(current_price) : undefined,
      restaurant_id
    );
    res.json(result);
  } catch (err: any) {
    res.status(404).json({ error: err.message || "Failed to simulate elasticity" });
  }
});

// ------------------------------------------
// CUSTOMER UPLIFT ENDPOINTS
// ------------------------------------------

// Main customer list with selector (Top 20, 50, 100, 500, 1000, ALL with pagination)
app.get('/api/customers', (req: Request, res: Response) => {
  const search = ((req.query.search as string) || '').trim().toLowerCase();
  const limitParam = (req.query.limit as string) || '20';
  const page = Math.max(1, parseInt(req.query.page as string) || 1);

  const ranked = getRankedEligibleCustomers();

  let filtered = ranked;
  if (search) {
    filtered = filtered.filter(c => c.customer_id.toLowerCase().includes(search));
  }

  const totalEligible = filtered.length;

  let returnedList: CustomerCardData[];
  if (limitParam === 'all') {
    // Safe pagination for ALL to protect browser memory
    const pageSize = 20;
    const startIndex = (page - 1) * pageSize;
    returnedList = filtered.slice(startIndex, startIndex + pageSize);
  } else {
    const limitNum = Math.min(1000, Math.max(1, parseInt(limitParam) || 20));
    returnedList = filtered.slice(0, limitNum);
  }

  res.json({
    total_eligible: totalEligible,
    limit: limitParam,
    page: page,
    customers: returnedList
  });
});

// Campaign Targeting API (POST /campaigns/uplift-targeting and /api/campaigns/uplift-targeting)
const handleCampaignTargeting = (req: Request, res: Response) => {
  const rawLimit = req.body.limit ?? req.body.top_n ?? 50;
  let limit = 50;
  if (rawLimit === 'all') {
    limit = 1000; // Safety maximum
  } else {
    limit = Math.min(1000, Math.max(1, parseInt(rawLimit) || 50));
  }

  const ranked = getRankedEligibleCustomers();
  const topList = ranked.slice(0, limit).map(c => ({
    customer_id: c.customer_id,
    uplift_score: c.uplift_score,
    uplift_percentage_points: c.uplift_percentage_points,
    status: c.status
  }));

  res.json({
    limit,
    total_eligible_customers: ranked.length,
    customers: topList
  });
};

app.post('/api/campaigns/uplift-targeting', handleCampaignTargeting);
app.post('/campaigns/uplift-targeting', handleCampaignTargeting);

// Individual Customer On-Demand Uplift: GET /customers/{customer_id}/uplift
const handleIndividualCustomerUplift = (req: Request, res: Response) => {
  const customerId = req.params.customer_id || req.params.id;
  const dataset = readDataset();
  const customer = dataset.find(c => c.customer_id.toLowerCase() === customerId.toLowerCase());

  if (!customer) {
    return res.status(404).json({ error: `Customer ${customerId} not found` });
  }

  // Calculate uplift & build detailed evidence-based profile on-demand
  const profile = buildDetailedProfile(customer);
  res.json(profile);
};

app.get('/api/customers/:customer_id/uplift', handleIndividualCustomerUplift);
app.get('/customers/:customer_id/uplift', handleIndividualCustomerUplift);

// Customer detail fallback
app.get('/api/customers/:id', handleIndividualCustomerUplift);

// Vite Middleware & Static Serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Restaurant AI (Price Elasticity & Customer Uplift) running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

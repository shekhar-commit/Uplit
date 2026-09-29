import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Tag,
  Users,
  Search,
  ChevronDown,
  Check,
  Utensils,
  X,
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  User,
  ShoppingBag,
  Calendar,
  Clock,
  DollarSign,
  RefreshCw,
  HelpCircle,
  Activity,
  ArrowRight,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

// ==========================================
// 1. TYPES & INTERFACES
// ==========================================

export interface MenuItem {
  product_id: string;
  name: string;
  category: string;
  subcategory?: string;
  price: number;
  available: boolean;
  base_demand?: number;
  elasticity?: number;
}

export type ProductElasticity = MenuItem;

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

export type CustomerStatus = 'Active' | 'At Risk' | 'Inactive';

export interface CustomerCardData {
  customer_id: string;
  uplift_score: number;
  uplift_percentage_points: number;
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

// ==========================================
// 2. API CLIENT
// ==========================================

const api = {
  async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const res = await fetch(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {})
      },
      ...options
    });
    if (!res.ok) {
      throw new Error(`API error: ${res.status}`);
    }
    return res.json() as Promise<T>;
  },

  async getRestaurantMenu(restaurantId = 'rest_01', search = '', category = ''): Promise<ProductElasticity[]> {
    const query = new URLSearchParams();
    if (search) query.append('search', search);
    if (category) query.append('category', category);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request<ProductElasticity[]>(`/api/restaurants/${restaurantId}/menu${qs}`);
  },

  async simulatePriceElasticity(data: {
    product_id: string;
    proposed_price: number;
    current_price?: number;
    restaurant_id?: string;
  }): Promise<ElasticitySimulationResult> {
    return this.request<ElasticitySimulationResult>('/api/price-elasticity/simulate', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async getCustomers(params?: {
    search?: string;
    limit?: string;
    page?: number;
  }): Promise<{
    total_eligible: number;
    limit: string;
    page: number;
    customers: CustomerCardData[];
  }> {
    const query = new URLSearchParams();
    if (params?.search) query.append('search', params.search);
    if (params?.limit) query.append('limit', params.limit);
    if (params?.page) query.append('page', params.page.toString());
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/api/customers${qs}`);
  },

  async getCustomerUplift(customerId: string): Promise<DetailedCustomerProfile> {
    return this.request<DetailedCustomerProfile>(`/api/customers/${encodeURIComponent(customerId)}/uplift`);
  }
};

// ==========================================
// 3. PRICE ELASTICITY COMPONENT
// ==========================================

const PriceElasticitySection: React.FC = () => {
  const [products, setProducts] = useState<ProductElasticity[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductElasticity | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number>(250);
  const [proposedPrice, setProposedPrice] = useState<number>(220);
  const [activeDiscountPercent, setActiveDiscountPercent] = useState<number | null>(12);
  const [result, setResult] = useState<ElasticitySimulationResult | null>(null);

  // Searchable combobox states
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const comboboxRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load real menu on mount
  useEffect(() => {
    const loadMenu = async () => {
      try {
        const menu = await api.getRestaurantMenu('rest_01');
        setProducts(menu);
        if (menu.length > 0) {
          const defaultItem = menu.find(p => p.name.toLowerCase().includes('paneer pizza')) || menu[0];
          setSelectedProduct(defaultItem);
          setCurrentPrice(defaultItem.price);
          setProposedPrice(220);
        }
      } catch (err) {
        console.error('Failed to load menu:', err);
      }
    };
    loadMenu();
  }, []);

  // Close combobox when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(event.target as Node)) {
        setComboboxOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input on open
  useEffect(() => {
    if (comboboxOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [comboboxOpen]);

  // Run simulation
  const runSimulation = async (prodId: string, propPrice: number, currPrice: number) => {
    if (!prodId || propPrice <= 0 || currPrice <= 0) return;
    try {
      const sim = await api.simulatePriceElasticity({
        product_id: prodId,
        proposed_price: propPrice,
        current_price: currPrice,
        restaurant_id: 'rest_01'
      });
      setResult(sim);
    } catch (err) {
      console.error('Simulation error:', err);
    }
  };

  useEffect(() => {
    if (selectedProduct && proposedPrice > 0 && currentPrice > 0) {
      runSimulation(selectedProduct.product_id, proposedPrice, currentPrice);
    }
  }, [selectedProduct, proposedPrice, currentPrice]);

  const handleSelectProduct = (product: ProductElasticity) => {
    setSelectedProduct(product);
    setCurrentPrice(product.price);

    if (activeDiscountPercent !== null) {
      const discounted = Math.round(product.price * (1 - activeDiscountPercent / 100));
      setProposedPrice(discounted);
    } else {
      const defaultDiscounted = Math.round(product.price * 0.88);
      setProposedPrice(defaultDiscounted);
      setActiveDiscountPercent(12);
    }

    setComboboxOpen(false);
    setSearchQuery('');
  };

  const applyDiscountPreset = (percent: number) => {
    setActiveDiscountPercent(percent);
    const newPrice = Math.round(currentPrice * (1 - percent / 100));
    setProposedPrice(newPrice);
  };

  const handleProposedPriceManualChange = (val: number) => {
    setProposedPrice(val);
    if (currentPrice > 0) {
      const diff = currentPrice - val;
      const pct = Math.round((diff / currentPrice) * 100);
      setActiveDiscountPercent(pct > 0 ? pct : null);
    }
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => {
      if (p.category) set.add(p.category);
    });
    return ['All', ...Array.from(set)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return products.filter(p => {
      const matchesCategory = selectedCategory === 'All' || p.category.toLowerCase() === selectedCategory.toLowerCase();
      if (!matchesCategory) return false;
      if (!query) return true;
      return (
        p.name.toLowerCase().includes(query) ||
        p.category.toLowerCase().includes(query) ||
        (p.subcategory && p.subcategory.toLowerCase().includes(query)) ||
        p.product_id.toLowerCase().includes(query)
      );
    });
  }, [products, searchQuery, selectedCategory]);

  return (
    <section className="bg-neutral-900/90 border border-neutral-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-sm">
      {/* Header */}
      <div className="border-b border-neutral-800 pb-4">
        <div className="flex items-center gap-2">
          <Tag className="w-5 h-5 text-emerald-400" />
          <h2 className="text-xl font-bold tracking-tight text-white">
            PRICE ELASTICITY
          </h2>
        </div>
        <p className="text-xs text-neutral-400 mt-1">
          Estimate how demand may change when price or discount changes.
        </p>
      </div>

      {/* Product & Price Selection Form */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
        {/* Searchable Product Selector / Combobox */}
        <div className="space-y-1.5 relative" ref={comboboxRef}>
          <label className="block text-xs font-medium text-neutral-300">
            Select Product ({products.length} menu items)
          </label>

          <button
            type="button"
            onClick={() => setComboboxOpen(!comboboxOpen)}
            className="w-full text-left px-3 py-2 text-xs bg-neutral-950 border border-neutral-800 hover:border-neutral-700 rounded-lg text-white font-medium focus:outline-none focus:border-emerald-500 transition-colors flex items-center justify-between gap-2 shadow-xs"
          >
            <div className="truncate">
              {selectedProduct ? (
                <div className="flex items-center gap-2 truncate">
                  <span className="font-semibold text-white truncate">{selectedProduct.name}</span>
                  <span className="text-[11px] text-neutral-400 shrink-0">· {selectedProduct.category}</span>
                  <span className="text-[11px] text-emerald-400 font-mono shrink-0">₹{selectedProduct.price}</span>
                </div>
              ) : (
                <span className="text-neutral-500">Search restaurant dishes...</span>
              )}
            </div>
            <ChevronDown className={`w-4 h-4 text-neutral-400 shrink-0 transition-transform ${comboboxOpen ? 'rotate-180 text-emerald-400' : ''}`} />
          </button>

          {/* Search Dropdown Popover */}
          {comboboxOpen && (
            <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-neutral-950 border border-neutral-800 rounded-xl shadow-2xl p-3 space-y-2.5 animate-in fade-in duration-100 min-w-[320px] max-w-full">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-2.5" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search dishes (e.g. paneer, chicken, pizza)..."
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-neutral-900 border border-neutral-800 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 font-mono"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-2.5 text-neutral-500 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Category Quick Filter Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[10px] scrollbar-thin">
                {categories.slice(0, 6).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2 py-0.5 rounded-full whitespace-nowrap transition-colors ${
                      selectedCategory === cat
                        ? 'bg-emerald-600 text-white font-semibold'
                        : 'bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="text-[10px] text-neutral-500 px-1 font-mono flex justify-between">
                <span>{searchQuery ? `Matching "${searchQuery}":` : 'Restaurant Menu:'}</span>
                <span>{filteredProducts.length} dishes</span>
              </div>

              <div className="max-h-60 overflow-y-auto divide-y divide-neutral-900 rounded-lg border border-neutral-900">
                {filteredProducts.length === 0 ? (
                  <div className="p-6 text-center text-xs text-neutral-500 font-mono">
                    No dishes found matching "{searchQuery}".
                  </div>
                ) : (
                  filteredProducts.map((p) => {
                    const isSelected = selectedProduct?.product_id === p.product_id;
                    return (
                      <div
                        key={p.product_id}
                        onClick={() => handleSelectProduct(p)}
                        className={`p-2.5 flex items-center justify-between text-xs cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-emerald-950/40 text-emerald-300'
                            : 'hover:bg-neutral-900 text-neutral-200'
                        }`}
                      >
                        <div className="space-y-0.5 truncate pr-2">
                          <div className="font-semibold text-white truncate flex items-center gap-1.5">
                            <span className="truncate">{p.name}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                          </div>
                          <div className="text-[11px] text-neutral-400 truncate">
                            {p.category} {p.subcategory ? `· ${p.subcategory}` : ''}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-bold text-emerald-400 font-mono">
                            ₹{p.price}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {selectedProduct && (
            <div className="text-[11px] text-neutral-400 flex items-center gap-1.5 pt-0.5">
              <Utensils className="w-3 h-3 text-emerald-400 shrink-0" />
              <span className="text-neutral-300 font-medium truncate">{selectedProduct.name}</span>
              <span className="text-neutral-500">({selectedProduct.category})</span>
            </div>
          )}
        </div>

        {/* Current Price */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-neutral-300">
            Current Price (₹)
          </label>
          <input
            type="number"
            min="10"
            step="5"
            value={currentPrice}
            onChange={(e) => setCurrentPrice(Math.max(1, Number(e.target.value)))}
            className="w-full px-3 py-2 text-xs bg-neutral-950 border border-neutral-800 rounded-lg text-white font-mono focus:outline-none focus:border-emerald-500"
          />
          <div className="text-[11px] text-neutral-500">
            Loaded from menu (editable)
          </div>
        </div>

        {/* Proposed Price */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-neutral-300">
            Proposed Price / Discount (₹)
          </label>
          <input
            type="number"
            min="10"
            step="5"
            value={proposedPrice}
            onChange={(e) => handleProposedPriceManualChange(Math.max(1, Number(e.target.value)))}
            className="w-full px-3 py-2 text-xs bg-neutral-950 border border-neutral-800 rounded-lg text-white font-mono focus:outline-none focus:border-emerald-500"
          />
          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-[10px] text-neutral-500">Quick:</span>
            {[5, 10, 12, 15, 20].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => applyDiscountPreset(pct)}
                className={`px-2 py-0.5 text-[10px] rounded font-mono transition-colors ${
                  activeDiscountPercent === pct
                    ? 'bg-emerald-600 text-white font-semibold'
                    : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
                }`}
              >
                -{pct}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results Display */}
      {result && (
        <div className="p-5 rounded-xl bg-neutral-950 border border-neutral-800 space-y-5">
          <div className="text-xs font-semibold text-neutral-300 uppercase tracking-wider font-mono">
            Estimated Impact
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-3.5 rounded-lg bg-neutral-900 border border-neutral-800 space-y-1">
              <div className="text-[11px] text-neutral-400">Price Change</div>
              <div className="text-base font-bold text-white font-mono">
                ₹{result.current_price} → ₹{result.proposed_price}
              </div>
              <div className={`text-[11px] font-mono ${result.price_change_amount < 0 ? 'text-emerald-400' : result.price_change_amount > 0 ? 'text-amber-400' : 'text-neutral-400'}`}>
                {result.price_change_amount < 0 ? '' : '+'}{result.price_change_amount} ({result.price_change_percent}%)
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-neutral-900 border border-neutral-800 space-y-1">
              <div className="text-[11px] text-neutral-400">Expected Demand Change</div>
              <div className={`text-2xl font-black font-mono tracking-tight ${result.expected_demand_change_percent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {result.expected_demand_change_percent >= 0 ? '+' : ''}{result.expected_demand_change_percent}%
              </div>
              <div className="text-[11px] text-neutral-500 font-medium">
                {result.demand_direction === 'increase' && 'Demand may increase'}
                {result.demand_direction === 'decrease' && 'Demand may decrease'}
                {result.demand_direction === 'no_change' && 'Demand likely unchanged'}
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-neutral-900 border border-neutral-800 space-y-1">
              <div className="text-[11px] text-neutral-400">Expected Demand</div>
              <div className="text-xl font-bold text-white font-mono">
                {result.current_demand} → {result.expected_demand} portions
              </div>
              <div className="text-[11px] text-neutral-500">
                Portions sold per period
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-neutral-900 border border-neutral-800 space-y-1">
              <div className="text-[11px] text-neutral-400">Demand Direction</div>
              <div className="flex items-center gap-1.5 text-base font-bold text-white">
                {result.demand_direction === 'increase' && (
                  <>
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-400">Increasing</span>
                  </>
                )}
                {result.demand_direction === 'decrease' && (
                  <>
                    <TrendingDown className="w-4 h-4 text-rose-400" />
                    <span className="text-rose-400">Decreasing</span>
                  </>
                )}
                {result.demand_direction === 'no_change' && (
                  <>
                    <Minus className="w-4 h-4 text-neutral-400" />
                    <span className="text-neutral-400">Neutral</span>
                  </>
                )}
              </div>
              <div className="text-[11px] text-neutral-400 font-mono">
                Est. Revenue: ₹{result.expected_revenue.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

// ==========================================
// 4. CUSTOMER DETAIL PANEL COMPONENT
// ==========================================

const CustomerDetailPanel: React.FC<{
  customerId: string | null;
  onClose: () => void;
}> = ({ customerId, onClose }) => {
  const [data, setData] = useState<DetailedCustomerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!customerId) {
      setData(null);
      return;
    }

    const fetchDetail = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api.getCustomerUplift(customerId);
        setData(res);
      } catch (err: any) {
        setError('Unable to load customer profile');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [customerId]);

  if (!customerId) return null;

  const getStatusBadge = (status: CustomerStatus) => {
    switch (status) {
      case 'Active':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-800">
            Active
          </span>
        );
      case 'At Risk':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-950/80 text-amber-400 border border-amber-800">
            At Risk
          </span>
        );
      case 'Inactive':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-neutral-800 text-neutral-400 border border-neutral-700">
            Inactive
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-neutral-900 border-l border-neutral-800 h-full flex flex-col justify-between shadow-2xl overflow-y-auto">
        <div>
          <div className="p-5 border-b border-neutral-800/80 flex items-center justify-between sticky top-0 bg-neutral-900/90 backdrop-blur z-10">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-white">CUSTOMER PROFILE</h2>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            {loading ? (
              <div className="py-24 flex flex-col items-center justify-center space-y-3 text-neutral-400 text-xs">
                <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
                <span>Calculating on-demand uplift for {customerId}...</span>
              </div>
            ) : error ? (
              <div className="p-4 rounded-lg bg-red-950/40 border border-red-800 text-red-200 text-xs">
                {error}
              </div>
            ) : data ? (
              <>
                <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800/80 flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="text-[11px] text-neutral-400">Customer ID</div>
                    <div className="text-base font-bold text-white font-mono">
                      {data.customer_id}
                    </div>
                    <div>{getStatusBadge(data.status)}</div>
                  </div>
                  <div className="text-right space-y-0.5">
                    <div className="text-[11px] text-neutral-400">Estimated Uplift</div>
                    <div className="text-xl font-black text-emerald-400 font-mono">
                      +{data.uplift_percentage_points} percentage points
                    </div>
                    <div className="text-[10px] text-neutral-500 font-medium">
                      Incremental offer sensitivity
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/60 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Why this customer?</span>
                  </div>
                  <p className="text-xs text-emerald-100/90 leading-relaxed">
                    {data.why_this_customer}
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-200">
                    <HelpCircle className="w-3.5 h-3.5 text-sky-400" />
                    <span>
                      {data.status === 'Active'
                        ? 'Why is this customer coming?'
                        : 'Why has this customer not visited recently?'}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-300 leading-relaxed">
                    {data.why_coming_or_not}
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-200">
                    <Activity className="w-3.5 h-3.5 text-amber-400" />
                    <span>Behavior Summary</span>
                  </div>
                  <p className="text-xs text-neutral-300 leading-relaxed">
                    {data.behavior_summary}
                  </p>
                </div>

                {/* Visit Behavior */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-neutral-300 uppercase tracking-wider font-mono">
                    VISIT BEHAVIOR
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 text-xs">
                    <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800">
                      <div className="text-[11px] text-neutral-400">Total Visits</div>
                      <div className="text-sm font-semibold text-white font-mono mt-0.5">
                        {data.visit_behavior.total_visits}
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800">
                      <div className="text-[11px] text-neutral-400">Total Orders</div>
                      <div className="text-sm font-semibold text-white font-mono mt-0.5">
                        {data.visit_behavior.total_orders}
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800">
                      <div className="text-[11px] text-neutral-400">Last Visit</div>
                      <div className="text-sm font-semibold text-white font-mono mt-0.5">
                        {data.visit_behavior.last_visit}
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800">
                      <div className="text-[11px] text-neutral-400">Days Since Last Visit</div>
                      <div className="text-sm font-semibold text-white font-mono mt-0.5">
                        {data.visit_behavior.days_since_last_visit} days
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 text-xs space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-400">Average Visit Frequency:</span>
                      <span className="font-medium text-white">{data.visit_behavior.average_visit_frequency}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-400">Preferred Day:</span>
                      <span className="font-medium text-white">{data.visit_behavior.preferred_day}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-400">Preferred Time:</span>
                      <span className="font-medium text-white">{data.visit_behavior.preferred_time}</span>
                    </div>
                  </div>
                </div>

                {/* Purchase Behavior */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-neutral-300 uppercase tracking-wider font-mono">
                    PURCHASE BEHAVIOR
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 text-xs">
                    <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800">
                      <div className="text-[11px] text-neutral-400">Total Spend</div>
                      <div className="text-sm font-semibold text-white font-mono mt-0.5">
                        ₹{data.purchase_behavior.total_spend.toLocaleString()}
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800">
                      <div className="text-[11px] text-neutral-400">Average Order Value</div>
                      <div className="text-sm font-semibold text-white font-mono mt-0.5">
                        ₹{data.purchase_behavior.average_order_value}
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800">
                      <div className="text-[11px] text-neutral-400">Avg Items / Order</div>
                      <div className="text-sm font-semibold text-white font-mono mt-0.5">
                        {data.purchase_behavior.average_items_per_order} items
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800">
                      <div className="text-[11px] text-neutral-400">Recent Purchase Trend</div>
                      <div className="text-sm font-semibold text-white font-mono mt-0.5">
                        {data.purchase_behavior.recent_purchase_trend}
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 text-xs space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-400">Favorite Category:</span>
                      <span className="font-medium text-white">{data.purchase_behavior.favorite_category}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-400">Favorite Item:</span>
                      <span className="font-medium text-white">{data.purchase_behavior.favorite_item}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-400">Purchase Frequency:</span>
                      <span className="font-medium text-white">{data.purchase_behavior.purchase_frequency}</span>
                    </div>
                  </div>
                </div>

                {/* Offer Behavior */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-neutral-300 uppercase tracking-wider font-mono">
                    OFFER BEHAVIOR
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs text-center font-mono">
                    <div className="p-2.5 rounded bg-neutral-950 border border-neutral-800">
                      <div className="text-[10px] text-neutral-400">Previous Offers</div>
                      <div className="text-sm font-bold text-white mt-0.5">
                        {data.offer_behavior.previous_offers}
                      </div>
                    </div>

                    <div className="p-2.5 rounded bg-neutral-950 border border-neutral-800">
                      <div className="text-[10px] text-neutral-400">Offers Redeemed</div>
                      <div className="text-sm font-bold text-emerald-400 mt-0.5">
                        {data.offer_behavior.offers_redeemed}
                      </div>
                    </div>

                    <div className="p-2.5 rounded bg-neutral-950 border border-neutral-800">
                      <div className="text-[10px] text-neutral-400">Response Rate</div>
                      <div className="text-sm font-bold text-sky-400 mt-0.5">
                        {data.offer_behavior.offer_response_rate}
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 text-xs space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-400">Last Offer Sent:</span>
                      <span className="font-medium text-white">{data.offer_behavior.last_offer_date}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-400">Last Offer Response:</span>
                      <span className={`font-medium ${data.offer_behavior.last_offer_response === 'Redeemed' ? 'text-emerald-400' : 'text-neutral-400'}`}>
                        {data.offer_behavior.last_offer_response}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="p-4 border-t border-neutral-800 bg-neutral-950/70 flex justify-end sticky bottom-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 5. CUSTOMER UPLIFT COMPONENT
// ==========================================

const CustomerUpliftSection: React.FC = () => {
  const [customers, setCustomers] = useState<CustomerCardData[]>([]);
  const [limit, setLimit] = useState<string>('20');
  const [page, setPage] = useState<number>(1);
  const [totalEligible, setTotalEligible] = useState<number>(0);
  const [search, setSearch] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  const fetchCustomers = async (limitVal = limit, pageVal = page, searchVal = search) => {
    try {
      setLoading(true);
      const res = await api.getCustomers({
        limit: limitVal,
        page: pageVal,
        search: searchVal
      });
      setCustomers(res.customers);
      setTotalEligible(res.total_eligible);
    } catch (err) {
      console.error('Failed to load uplift customers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers(limit, page, search);
  }, [limit, page]);

  const handleLimitChange = (newLimit: string) => {
    setLimit(newLimit);
    setPage(1);
    fetchCustomers(newLimit, 1, search);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearch(val);
    setPage(1);
    fetchCustomers(limit, 1, val);
  };

  const getStatusBadge = (status: CustomerStatus) => {
    switch (status) {
      case 'Active':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-800">
            Active
          </span>
        );
      case 'At Risk':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/80 text-amber-400 border border-amber-800">
            At Risk
          </span>
        );
      case 'Inactive':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-neutral-800 text-neutral-400 border border-neutral-700">
            Inactive
          </span>
        );
    }
  };

  const totalPages = Math.ceil(totalEligible / 20);

  return (
    <section className="bg-neutral-900/90 border border-neutral-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-neutral-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-sky-400" />
            <h2 className="text-xl font-bold tracking-tight text-white">
              CUSTOMER UPLIFT
            </h2>
          </div>
          <p className="text-xs text-neutral-400 mt-1">
            Identify customers who may respond more strongly to an offer.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-300 font-medium whitespace-nowrap">
              How many customers?
            </label>
            <select
              value={limit}
              onChange={(e) => handleLimitChange(e.target.value)}
              className="px-3 py-1.5 text-xs bg-neutral-950 border border-neutral-800 rounded-lg text-white font-medium focus:outline-none focus:border-emerald-500 font-mono"
            >
              <option value="20">Top 20</option>
              <option value="50">Top 50</option>
              <option value="100">Top 100</option>
              <option value="500">Top 500</option>
              <option value="1000">Top 1000</option>
              <option value="all">ALL (Paginated)</option>
            </select>
          </div>

          <div className="relative w-full sm:w-56">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={handleSearchChange}
              placeholder="Search customer..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-neutral-950 border border-neutral-800 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-400 font-mono">
        <div>
          Showing {customers.length} {limit === 'all' ? `(Page ${page} of ${totalPages || 1})` : ''} of {totalEligible.toLocaleString()} eligible diners
        </div>
        <div className="text-[11px] text-neutral-500">
          Ranked by highest estimated uplift
        </div>
      </div>

      {loading ? (
        <div className="p-16 text-center text-xs text-neutral-500 font-mono">
          Loading customer uplift rankings...
        </div>
      ) : customers.length === 0 ? (
        <div className="p-16 text-center text-xs text-neutral-400">
          No eligible customers found matching "{search}".
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {customers.map((c) => (
            <div
              key={c.customer_id}
              onClick={() => setSelectedCustomerId(c.customer_id)}
              className="p-5 rounded-xl bg-neutral-950 border border-neutral-800 hover:border-neutral-700 transition-all flex flex-col justify-between space-y-4 cursor-pointer group shadow-sm hover:shadow-md"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-bold text-white tracking-wide">
                    {c.customer_id}
                  </span>
                  <div>{getStatusBadge(c.status)}</div>
                </div>

                <div className="pt-0.5">
                  <div className="text-[11px] text-neutral-400 font-medium">Uplift Score</div>
                  <div className="text-2xl font-black text-emerald-400 font-mono tracking-tight tabular-nums mt-0.5">
                    +{c.uplift_percentage_points} percentage points
                  </div>
                  <div className="text-[11px] text-neutral-400 mt-1 leading-snug">
                    "{c.explanation}"
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-neutral-800/80 text-xs">
                  <div>
                    <span className="text-[10px] text-neutral-500 font-medium block">
                      Why this customer may respond:
                    </span>
                    <span className="text-neutral-300 text-[11px] leading-relaxed block mt-0.5">
                      "{c.why_respond}"
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-neutral-500 font-medium block">
                      Visit Behavior:
                    </span>
                    <span className="text-neutral-300 text-[11px] leading-relaxed block mt-0.5">
                      "{c.visit_behavior_short}"
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-neutral-500 font-medium block">
                      Offer Behavior:
                    </span>
                    <span className="text-neutral-300 text-[11px] leading-relaxed block mt-0.5">
                      "{c.offer_behavior_short}"
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-neutral-800/80 flex items-center justify-between text-xs font-semibold text-emerald-400 group-hover:text-emerald-300">
                <span>View Full Profile</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          ))}
        </div>
      )}

      {limit === 'all' && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-4 border-t border-neutral-800">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-neutral-950 border border-neutral-800 text-xs text-white disabled:opacity-40 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Previous</span>
          </button>
          <span className="text-xs font-mono text-neutral-400">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-neutral-950 border border-neutral-800 text-xs text-white disabled:opacity-40 transition-colors"
          >
            <span>Next</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <CustomerDetailPanel
        customerId={selectedCustomerId}
        onClose={() => setSelectedCustomerId(null)}
      />
    </section>
  );
};

// ==========================================
// 6. MAIN APPLICATION ROOT
// ==========================================

export default function App() {
  const elasticityRef = useRef<HTMLDivElement>(null);
  const upliftRef = useRef<HTMLDivElement>(null);

  const scrollToSection = (ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans selection:bg-emerald-500 selection:text-white flex flex-col">
      {/* Clean Minimal Header */}
      <header className="h-14 border-b border-neutral-800 bg-neutral-900/80 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-emerald-600 flex items-center justify-center font-bold text-white text-xs">
            RU
          </div>
          <div>
            <h1 className="text-xs font-semibold text-white tracking-tight">
              Restaurant AI
            </h1>
            <p className="text-[10px] text-neutral-400">
              Demand & Response Intelligence
            </p>
          </div>
        </div>

        {/* Navigation Order: 1. Price Elasticity, 2. Customer Uplift */}
        <nav className="flex items-center gap-2">
          <button
            onClick={() => scrollToSection(elasticityRef)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <Tag className="w-3.5 h-3.5 text-emerald-400" />
            <span>Price Elasticity</span>
          </button>

          <button
            onClick={() => scrollToSection(upliftRef)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <Users className="w-3.5 h-3.5 text-sky-400" />
            <span>Customer Uplift</span>
          </button>
        </nav>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 sm:p-8 space-y-10">
        <div className="space-y-1">
          <h2 className="text-2xl font-extrabold tracking-tight text-white">
            Restaurant Demand & Customer Intelligence
          </h2>
          <p className="text-xs text-neutral-400 max-w-2xl leading-relaxed">
            Make evidence-based promotional decisions: evaluate how price adjustments impact menu demand, and identify which customers may respond most strongly to an offer.
          </p>
        </div>

        {/* 1. PRICE ELASTICITY (FIRST) */}
        <div ref={elasticityRef}>
          <PriceElasticitySection />
        </div>

        {/* 2. CUSTOMER UPLIFT (SECOND) */}
        <div ref={upliftRef}>
          <CustomerUpliftSection />
        </div>
      </main>

      <footer className="border-t border-neutral-800/80 py-6 text-center text-xs text-neutral-500 font-mono">
        Restaurant AI · Price Elasticity & Customer Uplift
      </footer>
    </div>
  );
}

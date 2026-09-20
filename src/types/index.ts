/* ============================================================
   Domain model.
   V1 covers billing + POS. Fields marked "future hook" exist so
   Inventory / Recipe / Purchase / Production / Wastage modules can
   attach later without migrating bills or products. (Plan §29)
   ============================================================ */

export type ID = string;
export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string;

/* ---------- Products ---------- */

export type DiscountType = 'percent' | 'fixed';

export interface Category {
  id: ID;
  name: string;
  icon: string;
  sortOrder: number;
  archived?: boolean;
}

export interface Product {
  id: ID;
  name: string;
  sku?: string;
  categoryId: ID;
  image?: string;           // data URL or remote URL
  sellingPrice: number;
  costPrice: number;
  discount: number;
  discountType: DiscountType;
  taxRate: number;          // GST %
  available: boolean;
  unit: string;             // pcs / plate / cup / kg
  createdAt: ISODateTime;
  updatedAt: ISODateTime;

  /* future hooks — unused in V1, kept so later modules attach cleanly */
  recipeId?: ID;            // → Recipe → Ingredient → Inventory
  trackInventory?: boolean;
  archived?: boolean;
}

/* ---------- Cart / Bill ---------- */

export interface BillLine {
  id: ID;
  productId: ID;
  name: string;
  unitPrice: number;        // list price at time of sale
  costPrice: number;        // snapshot, so margin reports survive price changes
  qty: number;
  discount: number;
  discountType: DiscountType;
  taxRate: number;
  note?: string;
}

export type PaymentMethod = 'cash' | 'upi' | 'card';
export type BillStatus = 'completed' | 'refunded' | 'cancelled' | 'held';

export interface BillTotals {
  subtotal: number;         // sum(unitPrice * qty), pre-discount
  itemDiscount: number;
  billDiscount: number;
  taxableValue: number;
  tax: number;
  total: number;
  cost: number;             // sum(costPrice * qty) — margin reporting
}

export interface Bill {
  id: ID;
  billNo: string;           // INV-1026
  seq: number;              // 1026 — numeric, for sorting/search
  createdAt: ISODateTime;
  lines: BillLine[];
  billDiscount: number;
  billDiscountType: DiscountType;
  totals: BillTotals;
  payment: PaymentMethod;
  cashReceived?: number;
  change?: number;
  status: BillStatus;
  customerName?: string;
  customerPhone?: string;
  cashierId: ID;
  cashierName: string;
  note?: string;
  refundedAt?: ISODateTime;
  refundAmount?: number;
  cancelledAt?: ISODateTime;
  synced: 0 | 1;            // offline queue flag — indexable (Dexie skips booleans)
  heldLabel?: string;       // for suspended bills
  sourceOrderId?: ID;       // set when this bill came from a QR order
}

/* ---------- Daily closing ---------- */

export interface DayClose {
  id: ID;                   // CLS-20260826
  date: ISODate;
  closedAt: ISODateTime;
  totalSales: number;
  cashSales: number;
  upiSales: number;
  cardSales: number;
  onlineSales?: number;     // QR orders — settled by the gateway, not the drawer. Optional: absent on records closed before this feature existed.
  discounts: number;
  refunds: number;
  orders: number;
  expectedCash: number;
  actualCash: number;
  difference: number;
  note?: string;
  closedBy: string;
}

/* ---------- Users & permissions ---------- */

export type Role = 'owner' | 'manager' | 'cashier' | 'kitchen';

export type Permission =
  | 'billing'
  | 'bill_history'
  | 'refund'
  | 'products'
  | 'product_cost'
  | 'reports'
  | 'settings'
  | 'users'
  | 'day_close'
  | 'kot';

export interface User {
  id: ID;
  name: string;
  role: Role;
  pin: string;
  active: boolean;
  permissions?: Permission[]; // overrides role defaults when present
}

/* ---------- Settings ---------- */

export type ThemeMode = 'light' | 'dark' | 'system';
export type AccentName = 'coffee' | 'green' | 'orange' | 'custom';
export type CardStyle = 'compact' | 'comfortable';
export type ReceiptSize = '58mm' | '80mm' | 'A4';

export interface BusinessProfile {
  name: string;
  logo?: string;
  phone: string;
  address: string;
  gstin: string;
  email: string;
  currency: string;
}

export interface InvoiceSettings {
  prefix: string;
  startingNumber: number;
  showLogo: boolean;
  showGst: boolean;
  showDiscount: boolean;
  showCashier: boolean;
  showCustomerPhone: boolean;
  footerMessage: string;
}

export interface ReceiptSettings {
  size: ReceiptSize;
  printerName: string;
  autoPrint: boolean;
  /** Print a KOT automatically when a paid order reaches the kitchen screen. */
  autoPrintKot?: boolean;
  printDuplicate: boolean;
}

export interface BillingSettings {
  enabledPayments: PaymentMethod[];
  defaultTaxRate: number;
  pricesIncludeTax: boolean;
  maxDiscountPercent: number;
  requireReasonAboveDiscount: number;
  roundTotals: boolean;
}

export interface AppearanceSettings {
  theme: ThemeMode;
  accent: AccentName;
  customAccentHue: number;
  cardStyle: CardStyle;
  showProductImages: boolean;
  language: 'en' | 'ta';
}

export interface NotificationSettings {
  dailySalesSummary: boolean;
  lowSellingAlert: boolean;
  highDiscountAlert: boolean;
  refundAlert: boolean;
  failedPaymentAlert: boolean;
  dailyClosingReminder: boolean;
  onlineOrderAlert: boolean;
}

export interface ReportSettings {
  lowSellingThreshold: number;
  topProductCount: number;
  dailySalesTarget: number;
  monthlySalesTarget: number;
}

export interface Settings {
  business: BusinessProfile;
  invoice: InvoiceSettings;
  receipt: ReceiptSettings;
  billing: BillingSettings;
  appearance: AppearanceSettings;
  notifications: NotificationSettings;
  reports: ReportSettings;
  units: string[];
}

/* ---------- Reports ---------- */

export interface SalesSummary {
  totalSales: number;
  orders: number;
  avgBill: number;
  discount: number;
  refunds: number;
  tax: number;
  cost: number;
  margin: number;
}

export interface ProductPerformanceRow {
  productId: ID;
  name: string;
  categoryId: ID;
  sold: number;
  revenue: number;
  discount: number;
  cost: number;
  margin: number;
}

export interface TimeBucket {
  label: string;
  sales: number;
  orders: number;
  [key: string]: unknown;
}

export type {
  OrderStatus, CloudOrder, CloudOrderLine, CloudCustomer,
} from './order';
export { STATUS_LABELS } from './order';

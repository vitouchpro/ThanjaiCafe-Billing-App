import type { Category, Product, Settings, User } from '@/types';
import { now } from '@/utils/date';
import { productImage } from './illustrations';
import { productPhoto } from './photos';

export const DEFAULT_SETTINGS: Settings = {
  business: {
    name: 'THANJAI CAFE',
    logo: '',
    phone: '+91 98765 43210',
    address: '12, Bazaar Street, Mylapore, Chennai 600004',
    gstin: '33AABCT1234H1Z5',
    email: 'hello@thecafe.in',
    currency: '₹',
  },
  invoice: {
    prefix: 'INV-',
    startingNumber: 1001,
    showLogo: true,
    showGst: true,
    showDiscount: true,
    showCashier: true,
    showCustomerPhone: false,
    footerMessage: 'Thank you for visiting us!',
  },
  receipt: { size: '80mm', printerName: '', autoPrint: false, autoPrintKot: false, printDuplicate: false },
  billing: {
    enabledPayments: ['cash', 'upi', 'card'],
    defaultTaxRate: 5,
    pricesIncludeTax: true,
    maxDiscountPercent: 25,
    requireReasonAboveDiscount: 15,
    roundTotals: true,
  },
  appearance: {
    theme: 'system',
    accent: 'coffee',
    customAccentHue: 24,
    cardStyle: 'comfortable',
    showProductImages: true,
    language: 'en',
  },
  notifications: {
    dailySalesSummary: true,
    lowSellingAlert: true,
    highDiscountAlert: true,
    refundAlert: true,
    failedPaymentAlert: true,
    dailyClosingReminder: true,
    onlineOrderAlert: true,
  },
  reports: {
    lowSellingThreshold: 10,
    topProductCount: 5,
    dailySalesTarget: 9000,
    monthlySalesTarget: 250000,
  },
  units: ['pcs', 'plate', 'cup', 'glass', 'kg', 'g', 'litre', 'ml'],
};

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-coffee', name: 'Coffee', icon: '☕', sortOrder: 1 },
  { id: 'cat-tea', name: 'Tea', icon: '🍵', sortOrder: 2 },
  { id: 'cat-snacks', name: 'Snacks', icon: '🍘', sortOrder: 3 },
  { id: 'cat-tiffin', name: 'Tiffin', icon: '🍛', sortOrder: 4 },
  { id: 'cat-sweets', name: 'Sweets', icon: '🍮', sortOrder: 5 },
  { id: 'cat-millet', name: 'Millet Specials', icon: '🌾', sortOrder: 6 },
];

type Seed = [name: string, cat: string, price: number, cost: number, unit: string, available?: boolean];

const SEED: Seed[] = [
  ['Filter Coffee', 'cat-coffee', 25, 9.8, 'cup'],
  ['Sukku Coffee', 'cat-coffee', 30, 11.5, 'cup'],
  ['Black Coffee', 'cat-coffee', 20, 6.5, 'cup'],
  ['Badam Milk', 'cat-coffee', 40, 18, 'glass'],
  ['Cold Coffee', 'cat-coffee', 60, 24, 'glass'],

  ['Masala Tea', 'cat-tea', 20, 7, 'cup'],
  ['Ginger Tea', 'cat-tea', 20, 7, 'cup'],
  ['Green Tea', 'cat-tea', 25, 9, 'cup'],
  ['Lemon Tea', 'cat-tea', 22, 7.5, 'cup'],

  ['Vadai', 'cat-snacks', 15, 5.2, 'pcs'],
  ['Thattai', 'cat-snacks', 20, 7, 'pcs'],
  ['Bonda', 'cat-snacks', 15, 5.5, 'pcs', false],
  ['Murukku', 'cat-snacks', 25, 9, 'pcs'],
  ['Banana Bajji', 'cat-snacks', 18, 6, 'pcs'],
  ['Samosa', 'cat-snacks', 20, 7.5, 'pcs'],

  ['Idli (2 pcs)', 'cat-tiffin', 30, 10, 'plate'],
  ['Pongal', 'cat-tiffin', 45, 16, 'plate'],
  ['Masala Dosa', 'cat-tiffin', 60, 21, 'plate'],
  ['Plain Dosa', 'cat-tiffin', 45, 15, 'plate'],
  ['Upma', 'cat-tiffin', 35, 12, 'plate'],
  ['Poori (2 pcs)', 'cat-tiffin', 50, 18, 'plate'],

  ['Mysore Pak', 'cat-sweets', 30, 13, 'pcs'],
  ['Jangiri', 'cat-sweets', 25, 11, 'pcs'],
  ['Rava Kesari', 'cat-sweets', 30, 12, 'plate'],

  ['Ragi Adai', 'cat-millet', 35, 13, 'pcs'],
  ['Kambu Kozhukattai', 'cat-millet', 30, 12, 'pcs'],
  ['Millet Bonda', 'cat-millet', 25, 10, 'pcs'],
  ['Ragi Malt', 'cat-millet', 35, 14, 'glass'],
];

export function defaultProducts(): Product[] {
  const ts = now();
  return SEED.map(([name, categoryId, sellingPrice, costPrice, unit, available = true], i) => ({
    id: `prd-${String(i + 1).padStart(3, '0')}`,
    name,
    sku: `SKU${String(i + 1).padStart(4, '0')}`,
    categoryId,
    image: productPhoto(name) ?? productImage(name, categoryId),
    sellingPrice,
    costPrice,
    discount: 0,
    discountType: 'percent' as const,
    taxRate: 5,
    available,
    unit,
    createdAt: ts,
    updatedAt: ts,
  }));
}

export const DEFAULT_USERS: User[] = [
  { id: 'usr-owner', name: 'Thanjai (Owner)', role: 'owner', pin: '1234', active: true },
  { id: 'usr-manager', name: 'Ravi', role: 'manager', pin: '2345', active: true },
  { id: 'usr-cashier', name: 'Priya', role: 'cashier', pin: '3456', active: true },
  { id: 'usr-kitchen', name: 'Kitchen', role: 'kitchen', pin: '4567', active: true },
];

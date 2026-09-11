import type { Permission, Role, User } from '@/types';

/* Plan §25: cost, reports, settings and product editing stay hidden from a
   plain cashier unless explicitly granted. */

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [
    'billing', 'bill_history', 'refund', 'products', 'product_cost',
    'reports', 'settings', 'users', 'day_close', 'kot',
  ],
  manager: [
    'billing', 'bill_history', 'refund', 'products', 'product_cost',
    'reports', 'settings', 'day_close', 'kot',
  ],
  cashier: ['billing', 'bill_history'],
  kitchen: ['kot'],
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Manager',
  cashier: 'Cashier',
  kitchen: 'Kitchen',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Full access to every part of the app.',
  manager: 'Sales, products, reports and most settings.',
  cashier: 'Billing and bill history only.',
  kitchen: 'Kitchen order tickets.',
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  billing: 'Billing / POS',
  bill_history: 'Bill History',
  refund: 'Refunds & Cancellations',
  products: 'Manage Products',
  product_cost: 'View Cost & Margin',
  reports: 'Reports',
  settings: 'Settings',
  users: 'Users & Roles',
  day_close: 'Daily Closing',
  kot: 'Kitchen Orders',
};

export const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS) as Permission[];

export function permissionsOf(user: User | null): Permission[] {
  if (!user) return [];
  return user.permissions?.length ? user.permissions : ROLE_PERMISSIONS[user.role];
}

export function can(user: User | null, permission: Permission): boolean {
  if (!user) return false;
  if (user.role === 'owner') return true; // owner is never locked out
  return permissionsOf(user).includes(permission);
}

export const canAny = (user: User | null, perms: Permission[]): boolean =>
  perms.some((p) => can(user, p));

/** Where a user lands after signing in — a cashier should open straight
    onto the POS, not a dashboard they cannot read. */
export function landingRoute(user: User | null): string {
  if (!user) return '/login';
  if (can(user, 'reports')) return '/';
  if (can(user, 'billing')) return '/billing';
  if (can(user, 'kot')) return '/kitchen';
  return '/billing';
}

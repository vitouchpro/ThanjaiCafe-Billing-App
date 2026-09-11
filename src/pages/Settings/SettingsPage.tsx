import { useEffect, useRef, useState } from 'react';
import {
  Bell, Building2, ChevronRight, Database, Download, FileText, Palette,
  Printer, QrCode, Receipt, Shield, Trash2, Upload, Users, Wallet, Plus, Check, ArrowLeft, Info,
} from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { useIsMobile } from '@/hooks';
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, Field, Input, Modal, MoneyInput,
  RadioGroup, SectionTitle, Segmented, Select, Textarea, Toggle, toast,
} from '@/components/ui';
import { exportBackup, importBackup, resetDatabase, peekBillSeq } from '@/services/db/db';
import { downloadJson, downloadCsv, exportBillsCsv } from '@/services/reports/export';
import {
  ALL_PERMISSIONS, PERMISSION_LABELS, ROLE_DESCRIPTIONS, ROLE_LABELS,
  ROLE_PERMISSIONS, permissionsOf,
} from '@/features/auth/permissions';
import { printReceipt } from '@/services/billing/receipt';
import { OnlineOrderingSection } from './OnlineOrderingTab';
import { PHOTO_CREDITS } from '@/data/photos';
import { now } from '@/utils/date';
import type {
  AccentName, CardStyle, PaymentMethod, Permission, ReceiptSize, Role, ThemeMode, User,
} from '@/types';

/* Plan §20–26 — settings grouped into sections, master/detail on desktop,
   drill-down on mobile. */

type SectionId =
  | 'business' | 'invoice' | 'receipt' | 'billing'
  | 'appearance' | 'users' | 'notifications' | 'ordering' | 'system';

const SECTIONS: { id: SectionId; label: string; description: string; icon: typeof Building2 }[] = [
  { id: 'business', label: 'Business Profile', description: 'Name, logo, address, GSTIN', icon: Building2 },
  { id: 'invoice', label: 'Invoice', description: 'Numbering and what prints on a bill', icon: FileText },
  { id: 'receipt', label: 'Receipt & Printer', description: 'Paper size and printing', icon: Printer },
  { id: 'billing', label: 'Billing & Tax', description: 'Payments, GST, discount limits', icon: Wallet },
  { id: 'appearance', label: 'Appearance', description: 'Theme, accent, density', icon: Palette },
  { id: 'users', label: 'Users & Roles', description: 'Staff accounts and permissions', icon: Users },
  { id: 'notifications', label: 'Notifications', description: 'Daily alerts and reminders', icon: Bell },
  { id: 'ordering', label: 'Online Ordering', description: 'Publish menu and print table QR codes', icon: QrCode },
  { id: 'system', label: 'Backup & Data', description: 'Export, restore, reset', icon: Database },
];

export function SettingsPage() {
  const isMobile = useIsMobile();
  const [section, setSection] = useState<SectionId | null>(null);

  const active = section ?? (isMobile ? null : 'business');

  // Mobile: a list that drills into one section at a time.
  if (isMobile && !section) {
    return (
      <div className="p-4 space-y-4">
        <h1 className="text-[21px] font-extrabold text-ink">Settings</h1>
        <Card padded={false} className="overflow-hidden">
          <ul className="divide-y divide-line">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => setSection(s.id)}
                  className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-surface-2/60 transition"
                >
                  <span className="w-10 h-10 rounded-xl bg-accent-50 text-accent-700 dark:text-accent-300 grid place-items-center shrink-0">
                    <s.icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-bold text-ink">{s.label}</span>
                    <span className="block text-[12.5px] text-ink-3 truncate">{s.description}</span>
                  </span>
                  <ChevronRight size={17} className="text-ink-3 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-5 max-w-[1200px] mx-auto">
      {isMobile && (
        <button
          onClick={() => setSection(null)}
          className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent mb-3"
        >
          <ArrowLeft size={16} /> Settings
        </button>
      )}

      <div className="flex gap-5">
        {!isMobile && (
          <nav className="w-[250px] shrink-0 space-y-1">
            <h1 className="text-[21px] font-extrabold text-ink mb-3 px-1">Settings</h1>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={clsx(
                  'w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition',
                  active === s.id ? 'bg-accent text-accent-fg' : 'text-ink-2 hover:bg-surface-3',
                )}
              >
                <s.icon size={18} className="shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold truncate">{s.label}</span>
                </span>
              </button>
            ))}
          </nav>
        )}

        <div className="flex-1 min-w-0 space-y-4">
          {active === 'business' && <BusinessSection />}
          {active === 'invoice' && <InvoiceSection />}
          {active === 'receipt' && <ReceiptSection />}
          {active === 'billing' && <BillingSection />}
          {active === 'appearance' && <AppearanceSection />}
          {active === 'users' && <UsersSection />}
          {active === 'notifications' && <NotificationsSection />}
          {active === 'ordering' && <OnlineOrderingSection />}
          {active === 'system' && <SystemSection />}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Business profile (Plan §21) ---------------- */

function BusinessSection() {
  const business = useAppStore((s) => s.settings.business);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [form, setForm] = useState(business);
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  async function save() {
    await updateSettings({ business: form });
    setDirty(false);
    toast('Business profile saved', 'success');
  }

  async function pickLogo(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      toast('Logo must be under 2 MB', 'danger');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set('logo', reader.result as string);
    reader.readAsDataURL(file);
  }

  return (
    <Card>
      <SectionTitle title="Business Profile" subtitle="Appears on every printed bill" />

      <div className="flex items-center gap-4 mb-5">
        <div className="w-20 h-20 rounded-2xl bg-surface-3 border border-line grid place-items-center overflow-hidden shrink-0">
          {form.logo
            ? <img src={form.logo} alt="Logo" className="w-full h-full object-cover" />
            : <Building2 size={26} className="text-ink-3" />}
        </div>
        <div>
          <label className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-surface-3 text-ink font-semibold text-[13.5px] cursor-pointer hover:bg-line transition">
            <Upload size={16} /> {form.logo ? 'Change logo' : 'Upload logo'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pickLogo(f);
                e.target.value = '';
              }}
            />
          </label>
          {form.logo && (
            <button
              onClick={() => set('logo', '')}
              className="ml-2 text-[13px] font-semibold text-danger hover:underline"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <Field label="Business name" required>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91" />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="shop@example.com"
            />
          </Field>
        </div>

        <Field label="Address">
          <Textarea value={form.address} onChange={(e) => set('address', e.target.value)} />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="GSTIN" hint="Printed on bills when GST is shown.">
            <Input
              value={form.gstin}
              onChange={(e) => set('gstin', e.target.value.toUpperCase())}
              placeholder="33AABCT1234H1Z5"
            />
          </Field>
          <Field label="Currency symbol">
            <Input value={form.currency} onChange={(e) => set('currency', e.target.value)} maxLength={3} />
          </Field>
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-line">
        <Button variant="primary" onClick={save} disabled={!dirty}>Save changes</Button>
      </div>
    </Card>
  );
}

/* ---------------- Invoice (Plan §22) ---------------- */

function InvoiceSection() {
  const invoice = useAppStore((s) => s.settings.invoice);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [form, setForm] = useState(invoice);
  const [dirty, setDirty] = useState(false);
  const [nextNo, setNextNo] = useState<number | null>(null);

  // Reading the reserved counter is a side effect, not a computation.
  useEffect(() => {
    let cancelled = false;
    void peekBillSeq(invoice.startingNumber).then((n) => {
      if (!cancelled) setNextNo(n);
    });
    return () => { cancelled = true; };
  }, [invoice.startingNumber]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  return (
    <Card>
      <SectionTitle title="Invoice Settings" subtitle="Numbering and printed content" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <Field label="Invoice prefix">
          <Input value={form.prefix} onChange={(e) => set('prefix', e.target.value)} placeholder="INV-" />
        </Field>
        <Field
          label="Starting number"
          hint={nextNo !== null ? `Next bill will be ${form.prefix}${nextNo}` : undefined}
        >
          <Input
            type="number"
            value={form.startingNumber}
            onChange={(e) => set('startingNumber', Number(e.target.value) || 1)}
            className="tnum"
          />
        </Field>
      </div>

      <div className="space-y-1 divide-y divide-line">
        <ToggleRow label="Show logo" checked={form.showLogo} onChange={(v) => set('showLogo', v)} />
        <ToggleRow label="Show GST breakup" checked={form.showGst} onChange={(v) => set('showGst', v)} />
        <ToggleRow label="Show discounts" checked={form.showDiscount} onChange={(v) => set('showDiscount', v)} />
        <ToggleRow label="Show cashier name" checked={form.showCashier} onChange={(v) => set('showCashier', v)} />
        <ToggleRow
          label="Show customer phone"
          checked={form.showCustomerPhone}
          onChange={(v) => set('showCustomerPhone', v)}
        />
      </div>

      <div className="mt-4">
        <Field label="Footer message">
          <Input
            value={form.footerMessage}
            onChange={(e) => set('footerMessage', e.target.value)}
            placeholder="Thank you for visiting us!"
          />
        </Field>
      </div>

      <div className="mt-5 pt-4 border-t border-line">
        <Button
          variant="primary"
          disabled={!dirty}
          onClick={async () => {
            await updateSettings({ invoice: form });
            setDirty(false);
            toast('Invoice settings saved', 'success');
          }}
        >
          Save changes
        </Button>
      </div>
    </Card>
  );
}

/* ---------------- Receipt (Plan §23) ---------------- */

function ReceiptSection() {
  const settings = useAppStore((s) => s.settings);
  const bills = useAppStore((s) => s.bills);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [form, setForm] = useState(settings.receipt);
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const sample = bills.find((b) => b.status === 'completed');

  return (
    <Card>
      <SectionTitle title="Receipt & Printer" subtitle="Paper size and print behaviour" />

      <Field label="Receipt size">
        <RadioGroup
          value={form.size}
          onChange={(v) => set('size', v as ReceiptSize)}
          options={[
            { value: '58mm', label: '58 mm', description: 'Compact thermal roll' },
            { value: '80mm', label: '80 mm', description: 'Standard thermal roll' },
            { value: 'A4', label: 'A4', description: 'Full-page invoice' },
          ]}
        />
      </Field>

      <div className="mt-4">
        <Field label="Printer name" hint="For your reference — printing uses the browser print dialog.">
          <Input
            value={form.printerName}
            onChange={(e) => set('printerName', e.target.value)}
            placeholder="Counter thermal printer"
          />
        </Field>
      </div>

      <div className="mt-4 space-y-1 divide-y divide-line">
        <ToggleRow
          label="Auto print after payment"
          description="Opens the print dialog as soon as a bill completes."
          checked={form.autoPrint}
          onChange={(v) => set('autoPrint', v)}
        />
        <ToggleRow
          label="Print duplicate copy"
          description="Prints a second copy marked DUPLICATE."
          checked={form.printDuplicate}
          onChange={(v) => set('printDuplicate', v)}
        />
      </div>

      <div className="mt-5 pt-4 border-t border-line flex flex-wrap gap-2.5">
        <Button
          variant="primary"
          disabled={!dirty}
          onClick={async () => {
            await updateSettings({ receipt: form });
            setDirty(false);
            toast('Receipt settings saved', 'success');
          }}
        >
          Save changes
        </Button>
        <Button
          variant="outline"
          icon={<Printer size={16} />}
          disabled={!sample}
          onClick={() => sample && printReceipt(sample, { ...settings, receipt: form })}
        >
          Print a test receipt
        </Button>
      </div>
      {!sample && (
        <p className="text-[12.5px] text-ink-3 mt-2.5">
          Complete a bill first to preview a printed receipt.
        </p>
      )}
    </Card>
  );
}

/* ---------------- Billing & tax ---------------- */

function BillingSection() {
  const billing = useAppStore((s) => s.settings.billing);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [form, setForm] = useState(billing);
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const togglePayment = (m: PaymentMethod) => {
    const has = form.enabledPayments.includes(m);
    // At least one payment method must stay enabled or billing cannot complete.
    if (has && form.enabledPayments.length === 1) {
      toast('Keep at least one payment method enabled', 'danger');
      return;
    }
    set('enabledPayments', has
      ? form.enabledPayments.filter((x) => x !== m)
      : [...form.enabledPayments, m]);
  };

  return (
    <Card>
      <SectionTitle title="Billing & Tax" subtitle="Payment methods, GST and discount limits" />

      <Field label="Payment methods">
        <div className="space-y-1">
          {(['cash', 'upi', 'card'] as PaymentMethod[]).map((m) => (
            <Checkbox
              key={m}
              checked={form.enabledPayments.includes(m)}
              onChange={() => togglePayment(m)}
              label={m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1)}
            />
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        <Field label="Default GST rate" hint="Applied to new products.">
          <Select value={form.defaultTaxRate} onChange={(e) => set('defaultTaxRate', Number(e.target.value))}>
            {[0, 5, 12, 18, 28].map((r) => (
              <option key={r} value={r}>{r}%</option>
            ))}
          </Select>
        </Field>

        <Field label="Maximum discount" hint="Cap on bill-level discounts.">
          <Input
            type="number"
            min={0}
            max={100}
            value={form.maxDiscountPercent}
            onChange={(e) => set('maxDiscountPercent', Number(e.target.value))}
            className="tnum"
          />
        </Field>
      </div>

      <div className="mt-4 space-y-1 divide-y divide-line">
        <ToggleRow
          label="Prices include GST"
          description="Menu prices are tax-inclusive; GST is backed out of the price. Typical for a counter shop."
          checked={form.pricesIncludeTax}
          onChange={(v) => set('pricesIncludeTax', v)}
        />
        <ToggleRow
          label="Round totals to the rupee"
          description="Avoids handling paise in cash."
          checked={form.roundTotals}
          onChange={(v) => set('roundTotals', v)}
        />
      </div>

      <div className="mt-4 p-3.5 rounded-xl bg-info-bg border border-info/20 flex gap-2.5">
        <Info size={16} className="text-info shrink-0 mt-0.5" />
        <p className="text-[12.5px] text-ink-2 leading-relaxed">
          Changing “Prices include GST” affects how new bills are calculated. Bills already
          completed keep the totals they were saved with.
        </p>
      </div>

      <div className="mt-5 pt-4 border-t border-line">
        <Button
          variant="primary"
          disabled={!dirty}
          onClick={async () => {
            await updateSettings({ billing: form });
            setDirty(false);
            toast('Billing settings saved', 'success');
          }}
        >
          Save changes
        </Button>
      </div>
    </Card>
  );
}

/* ---------------- Appearance (Plan §24) ---------------- */

const ACCENT_SWATCHES: { value: AccentName; label: string; hue: number }[] = [
  { value: 'coffee', label: 'Coffee', hue: 24 },
  { value: 'green', label: 'Green', hue: 152 },
  { value: 'orange', label: 'Orange', hue: 18 },
  { value: 'custom', label: 'Custom', hue: 280 },
];

function AppearanceSection() {
  const appearance = useAppStore((s) => s.settings.appearance);
  const updateSettings = useAppStore((s) => s.updateSettings);

  // Appearance changes apply live — a preview you have to save is no preview.
  const set = <K extends keyof typeof appearance>(k: K, v: (typeof appearance)[K]) =>
    void updateSettings({ appearance: { ...appearance, [k]: v } });

  return (
    <Card>
      <SectionTitle title="Appearance" subtitle="Changes apply immediately" />

      <Field label="Theme">
        <Segmented
          fullWidth
          value={appearance.theme}
          onChange={(v) => set('theme', v as ThemeMode)}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Field>

      <div className="mt-4">
        <Field label="Accent colour">
          <div className="flex flex-wrap gap-2.5">
            {ACCENT_SWATCHES.map((a) => (
              <button
                key={a.value}
                onClick={() => set('accent', a.value)}
                className={clsx(
                  'flex items-center gap-2 h-11 px-3.5 rounded-xl border-2 transition',
                  appearance.accent === a.value
                    ? 'border-accent bg-accent-50'
                    : 'border-line bg-surface-2 hover:border-line-strong',
                )}
              >
                <span
                  className="w-5 h-5 rounded-full shrink-0"
                  style={{
                    background: `hsl(${a.value === 'custom' ? appearance.customAccentHue : a.hue} 52% 42%)`,
                  }}
                />
                <span className="text-[13.5px] font-semibold text-ink">{a.label}</span>
                {appearance.accent === a.value && <Check size={14} className="text-accent" />}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {appearance.accent === 'custom' && (
        <div className="mt-4">
          <Field label={`Custom hue — ${appearance.customAccentHue}°`}>
            <input
              type="range"
              min={0}
              max={359}
              value={appearance.customAccentHue}
              onChange={(e) => set('customAccentHue', Number(e.target.value))}
              className="w-full h-2 rounded-full appearance-none cursor-pointer"
              style={{
                background:
                  'linear-gradient(to right, hsl(0 60% 50%), hsl(60 60% 50%), hsl(120 60% 50%), hsl(180 60% 50%), hsl(240 60% 50%), hsl(300 60% 50%), hsl(360 60% 50%))',
              }}
            />
          </Field>
        </div>
      )}

      <div className="mt-4">
        <Field label="Card density">
          <Segmented
            fullWidth
            value={appearance.cardStyle}
            onChange={(v) => set('cardStyle', v as CardStyle)}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfortable', label: 'Comfortable' },
            ]}
          />
        </Field>
      </div>

      <div className="mt-4 space-y-1 divide-y divide-line">
        <ToggleRow
          label="Show product images"
          description="Off shows a dense list on the POS — faster on a small screen."
          checked={appearance.showProductImages}
          onChange={(v) => set('showProductImages', v)}
        />
      </div>
    </Card>
  );
}

/* ---------------- Users (Plan §25) ---------------- */

function UsersSection() {
  const users = useAppStore((s) => s.users);
  const currentUser = useAppStore((s) => s.currentUser);
  const [editing, setEditing] = useState<User | 'new' | null>(null);

  return (
    <>
      <Card padded={false}>
        <div className="p-4 sm:p-5 pb-3 flex items-center justify-between gap-3">
          <SectionTitle title="Users & Roles" subtitle="Who can use this till, and what they can see" />
          <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Add
          </Button>
        </div>

        <ul className="divide-y divide-line border-t border-line">
          {users.map((u) => (
            <li key={u.id}>
              <button
                onClick={() => setEditing(u)}
                className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-surface-2/60 transition"
              >
                <span className="w-10 h-10 rounded-xl bg-accent text-accent-fg grid place-items-center text-[14px] font-extrabold shrink-0">
                  {u.name[0].toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[14.5px] font-bold text-ink truncate">{u.name}</span>
                    {u.id === currentUser?.id && <Badge tone="accent">You</Badge>}
                    {!u.active && <Badge tone="neutral">Disabled</Badge>}
                  </span>
                  <span className="block text-[12.5px] text-ink-3">
                    {ROLE_LABELS[u.role]} · {permissionsOf(u).length} permissions
                  </span>
                </span>
                <ChevronRight size={17} className="text-ink-3 shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <UserModal
        user={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function UserModal({
  user, open, onClose,
}: { user: User | null; open: boolean; onClose: () => void }) {
  const addUser = useAppStore((s) => s.addUser);
  const updateUser = useAppStore((s) => s.updateUser);
  const deleteUser = useAppStore((s) => s.deleteUser);
  const currentUser = useAppStore((s) => s.currentUser);

  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('cashier');
  const [pin, setPin] = useState('');
  const [active, setActive] = useState(true);
  const [custom, setCustom] = useState<Permission[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');

  const openKey = user?.id ?? (open ? 'new' : '');
  if (open && key !== openKey) {
    setKey(openKey);
    setError('');
    setName(user?.name ?? '');
    setRole(user?.role ?? 'cashier');
    setPin(user?.pin ?? '');
    setActive(user?.active ?? true);
    setCustom(user?.permissions ?? null);
  }
  if (!open && key) setKey('');

  const effective = custom ?? ROLE_PERMISSIONS[role];

  async function save() {
    if (!name.trim()) { setError('Enter a name.'); return; }
    if (!/^\d{4}$/.test(pin)) { setError('The PIN must be exactly 4 digits.'); return; }

    const payload = {
      name: name.trim(),
      role,
      pin,
      active,
      permissions: custom ?? undefined,
    };

    if (user) {
      await updateUser(user.id, payload);
      toast('User updated', 'success');
    } else {
      await addUser(payload);
      toast('User added', 'success');
    }
    onClose();
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={user ? 'Edit user' : 'Add user'}
        size="md"
        footer={
          <div className="flex gap-2.5">
            {user && user.id !== currentUser?.id && (
              <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
            <Button variant="primary" fullWidth onClick={save}>Save</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Name" required error={error && !name.trim() ? error : undefined}>
            <Input value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Staff name" />
          </Field>

          <Field label="Role">
            <RadioGroup
              value={role}
              onChange={(v) => { setRole(v as Role); setCustom(null); }}
              options={(['owner', 'manager', 'cashier', 'kitchen'] as Role[]).map((r) => ({
                value: r,
                label: ROLE_LABELS[r],
                description: ROLE_DESCRIPTIONS[r],
              }))}
            />
          </Field>

          <Field
            label="4-digit PIN"
            required
            error={error && !/^\d{4}$/.test(pin) ? error : undefined}
            hint="Used to sign in at the counter."
          >
            <Input
              value={pin}
              inputMode="numeric"
              maxLength={4}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="1234"
              className="tnum tracking-[0.4em] text-center font-bold"
            />
          </Field>

          <div className="p-3.5 rounded-xl bg-surface-2 border border-line">
            <Toggle
              checked={active}
              onChange={setActive}
              label="Account active"
              description="Disabled accounts cannot sign in."
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-[13px] font-semibold text-ink-2">Permissions</span>
              <button
                onClick={() => setCustom(custom ? null : [...ROLE_PERMISSIONS[role]])}
                className="text-[12.5px] font-bold text-accent hover:underline"
              >
                {custom ? 'Use role defaults' : 'Customise'}
              </button>
            </div>

            <div
              className={clsx(
                'p-3 rounded-xl border',
                custom ? 'border-line bg-surface-2' : 'border-line bg-surface-2/50 opacity-70',
              )}
            >
              {role === 'owner' && (
                <p className="text-[12.5px] text-ink-3 mb-2">
                  An owner always has full access — these cannot be reduced.
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                {ALL_PERMISSIONS.map((p) => (
                  <Checkbox
                    key={p}
                    checked={effective.includes(p)}
                    disabled={!custom || role === 'owner'}
                    onChange={(v) =>
                      setCustom((cur) => {
                        const base = cur ?? [...ROLE_PERMISSIONS[role]];
                        return v ? [...new Set([...base, p])] : base.filter((x) => x !== p);
                      })
                    }
                    label={PERMISSION_LABELS[p]}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this user?"
        message={<>{user?.name} will no longer be able to sign in. Past bills keep their name.</>}
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (user) {
            try {
              await deleteUser(user.id);
              toast('User deleted', 'success');
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Could not delete', 'danger');
            }
          }
          setConfirmDelete(false);
          onClose();
        }}
      />
    </>
  );
}

/* ---------------- Notifications (Plan §26) ---------------- */

function NotificationsSection() {
  const notifications = useAppStore((s) => s.settings.notifications);
  const reports = useAppStore((s) => s.settings.reports);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const set = <K extends keyof typeof notifications>(k: K, v: boolean) =>
    void updateSettings({ notifications: { ...notifications, [k]: v } });

  const setReport = <K extends keyof typeof reports>(k: K, v: number) =>
    void updateSettings({ reports: { ...reports, [k]: v } });

  return (
    <>
      <Card>
        <SectionTitle title="Notifications" subtitle="What the bell icon tells you about" />
        <div className="space-y-1 divide-y divide-line">
          <ToggleRow label="Daily sales summary" checked={notifications.dailySalesSummary} onChange={(v) => set('dailySalesSummary', v)} />
          <ToggleRow label="Low-selling product alert" checked={notifications.lowSellingAlert} onChange={(v) => set('lowSellingAlert', v)} />
          <ToggleRow label="High discount alert" checked={notifications.highDiscountAlert} onChange={(v) => set('highDiscountAlert', v)} />
          <ToggleRow label="Refund alert" checked={notifications.refundAlert} onChange={(v) => set('refundAlert', v)} />
          <ToggleRow label="Failed payment alert" checked={notifications.failedPaymentAlert} onChange={(v) => set('failedPaymentAlert', v)} />
          <ToggleRow label="Daily closing reminder" checked={notifications.dailyClosingReminder} onChange={(v) => set('dailyClosingReminder', v)} />
          <ToggleRow label="Sound for new online orders" checked={notifications.onlineOrderAlert} onChange={(v) => set('onlineOrderAlert', v)} />
        </div>
      </Card>

      <Card>
        <SectionTitle title="Report preferences" subtitle="Thresholds used across the dashboard" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Low-selling threshold" hint="Units sold at or below this are flagged for review.">
            <Input
              type="number"
              min={1}
              value={reports.lowSellingThreshold}
              onChange={(e) => setReport('lowSellingThreshold', Number(e.target.value) || 1)}
              className="tnum"
            />
          </Field>
          <Field label="Top products shown">
            <Input
              type="number"
              min={3}
              max={20}
              value={reports.topProductCount}
              onChange={(e) => setReport('topProductCount', Number(e.target.value) || 5)}
              className="tnum"
            />
          </Field>
          <Field label="Daily sales target">
            <MoneyInput
              value={reports.dailySalesTarget}
              onChange={(e) => setReport('dailySalesTarget', Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Monthly sales target">
            <MoneyInput
              value={reports.monthlySalesTarget}
              onChange={(e) => setReport('monthlySalesTarget', Number(e.target.value) || 0)}
            />
          </Field>
        </div>
      </Card>
    </>
  );
}

/* ---------------- System / backup ---------------- */

function SystemSection() {
  const bills = useAppStore((s) => s.bills);
  const products = useAppStore((s) => s.products);
  const settings = useAppStore((s) => s.settings);
  const reload = useAppStore((s) => s.reload);
  const logout = useAppStore((s) => s.logout);

  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);

  const pending = bills.filter((b) => b.synced === 0).length;

  async function doExport() {
    setBusy(true);
    try {
      const payload = await exportBackup();
      downloadJson(`thangai-backup-${now().slice(0, 10)}.json`, payload);
      toast('Backup downloaded', 'success');
    } finally {
      setBusy(false);
    }
  }

  async function doImport(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      await importBackup(JSON.parse(text));
      await reload();
      toast('Backup restored', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That file is not a valid backup', 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <SectionTitle title="Data & Backup" subtitle="Everything is stored on this device" />

        <div className="grid grid-cols-3 gap-3 mb-5">
          <Stat label="Bills" value={String(bills.length)} />
          <Stat label="Products" value={String(products.length)} />
          <Stat label="Pending sync" value={String(pending)} tone={pending ? 'warning' : undefined} />
        </div>

        <div className="space-y-2.5">
          <ActionRow
            icon={<Download size={17} />}
            title="Download a backup"
            description="A single JSON file with products, bills, users and settings."
            action={<Button variant="outline" loading={busy} onClick={doExport}>Export</Button>}
          />
          <ActionRow
            icon={<Upload size={17} />}
            title="Restore from a backup"
            description="Replaces everything currently on this device."
            action={
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void doImport(f);
                    e.target.value = '';
                  }}
                />
                <Button variant="outline" loading={busy} onClick={() => fileRef.current?.click()}>
                  Restore
                </Button>
              </>
            }
          />
          <ActionRow
            icon={<Receipt size={17} />}
            title="Export all bills as CSV"
            description="Opens in Excel or Google Sheets."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  downloadCsv(`all-bills-${now().slice(0, 10)}.csv`, exportBillsCsv(bills, settings));
                  toast('CSV downloaded', 'success');
                }}
              >
                Export
              </Button>
            }
          />
        </div>
      </Card>

      <PhotoCreditsCard />

      <Card>
        <SectionTitle title="Danger zone" icon={<Shield size={17} className="text-danger" />} />
        <ActionRow
          icon={<Trash2 size={17} />}
          title="Reset this device"
          description="Deletes every bill, product and setting, then reloads with fresh demo data."
          danger
          action={<Button variant="danger" onClick={() => setConfirmReset(true)}>Reset</Button>}
        />
      </Card>

      <ConfirmDialog
        open={confirmReset}
        title="Erase everything?"
        message={
          <>
            All {bills.length} bills and {products.length} products on this device will be
            permanently deleted. Download a backup first if you might need this data.
          </>
        }
        confirmLabel="Erase everything"
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          await resetDatabase();
          await logout();
          window.location.reload();
        }}
      />
    </>
  );
}

/* ---------------- Photo credits ---------------- */

/** The bundled product photographs are Creative Commons; CC BY and CC BY-SA
    require attribution, so the credits ship with the app rather than living in
    a file nobody sees. */
function PhotoCreditsCard() {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(PHOTO_CREDITS);

  return (
    <Card>
      <SectionTitle
        title="Photo credits"
        subtitle={`${entries.length} product photographs from Wikimedia Commons and Unsplash`}
        icon={<Info size={17} className="text-info" />}
        action={
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            View
          </Button>
        }
      />
      <p className="text-[13px] text-ink-2 leading-relaxed">
        Product images are used under Creative Commons and Unsplash licences.
        Replace any of them with your own photograph in Products → Edit.
      </p>

      <Modal open={open} onClose={() => setOpen(false)} title="Photo credits" size="lg">
        <p className="text-[13px] text-ink-2 leading-relaxed mb-4">
          Photographs are from Wikimedia Commons and Unsplash. CC BY and CC BY-SA
          images require attribution and are credited below; if you redistribute
          this app, keep this list intact.
        </p>
        <ul className="divide-y divide-line">
          {entries.map(([product, credit]) => (
            <li key={product} className="flex items-start justify-between gap-4 py-2.5">
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-ink">{product}</span>
                <span className="block text-[12px] text-ink-3 break-words">{credit.title}</span>
              </span>
              <Badge tone="neutral" className="shrink-0">{credit.license}</Badge>
            </li>
          ))}
        </ul>
      </Modal>
    </Card>
  );
}

/* ---------------- Shared bits ---------------- */

function ToggleRow({
  label, description, checked, onChange,
}: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="py-2.5">
      <Toggle checked={checked} onChange={onChange} label={label} description={description} />
    </div>
  );
}

function ActionRow({
  icon, title, description, action, danger,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      className={clsx(
        'flex items-center gap-3.5 p-3.5 rounded-xl border',
        danger ? 'border-danger/25 bg-danger-bg/40' : 'border-line bg-surface-2',
      )}
    >
      <span
        className={clsx(
          'w-10 h-10 rounded-xl grid place-items-center shrink-0',
          danger ? 'bg-danger/10 text-danger' : 'bg-surface-3 text-ink-2',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold text-ink">{title}</p>
        <p className="text-[12.5px] text-ink-3 leading-relaxed">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

function Stat({
  label, value, tone,
}: { label: string; value: string; tone?: 'warning' }) {
  return (
    <div className="p-3 rounded-xl bg-surface-2 border border-line text-center">
      <p className={clsx('text-[20px] font-extrabold tnum', tone === 'warning' ? 'text-warning' : 'text-ink')}>
        {value}
      </p>
      <p className="text-[11.5px] font-semibold text-ink-3 mt-0.5">{label}</p>
    </div>
  );
}

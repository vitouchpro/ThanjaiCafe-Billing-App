import { useMemo, useState } from 'react';
import {
  Camera, Check, Edit3, Package, Plus, Trash2, AlertTriangle, Tag, FolderPlus,
} from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { useDebounced, usePermission } from '@/hooks';
import {
  Badge, Button, Card, Chip, ChipRow, ConfirmDialog, EmptyState, Field,
  Input, Modal, MoneyInput, SearchInput, Segmented, Select, Toggle, toast,
} from '@/components/ui';
import { ProductThumb } from '@/components/product/ProductThumb';
import { effectivePrice, marginPercent } from '@/services/billing/calc';
import { formatMoney } from '@/utils/money';
import type { Category, DiscountType, Product } from '@/types';

/* Plan §8/§9/§10 — product list, add/edit form, detail view. */

const GST_RATES = [0, 5, 12, 18, 28];

export function ProductsPage() {
  const products = useAppStore((s) => s.products);
  const categories = useAppStore((s) => s.categories);
  const toggleAvailability = useAppStore((s) => s.toggleAvailability);
  const canSeeCost = usePermission('product_cost');

  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 150);
  const [category, setCategory] = useState('all');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [detail, setDetail] = useState<Product | null>(null);
  const [showCategories, setShowCategories] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const visible = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    return products.filter((p) => {
      if (!showArchived && p.archived) return false;
      if (category !== 'all' && p.categoryId !== category) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q);
    });
  }, [products, category, debounced, showArchived]);

  const unavailableCount = products.filter((p) => !p.available && !p.archived).length;

  return (
    <div className="p-4 sm:p-5 max-w-[1400px] mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[21px] sm:text-[24px] font-extrabold text-ink">Products</h1>
          <p className="text-[13.5px] text-ink-3 mt-0.5">
            {products.filter((p) => !p.archived).length} products
            {unavailableCount > 0 && ` · ${unavailableCount} unavailable`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" icon={<Tag size={17} />} onClick={() => setShowCategories(true)}>
            Categories
          </Button>
          <Button variant="primary" icon={<Plus size={17} />} onClick={() => setEditing('new')}>
            Add Product
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder="Search products or SKU…" />
        </div>
        <Segmented
          value={showArchived ? 'all' : 'active'}
          onChange={(v) => setShowArchived(v === 'all')}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'all', label: 'Incl. archived' },
          ]}
        />
      </div>

      <ChipRow>
        <Chip active={category === 'all'} onClick={() => setCategory('all')}>All</Chip>
        {categories.map((c) => (
          <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
            {c.icon} {c.name}
          </Chip>
        ))}
      </ChipRow>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Package size={22} />}
            title={query ? 'No matching products' : 'No products in this category'}
            description={
              query
                ? `Nothing matches “${query}”.`
                : 'Add your first product to start billing.'
            }
            action={
              !query ? (
                <Button variant="primary" icon={<Plus size={17} />} onClick={() => setEditing('new')}>
                  Add Product
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          {/* Desktop table */}
          <table className="w-full hidden md:table">
            <thead>
              <tr className="border-b border-line bg-surface-2/60">
                <Th className="pl-4">Product</Th>
                <Th>Category</Th>
                <Th align="right">Price</Th>
                {canSeeCost && <Th align="right" className="pl-4">Cost</Th>}
                {canSeeCost && <Th align="right" className="pl-4">Margin</Th>}
                <Th align="center" className="pl-5">GST</Th>
                <Th align="center">Status</Th>
                <Th align="right" className="pr-4">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const cat = categories.find((c) => c.id === p.categoryId);
                const price = effectivePrice(p);
                return (
                  <tr
                    key={p.id}
                    className={clsx(
                      'border-b border-line last:border-0 hover:bg-surface-2/60 transition cursor-pointer',
                      p.archived && 'opacity-55',
                    )}
                    onClick={() => setDetail(p)}
                  >
                    <td className="py-2.5 pl-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 bg-surface-3">
                          <ProductThumb name={p.name} image={p.image} textClass="text-[13px]" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[14px] font-bold text-ink truncate">{p.name}</p>
                          <p className="text-[11.5px] text-ink-3">
                            {p.sku || '—'} · {p.unit}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="text-[13px] text-ink-2">{cat ? `${cat.icon} ${cat.name}` : '—'}</td>
                    <td className="text-right">
                      <span className="text-[14px] font-bold text-ink tnum">{formatMoney(price)}</span>
                      {price < p.sellingPrice && (
                        <span className="block text-[11px] text-ink-3 line-through tnum">
                          {formatMoney(p.sellingPrice)}
                        </span>
                      )}
                    </td>
                    {canSeeCost && (
                      <td className="text-right text-[13px] text-ink-2 tnum pl-4">{formatMoney(p.costPrice)}</td>
                    )}
                    {canSeeCost && (
                      <td className="text-right pl-4">
                        <span className="text-[13px] font-semibold text-success tnum">
                          {formatMoney(price - p.costPrice)}
                        </span>
                        <span className="block text-[11px] text-ink-3 tnum">
                          {marginPercent(price, p.costPrice).toFixed(0)}%
                        </span>
                      </td>
                    )}
                    <td className="text-center text-[13px] text-ink-2 tnum pl-5">{p.taxRate}%</td>
                    <td className="text-center">
                      {p.archived ? (
                        <Badge tone="neutral">Archived</Badge>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); void toggleAvailability(p.id); }}
                          className="inline-flex"
                          aria-label={p.available ? 'Mark unavailable' : 'Mark available'}
                        >
                          <Badge tone={p.available ? 'success' : 'danger'} dot>
                            {p.available ? 'Available' : 'Out'}
                          </Badge>
                        </button>
                      )}
                    </td>
                    <td className="text-right pr-4">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditing(p); }}
                        className="p-2 rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink transition"
                        aria-label={`Edit ${p.name}`}
                      >
                        <Edit3 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Mobile list */}
          <ul className="md:hidden divide-y divide-line">
            {visible.map((p) => {
              const price = effectivePrice(p);
              return (
                <li key={p.id}>
                  <button
                    onClick={() => setDetail(p)}
                    className={clsx('w-full flex items-center gap-3 p-3 text-left', p.archived && 'opacity-55')}
                  >
                    <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-surface-3">
                      <ProductThumb name={p.name} image={p.image} textClass="text-[14px]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-bold text-ink truncate">{p.name}</p>
                      <p className="text-[12px] text-ink-3 tnum">
                        {formatMoney(price)} · GST {p.taxRate}%
                      </p>
                    </div>
                    <Badge tone={p.archived ? 'neutral' : p.available ? 'success' : 'danger'} dot>
                      {p.archived ? 'Archived' : p.available ? 'On' : 'Out'}
                    </Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <ProductFormModal
        product={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />

      <ProductDetailModal
        product={detail}
        onClose={() => setDetail(null)}
        onEdit={(p) => { setDetail(null); setEditing(p); }}
      />

      <CategoriesModal open={showCategories} onClose={() => setShowCategories(false)} />
    </div>
  );
}

function Th({
  children, align = 'left', className,
}: { children: React.ReactNode; align?: 'left' | 'right' | 'center'; className?: string }) {
  return (
    <th
      className={clsx(
        'py-2.5 text-[11px] font-extrabold text-ink-3 uppercase tracking-wider',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

/* ---------------- Add / edit form (Plan §8) ---------------- */

interface FormState {
  name: string;
  sku: string;
  categoryId: string;
  image: string;
  sellingPrice: string;
  costPrice: string;
  discount: string;
  discountType: DiscountType;
  taxRate: number;
  available: boolean;
  unit: string;
}

const emptyForm = (categoryId: string, unit: string, taxRate: number): FormState => ({
  name: '', sku: '', categoryId, image: '',
  sellingPrice: '', costPrice: '', discount: '', discountType: 'percent',
  taxRate, available: true, unit,
});

function ProductFormModal({
  product, open, onClose,
}: { product: Product | null; open: boolean; onClose: () => void }) {
  const categories = useAppStore((s) => s.categories);
  const settings = useAppStore((s) => s.settings);
  const addProduct = useAppStore((s) => s.addProduct);
  const updateProduct = useAppStore((s) => s.updateProduct);
  const deleteProduct = useAppStore((s) => s.deleteProduct);

  const [form, setForm] = useState<FormState>(() =>
    emptyForm(categories[0]?.id ?? '', settings.units[0] ?? 'pcs', settings.billing.defaultTaxRate),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [key, setKey] = useState<string>('');

  // Reseed the form when a different product (or "new") is opened.
  const openKey = product?.id ?? (open ? 'new' : '');
  if (open && key !== openKey) {
    setKey(openKey);
    setErrors({});
    setForm(
      product
        ? {
            name: product.name,
            sku: product.sku ?? '',
            categoryId: product.categoryId,
            image: product.image ?? '',
            sellingPrice: String(product.sellingPrice),
            costPrice: String(product.costPrice),
            discount: product.discount ? String(product.discount) : '',
            discountType: product.discountType,
            taxRate: product.taxRate,
            available: product.available,
            unit: product.unit,
          }
        : emptyForm(categories[0]?.id ?? '', settings.units[0] ?? 'pcs', settings.billing.defaultTaxRate),
    );
  }
  if (!open && key) setKey('');

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const sellingPrice = Number(form.sellingPrice) || 0;
  const costPrice = Number(form.costPrice) || 0;
  const discount = Number(form.discount) || 0;
  const effective = effectivePrice({ sellingPrice, discount, discountType: form.discountType });
  const margin = effective - costPrice;

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Give the product a name.';
    if (!form.categoryId) e.categoryId = 'Pick a category.';
    if (!form.sellingPrice || sellingPrice <= 0) e.sellingPrice = 'Selling price must be above zero.';
    if (costPrice < 0) e.costPrice = 'Cost cannot be negative.';
    if (form.discountType === 'percent' && discount > 100) e.discount = 'A percentage discount cannot exceed 100%.';
    if (form.discountType === 'fixed' && discount > sellingPrice) e.discount = 'Discount is larger than the price.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;

    const payload = {
      name: form.name.trim(),
      sku: form.sku.trim() || undefined,
      categoryId: form.categoryId,
      image: form.image || undefined,
      sellingPrice,
      costPrice,
      discount,
      discountType: form.discountType,
      taxRate: form.taxRate,
      available: form.available,
      unit: form.unit,
    };

    if (product) {
      await updateProduct(product.id, payload);
      toast('Product updated', 'success');
    } else {
      await addProduct(payload);
      toast('Product added', 'success');
    }
    onClose();
  }

  async function pickImage(file: File) {
    if (file.size > 3 * 1024 * 1024) {
      toast('Image is too large — keep it under 3 MB', 'danger');
      return;
    }
    const dataUrl = await downscaleImage(file, 640);
    set('image', dataUrl);
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={product ? 'Edit product' : 'Add product'}
        size="lg"
        footer={
          <div className="flex gap-2.5">
            {product && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)} icon={<Trash2 size={16} />}>
                Delete
              </Button>
            )}
            <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
            <Button variant="primary" fullWidth onClick={save}>
              {product ? 'Save changes' : 'Save product'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Image */}
          <div className="flex items-center gap-4">
            <div className="w-24 h-24 rounded-2xl overflow-hidden bg-surface-3 border border-line shrink-0">
              <ProductThumb name={form.name || 'New product'} image={form.image} textClass="text-[24px]" />
            </div>
            <div className="min-w-0 flex-1">
              <label className="inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-surface-3 text-ink font-semibold text-sm cursor-pointer hover:bg-line transition">
                <Camera size={17} />
                {form.image ? 'Change image' : 'Choose image'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void pickImage(f);
                    e.target.value = '';
                  }}
                />
              </label>
              {form.image && (
                <button
                  onClick={() => set('image', '')}
                  className="ml-2 text-[13px] font-semibold text-danger hover:underline"
                >
                  Remove
                </button>
              )}
              <p className="text-[12px] text-ink-3 mt-2 leading-relaxed">
                Optional. Without one, the card shows a coloured tile with the product initials.
              </p>
            </div>
          </div>

          <Field label="Product name" required error={errors.name}>
            <Input
              value={form.name}
              autoFocus
              onChange={(e) => set('name', e.target.value)}
              placeholder="Filter Coffee"
              invalid={!!errors.name}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Category" required error={errors.categoryId}>
              <Select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </Select>
            </Field>

            <Field label="Unit">
              <Select value={form.unit} onChange={(e) => set('unit', e.target.value)}>
                {settings.units.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Selling price" required error={errors.sellingPrice}>
              <MoneyInput
                value={form.sellingPrice}
                onChange={(e) => set('sellingPrice', e.target.value)}
                placeholder="25"
                currency={settings.business.currency}
              />
            </Field>

            <Field label="Cost price" hint="Used for margin reporting." error={errors.costPrice}>
              <MoneyInput
                value={form.costPrice}
                onChange={(e) => set('costPrice', e.target.value)}
                placeholder="9.80"
                currency={settings.business.currency}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Discount" error={errors.discount}>
              {form.discountType === 'percent' ? (
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.discount}
                  onChange={(e) => set('discount', e.target.value)}
                  placeholder="0"
                  className="tnum"
                  invalid={!!errors.discount}
                />
              ) : (
                <MoneyInput
                  value={form.discount}
                  onChange={(e) => set('discount', e.target.value)}
                  placeholder="0"
                  currency={settings.business.currency}
                />
              )}
            </Field>

            <Field label="Discount type">
              <Segmented
                fullWidth
                value={form.discountType}
                onChange={(v) => set('discountType', v)}
                options={[
                  { value: 'percent', label: 'Percentage' },
                  { value: 'fixed', label: 'Fixed' },
                ]}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="GST rate">
              <Select value={form.taxRate} onChange={(e) => set('taxRate', Number(e.target.value))}>
                {GST_RATES.map((r) => (
                  <option key={r} value={r}>{r}%</option>
                ))}
              </Select>
            </Field>

            <Field label="SKU" hint="Optional.">
              <Input value={form.sku} onChange={(e) => set('sku', e.target.value)} placeholder="SKU0001" />
            </Field>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-2 border border-line">
            <Toggle
              checked={form.available}
              onChange={(v) => set('available', v)}
              label="Available for sale"
              description="Unavailable products stay visible on the POS but cannot be added to a bill."
            />
          </div>

          {sellingPrice > 0 && (
            <div className="p-3.5 rounded-xl bg-accent-50 border border-accent/20 grid grid-cols-3 gap-3">
              <Summary label="Sells at" value={formatMoney(effective, settings.business.currency)} />
              <Summary label="Cost" value={formatMoney(costPrice, settings.business.currency)} />
              <Summary
                label="Margin"
                value={`${formatMoney(margin, settings.business.currency)} · ${marginPercent(effective, costPrice).toFixed(0)}%`}
                tone={margin < 0 ? 'danger' : 'success'}
              />
            </div>
          )}

          {margin < 0 && sellingPrice > 0 && (
            <p className="flex items-start gap-2 text-[13px] text-danger font-medium">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              This product sells below cost. Check the prices before saving.
            </p>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this product?"
        message={
          <>
            <b>{product?.name}</b> will be removed from the POS. If it appears on past bills it is
            archived instead of deleted, so your reports stay accurate.
          </>
        }
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (product) {
            await deleteProduct(product.id);
            toast('Product removed', 'success');
          }
          setConfirmDelete(false);
          onClose();
        }}
      />
    </>
  );
}

function Summary({
  label, value, tone,
}: { label: string; value: string; tone?: 'success' | 'danger' }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-ink-3 uppercase tracking-wider">{label}</p>
      <p
        className={clsx(
          'text-[14px] font-extrabold tnum mt-0.5',
          tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-ink',
        )}
      >
        {value}
      </p>
    </div>
  );
}

/** Downscale to keep IndexedDB small — a 4 MB phone photo becomes ~60 KB. */
function downscaleImage(file: File, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode the image'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas unavailable'));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------------- Detail (Plan §10) ---------------- */

function ProductDetailModal({
  product, onClose, onEdit,
}: { product: Product | null; onClose: () => void; onEdit: (p: Product) => void }) {
  const categories = useAppStore((s) => s.categories);
  const toggleAvailability = useAppStore((s) => s.toggleAvailability);
  const canSeeCost = usePermission('product_cost');

  if (!product) return null;

  const cat = categories.find((c) => c.id === product.categoryId);
  const price = effectivePrice(product);

  return (
    <Modal
      open
      onClose={onClose}
      title={product.name}
      size="md"
      footer={
        <div className="flex gap-2.5">
          <Button
            variant={product.available ? 'secondary' : 'success'}
            fullWidth
            onClick={async () => { await toggleAvailability(product.id); onClose(); }}
          >
            {product.available ? 'Mark unavailable' : 'Mark available'}
          </Button>
          <Button variant="primary" fullWidth icon={<Edit3 size={16} />} onClick={() => onEdit(product)}>
            Edit
          </Button>
        </div>
      }
    >
      <div className="flex gap-4 mb-5">
        <div className="w-28 h-28 rounded-2xl overflow-hidden bg-surface-3 shrink-0 border border-line">
          <ProductThumb name={product.name} image={product.image} textClass="text-[28px]" />
        </div>
        <div className="min-w-0">
          <p className="text-[26px] font-extrabold text-ink tnum leading-none">{formatMoney(price)}</p>
          {price < product.sellingPrice && (
            <p className="text-[14px] text-ink-3 line-through tnum mt-0.5">
              {formatMoney(product.sellingPrice)}
            </p>
          )}
          <div className="mt-2.5">
            <Badge tone={product.archived ? 'neutral' : product.available ? 'success' : 'danger'} dot>
              {product.archived ? 'Archived' : product.available ? 'Available' : 'Unavailable'}
            </Badge>
          </div>
        </div>
      </div>

      <dl className="divide-y divide-line">
        <DetailRow label="Category" value={cat ? `${cat.icon} ${cat.name}` : '—'} />
        <DetailRow label="Unit" value={product.unit} />
        <DetailRow label="SKU" value={product.sku || '—'} />
        <DetailRow label="GST" value={`${product.taxRate}%`} />
        <DetailRow
          label="Discount"
          value={
            product.discount
              ? product.discountType === 'percent'
                ? `${product.discount}%`
                : formatMoney(product.discount)
              : 'None'
          }
        />
        {canSeeCost && <DetailRow label="Cost" value={formatMoney(product.costPrice)} />}
        {canSeeCost && (
          <DetailRow
            label="Margin"
            value={`${formatMoney(price - product.costPrice)} · ${marginPercent(price, product.costPrice).toFixed(0)}%`}
            tone={price - product.costPrice < 0 ? 'danger' : 'success'}
          />
        )}
      </dl>
    </Modal>
  );
}

function DetailRow({
  label, value, tone,
}: { label: string; value: string; tone?: 'success' | 'danger' }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-[13.5px] text-ink-2">{label}</dt>
      <dd
        className={clsx(
          'text-[14px] font-bold tnum',
          tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-ink',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/* ---------------- Categories ---------------- */

const ICON_CHOICES = ['☕', '🍵', '🍘', '🍛', '🍮', '🌾', '🥤', '🍞', '🧁', '🥗', '🍜', '🫖'];

function CategoriesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const categories = useAppStore((s) => s.categories);
  const products = useAppStore((s) => s.products);
  const addCategory = useAppStore((s) => s.addCategory);
  const updateCategory = useAppStore((s) => s.updateCategory);
  const deleteCategory = useAppStore((s) => s.deleteCategory);

  const [name, setName] = useState('');
  const [icon, setIcon] = useState(ICON_CHOICES[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  async function add() {
    if (!name.trim()) return;
    await addCategory({
      name: name.trim(),
      icon,
      sortOrder: (categories.at(-1)?.sortOrder ?? 0) + 1,
    });
    setName('');
    toast('Category added', 'success');
  }

  async function remove(c: Category) {
    try {
      await deleteCategory(c.id);
      toast('Category removed', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not remove the category', 'danger');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Categories" size="md">
      <div className="space-y-2 mb-5">
        {categories.map((c) => {
          const count = products.filter((p) => p.categoryId === c.id && !p.archived).length;
          const isEditing = editingId === c.id;

          return (
            <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl border border-line bg-surface-2">
              <span className="text-lg shrink-0">{c.icon}</span>
              {isEditing ? (
                <Input
                  value={editName}
                  autoFocus
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && editName.trim()) {
                      await updateCategory(c.id, { name: editName.trim() });
                      setEditingId(null);
                    }
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="h-9 flex-1"
                />
              ) : (
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold text-ink truncate">{c.name}</p>
                  <p className="text-[12px] text-ink-3">{count} product{count === 1 ? '' : 's'}</p>
                </div>
              )}

              {isEditing ? (
                <button
                  onClick={async () => {
                    if (editName.trim()) await updateCategory(c.id, { name: editName.trim() });
                    setEditingId(null);
                  }}
                  className="p-2 rounded-lg text-success hover:bg-success-bg"
                  aria-label="Save"
                >
                  <Check size={16} />
                </button>
              ) : (
                <button
                  onClick={() => { setEditingId(c.id); setEditName(c.name); }}
                  className="p-2 rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink"
                  aria-label={`Rename ${c.name}`}
                >
                  <Edit3 size={15} />
                </button>
              )}

              <button
                onClick={() => void remove(c)}
                disabled={count > 0}
                className="p-2 rounded-lg text-ink-3 hover:bg-danger-bg hover:text-danger disabled:opacity-30 disabled:pointer-events-none"
                aria-label={`Delete ${c.name}`}
                title={count > 0 ? 'Move its products first' : undefined}
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="pt-4 border-t border-line">
        <p className="text-[13px] font-bold text-ink-2 mb-3">Add a category</p>
        <div className="flex gap-2 mb-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Category name"
            onKeyDown={(e) => e.key === 'Enter' && void add()}
            className="flex-1"
          />
          <Button variant="primary" icon={<FolderPlus size={16} />} onClick={add} disabled={!name.trim()}>
            Add
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ICON_CHOICES.map((i) => (
            <button
              key={i}
              onClick={() => setIcon(i)}
              className={clsx(
                'w-10 h-10 rounded-xl text-lg grid place-items-center border transition',
                icon === i ? 'border-accent bg-accent-50 ring-1 ring-accent/25' : 'border-line bg-surface-2 hover:border-line-strong',
              )}
            >
              {i}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

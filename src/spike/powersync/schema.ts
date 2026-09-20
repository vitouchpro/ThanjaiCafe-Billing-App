import { column, Schema, Table } from '@powersync/web';

const shops = new Table({ name: column.text });

const devices = new Table({
  shop_id: column.text, auth_user_id: column.text, code: column.text, revoked_at: column.text,
});

const products = new Table({
  shop_id: column.text, name: column.text, unit: column.text,
  price_paise: column.integer, rev: column.integer, updated_at: column.text,
});

const billColumns = {
  shop_id: column.text, device_id: column.text, invoice_no: column.text, fy: column.text,
  seq: column.integer, business_date: column.text, payment_method: column.text,
  total_paise: column.integer, created_at: column.text,
};

const bills = new Table(billColumns, {
  indexes: {
    by_created: ['created_at'],
    by_date: ['business_date'],
    by_device_seq: ['device_id', 'fy', 'seq'],
    by_invoice: ['invoice_no'],
  },
});

const bill_lines = new Table({
  bill_id: column.text, shop_id: column.text, product_id: column.text, name: column.text,
  qty: column.real, unit: column.text, unit_price_paise: column.integer, line_total_paise: column.integer,
}, { indexes: { by_bill: ['bill_id'] } });

// Local-only: never synced or uploaded. Used to measure query speed at scale (Task 14).
const bills_perf = new Table(billColumns, {
  localOnly: true,
  indexes: { by_created: ['created_at'], by_date: ['business_date'], by_invoice: ['invoice_no'] },
});

export const SpikeSchema = new Schema({ shops, devices, products, bills, bill_lines, bills_perf });

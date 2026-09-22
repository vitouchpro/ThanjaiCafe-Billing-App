-- Adds the missing FK found in the final whole-branch review. products
-- uses soft-delete (deleted_at), so this FK never blocks a real delete.
alter table public.bill_lines
  drop constraint if exists bill_lines_product_id_fkey;
alter table public.bill_lines
  add constraint bill_lines_product_id_fkey foreign key (product_id) references public.products(id);

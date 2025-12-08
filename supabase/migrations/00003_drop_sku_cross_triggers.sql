-- Drop cross-table SKU collision enforcement
-- We keep per-table uniqueness:
--   - products.sku_label unique
--   - product_variants.sku unique
--   - media_buckets.sku_label unique

-- Drop triggers and functions that blocked products.sku_label <-> product_variants.sku collisions
DROP TRIGGER IF EXISTS trg_check_product_sku_label ON public.products;
DROP TRIGGER IF EXISTS trg_check_variant_sku ON public.product_variants;

DROP FUNCTION IF EXISTS public.check_product_sku_label_uniqueness();
DROP FUNCTION IF EXISTS public.check_variant_sku_uniqueness();

-- No changes to unique indexes; constraints remain per-table.


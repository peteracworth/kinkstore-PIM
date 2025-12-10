-- Enforce: For single-variant products, products.sku_label must equal the sole variant's sku.

-- Drop if exists
DROP TRIGGER IF EXISTS trg_check_single_variant_sku ON public.product_variants;
DROP TRIGGER IF EXISTS trg_check_single_variant_sku_product ON public.products;
DROP FUNCTION IF EXISTS public.check_single_variant_sku_match();

CREATE OR REPLACE FUNCTION public.check_single_variant_sku_match()
RETURNS TRIGGER AS $$
DECLARE
  v_product_id uuid;
  v_sku_label varchar;
  v_variant_count int;
  v_only_variant_sku varchar;
BEGIN
  -- Determine product_id and current variant sku
  IF TG_TABLE_NAME = 'product_variants' THEN
    v_product_id := NEW.product_id;
  ELSIF TG_TABLE_NAME = 'products' THEN
    v_product_id := NEW.id;
  END IF;

  -- Fetch product sku_label
  SELECT sku_label INTO v_sku_label FROM public.products WHERE id = v_product_id;

  -- Count variants for the product
  SELECT COUNT(*) INTO v_variant_count FROM public.product_variants WHERE product_id = v_product_id;

  IF v_variant_count = 1 THEN
    -- Get the sole variant's sku (including the row being inserted/updated)
    SELECT sku INTO v_only_variant_sku
    FROM public.product_variants
    WHERE product_id = v_product_id
    LIMIT 1;

    -- If this trigger is on product_variants, ensure we use NEW.sku when applicable
    IF TG_TABLE_NAME = 'product_variants' THEN
      v_only_variant_sku := COALESCE(NEW.sku, v_only_variant_sku);
    END IF;

    IF v_sku_label IS NOT NULL AND v_only_variant_sku IS NOT NULL AND v_sku_label <> v_only_variant_sku THEN
      RAISE EXCEPTION 'Single-variant product must have sku_label equal to its variant sku. product_id=%, sku_label=%, variant_sku=%',
        v_product_id, v_sku_label, v_only_variant_sku;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on product_variants insert/update
CREATE TRIGGER trg_check_single_variant_sku
  AFTER INSERT OR UPDATE ON public.product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.check_single_variant_sku_match();

-- Trigger on products sku_label update
CREATE TRIGGER trg_check_single_variant_sku_product
  AFTER INSERT OR UPDATE OF sku_label ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.check_single_variant_sku_match();


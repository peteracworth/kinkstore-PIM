-- Fix: SKU collision triggers fail on UPSERT because NEW.id is a fresh UUID
-- before the conflict is detected. We must look up the existing product by
-- shopify_product_id and exclude its variants.

-- Drop existing triggers and functions
DROP TRIGGER IF EXISTS trg_check_variant_sku_not_other_product ON public.product_variants;
DROP TRIGGER IF EXISTS trg_check_product_sku_not_other_variant ON public.products;
DROP FUNCTION IF EXISTS public.check_variant_sku_not_other_product();
DROP FUNCTION IF EXISTS public.check_product_sku_not_other_variant();

-- Recreate: Block variant SKU from colliding with another product's sku_label
CREATE OR REPLACE FUNCTION public.check_variant_sku_not_other_product()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sku IS NULL THEN
    RETURN NEW;
  END IF;

  -- Block variant SKU colliding with another product's sku_label
  -- Exclude the product this variant belongs to
  IF EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.sku_label = NEW.sku
      AND p.id <> NEW.product_id
  ) THEN
    RAISE EXCEPTION 'Variant SKU "%" conflicts with another product sku_label', NEW.sku;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_variant_sku_not_other_product
  BEFORE INSERT OR UPDATE OF sku ON public.product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.check_variant_sku_not_other_product();


-- Recreate: Block product sku_label from colliding with another product's variant SKU
-- Key fix: On UPSERT, NEW.id might be a fresh UUID. We must find the actual
-- existing product (if any) by shopify_product_id and exclude its variants.
CREATE OR REPLACE FUNCTION public.check_product_sku_not_other_variant()
RETURNS TRIGGER AS $$
DECLARE
  v_existing_product_id uuid;
BEGIN
  IF NEW.sku_label IS NULL THEN
    RETURN NEW;
  END IF;

  -- For UPSERT: find existing product by shopify_product_id
  -- If this is an update to existing product, use that ID for exclusion
  SELECT id INTO v_existing_product_id
  FROM public.products
  WHERE shopify_product_id = NEW.shopify_product_id;

  -- Use existing product ID if found, otherwise use NEW.id
  v_existing_product_id := COALESCE(v_existing_product_id, NEW.id);

  -- Block product sku_label colliding with another product's variant SKU
  IF EXISTS (
    SELECT 1
    FROM public.product_variants v
    WHERE v.sku = NEW.sku_label
      AND v.product_id <> v_existing_product_id
  ) THEN
    RAISE EXCEPTION 'Product sku_label "%" conflicts with another product''s variant SKU', NEW.sku_label;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_product_sku_not_other_variant
  BEFORE INSERT OR UPDATE OF sku_label ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.check_product_sku_not_other_variant();


-- Enforce: a variant SKU cannot equal another product's sku_label.
-- Allow: single-variant products where sku_label == that product's sole variant.sku.

-- Drop prior versions if they exist
DROP TRIGGER IF EXISTS trg_check_variant_sku_not_other_product ON public.product_variants;
DROP TRIGGER IF EXISTS trg_check_product_sku_not_other_variant ON public.products;
DROP FUNCTION IF EXISTS public.check_variant_sku_not_other_product();
DROP FUNCTION IF EXISTS public.check_product_sku_not_other_variant();

CREATE OR REPLACE FUNCTION public.check_variant_sku_not_other_product()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sku IS NULL THEN
    RETURN NEW;
  END IF;

  -- Block variant SKU colliding with another product's sku_label
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


CREATE OR REPLACE FUNCTION public.check_product_sku_not_other_variant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sku_label IS NULL THEN
    RETURN NEW;
  END IF;

  -- Block product sku_label colliding with another product's variant SKU
  IF EXISTS (
    SELECT 1
    FROM public.product_variants v
    WHERE v.sku = NEW.sku_label
      AND v.product_id <> NEW.id
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


-- Add variant linkage and hero flag to product_images_unassociated

ALTER TABLE public.product_images_unassociated
  ADD COLUMN IF NOT EXISTS shopify_variant_id bigint,
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_variant_hero boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_piu_variant_id ON public.product_images_unassociated(variant_id);
CREATE INDEX IF NOT EXISTS idx_piu_shopify_variant_id ON public.product_images_unassociated(shopify_variant_id);


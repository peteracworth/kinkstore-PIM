-- Staging table for Shopify-published images that are not yet associated in PIM.
-- Keeps Storj/media_assets clean until after Google Drive migration.

create table if not exists public.product_images_unassociated (
    id uuid primary key default gen_random_uuid(),
    shopify_media_id varchar(255) not null,
    shopify_product_id bigint,
    product_id uuid references public.products(id) on delete cascade,
    source_url varchar(1000),
    filename varchar(500),
    alt_text text,
    mime_type varchar(100),
    byte_size bigint,
    width int,
    height int,
    position int,
    shopify_created_at timestamp with time zone,
    shopify_updated_at timestamp with time zone,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    unique(shopify_media_id)
);

create index if not exists idx_piu_product_id on public.product_images_unassociated(product_id);
create index if not exists idx_piu_shopify_product_id on public.product_images_unassociated(shopify_product_id);

comment on table public.product_images_unassociated is 'Staging for Shopify-published images not yet associated in PIM. Kept separate from media_assets/Storj.';
comment on column public.product_images_unassociated.shopify_media_id is 'Shopify MediaImage GID (unique).';
comment on column public.product_images_unassociated.source_url is 'Original Shopify CDN URL.';
comment on column public.product_images_unassociated.position is 'Gallery order from Shopify.';


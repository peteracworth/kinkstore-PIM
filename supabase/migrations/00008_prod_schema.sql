--
-- PostgreSQL database dump
--

\restrict viQ4aOoAz9Mk0NE1PAPafnMgXg75doWQco95KeLOHLQ4yNbfX1Dk0cNB8AdHxiw

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.7 (Debian 17.7-3.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: check_product_sku_not_other_variant(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_product_sku_not_other_variant() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_existing_product_id uuid;
BEGIN
  IF NEW.sku_label IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- For UPSERT: find existing product by shopify_product_id
  SELECT id INTO v_existing_product_id FROM public.products
  WHERE shopify_product_id = NEW.shopify_product_id;
  
  -- Use existing product ID if found, otherwise use NEW.id
  v_existing_product_id := COALESCE(v_existing_product_id, NEW.id);
  
  IF EXISTS (
    SELECT 1 FROM public.product_variants v
    WHERE v.sku = NEW.sku_label AND v.product_id <> v_existing_product_id
  ) THEN
    RAISE EXCEPTION 'Product sku_label "%" conflicts with another product''s variant SKU', NEW.sku_label;
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: check_single_variant_sku_match(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_single_variant_sku_match() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_product_id uuid;
  v_sku_label varchar;
  v_variant_count int;
  v_only_variant_sku varchar;
BEGIN
  IF TG_TABLE_NAME = 'product_variants' THEN
    v_product_id := NEW.product_id;
  ELSIF TG_TABLE_NAME = 'products' THEN
    v_product_id := NEW.id;
  END IF;

  SELECT sku_label INTO v_sku_label FROM public.products WHERE id = v_product_id;
  SELECT COUNT(*) INTO v_variant_count FROM public.product_variants WHERE product_id = v_product_id;

  IF v_variant_count = 1 THEN
    SELECT sku INTO v_only_variant_sku
    FROM public.product_variants
    WHERE product_id = v_product_id
    LIMIT 1;

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
$$;


--
-- Name: check_variant_sku_not_other_product(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_variant_sku_not_other_product() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.sku IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.sku_label = NEW.sku AND p.id <> NEW.product_id
  ) THEN
    RAISE EXCEPTION 'Variant SKU "%" conflicts with another product sku_label', NEW.sku;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: update_media_bucket_counts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_media_bucket_counts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE media_buckets SET
      total_asset_count = total_asset_count + 1,
      raw_asset_count = raw_asset_count + CASE WHEN NEW.workflow_state = 'raw' THEN 1 ELSE 0 END,
      edited_asset_count = edited_asset_count + CASE WHEN NEW.workflow_state IN ('edited', 'ready_for_publish') THEN 1 ELSE 0 END,
      published_asset_count = published_asset_count + CASE WHEN NEW.workflow_state = 'published' THEN 1 ELSE 0 END,
      project_file_count = project_file_count + CASE WHEN NEW.workflow_category = 'project_file' THEN 1 ELSE 0 END,
      total_size_bytes = total_size_bytes + COALESCE(NEW.file_size, 0),
      last_upload_at = NOW(),
      updated_at = NOW()
    WHERE id = NEW.media_bucket_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE media_buckets SET
      raw_asset_count = raw_asset_count
        - CASE WHEN OLD.workflow_state = 'raw' THEN 1 ELSE 0 END
        + CASE WHEN NEW.workflow_state = 'raw' THEN 1 ELSE 0 END,
      edited_asset_count = edited_asset_count
        - CASE WHEN OLD.workflow_state IN ('edited', 'ready_for_publish') THEN 1 ELSE 0 END
        + CASE WHEN NEW.workflow_state IN ('edited', 'ready_for_publish') THEN 1 ELSE 0 END,
      published_asset_count = published_asset_count
        - CASE WHEN OLD.workflow_state = 'published' THEN 1 ELSE 0 END
        + CASE WHEN NEW.workflow_state = 'published' THEN 1 ELSE 0 END,
      total_size_bytes = total_size_bytes - COALESCE(OLD.file_size, 0) + COALESCE(NEW.file_size, 0),
      updated_at = NOW()
    WHERE id = NEW.media_bucket_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE media_buckets SET
      total_asset_count = GREATEST(total_asset_count - 1, 0),
      raw_asset_count = GREATEST(raw_asset_count - CASE WHEN OLD.workflow_state = 'raw' THEN 1 ELSE 0 END, 0),
      edited_asset_count = GREATEST(edited_asset_count - CASE WHEN OLD.workflow_state IN ('edited', 'ready_for_publish') THEN 1 ELSE 0 END, 0),
      published_asset_count = GREATEST(published_asset_count - CASE WHEN OLD.workflow_state = 'published' THEN 1 ELSE 0 END, 0),
      project_file_count = GREATEST(project_file_count - CASE WHEN OLD.workflow_category = 'project_file' THEN 1 ELSE 0 END, 0),
      total_size_bytes = GREATEST(total_size_bytes - COALESCE(OLD.file_size, 0), 0),
      updated_at = NOW()
    WHERE id = OLD.media_bucket_id;
    RETURN OLD;
  END IF;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name character varying(100) NOT NULL,
    record_id uuid NOT NULL,
    action character varying(50) NOT NULL,
    old_values jsonb,
    new_values jsonb,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT audit_logs_action_check CHECK (((action)::text = ANY ((ARRAY['create'::character varying, 'update'::character varying, 'delete'::character varying])::text[])))
);


--
-- Name: media_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    media_bucket_id uuid NOT NULL,
    media_type character varying(20) NOT NULL,
    workflow_state character varying(50) NOT NULL,
    file_url character varying(500) NOT NULL,
    file_key character varying(500) NOT NULL,
    file_size bigint,
    file_mime_type character varying(100),
    encoding_handle character varying(255),
    encoding_video_id character varying(255),
    encoded_video_url character varying(500),
    video_metadata jsonb,
    image_metadata jsonb,
    alt_text text,
    title character varying(255),
    original_filename character varying(255) NOT NULL,
    source_folder_path character varying(500),
    workflow_category character varying(100) NOT NULL,
    edited_by uuid,
    edited_at timestamp with time zone,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    google_drive_file_id character varying(255),
    google_drive_folder_path character varying(500),
    import_source character varying(255),
    import_batch_id uuid,
    CONSTRAINT media_assets_media_type_check CHECK (((media_type)::text = ANY ((ARRAY['image'::character varying, 'video'::character varying])::text[]))),
    CONSTRAINT media_assets_workflow_category_check CHECK (((workflow_category)::text = ANY ((ARRAY['raw_capture'::character varying, 'final_ecom'::character varying, 'project_file'::character varying, 'psd_cutout'::character varying])::text[]))),
    CONSTRAINT media_assets_workflow_state_check CHECK (((workflow_state)::text = ANY ((ARRAY['raw'::character varying, 'edited'::character varying, 'encoding_submitted'::character varying, 'encoded'::character varying, 'ready_for_publish'::character varying, 'published'::character varying])::text[])))
);


--
-- Name: TABLE media_assets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.media_assets IS 'All media files (images, videos) stored in Storj.';


--
-- Name: media_buckets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_buckets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    sku_label character varying(255) NOT NULL,
    bucket_status character varying(50) DEFAULT 'active'::character varying,
    storj_path character varying(500) NOT NULL,
    raw_asset_count integer DEFAULT 0,
    edited_asset_count integer DEFAULT 0,
    published_asset_count integer DEFAULT 0,
    project_file_count integer DEFAULT 0,
    total_asset_count integer DEFAULT 0,
    total_size_bytes bigint DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_upload_at timestamp with time zone,
    last_publish_at timestamp with time zone,
    google_drive_folder_path character varying(500),
    import_batch_id uuid,
    import_completed_at timestamp with time zone,
    CONSTRAINT media_buckets_bucket_status_check CHECK (((bucket_status)::text = ANY ((ARRAY['active'::character varying, 'archived'::character varying, 'needs_review'::character varying])::text[])))
);


--
-- Name: TABLE media_buckets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.media_buckets IS 'Organizational storage container. One bucket per product, identified by sku_label.';


--
-- Name: product_images_unassociated; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_images_unassociated (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shopify_media_id character varying(255) NOT NULL,
    shopify_product_id bigint,
    product_id uuid,
    source_url character varying(1000),
    filename character varying(500),
    alt_text text,
    mime_type character varying(100),
    byte_size bigint,
    width integer,
    height integer,
    "position" integer,
    shopify_created_at timestamp with time zone,
    shopify_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    shopify_variant_id bigint,
    variant_id uuid,
    is_variant_hero boolean DEFAULT false
);


--
-- Name: TABLE product_images_unassociated; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_images_unassociated IS 'Staging for Shopify-published images not yet associated in PIM. Kept separate from media_assets/Storj.';


--
-- Name: COLUMN product_images_unassociated.shopify_media_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_images_unassociated.shopify_media_id IS 'Shopify MediaImage GID (unique).';


--
-- Name: COLUMN product_images_unassociated.source_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_images_unassociated.source_url IS 'Original Shopify CDN URL.';


--
-- Name: COLUMN product_images_unassociated."position"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_images_unassociated."position" IS 'Gallery order from Shopify.';


--
-- Name: product_media_associations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_media_associations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    media_asset_id uuid NOT NULL,
    variant_id uuid,
    association_type character varying(50) NOT NULL,
    "position" integer DEFAULT 0,
    is_published boolean DEFAULT true,
    shopify_media_id character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT product_media_associations_association_type_check CHECK (((association_type)::text = ANY ((ARRAY['product_image'::character varying, 'product_video'::character varying, 'variant_hero'::character varying])::text[])))
);


--
-- Name: TABLE product_media_associations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_media_associations IS 'SOURCE OF TRUTH for publishing. Defines which images/videos are assigned to each product.';


--
-- Name: COLUMN product_media_associations.shopify_media_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_media_associations.shopify_media_id IS 'Shopify MediaImage GID - NULL until synced to Shopify.';


--
-- Name: product_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    shopify_variant_id bigint NOT NULL,
    sku character varying(255),
    title character varying(255),
    price numeric(10,2),
    compare_at_price numeric(10,2),
    weight numeric(10,2),
    weight_unit character varying(10),
    dimensions jsonb,
    inventory_quantity integer,
    "position" integer,
    option1 character varying(255),
    option2 character varying(255),
    option3 character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT product_variants_weight_unit_check CHECK (((weight_unit)::text = ANY ((ARRAY['lb'::character varying, 'oz'::character varying, 'kg'::character varying, 'g'::character varying])::text[])))
);


--
-- Name: TABLE product_variants; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_variants IS 'Product variants with actual Shopify SKUs.';


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shopify_product_id bigint NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    description_html text,
    handle character varying(255),
    sku_label character varying(255),
    vendor character varying(255),
    product_type character varying(255),
    tags text[],
    status character varying(50) DEFAULT 'draft'::character varying,
    shopify_status character varying(50),
    shopify_published_at timestamp with time zone,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_synced_at timestamp with time zone,
    google_drive_folder_path character varying(500),
    CONSTRAINT products_shopify_status_check CHECK (((shopify_status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'DRAFT'::character varying, 'ARCHIVED'::character varying])::text[]))),
    CONSTRAINT products_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'archived'::character varying])::text[])))
);


--
-- Name: TABLE products; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.products IS 'Products imported from Shopify. sku_label is an internal identifier, NOT a Shopify SKU.';


--
-- Name: COLUMN products.sku_label; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.sku_label IS 'Internal label derived from variant SKUs. For multi-variant: base SKU without size suffix.';


--
-- Name: sync_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sync_type character varying(50) NOT NULL,
    entity_type character varying(50),
    entity_id uuid,
    status character varying(50) NOT NULL,
    error_message text,
    details jsonb,
    performed_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sync_logs_status_check CHECK (((status)::text = ANY ((ARRAY['success'::character varying, 'failed'::character varying, 'partial'::character varying])::text[]))),
    CONSTRAINT sync_logs_sync_type_check CHECK (((sync_type)::text = ANY ((ARRAY['import_from_shopify'::character varying, 'publish_to_shopify'::character varying, 'import_from_gdrive'::character varying])::text[])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    auth_user_id character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    name character varying(255),
    role character varying(50) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    last_login_at timestamp with time zone,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'photographer'::character varying, 'writer'::character varying, 'viewer'::character varying])::text[])))
);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: media_assets media_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_pkey PRIMARY KEY (id);


--
-- Name: media_buckets media_buckets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_buckets
    ADD CONSTRAINT media_buckets_pkey PRIMARY KEY (id);


--
-- Name: media_buckets media_buckets_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_buckets
    ADD CONSTRAINT media_buckets_product_id_key UNIQUE (product_id);


--
-- Name: media_buckets media_buckets_sku_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_buckets
    ADD CONSTRAINT media_buckets_sku_label_key UNIQUE (sku_label);


--
-- Name: product_images_unassociated product_images_unassociated_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images_unassociated
    ADD CONSTRAINT product_images_unassociated_pkey PRIMARY KEY (id);


--
-- Name: product_images_unassociated product_images_unassociated_shopify_media_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images_unassociated
    ADD CONSTRAINT product_images_unassociated_shopify_media_id_key UNIQUE (shopify_media_id);


--
-- Name: product_media_associations product_media_associations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_media_associations
    ADD CONSTRAINT product_media_associations_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_shopify_variant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_shopify_variant_id_key UNIQUE (shopify_variant_id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_shopify_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_shopify_product_id_key UNIQUE (shopify_product_id);


--
-- Name: sync_logs sync_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_logs
    ADD CONSTRAINT sync_logs_pkey PRIMARY KEY (id);


--
-- Name: users users_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_auth_user_id_key UNIQUE (auth_user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_audit_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_created ON public.audit_logs USING btree (created_at);


--
-- Name: idx_audit_logs_table_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_table_record ON public.audit_logs USING btree (table_name, record_id);


--
-- Name: idx_media_bucket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_bucket ON public.media_assets USING btree (media_bucket_id);


--
-- Name: idx_media_buckets_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_buckets_product ON public.media_buckets USING btree (product_id);


--
-- Name: idx_media_buckets_sku_label; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_buckets_sku_label ON public.media_buckets USING btree (sku_label);


--
-- Name: idx_media_buckets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_buckets_status ON public.media_buckets USING btree (bucket_status);


--
-- Name: idx_media_import_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_import_batch ON public.media_assets USING btree (import_batch_id);


--
-- Name: idx_media_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_type ON public.media_assets USING btree (media_type);


--
-- Name: idx_media_workflow_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_workflow_category ON public.media_assets USING btree (workflow_category);


--
-- Name: idx_media_workflow_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_workflow_state ON public.media_assets USING btree (workflow_state);


--
-- Name: idx_piu_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_piu_product_id ON public.product_images_unassociated USING btree (product_id);


--
-- Name: idx_piu_shopify_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_piu_shopify_product_id ON public.product_images_unassociated USING btree (shopify_product_id);


--
-- Name: idx_piu_shopify_variant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_piu_shopify_variant_id ON public.product_images_unassociated USING btree (shopify_variant_id);


--
-- Name: idx_piu_variant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_piu_variant_id ON public.product_images_unassociated USING btree (variant_id);


--
-- Name: idx_pma_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pma_asset ON public.product_media_associations USING btree (media_asset_id);


--
-- Name: idx_pma_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pma_position ON public.product_media_associations USING btree (product_id, "position");


--
-- Name: idx_pma_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pma_product ON public.product_media_associations USING btree (product_id);


--
-- Name: idx_pma_product_media_type_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pma_product_media_type_unique ON public.product_media_associations USING btree (product_id, media_asset_id, association_type);


--
-- Name: idx_pma_shopify_media_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pma_shopify_media_unique ON public.product_media_associations USING btree (shopify_media_id) WHERE (shopify_media_id IS NOT NULL);


--
-- Name: idx_pma_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pma_type ON public.product_media_associations USING btree (association_type);


--
-- Name: idx_pma_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pma_variant ON public.product_media_associations USING btree (variant_id);


--
-- Name: idx_pma_variant_hero_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pma_variant_hero_unique ON public.product_media_associations USING btree (variant_id) WHERE ((variant_id IS NOT NULL) AND ((association_type)::text = 'variant_hero'::text));


--
-- Name: idx_products_shopify_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_shopify_id ON public.products USING btree (shopify_product_id);


--
-- Name: idx_products_sku_label; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_sku_label ON public.products USING btree (sku_label);


--
-- Name: idx_products_sku_label_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_products_sku_label_unique ON public.products USING btree (sku_label) WHERE (sku_label IS NOT NULL);


--
-- Name: idx_products_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_status ON public.products USING btree (status);


--
-- Name: idx_sync_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_logs_created ON public.sync_logs USING btree (created_at);


--
-- Name: idx_sync_logs_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_logs_type ON public.sync_logs USING btree (sync_type);


--
-- Name: idx_users_auth_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_auth_id ON public.users USING btree (auth_user_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_variants_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variants_product_id ON public.product_variants USING btree (product_id);


--
-- Name: idx_variants_shopify_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variants_shopify_id ON public.product_variants USING btree (shopify_variant_id);


--
-- Name: idx_variants_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variants_sku ON public.product_variants USING btree (sku);


--
-- Name: idx_variants_sku_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_variants_sku_unique ON public.product_variants USING btree (sku) WHERE (sku IS NOT NULL);


--
-- Name: products trg_check_product_sku_not_other_variant; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_check_product_sku_not_other_variant BEFORE INSERT OR UPDATE OF sku_label ON public.products FOR EACH ROW EXECUTE FUNCTION public.check_product_sku_not_other_variant();


--
-- Name: product_variants trg_check_single_variant_sku; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_check_single_variant_sku AFTER INSERT OR UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.check_single_variant_sku_match();


--
-- Name: products trg_check_single_variant_sku_product; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_check_single_variant_sku_product AFTER INSERT OR UPDATE OF sku_label ON public.products FOR EACH ROW EXECUTE FUNCTION public.check_single_variant_sku_match();


--
-- Name: product_variants trg_check_variant_sku_not_other_product; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_check_variant_sku_not_other_product BEFORE INSERT OR UPDATE OF sku ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.check_variant_sku_not_other_product();


--
-- Name: media_assets trg_media_assets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_media_assets_updated_at BEFORE UPDATE ON public.media_assets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: media_buckets trg_media_buckets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_media_buckets_updated_at BEFORE UPDATE ON public.media_buckets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: product_media_associations trg_pma_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pma_updated_at BEFORE UPDATE ON public.product_media_associations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: products trg_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: media_assets trg_update_bucket_counts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_bucket_counts AFTER INSERT OR DELETE OR UPDATE ON public.media_assets FOR EACH ROW EXECUTE FUNCTION public.update_media_bucket_counts();


--
-- Name: product_variants trg_variants_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_variants_updated_at BEFORE UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: media_assets media_assets_edited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES public.users(id);


--
-- Name: media_assets media_assets_media_bucket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_media_bucket_id_fkey FOREIGN KEY (media_bucket_id) REFERENCES public.media_buckets(id) ON DELETE CASCADE;


--
-- Name: media_assets media_assets_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: media_buckets media_buckets_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_buckets
    ADD CONSTRAINT media_buckets_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_images_unassociated product_images_unassociated_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images_unassociated
    ADD CONSTRAINT product_images_unassociated_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_images_unassociated product_images_unassociated_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images_unassociated
    ADD CONSTRAINT product_images_unassociated_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- Name: product_media_associations product_media_associations_media_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_media_associations
    ADD CONSTRAINT product_media_associations_media_asset_id_fkey FOREIGN KEY (media_asset_id) REFERENCES public.media_assets(id) ON DELETE CASCADE;


--
-- Name: product_media_associations product_media_associations_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_media_associations
    ADD CONSTRAINT product_media_associations_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_media_associations product_media_associations_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_media_associations
    ADD CONSTRAINT product_media_associations_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: sync_logs sync_logs_performed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_logs
    ADD CONSTRAINT sync_logs_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

\unrestrict viQ4aOoAz9Mk0NE1PAPafnMgXg75doWQco95KeLOHLQ4yNbfX1Dk0cNB8AdHxiw


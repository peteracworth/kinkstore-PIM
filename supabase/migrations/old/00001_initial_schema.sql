-- Kinkstore PIM Initial Schema
-- This migration creates all core tables for the Product Information Management system

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id VARCHAR(255) UNIQUE NOT NULL, -- Supabase Auth user ID
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'photographer', 'writer', 'viewer')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_users_auth_id ON users(auth_user_id);
CREATE INDEX idx_users_email ON users(email);

-- ============================================
-- PRODUCTS TABLE
-- ============================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_product_id BIGINT UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  description_html TEXT,
  handle VARCHAR(255),
  sku_label VARCHAR(255), -- Internal label (e.g., "RSV-V-PRODUCTXYZ")
  vendor VARCHAR(255),
  product_type VARCHAR(255),
  tags TEXT[], -- PostgreSQL array
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  shopify_status VARCHAR(50) CHECK (shopify_status IN ('ACTIVE', 'DRAFT', 'ARCHIVED')),
  shopify_published_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB, -- Shopify metafields
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_synced_at TIMESTAMP WITH TIME ZONE,
  google_drive_folder_path VARCHAR(500) -- Legacy import reference
);

CREATE INDEX idx_products_shopify_id ON products(shopify_product_id);
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_sku_label ON products(sku_label);
CREATE UNIQUE INDEX idx_products_sku_label_unique ON products(sku_label) WHERE sku_label IS NOT NULL;

-- ============================================
-- PRODUCT VARIANTS TABLE
-- ============================================
CREATE TABLE product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  shopify_variant_id BIGINT UNIQUE NOT NULL,
  sku VARCHAR(255),
  title VARCHAR(255),
  price DECIMAL(10,2),
  compare_at_price DECIMAL(10,2),
  weight DECIMAL(10,2),
  weight_unit VARCHAR(10) CHECK (weight_unit IN ('lb', 'oz', 'kg', 'g')),
  dimensions JSONB, -- {length, width, height, unit}
  inventory_quantity INTEGER,
  position INTEGER,
  option1 VARCHAR(255),
  option2 VARCHAR(255),
  option3 VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_variants_product_id ON product_variants(product_id);
CREATE INDEX idx_variants_shopify_id ON product_variants(shopify_variant_id);
CREATE INDEX idx_variants_sku ON product_variants(sku);
CREATE UNIQUE INDEX idx_variants_sku_unique ON product_variants(sku) WHERE sku IS NOT NULL;

-- ============================================
-- MEDIA BUCKETS TABLE
-- ============================================
CREATE TABLE media_buckets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID UNIQUE NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku_label VARCHAR(255) UNIQUE NOT NULL,
  bucket_status VARCHAR(50) DEFAULT 'active' CHECK (bucket_status IN ('active', 'archived', 'needs_review')),
  storj_path VARCHAR(500) NOT NULL,
  -- Cached counts (updated via triggers)
  raw_asset_count INTEGER DEFAULT 0,
  edited_asset_count INTEGER DEFAULT 0,
  published_asset_count INTEGER DEFAULT 0,
  project_file_count INTEGER DEFAULT 0,
  total_asset_count INTEGER DEFAULT 0,
  total_size_bytes BIGINT DEFAULT 0,
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_upload_at TIMESTAMP WITH TIME ZONE,
  last_publish_at TIMESTAMP WITH TIME ZONE,
  -- Import tracking
  google_drive_folder_path VARCHAR(500),
  import_batch_id UUID,
  import_completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_media_buckets_product ON media_buckets(product_id);
CREATE INDEX idx_media_buckets_sku_label ON media_buckets(sku_label);
CREATE INDEX idx_media_buckets_status ON media_buckets(bucket_status);

-- ============================================
-- MEDIA ASSETS TABLE
-- ============================================
CREATE TABLE media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_bucket_id UUID NOT NULL REFERENCES media_buckets(id) ON DELETE CASCADE,
  media_type VARCHAR(20) NOT NULL CHECK (media_type IN ('image', 'video')),
  workflow_state VARCHAR(50) NOT NULL CHECK (workflow_state IN ('raw', 'edited', 'encoding_submitted', 'encoded', 'ready_for_publish', 'published')),
  -- File storage
  file_url VARCHAR(500) NOT NULL,
  file_key VARCHAR(500) NOT NULL,
  file_size BIGINT,
  file_mime_type VARCHAR(100),
  -- Video-specific
  encoding_handle VARCHAR(255), -- Our internalName: {sku_label}--{uuid}
  encoding_video_id VARCHAR(255), -- ID from encoding API
  encoded_video_url VARCHAR(500), -- Final encoded video URL
  video_metadata JSONB,
  -- Image-specific
  image_metadata JSONB,
  -- Common metadata
  alt_text TEXT,
  title VARCHAR(255),
  original_filename VARCHAR(255) NOT NULL,
  source_folder_path VARCHAR(500),
  workflow_category VARCHAR(100) NOT NULL CHECK (workflow_category IN ('raw_capture', 'final_ecom', 'project_file', 'psd_cutout')),
  edited_by UUID REFERENCES users(id),
  edited_at TIMESTAMP WITH TIME ZONE,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- Legacy import tracking
  google_drive_file_id VARCHAR(255),
  google_drive_folder_path VARCHAR(500),
  import_source VARCHAR(255),
  import_batch_id UUID
);

CREATE INDEX idx_media_bucket ON media_assets(media_bucket_id);
CREATE INDEX idx_media_workflow_state ON media_assets(workflow_state);
CREATE INDEX idx_media_type ON media_assets(media_type);
CREATE INDEX idx_media_workflow_category ON media_assets(workflow_category);
CREATE INDEX idx_media_import_batch ON media_assets(import_batch_id);

-- ============================================
-- PRODUCT MEDIA ASSOCIATIONS TABLE
-- Source of truth for what gets published to Shopify
-- ============================================
CREATE TABLE product_media_associations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  association_type VARCHAR(50) NOT NULL CHECK (association_type IN ('product_image', 'product_video', 'variant_hero')),
  position INTEGER DEFAULT 0,
  is_published BOOLEAN DEFAULT TRUE,
  shopify_media_id VARCHAR(255), -- Shopify MediaImage GID
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Constraints
CREATE UNIQUE INDEX idx_pma_variant_hero_unique ON product_media_associations(variant_id) 
  WHERE variant_id IS NOT NULL AND association_type = 'variant_hero';
CREATE UNIQUE INDEX idx_pma_product_media_type_unique ON product_media_associations(product_id, media_asset_id, association_type);
CREATE UNIQUE INDEX idx_pma_shopify_media_unique ON product_media_associations(shopify_media_id) 
  WHERE shopify_media_id IS NOT NULL;

-- Indexes
CREATE INDEX idx_pma_product ON product_media_associations(product_id);
CREATE INDEX idx_pma_asset ON product_media_associations(media_asset_id);
CREATE INDEX idx_pma_variant ON product_media_associations(variant_id);
CREATE INDEX idx_pma_type ON product_media_associations(association_type);
CREATE INDEX idx_pma_position ON product_media_associations(product_id, position);

-- ============================================
-- SYNC LOGS TABLE
-- ============================================
CREATE TABLE sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type VARCHAR(50) NOT NULL CHECK (sync_type IN ('import_from_shopify', 'publish_to_shopify', 'import_from_gdrive')),
  entity_type VARCHAR(50),
  entity_id UUID,
  status VARCHAR(50) NOT NULL CHECK (status IN ('success', 'failed', 'partial')),
  error_message TEXT,
  details JSONB,
  performed_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sync_logs_type ON sync_logs(sync_type);
CREATE INDEX idx_sync_logs_created ON sync_logs(created_at);

-- ============================================
-- AUDIT LOGS TABLE
-- ============================================
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name VARCHAR(100) NOT NULL,
  record_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  old_values JSONB,
  new_values JSONB,
  user_id UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_table_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

-- ============================================
-- TRIGGERS: updated_at timestamp
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_variants_updated_at
  BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_media_buckets_updated_at
  BEFORE UPDATE ON media_buckets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_media_assets_updated_at
  BEFORE UPDATE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_pma_updated_at
  BEFORE UPDATE ON product_media_associations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- TRIGGERS: SKU uniqueness across tables
-- ============================================
CREATE OR REPLACE FUNCTION check_product_sku_label_uniqueness()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM product_variants WHERE sku = NEW.sku_label) THEN
    RAISE EXCEPTION 'Product sku_label "%" conflicts with existing variant SKU', NEW.sku_label;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_product_sku_label
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW
  WHEN (NEW.sku_label IS NOT NULL)
  EXECUTE FUNCTION check_product_sku_label_uniqueness();

CREATE OR REPLACE FUNCTION check_variant_sku_uniqueness()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM products WHERE sku_label = NEW.sku) THEN
    RAISE EXCEPTION 'Variant SKU "%" conflicts with existing product sku_label', NEW.sku;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_variant_sku
  BEFORE INSERT OR UPDATE ON product_variants
  FOR EACH ROW
  WHEN (NEW.sku IS NOT NULL)
  EXECUTE FUNCTION check_variant_sku_uniqueness();

-- ============================================
-- TRIGGERS: Media bucket count updates
-- ============================================
CREATE OR REPLACE FUNCTION update_media_bucket_counts()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_bucket_counts
  AFTER INSERT OR UPDATE OR DELETE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION update_media_bucket_counts();

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE products IS 'Products imported from Shopify. sku_label is an internal identifier, NOT a Shopify SKU.';
COMMENT ON TABLE product_variants IS 'Product variants with actual Shopify SKUs.';
COMMENT ON TABLE media_buckets IS 'Organizational storage container. One bucket per product, identified by sku_label.';
COMMENT ON TABLE media_assets IS 'All media files (images, videos) stored in Storj.';
COMMENT ON TABLE product_media_associations IS 'SOURCE OF TRUTH for publishing. Defines which images/videos are assigned to each product.';
COMMENT ON COLUMN product_media_associations.shopify_media_id IS 'Shopify MediaImage GID - NULL until synced to Shopify.';
COMMENT ON COLUMN products.sku_label IS 'Internal label derived from variant SKUs. For multi-variant: base SKU without size suffix.';


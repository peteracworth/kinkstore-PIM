# Shopify PIM System - Implementation Plan

## Executive Summary
Building a Product Information Management (PIM) system for ~1,000 products with media management, product data editing, and Shopify synchronization. The system will migrate from Google Drive storage to a database-driven solution with cloud storage.

## Architecture Overview

### Technology Stack
- **Frontend**: React (deployed on Vercel)
- **Backend**: Node.js API (deployed on Vercel serverless functions or separate Node server)
- **Database**: PostgreSQL (Supabase)
- **File Storage**: Storj (S3-compatible)
- **Authentication**: Auth0 with Google OAuth
- **External Integrations**:
  - Shopify Admin GraphQL API
  - Video encoding GraphQL API (upload via URL, query by name)
- **Media Processing Libraries**:
  - Image editing: `react-image-crop` + `sharp` (crop, resize, rotate)
  - Video editing: `ffmpeg.js` or `remotion` (trim, stitch intro/outro)

### Key Design Decisions

#### 1. SKU/Product Identification Strategy
- **Primary Key**: Use Shopify Product ID as the main identifier
- **Import Strategy**: During Google Drive import, create mapping between folder names → Shopify Product IDs
- **Rationale**: Shopify Product ID is guaranteed unique and provides direct integration path

#### 2. Media Asset Management (Reference-Based)
- **Central Media Library**: All images/videos stored once in media table
- **Association Model**: Many-to-many relationships via junction tables
- **Use Cases Supported**:
  - Product-level media (hero images, galleries)
  - Variant-level media (specific to size/color variants)
  - Collection-level media (future: collection hero images)
  - Shared media across products (bundles)

#### 3. Media Workflow States
```
Images:  raw → edited → ready_for_publish → published
Videos:  raw → edited → encoding_submitted → encoded → ready_for_publish → published
```

## Database Schema

### Core Concepts

**SKU vs SKU Label:**
- **SKU**: Exists at variant level only (Shopify reality). Example: `RSV-PRODUCTXYZ-S`, `RSV-PRODUCTXYZ-M`
- **SKU Label**: Exists at product level (PIM internal). Example: `RSV-PRODUCTXYZ`
  - For multi-variant products: base name without size/color suffix
  - For single-variant products: same as the variant's SKU
  - Always unique across all products
  - Never collides with any variant SKU

**Media Bucket Concept:**
- A **media bucket** is a first-class entity representing ALL media STORED under a SKU Label
- One bucket per product (one-to-one with SKU Label)
- Bucket identifier = SKU Label (e.g., `RSV-PRODUCTXYZ`)
- Contains: raw captures, edited photos, videos, project files (PSDs), all workflow stages
- Physically stored in Storj at: `products/{sku_label}/`
- **IMPORTANT**: Bucket is for ORGANIZATION/STORAGE only, NOT publishing

**Publishing is Separate from Bucket Membership:**
- **`media_buckets` table**: Organizational container with cached stats
- **`media_assets.media_bucket_id`**: Where the file is stored (organizational)
- **`product_media_associations` table**: **SOURCE OF TRUTH for publishing** - defines what actually gets published to Shopify
- Just because an image is in a bucket does NOT mean it gets published
- Users must explicitly assign images from the bucket (or any bucket) to the product
- UI highlights images from matching SKU bucket, but users can choose any image

**Key Design Choices:**
- Each media asset belongs to exactly ONE bucket (storage location)
- Publishing is defined by `product_media_associations` (explicit assignments)
- In the UI, images from the matching SKU bucket are highlighted/suggested
- Users are free to assign images from other buckets if needed
- **Future flexibility**: Buckets may exist without products; publishing points may expand beyond products

### Core Tables

#### `products`
```sql
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_product_id BIGINT UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  description_html TEXT,
  handle VARCHAR(255),
  sku_label VARCHAR(255), -- descriptive SKU for human reference (e.g., "RSV-V-PRODUCTXYZ")
                          -- NOTE: This is NOT a Shopify SKU (those live on variants)
                          -- This is an internal label derived from variant SKUs by removing size suffix
                          -- Example: variants have "RSV-V-PRODUCTXYZ-S", "RSV-V-PRODUCTXYZ-M", "RSV-V-PRODUCTXYZ-L"
                          --          product sku_label is "RSV-V-PRODUCTXYZ" (does not exist in Shopify)
                          -- MUST be unique across all products AND must not collide with any variant SKU
  vendor VARCHAR(255),
  product_type VARCHAR(255),
  tags TEXT[], -- PostgreSQL array
  status VARCHAR(50) DEFAULT 'draft', -- draft, active, archived
  shopify_status VARCHAR(50), -- ACTIVE, DRAFT, ARCHIVED (from Shopify)
  shopify_published_at TIMESTAMP,
  metadata JSONB, -- flexible metafields storage
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_synced_at TIMESTAMP,
  google_drive_folder_path VARCHAR(500) -- for import reference (e.g., "RSV-V-PRODUCTXYZ")
);

CREATE INDEX idx_products_shopify_id ON products(shopify_product_id);
CREATE INDEX idx_products_status ON products(status);
CREATE UNIQUE INDEX idx_products_sku_label_unique ON products(sku_label) WHERE sku_label IS NOT NULL;
```

#### `product_variants`
```sql
CREATE TABLE product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  shopify_variant_id BIGINT UNIQUE NOT NULL,
  sku VARCHAR(255),
  title VARCHAR(255),
  price DECIMAL(10,2),
  compare_at_price DECIMAL(10,2),
  weight DECIMAL(10,2),
  weight_unit VARCHAR(10), -- lb, oz, kg, g
  dimensions JSONB, -- {length, width, height, unit}
  inventory_quantity INTEGER,
  position INTEGER,
  option1 VARCHAR(255), -- size, color, etc.
  option2 VARCHAR(255),
  option3 VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_variants_product_id ON product_variants(product_id);
CREATE INDEX idx_variants_shopify_id ON product_variants(shopify_variant_id);
CREATE UNIQUE INDEX idx_variants_sku_unique ON product_variants(sku) WHERE sku IS NOT NULL;
```

#### SKU Uniqueness Constraints

**Cross-table uniqueness requirement:**
- `products.sku_label` must be unique across all products
- `product_variants.sku` must be unique across all variants
- **`products.sku_label` must NOT collide with ANY `product_variants.sku`**

**Database enforcement:**
```sql
-- Constraint function to prevent product sku_label from matching any variant sku
CREATE OR REPLACE FUNCTION check_product_sku_label_uniqueness()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if this sku_label exists as a variant SKU anywhere
  IF EXISTS (
    SELECT 1 FROM product_variants
    WHERE sku = NEW.sku_label
  ) THEN
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

-- Constraint function to prevent variant sku from matching any product sku_label
CREATE OR REPLACE FUNCTION check_variant_sku_uniqueness()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if this variant SKU exists as a product sku_label anywhere
  IF EXISTS (
    SELECT 1 FROM products
    WHERE sku_label = NEW.sku
  ) THEN
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
```

**Why this matters:**
```
❌ BAD: Collision scenario
Product sku_label: "PRODUCT-ABC"
Variant SKU: "PRODUCT-ABC"  ← collision! Which one is it?

✅ GOOD: Proper naming
Product sku_label: "PRODUCT-ABC"
Variant SKUs: "PRODUCT-ABC-S", "PRODUCT-ABC-M", "PRODUCT-ABC-L"

✅ ALSO GOOD: Single-variant product
Product sku_label: "UNIQUE-SKU-123"
Variant SKU: "UNIQUE-SKU-123"  ← OK if only one product has this pattern
```

#### `media_assets`
```sql
CREATE TABLE media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_bucket_id UUID NOT NULL REFERENCES media_buckets(id) ON DELETE CASCADE, -- Each asset belongs to exactly ONE bucket
  media_type VARCHAR(20) NOT NULL, -- image, video
  workflow_state VARCHAR(50) NOT NULL, -- raw, edited, encoding_submitted, encoded, ready_for_publish, published

  -- File storage (use appropriate field based on workflow_state)
  file_url VARCHAR(500) NOT NULL, -- Storj URL
  file_key VARCHAR(500) NOT NULL, -- Storj object key (e.g., products/RSV-B-FILLER-PLUG/photos/raw/DSC09935.JPG)
  file_size BIGINT,
  file_mime_type VARCHAR(100),

  -- Video-specific (for encoding workflow)
  encoding_handle VARCHAR(255), -- our internalName: {sku_label}--{uuid}
  encoding_video_id VARCHAR(255), -- ID returned by encoding API for direct lookup
  encoded_video_url VARCHAR(500), -- final encoded video URL from videoAssets[].url
  video_metadata JSONB, -- duration, resolution, codec, etc.

  -- Image-specific
  image_metadata JSONB, -- width, height, format, etc.

  -- Common metadata
  alt_text TEXT,
  title VARCHAR(255),
  original_filename VARCHAR(255) NOT NULL,
  source_folder_path VARCHAR(500), -- original folder path from import (e.g., "Photos/New Raw Captures")

  -- Workflow categorization
  workflow_category VARCHAR(100) NOT NULL, -- raw_capture, final_ecom, project_file, psd_cutout
  edited_by UUID REFERENCES users(id),
  edited_at TIMESTAMP,

  -- Tracking
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Import tracking
  google_drive_file_id VARCHAR(255),
  google_drive_folder_path VARCHAR(500), -- full path from Google Drive (e.g., "RSV-B-FILLER-PLUG/Photos/New Raw Captures")
  import_source VARCHAR(255),
  import_batch_id UUID -- group all files from same import job
);

CREATE INDEX idx_media_bucket ON media_assets(media_bucket_id);
CREATE INDEX idx_media_workflow_state ON media_assets(workflow_state);
CREATE INDEX idx_media_type ON media_assets(media_type);
CREATE INDEX idx_media_workflow_category ON media_assets(workflow_category);
CREATE INDEX idx_media_import_batch ON media_assets(import_batch_id);

COMMENT ON COLUMN media_assets.media_bucket_id IS 'Foreign key to media_buckets. Each asset belongs to exactly one bucket (one product). NOT NULL enforces this constraint.';
```

#### `product_media_associations` (Publishing Source of Truth)
```sql
-- THIS TABLE IS THE SOURCE OF TRUTH FOR WHAT GETS PUBLISHED TO SHOPIFY
-- Bucket membership (media_assets.media_bucket_id) is purely organizational storage
-- Just because an image is in a bucket does NOT mean it gets published
-- This table explicitly defines what images/videos are assigned to each product
CREATE TABLE product_media_associations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE, -- Required: which product
  media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE, -- Which media
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE, -- NULL for product-level, set for variant hero
  association_type VARCHAR(50) NOT NULL, -- 'product_image', 'product_video', 'variant_hero'
  position INTEGER DEFAULT 0, -- Gallery ordering: 1 = hero image for product-level
  is_published BOOLEAN DEFAULT TRUE, -- Whether to publish to Shopify
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- A variant can only have one hero image
  UNIQUE(variant_id) WHERE variant_id IS NOT NULL AND association_type = 'variant_hero',
  -- Prevent duplicate assignments of same media to same product
  UNIQUE(product_id, media_asset_id, association_type)
);

CREATE INDEX idx_pma_product ON product_media_associations(product_id);
CREATE INDEX idx_pma_asset ON product_media_associations(media_asset_id);
CREATE INDEX idx_pma_variant ON product_media_associations(variant_id);
CREATE INDEX idx_pma_type ON product_media_associations(association_type);
CREATE INDEX idx_pma_position ON product_media_associations(product_id, position);

COMMENT ON TABLE product_media_associations IS 'SOURCE OF TRUTH for publishing. Defines which images/videos are assigned to each product, their order, and variant heroes. Bucket membership is separate (organizational only).';
COMMENT ON COLUMN product_media_associations.product_id IS 'Required: which product this media is assigned to';
COMMENT ON COLUMN product_media_associations.variant_id IS 'NULL for product-level images; set for variant-specific hero images';
COMMENT ON COLUMN product_media_associations.position IS 'Gallery order: position 1 = hero image (for product_image type)';
COMMENT ON COLUMN product_media_associations.is_published IS 'If false, media is assigned but not published to Shopify';
```

#### `media_buckets`
```sql
-- Explicit media bucket entity - one per product
-- Provides a first-class domain object for media organization and querying
CREATE TABLE media_buckets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID UNIQUE NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku_label VARCHAR(255) UNIQUE NOT NULL, -- denormalized from products.sku_label for direct access

  -- Bucket metadata
  bucket_status VARCHAR(50) DEFAULT 'active', -- active, archived, needs_review
  storj_path VARCHAR(500) NOT NULL, -- e.g., "products/RSV-V-PRODUCTXYZ/"

  -- Cached counts (updated via triggers for performance)
  raw_asset_count INTEGER DEFAULT 0,
  edited_asset_count INTEGER DEFAULT 0,
  published_asset_count INTEGER DEFAULT 0,
  project_file_count INTEGER DEFAULT 0,
  total_asset_count INTEGER DEFAULT 0,
  total_size_bytes BIGINT DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_upload_at TIMESTAMP,
  last_publish_at TIMESTAMP,

  -- Import tracking
  google_drive_folder_path VARCHAR(500), -- original folder path
  import_batch_id UUID,
  import_completed_at TIMESTAMP
);

CREATE INDEX idx_media_buckets_product ON media_buckets(product_id);
CREATE INDEX idx_media_buckets_sku_label ON media_buckets(sku_label);
CREATE INDEX idx_media_buckets_status ON media_buckets(bucket_status);
CREATE INDEX idx_media_buckets_import_batch ON media_buckets(import_batch_id);

COMMENT ON TABLE media_buckets IS 'Organizational storage container. One bucket per product, identified by sku_label. Contains all media assets (raw, edited, project files) for browsing/selection. NOTE: Bucket membership does NOT determine publishing - that is defined by product_media_associations.';
COMMENT ON COLUMN media_buckets.sku_label IS 'Bucket identifier matching products.sku_label. For multi-variant: base SKU (e.g., RSV-V-PRODUCTXYZ). For single-variant: same as variant SKU.';
COMMENT ON COLUMN media_buckets.storj_path IS 'Root path in Storj storage where all bucket assets are stored (e.g., products/RSV-V-PRODUCTXYZ/)';
-- NOTE: published_asset_count refers to workflow_state, NOT whether assigned to a product
```

**Relationship to `product_media_associations`:**
- `media_buckets` is the **organizational storage container** (one per product)
- `media_assets.media_bucket_id` establishes **where the file is stored** (organizational)
- `product_media_associations` is the **PUBLISHING SOURCE OF TRUTH** - defines what gets published
- **Bucket ≠ Published**: An image in a bucket is NOT automatically published
- Query patterns:
  - Bucket contents: `SELECT * FROM media_assets WHERE media_bucket_id = bucket.id`
  - Published images: `SELECT * FROM product_media_associations WHERE product_id = ? ORDER BY position`

**Triggers to maintain cached counts:**
```sql
-- Update bucket counts when assets are added/removed
CREATE OR REPLACE FUNCTION update_media_bucket_counts_on_asset_change()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE media_buckets
    SET
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

  ELSIF (TG_OP = 'UPDATE') THEN
    -- Handle workflow state changes (e.g., raw → edited → published)
    UPDATE media_buckets
    SET
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

  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE media_buckets
    SET
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

CREATE TRIGGER trg_update_bucket_counts_on_asset
  AFTER INSERT OR UPDATE OR DELETE ON media_assets
  FOR EACH ROW
  EXECUTE FUNCTION update_media_bucket_counts_on_asset_change();
```

#### `users`
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth0_user_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) NOT NULL, -- admin, photographer, writer, viewer
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  last_login_at TIMESTAMP
);

CREATE INDEX idx_users_auth0_id ON users(auth0_user_id);
CREATE INDEX idx_users_email ON users(email);
```

#### `sync_logs`
```sql
CREATE TABLE sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type VARCHAR(50) NOT NULL, -- import_from_shopify, publish_to_shopify, import_from_gdrive
  entity_type VARCHAR(50), -- product, media
  entity_id UUID,
  status VARCHAR(50) NOT NULL, -- success, failed, partial
  error_message TEXT,
  details JSONB,
  performed_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sync_logs_type ON sync_logs(sync_type);
CREATE INDEX idx_sync_logs_created ON sync_logs(created_at);
```

#### `audit_logs`
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name VARCHAR(100) NOT NULL,
  record_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL, -- create, update, delete
  old_values JSONB,
  new_values JSONB,
  user_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_table_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
```

## Application Architecture

### Backend API Structure

```
/api
├── /auth
│   ├── POST /login (Auth0 callback)
│   ├── POST /logout
│   └── GET /me (current user info)
├── /products
│   ├── GET /products (list with pagination, filtering)
│   ├── GET /products/:id
│   ├── POST /products (create)
│   ├── PUT /products/:id (update)
│   ├── DELETE /products/:id
│   ├── POST /products/:id/sync-to-shopify
│   └── POST /products/:id/publish-to-shopify
├── /variants
│   ├── GET /products/:productId/variants
│   ├── POST /products/:productId/variants
│   ├── PUT /variants/:id
│   └── DELETE /variants/:id
├── /media
│   ├── GET /media (list with filtering by state, type)
│   ├── GET /media/:id
│   ├── POST /media/upload-raw (multipart upload)
│   ├── POST /media/:id/upload-edited (multipart upload)
│   ├── PUT /media/:id (update metadata)
│   ├── DELETE /media/:id
│   ├── POST /media/:id/submit-for-encoding (video only)
│   ├── GET /media/:id/encoding-status (poll encoding job)
│   └── POST /media/:id/mark-ready (move to ready_for_publish)
├── /product-media
│   ├── POST /products/:productId/media (associate media)
│   ├── PUT /product-media/:id (update association)
│   ├── DELETE /product-media/:id (remove association)
│   └── PUT /products/:productId/media/reorder (reorder gallery)
├── /shopify
│   ├── POST /shopify/import-products (bulk import from Shopify)
│   ├── POST /shopify/import-product/:shopifyId
│   └── GET /shopify/sync-status
├── /import
│   ├── POST /import/google-drive (initiate import job)
│   ├── GET /import/jobs/:id (check import progress)
│   └── POST /import/map-folders (map GDrive folders to products)
└── /admin
    ├── GET /admin/users
    ├── PUT /admin/users/:id/role
    └── GET /admin/logs
```

### Frontend Application Structure

```
/src
├── /components
│   ├── /auth
│   │   ├── LoginButton.tsx
│   │   ├── LogoutButton.tsx
│   │   └── ProtectedRoute.tsx
│   ├── /products
│   │   ├── ProductList.tsx
│   │   ├── ProductCard.tsx
│   │   ├── ProductDetail.tsx
│   │   ├── ProductEditor.tsx
│   │   └── ProductVariantEditor.tsx
│   ├── /media
│   │   ├── MediaLibrary.tsx
│   │   ├── MediaUploader.tsx
│   │   ├── MediaCard.tsx
│   │   ├── MediaEditor.tsx
│   │   ├── ImageEditor.tsx (basic crop/resize)
│   │   └── VideoEncoder.tsx
│   ├── /associations
│   │   ├── ProductMediaManager.tsx
│   │   └── MediaAssociationModal.tsx
│   ├── /import
│   │   ├── GoogleDriveImporter.tsx
│   │   ├── ShopifyImporter.tsx
│   │   └── FolderMappingTool.tsx
│   └── /common
│       ├── Button.tsx
│       ├── Modal.tsx
│       ├── Table.tsx
│       ├── FileUpload.tsx
│       └── StatusBadge.tsx
├── /pages
│   ├── Dashboard.tsx
│   ├── ProductsPage.tsx
│   ├── ProductDetailPage.tsx
│   ├── MediaLibraryPage.tsx
│   ├── ImportPage.tsx
│   └── AdminPage.tsx
├── /hooks
│   ├── useAuth.ts
│   ├── useProducts.ts
│   ├── useMedia.ts
│   └── useFileUpload.ts
├── /services
│   ├── api.ts (axios instance)
│   ├── auth.ts (Auth0 integration)
│   ├── shopify.ts
│   ├── storage.ts (Storj S3 operations)
│   └── videoEncoding.ts
├── /contexts
│   └── AuthContext.tsx
└── /utils
    ├── validation.ts
    └── formatting.ts
```

## Implementation Phases

### Phase 1: Foundation & Authentication (Week 1)
**Goal**: Set up project structure, database, and authentication

1. **Project Setup**
   - Initialize monorepo or separate repos for frontend/backend
   - Set up Vercel deployment configs
   - Configure Supabase PostgreSQL database
   - Set up Storj S3 bucket and credentials

2. **Database Setup**
   - Create all tables with migrations
   - Set up Supabase Row Level Security (RLS) policies
   - Create database functions/triggers for updated_at timestamps
   - Set up audit logging triggers

3. **Authentication**
   - Configure Auth0 tenant with Google OAuth
   - Implement Auth0 integration in backend
   - Create Auth0 React SDK integration
   - Build login/logout flow
   - Implement role-based access control (RBAC) middleware
   - Create user management endpoints

4. **Basic Frontend Shell**
   - Set up React app with routing
   - Create layout components (header, sidebar, nav)
   - Implement protected routes
   - Build basic dashboard page

**Deliverable**: Working app with authentication, empty dashboard

### Phase 2: Shopify Integration & Product Import (Week 2)
**Goal**: Import existing products from Shopify

1. **Shopify API Client**
   - Create GraphQL client for Shopify Admin API
   - Implement rate limiting/throttling
   - Build query/mutation wrappers for products
   - Build query/mutation wrappers for variants

2. **Import Service**
   - Build bulk import from Shopify
   - Map Shopify products to database schema
   - Import products with variants
   - Handle pagination for large datasets
   - Store sync timestamps

3. **Product CRUD Operations**
   - Build product list API with filtering/pagination
   - Build product detail API
   - Build product update API
   - Create sync-to-shopify endpoint (update existing)

4. **Product UI**
   - Build product list page with search/filter
   - Build product detail/editor page
   - Create variant editor component
   - Implement product metadata editor (tags, dimensions, weight)

**Deliverable**: Can import and view all Shopify products, basic editing

### Phase 3: Media Management Core (Week 3)
**Goal**: Upload, store, and manage media assets

1. **Storage Service**
   - Configure Storj S3 client
   - Implement signed URL generation for uploads
   - Implement signed URL generation for downloads
   - Build file upload handlers (multipart)
   - Create thumbnail generation service (images)

2. **Media API**
   - Build media upload endpoints (raw, edited)
   - Build media list/detail endpoints
   - Implement media metadata update
   - Create media deletion (with orphan checks)
   - Build media state transition endpoints

3. **Media Library UI**
   - Build media library page with grid/list views
   - Create media upload component (drag & drop)
   - Build media card with preview
   - Create media detail/editor modal
   - Implement workflow state visualization
   - Add filtering by state, type, date

4. **Basic Image Handling**
   - Display image previews
   - Show image metadata (dimensions, size)
   - Allow alt text editing

5. **Image Editing Tools**
   - Integrate `react-image-crop` component
   - Build backend endpoint with `sharp` for processing
   - Implement crop, resize, rotate operations
   - Save edited version to Storj
   - Preview edited image before saving

6. **Video Editing Tools**
   - Set up `fluent-ffmpeg` on backend (requires ffmpeg binary)
   - Build trim/cut endpoint (specify start/end timestamps)
   - Build stitch endpoint (combine intro/video/outro)
   - Create video preview player
   - Save edited version to Storj

**Deliverable**: Can upload images and videos, view in library, edit metadata, perform basic editing

### Phase 4: Product-Media Association (Week 4)
**Goal**: Connect media assets to products

1. **Association API**
   - Build endpoints to associate media with products
   - Build endpoints to associate media with variants
   - Implement position/ordering for galleries
   - Create batch association endpoints
   - Build media reordering endpoint

2. **Association UI**
   - Create media association modal/drawer
   - Build drag-and-drop media gallery editor
   - Create variant media selector
   - Implement hero image selector
   - Build shared media indicator (shows where media is used)

3. **Product Detail Enhancement**
   - Show associated media in product detail
   - Display variant-specific media
   - Show media workflow states
   - Create inline media upload from product page

**Deliverable**: Can associate media with products, set hero images, reorder galleries

### Phase 5: Google Drive Import (Week 5)
**Goal**: Migrate existing media from Google Drive

1. **Google Drive Integration**
   - Set up Google Drive API credentials
   - Build folder traversal service
   - Implement file download from Drive
   - Create folder → product mapping tool

2. **Import Service**
   - Build mapping UI (folder name → Shopify Product ID)
   - Create bulk download from Drive
   - Upload files to Storj
   - Create media_assets records
   - Auto-associate with products based on mapping
   - Track import progress/status

3. **Import UI**
   - Build import wizard
   - Create folder mapping interface
   - Show import progress
   - Display import results/errors
   - Allow retry of failed imports

**Deliverable**: Can import all media from Google Drive folders to PIM

### Phase 6: Video Encoding Integration (Week 6)
**Goal**: Handle video encoding workflow

1. **Video Encoding Service**
   - Create GraphQL client for encoding API
   - Build upload endpoint (get upload URL from API, upload edited video)
   - Generate unique video names (e.g., `product-{shopify_id}-{timestamp}`)
   - Submit video with name for encoding
   - Implement polling mechanism to query video by name
   - Parse response to extract encoded video URL
   - Store encoded URL in `media_assets.encoded_video_url`
   - Update workflow state to 'encoded'

2. **Video Workflow UI**
   - Create video upload flow (raw → edited)
   - Build "Submit for Encoding" button
   - Show encoding progress/status
   - Display encoded video preview
   - Allow marking as ready for publish

3. **Video Player**
   - Integrate video player component
   - Show video metadata (duration, resolution)
   - Display encoding status

**Deliverable**: Complete video workflow from upload to encoded URL

### Phase 7: Shopify Publishing (Week 7)
**Goal**: Publish products and media to Shopify

1. **Publishing Service**
   - Build product publish/unpublish to Shopify
   - Implement media upload to Shopify
   - Handle Shopify media associations
   - Create product update sync (description, tags, etc.)
   - Build variant sync
   - Implement conflict resolution (handle changes on Shopify side)

2. **Publishing UI**
   - Create "Publish to Shopify" button
   - Build publish preview (show what will change)
   - Display publish status
   - Show sync history
   - Create "Unpublish from Shopify" action

3. **Sync Management**
   - Build sync status dashboard
   - Show last sync time per product
   - Display sync errors
   - Create manual re-sync trigger

**Deliverable**: Can publish complete products with media to Shopify

### Phase 8: Polish & Admin Features (Week 8)
**Goal**: Complete admin features, improve UX

1. **Admin Panel**
   - Build user management UI
   - Create role assignment
   - Display audit logs
   - Show sync logs
   - Create system health dashboard

2. **Enhanced Filtering & Search**
   - Add full-text search for products
   - Create advanced filters (tags, status, date ranges)
   - Build saved filter presets
   - Implement bulk operations

3. **UX Improvements**
   - Add loading states
   - Implement error handling/toast notifications
   - Create keyboard shortcuts
   - Add bulk selection
   - Build undo/redo for critical operations

4. **Documentation**
   - Write user guide
   - Create API documentation
   - Document deployment process
   - Write troubleshooting guide

**Deliverable**: Production-ready PIM system

## Security Considerations

### Authentication & Authorization
- Auth0 JWT validation on all API endpoints
- Role-based access control (RBAC)
  - **Admin**: Full access
  - **Photographer**: Upload/edit media, view products
  - **Writer**: Edit product descriptions, manage metadata, view media
  - **Viewer**: Read-only access
- Supabase RLS policies to enforce data access

### File Storage
- Signed URLs with expiration for Storj uploads/downloads
- Validate file types and sizes on upload
- Scan for malware (optional: integrate ClamAV or similar)
- Separate buckets for raw vs. published media

### API Security
- Rate limiting on API endpoints
- CORS configuration for frontend origin only
- Input validation and sanitization
- SQL injection prevention (parameterized queries)
- XSS prevention (sanitize HTML input)

### Secrets Management
- Store API keys in environment variables
- Use Vercel environment variables for deployment
- Rotate Shopify access tokens periodically
- Never commit secrets to git

## Performance Considerations

### Database
- Indexes on foreign keys and frequently queried columns
- Pagination for large result sets (products, media)
- Consider materialized views for complex queries
- Use JSONB for flexible metadata (with GIN indexes if needed)

### File Storage
- Generate thumbnails for images (100x100, 400x400)
- Use CDN in front of Storj for faster delivery
- Lazy load images in UI
- Implement progressive image loading

### API
- Cache frequently accessed data (products list)
- Use React Query for client-side caching
- Implement debouncing for search inputs
- Consider Redis for session/cache storage (if needed)

### Shopify API
- Respect rate limits (cost-based throttling)
- Batch operations where possible
- Cache Shopify data with appropriate TTL
- Implement exponential backoff for retries

## Media Editing Features

### Image Editing (Built-in, Basic)
**Libraries**: `react-image-crop` (frontend) + `sharp` (backend processing)

**Features**:
- Crop to custom dimensions or aspect ratios
- Resize/scale
- Rotate (90°, 180°, 270°)
- Preview before save
- Non-destructive (keeps original raw file)

**Implementation**:
- Frontend: React component with `react-image-crop` for interactive cropping
- Backend: `sharp` library to process and save edited version
- Store both raw and edited versions in Storj
- Update `media_assets.edited_file_url` on save

### Video Editing (Built-in, Basic)
**Libraries**: `ffmpeg.wasm` (browser-based) or `fluent-ffmpeg` (server-side)

**Features**:
- Trim start/end (cut beginning and end)
- Stitch intro/outro clips (add leadins/leadouts)
- Preview trimmed video
- Non-destructive (keeps original raw file)

**Implementation**:
- Option 1: `ffmpeg.wasm` - runs in browser, no server load, slower for large files
- Option 2: `fluent-ffmpeg` on backend - faster, requires ffmpeg binary on server
- Recommended: Use `fluent-ffmpeg` on backend for better performance
- Store raw, edited, and encoded versions separately
- Update workflow: raw → edited (trimmed/stitched) → submit for encoding → encoded

**Video Workflow Enhancement**:
```
1. Upload raw video → Storj (raw_file_url)
2. Download, trim/stitch in PIM → Save edited version (edited_file_url)
3. Submit edited version to encoding API with name
4. Poll/query encoding API by name for completion
5. Retrieve encoded URL → Store in encoded_video_url
6. Mark as ready_for_publish → Publish to Shopify
```

### Video Encoding API Integration

**Endpoint**: `https://kink-video.kink-video.cluster.kinkstorage.com/graphql`
**Authentication**: JWT (Auth0)
**API Type**: GraphQL

#### Naming Convention (internalName)

Videos are tracked by an `internalName` handle we generate:
```
{sku_label}--{media_asset_uuid}
```
**Example**: `RSV-V-PRODUCTXYZ--550e8400-e29b-41d4-a716-446655440000`

- `sku_label` prefix enables searching all videos for a product
- Double dash `--` separates cleanly (SKUs may contain single dashes)
- UUID suffix guarantees uniqueness and links back to our record

#### Key Mutations
- `startVideoUpload(content, internalName)` → Returns `{ id, url }` for upload
- `finishVideoUpload(videoId)` → Triggers encoding after upload complete

#### Key Queries
- `video(videoId)` → Get single video by ID (fast, direct lookup)
- `videos(searchTerm)` → Search by internalName (find all videos for a SKU)

#### Response Structure
```graphql
TranscodedVideo {
  id: ID!
  internalName: String
  status: FileUploadingStatus  # Uploaded | NotUploaded
  videoAssets: [{ id, url, format, type }]  # Encoded outputs
  imageAssets: [{ id, url, resolution }]    # Generated thumbnails
}
```

#### Implementation
- Generate `internalName`: `{sku_label}--{media_asset.id}`
- Call `startVideoUpload` → get upload URL and video ID
- Upload file to returned URL
- Call `finishVideoUpload` to trigger encoding
- Store in `media_assets`:
  - `encoding_handle` = our internalName
  - `encoding_video_id` = API-returned ID
- Poll `video(videoId)` until `status = "Uploaded"`
- Extract `videoAssets[0].url` → store in `encoded_video_url`
- Update `workflow_state` to `'encoded'`

## Media Versioning & Historical Asset Management

### Problem Statement
The current folder-based system (e.g., `RSV-B-FILLER-PLUG/`) organizes media by workflow stage in nested folders:
```
RSV-B-FILLER-PLUG/
├── Photos/
│   ├── Raw Captures/              # Original photographer uploads
│   ├── New Raw Captures/          # New photography session
│   ├── Final ECOM Product Photos/ # Edited, ready for ecommerce
│   │   └── new version/           # Re-edited versions
│   └── PSD Cutouts/               # Project files (Photoshop)
├── Videos/
│   ├── Project Files/             # Raw video project files
│   └── Final ECOM Videos/         # Edited, ready for ecommerce
└── Description.docx               # Product copy
```

**Requirements**:
1. Keep all source/raw images together as a set
2. Keep all edited images together as a set
3. Know the relationship between the two sets (folder-level, not file-level)
4. Use SKU as descriptive label (not as database key)

### Solution: Simple Set-Based Organization

#### Core Concept

**Asset Collections** - Group files by product and workflow stage:
- Each product (identified by Shopify Product ID) has associated media
- Media is organized into logical sets: "raw photos", "edited photos", "project files", etc.
- No need to track individual file lineage (raw file X → edited file Y)
- Folder structure preserved in cloud storage for easy browsing

#### Simplified Approach

**What we track:**
- ✅ Which product does this media belong to?
- ✅ What stage is this media in? (raw, edited, project file)
- ✅ Where did it come from originally? (folder path for reference)
- ✅ What's a human-readable label? (SKU like "RSV-B-FILLER-PLUG")

**What we DON'T track:**
- ❌ Individual file-to-file relationships (this raw → that edited)
- ❌ Version numbers for each file
- ❌ Parent-child lineage chains
- ❌ Active/inactive version flags per file

#### Migration Strategy - Simple Import

When importing from Google Drive folders like `RSV-B-FILLER-PLUG/`:

**Step 1: Map folder to product**
```
Folder: RSV-B-FILLER-PLUG
→ Maps to Shopify Product ID: 7891234567890
→ Descriptive label: "RSV-B-FILLER-PLUG" (stored for human reference)
```

**Step 2: Import all files, preserving folder structure**
```sql
-- Raw photo example
INSERT INTO media_assets (
  media_type: 'image',
  workflow_state: 'raw',
  raw_file_url: 'https://storj.../products/RSV-B-FILLER-PLUG/photos/raw/DSC09935.JPG',
  raw_file_key: 'products/RSV-B-FILLER-PLUG/photos/raw/DSC09935.JPG',
  workflow_category: 'raw_capture',
  source_folder_path: 'Photos/New Raw Captures',
  original_filename: 'DSC09935.JPG',
  google_drive_folder_path: 'RSV-B-FILLER-PLUG/Photos/New Raw Captures'
);

-- Link to product
INSERT INTO product_media (
  product_id: <product-uuid>,
  media_asset_id: <media-uuid>,
  association_type: 'raw_source'
);

-- Edited photo example
INSERT INTO media_assets (
  media_type: 'image',
  workflow_state: 'ready_for_publish',
  edited_file_url: 'https://storj.../products/RSV-B-FILLER-PLUG/photos/edited/filler-plug-3.jpg',
  edited_file_key: 'products/RSV-B-FILLER-PLUG/photos/edited/filler-plug-3.jpg',
  workflow_category: 'final_ecom',
  source_folder_path: 'Photos/Final ECOM Product Photos/new version',
  original_filename: 'filler plug 3.jpg',
  google_drive_folder_path: 'RSV-B-FILLER-PLUG/Photos/Final ECOM Product Photos/new version'
);

-- Link to product
INSERT INTO product_media (
  product_id: <product-uuid>,
  media_asset_id: <media-uuid>,
  association_type: 'product_gallery'
);
```

**That's it!** No complex linking, no version tracking, no parent-child relationships.

#### UI/UX for Asset Management

**Product Detail Page - Media Tab**
```
Product: RSV-B-FILLER-PLUG (SKU label)
Shopify Product ID: 7891234567890

[ASSIGNED TO PRODUCT - Will be Published] (5 images)
  ★ filler plug 3.jpg (Hero - Position 1)
  2. filler plug 4.jpg
  3. filler plug 5.jpg
  4. filler plug 6.jpg
  5. filler plug 7.jpg
  [Reorder Gallery] [Remove from Product] [Set as Hero]

[MEDIA BUCKET - Available for Selection] (12 images total)
  Images in bucket RSV-B-FILLER-PLUG/ (highlighted, suggested):
    - filler plug 1.jpg [+ Assign]
    - filler plug 2.jpg [+ Assign]
    - DSC09935.jpg (raw) [+ Assign]
    ...
  [Browse All Buckets] [Upload New]

[Raw Source Photos] (10 images) - collapsed by default
  Click to expand and browse all raw captures
  [Download All as ZIP] [Browse]

[Project Files] (1 file) - collapsed by default
  - filler plug 4 FA.psd
  [Download]
```

**Key UI Behavior:**
- "Assigned to Product" section shows what WILL be published (from `product_media_associations`)
- "Media Bucket" section shows what's AVAILABLE (from `media_assets` in the bucket)
- Images from the matching SKU bucket are highlighted/suggested
- Users CAN assign images from other buckets if needed

**Media Library - Product Filter View**
```
Filter by Product: RSV-B-FILLER-PLUG

Raw Sources (10 files)
  From: Photos/New Raw Captures
  [Browse Thumbnails]

Edited Photos (7 files)
  From: Photos/Final ECOM Product Photos/new version
  [Browse Thumbnails] [Select for Publishing]

Project Files (1 file)
  From: Photos/PSD Cutouts
  [Download]

Note: "Raw sources came from New Raw Captures folder"
      (folder-level relationship preserved)
```

**Media Library - Simple Filters**
```
[ By Product | By Type | By Workflow Stage ]

Workflow Stages:
- Raw Sources (all raw captures)
- Edited/Final (ready for publishing)
- Project Files (PSDs, project files)

Group by:
- Product (shows sets: "RSV-B-FILLER-PLUG: 10 raw, 7 edited")
- Date uploaded
- Folder source
```

#### Storj File Organization

Preserve logical folder structure on Storj:
```
storj://kinkstore-pim/
├── products/
│   └── RSV-B-FILLER-PLUG/
│       ├── photos/
│       │   ├── raw/
│       │   │   ├── DSC09935.JPG
│       │   │   ├── DSC09937.JPG
│       │   │   └── ...
│       │   ├── edited/
│       │   │   ├── DSC09935-v2.jpg
│       │   │   ├── DSC09935-v3.jpg
│       │   │   └── ...
│       │   └── project/
│       │       ├── filler-plug-4.psd
│       │       └── ...
│       └── videos/
│           ├── raw/        ← Source video files
│           ├── edited/     ← Trimmed/stitched (pre-encoding)
│           └── project/    ← Video project files
```

**Note**: Encoded videos are NOT stored in Storj. They are hosted by the external encoding service; we store only the URL in `media_assets.encoded_video_url`.

#### Class Interfaces

**MediaBucket Class (Organizational/Storage)**

The `MediaBucket` domain class provides API for browsing available media:

```typescript
class MediaBucket {
  id: string;
  productId: string;
  skuLabel: string;
  storjPath: string;

  // Cached counts (from media_buckets table)
  rawAssetCount: number;
  editedAssetCount: number;
  projectFileCount: number;
  totalAssetCount: number;

  // Query methods - what's IN the bucket (available for selection)
  async getAllAssets(): Promise<MediaAsset[]>;
  async getEditedAssets(): Promise<MediaAsset[]>;  // workflow_state IN ('edited', 'ready_for_publish')
  async getRawSources(): Promise<MediaAsset[]>;     // workflow_state = 'raw'
  async getProjectFiles(): Promise<MediaAsset[]>;   // workflow_category = 'project_file'

  // Filtering
  async getAssetsByWorkflowState(state: WorkflowState): Promise<MediaAsset[]>;
  async getAssetsByType(type: 'image' | 'video'): Promise<MediaAsset[]>;
}
```

**ProductMediaAssociation Class (Publishing/Assignment)**

The `ProductMediaAssociation` class manages what gets published:

```typescript
class ProductMediaAssociation {
  // Query what's ASSIGNED to a product (will be published)
  static async getProductImages(productId: string): Promise<MediaAsset[]>;  // Ordered by position
  static async getProductHero(productId: string): Promise<MediaAsset | null>;  // Position 1
  static async getProductVideos(productId: string): Promise<MediaAsset[]>;
  static async getVariantHero(variantId: string): Promise<MediaAsset | null>;

  // Assignment operations
  static async assignImage(productId: string, mediaAssetId: string, position: number): Promise<void>;
  static async assignVideo(productId: string, mediaAssetId: string, position?: number): Promise<void>;
  static async setVariantHero(productId: string, variantId: string, mediaAssetId: string): Promise<void>;
  static async removeAssignment(associationId: string): Promise<void>;
  static async reorderImages(productId: string, orderedAssetIds: string[]): Promise<void>;
}
```

**Usage Examples:**
```typescript
// BROWSING: Get available images from bucket
const bucket = await MediaBucket.findBySkuLabel('RSV-V-PRODUCTXYZ');
const availableImages = await bucket.getEditedAssets();
console.log(`${availableImages.length} images available for selection`);

// PUBLISHING: Get what's assigned to product
const assignedImages = await ProductMediaAssociation.getProductImages(productId);
console.log(`${assignedImages.length} images will be published`);

// ASSIGNMENT: Add an image to the product
await ProductMediaAssociation.assignImage(productId, mediaAssetId, 3);

// HERO: Set product hero (position 1)
await ProductMediaAssociation.assignImage(productId, heroImageId, 1);

// VARIANT HERO: Set hero for a specific variant
await ProductMediaAssociation.setVariantHero(productId, variantId, variantHeroImageId);
```

#### Key SQL Queries

**PUBLISHING QUERIES (What gets published to Shopify):**
```sql
-- Get images ASSIGNED to a product (will be published)
SELECT ma.*, pma.position
FROM product_media_associations pma
JOIN media_assets ma ON ma.id = pma.media_asset_id
WHERE pma.product_id = '<product-uuid>'
  AND pma.association_type = 'product_image'
  AND pma.is_published = TRUE
ORDER BY pma.position;
-- Position 1 = Hero image

-- Get product hero image
SELECT ma.*
FROM product_media_associations pma
JOIN media_assets ma ON ma.id = pma.media_asset_id
WHERE pma.product_id = '<product-uuid>'
  AND pma.association_type = 'product_image'
  AND pma.position = 1;

-- Get variant hero image
SELECT ma.*
FROM product_media_associations pma
JOIN media_assets ma ON ma.id = pma.media_asset_id
WHERE pma.variant_id = '<variant-uuid>'
  AND pma.association_type = 'variant_hero';

-- Get videos assigned to a product
SELECT ma.*, pma.position
FROM product_media_associations pma
JOIN media_assets ma ON ma.id = pma.media_asset_id
WHERE pma.product_id = '<product-uuid>'
  AND pma.association_type = 'product_video'
ORDER BY pma.position;
```

**BUCKET QUERIES (What's available in storage):**
```sql
-- Get all assets in a bucket (for browsing/selection UI)
SELECT ma.*
FROM media_assets ma
JOIN media_buckets mb ON mb.id = ma.media_bucket_id
WHERE mb.sku_label = 'RSV-V-PRODUCTXYZ'
ORDER BY ma.workflow_state, ma.original_filename;

-- Get edited assets available for assignment
SELECT ma.*
FROM media_assets ma
JOIN media_buckets mb ON mb.id = ma.media_bucket_id
WHERE mb.sku_label = 'RSV-V-PRODUCTXYZ'
  AND ma.workflow_state IN ('edited', 'ready_for_publish')
ORDER BY ma.original_filename;

-- Get raw sources
SELECT ma.*
FROM media_assets ma
JOIN media_buckets mb ON mb.id = ma.media_bucket_id
WHERE mb.sku_label = 'RSV-V-PRODUCTXYZ'
  AND ma.workflow_state = 'raw'
ORDER BY ma.created_at;

-- Get bucket stats (fast, cached)
SELECT * FROM media_buckets WHERE sku_label = 'RSV-V-PRODUCTXYZ';
```

**ASSIGNMENT OPERATIONS:**
```sql
-- Assign an image to a product
INSERT INTO product_media_associations (product_id, media_asset_id, association_type, position, is_published)
VALUES ('<product-uuid>', '<media-asset-uuid>', 'product_image', 3, TRUE);

-- Set variant hero (from an image already assigned to the product)
INSERT INTO product_media_associations (product_id, media_asset_id, variant_id, association_type, is_published)
VALUES ('<product-uuid>', '<media-asset-uuid>', '<variant-uuid>', 'variant_hero', TRUE);

-- Reorder images (update positions)
UPDATE product_media_associations SET position = 1 WHERE id = '<pma-uuid-1>';
UPDATE product_media_associations SET position = 2 WHERE id = '<pma-uuid-2>';
```

#### Benefits

1. **Simple & Fast**: No complex version tracking or manual linking required
2. **Set-Based Organization**: Raw sources stay together, edited photos stay together
3. **Folder Context Preserved**: Know that "edited photos came from New Raw Captures folder"
4. **SKU as Label**: Human-readable "RSV-B-FILLER-PLUG" label for easy reference (not used as key)
5. **Clean Migration**: Straightforward import - just copy files and associate with product
6. **Easy Browsing**: "Show me all raw sources for this product" or "Show me finished photos"
7. **Project Files Included**: PSDs and project files stored alongside, grouped by product
8. **No Unnecessary Complexity**: Tracks only what's actually needed for the workflow
9. **Flexible Queries**: Easy to find "all edited photos" or "all raw sources" for a product
10. **Storage Efficient**: Folder structure on Storj mirrors original organization

## Product-Variant Media Strategy

### Confirmed Requirements

Based on actual workflow:

1. **Products have multiple variants** (sizes, colors, etc.)
2. **All variants share same media pool** - One media bucket per product
3. **Variant hero images** - Each variant can have ONE designated hero image from the shared pool
4. **Folder consolidation** - Even if historically split (e.g., `PRODUCT-BLACK/`, `PRODUCT-RED/`), consolidate to single `PRODUCT/` folder at import

### SKU Naming Convention

**Important**: The internal naming convention uses a **product-level SKU label** that does NOT exist in Shopify:

**Example:**
```
Shopify Variants (actual SKUs in Shopify):
  - RSV-V-PRODUCTXYZ-S   (Small)
  - RSV-V-PRODUCTXYZ-M   (Medium)
  - RSV-V-PRODUCTXYZ-L   (Large)

PIM Product SKU Label (internal only, NOT in Shopify):
  - RSV-V-PRODUCTXYZ     (base name without size suffix)

Google Drive Folder:
  - RSV-V-PRODUCTXYZ/    (matches PIM product SKU label)

Storj Media Bucket:
  - products/RSV-V-PRODUCTXYZ/  (matches PIM product SKU label)
```

**Why this works:**
- ✅ Human-readable grouping for products with variants
- ✅ Matches existing Google Drive folder structure
- ✅ Clear media organization (one bucket per product)
- ✅ Easy to derive: strip size/color suffix from any variant SKU
- ✅ Products table `sku_label` field stores this internal label
- ⚠️ **Does not match any Shopify SKU** - only variants have SKUs in Shopify

### How This Works in the Schema

**Product-level images** (assigned for publishing):
```sql
-- Get images assigned to a product (will be published to Shopify)
SELECT ma.*, pma.position
FROM product_media_associations pma
JOIN media_assets ma ON ma.id = pma.media_asset_id
WHERE pma.product_id = '<product-uuid>'
  AND pma.association_type = 'product_image'
ORDER BY pma.position;
-- Position 1 = Hero image (also used as variant[0] hero for single-variant products)
```

**Variant hero images** (one per variant):
```sql
-- Set hero image for Medium size variant
INSERT INTO product_media_associations (
  product_id, media_asset_id, variant_id, association_type, is_published
) VALUES (
  '<product-uuid>',
  '<specific-image-uuid>',
  '<variant-M-uuid>',
  'variant_hero',
  TRUE
);
```

### UI Workflow

**Product Detail Page:**
```
Product: RSV-B-FILLER-PLUG
Variants: M, L, XL

[ASSIGNED IMAGES - Will Publish to Shopify] (5 images)
  ★ filler plug 3.jpg (Hero - Position 1)
  2. filler plug 4.jpg
  3. filler plug 5.jpg
  4. filler plug 6.jpg
  5. filler plug 7.jpg
  [Reorder Gallery] [Remove]

[AVAILABLE IN BUCKET RSV-B-FILLER-PLUG/] (12 images)
  Suggested images from this SKU's bucket:
  - DSC09935.jpg [+ Assign]
  - DSC09936.jpg [+ Assign]
  [Browse All Buckets]

[Variant Hero Images]
  M:  [Select from assigned ▼] → filler plug 3.jpg
  L:  [Select from assigned ▼] → filler plug 4.jpg
  XL: [Select from assigned ▼] → filler plug 5.jpg
```

**Important**: Variant heroes must be selected from images already assigned to the product.

**Import Examples:**

**Example 1: Consolidation of variant-split folders**
```
Historical folders:
  RSV-B-FILLER-PLUG-BLACK/
  RSV-B-FILLER-PLUG-RED/

Import as:
  RSV-B-FILLER-PLUG/ (consolidated, matches internal SKU label)
    ├── Photos/Raw Captures/        (from both folders)
    ├── Photos/Final ECOM/          (from both folders)
    └── ... all media in one bucket

Then assign hero images:
  Black variant (SKU: RSV-B-FILLER-PLUG-BLACK) → hero: black-photo.jpg
  Red variant (SKU: RSV-B-FILLER-PLUG-RED) → hero: red-photo.jpg
```

**Example 2: Product with size variants**
```
Shopify product has variants:
  - RSV-V-PRODUCTXYZ-S (Small)
  - RSV-V-PRODUCTXYZ-M (Medium)
  - RSV-V-PRODUCTXYZ-L (Large)

Google Drive folder:
  RSV-V-PRODUCTXYZ/  ← Note: no size suffix

PIM system:
  products.sku_label = "RSV-V-PRODUCTXYZ"
  Media bucket: products/RSV-V-PRODUCTXYZ/

All three variants share the same media pool and can each select their hero image.
```

### Benefits of This Approach

1. **Shopify-aligned** - Matches Shopify's product/variant media model exactly
2. **Explicit publishing** - Clear distinction between "available" (bucket) and "assigned" (will publish)
3. **Flexible** - Can assign images from any bucket, not just the matching SKU
4. **Hero selection** - Each variant gets its distinctive hero image
5. **No duplication** - Shared images stored once, referenced multiple times
6. **Easy consolidation** - Historical folder splits merge cleanly
7. **Future-proof** - Buckets can exist without products; publishing points can expand

## Open Questions / TBD

1. **Collection Media**
   - Do you need collection management now or future phase?
   - Should collections be imported from Shopify?

2. **Backup Strategy**
   - Automated database backups via Supabase
   - Storj versioning enabled?
   - Point-in-time recovery requirements?

3. **Monitoring & Alerts**
   - Error tracking (Sentry, LogRocket)?
   - Uptime monitoring?
   - Alert on sync failures?

## Cost Estimates (Monthly)

- **Vercel**: $20/month (Pro plan) or $0 (Hobby, if within limits)
- **Supabase**: $25/month (Pro plan for better performance) or $0 (Free tier for testing)
- **Storj**: ~$4/TB/month storage + $7/TB bandwidth (depends on usage)
- **Auth0**: $0 (Free tier for up to 7,000 active users)
- **Video Encoding API**: TBD based on provider

**Estimated Total**: $50-100/month depending on storage and usage

## Success Metrics

- All ~1,000 products imported from Shopify ✓
- All media migrated from Google Drive ✓
- 5-10 users can log in and manage products ✓
- Media workflow (upload → edit → publish) functional ✓
- Products can be published to Shopify with media ✓
- System handles media sharing across products ✓
- Role-based access working correctly ✓

## Next Steps

Once this plan is approved:
1. Create project repositories (monorepo or separate repos)
2. Set up Supabase project and run migrations
3. Configure Auth0 tenant
4. Set up Storj bucket
5. Begin Phase 1 implementation

---

**Plan Version**: 1.1
**Last Updated**: 2025-12-05
**Status**: Awaiting Approval

### Changelog
- **v1.1** (2025-12-05): Clarified that `product_media_associations` is the source of truth for publishing. Bucket membership is now purely organizational; images must be explicitly assigned to be published. Added `product_id` as required field on associations. Updated UI patterns to show "Assigned" vs "Available" sections.

# Database Schema - Entity Relationship Diagram

## Core Entity Relationships

```mermaid
erDiagram
    products ||--o{ product_variants : "has many"
    products ||--|| media_buckets : "has one (organizational)"

    media_buckets ||--o{ media_assets : "contains (storage)"

    products ||--o{ product_media_associations : "publishing assignments"
    product_variants ||--o{ product_media_associations : "variant hero (optional)"
    media_assets ||--o{ product_media_associations : "assigned media"

    users ||--o{ media_assets : "uploads/edits"
    users ||--o{ sync_logs : "performs"
    users ||--o{ audit_logs : "performs"

    products {
        uuid id PK "Primary Key"
        bigint shopify_product_id UK "UNIQUE - Shopify ID"
        varchar sku_label UK "UNIQUE - Internal label"
        varchar title "NOT NULL"
        text description
        varchar vendor
        varchar product_type
        text[] tags
        varchar status "PIM status: draft, active, archived"
        varchar shopify_status "Shopify: ACTIVE, DRAFT, ARCHIVED"
        timestamp shopify_published_at "When published to Shopify"
        jsonb metadata "Shopify metafields (see below)"
        timestamp created_at
        timestamp updated_at
        timestamp last_synced_at "Last sync with Shopify"
    }

    product_variants {
        uuid id PK "Primary Key"
        uuid product_id FK "FK -> products.id"
        bigint shopify_variant_id UK "UNIQUE"
        varchar sku UK "UNIQUE - Shopify SKU"
        varchar title
        decimal price
        decimal weight
        jsonb dimensions
        int inventory_quantity
        varchar option1
        varchar option2
        varchar option3
    }

    media_buckets {
        uuid id PK "Primary Key"
        uuid product_id FK "FK -> products.id (UNIQUE)"
        varchar sku_label UK "UNIQUE - matches products.sku_label"
        varchar bucket_status
        varchar storj_path "NOT NULL"
        int raw_asset_count "Cached count"
        int edited_asset_count "Cached count"
        int project_file_count "Cached count"
        int total_asset_count "Cached count"
        bigint total_size_bytes "Cached"
        timestamp last_upload_at
        timestamp last_publish_at
    }

    media_assets {
        uuid id PK "Primary Key"
        uuid media_bucket_id FK "FK -> media_buckets.id, NOT NULL"
        varchar media_type "NOT NULL: image, video"
        varchar workflow_state "NOT NULL: raw, edited, encoded, published"
        varchar file_url "NOT NULL - Storj URL"
        varchar file_key "NOT NULL - Storj path"
        bigint file_size
        varchar encoding_handle "Video only: sku_label--uuid"
        varchar encoding_video_id "Video only: API-returned ID"
        varchar encoded_video_url "Video only: EXTERNAL URL (not Storj)"
        jsonb video_metadata
        jsonb image_metadata
        text alt_text
        varchar title
        varchar original_filename "NOT NULL"
        varchar workflow_category "NOT NULL: raw_capture, final_ecom, project_file"
        uuid uploaded_by FK "FK -> users.id"
        uuid edited_by FK "FK -> users.id"
        varchar google_drive_file_id "LEGACY"
        varchar google_drive_folder_path "LEGACY"
        uuid import_batch_id
    }

    product_media_associations {
        uuid id PK "Primary Key"
        uuid product_id FK "FK -> products.id, NOT NULL"
        uuid media_asset_id FK "FK -> media_assets.id, NOT NULL"
        uuid variant_id FK "FK -> product_variants.id, NULL for product-level"
        varchar association_type "NOT NULL: product_image, product_video, variant_hero"
        int position "Gallery order (1 = hero)"
        boolean is_published "Default: true"
        constraint uk_product_media UK "UNIQUE(product_id, media_asset_id, association_type)"
        constraint uk_variant_hero UK "UNIQUE(variant_id) WHERE variant_hero"
    }

    users {
        uuid id PK "Primary Key"
        varchar auth0_user_id UK "UNIQUE - NOT NULL"
        varchar email UK "UNIQUE - NOT NULL"
        varchar name
        varchar role "NOT NULL: admin, photographer, writer, viewer"
        boolean is_active "Default: true"
        timestamp last_login_at
    }

    sync_logs {
        uuid id PK "Primary Key"
        varchar sync_type "NOT NULL"
        varchar entity_type
        uuid entity_id
        varchar status "NOT NULL"
        text error_message
        jsonb details
        uuid performed_by FK "FK -> users.id"
        timestamp created_at
    }

    audit_logs {
        uuid id PK "Primary Key"
        varchar table_name "NOT NULL"
        uuid record_id "NOT NULL"
        varchar action "NOT NULL"
        jsonb old_values
        jsonb new_values
        uuid user_id FK "FK -> users.id"
        timestamp created_at
    }
```

### Constraint Legend
| Symbol | Meaning |
|--------|---------|
| **PK** | Primary Key |
| **UK** | Unique constraint |
| **FK** | Foreign Key |
| **(UNIQUE)** in comment | Foreign Key that is also Unique (one-to-one relationship) |

### Product Metafields (Shopify Custom Fields)

The following **product-level metafields** are used in Shopify and stored in `products.metadata` (JSONB):

| Metafield | Description |
|-----------|-------------|
| `KS ID Product Group` | Internal product grouping identifier |
| `KS ID Product Type` | Internal product type identifier |
| `KS Collection ID Number` | Collection identifier |
| `Key Features` | Product feature highlights |
| `Key Benefits` | Product benefit highlights |
| `Custom Message` | Custom product messaging |
| `Review` | Product review content |

**Note**: Variant metafields are not currently used.

## Key Relationships Explained

### 1. Product ↔ Variants (One-to-Many)
- One product has many variants
- Variants have actual Shopify SKUs (e.g., `RSV-V-PRODUCTXYZ-S`, `RSV-V-PRODUCTXYZ-M`)
- Products have internal `sku_label` (e.g., `RSV-V-PRODUCTXYZ`) - NOT a Shopify SKU

### 2. Product ↔ Media Bucket (One-to-One)
- Every product has exactly ONE media bucket
- Bucket identified by `sku_label` matching `products.sku_label`
- Bucket contains cached statistics (raw count, edited count, etc.)
- Physical storage at `products/{sku_label}/` in Storj

### 3. Media Bucket ↔ Media Assets (One-to-Many)
- **Each asset is STORED in exactly ONE bucket** via `media_assets.media_bucket_id` (NOT NULL FK)
- Direct foreign key relationship (no junction table needed for storage location)
- Enforces clear storage ownership: one asset file = one bucket location
- Query pattern: `SELECT * FROM media_assets WHERE media_bucket_id = ?`
- **NOTE**: An asset can be ASSIGNED to multiple products via `product_media_associations` (no file duplication needed)

### 4. Product Media Associations (Publishing Source of Truth)
- **`product_media_associations` is the SOLE source of truth for what gets published to Shopify**
- Media bucket membership (via `media_assets.media_bucket_id`) is purely organizational
- Just because an image is in a product's bucket does NOT mean it gets published
- This table explicitly defines:
  - Which images are assigned to a product
  - The order of images in the product gallery
  - Which image is the hero (position = 1 for product-level)
  - Which videos are associated with a product
  - Variant-specific hero images (when `variant_id` is set)
- **UI Behavior**: Images from the SKU bucket matching the product are highlighted/suggested for publication, but users can choose any image from any bucket.
- **Future flexibility**: Buckets may exist without products (example unique label "LEATHER SHOTS"); publishing points may later expand beyond products

### 5. Media Workflow States
```
Images:  raw → edited → ready_for_publish → published
Videos:  raw → edited → encoding_submitted → encoded → ready_for_publish → published
```

### 6. Media Categories (workflow_category)
- `raw_capture`: Original photographer uploads
- `final_ecom`: Edited, ready for ecommerce
- `project_file`: PSDs, project files
- `psd_cutout`: Photoshop cutouts

## Product Status & Publishing Workflow

### Two Status Fields

Products have **two separate status fields** to track PIM state vs Shopify state:

| Field | Source | Values | Purpose |
|-------|--------|--------|---------|
| `status` | PIM (internal) | `draft`, `active`, `archived` | Internal workflow state |
| `shopify_status` | Shopify (synced) | `ACTIVE`, `DRAFT`, `ARCHIVED` | Current state in Shopify |

### Status Definitions

**PIM Status (`status`):**
| Value | Meaning |
|-------|---------|
| `draft` | Work in progress - not ready for Shopify |
| `active` | Ready/published - actively managed |
| `archived` | No longer active - hidden from default views |

**Shopify Status (`shopify_status`):**
| Value | Meaning |
|-------|---------|
| `ACTIVE` | Published and visible on storefront |
| `DRAFT` | Exists in Shopify but not visible |
| `ARCHIVED` | Hidden from storefront and admin by default |

### Publishing Workflow

```mermaid
flowchart LR
    subgraph PIM["PIM System"]
        A[Create/Import Product<br/>status: draft] --> B[Add Media<br/>Assign to Product]
        B --> C[Review & Edit<br/>Set metadata]
        C --> D[Mark Ready<br/>status: active]
    end
    
    subgraph Shopify["Shopify"]
        E[Draft in Shopify<br/>shopify_status: DRAFT]
        F[Published<br/>shopify_status: ACTIVE]
    end
    
    D -->|"Publish to Shopify<br/>(first time)"| E
    D -->|"Publish & Activate"| F
    E -->|"Activate in Shopify"| F
```

### Common Scenarios

| Scenario | `status` | `shopify_status` | Description |
|----------|----------|------------------|-------------|
| New product being set up | `draft` | `NULL` | Not yet sent to Shopify |
| Ready but not published | `active` | `NULL` | Ready in PIM, not in Shopify yet |
| Published as draft | `active` | `DRAFT` | In Shopify but hidden |
| Live on storefront | `active` | `ACTIVE` | Fully published and visible |
| Discontinued | `archived` | `ARCHIVED` | No longer sold |
| Seasonal (hidden) | `active` | `DRAFT` | Temporarily hidden |

### Filtering Products by Status

```sql
-- Products ready to publish (in PIM but not in Shopify)
SELECT * FROM products 
WHERE status = 'active' AND shopify_status IS NULL;

-- Products live on storefront
SELECT * FROM products 
WHERE shopify_status = 'ACTIVE';

-- Products in staging (in Shopify as draft)
SELECT * FROM products 
WHERE shopify_status = 'DRAFT';

-- All active products in PIM (regardless of Shopify state)
SELECT * FROM products 
WHERE status = 'active';

-- Products needing attention (PIM archived but still live in Shopify)
SELECT * FROM products 
WHERE status = 'archived' AND shopify_status = 'ACTIVE';
```

### Sync Behavior

| Action | Effect on `status` | Effect on `shopify_status` |
|--------|-------------------|---------------------------|
| Import from Shopify | Set to `active` | Synced from Shopify |
| Edit in PIM | No change | No change (until sync) |
| Publish to Shopify | No change | Updated after sync |
| Archive in PIM | Set to `archived` | No change (manual sync needed) |
| Change in Shopify | No change | Updated on next import/sync |

**Conflict Resolution**: If a product is edited in both PIM and Shopify:
- PIM is source of truth for media assignments
- Shopify is source of truth for inventory/pricing
- Metadata conflicts: PIM wins on publish, Shopify wins on import (configurable)

## SKU Architecture

### Critical Constraint: No Collisions
```sql
-- products.sku_label must NOT match any product_variants.sku
-- Enforced by database triggers
```

### Examples

#### Multi-Variant Product
```
Product sku_label: "RSV-V-PRODUCTXYZ"        ← Internal label (NOT in Shopify)
Variant SKUs:      "RSV-V-PRODUCTXYZ-S"      ← Real Shopify SKU
                   "RSV-V-PRODUCTXYZ-M"      ← Real Shopify SKU
                   "RSV-V-PRODUCTXYZ-L"      ← Real Shopify SKU

Media Bucket:      products/RSV-V-PRODUCTXYZ/  (Storj - permanent storage)
Google Drive:      RSV-V-PRODUCTXYZ/           (LEGACY - import source only)
```

#### Single-Variant Product
```
Product sku_label: "UNIQUE-SKU-123"          ← Internal label
Variant SKU:       "UNIQUE-SKU-123"          ← Real Shopify SKU (MUST match sku_label)

Media Bucket:      products/UNIQUE-SKU-123/    (Storj - permanent storage)
Google Drive:      UNIQUE-SKU-123/             (LEGACY - import source only)
```
**Note**: For single-variant products, the variant SKU and product sku_label MUST be identical. This is how the system matches the media bucket to suggest which assets to publish.

## Query Patterns

### Bucket Queries (Organizational - What's in Storage)
```typescript
// Get bucket by SKU label
const bucket = await MediaBucket.findBySkuLabel('RSV-V-PRODUCTXYZ');

// Get all assets in the bucket (for browsing/selection UI)
const allAssets = await bucket.getAllAssets();

// Get raw sources, edited, project files
const raw = await bucket.getRawSources();
const edited = await bucket.getEditedAssets();
const projects = await bucket.getProjectFiles();

// Cached statistics (fast, no asset query needed)
console.log(bucket.rawAssetCount);       // 10
console.log(bucket.editedAssetCount);    // 7
console.log(bucket.totalAssetCount);     // 22
```

### Publishing Queries (What Gets Published to Shopify)
```typescript
// Get images assigned to a product (ordered by position)
const assignedImages = await ProductMediaAssociation.getProductImages(productId);
// → Returns images in gallery order, position 1 = hero

// Get hero image for product (position 1, variant_id NULL)
const productHero = await ProductMediaAssociation.getProductHero(productId);

// Get hero image for a specific variant
const variantHero = await ProductMediaAssociation.getVariantHero(variantId);

// Get all videos assigned to a product
const videos = await ProductMediaAssociation.getProductVideos(productId);

// Assign an image to a product
await ProductMediaAssociation.assignImage(productId, mediaAssetId, position);

// Set variant hero (uses image already assigned to product)
await ProductMediaAssociation.setVariantHero(variantId, mediaAssetId);
```

### Key Distinction
```typescript
// Bucket: "What images exist in storage for this SKU?"
const bucket = await MediaBucket.findBySkuLabel('RSV-V-PRODUCTXYZ');
const available = await bucket.getAllAssets();  // 15 images in bucket

// Associations: "Which images are assigned to this product?"
const assigned = await ProductMediaAssociation.getProductImages(productId);  // 5 images assigned
// These 5 are what get published to Shopify
```

## Storj Storage Structure

```
storj://kinkstore-pim/
└── products/
    └── RSV-V-PRODUCTXYZ/               ← Bucket root (sku_label)
        ├── photos/
        │   ├── raw/                    ← workflow_state: raw
        │   │   ├── DSC09935.JPG
        │   │   └── DSC09937.JPG
        │   ├── edited/                 ← workflow_state: edited/ready_for_publish
        │   │   ├── product-1.jpg
        │   │   └── product-2.jpg
        │   └── project/                ← workflow_category: project_file
        │       └── product-1.psd
        └── videos/
            ├── raw/                    ← workflow_state: raw (source files)
            ├── edited/                 ← workflow_state: edited (trimmed/stitched, pre-encoding)
            └── project/                ← workflow_category: project_file
```

**Note on Encoded Videos:**
- Encoded videos are **NOT stored in Storj**
- They are hosted by the external encoding service
- We store only the **URL** in `media_assets.encoded_video_url`
- The URL points to the encoding service's CDN

## Import Flow

**Google Drive is for ONE-TIME IMPORT ONLY:**
- Google Drive folders are the **source** for initial media migration
- Files are copied to Storj (permanent storage) during import
- Google Drive file/folder IDs are stored as **legacy reference** only
- After import, Google Drive is NOT used for ongoing operations
- All future media management happens in PIM → Storj → Shopify

```mermaid
flowchart TD
    A[Google Drive Folder<br/>RSV-V-PRODUCTXYZ/<br/>ONE-TIME IMPORT SOURCE] --> B[Map to Shopify Product ID]
    B --> C[Create/Update Product Record<br/>sku_label = RSV-V-PRODUCTXYZ]
    C --> D[Create Media Bucket<br/>storj_path = products/RSV-V-PRODUCTXYZ/]
    D --> E[Import Files by Folder Type]

    E --> F1[Photos/Raw Captures/<br/>→ workflow_state: raw<br/>→ workflow_category: raw_capture]
    E --> F2[Photos/Final ECOM/<br/>→ workflow_state: ready_for_publish<br/>→ workflow_category: final_ecom]
    E --> F3[Photos/PSD Cutouts/<br/>→ workflow_category: project_file<br/>→ workflow_state: raw]

    F1 --> G[Upload to Storj<br/>products/RSV-V-PRODUCTXYZ/photos/raw/]
    F2 --> H[Upload to Storj<br/>products/RSV-V-PRODUCTXYZ/photos/edited/]
    F3 --> I[Upload to Storj<br/>products/RSV-V-PRODUCTXYZ/photos/project/]

    G --> J[Create media_assets Record<br/>with media_bucket_id FK]
    H --> J
    I --> J

    J --> K[Trigger Auto-Updates<br/>media_buckets Cached Counts]
    K --> L[Store Google Drive IDs<br/>as legacy reference]
    L --> M[Import Complete<br/>Google Drive no longer needed]
```

## Publish to Shopify Flow

```mermaid
flowchart TD
    A[User: Publish Product] --> B[Query product_media_associations<br/>SELECT * FROM product_media_associations<br/>WHERE product_id = ? AND is_published = true<br/>ORDER BY position]
    B --> C{Has Assigned Media?}
    C -->|No| D[Error: No media assigned to product]
    C -->|Yes| E[Get media assets for assigned IDs]

    E --> F[Upload Media to Shopify<br/>via Admin GraphQL API]
    F --> G[Associate Media with Product<br/>productCreateMedia mutation<br/>Position 1 = Hero Image]

    G --> H{Variant Hero Images?}
    H -->|Yes| I[Query variant hero associations<br/>WHERE variant_id IS NOT NULL]
    I --> J[Associate Hero with Variant<br/>in Shopify]

    H -->|No| K[Complete]
    J --> K

    K --> L[Update sync_logs]
    L --> M[Update products.last_synced_at]
```

### Publishing Logic Summary
1. **Product images come from `product_media_associations`** (NOT from bucket directly)
2. **Position 1 = product hero image** (also used as variant[0] hero if single variant)
3. **Variant heroes are explicit associations** where `variant_id IS NOT NULL`
4. **Bucket is just storage** - images must be explicitly assigned to be published

## Video Encoding API Integration

**Endpoint**: `https://server.kinkstorage.com/graphql`
**Authentication**: API Key (Bearer token)

### Naming Convention (internalName)

Videos are identified by an `internalName` handle that we generate:

```
{sku_label}--{media_asset_uuid}
```

**Example**: `RSV-V-PRODUCTXYZ--550e8400-e29b-41d4-a716-446655440000`

| Component | Purpose |
|-----------|---------|
| `sku_label` | Searchable by product via `videos(searchTerm: "RSV-V-PRODUCTXYZ")` |
| `--` | Clean separator (SKUs may contain single dashes) |
| `media_asset_uuid` | Direct link to `media_assets` record, guaranteed unique |

### API Mutations

| Mutation | Args | Returns | Description |
|----------|------|---------|-------------|
| `startVideoUpload` | `content: String!`, `internalName: String` | `{ id, url }` | Get upload URL |
| `finishVideoUpload` | `videoId: String!` | - | Trigger encoding |
| `promoteAssets` | `imageAssetIds: [ID]!`, `videoAssetIds: [ID]!` | - | Promote to active |
| `softDeleteVideo` | `videoId: ID!` | - | Soft delete |

### API Queries

| Query | Args | Returns | Description |
|-------|------|---------|-------------|
| `video` | `videoId: String!` | `TranscodedVideo` | Get by ID (fast) |
| `videos` | `take, skip, searchTerm` | `[TranscodedVideo]` | Search/list videos |

### Response Types

```graphql
type TranscodedVideo {
  id: ID!
  internalName: String       # Our tracking handle
  owner: String!
  status: FileUploadingStatus!  # Uploaded | NotUploaded
  videoAssets: [VideoAsset]  # Encoded outputs
  imageAssets: [ImageAsset]  # Generated thumbnails
}

type VideoAsset {
  id: ID!
  url: URL!        # Final encoded video URL
  format: String!  # mp4, webm, etc.
  type: String!    # hls, dash, etc.
  status: String!
}

type ImageAsset {
  id: ID!
  url: URL!
  resolution: String!  # e.g., "1920x1080"
  tag: String!
}
```

### Video Encoding Workflow

```mermaid
flowchart TD
    A[Edited video in Storj<br/>workflow_state: edited] --> B[Generate internalName<br/>sku_label--media_asset_uuid]
    B --> C[startVideoUpload mutation<br/>content: filename<br/>internalName: generated handle]
    C --> D[API returns<br/>id + upload URL]
    D --> E[Upload video file<br/>to returned URL]
    E --> F[finishVideoUpload mutation<br/>videoId: returned id]
    F --> G[Store in media_assets:<br/>encoding_handle = internalName<br/>encoding_video_id = id<br/>workflow_state = encoding_submitted]
    G --> H[Poll: video query<br/>videoId: encoding_video_id]
    H --> I{status = Uploaded?}
    I -->|No| J[Wait & retry]
    J --> H
    I -->|Yes| K[Extract videoAssets.url<br/>Store in encoded_video_url<br/>workflow_state = encoded]
    K --> L[Ready for publish]
```

### Fields Stored in media_assets

| Field | Value | Purpose |
|-------|-------|---------|
| `encoding_handle` | `{sku_label}--{uuid}` | Our internalName for searching |
| `encoding_video_id` | API-returned ID | Direct lookup via `video(videoId)` |
| `encoded_video_url` | `videoAssets[0].url` | Final playable URL |
| `workflow_state` | `encoding_submitted` → `encoded` | Track progress |


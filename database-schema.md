# Database Schema - Entity Relationship Diagram

## Core Entity Relationships

```mermaid
erDiagram
    products ||--o{ product_variants : "has many"
    products ||--|| media_buckets : "has one"

    media_buckets ||--o{ media_assets : "contains"

    product_variants ||--o{ product_media_associations : "may have hero"
    media_assets ||--o{ product_media_associations : "optional metadata"

    users ||--o{ media_assets : "uploads/edits"
    users ||--o{ sync_logs : "performs"
    users ||--o{ audit_logs : "performs"

    products {
        uuid id PK
        bigint shopify_product_id UK "Shopify ID"
        varchar title
        text description
        varchar sku_label UK "Internal label (NOT Shopify SKU)"
        varchar vendor
        varchar product_type
        text[] tags
        varchar status
        timestamp created_at
        timestamp updated_at
    }

    product_variants {
        uuid id PK
        uuid product_id FK
        bigint shopify_variant_id UK
        varchar sku UK "Actual Shopify SKU"
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
        uuid id PK
        uuid product_id UK_FK "One-to-one with product"
        varchar sku_label UK "Matches products.sku_label"
        varchar bucket_status
        varchar storj_path "e.g., products/RSV-V-PRODUCTXYZ/"
        int raw_asset_count "Cached"
        int edited_asset_count "Cached"
        int published_asset_count "Cached"
        int project_file_count "Cached"
        int total_asset_count "Cached"
        bigint total_size_bytes "Cached"
        timestamp last_upload_at
        timestamp last_publish_at
    }

    media_assets {
        uuid id PK
        uuid media_bucket_id FK_NOT_NULL "Belongs to ONE bucket"
        varchar media_type "image, video"
        varchar workflow_state "raw, edited, encoded, published"
        varchar file_url "Storj URL"
        varchar file_key "Storj path"
        bigint file_size
        varchar encoding_job_id "Video encoding"
        varchar encoded_video_url "Final video URL"
        jsonb video_metadata
        jsonb image_metadata
        text alt_text
        varchar title
        varchar original_filename
        varchar workflow_category "raw_capture, final_ecom, project_file"
        uuid uploaded_by FK
        uuid edited_by FK
        varchar google_drive_file_id
        varchar google_drive_folder_path
        uuid import_batch_id
    }

    product_media_associations {
        uuid id PK
        uuid media_asset_id FK_NOT_NULL
        uuid variant_id FK "NULL for product-level"
        varchar association_type "variant_hero, product_gallery_order"
        int position "Gallery ordering"
        boolean is_featured "Hero images"
    }

    users {
        uuid id PK
        varchar auth0_user_id UK
        varchar email UK
        varchar name
        varchar role "admin, photographer, writer, viewer"
        boolean is_active
        timestamp last_login_at
    }

    sync_logs {
        uuid id PK
        varchar sync_type
        varchar entity_type
        uuid entity_id
        varchar status
        text error_message
        jsonb details
        uuid performed_by FK
        timestamp created_at
    }

    audit_logs {
        uuid id PK
        varchar table_name
        uuid record_id
        varchar action
        jsonb old_values
        jsonb new_values
        uuid user_id FK
        timestamp created_at
    }
```

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

### 3. Media Bucket ↔ Media Assets (One-to-Many) **[KEY CHANGE]**
- **Each asset belongs to exactly ONE bucket** via `media_assets.media_bucket_id` (NOT NULL FK)
- Direct foreign key relationship (no junction table needed for basic membership)
- Enforces clear ownership: one asset = one product bucket
- Query pattern: `SELECT * FROM media_assets WHERE media_bucket_id = ?`
- If same image needed for multiple products, must copy the file (explicit duplication)

### 4. Variant Hero Images (Optional Metadata via product_media_associations)
- `product_media_associations` table stores ONLY optional metadata
- Used for: variant hero images and gallery ordering
- `variant_id` is NULL for product-level associations
- `variant_id` is set for variant-specific hero images
- Each variant can have ONE hero image selected from the bucket's media pool
- `is_featured = TRUE` marks hero images
- **Note**: This table does NOT establish bucket membership (that's via media_assets.media_bucket_id)

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

Media Bucket:      products/RSV-V-PRODUCTXYZ/
Google Drive:      RSV-V-PRODUCTXYZ/
```

#### Single-Variant Product
```
Product sku_label: "UNIQUE-SKU-123"          ← Internal label
Variant SKU:       "UNIQUE-SKU-123"          ← Real Shopify SKU (same is OK)

Media Bucket:      products/UNIQUE-SKU-123/
Google Drive:      UNIQUE-SKU-123/
```

## Query Patterns via MediaBucket Class

### Get Media by Type
```typescript
// Get published assets for product
const bucket = await MediaBucket.findBySkuLabel('RSV-V-PRODUCTXYZ');
const published = await bucket.getPublishedAssets();

// Get raw sources
const raw = await bucket.getRawSources();

// Get edited (ready for publish)
const edited = await bucket.getEditedAssets();

// Get project files (PSDs, etc.)
const projects = await bucket.getProjectFiles();
```

### Variant Hero Images
```typescript
// Set variant hero image
await bucket.setVariantHeroImage(variantId, imageAssetId);

// Get hero for specific variant
const hero = await bucket.getVariantHeroImage(variantId);
```

### Cached Statistics
```typescript
// Fast access without querying assets
console.log(bucket.rawAssetCount);       // 10
console.log(bucket.editedAssetCount);    // 7
console.log(bucket.publishedAssetCount); // 5
console.log(bucket.totalAssetCount);     // 22
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
            ├── raw/                    ← workflow_state: raw
            ├── edited/                 ← workflow_state: edited
            ├── encoded/                ← workflow_state: encoded (from API)
            └── project/                ← project files
```

## Import Flow

```mermaid
flowchart TD
    A[Google Drive Folder<br/>RSV-V-PRODUCTXYZ/] --> B[Map to Shopify Product ID]
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
    K --> L[Import Complete]
```

## Publish to Shopify Flow

```mermaid
flowchart TD
    A[User: Publish Product] --> B[Query bucket.getPublishedAssets<br/>SELECT * FROM media_assets<br/>WHERE media_bucket_id = ? AND workflow_state = 'published']
    B --> C{Has Published Assets?}
    C -->|No| D[Mark assets as ready_for_publish]
    D --> E[Update workflow_state = published<br/>Trigger updates bucket counts]
    C -->|Yes| E

    E --> F[Upload Media to Shopify<br/>via Admin GraphQL API]
    F --> G[Associate Media with Product<br/>productCreateMedia mutation]

    G --> H{Variant Hero Images?}
    H -->|Yes| I[Query variant hero images<br/>from product_media_associations<br/>where is_featured=true]
    I --> J[Associate Hero with Variant<br/>in Shopify]

    H -->|No| K[Complete]
    J --> K

    K --> L[Update sync_logs]
    L --> M[Update products.last_synced_at<br/>Update media_buckets.last_publish_at]
```


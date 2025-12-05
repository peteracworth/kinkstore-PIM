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
        uuid productId UK "One-to-one with product"
        varchar skuLabel UK "Matches products.sku_label"
        varchar bucketStatus
        varchar storjPath "e.g., products/RSV-V-PRODUCTXYZ/"
        int rawAssetCount "Cached"
        int editedAssetCount "Cached"
        int publishedAssetCount "Cached"
        int projectFileCount "Cached"
        int totalAssetCount "Cached"
        bigint totalSizeBytes "Cached"
        timestamp lastUploadAt
        timestamp lastPublishAt
    }

    media_assets {
        uuid id PK
        uuid mediaBucketId FK "Belongs to ONE bucket"
        varchar mediaType "image, video"
        varchar workflowState "raw, edited, encoded, published"
        varchar fileUrl "Storj URL"
        varchar fileKey "Storj path"
        bigint fileSize
        varchar encodingHandle "Video: {sku_label}--{uuid} for API lookup"
        varchar encodingVideoId "Video: ID returned by encoding API"
        varchar encodedVideoUrl "Video: Final encoded URL from API"
        jsonb videoMetadata
        jsonb imageMetadata
        text altText
        varchar title
        varchar originalFilename
        varchar workflowCategory "raw_capture, final_ecom, project_file"
        uuid uploadedBy FK
        uuid editedBy FK
        varchar googleDriveFileId "LEGACY - import reference only"
        varchar googleDriveFolderPath "LEGACY - import reference only"
        uuid importBatchId
    }

    product_media_associations {
        uuid id PK
        uuid productId FK "Required - which product"
        uuid mediaAssetId FK "Which media asset"
        uuid variantId FK "NULL for product-level, set for variant hero"
        varchar associationType "product_image, product_video, variant_hero"
        int position "Gallery ordering (1 = hero for product-level)"
        boolean isPublished "Whether to publish to Shopify"
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
- **UI Behavior**: Images from the matching SKU bucket are highlighted/suggested, but users can choose any image
- **Future flexibility**: Buckets may exist without products; publishing points may expand beyond products

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
            ├── raw/                    ← workflow_state: raw
            ├── edited/                 ← workflow_state: edited
            ├── encoded/                ← workflow_state: encoded (from API)
            └── project/                ← project files
```

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

**Endpoint**: `https://kink-video.kink-video.cluster.kinkstorage.com/graphql`
**Authentication**: JWT (Auth0)

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


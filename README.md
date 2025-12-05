# Kinkstore PIM

A Product Information Management (PIM) system for managing ~1,000 products with media management, product data editing, and Shopify synchronization.

## Overview

 The Kinkstore PIM project in-houses the product catalog from shopify (products and product variants), pulls in the images and image editing workflow currently done in google drive in SKU folders (currently Meghan shooting, alva editing and James publishing ), pulls in video management and encoding (currently megan posting raw, someone editing, meghan currently pushes to encode and someone else publishes resulting link to shopify), and marries all this into one interface where the user can see, create, detete, edit all the products and the associated media, create and manage new media, assign media to products, and publish/remove products from shopify etc.

 The hierarchy and labelling associated with storage closely mimics the existing google drive folder naming conventions so as to provide continuity.

This system migrates from Google Drive-based media storage to a database-driven solution with cloud storage (Storj), providing:

- **Product Management**: Import and sync products/variants from Shopify
- **Media Management**: Upload, organize, and edit images and videos
- **Publishing Workflow**: Assign media to products and publish to Shopify
- **Video Encoding**: Integration with external video encoding service
- **Role-Based Access**: Admin, photographer, writer, and viewer roles

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | React (Vercel) |
| Backend | Node.js API (Vercel) |
| Database | PostgreSQL (Supabase) |
| File Storage | Storj (S3-compatible) |
| Authentication | Auth0 + Google OAuth |
| E-commerce | Shopify Admin GraphQL API |
| Video Encoding | External GraphQL API |

## Documentation

- **[Implementation Plan](PLAN.md)** - Full 8-week implementation plan with phases, tasks, and technical details
- **[Database Schema](database-schema.md)** - Entity relationship diagrams, table definitions, and query patterns

## Project Management

**[Join the Linear Project](https://linear.app/kink/join/7f0e466af27480fa999f862a2c0b07a6?s=5)** to view and collaborate on tasks.

## Implementation Roadmap

### Phase 1: Foundation & Authentication (Week 1)
Set up project infrastructure, database, and authentication.

| Task | Description | Linear |
|------|-------------|--------|
| 1.1 Project Setup | Repos, Vercel, Supabase, Storj | [KIN-5](https://linear.app/kink/issue/KIN-5) |
| 1.2 Database Setup | Tables, migrations, RLS, triggers | [KIN-6](https://linear.app/kink/issue/KIN-6) |
| 1.3 Authentication | Auth0, Google OAuth, RBAC | [KIN-7](https://linear.app/kink/issue/KIN-7) |
| 1.4 Frontend Shell | React app, routing, layout | [KIN-8](https://linear.app/kink/issue/KIN-8) |

### Phase 2: Shopify Integration & Product Import (Week 2)
Import existing products from Shopify into PIM.

| Task | Description | Linear |
|------|-------------|--------|
| 2.1 Shopify API Client | GraphQL client, rate limiting | [KIN-9](https://linear.app/kink/issue/KIN-9) |
| 2.2 Product Import Service | Bulk import, schema mapping | [KIN-10](https://linear.app/kink/issue/KIN-10) |
| 2.3 Product CRUD API | List, detail, update endpoints | [KIN-11](https://linear.app/kink/issue/KIN-11) |
| 2.4 Product UI | List page, editor, filters | [KIN-12](https://linear.app/kink/issue/KIN-12) |

### Phase 3: Media Management Core (Week 3)
Upload, store, and manage media assets.

| Task | Description | Linear |
|------|-------------|--------|
| 3.1 Storage Service | Storj client, signed URLs, uploads | [KIN-13](https://linear.app/kink/issue/KIN-13) |
| 3.2 Media API | Upload, list, update, delete | [KIN-14](https://linear.app/kink/issue/KIN-14) |
| 3.3 Media Library UI | Grid view, upload, filtering | [KIN-15](https://linear.app/kink/issue/KIN-15) |
| 3.4 Image Handling | Previews, metadata, alt text | [KIN-16](https://linear.app/kink/issue/KIN-16) |
| 3.5 Image Editing | Crop, resize, rotate (sharp) | [KIN-17](https://linear.app/kink/issue/KIN-17) |
| 3.6 Video Editing | Trim, stitch (ffmpeg) | [KIN-18](https://linear.app/kink/issue/KIN-18) |

### Phase 4: Product-Media Association (Week 4)
Connect media assets to products for publishing.

| Task | Description | Linear |
|------|-------------|--------|
| 4.1 Association API | Assign media, reorder, heroes | [KIN-19](https://linear.app/kink/issue/KIN-19) |
| 4.2 Association UI | Gallery editor, drag-drop | [KIN-20](https://linear.app/kink/issue/KIN-20) |
| 4.3 Product Detail Enhancement | Inline media, suggestions | [KIN-21](https://linear.app/kink/issue/KIN-21) |

### Phase 5: Google Drive Import (Week 5)
One-time migration of existing media from Google Drive.

| Task | Description | Linear |
|------|-------------|--------|
| 5.1 Google Drive Integration | API setup, folder traversal | [KIN-22](https://linear.app/kink/issue/KIN-22) |
| 5.2 Import Service | Download, upload to Storj, map | [KIN-23](https://linear.app/kink/issue/KIN-23) |
| 5.3 Import UI | Wizard, progress, error handling | [KIN-24](https://linear.app/kink/issue/KIN-24) |

### Phase 6: Video Encoding Integration (Week 6)
Handle video encoding workflow with external service.

| Task | Description | Linear |
|------|-------------|--------|
| 6.1 Video Encoding Service | API client, upload, polling | [KIN-25](https://linear.app/kink/issue/KIN-25) |
| 6.2 Video Workflow UI | Submit, progress, preview | [KIN-26](https://linear.app/kink/issue/KIN-26) |
| 6.3 Video Player | Player component, metadata | [KIN-27](https://linear.app/kink/issue/KIN-27) |

### Phase 7: Shopify Publishing (Week 7)
Publish products and media to Shopify.

| Task | Description | Linear |
|------|-------------|--------|
| 7.1 Publishing Service | Upload media, sync product | [KIN-28](https://linear.app/kink/issue/KIN-28) |
| 7.2 Publishing UI | Publish button, preview, history | [KIN-29](https://linear.app/kink/issue/KIN-29) |
| 7.3 Sync Management | Dashboard, errors, re-sync | [KIN-30](https://linear.app/kink/issue/KIN-30) |

### Phase 8: Polish & Admin Features (Week 8)
Final polish, admin tools, and UX improvements.

| Task | Description | Linear |
|------|-------------|--------|
| 8.1 Admin Panel | User management, logs | [KIN-31](https://linear.app/kink/issue/KIN-31) |
| 8.2 Enhanced Search & Filters | Full-text, saved filters | [KIN-32](https://linear.app/kink/issue/KIN-32) |
| 8.3 UX Improvements | Loading states, shortcuts | [KIN-33](https://linear.app/kink/issue/KIN-33) |

---

## Key Concepts

### SKU Architecture
- **Product `sku_label`**: Internal identifier (e.g., `RSV-V-PRODUCTXYZ`)
- **Variant `sku`**: Actual Shopify SKU (e.g., `RSV-V-PRODUCTXYZ-S`, `RSV-V-PRODUCTXYZ-M`)
- For single-variant products, these must match

### Media Buckets vs Publishing
- **Media Buckets**: Organizational storage containers (one per product)
- **Publishing**: Defined by `product_media_associations` table - images must be explicitly assigned to be published

### Storage
- **Storj**: Raw files, edited files, project files (PSDs)
- **External CDN**: Encoded videos (URL stored in database)

## Project Status

**Status**: Planning Complete - Ready for Implementation

See [PLAN.md](PLAN.md) for the detailed implementation roadmap.


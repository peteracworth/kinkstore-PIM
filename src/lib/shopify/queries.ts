/**
 * Shopify GraphQL Queries for Product Import
 */

// Fragment for product fields we need
export const PRODUCT_FRAGMENT = `
  fragment ProductFields on Product {
    id
    title
    handle
    descriptionHtml
    vendor
    productType
    tags
    status
    publishedAt
    createdAt
    updatedAt
    metafields(first: 20) {
      edges {
        node {
          namespace
          key
          value
          type
        }
      }
    }
    variants(first: 100) {
      edges {
        node {
          id
          title
          sku
          price
          compareAtPrice
          inventoryQuantity
          position
          selectedOptions {
            name
            value
          }
          image {
            id
            altText
            url
            width
            height
          }
          inventoryItem {
            measurement {
              weight {
                value
                unit
              }
            }
          }
        }
      }
    }
    media(first: 50) {
      edges {
        node {
          ... on MediaImage {
            id
            alt
            image {
              url
              width
              height
            }
          }
        }
      }
    }
  }
`

// Query to fetch products with pagination
export const GET_PRODUCTS = `
  ${PRODUCT_FRAGMENT}
  
  query GetProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          ...ProductFields
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

// Query to fetch a single product by ID
export const GET_PRODUCT = `
  ${PRODUCT_FRAGMENT}
  
  query GetProduct($id: ID!) {
    product(id: $id) {
      ...ProductFields
    }
  }
`

// Query to fetch products count
export const GET_PRODUCTS_COUNT = `
  query GetProductsCount {
    productsCount {
      count
    }
  }
`

// Types for query responses
export interface ShopifyProduct {
  id: string
  title: string
  handle: string
  descriptionHtml: string
  vendor: string
  productType: string
  tags: string[]
  status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT'
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  metafields: {
    edges: Array<{
      node: {
        namespace: string
        key: string
        value: string
        type: string
      }
    }>
  }
  variants: {
    edges: Array<{
      node: ShopifyVariant
    }>
  }
  media: {
    edges: Array<{
      node: {
        id: string
        alt: string | null
        image?: {
          url: string
          width: number
          height: number
        }
      }
    }>
  }
}

export interface ShopifyVariant {
  id: string
  title: string
  sku: string | null
  price: string
  compareAtPrice: string | null
  inventoryQuantity: number | null
  position: number
  selectedOptions: Array<{
    name: string
    value: string
  }>
  inventoryItem?: {
    measurement?: {
      weight?: {
        value: number
        unit: 'KILOGRAMS' | 'GRAMS' | 'POUNDS' | 'OUNCES'
      }
    }
  }
  image?: {
    id?: string | null
    altText?: string | null
    url?: string | null
    width?: number | null
    height?: number | null
  } | null
}

export interface GetProductsResponse {
  products: {
    edges: Array<{
      node: ShopifyProduct
    }>
    pageInfo: {
      hasNextPage: boolean
      endCursor: string | null
    }
  }
}

export interface GetProductResponse {
  product: ShopifyProduct | null
}

export interface GetProductsCountResponse {
  productsCount: {
    count: number
  }
}

// Helper to extract numeric ID from Shopify GID
export function extractShopifyId(gid: string): number {
  // gid://shopify/Product/123456789 -> 123456789
  const match = gid.match(/\/(\d+)$/)
  if (!match) {
    throw new Error(`Invalid Shopify GID: ${gid}`)
  }
  return parseInt(match[1], 10)
}

// Helper to convert weight unit
type WeightUnit = 'KILOGRAMS' | 'GRAMS' | 'POUNDS' | 'OUNCES'

export function convertWeightUnit(unit: WeightUnit): string {
  const map: Record<WeightUnit, string> = {
    KILOGRAMS: 'kg',
    GRAMS: 'g',
    POUNDS: 'lb',
    OUNCES: 'oz',
  }
  return map[unit] || 'lb'
}


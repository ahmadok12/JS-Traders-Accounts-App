/**
 * JS Traders ERP - Product Master & Variants Service
 * Handles Categories, 3-tier Product naming (Business, Customer, Urdu),
 * Dynamic Variant Attributes, and SKU cataloging.
 */

import { storageService } from './storageService.js';

class ProductService {
  // --- CATEGORIES ---
  getCategories() {
    return storageService.getCollection('categories');
  }

  getCategoryById(id) {
    return storageService.getById('categories', id);
  }

  createCategory(category) {
    const categories = this.getCategories();
    const count = categories.length + 1;
    const code = `CAT-${String(count).padStart(3, '0')}`;
    return storageService.insert('categories', {
      ...category,
      code,
      isActive: category.isActive !== undefined ? category.isActive : true
    });
  }

  updateCategory(id, updates) {
    return storageService.update('categories', id, updates);
  }

  deleteCategory(id) {
    const products = this.getProducts().filter(p => p.categoryId === id);
    if (products.length > 0) {
      throw new Error(`Cannot delete category: ${products.length} product(s) are assigned to it.`);
    }
    return storageService.delete('categories', id);
  }

  reorderCategories(orderedIds) {
    const categories = this.getCategories();
    const catMap = new Map(categories.map(c => [c.id, c]));
    const newCategories = [];
    orderedIds.forEach(id => {
      if (catMap.has(id)) {
        newCategories.push(catMap.get(id));
        catMap.delete(id);
      }
    });
    // Append any remaining categories not present in orderedIds
    catMap.forEach(cat => newCategories.push(cat));
    storageService.setCollection('categories', newCategories);
    return newCategories;
  }

  // --- PRODUCTS ---
  getProducts() {
    return storageService.getCollection('products');
  }

  getProductById(id) {
    return storageService.getById('products', id);
  }

  createProduct(productData) {
    const products = this.getProducts();
    const count = products.length + 1;
    const code = `PROD-${String(count).padStart(5, '0')}`;

    const isCutToLength = !!(productData.cut_to_length || productData.enableRollTracking);
    const newProduct = storageService.insert('products', {
      ...productData,
      code,
      productType: productData.productType || 'Stock',
      lowStockLevel: Number(productData.lowStockLevel) || 10,
      enableRollTracking: isCutToLength,
      cut_to_length: isCutToLength,
      base_unit: productData.base_unit || 'ft',
      full_unit: productData.full_unit || 'roll',
      full_unit_quantity: Number(productData.full_unit_quantity) || 5000,
      packagingUnits: productData.packagingUnits || [],
      negativeStockAllowed: productData.negativeStockAllowed || 'disallow',
      isActive: productData.isActive !== undefined ? productData.isActive : true
    });

    return newProduct;
  }

  updateProduct(id, updates) {
    return storageService.update('products', id, updates);
  }

  deleteProduct(id) {
    const variants = this.getVariantsByProduct(id);
    if (variants.length > 0) {
      throw new Error(`Cannot delete product: ${variants.length} variant(s) exist for it.`);
    }
    return storageService.delete('products', id);
  }

  // --- VARIANTS / SKUS ---
  getVariants() {
    return storageService.getCollection('variants');
  }

  getVariantById(id) {
    return storageService.getById('variants', id);
  }

  getVariantsByProduct(productId) {
    return this.getVariants().filter(v => v.productId === productId);
  }

  createVariant(variantData) {
    const variants = this.getVariants();
    const count = variants.length + 1;
    const code = `VAR-${String(count).padStart(5, '0')}`;

    return storageService.insert('variants', {
      ...variantData,
      code,
      costPrice: Number(variantData.costPrice) || 0,
      sellingPrice: Number(variantData.sellingPrice) || 0,
      attributes: variantData.attributes || {},
      isActive: variantData.isActive !== undefined ? variantData.isActive : true
    });
  }

  updateVariant(id, updates) {
    return storageService.update('variants', id, updates);
  }

  deleteVariant(id) {
    // Check if stock exists or movements exist
    const balances = storageService.getCollection('stockBalances').filter(b => b.variantId === id && b.quantity > 0);
    if (balances.length > 0) {
      throw new Error('Cannot delete variant: physical inventory balance exists in one or more warehouses.');
    }
    return storageService.delete('variants', id);
  }

  // --- ATTRIBUTE DEFINITIONS ---
  getAttributeDefinitions() {
    return storageService.getCollection('attributeDefinitions');
  }

  // Dynamic search across business name, customer name, urdu name, SKU, and attributes
  searchVariants(query) {
    const q = (query || '').toLowerCase().trim();
    const variants = this.getVariants();
    const products = this.getProducts();
    const prodMap = new Map(products.map(p => [p.id, p]));

    if (!q) {
      return variants.map(v => ({ ...v, product: prodMap.get(v.productId) }));
    }

    return variants
      .map(v => ({ ...v, product: prodMap.get(v.productId) }))
      .filter(item => {
        const prod = item.product || {};
        const attrValues = Object.values(item.attributes || {}).join(' ').toLowerCase();
        return (
          (item.name && item.name.toLowerCase().includes(q)) ||
          (item.sku && item.sku.toLowerCase().includes(q)) ||
          (prod.businessName && prod.businessName.toLowerCase().includes(q)) ||
          (prod.customerName && prod.customerName.toLowerCase().includes(q)) ||
          (prod.urduName && prod.urduName.includes(q)) ||
          attrValues.includes(q)
        );
      });
  }
}

export const productService = new ProductService();

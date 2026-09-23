/**
 * JS Traders ERP - Product Categories View
 * Displays categories as cards with product counts, edit/delete actions,
 * and category creation modal.
 */

import { productService } from '../../services/productService.js';
import { openModal, closeModal } from '../../components/modal.js';
import { confirmAction } from '../../components/confirmation.js';
import { toast } from '../../components/toast.js';

export function renderCategoriesView() {
  const categories = productService.getCategories();
  const products = productService.getProducts();

  return `
    <div class="space-y-6 animate-in fade-in duration-150">
      <!-- Header & Action Bar -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
        <div>
          <h2 class="text-base font-bold text-[#1A1D1F]">Product Categories</h2>
          <p class="text-xs text-slate-400 mt-0.5">Organize equipment catalog by operational category</p>
        </div>
        <button id="add-category-btn" class="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-[#138FCB] text-white rounded-xl hover:bg-[#0E78AC] transition-colors shadow-xs cursor-pointer">
          <span>+</span>
          <span>Add Product Category</span>
        </button>
      </div>

      <!-- Categories Cards Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        ${categories.map(cat => {
          const prodCount = products.filter(p => p.categoryId === cat.id).length;
          return `
            <div class="bg-white rounded-2xl p-5 border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)] flex flex-col justify-between hover:border-slate-300 transition-all">
              <div>
                <div class="flex items-center justify-between mb-3">
                  <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">${cat.code}</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${cat.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
                    ${cat.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <h3 class="text-base font-bold text-[#1A1D1F]">${cat.name}</h3>
                <p class="text-xs text-slate-500 mt-1 line-clamp-2">${cat.description || 'No description provided.'}</p>
              </div>

              <div class="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                <span class="text-xs font-semibold text-slate-600">
                  <strong class="text-[#138FCB] text-sm">${prodCount}</strong> products
                </span>
                <div class="flex items-center gap-2">
                  <button class="view-category-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer" data-id="${cat.id}">
                    View & Edit
                  </button>
                  <button class="delete-category-btn text-xs text-rose-500 hover:text-rose-700 p-1.5 cursor-pointer" data-id="${cat.id}" title="Delete category">
                    🗑
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

export function bindCategoriesEvents(container, refreshCallback) {
  // Add Category button
  const addBtn = container.querySelector('#add-category-btn');
  if (addBtn) {
    addBtn.onclick = () => openCategoryModal(null, refreshCallback);
  }

  // View Category buttons
  container.querySelectorAll('.view-category-btn').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const category = productService.getCategoryById(id);
      openCategoryModal(category, refreshCallback);
    };
  });

  // Delete Category buttons
  container.querySelectorAll('.delete-category-btn').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      confirmAction({
        title: 'Delete Category',
        message: 'This record may affect inventory, accounting or related transactions. Are you sure you want to continue?',
        onConfirm: () => {
          try {
            productService.deleteCategory(id);
            toast.show('Category deleted successfully.', 'success');
            refreshCallback();
          } catch (err) {
            toast.show(err.message, 'error');
          }
        }
      });
    };
  });
}

function openCategoryModal(category = null, onSaved) {
  const isEdit = !!category;
  const contentHtml = `
    <form id="category-form" class="space-y-4 text-xs">
      <div>
        <label class="block font-bold text-slate-700 mb-1">Category Code</label>
        <input type="text" disabled value="${category ? category.code : 'Auto-generated (e.g. CAT-007)'}" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-500">
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Category Name *</label>
        <input type="text" id="cat-name-input" required value="${category ? category.name : ''}" placeholder="e.g. Feeding Equipment" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">
      </div>

      <div>
        <label class="block font-bold text-slate-700 mb-1">Description</label>
        <textarea id="cat-desc-input" rows="3" placeholder="Category purpose and item scope..." class="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#138FCB]">${category ? (category.description || '') : ''}</textarea>
      </div>

      <div class="flex items-center gap-2 pt-2">
        <input type="checkbox" id="cat-active-input" ${!category || category.isActive ? 'checked' : ''} class="rounded border-slate-300 text-[#138FCB] focus:ring-0">
        <label for="cat-active-input" class="font-medium text-slate-700">Active Category</label>
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" id="cat-cancel-btn" class="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold transition-colors cursor-pointer">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-[#138FCB] hover:bg-[#0E78AC] text-white rounded-xl font-semibold shadow-xs transition-colors cursor-pointer">${isEdit ? 'Save Changes' : 'Create Category'}</button>
      </div>
    </form>
  `;

  openModal({
    title: isEdit ? `Edit Category: ${category.name}` : 'Add Product Category',
    subtitle: 'Manage catalog classification',
    contentHtml,
    size: 'max-w-md',
    onOpen: (modalEl) => {
      modalEl.querySelector('#cat-cancel-btn').onclick = () => closeModal();
      modalEl.querySelector('#category-form').onsubmit = (e) => {
        e.preventDefault();
        const name = modalEl.querySelector('#cat-name-input').value.trim();
        const description = modalEl.querySelector('#cat-desc-input').value.trim();
        const isActive = modalEl.querySelector('#cat-active-input').checked;

        if (!name) {
          toast.show('Please enter category name.', 'warning');
          return;
        }

        if (isEdit) {
          productService.updateCategory(category.id, { name, description, isActive });
          toast.show('Category updated successfully.', 'success');
        } else {
          productService.createCategory({ name, description, isActive });
          toast.show('Category created successfully.', 'success');
        }

        closeModal();
        if (onSaved) onSaved();
      };
    }
  });
}

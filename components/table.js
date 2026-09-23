/**
 * JS Traders ERP - Semantic Data Table Component
 * Matches design specification from Design/code 2.html
 */

export function renderTable({
  columns = [], // Array of { key, label, align: 'left'|'right'|'center', render: (row) => ... }
  data = [],
  actions = [], // Array of { label, icon, onClick, variant: 'primary'|'secondary'|'danger'|'emerald' }
  emptyMessage = 'No records found.'
}) {
  if (!data || data.length === 0) {
    return `
      <div class="bg-white rounded-2xl p-12 border border-[#EAECEF] text-center shadow-xs">
        <div class="w-12 h-12 rounded-full bg-slate-100 text-slate-400 mx-auto flex items-center justify-center text-xl mb-3">📋</div>
        <h4 class="text-sm font-bold text-slate-700">Empty List</h4>
        <p class="text-xs text-slate-400 mt-1 max-w-sm mx-auto">${emptyMessage}</p>
      </div>
    `;
  }

  return `
    <div class="bg-white rounded-2xl border border-[#EAECEF] shadow-[0_2px_4px_rgba(0,0,0,0.02)] overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs text-[#6F767E]">
          <thead>
            <tr class="border-b border-[#ECEEF2] text-[11px] uppercase font-bold text-gray-400 tracking-wider bg-slate-50/50">
              <th class="py-3 px-4 w-10">
                <input class="rounded border-gray-300 text-[#138FCB] focus:ring-0 w-3.5 h-3.5" type="checkbox">
              </th>
              ${columns.map(col => `
                <th class="py-3 px-4 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}">
                  <div class="flex items-center gap-1 ${col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : ''}">
                    <span>${col.label || col.header || ''}</span>
                    <span class="text-[9px] text-gray-400">⇅</span>
                  </div>
                </th>
              `).join('')}
              ${actions.length > 0 ? '<th class="py-3 px-4 text-right">Actions</th>' : ''}
            </tr>
          </thead>
          <tbody class="divide-y divide-[#F4F5F7]">
            ${data.map((row, rowIdx) => `
              <tr class="hover:bg-slate-50/80 transition-colors" data-row-id="${row.id || rowIdx}">
                <td class="py-3 px-4">
                  <input class="rounded border-gray-300 text-[#138FCB] focus:ring-0 w-3.5 h-3.5" type="checkbox">
                </td>
                ${columns.map(col => {
                  let cellContent = '-';
                  if (col.render) {
                    // Check function arity: if >= 2 args, pass (val, row), else pass (row)
                    cellContent = col.render.length >= 2 ? col.render(row[col.key], row) : col.render(row);
                  } else if (row[col.key] !== undefined && row[col.key] !== null) {
                    cellContent = row[col.key];
                  }
                  return `
                    <td class="py-3 px-4 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}">
                      ${cellContent}
                    </td>
                  `;
                }).join('')}
                ${actions.length > 0 ? `
                  <td class="py-3 px-4 text-right whitespace-nowrap">
                    <div class="flex items-center justify-end gap-1.5">
                      ${actions.map((act, actIdx) => `
                        <button
                          class="action-btn px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                            act.variant === 'danger' ? 'text-rose-600 hover:bg-rose-50' :
                            act.variant === 'primary' ? 'bg-[#138FCB] text-white hover:bg-[#0E78AC]' :
                            act.variant === 'emerald' ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' :
                            'text-slate-600 hover:bg-slate-100'
                          }"
                          data-action-index="${actIdx}"
                          data-row-id="${row.id || rowIdx}">
                          ${typeof act.label === 'function' ? act.label(row) : act.label}
                        </button>
                      `).join('')}
                    </div>
                  </td>
                ` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <!-- Footer pagination & count -->
      <div class="px-5 py-3 border-t border-[#ECEEF2] flex items-center justify-between text-xs text-slate-400 bg-slate-50/40">
        <span>Showing <strong class="text-slate-700">${data.length}</strong> entries</span>
        <div class="flex items-center gap-2">
          <button class="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40" disabled>Previous</button>
          <span class="px-2 font-semibold text-slate-700">1</span>
          <button class="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40" disabled>Next</button>
        </div>
      </div>
    </div>
  `;
}

export function bindTableActions(container, actions, data) {
  const buttons = container.querySelectorAll('.action-btn');
  buttons.forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const actionIndex = Number(btn.getAttribute('data-action-index'));
      const rowId = btn.getAttribute('data-row-id');
      const action = actions[actionIndex];
      const row = data.find(d => String(d.id || '') === String(rowId)) || data[Number(rowId)];
      if (action && action.onClick) {
        action.onClick(row);
      }
    };
  });
}

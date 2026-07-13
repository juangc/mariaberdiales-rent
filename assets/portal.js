const state = {
  user: null,
  users: [],
  documents: [],
  filters: {
    kind: 'all',
    status: 'all',
    utilityType: 'all',
  },
  editingDocumentId: null,
};

const elements = Object.fromEntries([
  'adminView', 'dashboardView', 'documentCancelButton', 'documentFile', 'documentFileField',
  'documentFilter', 'documentForm', 'documentFormTitle', 'documentKind', 'documentStatusFilter',
  'documentList', 'documentMessage', 'documentSummary', 'documentTenant',
  'documentSubmitButton', 'documentUtilityFilter', 'documentUtilityType', 'documentVisibility',
  'emptyDocuments', 'emptyDocumentsText', 'emptyDocumentsTitle',
  'loginForm', 'loginMessage', 'loginView',
  'logoutButton', 'tenantField', 'userForm', 'userList', 'userMessage', 'welcomeTitle',
  'utilityTypeField',
].map((id) => [id, document.getElementById(id)]));

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(payload?.error || 'No se ha podido completar la operación.');
  return payload;
}

function setMessage(element, message, error = false) {
  element.textContent = message;
  element.classList.toggle('is-error', error);
}

function formatMoney(cents) {
  if (cents === null || cents === undefined) return null;
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

function formatDate(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`));
}

const statusLabels = {
  information: 'Informativo',
  pending: 'Pendiente',
  paid: 'Pagada',
  overdue: 'Vencida',
};

const kindLabels = {
  contract: 'Contrato',
  invoice: 'Factura',
  other: 'Documento',
};

const utilityLabels = {
  electricity: 'Luz',
  water: 'Agua',
  gas: 'Gas',
  other: 'Otros',
};

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function renderSummary() {
  elements.documentSummary.replaceChildren();
  const invoices = state.documents.filter((documentItem) => documentItem.kind === 'invoice');
  const pendingTotal = invoices
    .filter((documentItem) => ['pending', 'overdue'].includes(documentItem.status))
    .reduce((total, documentItem) => total + (documentItem.amountCents || 0), 0);
  const values = [
    ['Documentos', String(state.documents.length)],
    ['Facturas pendientes', String(invoices.filter((item) => ['pending', 'overdue'].includes(item.status)).length)],
    ['Importe pendiente', formatMoney(pendingTotal)],
  ];
  values.forEach(([label, value]) => {
    const card = document.createElement('div');
    card.className = 'summary-card';
    card.append(textElement('span', 'summary-label', label), textElement('strong', 'summary-value', value));
    elements.documentSummary.append(card);
  });
}

function documentCard(documentItem) {
  const article = document.createElement('article');
  article.className = 'document-card';

  const header = document.createElement('div');
  header.className = 'document-card-main';
  const tags = document.createElement('div');
  tags.className = 'document-tags';
  if (documentItem.kind === 'invoice') {
    const utilityType = documentItem.utilityType || 'other';
    tags.append(textElement('span', `utility-tag utility-${utilityType}`, utilityLabels[utilityType]));
  }
  tags.append(textElement('span', 'document-kind', kindLabels[documentItem.kind]));
  tags.append(textElement('span', `document-status status-${documentItem.status}`, statusLabels[documentItem.status]));
  header.append(tags, textElement('h3', 'document-title', documentItem.title));

  const meta = document.createElement('div');
  meta.className = 'document-meta';
  [
    documentItem.period,
    formatMoney(documentItem.amountCents),
    documentItem.dueDate ? `Vence ${formatDate(documentItem.dueDate)}` : null,
    documentItem.visibility === 'private' ? `Privado · ${documentItem.tenantName || 'Inquilino'}` : 'Compartido',
  ].filter(Boolean).forEach((value) => meta.append(textElement('span', '', value)));
  header.append(meta);

  const actions = document.createElement('div');
  actions.className = 'document-actions';
  const open = textElement('a', 'document-open-button', 'Abrir PDF');
  open.href = documentItem.fileUrl;
  open.target = '_blank';
  open.rel = 'noopener';
  actions.append(open);

  if (state.user.role === 'admin') {
    const edit = textElement('button', 'document-edit-button', 'Editar');
    edit.type = 'button';
    edit.addEventListener('click', () => startDocumentEdit(documentItem));
    const status = document.createElement('select');
    status.className = 'field-input compact-select';
    Object.entries(statusLabels).forEach(([value, label]) => {
      const option = new Option(label, value, false, value === documentItem.status);
      status.add(option);
    });
    status.addEventListener('change', async () => {
      try {
        await api(`/api/admin/documents/${documentItem.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: status.value }),
        });
        await loadDocuments();
      } catch (error) {
        window.alert(error.message);
      }
    });
    const remove = textElement('button', 'document-delete-button', 'Eliminar');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`¿Eliminar “${documentItem.title}”?`)) return;
      try {
        await api(`/api/admin/documents/${documentItem.id}`, { method: 'DELETE' });
        if (state.editingDocumentId === documentItem.id) resetDocumentForm();
        await loadDocuments();
      } catch (error) {
        window.alert(error.message);
      }
    });
    actions.append(edit, status, remove);
  }

  article.append(header, actions);
  return article;
}

function renderDocuments() {
  elements.documentList.replaceChildren();
  const visible = state.documents.filter((item) => (
    (state.filters.kind === 'all' || item.kind === state.filters.kind)
    && (state.filters.status === 'all' || item.status === state.filters.status)
    && (state.filters.utilityType === 'all' || item.utilityType === state.filters.utilityType)
  ));
  visible.forEach((item) => elements.documentList.append(documentCard(item)));
  elements.emptyDocuments.classList.toggle('hidden', visible.length > 0);
  elements.emptyDocumentsTitle.textContent = state.documents.length
    ? 'Sin resultados'
    : 'Todavía no hay documentos';
  elements.emptyDocumentsText.textContent = state.documents.length
    ? 'No hay documentos que coincidan con los filtros seleccionados.'
    : 'Cuando se publique una factura o un contrato aparecerá aquí.';
  renderSummary();
}

function renderUsers() {
  elements.userList.replaceChildren();
  state.users.forEach((user) => {
    const row = document.createElement('div');
    row.className = 'user-row';
    const identity = document.createElement('div');
    identity.append(
      textElement('strong', 'user-name', user.name),
      textElement('span', 'user-email', user.email),
    );
    const meta = document.createElement('div');
    meta.className = 'user-actions';
    meta.append(textElement('span', 'user-role', user.role === 'admin' ? 'Administrador' : 'Inquilino'));
    if (user.role === 'tenant') {
      const toggle = textElement('button', 'portal-quiet-button', user.active ? 'Desactivar' : 'Activar');
      toggle.type = 'button';
      toggle.addEventListener('click', async () => {
        try {
          await api(`/api/admin/users/${user.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ active: !user.active }),
          });
          await loadUsers();
        } catch (error) {
          window.alert(error.message);
        }
      });
      meta.append(toggle);
    }
    row.append(identity, meta);
    elements.userList.append(row);
  });
}

function updateTenantField() {
  const isPrivate = elements.documentVisibility.value === 'private';
  elements.tenantField.classList.toggle('hidden', !isPrivate);
  elements.documentTenant.required = isPrivate;
}

function updateUtilityTypeField() {
  const isInvoice = elements.documentKind.value === 'invoice';
  elements.utilityTypeField.classList.toggle('hidden', !isInvoice);
  elements.documentUtilityType.required = isInvoice;
  elements.documentUtilityType.disabled = !isInvoice;
}

function resetDocumentForm() {
  state.editingDocumentId = null;
  elements.documentForm.reset();
  elements.documentFormTitle.textContent = 'Publicar documento';
  elements.documentSubmitButton.textContent = 'Publicar documento';
  elements.documentCancelButton.classList.add('hidden');
  elements.documentFileField.classList.remove('hidden');
  elements.documentFile.required = true;
  updateTenantField();
  updateUtilityTypeField();
  setMessage(elements.documentMessage, '');
}

function startDocumentEdit(documentItem) {
  state.editingDocumentId = documentItem.id;
  elements.documentKind.value = documentItem.kind;
  elements.documentUtilityType.value = documentItem.utilityType || 'other';
  elements.documentVisibility.value = documentItem.visibility;
  elements.documentForm.elements.title.value = documentItem.title;
  elements.documentTenant.value = documentItem.tenantId || '';
  elements.documentForm.elements.period.value = documentItem.period || '';
  elements.documentForm.elements.amount.value = documentItem.amountCents === null
    ? ''
    : (documentItem.amountCents / 100).toFixed(2);
  elements.documentForm.elements.dueDate.value = documentItem.dueDate || '';
  elements.documentForm.elements.status.value = documentItem.status;
  elements.documentFormTitle.textContent = 'Editar documento';
  elements.documentSubmitButton.textContent = 'Guardar cambios';
  elements.documentCancelButton.classList.remove('hidden');
  elements.documentFileField.classList.add('hidden');
  elements.documentFile.required = false;
  updateTenantField();
  updateUtilityTypeField();
  setMessage(elements.documentMessage, `Editando “${documentItem.title}”.`);
  elements.documentForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadDocuments() {
  const payload = await api('/api/documents');
  state.documents = payload.documents;
  renderDocuments();
}

async function loadUsers() {
  const payload = await api('/api/admin/users');
  state.users = payload.users;
  renderUsers();
  elements.documentTenant.replaceChildren(new Option('Selecciona un inquilino', ''));
  state.users.filter((user) => user.role === 'tenant' && user.active).forEach((user) => {
    elements.documentTenant.add(new Option(`${user.name} · ${user.email}`, user.id));
  });
}

async function showDashboard(user) {
  state.user = user;
  elements.loginView.classList.add('hidden');
  elements.dashboardView.classList.remove('hidden');
  elements.logoutButton.classList.remove('hidden');
  elements.adminView.classList.toggle('hidden', user.role !== 'admin');
  elements.welcomeTitle.textContent = user.role === 'admin' ? 'Documentación del piso' : `Hola, ${user.name}`;
  await loadDocuments();
  if (user.role === 'admin') await loadUsers();
}

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(elements.loginMessage, 'Comprobando…');
  const data = new FormData(elements.loginForm);
  try {
    const payload = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
    });
    elements.loginForm.reset();
    setMessage(elements.loginMessage, '');
    await showDashboard(payload.user);
  } catch (error) {
    setMessage(elements.loginMessage, error.message, true);
  }
});

elements.logoutButton.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  window.location.reload();
});

elements.documentFilter.addEventListener('change', () => {
  state.filters.kind = elements.documentFilter.value;
  if (!['all', 'invoice'].includes(state.filters.kind)) {
    state.filters.utilityType = 'all';
    elements.documentUtilityFilter.value = 'all';
  }
  renderDocuments();
});

elements.documentStatusFilter.addEventListener('change', () => {
  state.filters.status = elements.documentStatusFilter.value;
  renderDocuments();
});

elements.documentUtilityFilter.addEventListener('change', () => {
  state.filters.utilityType = elements.documentUtilityFilter.value;
  if (state.filters.utilityType !== 'all') {
    state.filters.kind = 'invoice';
    elements.documentFilter.value = 'invoice';
  }
  renderDocuments();
});

elements.documentKind.addEventListener('change', () => {
  const contract = elements.documentKind.value === 'contract';
  elements.documentVisibility.value = contract ? 'private' : 'shared';
  elements.documentForm.elements.status.value = contract ? 'information' : 'pending';
  updateTenantField();
  updateUtilityTypeField();
});
elements.documentVisibility.addEventListener('change', updateTenantField);
elements.documentCancelButton.addEventListener('click', resetDocumentForm);

elements.userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(elements.userMessage, 'Creando…');
  const form = new FormData(elements.userForm);
  try {
    await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(form)),
    });
    elements.userForm.reset();
    setMessage(elements.userMessage, 'Inquilino creado correctamente.');
    await loadUsers();
  } catch (error) {
    setMessage(elements.userMessage, error.message, true);
  }
});

elements.documentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const editing = state.editingDocumentId !== null;
  setMessage(elements.documentMessage, editing ? 'Guardando cambios…' : 'Subiendo PDF…');
  const form = new FormData(elements.documentForm);
  const params = new URLSearchParams();
  ['kind', 'utilityType', 'visibility', 'title', 'tenantId', 'period', 'dueDate', 'status'].forEach((field) => {
    const value = form.get(field);
    if (value) params.set(field, value);
  });
  const amount = form.get('amount');
  if (amount) params.set('amountCents', String(Math.round(Number(amount) * 100)));
  try {
    if (editing) {
      await api(`/api/admin/documents/${state.editingDocumentId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          kind: form.get('kind'),
          utilityType: form.get('utilityType'),
          visibility: form.get('visibility'),
          title: form.get('title'),
          tenantId: form.get('tenantId') || null,
          period: form.get('period') || null,
          amountCents: amount ? Math.round(Number(amount) * 100) : null,
          dueDate: form.get('dueDate') || null,
          status: form.get('status'),
        }),
      });
      resetDocumentForm();
      setMessage(elements.documentMessage, 'Documento actualizado correctamente.');
    } else {
      const file = form.get('file');
      await api(`/api/admin/documents?${params}`, {
        method: 'POST',
        body: file,
        headers: {
          'Content-Type': 'application/pdf',
          'X-File-Name': encodeURIComponent(file.name),
        },
      });
      resetDocumentForm();
      setMessage(elements.documentMessage, 'Documento publicado correctamente.');
    }
    await loadDocuments();
  } catch (error) {
    setMessage(elements.documentMessage, error.message, true);
  }
});

async function initialise() {
  try {
    const payload = await api('/api/me');
    await showDashboard(payload.user);
  } catch {
    elements.loginView.classList.remove('hidden');
  }
  updateTenantField();
  updateUtilityTypeField();
}

initialise();

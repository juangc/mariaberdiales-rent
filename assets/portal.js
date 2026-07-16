const state = {
  user: null,
  wifi: null,
  wifiLoaded: false,
  activeSection: 'overview',
  users: [],
  documents: [],
  attentionDocuments: [],
  filters: {
    kind: 'all',
    status: 'all',
    utilityType: 'all',
  },
  pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 },
  summary: { documentCount: 0, pendingInvoiceCount: 0, pendingAmountCents: 0 },
  editingDocumentId: null,
  editingUserId: null,
  activeAdminSection: 'users',
};

const elements = Object.fromEntries([
  'adminDocumentCount', 'adminDocumentList', 'adminDocumentsNavButton', 'adminDocumentsSection',
  'adminEmptyDocuments', 'adminNavButton', 'adminOpenDocumentsButton',
  'adminSectionNav', 'adminUsersNavButton', 'adminUsersSection', 'adminView',
  'attentionDocumentCount', 'attentionDocumentList', 'attentionEmpty',
  'attentionEmptyText', 'attentionEmptyTitle',
  'dashboardView', 'documentCancelButton', 'documentFile', 'documentFileField',
  'documentFilter', 'documentForm', 'documentFormTitle', 'documentKind', 'documentStatusFilter',
  'documentList', 'documentMessage', 'documentSummary', 'documentTenant',
  'documentsNavButton', 'documentsNavCount', 'documentSubmitButton', 'documentUtilityFilter', 'documentUtilityType', 'documentVisibility',
  'emptyDocuments', 'emptyDocumentsText', 'emptyDocumentsTitle',
  'copyWifiPasswordButton', 'loginForm', 'loginMessage', 'loginView',
  'logoutButton', 'nextPageButton', 'overviewDocumentsButton', 'overviewNavButton', 'pagination', 'paginationInfo',
  'portalDocumentsSection', 'portalOverviewSection', 'portalSectionNav', 'previousPageButton',
  'residentWifiQr', 'showWifiPasswordButton', 'tenantField', 'userCancelButton', 'userForm',
  'userFormTitle', 'userList', 'userMessage', 'userPassword', 'userPasswordConfirmation',
  'userSubmitButton', 'utilityTypeField', 'welcomeTitle', 'wifi', 'wifiMessage', 'wifiPassword',
  'wifiNavButton', 'wifiRecommendedSsid', 'wifiSecondarySsid',
].map((id) => [id, document.getElementById(id)]));

const WIFI_PASSWORD_MASK = '••••••••••••';
const portalSections = {
  overview: { panel: elements.portalOverviewSection, button: elements.overviewNavButton, hash: '#inicio' },
  wifi: { panel: elements.wifi, button: elements.wifiNavButton, hash: '#wifi' },
  documents: { panel: elements.portalDocumentsSection, button: elements.documentsNavButton, hash: '#documentos' },
  admin: { panel: elements.adminView, button: elements.adminNavButton, hash: '#administracion' },
};
const adminSections = {
  users: { panel: elements.adminUsersSection, button: elements.adminUsersNavButton },
  documents: { panel: elements.adminDocumentsSection, button: elements.adminDocumentsNavButton },
};

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

function wifiQrPayload(wifi) {
  const escapeValue = (value) => String(value).replace(/([\\;,:"])/g, '\\$1');
  return `WIFI:T:WPA;S:${escapeValue(wifi.recommendedSsid)};P:${escapeValue(wifi.password)};;`;
}

function renderWifiQr(wifi) {
  elements.residentWifiQr.replaceChildren();
  if (typeof window.qrcode !== 'function') {
    elements.residentWifiQr.textContent = 'QR no disponible';
    return;
  }
  const qr = window.qrcode(0, 'M');
  qr.addData(wifiQrPayload(wifi));
  qr.make();
  elements.residentWifiQr.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 0, scalable: true });
  const svg = elements.residentWifiQr.querySelector('svg');
  if (svg) {
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';
  }
}

function renderWifi(wifi) {
  state.wifi = wifi;
  elements.wifiRecommendedSsid.textContent = wifi.recommendedSsid;
  elements.wifiSecondarySsid.textContent = `Red alternativa · 2,4 GHz: ${wifi.secondarySsid}`;
  elements.wifiPassword.textContent = WIFI_PASSWORD_MASK;
  elements.showWifiPasswordButton.disabled = false;
  elements.copyWifiPasswordButton.disabled = false;
  elements.showWifiPasswordButton.textContent = 'Mostrar contraseña';
  elements.showWifiPasswordButton.setAttribute('aria-pressed', 'false');
  renderWifiQr(wifi);
}

async function loadWifi() {
  try {
    const payload = await api('/api/wifi');
    renderWifi(payload.wifi);
    state.wifiLoaded = true;
    setMessage(elements.wifiMessage, '');
  } catch (error) {
    state.wifi = null;
    state.wifiLoaded = false;
    elements.wifiRecommendedSsid.textContent = 'No disponible';
    elements.wifiSecondarySsid.textContent = '';
    elements.residentWifiQr.textContent = 'QR no disponible';
    elements.showWifiPasswordButton.disabled = true;
    elements.copyWifiPasswordButton.disabled = true;
    setMessage(elements.wifiMessage, error.message, true);
  }
}

function fallbackCopy(value) {
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('No se ha podido copiar la contraseña.');
}

function sectionFromHash() {
  const match = Object.entries(portalSections).find(([, section]) => section.hash === window.location.hash);
  return match?.[0] || 'overview';
}

async function showPortalSection(requestedSection, updateLocation = true) {
  const sectionName = portalSections[requestedSection]
    && (requestedSection !== 'admin' || state.user?.role === 'admin')
    ? requestedSection
    : 'overview';

  state.activeSection = sectionName;
  Object.entries(portalSections).forEach(([name, section]) => {
    const active = name === sectionName;
    section.panel.classList.toggle('hidden', !active);
    section.button.classList.toggle('is-active', active);
    section.button.setAttribute('aria-pressed', String(active));
  });

  if (sectionName === 'wifi' && !state.wifiLoaded) await loadWifi();
  if (updateLocation) {
    window.history.replaceState(null, '', portalSections[sectionName].hash);
    elements.portalSectionNav.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function showAdminSection(requestedSection) {
  const sectionName = adminSections[requestedSection] ? requestedSection : 'users';
  state.activeAdminSection = sectionName;
  Object.entries(adminSections).forEach(([name, section]) => {
    const active = name === sectionName;
    section.panel.classList.toggle('hidden', !active);
    section.button.classList.toggle('is-active', active);
    section.button.setAttribute('aria-pressed', String(active));
  });
}

function renderSummary() {
  elements.documentsNavCount.textContent = state.summary.documentCount;
  elements.documentsNavCount.classList.toggle('hidden', state.summary.documentCount === 0);
  elements.documentsNavCount.classList.toggle('needs-attention', state.summary.pendingInvoiceCount > 0);
  elements.documentsNavCount.setAttribute(
    'aria-label',
    `${state.summary.documentCount === 1 ? '1 documento disponible' : `${state.summary.documentCount} documentos disponibles`}${
      state.summary.pendingInvoiceCount > 0
        ? `, ${state.summary.pendingInvoiceCount} ${state.summary.pendingInvoiceCount === 1 ? 'requiere' : 'requieren'} revisión`
        : ''
    }`,
  );
  elements.documentSummary.replaceChildren();
  const values = [
    ['Documentos', String(state.summary.documentCount)],
    ['Por revisar', String(state.summary.pendingInvoiceCount)],
    ['Importe por revisar', formatMoney(state.summary.pendingAmountCents)],
  ];
  values.forEach(([label, value]) => {
    const card = document.createElement('div');
    card.className = 'summary-card';
    card.append(textElement('span', 'summary-label', label), textElement('strong', 'summary-value', value));
    elements.documentSummary.append(card);
  });
}

function attentionDocumentRow(documentItem) {
  const row = document.createElement('article');
  row.className = 'overview-document-row';

  const status = textElement(
    'span',
    `overview-document-status status-${documentItem.status}`,
    statusLabels[documentItem.status],
  );
  const copy = document.createElement('div');
  copy.className = 'overview-document-copy';
  const title = textElement('a', 'overview-document-title', documentItem.title);
  title.href = documentItem.fileUrl;
  title.target = '_blank';
  title.rel = 'noopener';
  const dateLabel = documentItem.dueDate
    ? `${documentItem.status === 'overdue' ? 'Venció' : 'Vence'} ${formatDate(documentItem.dueDate)}`
    : 'Sin fecha de vencimiento';
  copy.append(title, textElement('span', 'overview-document-meta', [documentItem.period, dateLabel].filter(Boolean).join(' · ')));

  const amount = textElement('strong', 'overview-document-amount', formatMoney(documentItem.amountCents) || '—');
  row.append(status, copy, amount);
  return row;
}

function renderAttentionDocuments() {
  const total = state.summary.pendingInvoiceCount;
  const hasRows = state.attentionDocuments.length > 0;
  const missingDetail = total > 0 && !hasRows;
  elements.attentionDocumentCount.textContent = total === 1 ? '1 documento' : `${total} documentos`;
  elements.attentionDocumentList.replaceChildren();
  state.attentionDocuments.forEach((item) => elements.attentionDocumentList.append(attentionDocumentRow(item)));
  elements.attentionDocumentList.classList.toggle('hidden', !hasRows);
  elements.attentionEmpty.classList.toggle('hidden', hasRows);
  elements.attentionEmpty.classList.toggle('is-warning', missingDetail);
  elements.attentionEmptyTitle.textContent = missingDetail ? 'Hay documentos por revisar' : 'Todo al día';
  elements.attentionEmptyText.textContent = missingDetail
    ? 'Abre Documentos para consultar las facturas pendientes o vencidas.'
    : 'No hay facturas vencidas ni pendientes.';
}

function renderPagination() {
  const { page, total, totalPages } = state.pagination;
  elements.pagination.classList.toggle('hidden', totalPages <= 1);
  elements.paginationInfo.textContent = `Página ${page} de ${totalPages} · ${total} documentos`;
  elements.previousPageButton.disabled = page <= 1;
  elements.nextPageButton.disabled = page >= totalPages;
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

function renderDocumentList(container) {
  container.replaceChildren(...state.documents.map(documentCard));
}

function renderDocuments() {
  const hasDocuments = state.documents.length > 0;
  renderDocumentList(elements.documentList);
  renderDocumentList(elements.adminDocumentList);
  elements.emptyDocuments.classList.toggle('hidden', hasDocuments);
  elements.adminDocumentList.classList.toggle('hidden', !hasDocuments);
  elements.adminEmptyDocuments.classList.toggle('hidden', hasDocuments);
  elements.adminDocumentCount.textContent = state.pagination.total === 1
    ? '1 documento'
    : `${state.pagination.total} documentos`;
  elements.emptyDocumentsTitle.textContent = state.summary.documentCount
    ? 'Sin resultados'
    : 'Todavía no hay documentos';
  elements.emptyDocumentsText.textContent = state.summary.documentCount
    ? 'No hay documentos que coincidan con los filtros seleccionados.'
    : 'Cuando se publique una factura o un contrato aparecerá aquí.';
  renderSummary();
  renderAttentionDocuments();
  renderPagination();
}

function resetUserForm() {
  state.editingUserId = null;
  elements.userForm.reset();
  elements.userFormTitle.textContent = 'Crear acceso';
  elements.userSubmitButton.textContent = 'Crear inquilino';
  elements.userCancelButton.classList.add('hidden');
  elements.userPassword.required = true;
  elements.userPasswordConfirmation.required = true;
  elements.userPassword.placeholder = '';
  elements.userPasswordConfirmation.placeholder = '';
  setMessage(elements.userMessage, '');
}

function startUserEdit(user) {
  state.editingUserId = user.id;
  elements.userForm.elements.name.value = user.name;
  elements.userForm.elements.email.value = user.email;
  elements.userPassword.value = '';
  elements.userPasswordConfirmation.value = '';
  elements.userPassword.required = false;
  elements.userPasswordConfirmation.required = false;
  elements.userPassword.placeholder = 'Dejar en blanco para conservarla';
  elements.userPasswordConfirmation.placeholder = 'Repetir solo si se cambia';
  elements.userFormTitle.textContent = 'Editar usuario';
  elements.userSubmitButton.textContent = 'Guardar cambios';
  elements.userCancelButton.classList.remove('hidden');
  setMessage(elements.userMessage, `Editando a ${user.name}.`);
  showAdminSection('users');
  elements.userForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderUsers() {
  elements.userList.replaceChildren();
  state.users.forEach((user) => {
    const row = document.createElement('div');
    row.className = 'user-row';
    const identity = document.createElement('div');
    identity.className = 'user-identity';
    identity.append(
      textElement('strong', 'user-name', user.name),
      textElement('span', 'user-email', user.email),
    );
    const status = textElement(
      'span',
      `user-status ${user.active ? 'is-active' : 'is-disabled'}`,
      user.active ? 'Activo' : 'Deshabilitado',
    );
    const meta = document.createElement('div');
    meta.className = 'user-actions';
    meta.append(status, textElement('span', 'user-role', user.role === 'admin' ? 'Administrador' : 'Inquilino'));
    if (user.role === 'tenant') {
      const edit = textElement('button', 'portal-quiet-button', 'Editar');
      edit.type = 'button';
      edit.addEventListener('click', () => startUserEdit(user));
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
      const remove = textElement('button', 'user-delete-button', 'Eliminar');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        const documents = Number(user.documentCount || 0);
        const warning = documents
          ? ` También se eliminarán ${documents} ${documents === 1 ? 'documento privado asociado' : 'documentos privados asociados'}.`
          : '';
        if (!window.confirm(`¿Eliminar definitivamente a “${user.name}”?${warning} Esta acción no se puede deshacer.`)) return;
        try {
          await api(`/api/admin/users/${user.id}`, { method: 'DELETE' });
          if (state.editingUserId === user.id) resetUserForm();
          await Promise.all([loadUsers(), loadDocuments()]);
        } catch (error) {
          window.alert(error.message);
        }
      });
      meta.append(edit, toggle, remove);
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
  showPortalSection('admin').then(() => {
    showAdminSection('documents');
    elements.documentForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

async function loadDocuments() {
  const params = new URLSearchParams({ page: String(state.pagination.page) });
  Object.entries(state.filters).forEach(([field, value]) => {
    if (value !== 'all') params.set(field, value);
  });
  const payload = await api(`/api/documents?${params}`);
  state.documents = payload.documents;
  state.attentionDocuments = Array.isArray(payload.attentionDocuments)
    ? payload.attentionDocuments
    : payload.documents
      .filter((item) => item.kind === 'invoice' && ['pending', 'overdue'].includes(item.status))
      .sort((left, right) => {
        if (left.status !== right.status) return left.status === 'overdue' ? -1 : 1;
        return String(left.dueDate || '').localeCompare(String(right.dueDate || ''));
      })
      .slice(0, 6);
  state.pagination = payload.pagination;
  state.summary = payload.summary;
  renderDocuments();
}

async function applyFilters() {
  state.pagination.page = 1;
  try {
    await loadDocuments();
  } catch (error) {
    window.alert(error.message);
  }
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
  elements.adminNavButton.classList.toggle('hidden', user.role !== 'admin');
  elements.welcomeTitle.textContent = user.role === 'admin' ? 'Panel de gestión' : `Hola, ${user.name}`;
  await loadDocuments();
  if (user.role === 'admin') await loadUsers();
  await showPortalSection(sectionFromHash(), false);
}

elements.portalSectionNav.addEventListener('click', (event) => {
  const button = event.target.closest('[data-portal-section]');
  if (!button) return;
  showPortalSection(button.dataset.portalSection);
});

elements.adminSectionNav.addEventListener('click', (event) => {
  const button = event.target.closest('[data-admin-section]');
  if (!button) return;
  showAdminSection(button.dataset.adminSection);
});

elements.overviewDocumentsButton.addEventListener('click', () => showPortalSection('documents'));
elements.adminOpenDocumentsButton.addEventListener('click', () => showPortalSection('documents'));

window.addEventListener('hashchange', () => {
  if (state.user) showPortalSection(sectionFromHash(), false);
});

elements.showWifiPasswordButton.addEventListener('click', () => {
  if (!state.wifi) return;
  const showing = elements.showWifiPasswordButton.getAttribute('aria-pressed') === 'true';
  elements.wifiPassword.textContent = showing ? WIFI_PASSWORD_MASK : state.wifi.password;
  elements.showWifiPasswordButton.textContent = showing ? 'Mostrar contraseña' : 'Ocultar contraseña';
  elements.showWifiPasswordButton.setAttribute('aria-pressed', String(!showing));
  setMessage(elements.wifiMessage, '');
});

elements.copyWifiPasswordButton.addEventListener('click', async () => {
  if (!state.wifi) return;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(state.wifi.password);
    else fallbackCopy(state.wifi.password);
    setMessage(elements.wifiMessage, 'Contraseña copiada.');
  } catch (error) {
    setMessage(elements.wifiMessage, error.message || 'No se ha podido copiar la contraseña.', true);
  }
});

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
  applyFilters();
});

elements.documentStatusFilter.addEventListener('change', () => {
  state.filters.status = elements.documentStatusFilter.value;
  applyFilters();
});

elements.documentUtilityFilter.addEventListener('change', () => {
  state.filters.utilityType = elements.documentUtilityFilter.value;
  if (state.filters.utilityType !== 'all') {
    state.filters.kind = 'invoice';
    elements.documentFilter.value = 'invoice';
  }
  applyFilters();
});

elements.previousPageButton.addEventListener('click', async () => {
  if (state.pagination.page <= 1) return;
  state.pagination.page -= 1;
  try {
    await loadDocuments();
  } catch (error) {
    window.alert(error.message);
  }
});

elements.nextPageButton.addEventListener('click', async () => {
  if (state.pagination.page >= state.pagination.totalPages) return;
  state.pagination.page += 1;
  try {
    await loadDocuments();
  } catch (error) {
    window.alert(error.message);
  }
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
elements.userCancelButton.addEventListener('click', resetUserForm);

elements.userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const editing = state.editingUserId !== null;
  setMessage(elements.userMessage, editing ? 'Guardando cambios…' : 'Creando…');
  const form = new FormData(elements.userForm);
  const values = Object.fromEntries(form);
  try {
    if (values.password !== values.passwordConfirmation) throw new Error('Las contraseñas no coinciden.');
    if (editing && !values.password) {
      delete values.password;
      delete values.passwordConfirmation;
    }
    await api(editing ? `/api/admin/users/${state.editingUserId}` : '/api/admin/users', {
      method: editing ? 'PATCH' : 'POST',
      body: JSON.stringify(values),
    });
    resetUserForm();
    setMessage(elements.userMessage, editing ? 'Usuario actualizado correctamente.' : 'Inquilino creado correctamente.');
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

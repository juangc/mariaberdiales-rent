// Ajustes sencillos de la pagina. El HTML contiene los valores iniciales.
const PAGE_CONFIG = {
  theme: 'Lumia',
  wifiNetworks: [
    { elementId: 'wifiQR1', ssid: 'MOVISTAR_3050', password: 'P3zMmbSWLbqmJpacqyaz' },
    { elementId: 'wifiQR2', ssid: 'MOVISTAR_PLUS_3050', password: 'P3zMmbSWLbqmJpacqyaz' },
  ],
};

function renderWifiQrCodes() {
  if (typeof window.qrcode !== 'function') return;
  const escapeWifiValue = (value) => String(value).replace(/([\\;,:"])/g, '\\$1');

  PAGE_CONFIG.wifiNetworks.forEach(({ elementId, ssid, password }) => {
    const element = document.getElementById(elementId);
    if (!element) return;

    const payload = `WIFI:T:WPA;S:${escapeWifiValue(ssid)};P:${escapeWifiValue(password)};;`;
    const qr = window.qrcode(0, 'M');
    qr.addData(payload);
    qr.make();
    element.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });

    const svg = element.querySelector('svg');
    if (svg) {
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.display = 'block';
    }
  });
}

function enableSectionNavigation() {
  const sectionIds = [
    'wifi', 'humedad', 'deshumidificador', 'calefaccion', 'lavadora', 'cocina',
    'basura', 'convivencia', 'incidencias', 'admin', 'barrio', 'manuales',
  ];
  const navigation = document.querySelector('nav');
  if (!navigation) return;

  const rail = navigation.querySelector('.nav-rail');
  const links = Object.fromEntries(
    sectionIds.map((id) => [id, navigation.querySelector(`a[href="#${id}"]`)]),
  );

  const activate = (activeId) => {
    sectionIds.forEach((id) => {
      const link = links[id];
      if (!link) return;
      link.classList.toggle('is-active', id === activeId);
    });

    const link = links[activeId];
    if (link && rail) {
      const railLeft = rail.getBoundingClientRect().left;
      const linkLeft = link.getBoundingClientRect().left;
      const targetLeft = rail.scrollLeft + linkLeft - railLeft - 16;
      rail.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
    }
  };

  const visibleSections = new Set();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) visibleSections.add(entry.target.id);
      else visibleSections.delete(entry.target.id);
    });
    const activeId = sectionIds.find((id) => visibleSections.has(id));
    if (activeId) activate(activeId);
  }, { rootMargin: '-48% 0px -47% 0px' });

  sectionIds.forEach((id) => {
    const section = document.getElementById(id);
    if (section) observer.observe(section);
  });
  activate('wifi');
}

document.addEventListener('DOMContentLoaded', () => {
  if (PAGE_CONFIG.theme === 'Claro') document.documentElement.dataset.theme = 'claro';
  renderWifiQrCodes();
  enableSectionNavigation();
});

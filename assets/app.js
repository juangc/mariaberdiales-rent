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
      const railBounds = rail.getBoundingClientRect();
      const linkBounds = link.getBoundingClientRect();
      const inset = 20;

      if (linkBounds.left < railBounds.left + inset) {
        rail.scrollTo({
          left: Math.max(0, rail.scrollLeft + linkBounds.left - railBounds.left - inset),
          behavior: 'smooth',
        });
      } else if (linkBounds.right > railBounds.right - inset) {
        rail.scrollTo({
          left: rail.scrollLeft + linkBounds.right - railBounds.right + inset,
          behavior: 'smooth',
        });
      }
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

function enableRevealAnimations() {
  if (!('IntersectionObserver' in window)) return;

  const elements = document.querySelectorAll('.content-section > *, .footer > *');
  if (!elements.length) return;

  document.documentElement.classList.add('has-reveal');
  elements.forEach((element) => element.classList.add('reveal'));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px' });

  requestAnimationFrame(() => elements.forEach((element) => observer.observe(element)));
}

document.addEventListener('DOMContentLoaded', () => {
  if (PAGE_CONFIG.theme === 'Claro') document.documentElement.dataset.theme = 'claro';
  renderWifiQrCodes();
  enableSectionNavigation();
  enableRevealAnimations();
});

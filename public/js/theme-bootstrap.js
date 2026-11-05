(() => {
  const root = document.documentElement;
  const preference = root.getAttribute('data-user-theme') || 'dark';
  root.setAttribute('data-theme', preference);
})();

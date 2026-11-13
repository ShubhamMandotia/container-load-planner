// Runs before the page paints so the saved theme is applied without a flash.
// The planner is dark by default; a visitor's own choice is remembered.
(function () {
  var theme = 'dark';
  try {
    var saved = localStorage.getItem('container-load-planner:theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch (e) {
    /* storage blocked: keep the default */
  }
  document.documentElement.setAttribute('data-theme', theme);
})();

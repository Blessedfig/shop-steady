// Website demo of the ripple explainers (app/lib/ripple.js) with sample numbers. Follows the visitor's dark mode.
(function(){
  var el = document.getElementById('ripple');
  if (!el || !window.Ripple) return;
  var start = (location.hash || '').replace('#', '');
  window.Ripple.mount(el, {start: start, auto: true, store: {}});
})();

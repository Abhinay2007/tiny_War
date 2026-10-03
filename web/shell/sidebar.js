/* Shared app-shell sidebar behaviour — ONE source for React and Gradio. Pure
 * vanilla DOM (no framework): it toggles a `tac-collapsed` class on <body> (CSS
 * does the slide), auto-collapses below 768px on load + resize, and routes nav
 * clicks to the host (a Gradio tab, or a hash route in React). Because it's all
 * event-delegation + class toggling, the SAME file runs in both frameworks.
 */
(function () {
  var MOBILE = '(max-width: 768px)'
  var userToggled = false

  function isMobile() { return window.matchMedia(MOBILE).matches }
  function collapsed() { return document.body.classList.contains('tac-collapsed') }
  function setCollapsed(c) { document.body.classList.toggle('tac-collapsed', !!c) }

  // Start collapsed (hidden drawer) and stay that way until the user opens it via the toggle —
  // a mobile-style drawer on every viewport. Never auto-expands; once toggled, the user is in charge.
  function applyResponsive() { if (!userToggled) setCollapsed(true) }

  // Highlight the active nav item by its target label.
  function setActive(target) {
    document.querySelectorAll('.tac-nav-item').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-target') === target)
    })
  }

  // Host hook: how a nav item activates a view. Override window.tacNavigate to
  // customise; default switches the active Gradio tab by matching its label.
  window.tacNavigate = window.tacNavigate || function (target) {
    var tab = Array.prototype.find.call(
      document.querySelectorAll('button[role="tab"]'),
      function (b) { return b.textContent.trim() === target })
    if (tab) tab.click()
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('.tac-toggle')) {
      userToggled = true; setCollapsed(!collapsed()); return
    }
    var item = e.target.closest('.tac-nav-item')
    if (item) {
      e.preventDefault()
      var target = item.getAttribute('data-target')
      setActive(target)
      try { window.tacNavigate(target) } catch (_) {}
      if (isMobile()) setCollapsed(true)   // close the drawer after navigating on phones
    }
  })

  window.addEventListener('resize', applyResponsive)
  // Run once the DOM is ready (the sidebar markup may mount after this script).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyResponsive)
  } else { applyResponsive() }
})()

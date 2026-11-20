/*
 * Faatix — page bootstrap.
 * Load order on every page: translations → i18n → icons → components → (auth) → app.
 */
(function () {
  var page = document.body.getAttribute("data-page") || "";

  FaatixComponents.render(page);
  FaatixIcons.render();
  FaatixI18n.apply();

  /* Language switcher */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-set-lang]");
    if (btn) FaatixI18n.setLang(btn.getAttribute("data-set-lang"));
  });

  /* Swap an icon in place */
  function setIcon(el, name) {
    el.setAttribute("data-icon", name);
    el.innerHTML = FaatixIcons.svg(name);
  }

  /* Mobile navigation */
  var toggle = document.querySelector(".nav-toggle");
  var mobileNav = document.getElementById("mobile-nav");

  function setMenu(open) {
    if (!toggle || !mobileNav) return;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("data-i18n-attr", "aria-label:" + (open ? "nav.closeMenu" : "nav.openMenu"));
    toggle.setAttribute("aria-label", FaatixI18n.t(open ? "nav.closeMenu" : "nav.openMenu"));
    setIcon(toggle.querySelector("[data-icon]"), open ? "x" : "menu");
    mobileNav.hidden = !open;
    document.querySelector(".site-header").classList.toggle("is-open", open);
  }

  if (toggle) {
    toggle.addEventListener("click", function () {
      setMenu(toggle.getAttribute("aria-expanded") !== "true");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        setMenu(false);
        toggle.focus();
      }
    });
    window.matchMedia("(min-width: 1024px)").addEventListener("change", function (mq) {
      if (mq.matches) setMenu(false);
    });
  }

  /* Header shadow on scroll */
  var header = document.querySelector(".site-header");
  function onScroll() { if (header) header.classList.toggle("is-scrolled", window.scrollY > 8); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* Reveal-on-scroll */
  var reveals = document.querySelectorAll("[data-reveal]");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!("IntersectionObserver" in window) || reduceMotion) {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* Sign-in form */
  var form = document.getElementById("signin-form");
  if (form && window.FaatixAuth) {
    var status = form.querySelector(".form-status");
    var submit = form.querySelector("[type=submit]");
    var submitLabel = submit.querySelector("[data-i18n]");
    var pwInput = form.querySelector("#password");
    var pwToggle = form.querySelector(".password-toggle");
    var lastStatusKey = null;

    function showStatus(key, tone) {
      lastStatusKey = key;
      status.hidden = !key;
      status.className = "form-status" + (tone ? " form-status--" + tone : "");
      status.textContent = key ? FaatixI18n.t(key) : "";
    }

    pwToggle.addEventListener("click", function () {
      var reveal = pwInput.type === "password";
      pwInput.type = reveal ? "text" : "password";
      pwToggle.setAttribute("aria-pressed", String(reveal));
      pwToggle.setAttribute("data-i18n-attr", "aria-label:" + (reveal ? "signin.hide" : "signin.show"));
      pwToggle.setAttribute("aria-label", FaatixI18n.t(reveal ? "signin.hide" : "signin.show"));
      setIcon(pwToggle.querySelector("[data-icon]"), reveal ? "eye-off" : "eye");
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      showStatus(null);
      submit.disabled = true;
      submitLabel.setAttribute("data-i18n", "signin.loading");
      submitLabel.textContent = FaatixI18n.t("signin.loading");

      FaatixAuth.signIn({
        email: form.email.value.trim(),
        password: form.password.value,
        remember: form.remember.checked
      }).then(function (result) {
        submit.disabled = false;
        submitLabel.setAttribute("data-i18n", "signin.submit");
        submitLabel.textContent = FaatixI18n.t("signin.submit");
        if (result.ok) {
          if (FaatixAuth.config.redirectTo) window.location.href = FaatixAuth.config.redirectTo;
          return;
        }
        showStatus("signin." + result.code, result.code === "notConnected" ? "info" : "error");
      });
    });

    document.addEventListener("faatix:languagechange", function () {
      if (lastStatusKey) status.textContent = FaatixI18n.t(lastStatusKey);
    });
  }
})();

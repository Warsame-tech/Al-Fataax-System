/*
 * Faatix — language engine.
 * Applies translations from FaatixTranslations and remembers the chosen
 * language in localStorage so it persists across pages.
 */
(function () {
  var STORAGE_KEY = "faatix.lang";
  var DEFAULT_LANG = "en";
  var SUPPORTED = ["en", "so"];

  function readStored() {
    // ?lang=so in the URL wins (handy for sharing links), then the saved choice.
    var param = new URLSearchParams(window.location.search).get("lang");
    if (SUPPORTED.indexOf(param) !== -1) {
      try { localStorage.setItem(STORAGE_KEY, param); } catch (e) { /* ignore */ }
      return param;
    }
    try {
      var value = localStorage.getItem(STORAGE_KEY);
      if (SUPPORTED.indexOf(value) !== -1) return value;
    } catch (e) { /* storage unavailable */ }
    return DEFAULT_LANG;
  }

  var current = readStored();

  function resolve(lang, key) {
    return key.split(".").reduce(function (obj, part) {
      return obj == null ? undefined : obj[part];
    }, window.FaatixTranslations[lang]);
  }

  function t(key) {
    var value = resolve(current, key);
    if (value == null) value = resolve(DEFAULT_LANG, key);
    return value == null ? key : value;
  }

  function apply(root) {
    root = root || document;

    root.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });

    root.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });

    root.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      el.getAttribute("data-i18n-attr").split(";").forEach(function (pair) {
        var parts = pair.split(":");
        if (parts.length === 2) el.setAttribute(parts[0].trim(), t(parts[1].trim()));
      });
    });

    document.documentElement.lang = current;

    document.querySelectorAll("[data-set-lang]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-set-lang") === current));
    });

    document.dispatchEvent(new CustomEvent("faatix:languagechange", { detail: { lang: current } }));
  }

  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1 || lang === current) return;
    current = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
    apply();
  }

  window.FaatixI18n = {
    t: t,
    apply: apply,
    setLang: setLang,
    getLang: function () { return current; },
    supported: SUPPORTED
  };
})();

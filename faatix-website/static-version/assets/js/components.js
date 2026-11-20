/*
 * Faatix — shared layout components (header, footer, landscape art).
 * Pages declare placeholders:
 *   <div data-component="header"></div>
 *   <div data-component="footer"></div>
 *   <div data-component="landscape"></div>
 * and set <body data-page="home|about|features|who|signin">.
 */
(function () {
  var NAV = [
    { id: "home", href: "index.html", key: "nav.home" },
    { id: "about", href: "about.html", key: "nav.about" },
    { id: "features", href: "features.html", key: "nav.features" },
    { id: "who", href: "who.html", key: "nav.who" }
  ];

  var LOGO = "assets/img/faatix-logo.png";

  function navLinks(page, className) {
    return NAV.map(function (item) {
      var active = item.id === page;
      return '<li><a class="' + className + (active ? " is-active" : "") + '" href="' + item.href + '"' +
        (active ? ' aria-current="page"' : "") + ' data-i18n="' + item.key + '"></a></li>';
    }).join("");
  }

  function langSwitch() {
    return '<div class="lang-switch" role="group" data-i18n-attr="aria-label:nav.language">' +
      '<span class="lang-switch__icon" data-icon="globe"></span>' +
      '<button type="button" data-set-lang="en" aria-pressed="false" lang="en">EN</button>' +
      '<button type="button" data-set-lang="so" aria-pressed="false" lang="so">SO</button>' +
      "</div>";
  }

  function header(page) {
    return '<a class="skip-link" href="#main" data-i18n="nav.skip"></a>' +
      '<header class="site-header">' +
        '<div class="container site-header__inner">' +
          '<a class="brand" href="index.html" aria-label="Faatix"><img src="' + LOGO + '" alt="Faatix" width="148" height="50"></a>' +
          '<nav class="main-nav" data-i18n-attr="aria-label:nav.primary"><ul class="nav-pill">' + navLinks(page, "nav-pill__link") + "</ul></nav>" +
          '<div class="site-header__actions">' +
            langSwitch() +
            '<a class="btn btn--dark btn--sm site-header__signin" href="signin.html"><span data-icon="login"></span><span data-i18n="nav.signin"></span></a>' +
            '<button class="nav-toggle" type="button" aria-expanded="false" aria-controls="mobile-nav" data-i18n-attr="aria-label:nav.openMenu"><span data-icon="menu"></span></button>' +
          "</div>" +
        "</div>" +
        '<div class="mobile-nav" id="mobile-nav" hidden>' +
          '<ul class="container mobile-nav__list">' + navLinks(page, "mobile-nav__link") + "</ul>" +
          '<div class="container"><a class="btn btn--dark btn--block" href="signin.html"><span data-icon="login"></span><span data-i18n="nav.signin"></span></a></div>' +
        "</div>" +
      "</header>";
  }

  function footer() {
    var year = new Date().getFullYear();
    return '<footer class="site-footer">' +
      '<div class="container">' +
        '<div class="site-footer__top">' +
          '<div class="site-footer__brand">' +
            '<a class="brand" href="index.html" aria-label="Faatix"><img src="' + LOGO + '" alt="Faatix" width="160" height="54" loading="lazy"></a>' +
            '<p data-i18n="footer.tagline"></p>' +
          "</div>" +
          '<div class="site-footer__col"><h2 data-i18n="footer.pages"></h2><ul>' + navLinks("", "footer-link") + "</ul></div>" +
          '<div class="site-footer__col"><h2 data-i18n="footer.account"></h2><ul>' +
            '<li><a class="footer-link" href="signin.html" data-i18n="nav.signin"></a></li>' +
            '<li><a class="footer-link" href="#" data-i18n="footer.help"></a></li>' +
            '<li><a class="footer-link" href="#" data-i18n="footer.contact"></a></li>' +
          "</ul></div>" +
          '<div class="site-footer__col"><h2 data-i18n="footer.follow"></h2><ul>' +
            ["facebook", "linkedin", "instagram", "twitter"].map(function (s) {
              var label = s === "twitter" ? "X (Twitter)" : s.charAt(0).toUpperCase() + s.slice(1);
              return '<li><a class="footer-link footer-link--social" href="#"><span data-icon="' + s + '"></span>' + label + "</a></li>";
            }).join("") +
          "</ul></div>" +
        "</div>" +
        '<div class="site-footer__bottom">' +
          '<p>&copy; ' + year + ' <span data-i18n="footer.rights"></span></p>' +
          '<div class="site-footer__legal"><a href="#" data-i18n="footer.terms"></a><a href="#" data-i18n="footer.privacy"></a></div>' +
        "</div>" +
      "</div>" +
    "</footer>";
  }

  /* Illustrated landscape used behind hero visuals (no photos needed). */
  function landscape() {
    var flowers = "";
    var seed = 7;
    function rand() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    for (var i = 0; i < 70; i++) {
      var x = rand() * 1200;
      var y = 520 + rand() * 80;
      var r = 2 + rand() * 3.5;
      var color = rand() > 0.35 ? "#f4c430" : "#ffffff";
      flowers += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + color + '" opacity="' + (0.7 + rand() * 0.3).toFixed(2) + '"/>';
    }
    return '<svg class="landscape" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">' +
      "<defs>" +
        '<linearGradient id="ls-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fb8de"/><stop offset=".55" stop-color="#b9dcef"/><stop offset="1" stop-color="#e9f4f8"/></linearGradient>' +
        '<radialGradient id="ls-sun" cx=".82" cy=".12" r=".45"><stop offset="0" stop-color="#fffbe6" stop-opacity=".95"/><stop offset="1" stop-color="#fffbe6" stop-opacity="0"/></radialGradient>' +
        '<filter id="ls-blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>' +
      "</defs>" +
      '<rect width="1200" height="600" fill="url(#ls-sky)"/>' +
      '<rect width="1200" height="600" fill="url(#ls-sun)"/>' +
      '<g fill="#fff" filter="url(#ls-blur)" opacity=".85">' +
        '<ellipse cx="180" cy="120" rx="150" ry="38"/><ellipse cx="300" cy="100" rx="110" ry="34"/>' +
        '<ellipse cx="760" cy="80" rx="170" ry="36"/><ellipse cx="1040" cy="190" rx="140" ry="30"/>' +
        '<ellipse cx="520" cy="230" rx="120" ry="22"/>' +
      "</g>" +
      '<path d="M0 360 C 160 320 320 350 480 335 S 820 290 1000 320 S 1150 330 1200 325 V600 H0Z" fill="#a9cfa0" opacity=".8"/>' +
      '<path d="M0 420 C 180 380 360 415 540 400 S 880 360 1200 410 V600 H0Z" fill="#7fb862"/>' +
      '<path d="M0 485 C 220 450 420 495 660 472 S 1010 440 1200 480 V600 H0Z" fill="#5ea43d"/>' +
      '<path d="M0 548 C 300 520 700 565 1200 530 V600 H0Z" fill="#4a9b2b"/>' +
      flowers +
    "</svg>";
  }

  /* Two feature showcase cards with mini UI mockups. */
  function showcase() {
    var sync = [
      { icon: "file-text", key: "mock.yourRecords", dark: true },
      { icon: "bar-chart", key: "mock.yourReports", dark: false },
      { icon: "users", key: "mock.yourTeam", dark: true }
    ].map(function (item) {
      return '<li><span class="icon-tile icon-tile--sm' + (item.dark ? " icon-tile--dark" : "") + '"><span data-icon="' + item.icon + '"></span></span><span data-i18n="' + item.key + '"></span></li>';
    }).join("");

    return '<div class="showcase-grid">' +
      '<article class="showcase-card grid-bg" data-reveal>' +
        '<div class="mock-panel" aria-hidden="true">' +
          '<p class="mock-panel__title" data-i18n="mock.connected"></p>' +
          '<p class="mock-panel__sub"><span data-i18n="mock.connectedSub"></span> · <b>FAATIX</b></p>' +
          '<ul class="sync-tree">' + sync + "</ul>" +
        "</div>" +
        '<h3 data-i18n="home.feat1Title"></h3>' +
        '<p data-i18n="home.feat1Desc"></p>' +
      "</article>" +
      '<article class="showcase-card grid-bg" data-reveal data-reveal-delay="1">' +
        '<div class="mock-panel" aria-hidden="true">' +
          '<p class="mock-panel__title" data-i18n="mock.performance"></p>' +
          '<div class="perf-stats">' +
            '<div><small data-i18n="mock.thisMonth"></small><strong>+18%</strong></div>' +
            '<div><small data-i18n="mock.lastMonth"></small><strong>+11%</strong></div>' +
          "</div>" +
          '<div class="perf-total"><small data-i18n="mock.progress"></small><strong>86%</strong></div>' +
          '<svg class="perf-chart" viewBox="0 0 300 86" preserveAspectRatio="none">' +
            '<defs><linearGradient id="perf-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a9b2b" stop-opacity=".35"/><stop offset="1" stop-color="#4a9b2b" stop-opacity="0"/></linearGradient></defs>' +
            '<path d="M0 62 C 30 50 50 70 80 58 S 130 40 160 52 S 210 66 240 44 S 280 20 300 8 V86 H0Z" fill="url(#perf-fill)"/>' +
            '<path d="M0 62 C 30 50 50 70 80 58 S 130 40 160 52 S 210 66 240 44 S 280 20 300 8" fill="none" stroke="#3f8a23" stroke-width="2.5"/>' +
          "</svg>" +
        "</div>" +
        '<h3 data-i18n="home.feat2Title"></h3>' +
        '<p data-i18n="home.feat2Desc"></p>' +
      "</article>" +
    "</div>";
  }

  /* Three audience cards laid out like the reference pricing section. */
  function audience() {
    var cards = [
      { id: "small", icon: "store", btn: "btn--dark" },
      { id: "growing", icon: "users", btn: "btn--primary", featured: true },
      { id: "org", icon: "building", btn: "btn--dark" }
    ];
    return '<div class="audience-grid">' + cards.map(function (c, i) {
      var points = [1, 2, 3, 4].map(function (n) {
        return '<li><span data-icon="check-circle"></span><span data-i18n="audience.' + c.id + n + '"></span></li>';
      }).join("");
      return '<article class="audience-card' + (c.featured ? " audience-card--featured grid-bg" : "") + '" data-reveal data-reveal-delay="' + i + '">' +
        (c.featured ? '<span class="audience-card__badge" data-i18n="audience.growingBadge"></span>' : "") +
        '<span class="icon-tile"><span data-icon="' + c.icon + '"></span></span>' +
        '<h3 data-i18n="audience.' + c.id + '"></h3>' +
        '<p data-i18n="audience.' + c.id + 'Desc"></p>' +
        '<a class="btn ' + c.btn + ' btn--block" href="signin.html" data-i18n="common.getStarted"></a>' +
        '<ul class="check-list">' + points + "</ul>" +
      "</article>";
    }).join("") + "</div>";
  }

  function cta() {
    return '<section class="section section--tight"><div class="container">' +
      '<div class="cta-band" data-reveal>' +
        '<div><h2 data-i18n-html="home.ctaTitle"></h2><p data-i18n="home.ctaSub"></p></div>' +
        '<a class="btn btn--primary btn--lg" href="signin.html"><span data-icon="login"></span><span data-i18n="nav.signin"></span></a>' +
      "</div>" +
    "</div></section>";
  }

  var RENDERERS = { header: header, footer: footer, landscape: landscape, showcase: showcase, audience: audience, cta: cta };

  function render(page) {
    document.querySelectorAll("[data-component]").forEach(function (slot) {
      var fn = RENDERERS[slot.getAttribute("data-component")];
      if (fn) slot.outerHTML = fn(page);
    });
  }

  window.FaatixComponents = { render: render, nav: NAV };
})();

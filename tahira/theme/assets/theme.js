/* TAHIRA theme: no framework, no build step. */
(function () {
  "use strict";

  var T = window.TAHIRA || {};
  var S = T.strings || {};
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- money ---------- */
  function formatMoney(cents, format) {
    if (typeof cents === "string") cents = cents.replace(".", "");
    format = format || T.moneyFormat || "{{amount}}";
    var rx = /\{\{\s*(\w+)\s*\}\}/;
    function withDelims(n, precision, thousands, decimal) {
      thousands = thousands === undefined ? "," : thousands;
      decimal = decimal === undefined ? "." : decimal;
      if (isNaN(n) || n == null) return "0";
      n = (n / 100).toFixed(precision);
      var parts = n.split(".");
      var dollars = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1" + thousands);
      var c = parts[1] ? decimal + parts[1] : "";
      return dollars + c;
    }
    var m = format.match(rx);
    if (!m) return String(cents);
    var value;
    switch (m[1]) {
      case "amount": value = withDelims(cents, 2); break;
      case "amount_no_decimals": value = withDelims(cents, 0); break;
      case "amount_with_comma_separator": value = withDelims(cents, 2, ".", ","); break;
      case "amount_no_decimals_with_comma_separator": value = withDelims(cents, 0, ".", ","); break;
      case "amount_with_apostrophe_separator": value = withDelims(cents, 2, "'", "."); break;
      case "amount_no_decimals_with_space_separator": value = withDelims(cents, 0, " "); break;
      case "amount_with_space_separator": value = withDelims(cents, 2, " ", ","); break;
      case "amount_with_period_and_space_separator": value = withDelims(cents, 2, " ", "."); break;
      default: value = withDelims(cents, 2);
    }
    return format.replace(rx, value);
  }
  T.formatMoney = formatMoney;

  function fill(str, map) {
    return String(str || "")
      .replace(/\{\{\s*(\w+)\s*\}\}/g, function (_, k) { return map[k] != null ? map[k] : ""; })
      .replace(/__([A-Z]+)__/g, function (m, k) { k = k.toLowerCase(); return map[k] != null ? map[k] : m; });
  }

  /* ---------- reveal on scroll ---------- */
  function initReveal() {
    var items = $$("[data-reveal]");
    if (!T.reveal || !("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.documentElement.classList.add("no-reveal");
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    items.forEach(function (el, i) {
      el.style.transitionDelay = (i % 4) * 70 + "ms";
      io.observe(el);
    });
  }

  /* ---------- announcement rotation (mobile) ---------- */
  function initAnnouncement() {
    var items = $$(".ann__item");
    if (items.length < 2) { if (items[0]) items[0].classList.add("is-on"); return; }
    var i = 0;
    items[0].classList.add("is-on");
    setInterval(function () {
      items[i].classList.remove("is-on");
      i = (i + 1) % items.length;
      items[i].classList.add("is-on");
    }, 4200);
  }

  /* ---------- drawers ---------- */
  var scrim, lastFocus;
  function openDrawer(id) {
    var d = document.getElementById(id);
    if (!d) return;
    closeDrawers(true);
    lastFocus = document.activeElement;
    d.classList.add("is-open");
    d.setAttribute("aria-hidden", "false");
    scrim.classList.add("is-on");
    document.body.style.overflow = "hidden";
    $$("[aria-controls='" + id + "']").forEach(function (b) { b.setAttribute("aria-expanded", "true"); });
    var f = $("[data-autofocus]", d) || $("button, a, input", d);
    if (f) setTimeout(function () { f.focus(); }, 60);
  }
  function closeDrawers(silent) {
    $$(".drawer.is-open").forEach(function (d) {
      d.classList.remove("is-open");
      d.setAttribute("aria-hidden", "true");
      $$("[aria-controls='" + d.id + "']").forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
    });
    if (scrim) scrim.classList.remove("is-on");
    document.body.style.overflow = "";
    if (!silent && lastFocus) lastFocus.focus();
  }
  function initDrawers() {
    scrim = document.createElement("div");
    scrim.className = "scrim";
    document.body.appendChild(scrim);
    scrim.addEventListener("click", function () { closeDrawers(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawers(); });
    document.addEventListener("click", function (e) {
      var open = e.target.closest("[data-open]");
      if (open) {
        var id = open.getAttribute("data-open");
        if (id === "CartDrawer" && !document.getElementById("CartDrawer")) return;
        e.preventDefault();
        openDrawer(id);
        return;
      }
      if (e.target.closest("[data-close]")) { e.preventDefault(); closeDrawers(); }
    });
  }

  /* ---------- language switch ---------- */
  function initLang() {
    $$("[data-lang]").forEach(function (b) {
      b.addEventListener("click", function () {
        var form = document.getElementById("LangForm");
        if (!form) return;
        form.querySelector("[name='locale_code']").value = b.getAttribute("data-lang");
        form.submit();
      });
    });
  }

  /* ---------- cart ---------- */
  function sectionsUrl() { return window.location.pathname + window.location.search; }

  function swapDrawer(sections) {
    if (!sections || !sections["cart-drawer"]) return;
    var doc = new DOMParser().parseFromString(sections["cart-drawer"], "text/html");
    var fresh = doc.querySelector("[data-drawer-inner]");
    var cur = document.querySelector("[data-drawer-inner]");
    if (fresh && cur) cur.innerHTML = fresh.innerHTML;
    var src = doc.querySelector("[data-cart-count-src]");
    if (src) setCount(parseInt(src.getAttribute("data-cart-count-src"), 10) || 0);
  }
  function setCount(n) {
    $$("[data-cart-count]").forEach(function (c) { c.textContent = n > 0 ? n : ""; c.setAttribute("data-count", n); });
  }
  function postJSON(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || j.status) throw new Error(j.description || j.message || S.error);
        return j;
      });
    });
  }
  function addItems(items) {
    var hasDrawer = !!document.getElementById("CartDrawer") && T.cartDrawer;
    var body = { items: items };
    if (hasDrawer) { body.sections = ["cart-drawer"]; body.sections_url = sectionsUrl(); }
    return postJSON(T.routes.cartAdd + ".js", body).then(function (res) {
      if (!hasDrawer) { window.location.href = T.routes.cart; return res; }
      swapDrawer(res.sections);
      openDrawer("CartDrawer");
      return res;
    });
  }
  T.addItems = addItems;

  function changeLine(line, qty) {
    var drawer = document.getElementById("CartDrawer");
    if (drawer) drawer.classList.add("is-busy");
    return postJSON(T.routes.cartChange + ".js", {
      line: line, quantity: qty, sections: ["cart-drawer"], sections_url: sectionsUrl()
    }).then(function (res) {
      swapDrawer(res.sections);
    }).catch(function (err) {
      showBagError(err.message);
    }).then(function () { if (drawer) drawer.classList.remove("is-busy"); });
  }
  function showBagError(msg) {
    var box = $("[data-bag-error]");
    if (!box) return;
    box.textContent = msg || S.error;
    box.hidden = false;
  }

  function busy(btn, on) {
    if (!btn) return;
    var label = $("span", btn) || btn;
    if (on) {
      btn.classList.add("is-busy");
      btn.setAttribute("aria-busy", "true");
      btn._label = label.textContent;
      label.textContent = S.adding;
    } else {
      btn.classList.remove("is-busy");
      btn.removeAttribute("aria-busy");
      if (btn._label != null) label.textContent = btn._label;
    }
  }

  function initCart() {
    /* any form marked data-add: one item from id + quantity, or several from data-items */
    document.addEventListener("submit", function (e) {
      var form = e.target.closest("form[data-add]");
      if (!form) return;
      e.preventDefault();
      var btn = form.querySelector("[type='submit']");
      var items;
      if (form.dataset.items) {
        items = JSON.parse(form.dataset.items);
      } else {
        var fd = new FormData(form);
        items = [{ id: parseInt(fd.get("id"), 10), quantity: parseInt(fd.get("quantity") || "1", 10) }];
      }
      if (!items.length || items.some(function (it) { return !it.id; })) return;
      busy(btn, true);
      addItems(items).catch(function (err) {
        var out = form.querySelector("[data-form-error]");
        if (out) { out.textContent = err.message || S.error; out.hidden = false; }
        else alert(err.message || S.error);
      }).then(function () { busy(btn, false); });
    });

    /* drawer: quantity and remove */
    document.addEventListener("click", function (e) {
      var q = e.target.closest("[data-line-qty]");
      if (q) {
        var line = parseInt(q.getAttribute("data-line"), 10);
        var input = q.parentNode.querySelector("input");
        var next = Math.max(0, parseInt(input.value, 10) + parseInt(q.getAttribute("data-line-qty"), 10));
        input.value = next;
        changeLine(line, next);
        return;
      }
      var rm = e.target.closest("[data-line-remove]");
      if (rm) { e.preventDefault(); changeLine(parseInt(rm.getAttribute("data-line-remove"), 10), 0); }
    });
    document.addEventListener("change", function (e) {
      var input = e.target.closest("[data-line-input]");
      if (input) changeLine(parseInt(input.getAttribute("data-line-input"), 10), Math.max(0, parseInt(input.value, 10) || 0));
      var auto = e.target.closest("[data-autosubmit]");
      if (auto && auto.form) auto.form.submit();
    });
  }

  /* ---------- quantity steppers on product forms ---------- */
  function initQty() {
    document.addEventListener("click", function (e) {
      var b = e.target.closest("[data-step]");
      if (!b) return;
      var input = b.parentNode.querySelector("input");
      var v = Math.max(1, (parseInt(input.value, 10) || 1) + parseInt(b.getAttribute("data-step"), 10));
      input.value = v;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  /* ---------- hero: the four musks ---------- */
  function initHero() {
    $$("[data-hero]").forEach(function (root) {
      if (root._ready) return;
      root._ready = true;
      var data;
      try { data = JSON.parse($("[data-hero-data]", root).textContent); } catch (e) { return; }
      var opts = $$(".hero__opt", root);
      var current = data[0] && data[0].key;
      function show(key) {
        var m = data.filter(function (x) { return x.key === key; })[0];
        if (!m) return;
        data.forEach(function (x) { root.classList.remove("m-" + x.key); });
        root.classList.add("m-" + key);
        opts.forEach(function (o) { o.setAttribute("aria-pressed", o.dataset.key === key ? "true" : "false"); });
        $$(".hero__tube", root).forEach(function (t) { t.classList.toggle("is-on", t.dataset.key === key); });
        $$(".hero__glow", root).forEach(function (g) { g.classList.toggle("is-on", g.dataset.key === key); });
        var set = function (sel, val) { var el = $(sel, root); if (el) el.textContent = val; };
        set("[data-hero-line]", m.line);
        set("[data-hero-price]", m.price);
        set("[data-hero-split]", m.split);
        var link = $("[data-hero-link]", root);
        if (link) link.href = m.url;
        var input = $("[data-hero-form] [name='id']", root);
        var btn = $("[data-hero-form] [type='submit']", root);
        if (input) input.value = m.variant || "";
        if (btn) {
          btn.hidden = !m.variant;
          var lab = $("span", btn) || btn;
          var ok = !!m.variant && m.available;
          btn.disabled = !ok;
          lab.textContent = ok ? S.add : S.soldOut;
        }
        current = key;
      }
      opts.forEach(function (o) { o.addEventListener("click", function () { show(o.dataset.key); }); });
      root.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        if (!e.target.closest(".hero__opt")) return;
        var rtl = document.documentElement.dir === "rtl";
        var dir = (e.key === "ArrowRight") !== rtl ? 1 : -1;
        var i = data.map(function (x) { return x.key; }).indexOf(current);
        var next = data[(i + dir + data.length) % data.length].key;
        show(next);
        var b = opts.filter(function (o) { return o.dataset.key === next; })[0];
        if (b) b.focus();
      });
      show(current);
    });
  }

  /* ---------- quiz ---------- */
  var QUIZ = [
    [{ veil: 2, halo: 1 }, { ember: 2, mirage: 2 }, { halo: 2, veil: 1 }],
    [{ veil: 3 }, { ember: 3, mirage: 1 }, { veil: 2, mirage: 1 }, { halo: 3 }],
    [{ veil: 4 }, { mirage: 4 }, { ember: 4 }, { halo: 4 }]
  ];
  var ORDER = ["veil", "mirage", "ember", "halo"];
  function initQuiz() {
    $$("[data-quiz]").forEach(function (root) {
      if (root._ready) return;
      root._ready = true;
      var steps = $$("[data-q]", root);
      var bar = $(".quiz__bar i", root);
      var stepLabel = $("[data-q-step]", root);
      var again = $("[data-q-again]", root);
      var box = $(".quiz__box", root);
      var score, step;
      function go(i) {
        step = i;
        steps.forEach(function (s, j) { s.hidden = j !== i; });
        if (bar) bar.style.width = ((i + 1) / steps.length * 100) + "%";
        if (stepLabel) stepLabel.textContent = fill(stepLabel.dataset.tpl, { n: i + 1 });
        if (again) again.hidden = i === 0;
      }
      function reset() {
        score = {};
        $$("[data-q-result]", root).forEach(function (r) { r.hidden = true; });
        box.hidden = false;
        go(0);
      }
      function result() {
        var best = ORDER[0], bv = -1;
        ORDER.forEach(function (k) { var v = score[k] || 0; if (v > bv) { bv = v; best = k; } });
        box.hidden = true;
        $$("[data-q-result]", root).forEach(function (r) { r.hidden = r.dataset.qResult !== best; });
        var shown = $("[data-q-result='" + best + "']", root);
        if (shown) { shown.setAttribute("tabindex", "-1"); shown.focus({ preventScroll: true }); }
      }
      $$("[data-q-opt]", root).forEach(function (b) {
        b.addEventListener("click", function () {
          var w = QUIZ[step][parseInt(b.dataset.qOpt, 10)] || {};
          Object.keys(w).forEach(function (k) { score[k] = (score[k] || 0) + w[k]; });
          if (step + 1 < steps.length) go(step + 1); else result();
        });
      });
      $$("[data-q-again]", root).forEach(function (b) { b.addEventListener("click", reset); });
      reset();
    });
  }

  /* ---------- pair builder ---------- */
  function initPairs() {
    $$("[data-pairs]").forEach(function (root) {
      if (root._ready) return;
      root._ready = true;
      var btns = $$("[data-pair-key]", root);
      var picked = [];
      var charm = parseInt(root.dataset.charm || "0", 10);
      var countEl = $("[data-pair-count]", root);
      var res = $("[data-pair-res]", root);
      var hint = $("[data-pair-hint]", root);
      var form = $("form[data-add]", root);
      function key(a, b) {
        var s = [a, b].sort(function (x, y) { return ORDER.indexOf(x) - ORDER.indexOf(y); });
        return s[0] + "_" + s[1];
      }
      function render() {
        var ordered = picked.slice().sort(function (x, y) { return ORDER.indexOf(x) - ORDER.indexOf(y); });
        btns.forEach(function (b) {
          var i = ordered.indexOf(b.dataset.pairKey);
          b.setAttribute("aria-pressed", i > -1 ? "true" : "false");
          var tag = $("small", b);
          if (tag) tag.textContent = i === 0 ? root.dataset.first : i === 1 ? root.dataset.over : "";
        });
        if (countEl) countEl.textContent = fill(countEl.dataset.tpl, { n: picked.length });
        $$("[data-pair-tube]", root).forEach(function (t) {
          var i = ordered.indexOf(t.dataset.pairTube);
          t.hidden = i === -1;
          t.style.order = i;
          t.classList.toggle("is-second", i === 1);
        });
        var bg = $(".pairs__bg", root);
        if (bg && ordered[0]) bg.style.setProperty("--a", "var(--" + ordered[0] + ")");
        if (bg && ordered[1]) bg.style.setProperty("--b", "var(--" + ordered[1] + ")");
        var full = picked.length === 2;
        if (res) res.hidden = !full;
        if (hint) hint.hidden = full;
        if (!full) return;
        var k = key(picked[0], picked[1]);
        $$("[data-pair-text]", root).forEach(function (p) { p.hidden = p.dataset.pairText !== k; });
        var total = 0, items = [], ok = true;
        ordered.forEach(function (m) {
          var b = btns.filter(function (x) { return x.dataset.pairKey === m; })[0];
          var id = parseInt(b.dataset.variant || "0", 10);
          if (!id || b.dataset.available !== "true") ok = false;
          total += parseInt(b.dataset.price || "0", 10);
          items.push({ id: id, quantity: 1 });
        });
        if (charm) items.push({ id: charm, quantity: 1 });
        var price = $("[data-pair-price]", root);
        if (price) price.textContent = formatMoney(total);
        if (form) {
          form.dataset.items = JSON.stringify(items);
          var btn = $("[type='submit']", form);
          if (btn) btn.disabled = !ok;
        }
      }
      btns.forEach(function (b) {
        b.addEventListener("click", function () {
          var k = b.dataset.pairKey;
          var i = picked.indexOf(k);
          if (i > -1) picked.splice(i, 1);
          else { picked.push(k); if (picked.length > 2) picked.shift(); }
          render();
        });
      });
      var start = (root.dataset.start || "").split(",").filter(function (k) { return ORDER.indexOf(k) > -1; });
      picked = start.slice(0, 2);
      render();
    });
  }

  /* ---------- product ---------- */
  function uaeNow() {
    try { return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Dubai" })); }
    catch (e) { return new Date(); }
  }
  function workday(d) {
    var w = d.getDay();
    switch (T.weekend) {
      case "fri": return w !== 5;
      case "sun": return w !== 0;
      case "none": return true;
      default: return w >= 1 && w <= 5;
    }
  }
  function addWork(d, n) {
    var x = new Date(d.getTime());
    var guard = 0;
    while (n > 0 && guard++ < 30) { x.setDate(x.getDate() + 1); if (workday(x)) n--; }
    return x;
  }
  function initEta() {
    $$("[data-eta]").forEach(function (el) {
      if (el._ready) return;
      el._ready = true;
      function paint() {
        var now = uaeNow(), cut = T.cutoff || 14, when;
        var today = workday(now) && now.getHours() < cut;
        var ship = today ? now : addWork(now, 1);
        if (today) {
          var mins = (cut - now.getHours()) * 60 - now.getMinutes();
          var h = Math.floor(mins / 60), m = mins % 60;
          var t = h > 0 ? h + S.h + " " + (m < 10 ? "0" + m : m) : m + " " + S.m;
          when = fill(S.shipToday, { t: t });
        } else {
          when = fill(S.shipNext, { d: S.days[ship.getDay()] });
        }
        var a = addWork(ship, 1), b = addWork(ship, 3);
        var eta = fill(S.eta, { a: S.days[a.getDay()], b: S.days[b.getDay()] });
        var w = $("[data-eta-when]", el), e = $("[data-eta-eta]", el);
        if (w) w.textContent = when;
        if (e) e.textContent = eta;
        el.hidden = false;
      }
      paint();
      setInterval(paint, 60000);
    });
  }

  function initProduct() {
    $$("[data-product]").forEach(function (root) {
      if (root._ready) return;
      root._ready = true;
      var json = $("[data-product-json]", root);
      var variants = [];
      try { variants = JSON.parse(json.textContent); } catch (e) {}
      var form = $("form[data-add]", root);
      var idInput = form && $("[name='id']", form);
      var btn = form && $("[type='submit']", form);
      var priceEl = $("[data-price]", root);
      var compareEl = $("[data-compare]", root);
      var splitEl = $("[data-split]", root);
      var bar = document.querySelector("[data-buybar]");

      function selected() {
        var vals = $$("[data-option]", root).map(function (fs) {
          var c = $("input:checked", fs) || $("select", fs);
          return c ? c.value : null;
        });
        if (!vals.length) return null;
        return variants.filter(function (v) {
          return v.options.every(function (o, i) { return o === vals[i]; });
        })[0];
      }
      function update() {
        var v = selected();
        if (!v) return;
        if (idInput) idInput.value = v.id;
        if (priceEl) priceEl.textContent = formatMoney(v.price);
        if (compareEl) { compareEl.textContent = v.compare_at_price > v.price ? formatMoney(v.compare_at_price) : ""; compareEl.hidden = !(v.compare_at_price > v.price); }
        if (splitEl) splitEl.textContent = fill(S.split, { n: formatMoney(Math.floor(v.price / (T.splitCount || 4))), c: T.splitCount || 4 });
        if (btn) {
          btn.disabled = !v.available;
          var lab = $("span", btn) || btn;
          lab.textContent = v.available ? S.add : S.soldOut;
        }
        if (bar) {
          var bb = $("button", bar);
          if (bb) bb.disabled = !v.available;
          var bp = $("[data-buybar-price]", bar);
          if (bp) bp.textContent = formatMoney(v.price);
        }
        var url = new URL(window.location.href);
        url.searchParams.set("variant", v.id);
        window.history.replaceState({}, "", url.toString());
      }
      $$("[data-option]", root).forEach(function (fs) { fs.addEventListener("change", update); });

      /* sticky bar: shown once the main button leaves the screen */
      if (bar && btn && "IntersectionObserver" in window) {
        new IntersectionObserver(function (es) {
          es.forEach(function (e) {
            var on = !e.isIntersecting && e.boundingClientRect.top < 0;
            bar.classList.toggle("is-on", on);
            document.body.classList.toggle("has-buybar", on);
          });
        }).observe(btn);
        var bb = $("button", bar);
        if (bb) bb.addEventListener("click", function () {
          if (form.requestSubmit) form.requestSubmit(); else btn.click();
        });
      }
    });
  }

  /* ---------- gallery ---------- */
  function initGallery() {
    $$("[data-gallery]").forEach(function (root) {
      if (root._ready) return;
      root._ready = true;
      var track = $(".gal", root);
      var items = $$(".gal__item", root);
      var dots = $$(".gal__dots button", root);
      if (!track || items.length < 2) return;
      function idx() {
        var w = track.clientWidth || 1;
        return Math.round(Math.abs(track.scrollLeft) / w);
      }
      function goTo(i) {
        i = Math.max(0, Math.min(items.length - 1, i));
        items[i].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
      }
      track.addEventListener("scroll", function () {
        var i = idx();
        dots.forEach(function (d, j) { d.setAttribute("aria-current", j === i ? "true" : "false"); });
      }, { passive: true });
      dots.forEach(function (d, j) { d.addEventListener("click", function () { goTo(j); }); });
      var prev = $(".gal__nav--prev", root), next = $(".gal__nav--next", root);
      if (prev) prev.addEventListener("click", function () { goTo(idx() - 1); });
      if (next) next.addEventListener("click", function () { goTo(idx() + 1); });
    });
  }

  /* ---------- video reel ---------- */
  function initReel() {
    var vids = $$(".reel video");
    if (!vids.length) return;
    var io = "IntersectionObserver" in window ? new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var v = e.target;
        if (v.dataset.paused === "1") return;
        if (e.isIntersecting) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause();
      });
    }, { threshold: 0.5 }) : null;
    vids.forEach(function (v) {
      if (v._ready) return;
      v._ready = true;
      v.muted = true;
      if (io) io.observe(v);
      var t = v.parentNode.querySelector(".reel__toggle");
      if (t) t.addEventListener("click", function () {
        if (v.paused) { v.dataset.paused = "0"; v.play(); t.setAttribute("aria-pressed", "false"); }
        else { v.dataset.paused = "1"; v.pause(); t.setAttribute("aria-pressed", "true"); }
      });
    });
  }

  /* ---------- small things ---------- */
  function initCopy() {
    $$("[data-copy]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(b.getAttribute("data-copy")).then(function () {
          var done = b.getAttribute("data-copied");
          if (done) b.textContent = done;
        });
      });
    });
  }

  function init() {
    initDrawers();
    initReveal();
    initAnnouncement();
    initLang();
    initCart();
    initQty();
    initHero();
    initQuiz();
    initPairs();
    initEta();
    initProduct();
    initGallery();
    initReel();
    initCopy();
    if (window.location.hash === "#bag" && document.getElementById("CartDrawer")) openDrawer("CartDrawer");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  /* theme editor: re-run when a section reloads */
  document.addEventListener("shopify:section:load", function () {
    initReveal(); initHero(); initQuiz(); initPairs(); initEta(); initGallery(); initReel();
  });
})();

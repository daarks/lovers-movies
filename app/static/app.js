/**
 * Scripts globais: busca com debounce, posição de scroll, estrelas e detalhes.
 */
(function () {
  "use strict";

  var SCROLL_KEY = "movies_app_scroll_y";
  var DEBOUNCE_MS = 400;

  /** Toast leve (host em base.html). */
  window.showAppToast = function (msg, kind) {
    var host = document.getElementById("app-toast-host");
    if (!host) return;
    var d = document.createElement("div");
    d.className = "app-toast app-toast--" + (kind || "ok");
    d.setAttribute("role", "status");
    d.textContent = msg;
    host.appendChild(d);
    window.setTimeout(function () {
      d.classList.add("is-out");
      window.setTimeout(function () {
        if (d.parentNode) d.parentNode.removeChild(d);
      }, 280);
    }, 4200);
  };

  function debounce(fn, wait) {
    var t;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () {
        fn.apply(ctx, args);
      }, wait);
    };
  }

  /** Restaura scroll no histórico após voltar dos detalhes. */
  function initIndexScroll() {
    var home =
      document.getElementById("page-history") ||
      document.getElementById("page-listas");
    if (!home) return;

    var y = sessionStorage.getItem(SCROLL_KEY);
    if (y !== null) {
      var pos = parseInt(y, 10);
      if (!isNaN(pos)) {
        window.scrollTo(0, pos);
      }
      sessionStorage.removeItem(SCROLL_KEY);
    }

    function saveScroll() {
      sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    }

    document.querySelectorAll(".nav-preserve-scroll").forEach(function (el) {
      el.addEventListener("click", saveScroll);
    });
  }

  function skeletonRows(count) {
    var html = "";
    for (var i = 0; i < count; i++) {
      html +=
        '<div class="skeleton-block" role="presentation">' +
        '<div class="skeleton-thumb"></div>' +
        '<div class="skeleton-lines">' +
        '<div class="skeleton-line"></div>' +
        '<div class="skeleton-line short"></div>' +
        '</div></div>';
    }
    return html;
  }

  function posterUrl(path, size) {
    if (!path) return "";
    return "https://image.tmdb.org/t/p/" + size + path;
  }

  function escapeHtml(s) {
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  /** Uma instância de busca TMDB por container (.search-wrap). */
  function initSearchInContainer(wrap) {
    if (!wrap) return;
    var input = wrap.querySelector('input[type="search"], input.search-input');
    var dropdown = wrap.querySelector(".search-dropdown");
    if (!input || !dropdown) return;

    var searchType = "multi";
    var abortCtrl = null;

    function setDropdownOpen(open) {
      if (open) {
        dropdown.classList.add("is-open");
        dropdown.removeAttribute("hidden");
        input.setAttribute("aria-expanded", "true");
      } else {
        dropdown.classList.remove("is-open");
        dropdown.setAttribute("hidden", "");
        input.setAttribute("aria-expanded", "false");
        dropdown.innerHTML = "";
      }
    }

    function closeDropdown() {
      setDropdownOpen(false);
    }

    wrap.querySelectorAll(".type-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        wrap.querySelectorAll(".type-tab").forEach(function (t) {
          t.classList.remove("is-active");
          t.setAttribute("aria-selected", "false");
        });
        tab.classList.add("is-active");
        tab.setAttribute("aria-selected", "true");
        searchType = tab.getAttribute("data-search-type") || "multi";
        var q = input.value.trim();
        if (q) runSearch(q);
        else closeDropdown();
      });
    });

    function renderResults(results) {
      if (!results.length) {
        dropdown.innerHTML =
          '<div class="search-result" style="cursor:default;color:var(--text-muted)">Nenhum resultado.</div>';
        setDropdownOpen(true);
        return;
      }
      var frag = document.createDocumentFragment();
      results.forEach(function (item) {
        var a = document.createElement("a");
        a.className = "search-result";
        a.href =
          "/details/" + encodeURIComponent(item.media_type) + "/" + item.id;
        a.classList.add("nav-preserve-scroll");
        var year = "";
        if (item.release_date && item.release_date.length >= 4) {
          year = item.release_date.slice(0, 4);
        }
        var badge = item.media_type === "movie" ? "Filme" : "Série";
        var thumb = posterUrl(item.poster_path, "w92");
        var thumbHtml = thumb
          ? '<img src="' +
            thumb +
            '" alt="" width="46" height="69" loading="lazy">'
          : '<span aria-hidden="true">\uD83C\uDFAC</span>';
        a.innerHTML =
          '<div class="search-result-thumb">' +
          thumbHtml +
          '</div><div class="search-result-body">' +
          '<div class="search-result-title">' +
          escapeHtml(item.title || "") +
          "</div>" +
          '<div class="search-result-meta">' +
          (year ? year + " · " : "") +
          '<span class="badge">' +
          badge +
          "</span></div></div>";
        a.addEventListener("click", function () {
          sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
        });
        frag.appendChild(a);
      });
      dropdown.innerHTML = "";
      dropdown.appendChild(frag);
      setDropdownOpen(true);
    }

    function runSearch(query) {
      if (abortCtrl) abortCtrl.abort();
      abortCtrl = new AbortController();
      dropdown.innerHTML = skeletonRows(5);
      setDropdownOpen(true);

      var smart =
        query.length >= 12 ||
        query.split(/\s+/).filter(Boolean).length >= 2;
      var url = smart
        ? "/search/smart?q=" +
          encodeURIComponent(query) +
          "&type=" +
          encodeURIComponent(searchType)
        : "/search?q=" +
          encodeURIComponent(query) +
          "&type=" +
          encodeURIComponent(searchType);

      fetch(url, { signal: abortCtrl.signal })
        .then(function (r) {
          if (!r.ok) throw new Error("search failed");
          return r.json();
        })
        .then(function (data) {
          renderResults(data.results || []);
        })
        .catch(function (e) {
          if (e.name === "AbortError") return;
          dropdown.innerHTML =
            '<div class="search-result" style="cursor:default;color:#f87171">Erro na busca.</div>';
          setDropdownOpen(true);
        });
    }

    var debouncedSearch = debounce(function () {
      var q = input.value.trim();
      if (!q) {
        closeDropdown();
        return;
      }
      runSearch(q);
    }, DEBOUNCE_MS);

    input.addEventListener("input", debouncedSearch);

    input.addEventListener("focus", function () {
      var q = input.value.trim();
      if (q) runSearch(q);
    });

    document.addEventListener("click", function (e) {
      if (!wrap.contains(e.target)) closeDropdown();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeDropdown();
    });
  }

  function initSearch() {
    document.querySelectorAll(".search-wrap").forEach(initSearchInContainer);
  }

  /** Animação de digitação na home Assistir. */
  function initHomeTypewriter() {
    var el = document.getElementById("home-typewriter-text");
    var caret = document.getElementById("home-typewriter-caret");
    if (!el) return;
    var full = el.getAttribute("data-text") || "O que vamos ver hoje baby? 💜";
    var chars = Array.from(full);
    el.textContent = "";
    var i = 0;
    var baseDelay = 52;
    function tick() {
      if (i <= chars.length) {
        el.textContent = chars.slice(0, i).join("");
        i += 1;
        var d = baseDelay;
        if (i > 1 && ".,!?".indexOf(chars[i - 2] || "") !== -1) {
          d += 120;
        }
        window.setTimeout(tick, d);
      } else if (caret) {
        caret.classList.add("is-idle");
      }
    }
    window.setTimeout(tick, 280);
  }

  /** Botão voltar na página de detalhes. */
  function initBackButton() {
    var btn = document.getElementById("btn-back");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = "/";
      }
    });
  }

  /** Sinopse: mostrar "Ver mais" se ultrapassar ~4 linhas. */
  function initSynopsis() {
    var text = document.getElementById("synopsis-text");
    var toggle = document.getElementById("synopsis-toggle");
    if (!text || !toggle) return;

    requestAnimationFrame(function () {
      if (text.scrollHeight > text.clientHeight + 4) {
        toggle.hidden = false;
      }
    });

    toggle.addEventListener("click", function () {
      var clamped = text.classList.toggle("is-clamped");
      toggle.textContent = clamped ? "Ver mais" : "Ver menos";
    });
  }

  function parseNumLoose(s) {
    if (s === null || s === undefined || s === "") return NaN;
    return parseFloat(String(s).replace(",", "."));
  }

  function validHalfRating(v) {
    return (
      typeof v === "number" &&
      !isNaN(v) &&
      v >= 0.5 &&
      v <= 10 &&
      Math.abs(v * 2 - Math.round(v * 2)) < 1e-6
    );
  }

  function paintHalfStarsInWrap(wrap, v) {
    var val = typeof v === "number" && !isNaN(v) ? v : parseNumLoose(v);
    if (isNaN(val) || val < 0.25) val = 0;
    wrap.querySelectorAll(".star-pair").forEach(function (pair) {
      var i = parseInt(pair.getAttribute("data-star-index"), 10);
      if (isNaN(i)) return;
      var fi = Math.min(1, Math.max(0, val - (i - 1)));
      pair.classList.remove("is-full", "is-half", "is-empty");
      if (fi >= 1) pair.classList.add("is-full");
      else if (fi >= 0.5) pair.classList.add("is-half");
      else pair.classList.add("is-empty");
    });
  }

  function bindHalfStarRow(wrap, hiddenInput) {
    if (!wrap || !hiddenInput) return;
    var buttons = wrap.querySelectorAll("button[data-value]");
    var initialRaw = parseNumLoose(wrap.getAttribute("data-initial"));
    var initial = validHalfRating(initialRaw) ? initialRaw : 0;

    function setValue(v) {
      if (validHalfRating(v)) {
        hiddenInput.value = String(v);
        paintHalfStarsInWrap(wrap, v);
      } else {
        hiddenInput.value = "";
        paintHalfStarsInWrap(wrap, 0);
      }
    }

    if (initial >= 0.5) setValue(initial);

    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var v = parseFloat(btn.getAttribute("data-value"));
        if (isNaN(v)) return;
        setValue(v);
      });
      btn.addEventListener("mouseenter", function () {
        var h = parseFloat(btn.getAttribute("data-value"));
        if (!isNaN(h)) paintHalfStarsInWrap(wrap, h);
      });
    });

    wrap.addEventListener("mouseleave", function () {
      var cur = parseNumLoose(hiddenInput.value);
      paintHalfStarsInWrap(wrap, validHalfRating(cur) ? cur : 0);
    });

    var lastTouchValue = 0;
    wrap.addEventListener(
      "touchmove",
      function (e) {
        var t = e.touches[0];
        if (!t) return;
        lastTouchValue = 0;
        buttons.forEach(function (b) {
          var r = b.getBoundingClientRect();
          if (
            t.clientX >= r.left &&
            t.clientX <= r.right &&
            t.clientY >= r.top &&
            t.clientY <= r.bottom
          ) {
            lastTouchValue = parseFloat(b.getAttribute("data-value"));
          }
        });
        if (lastTouchValue && !isNaN(lastTouchValue)) {
          setValue(lastTouchValue);
        }
      },
      { passive: true }
    );
  }

  window.bindHalfStarRow = bindHalfStarRow;

  /** Estrelas da nota conjunta (filme), passos de 0,5. */
  function initStarRating() {
    var wrap = document.getElementById("star-rating");
    var input = document.getElementById("input-rating");
    if (!wrap || !input) return;
    bindHalfStarRow(wrap, input);
  }

  function initReviewGrow() {
    function bind(ta) {
      if (!ta) return;
      function resize() {
        ta.style.height = "auto";
        ta.style.height = Math.max(80, ta.scrollHeight) + "px";
      }
      ta.addEventListener("input", resize);
      resize();
    }
    bind(document.getElementById("review"));
    bind(document.getElementById("tv-season-review"));
  }

  /** Séries: seletor de temporada + estrelas inteiras (1–10) por temporada; média só no cálculo. */
  function initTvSeasonEditor() {
    var form = document.getElementById("form-add");
    if (!form || form.getAttribute("data-media-type") !== "tv") return;

    var bootEl = document.getElementById("tv-seasons-initial");
    if (!bootEl) return;
    var rows;
    try {
      rows = JSON.parse(bootEl.textContent || "[]");
    } catch (err) {
      return;
    }
    if (!rows.length) return;

    var state = {};
    rows.forEach(function (row) {
      var sn = String(row.num);
      var r = row.rating;
      var ri = null;
      if (r !== null && r !== undefined && r !== "") {
        var rf = parseNumLoose(r);
        if (validHalfRating(rf)) ri = rf;
      }
      state[sn] = { rating: ri, review: row.review ? String(row.review) : "" };
    });

    var sel = document.getElementById("tv-season-select");
    var wrap = document.getElementById("tv-season-star-rating");
    var hid = document.getElementById("tv-season-rating-value");
    var ta = document.getElementById("tv-season-review");
    var meanEl = document.getElementById("tv-season-mean-hint");
    var titleEl = document.getElementById("tv-season-panel-title");
    if (!sel || !wrap || !hid || !ta) return;

    function currentSeason() {
      return String(sel.value);
    }

    function paintStars(val) {
      var v = 0;
      if (validHalfRating(val)) v = val;
      else {
        var p = parseNumLoose(val);
        if (validHalfRating(p)) v = p;
      }
      paintHalfStarsInWrap(wrap, v);
      hid.value = v > 0 ? String(v) : "";
    }

    function updateMeanHint() {
      if (!meanEl) return;
      var nums = [];
      Object.keys(state).forEach(function (k) {
        var x = state[k].rating;
        if (validHalfRating(x)) nums.push(x);
      });
      if (!nums.length) {
        meanEl.textContent =
          "Média da série: ainda sem notas — avalie ao menos uma temporada.";
        return;
      }
      var avg = nums.reduce(function (a, b) {
        return a + b;
      }, 0) / nums.length;
      var s = avg.toFixed(1).replace(".", ",");
      meanEl.textContent =
        "Com " +
        nums.length +
        " temporada(s) notada(s), a média da série na lista será " +
        s +
        "/10.";
    }

    function syncPanelTitle() {
      if (titleEl) {
        titleEl.textContent =
          "Temporada " + currentSeason() + " — nota e comentário";
      }
    }

    function syncUIToState() {
      var sn = currentSeason();
      var row = state[sn];
      paintStars(row ? row.rating : 0);
      ta.value = row && row.review ? row.review : "";
      syncPanelTitle();
    }

    function persistUIToState() {
      var sn = currentSeason();
      if (!state[sn]) state[sn] = { rating: null, review: "" };
      var r = parseNumLoose(hid.value);
      state[sn].rating = validHalfRating(r) ? r : null;
      state[sn].review = ta.value.trim();
    }

    wrap.querySelectorAll("button[data-value]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var v = parseFloat(btn.getAttribute("data-value"));
        if (isNaN(v)) return;
        paintStars(v);
        persistUIToState();
        updateMeanHint();
      });
      btn.addEventListener("mouseenter", function () {
        var h = parseFloat(btn.getAttribute("data-value"));
        if (!isNaN(h)) paintStars(h);
      });
    });

    wrap.addEventListener("mouseleave", function () {
      syncUIToState();
    });

    var lastTouchStar = 0;
    wrap.addEventListener(
      "touchmove",
      function (e) {
        var t = e.touches[0];
        if (!t) return;
        wrap.querySelectorAll("button[data-value]").forEach(function (b) {
          var r = b.getBoundingClientRect();
          if (
            t.clientX >= r.left &&
            t.clientX <= r.right &&
            t.clientY >= r.top &&
            t.clientY <= r.bottom
          ) {
            lastTouchStar = parseFloat(b.getAttribute("data-value"));
          }
        });
        if (lastTouchStar && !isNaN(lastTouchStar)) {
          paintStars(lastTouchStar);
          persistUIToState();
          updateMeanHint();
        }
      },
      { passive: true }
    );

    ta.addEventListener("input", function () {
      persistUIToState();
    });

    sel.addEventListener("change", function () {
      persistUIToState();
      syncUIToState();
      updateMeanHint();
    });

    syncUIToState();
    updateMeanHint();

    form.addEventListener("submit", function (e) {
      persistUIToState();
      var payload = {};
      Object.keys(state).forEach(function (k) {
        var r = state[k].rating;
        if (validHalfRating(r)) {
          payload[k] = {
            rating: r,
            review: state[k].review || "",
          };
        }
      });
      if (Object.keys(payload).length === 0) {
        e.preventDefault();
        alert(
          "Dê nota de 0,5 a 10 (meios pontos) a pelo menos uma temporada."
        );
        return;
      }
      var j = document.getElementById("season-data-json");
      if (j) j.value = JSON.stringify(payload);
    });
  }

  function initAddForm() {
    var form = document.getElementById("form-add");
    if (!form || form.getAttribute("data-needs-rating") !== "true") return;
    if (form.getAttribute("data-media-type") === "tv") return;
    form.addEventListener("submit", function (e) {
      var inp = document.getElementById("input-rating");
      if (!inp) return;
      var r = parseNumLoose(inp.value);
      if (!validHalfRating(r)) {
        e.preventDefault();
        alert("Selecione de 0,5 a 10 estrelas (meios pontos) para salvar.");
      }
    });
  }

  function foldAccents(s) {
    if (!s) return "";
    try {
      return s
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    } catch (e) {
      return String(s).toLowerCase();
    }
  }

  /** Palavras que aparecem nos gêneros TMDB em pt-BR (e sinônimos em inglês). */
  var HOME_GENRE_KEYWORDS = {
    all: [],
    "": [],
    terror: ["terror", "horror"],
    drama: ["drama"],
    suspense: ["suspense", "thriller"],
    acao: ["acao", "action"],
    aventura: ["aventura", "adventure"],
    animacao: ["animacao", "animation"],
    ficcao: [
      "ficcao cientifica",
      "ficção científica",
      "science fiction",
      "sci-fi",
    ],
    novela: ["novela", "soap"],
    policial: ["policial", "crime"],
    comedia: ["comedia", "comedy"],
  };

  function genresMatchFilter(rawGenresCsv, genreKey) {
    var kws = HOME_GENRE_KEYWORDS[genreKey];
    if (!kws || !kws.length) return true;
    var hay = foldAccents((rawGenresCsv || "").replace(/,/g, " "));
    for (var i = 0; i < kws.length; i++) {
      if (hay.indexOf(foldAccents(kws[i])) !== -1) return true;
    }
    return false;
  }

  /** Modal de filtros na home: aplicar / limpar / cancelar. */
  function initFilterModal() {
    var grid = document.getElementById("cards-grid");
    var emptyMsg = document.getElementById("filter-empty-msg");
    var modal = document.getElementById("filter-modal");
    var openBtn = document.getElementById("filter-open-btn");
    if (!modal || !openBtn || !grid) return;

    var backdrop = document.getElementById("filter-modal-backdrop");
    var applyBtn = document.getElementById("filter-apply-btn");
    var cancelBtn = document.getElementById("filter-cancel-btn");
    var clearBtn = document.getElementById("filter-clear-btn");

    var applied = { media: "all", genre: "", exactRating: null };

    function syncFormFromState(st) {
      modal.querySelectorAll('input[name="filter-media"]').forEach(function (r) {
        r.checked = r.value === st.media;
      });
      modal.querySelectorAll('input[name="filter-genre"]').forEach(function (r) {
        var g = st.genre || "";
        r.checked = r.value === "all" ? g === "" : r.value === g;
      });
      modal.querySelectorAll('input[name="filter-rating"]').forEach(function (r) {
        var v = r.value;
        var tgt =
          st.exactRating === null || st.exactRating === undefined
            ? "any"
            : String(st.exactRating);
        r.checked = v === tgt;
      });
    }

    function readForm() {
      var mediaEl = modal.querySelector('input[name="filter-media"]:checked');
      var genreEl = modal.querySelector('input[name="filter-genre"]:checked');
      var ratingEl = modal.querySelector('input[name="filter-rating"]:checked');
      var gval = genreEl && genreEl.value !== "all" ? genreEl.value : "";
      var exR = null;
      if (ratingEl && ratingEl.value && ratingEl.value !== "any") {
        exR = parseFloat(ratingEl.value);
        if (isNaN(exR)) exR = null;
      }
      return {
        media: mediaEl ? mediaEl.value : "all",
        genre: gval,
        exactRating: exR,
      };
    }

    function applyCardFilter() {
      var cards = grid.querySelectorAll(".media-card");
      var visible = 0;
      cards.forEach(function (card) {
        var ok = true;
        var mt = card.getAttribute("data-media-type") || "";
        if (applied.media !== "all" && mt !== applied.media) ok = false;
        if (ok && applied.genre) {
          var gcsv = card.getAttribute("data-genres") || "";
          if (!genresMatchFilter(gcsv, applied.genre)) ok = false;
        }
        if (ok && applied.exactRating !== null) {
          var r = parseFloat(card.getAttribute("data-rating") || "NaN");
          if (
            isNaN(r) ||
            Math.abs(r - applied.exactRating) > 0.051
          ) {
            ok = false;
          }
        }
        /* Classe em vez de [hidden]: alguns layouts com flex nos links não atualizavam bem. */
        card.classList.toggle("is-filter-hidden", !ok);
        card.removeAttribute("hidden");
        if (ok) visible += 1;
      });
      if (emptyMsg) emptyMsg.hidden = visible > 0;
    }

    function openModal() {
      syncFormFromState(applied);
      modal.hidden = false;
      modal.classList.add("filter-modal--open");
      openBtn.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
    }

    function closeModal() {
      modal.hidden = true;
      modal.classList.remove("filter-modal--open");
      openBtn.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
    }

    openBtn.addEventListener("click", openModal);
    if (backdrop) backdrop.addEventListener("click", closeModal);
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        syncFormFromState(applied);
        closeModal();
      });
    }
    var form = document.getElementById("filter-modal-form");
    function submitFilter(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      applied = readForm();
      applyCardFilter();
      closeModal();
    }
    if (form) {
      form.addEventListener("submit", submitFilter);
    } else if (applyBtn) {
      applyBtn.addEventListener("click", submitFilter);
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        applied = { media: "all", genre: "", exactRating: null };
        syncFormFromState(applied);
        applyCardFilter();
        closeModal();
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal && !modal.hidden) {
        syncFormFromState(applied);
        closeModal();
      }
    });

    applyCardFilter();
  }

  function suggRandomSkeleton() {
    return (
      '<div class="sugg-card sugg-card--vertical sugg-skeleton">' +
      '<div class="sugg-skel-poster"></div>' +
      '<div class="sugg-skel-body">' +
      '<div class="sugg-skel-line long"></div>' +
      '<div class="sugg-skel-line"></div><div class="sugg-skel-line"></div><div class="sugg-skel-line short"></div>' +
      "</div></div>"
    );
  }

  function suggGeminiSkeleton() {
    var cards = "";
    for (var i = 0; i < 8; i++) {
      cards +=
        '<div class="sugg-card sugg-card--horizontal sugg-skeleton">' +
        '<div class="sugg-skel-thumb"></div>' +
        '<div class="sugg-skel-body">' +
        '<div class="sugg-skel-line long"></div>' +
        '<div class="sugg-skel-line"></div><div class="sugg-skel-line short"></div>' +
        "</div></div>";
    }
    return (
      '<div class="sugg-gemini-slider" aria-busy="true">' +
      '<div class="sugg-gemini-slider-track">' +
      cards +
      "</div></div>"
    );
  }

  function renderRandomCard(item) {
    var href =
      "/details/" +
      encodeURIComponent(item.media_type) +
      "/" +
      encodeURIComponent(String(item.id));
    var poster = posterUrl(item.poster_path, "w185");
    var thumb = poster
      ? '<img src="' + poster + '" alt="" width="185" height="278" loading="lazy">'
      : '<div class="sugg-card-poster-ph">\uD83C\uDFAC</div>';
    var over = escapeHtml(
      (item.overview || "").slice(0, 320) + ((item.overview || "").length > 320 ? "…" : "")
    );
    return (
      '<a class="sugg-card sugg-card--vertical" href="' +
      href +
      '">' +
      '<div class="sugg-card-poster">' +
      thumb +
      "</div>" +
      '<div class="sugg-card-body">' +
      '<h3 class="sugg-card-title">' +
      escapeHtml(item.title || "") +
      "</h3>" +
      '<p class="sugg-card-overview clamp-3">' +
      over +
      "</p></div></a>"
    );
  }

  function renderGeminiCard(item) {
    var href =
      "/details/" +
      encodeURIComponent(item.media_type) +
      "/" +
      encodeURIComponent(String(item.id));
    var poster = posterUrl(item.poster_path, "w185");
    var thumb = poster
      ? '<img src="' + poster + '" alt="" width="80" height="120" loading="lazy">'
      : '<div class="sugg-card-thumb-ph">\uD83C\uDFAC</div>';
    var over = escapeHtml(item.overview || "");
    return (
      '<a class="sugg-card sugg-card--horizontal" href="' +
      href +
      '">' +
      '<div class="sugg-card-thumb">' +
      thumb +
      "</div>" +
      '<div class="sugg-card-body">' +
      '<h3 class="sugg-card-title">' +
      escapeHtml(item.title || "") +
      "</h3>" +
      '<p class="sugg-card-overview clamp-3">' +
      over +
      "</p></div></a>"
    );
  }

  /** Página /suggestions: aleatório TMDB + palavras-chave + Gemini. */
  function initSuggestionsPage() {
    var root = document.getElementById("suggestions-page");
    if (!root) return;

    var suggMedia = "movie";
    var randomGenreId = "";
    var randomKeywordId = "";

    function setSuggMedia(mt) {
      suggMedia = mt === "tv" ? "tv" : "movie";
      document.querySelectorAll(".sugg-toggle-btn").forEach(function (x) {
        var xm = x.getAttribute("data-sugg-media") || "movie";
        var on = xm === suggMedia;
        x.classList.toggle("is-active", on);
        x.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }

    document.querySelectorAll(".sugg-toggle-btn").forEach(function (b) {
      var xm0 = b.getAttribute("data-sugg-media") || "movie";
      b.setAttribute(
        "aria-pressed",
        xm0 === suggMedia ? "true" : "false"
      );
      b.addEventListener("click", function () {
        setSuggMedia(b.getAttribute("data-sugg-media") || "movie");
      });
    });

    try {
      var u = new URL(window.location.href);
      var med = (u.searchParams.get("media") || "").toLowerCase();
      if (med === "tv" || med === "movie") {
        setSuggMedia(med);
      }
      if (u.hash === "#sugg-random-title") {
        window.requestAnimationFrame(function () {
          var tgt = document.getElementById("sugg-random-title");
          if (tgt) tgt.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    } catch (e1) {
      /* ignore */
    }

    document.querySelectorAll(".sugg-genre-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll(".sugg-genre-chip").forEach(function (c) {
          c.classList.remove("is-active");
        });
        chip.classList.add("is-active");
        randomKeywordId = chip.getAttribute("data-keyword-id") || "";
        randomGenreId = chip.getAttribute("data-genre-id") || "";
        if (randomKeywordId) {
          randomGenreId = "";
        }
        if (randomGenreId === "10766") {
          setSuggMedia("tv");
        }
        var gtheme = chip.getAttribute("data-theme") || "default";
        document.body.setAttribute("data-genre-theme", gtheme);
      });
    });

    var randomWrap = document.getElementById("sugg-random-result");
    var randomInner = document.getElementById("sugg-random-inner");
    var randomBtn = document.getElementById("sugg-random-btn");
    var randomAgain = document.getElementById("sugg-random-again");

    var SORTEIO_DRAWN_KEY = "movies_app_sorteio_drawn_v1";
    function loadSorteioDrawn() {
      try {
        var raw = sessionStorage.getItem(SORTEIO_DRAWN_KEY);
        if (!raw) return [];
        var arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        var out = [];
        for (var i = 0; i < arr.length; i++) {
          var x = arr[i];
          if (!x || typeof x !== "object") continue;
          var mt = x.media_type === "tv" ? "tv" : x.media_type === "movie" ? "movie" : null;
          if (!mt) continue;
          var id = parseInt(x.id, 10);
          if (isNaN(id)) continue;
          out.push({ id: id, media_type: mt });
        }
        return out;
      } catch (e) {
        return [];
      }
    }
    function rememberSorteioDrawn(data) {
      try {
        var cur = loadSorteioDrawn();
        var mt = data.media_type === "tv" ? "tv" : "movie";
        var id = parseInt(data.id, 10);
        if (isNaN(id)) return;
        var k = mt + ":" + id;
        for (var j = 0; j < cur.length; j++) {
          if (cur[j].media_type + ":" + cur[j].id === k) return;
        }
        cur.push({ id: id, media_type: mt });
        if (cur.length > 400) cur = cur.slice(-400);
        sessionStorage.setItem(SORTEIO_DRAWN_KEY, JSON.stringify(cur));
      } catch (e2) {}
    }

    function fetchRandom() {
      randomWrap.hidden = false;
      randomInner.innerHTML = suggRandomSkeleton();
      var body = {
        media_type: randomGenreId === "10766" ? "tv" : suggMedia,
      };
      if (randomKeywordId) {
        var kid = parseInt(randomKeywordId, 10);
        if (!isNaN(kid)) {
          body.keyword_id = kid;
        }
      } else if (randomGenreId !== "") {
        var gid = parseInt(randomGenreId, 10);
        if (!isNaN(gid)) {
          body.genre_id = gid;
        }
      }
      body.exclude_drawn = loadSorteioDrawn();
      fetch("/suggestions/random", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(function (r) {
          return r.json().then(function (data) {
            return { ok: r.ok, data: data };
          });
        })
        .then(function (_ref) {
          var ok = _ref.ok;
          var data = _ref.data;
          if (!ok || !data.id) {
            randomInner.innerHTML =
              '<p class="sugg-error">' +
              escapeHtml(data.error || "Não foi possível obter sugestão.") +
              "</p>";
            return;
          }
          rememberSorteioDrawn(data);
          randomInner.innerHTML = renderRandomCard(data);
        })
        .catch(function () {
          randomInner.innerHTML =
            '<p class="sugg-error">Erro de rede. Tente novamente.</p>';
        });
    }

    if (randomBtn) randomBtn.addEventListener("click", fetchRandom);
    if (randomAgain) randomAgain.addEventListener("click", fetchRandom);

    /* --- Palavras-chave (discover) --- */
    var kwMedia = "movie";
    var kwSelected = [];
    var kwInput = document.getElementById("sugg-kw-input");
    var kwDropdown = document.getElementById("sugg-kw-dropdown");
    var kwChipsWrap = document.getElementById("sugg-kw-selected");
    var kwErr = document.getElementById("sugg-kw-error");
    var kwBtn = document.getElementById("sugg-kw-btn");
    var kwAgain = document.getElementById("sugg-kw-again");
    var kwWrap = document.getElementById("sugg-kw-result");
    var kwInner = document.getElementById("sugg-kw-inner");

    document.querySelectorAll(".sugg-kw-media-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        kwMedia = b.getAttribute("data-kw-media") || "movie";
        document.querySelectorAll(".sugg-kw-media-btn").forEach(function (x) {
          var on =
            (x.getAttribute("data-kw-media") || "movie") === kwMedia;
          x.classList.toggle("is-active", on);
          x.setAttribute("aria-pressed", on ? "true" : "false");
        });
      });
    });

    var kwPresetsEl = document.getElementById("sugg-kw-presets");
    if (kwPresetsEl) {
      fetch("/static/data/keyword_presets.json")
        .then(function (r) {
          return r.ok ? r.json() : [];
        })
        .then(function (list) {
          if (!Array.isArray(list) || !list.length) return;
          list.forEach(function (kw) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "sugg-kw-preset-chip";
            btn.setAttribute("role", "listitem");
            btn.textContent = kw.name || String(kw.id);
            btn.setAttribute("data-keyword-id", String(kw.id));
            btn.addEventListener("click", function () {
              if (kwSelected.length >= 10) return;
              var id = parseInt(btn.getAttribute("data-keyword-id"), 10);
              if (isNaN(id)) return;
              var dup = kwSelected.some(function (x) {
                return x.id === id;
              });
              if (dup) return;
              kwSelected.push({
                id: id,
                name: kw.name || String(id),
              });
              renderKwChips();
            });
            kwPresetsEl.appendChild(btn);
          });
        })
        .catch(function () {});
    }

    function renderKwChips() {
      if (!kwChipsWrap) return;
      kwChipsWrap.innerHTML = "";
      kwSelected.forEach(function (item, idx) {
        var span = document.createElement("span");
        span.className = "sugg-kw-chip";
        span.innerHTML =
          escapeHtml(item.name) +
          ' <button type="button" class="sugg-kw-chip-remove" data-idx="' +
          idx +
          '" aria-label="Remover palavra-chave">&times;</button>';
        kwChipsWrap.appendChild(span);
      });
      kwChipsWrap.querySelectorAll(".sugg-kw-chip-remove").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var i = parseInt(btn.getAttribute("data-idx"), 10);
          if (!isNaN(i)) {
            kwSelected.splice(i, 1);
            renderKwChips();
          }
        });
      });
    }

    var kwAbort = null;
    var runKwSearch = debounce(function () {
      if (!kwInput || !kwDropdown) return;
      var q = kwInput.value.trim();
      if (!q) {
        kwDropdown.hidden = true;
        kwDropdown.innerHTML = "";
        return;
      }
      if (kwAbort) kwAbort.abort();
      kwAbort = new AbortController();
      kwDropdown.innerHTML = skeletonRows(3);
      kwDropdown.hidden = false;
      fetch("/search/keyword?q=" + encodeURIComponent(q), {
        signal: kwAbort.signal,
      })
        .then(function (r) {
          if (!r.ok) throw new Error("fail");
          return r.json();
        })
        .then(function (data) {
          var results = data.results || [];
          if (!results.length) {
            kwDropdown.innerHTML =
              '<div class="search-result" style="cursor:default;color:var(--text-muted)">Nenhuma palavra-chave.</div>';
            return;
          }
          kwDropdown.innerHTML = "";
          results.slice(0, 12).forEach(function (kw) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "search-result sugg-kw-dd-item";
            btn.textContent = kw.name || String(kw.id);
            btn.addEventListener("click", function () {
              if (kwSelected.length >= 10) return;
              var dup = kwSelected.some(function (x) {
                return x.id === kw.id;
              });
              if (dup) return;
              kwSelected.push({ id: kw.id, name: kw.name || String(kw.id) });
              kwInput.value = "";
              kwDropdown.hidden = true;
              kwDropdown.innerHTML = "";
              renderKwChips();
            });
            kwDropdown.appendChild(btn);
          });
        })
        .catch(function (e) {
          if (e.name === "AbortError") return;
          kwDropdown.innerHTML =
            '<div class="search-result" style="cursor:default;color:#f87171">Erro na busca.</div>';
        });
    }, DEBOUNCE_MS);

    if (kwInput) {
      kwInput.addEventListener("input", runKwSearch);
      kwInput.addEventListener("focus", function () {
        if (kwInput.value.trim()) runKwSearch();
      });
    }

    document.addEventListener("click", function (e) {
      var wrap = document.querySelector(".sugg-kw-search-wrap");
      if (wrap && kwDropdown && !wrap.contains(e.target)) {
        kwDropdown.hidden = true;
      }
    });

    function fetchKwRandom() {
      if (!kwWrap || !kwInner) return;
      if (kwErr) {
        kwErr.hidden = true;
        kwErr.textContent = "";
      }
      if (!kwSelected.length) {
        if (kwErr) {
          kwErr.textContent = "Adicione ao menos uma palavra-chave.";
          kwErr.hidden = false;
        }
        return;
      }
      kwWrap.hidden = false;
      kwInner.innerHTML = suggRandomSkeleton();
      fetch("/suggestions/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword_ids: kwSelected.map(function (x) {
            return x.id;
          }),
          media_type: kwMedia,
        }),
      })
        .then(function (r) {
          return r.json().then(function (data) {
            return { ok: r.ok, data: data };
          });
        })
        .then(function (ref) {
          var data = ref.data;
          if (!ref.ok || !data.id) {
            kwInner.innerHTML =
              '<p class="sugg-error">' +
              escapeHtml(data.error || "Não foi possível sortear.") +
              "</p>";
            return;
          }
          kwInner.innerHTML = renderRandomCard(data);
        })
        .catch(function () {
          kwInner.innerHTML =
            '<p class="sugg-error">Erro de rede. Tente novamente.</p>';
        });
    }

    if (kwBtn) kwBtn.addEventListener("click", fetchKwRandom);
    if (kwAgain) kwAgain.addEventListener("click", fetchKwRandom);

    /* --- Seção Gemini: inputs dinâmicos + autocomplete --- */
    var geminiScope = "mixed";
    document.querySelectorAll(".sugg-gemini-scope-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        geminiScope = b.getAttribute("data-gemini-scope") || "mixed";
        document.querySelectorAll(".sugg-gemini-scope-btn").forEach(function (x) {
          x.classList.toggle(
            "is-active",
            (x.getAttribute("data-gemini-scope") || "mixed") === geminiScope
          );
        });
      });
    });

    function geminiSearchType() {
      if (geminiScope === "movie") return "movie";
      if (geminiScope === "tv") return "tv";
      return "multi";
    }

    var inputsWrap = document.getElementById("sugg-gemini-inputs");
    var addInputBtn = document.getElementById("sugg-add-input");
    var geminiBtn = document.getElementById("sugg-gemini-btn");
    var geminiResults = document.getElementById("sugg-gemini-results");
    var geminiErr = document.getElementById("sugg-gemini-error");

    function rowTemplate() {
      var row = document.createElement("div");
      row.className = "sugg-input-row";
      row.setAttribute("data-sugg-input-row", "");
      row.innerHTML =
        '<div class="sugg-autocomplete-wrap">' +
        '<input type="text" class="sugg-gemini-input" name="liked_titles[]" placeholder="Ex: Interestelar, Bacurau, The Bear" autocomplete="off" aria-label="Título que você gostou">' +
        '<div class="sugg-autocomplete-dropdown" hidden></div></div>' +
        '<button type="button" class="sugg-remove-input" aria-label="Remover campo">&times;</button>';
      return row;
    }

    function updateRemoveVisibility() {
      var rows = inputsWrap.querySelectorAll("[data-sugg-input-row]");
      rows.forEach(function (row, idx) {
        var rm = row.querySelector(".sugg-remove-input");
        if (!rm) return;
        rm.hidden = rows.length <= 1;
      });
    }

    function closeAllSuggDropdowns() {
      inputsWrap
        .querySelectorAll(".sugg-autocomplete-dropdown")
        .forEach(function (d) {
          d.hidden = true;
          d.innerHTML = "";
        });
    }

    function bindRowAutocomplete(row) {
      var input = row.querySelector(".sugg-gemini-input");
      var dd = row.querySelector(".sugg-autocomplete-dropdown");
      var wrap = row.querySelector(".sugg-autocomplete-wrap");
      var rm = row.querySelector(".sugg-remove-input");
      if (!input || !dd || !wrap) return;

      var abortCtrl = null;
      var runSearch = debounce(function () {
        var q = input.value.trim();
        if (!q) {
          dd.hidden = true;
          dd.innerHTML = "";
          return;
        }
        if (abortCtrl) abortCtrl.abort();
        abortCtrl = new AbortController();
        dd.innerHTML = skeletonRows(3);
        dd.hidden = false;
        fetch(
          "/search?q=" +
            encodeURIComponent(q) +
            "&type=" +
            encodeURIComponent(geminiSearchType()),
          {
            signal: abortCtrl.signal,
          }
        )
          .then(function (r) {
            if (!r.ok) throw new Error("fail");
            return r.json();
          })
          .then(function (data) {
            var results = data.results || [];
            if (!results.length) {
              dd.innerHTML =
                '<div class="sugg-ac-item muted">Nenhum resultado</div>';
              return;
            }
            dd.innerHTML = "";
            results.slice(0, 8).forEach(function (it) {
              var btn = document.createElement("button");
              btn.type = "button";
              btn.className = "sugg-ac-item sugg-ac-item--row";
              var thumb = posterUrl(it.poster_path, "w92");
              var thumbHtml = thumb
                ? '<span class="sugg-ac-thumb"><img src="' +
                  thumb +
                  '" alt="" width="46" height="69" loading="lazy"></span>'
                : '<span class="sugg-ac-thumb sugg-ac-thumb-ph" aria-hidden="true">\uD83C\uDFAC</span>';
              var year = "";
              if (it.release_date && it.release_date.length >= 4) {
                year = it.release_date.slice(0, 4);
              }
              var badge = it.media_type === "movie" ? "Filme" : "Série";
              btn.innerHTML =
                thumbHtml +
                '<span class="sugg-ac-body"><span class="sugg-ac-title">' +
                escapeHtml(it.title || "") +
                "</span><span class=\"sugg-ac-meta\">" +
                (year ? year + " · " : "") +
                '<span class="badge">' +
                badge +
                "</span></span></span>";
              btn.addEventListener("click", function () {
                input.value = it.title || "";
                dd.hidden = true;
                dd.innerHTML = "";
              });
              dd.appendChild(btn);
            });
          })
          .catch(function (e) {
            if (e.name === "AbortError") return;
            dd.innerHTML =
              '<div class="sugg-ac-item muted">Erro na busca</div>';
          });
      }, DEBOUNCE_MS);

      input.addEventListener("input", runSearch);
      input.addEventListener("focus", function () {
        var q = input.value.trim();
        if (q) runSearch();
      });

      if (rm) {
        rm.addEventListener("click", function () {
          if (inputsWrap.querySelectorAll("[data-sugg-input-row]").length <= 1)
            return;
          row.remove();
          updateRemoveVisibility();
        });
      }
    }

    if (inputsWrap) {
      inputsWrap.querySelectorAll("[data-sugg-input-row]").forEach(bindRowAutocomplete);
      updateRemoveVisibility();
    }

    if (addInputBtn && inputsWrap) {
      addInputBtn.addEventListener("click", function () {
        var n = inputsWrap.querySelectorAll("[data-sugg-input-row]").length;
        if (n >= 5) return;
        var row = rowTemplate();
        inputsWrap.appendChild(row);
        bindRowAutocomplete(row);
        updateRemoveVisibility();
      });
    }

    document.addEventListener("click", function (e) {
      if (inputsWrap && !inputsWrap.contains(e.target)) closeAllSuggDropdowns();
    });

    if (geminiBtn && geminiResults) {
      geminiBtn.addEventListener("click", function () {
        if (geminiErr) {
          geminiErr.hidden = true;
          geminiErr.textContent = "";
        }
        var titles = [];
        inputsWrap.querySelectorAll(".sugg-gemini-input").forEach(function (inp) {
          var t = inp.value.trim();
          if (t) titles.push(t);
        });
        if (!titles.length) {
          if (geminiErr) {
            geminiErr.textContent = "Preencha pelo menos um título.";
            geminiErr.hidden = false;
          }
          return;
        }

        geminiResults.hidden = false;
        geminiResults.innerHTML = suggGeminiSkeleton();

        fetch("/suggestions/gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            titles: titles,
            media_scope: geminiScope,
          }),
        })
          .then(function (r) {
            return r.json().then(function (data) {
              return { ok: r.ok, data: data };
            });
          })
          .then(function (_ref2) {
            var ok = _ref2.ok;
            var data = _ref2.data;
            if (!ok) {
              var msg =
                (data && data.error) ||
                "Não foi possível gerar sugestões agora. Tente novamente.";
              if (data && data.detail) {
                msg +=
                  "\n\n" +
                  (typeof data.detail === "string"
                    ? data.detail
                    : JSON.stringify(data.detail));
              }
              geminiResults.innerHTML =
                '<p class="sugg-error sugg-error-pre">' +
                escapeHtml(msg) +
                "</p>";
              return;
            }
            var results = data.results || [];
            if (!results.length) {
              geminiResults.innerHTML =
                '<p class="sugg-error">Nenhum título encontrado no TMDB.</p>';
              return;
            }
            geminiResults.innerHTML =
              '<div class="sugg-gemini-slider"><div class="sugg-gemini-slider-track">' +
              results.map(renderGeminiCard).join("") +
              "</div></div>";
          })
          .catch(function () {
            geminiResults.innerHTML =
              '<p class="sugg-error">Não foi possível gerar sugestões agora. Tente novamente.</p>';
          });
      });
    }
  }

  var ACTIVE_PROFILE_KEY = "movies_app_active_profile_slug";

  function initPartnerPresencePoll() {
    var path = (window.location.pathname || "").replace(/\/$/, "") || "/";
    if (path === "/bem-vindo") return;
    var wrap = document.getElementById("site-header-partner");
    var label = document.getElementById("site-header-partner-label");
    var dot = wrap && wrap.querySelector(".site-header-partner-dot");
    var body = document.body;
    if (!wrap || !label || !dot) return;

    function apiPath(pth) {
      var root = (body && body.getAttribute("data-app-base")) || "";
      root = String(root).replace(/\/$/, "");
      var p = pth.charAt(0) === "/" ? pth : "/" + pth;
      return root ? root + p : p;
    }

    function tick() {
      var slug = (localStorage.getItem(ACTIVE_PROFILE_KEY) || "a").toLowerCase();
      if (slug !== "a" && slug !== "b") {
        wrap.setAttribute("hidden", "");
        return;
      }
      fetch(apiPath("/api/presence"), { credentials: "same-origin" })
        .then(function (r) {
          return r.json();
        })
        .then(function (j) {
          var other = slug === "b" ? "a" : "b";
          var on = j && j.online && j.online[other];
          var la = body.getAttribute("data-profile-label-a") || "A";
          var lb = body.getAttribute("data-profile-label-b") || "B";
          var otherName = other === "b" ? lb : la;
          wrap.removeAttribute("hidden");
          dot.classList.toggle("is-online", !!on);
          label.textContent = on ? otherName + " no app" : otherName + " ausente";
          wrap.setAttribute("title", label.textContent);
        })
        .catch(function () {});
    }

    tick();
    window.setInterval(tick, 30000);
  }

  function initActiveUser() {
    var path = (window.location.pathname || "").replace(/\/$/, "") || "/";
    if (path !== "/bem-vindo") {
      var stored = (localStorage.getItem(ACTIVE_PROFILE_KEY) || "").toLowerCase();
      if (stored !== "a" && stored !== "b") {
        window.location.replace("/bem-vindo");
        return;
      }
    }

    var badge = document.getElementById("active-user-badge");
    var greet = document.getElementById("site-header-greet");
    var dlg = document.getElementById("active-user-dialog");
    if (!badge || !dlg) return;
    var body = document.body;
    var la = body.getAttribute("data-profile-label-a") || "A";
    var lb = body.getAttribute("data-profile-label-b") || "B";

    function labelFor(slug) {
      return slug === "b" ? lb : la;
    }

    function apiPath(path) {
      var root = (body && body.getAttribute("data-app-base")) || "";
      root = String(root).replace(/\/$/, "");
      var p = path.charAt(0) === "/" ? path : "/" + path;
      return root ? root + p : p;
    }

    function setProfileAndClose(s) {
      var slug = s === "b" ? "b" : "a";
      localStorage.setItem(ACTIVE_PROFILE_KEY, slug);
      fetch(apiPath("/api/active-profile"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slug }),
      })
        .catch(function () {})
        .finally(function () {
          if (typeof dlg.close === "function") dlg.close();
          paint();
          if (window.showAppToast) {
            window.showAppToast("Perfil ativo: " + labelFor(slug), "ok");
          }
          var pNow = (window.location.pathname || "").replace(/\/$/, "") || "/";
          if (pNow === "/bem-vindo") {
            window.location.href = "/";
          }
        });
    }

    function paint() {
      var slug = (localStorage.getItem(ACTIVE_PROFILE_KEY) || "").toLowerCase();
      if (slug !== "a" && slug !== "b") {
        slug = "";
      }
      if (!slug) {
        badge.hidden = true;
        if (greet) greet.setAttribute("hidden", "");
        return;
      }
      if (greet) greet.removeAttribute("hidden");
      badge.textContent = labelFor(slug);
      badge.hidden = false;
    }

    dlg.querySelectorAll(".active-user-pick").forEach(function (b) {
      b.addEventListener("click", function () {
        var s = b.getAttribute("data-profile-slug") || "a";
        setProfileAndClose(s);
      });
    });
    badge.addEventListener("click", function () {
      if (typeof dlg.showModal === "function") dlg.showModal();
    });
    paint();
  }

  function initNavDrawer() {
    var openBtn = document.getElementById("nav-drawer-open");
    var closeBtn = document.getElementById("nav-drawer-close");
    var drawer = document.getElementById("app-drawer");
    var backdrop = document.getElementById("nav-drawer-backdrop");
    if (!openBtn || !drawer || !backdrop) return;

    function setOpen(on) {
      drawer.classList.toggle("is-open", on);
      backdrop.classList.toggle("is-open", on);
      drawer.setAttribute("aria-hidden", on ? "false" : "true");
      backdrop.setAttribute("aria-hidden", on ? "false" : "true");
      openBtn.setAttribute("aria-expanded", on ? "true" : "false");
      document.body.classList.toggle("nav-drawer-open", on);
      if (on) {
        try {
          closeBtn && closeBtn.focus();
        } catch (e) {
          /* ignore */
        }
      }
    }

    openBtn.addEventListener("click", function () {
      setOpen(!drawer.classList.contains("is-open"));
    });
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        setOpen(false);
      });
    }
    backdrop.addEventListener("click", function () {
      setOpen(false);
    });
    drawer.querySelectorAll("a.nav-drawer-link").forEach(function (a) {
      a.addEventListener("click", function () {
        setOpen(false);
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && drawer.classList.contains("is-open")) {
        setOpen(false);
      }
    });
  }

  function initWelcomePick() {
    document.querySelectorAll(".welcome-profile-pick").forEach(function (b) {
      b.addEventListener("click", function () {
        var s = b.getAttribute("data-profile-slug") || "a";
        localStorage.setItem(ACTIVE_PROFILE_KEY, s === "b" ? "b" : "a");
        window.location.href = "/";
      });
    });
  }

  function initHistoryCelebration() {
    var home = document.getElementById("page-history");
    if (!home) return;
    try {
      var u = new URL(window.location.href);
      if (u.searchParams.get("saved") !== "1") return;
      u.searchParams.delete("saved");
      var qs = u.searchParams.toString();
      var path = u.pathname + (qs ? "?" + qs : "") + u.hash;
      window.history.replaceState({}, "", path);
      var conf = window.confetti;
      if (typeof conf === "function") {
        conf({
          particleCount: 130,
          spread: 70,
          startVelocity: 28,
          origin: { y: 0.62 },
        });
      }
      if (window.showAppToast) window.showAppToast("Lista atualizada!", "ok");
    } catch (e) {
      /* ignore */
    }
  }

  function initDetailsParallax() {
    var root = document.querySelector(".page-details");
    var bg = root && root.querySelector(".details-backdrop");
    if (!bg || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    bg.classList.add("is-parallax");
    function tick() {
      var y = window.scrollY || 0;
      var t = Math.min(y * 0.16, 72);
      bg.style.transform = "translate3d(0, " + t + "px, 0) scale(1.05)";
    }
    window.addEventListener("scroll", tick, { passive: true });
    tick();
  }

  function sampleImageToCssVars(img) {
    if (!img || !img.complete) return;
    try {
      var c = document.createElement("canvas");
      var w = 28;
      var h = 28;
      c.width = w;
      c.height = h;
      var ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      var data = ctx.getImageData(0, 0, w, h).data;
      var r = 0;
      var g = 0;
      var b = 0;
      var n = 0;
      for (var i = 0; i < data.length; i += 16) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n += 1;
      }
      if (!n) return;
      r = Math.round(r / n);
      g = Math.round(g / n);
      b = Math.round(b / n);
      var root = document.documentElement;
      root.style.setProperty("--poster-sampled", "rgb(" + r + "," + g + "," + b + ")");
    } catch (e) {
      /* canvas pode ficar “tainted” com CORS */
    }
  }

  function initDetailsPosterPalette() {
    var img = document.querySelector(".page-details .details-poster img");
    if (!img) return;
    if (img.complete) sampleImageToCssVars(img);
    else
      img.addEventListener(
        "load",
        function () {
          sampleImageToCssVars(img);
        },
        { once: true }
      );
  }

  function bindLiteTilt(el) {
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    el.style.transformStyle = "preserve-3d";
    function onMove(e) {
      var r = el.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5;
      var y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform =
        "perspective(720px) rotateY(" +
        x * 10 +
        "deg) rotateX(" +
        -y * 10 +
        "deg) translateZ(0)";
    }
    function onLeave() {
      el.style.transform = "";
    }
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
  }
  window.bindLiteTilt = bindLiteTilt;

  function initHomeCardTilts() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.querySelectorAll(".home-media-card").forEach(bindLiteTilt);
  }

  function initViewTransitionNav() {
    if (typeof document.startViewTransition !== "function") return;
    document.addEventListener("click", function (e) {
      var a = e.target.closest("a.nav-preserve-scroll");
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (a.getAttribute("target") === "_blank") return;
      var href = a.getAttribute("href");
      if (!href || href.indexOf("javascript:") === 0) return;
      var url;
      try {
        url = new URL(a.href, window.location.origin);
      } catch (err) {
        return;
      }
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      document.startViewTransition(function () {
        window.location.href = url.pathname + url.search + url.hash;
      });
    });
  }

  function initStarPulseOnTen() {
    var form = document.getElementById("form-add");
    var inp = document.getElementById("input-rating");
    var wrap = document.getElementById("star-rating");
    if (!form || !inp || !wrap) return;
    if (form.getAttribute("data-media-type") !== "movie") return;
    form.addEventListener("submit", function () {
      var v = parseNumLoose(inp.value);
      if (v === 10) {
        wrap.classList.add("is-rating-celebrate");
        window.setTimeout(function () {
          wrap.classList.remove("is-rating-celebrate");
        }, 900);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initActiveUser();
    initPartnerPresencePoll();
    initNavDrawer();
    initWelcomePick();
    initIndexScroll();
    initSearch();
    initHomeTypewriter();
    initBackButton();
    initSynopsis();
    initStarRating();
    initTvSeasonEditor();
    initReviewGrow();
    initAddForm();
    initFilterModal();
    initSuggestionsPage();
    initHistoryCelebration();
    initDetailsParallax();
    initDetailsPosterPalette();
    initHomeCardTilts();
    initViewTransitionNav();
    initStarPulseOnTen();
  });
})();

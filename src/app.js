/* Markdown Render — client-side app.
 * Globals provided by vendor scripts: marked, DOMPurify, hljs.
 */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const THEME_KEY = "mdrender:theme";
  const WIDTH_KEY = "mdrender:width";
  const MD_FILE = /\.(md|markdown|mdown|mkd|mdx|txt)$/i;
  const MD_LINK = /\.(md|markdown|mdown|mkd|mdx)$/i;

  const ICON = {
    copy:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3.5" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="size-3.5" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    file:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="size-3.5 shrink-0" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>',
  };

  const els = {
    html: document.documentElement,
    progress: $("#progress"),
    loadbar: $("#loadbar"),
    fileName: $("#file-name"),
    filePath: $("#file-path"),
    empty: $("#empty-state"),
    doc: $("#doc-layout"),
    preview: $("#preview"),
    toc: $("#toc"),
    tocDrawer: $("#toc-drawer"),
    tocDrawerBody: $("#toc-drawer-body"),
    tocDrawerMeta: $("#toc-drawer-meta"),
    docMeta: $("#doc-meta"),
    watchNote: $("#watch-note"),
    fileInput: $("#file-input"),
    pathDialog: $("#path-dialog"),
    pathForm: $("#path-form"),
    pathInput: $("#path-input"),
    pathError: $("#path-error"),
    pathSubmit: $("#path-submit"),
    recentChips: $("#recent-chips"),
    recentWrap: $("#recent-wrap"),
    recentDialog: $("#recent-dialog"),
    recentDialogWrap: $("#recent-dialog-wrap"),
    dropOverlay: $("#drop-overlay"),
    toast: $("#toast"),
    loadError: $("#load-error"),
    loadErrorText: $("#load-error-text"),
    serverNote: $("#server-note"),
    staticNote: $("#static-note"),
    localTip: $("#local-tip"),
    pathDialogTitle: $("#path-dialog-title"),
    pathDialogDesc: $("#path-dialog-desc"),
    pathLabel: $("#path-label"),
    pathNote: $("#path-dialog-note"),
    recentLabel: $("#recent-label"),
    btnTheme: $("#btn-theme"),
    btnWidth: $("#btn-width"),
    btnOpen: $("#btn-open"),
    btnOpenPath: $("#btn-open-path"),
    btnPrint: $("#btn-print"),
    btnToc: $("#btn-toc"),
    btnTocClose: $("#btn-toc-close"),
    btnTocBackdrop: $("#toc-backdrop"),
    btnEmptyChoose: $("#btn-empty-choose"),
    btnEmptyPath: $("#btn-empty-path"),
    btnEmptyDemo: $("#btn-empty-demo"),
    btnPathClose: $("#btn-path-close"),
  };

  const state = {
    static: false,
    path: null,
    url: null,
    dir: null,
    baseUrl: null,
    name: null,
    content: "",
    mtime: 0,
    token: 0,
    headings: [],
    activeId: null,
    poll: null,
    recentKey: "mdrender:recent:path",
  };

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function baseName(value) {
    if (/^https?:\/\//i.test(value)) {
      try {
        const url = new URL(value);
        const last = url.pathname.split("/").filter(Boolean).pop();
        return last ? decodeURIComponent(last) : url.hostname;
      } catch {
        /* fall through to path handling */
      }
    }
    return value.split(/[\\/]/).pop() || value;
  }

  function dirName(value) {
    if (/^https?:\/\//i.test(value)) {
      try {
        const url = new URL(value);
        url.pathname = url.pathname.replace(/[^/]*$/, "");
        url.search = "";
        url.hash = "";
        return `${url.origin}${url.pathname}`;
      } catch {
        /* fall through to path handling */
      }
    }
    const trimmed = value.replace(/[\\/][^\\/]*$/, "");
    return trimmed === value ? "" : trimmed;
  }

  function slugify(text) {
    return String(text)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** Resolve `rel` against an absolute POSIX/Windows directory. */
  function resolvePath(dir, rel) {
    let decoded = rel;
    try {
      decoded = decodeURI(rel);
    } catch {
      /* keep the raw value */
    }
    const base = String(dir).replace(/\\/g, "/");
    const joined = `${base}/${decoded.replace(/\\/g, "/")}`;
    const rooted = joined.startsWith("/");
    const parts = joined.split("/");
    const out = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (out.length > 1) out.pop();
        continue;
      }
      out.push(part);
    }
    return `${rooted ? "/" : ""}${out.join("/")}`;
  }

  function splitHash(href) {
    const index = href.indexOf("#");
    return index === -1
      ? { path: href, hash: "" }
      : { path: href.slice(0, index), hash: href.slice(index) };
  }

  /* ------------------------------------------------------------------ */
  /* Theme                                                               */
  /* ------------------------------------------------------------------ */

  let fallbackTheme = null;

  function storedTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      /* storage unavailable */
    }
    return fallbackTheme;
  }

  function systemPrefersDark() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function isDark() {
    const stored = storedTheme();
    return stored ? stored === "dark" : systemPrefersDark();
  }

  function syncTheme() {
    const dark = isDark();
    els.html.classList.toggle("dark", dark);
    const label = dark ? "Switch to light mode" : "Switch to dark mode";
    els.btnTheme.setAttribute("aria-label", label);
    els.btnTheme.setAttribute("title", label);
  }

  function toggleTheme() {
    const next = els.html.classList.contains("dark") ? "light" : "dark";
    fallbackTheme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage may be blocked; the class still changes */
    }
    syncTheme();
  }

  /* ------------------------------------------------------------------ */
  /* Layout width                                                        */
  /* ------------------------------------------------------------------ */

  function isFullWidth() {
    return els.html.dataset.width === "full";
  }

  function syncWidth() {
    const full = isFullWidth();
    els.html.dataset.width = full ? "full" : "fit";

    const label = full ? "Switch to centered reading width" : "Switch to full window width";
    els.btnWidth.setAttribute("aria-label", label);
    els.btnWidth.setAttribute("title", label);
    els.btnWidth.setAttribute("aria-pressed", String(full));

    const active = full ? "collapse" : "expand";
    for (const icon of $$("[data-width-icon]", els.btnWidth)) {
      icon.classList.toggle("hidden", icon.dataset.widthIcon !== active);
    }
  }

  function toggleWidth() {
    els.html.dataset.width = isFullWidth() ? "fit" : "full";
    try {
      localStorage.setItem(WIDTH_KEY, els.html.dataset.width);
    } catch {
      /* storage may be blocked; the layout still changes */
    }
    syncWidth();
  }

  /* ------------------------------------------------------------------ */
  /* Recent files                                                        */
  /* ------------------------------------------------------------------ */

  function getRecents() {
    try {
      const raw = localStorage.getItem(state.recentKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
    } catch {
      return [];
    }
  }

  function addRecent(path) {
    const list = [path, ...getRecents().filter((item) => item !== path)].slice(0, 8);
    try {
      localStorage.setItem(state.recentKey, JSON.stringify(list));
    } catch {
      /* ignore */
    }
    renderRecents();
  }

  function renderRecents() {
    const list = getRecents();

    els.recentChips.replaceChildren();
    els.recentWrap.hidden = list.length === 0;
    for (const path of list.slice(0, 6)) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.dataset.recent = path;
      chip.title = path;
      chip.innerHTML = `${ICON.file}<span class="truncate">${escapeHtml(baseName(path))}</span>`;
      els.recentChips.append(chip);
    }

    els.recentDialog.replaceChildren();
    els.recentDialogWrap.hidden = list.length === 0;
    for (const path of list) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "recent-row";
      row.dataset.recent = path;
      row.title = path;
      row.innerHTML = `${ICON.file}<span class="min-w-0 flex-1"><span class="block truncate font-medium">${escapeHtml(
        baseName(path),
      )}</span><span class="block truncate text-[10px] text-slate-400 dark:text-slate-500">${escapeHtml(
        dirName(path),
      )}</span></span>`;
      els.recentDialog.append(row);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Toast / errors                                                      */
  /* ------------------------------------------------------------------ */

  let toastTimer = null;

  function toast(message, tone = "info") {
    const tones = {
      info: "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
      error:
        "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950 dark:text-rose-300",
      success:
        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950 dark:text-emerald-300",
    };
    els.toast.className = `no-print fade-in fixed bottom-5 left-1/2 z-[70] w-[min(92vw,28rem)] -translate-x-1/2 rounded-xl border px-4 py-3 text-sm shadow-lg ${
      tones[tone] || tones.info
    }`;
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 4500);
  }

  function showLoadError(message) {
    els.loadErrorText.textContent = message;
    els.loadError.hidden = !message;
  }

  function showPathError(message) {
    els.pathError.textContent = message;
    els.pathError.hidden = !message;
    els.pathInput.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function setBusy(busy) {
    els.loadbar.hidden = !busy;
    els.fileName.setAttribute("aria-busy", String(busy));
  }

  /* ------------------------------------------------------------------ */
  /* Markdown rendering                                                  */
  /* ------------------------------------------------------------------ */

  function render() {
    const markdown = state.content.replace(/^\uFEFF/, "");

    let html;
    try {
      html = marked.parse(markdown, { gfm: true, breaks: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      html = `<p>Could not parse this Markdown file: ${escapeHtml(message)}</p>`;
    }

    els.preview.innerHTML = DOMPurify.sanitize(html, {
      ADD_ATTR: ["target", "rel"],
      FORBID_TAGS: ["style", "form", "iframe", "object", "embed", "base", "meta", "link"],
      FORBID_ATTR: ["style"],
    });

    addHeadingAnchors();
    enhanceCodeBlocks();
    wrapTables();
    enhanceImages();
    enhanceLinks();
    buildToc();
    updateProgress();
  }

  function addHeadingAnchors() {
    const used = new Set();
    const headings = $$("h1,h2,h3,h4,h5,h6", els.preview);

    for (const heading of headings) {
      const text = heading.textContent.replace(/\s+/g, " ").trim();
      const base = heading.id.trim() || slugify(text) || "section";
      let id = base;
      let index = 2;
      while (used.has(id)) {
        id = `${base}-${index}`;
        index += 1;
      }
      used.add(id);
      heading.id = id;

      const anchor = document.createElement("a");
      anchor.className = "heading-anchor";
      anchor.href = `#${id}`;
      anchor.setAttribute("aria-label", `Link to ${text || "this section"}`);
      anchor.textContent = "#";
      heading.prepend(anchor);
    }
  }

  function enhanceCodeBlocks() {
    for (const pre of $$("pre", els.preview)) {
      if (pre.closest(".code-block")) continue;

      const code = pre.querySelector("code");
      const languageClass = code
        ? Array.from(code.classList).find((name) => name.startsWith("language-"))
        : "";
      const language = languageClass ? languageClass.slice("language-".length) : "";

      const wrapper = document.createElement("div");
      wrapper.className = "code-block not-prose";

      const bar = document.createElement("div");
      bar.className = "code-block__bar";

      const label = document.createElement("span");
      label.className = "code-block__lang";
      label.textContent = language || "text";

      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "code-block__copy";
      copy.innerHTML = `${ICON.copy}<span>Copy</span>`;
      copy.setAttribute("aria-label", "Copy code to clipboard");
      copy.addEventListener("click", () => {
        copyText(code ? code.textContent || "" : pre.textContent || "", copy);
      });

      bar.append(label, copy);
      pre.replaceWith(wrapper);
      wrapper.append(bar, pre);

      if (!code) continue;
      code.classList.add("hljs");

      if (language && typeof hljs !== "undefined" && hljs.getLanguage(language)) {
        try {
          code.innerHTML = hljs.highlight(code.textContent || "", {
            language,
            ignoreIllegals: true,
          }).value;
        } catch {
          /* fall back to unhighlighted text */
        }
      }
    }
  }

  async function copyText(text, button) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.top = "-9999px";
        document.body.append(area);
        area.select();
        const ok = document.execCommand("copy");
        area.remove();
        if (!ok) throw new Error("copy failed");
      }
      button.classList.add("is-copied");
      button.innerHTML = `${ICON.check}<span>Copied</span>`;
    } catch {
      button.innerHTML = `${ICON.copy}<span>Press Ctrl+C</span>`;
    }
    setTimeout(() => {
      button.classList.remove("is-copied");
      button.innerHTML = `${ICON.copy}<span>Copy</span>`;
    }, 1600);
  }

  function wrapTables() {
    for (const table of $$("table", els.preview)) {
      if (table.parentElement && table.parentElement.classList.contains("table-wrap")) continue;
      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      table.replaceWith(wrap);
      wrap.append(table);
    }
  }

  function resolveAsset(source) {
    if (!source) return source;
    // Keep absolute URLs, protocol-relative URLs, data URIs and in-page fragments.
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(source)) return source;

    if (state.baseUrl) {
      try {
        return new URL(source, state.baseUrl).href;
      } catch {
        return source;
      }
    }

    if (source.startsWith("/")) return source;
    if (state.dir) {
      return `api/raw?path=${encodeURIComponent(resolvePath(state.dir, source))}`;
    }
    return source;
  }

  function enhanceImages() {
    for (const image of $$("img", els.preview)) {
      image.loading = "lazy";
      image.decoding = "async";
      const source = image.getAttribute("src") || "";
      const resolved = resolveAsset(source);
      if (resolved !== source) image.setAttribute("src", resolved);
      if (!image.hasAttribute("alt")) image.setAttribute("alt", "");
      image.addEventListener(
        "error",
        () => {
          image.classList.add("img-broken");
          image.title = "Image not found";
        },
        { once: true },
      );
    }
  }

  function enhanceLinks() {
    for (const anchor of $$("a[href]", els.preview)) {
      const href = anchor.getAttribute("href") || "";
      if (!href) continue;

      // In-page anchors and absolute/external URLs.
      if (href.startsWith("#")) continue;
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) {
        if (/^https?:/i.test(href)) {
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
        }
        continue;
      }

      // Docs loaded from a URL (or the bundled demo): resolve against that base.
      if (state.baseUrl) {
        try {
          const absolute = new URL(href, state.baseUrl);
          anchor.href = absolute.href;
          const { path } = splitHash(href);
          if (MD_LINK.test(path)) {
            anchor.dataset.mdUrl = absolute.href;
            if (!anchor.title) anchor.title = "Open in Markdown Render";
          }
        } catch {
          /* leave as-is */
        }
        continue;
      }

      if (href.startsWith("/")) {
        anchor.target = "_blank";
        anchor.rel = "noopener";
        continue;
      }

      const { path, hash } = splitHash(href);
      if (!path) continue;

      if (state.dir) {
        const absolute = resolvePath(state.dir, path);
        if (MD_LINK.test(path)) {
          anchor.dataset.mdPath = absolute;
          anchor.href = `?file=${encodeURIComponent(absolute)}${hash}`;
        } else {
          anchor.href = `api/raw?path=${encodeURIComponent(absolute)}${hash}`;
          anchor.target = "_blank";
          anchor.rel = "noopener";
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Table of contents                                                   */
  /* ------------------------------------------------------------------ */

  function tocAnchors() {
    return state.headings.map((heading) => {
      const level = Number(heading.tagName[1]);
      const anchor = document.createElement("a");
      anchor.className = "toc-link";
      anchor.href = `#${heading.id}`;
      anchor.dataset.tocId = heading.id;
      anchor.title = heading.textContent.replace(/\s+/g, " ").trim();

      const label = heading.cloneNode(true);
      label.querySelectorAll(".heading-anchor").forEach((node) => node.remove());
      anchor.textContent = (label.textContent || "").replace(/\s+/g, " ").trim();

      if (level >= 3) anchor.style.paddingLeft = "1.75rem";
      else if (level === 2) anchor.style.paddingLeft = "1.05rem";

      return anchor;
    });
  }

  function fillToc(container) {
    container.replaceChildren(...tocAnchors());
    if (!state.headings.length) {
      const empty = document.createElement("p");
      empty.className = "px-3 py-1 text-xs text-slate-400 dark:text-slate-500";
      empty.textContent = "No headings in this document.";
      container.replaceChildren(empty);
    }
  }

  function buildToc() {
    state.headings = $$("h1,h2,h3", els.preview).filter((heading) => heading.id);
    state.activeId = null;

    fillToc(els.toc);
    fillToc(els.tocDrawerBody);

    const words = state.content.trim() ? state.content.trim().split(/\s+/).length : 0;
    const minutes = Math.max(1, Math.round(words / 220));
    const meta = `${state.headings.length} ${
      state.headings.length === 1 ? "section" : "sections"
    } · ${words.toLocaleString()} words · ${minutes} min read`;

    els.docMeta.textContent = meta;
    els.tocDrawerMeta.textContent = meta;
    els.watchNote.hidden = !state.path;
  }

  function setActiveHeading(id) {
    if (state.activeId === id) return;
    state.activeId = id;
    for (const anchor of $$("[data-toc-id]")) {
      const active = anchor.dataset.tocId === id;
      anchor.classList.toggle("is-active", active);
      if (active) anchor.setAttribute("aria-current", "location");
      else anchor.removeAttribute("aria-current");
    }
  }

  function updateActiveHeading() {
    if (els.doc.hidden || !state.headings.length) return;

    let current = state.headings[0];
    for (const heading of state.headings) {
      if (heading.getBoundingClientRect().top <= 96) current = heading;
      else break;
    }

    const doc = document.documentElement;
    if (window.innerHeight + window.scrollY >= doc.scrollHeight - 8) {
      current = state.headings[state.headings.length - 1];
    }
    setActiveHeading(current.id);
  }

  function updateProgress() {
    if (els.doc.hidden) {
      els.progress.style.width = "0%";
      return;
    }
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const percent = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0;
    els.progress.style.width = `${percent.toFixed(2)}%`;
  }

  /* ------------------------------------------------------------------ */
  /* Loading                                                             */
  /* ------------------------------------------------------------------ */

  function updateChrome() {
    els.fileName.textContent = state.name || "No file loaded";
    els.filePath.title = state.path || state.url || "";

    if (state.path) {
      els.filePath.textContent = state.path;
    } else if (state.url) {
      els.filePath.textContent = state.url;
    } else if (state.baseUrl) {
      els.filePath.textContent = "Bundled demo";
    } else if (state.name) {
      els.filePath.textContent = "Local file · relative images may not resolve";
    } else {
      els.filePath.textContent = "Drop a file or open one to begin";
    }

    els.empty.hidden = Boolean(state.name);
    els.doc.hidden = !state.name;
    document.title = state.name ? `${state.name} — Markdown Render` : "Markdown Render";
    els.watchNote.hidden = !state.path;

    requestAnimationFrame(() => {
      updateProgress();
      updateActiveHeading();
    });
  }

  function scrollToHash(hash) {
    if (!hash || hash === "#") return;
    let id = hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      /* use raw */
    }
    const target = document.getElementById(id);
    if (target) {
      requestAnimationFrame(() => target.scrollIntoView({ block: "start", behavior: "auto" }));
    }
  }

  function setLocationState({ file = null, url = null, hash = "", replace = false } = {}) {
    const target = new URL(window.location.href);
    target.search = "";
    if (file) target.searchParams.set("file", file);
    if (url) target.searchParams.set("url", url);
    target.hash = hash && hash.startsWith("#") ? hash : "";
    const method = replace ? "replaceState" : "pushState";
    history[method]({ file, url }, "", target);
  }

  async function fetchMarkdown(input) {
    if (window.location.protocol === "file:") {
      throw new Error(
        "Loading by path needs the local server. Run `npm install && npm run dev`, then open http://127.0.0.1:4173.",
      );
    }

    let response;
    try {
      response = await fetch(`api/file?path=${encodeURIComponent(input)}`, { cache: "no-store" });
    } catch {
      throw new Error("Could not reach the local server. Is `npm run dev` running?");
    }

    if (!response.ok) {
      let message = `Could not open “${input}”.`;
      try {
        const body = await response.json();
        if (body && typeof body.error === "string") message = body.error;
      } catch {
        /* not JSON */
      }
      throw new Error(message);
    }

    const data = await response.json();
    if (!data || typeof data.content !== "string") {
      throw new Error("The server returned an unexpected response.");
    }
    return data;
  }

  async function loadPath(input, { push = true, hash = "", quiet = false, preserveScroll = null } = {}) {
    if (state.static) {
      const message =
        "Path loading needs the local server. Open a file from your device, or load a Markdown URL.";
      showLoadError(message);
      if (!quiet) toast(message, "error");
      return { ok: false, error: message };
    }

    const token = ++state.token;
    const scroll = preserveScroll;
    showLoadError("");
    setBusy(true);

    try {
      const data = await fetchMarkdown(input);
      if (token !== state.token) return { ok: false, error: "Superseded by a newer load." };

      state.path = data.path || null;
      state.url = null;
      state.dir = data.dir || null;
      state.baseUrl = null;
      state.name = data.name || "Untitled.md";
      state.content = data.content;
      state.mtime = Number(data.mtime) || 0;

      render();
      updateChrome();
      if (push) setLocationState({ file: state.path || input, hash });
      addRecent(state.path || input);
      if (hash) scrollToHash(hash);
      startPolling();

      if (scroll !== null) {
        requestAnimationFrame(() => window.scrollTo({ top: scroll, behavior: "auto" }));
      } else if (!hash) {
        window.scrollTo({ top: 0, behavior: "auto" });
      }

      return { ok: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (token === state.token) {
        showLoadError(message);
        if (!quiet) toast(message, "error");
      }
      return { ok: false, error: message };
    } finally {
      if (token === state.token) setBusy(false);
    }
  }

  async function loadFromUrl(input, { push = true, hash = "", quiet = false } = {}) {
    const token = ++state.token;
    setBusy(true);
    showLoadError("");

    try {
      const value = String(input || "").trim();
      if (!value) throw new Error("Enter a Markdown URL first.");
      if (value.startsWith("~") || /^[a-zA-Z]:[\\/]/.test(value)) {
        throw new Error(
          "Local paths need the dev server. Paste an https:// URL, or open the file from your device.",
        );
      }

      let target;
      try {
        target = new URL(value, window.location.href);
      } catch {
        throw new Error("That does not look like a valid URL.");
      }
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        throw new Error("Only http:// and https:// URLs can be loaded.");
      }
      if (window.location.protocol === "https:" && target.protocol === "http:") {
        throw new Error("This site is served over HTTPS, so the Markdown URL must use https:// too.");
      }

      const MAX_BYTES = 5 * 1024 * 1024;
      let response;
      try {
        response = await fetch(target.href, { cache: "no-store", mode: "cors" });
      } catch {
        throw new Error(
          "Could not fetch that URL. Check the address, or whether the server allows cross-origin (CORS) requests.",
        );
      }
      if (!response.ok) {
        throw new Error(`Could not load ${target.href} (HTTP ${response.status}).`);
      }
      const declaredSize = Number(response.headers.get("content-length") || 0);
      if (declaredSize > MAX_BYTES) {
        throw new Error("That Markdown file is too large to preview (over 5 MB).");
      }

      const text = await response.text();
      if (text.length > MAX_BYTES) {
        throw new Error("That Markdown file is too large to preview (over 5 MB).");
      }
      if (!text.trim()) throw new Error("That URL returned an empty file.");
      if (/^\s*<(?:!doctype html|html[\s>])/i.test(text)) {
        throw new Error("That URL returned an HTML page. Use the raw Markdown file URL instead.");
      }
      if (token !== state.token) return { ok: false, error: "Superseded by a newer load." };

      stopPolling();
      state.path = null;
      state.dir = null;
      state.url = target.href;
      state.baseUrl = new URL(".", target).href;
      state.name = baseName(target.href) || "document.md";
      state.content = text;
      state.mtime = 0;

      render();
      updateChrome();
      window.scrollTo({ top: 0, behavior: "auto" });
      if (push) setLocationState({ url: target.href, hash });
      addRecent(target.href);
      if (hash) scrollToHash(hash);

      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (token === state.token) {
        showLoadError(message);
        if (!quiet) toast(message, "error");
      }
      return { ok: false, error: message };
    } finally {
      if (token === state.token) setBusy(false);
    }
  }

  async function loadLocalFile(file) {
    if (!file) return;
    if (!MD_FILE.test(file.name)) {
      toast("That does not look like a Markdown file. Pick a .md or .txt file.", "error");
      return;
    }

    const token = ++state.token;
    setBusy(true);
    try {
      const text = await file.text();
      if (token !== state.token) return;

      stopPolling();
      state.path = null;
      state.url = null;
      state.dir = null;
      state.baseUrl = null;
      state.name = file.name;
      state.content = text;
      state.mtime = 0;

      render();
      updateChrome();
      window.scrollTo({ top: 0, behavior: "auto" });
      setLocationState({ replace: true });

      if (/!\[[^\]]*\]\((?!https?:|data:|\/|#)/i.test(text)) {
        toast(
          "Relative images cannot be resolved for a picked file. Open it by path to load them.",
          "info",
        );
      }
    } catch {
      toast("Could not read that file.", "error");
    } finally {
      if (token === state.token) setBusy(false);
    }
  }

  async function loadDemo() {
    const token = ++state.token;
    setBusy(true);
    try {
      const response = await fetch("samples/demo.md", { cache: "no-store" });
      if (!response.ok) throw new Error("Demo file not found.");
      const text = await response.text();
      if (token !== state.token) return;

      stopPolling();
      state.path = null;
      state.url = null;
      state.dir = null;
      state.baseUrl = new URL("samples/", window.location.href).href;
      state.name = "demo.md";
      state.content = text;
      state.mtime = 0;

      render();
      updateChrome();
      window.scrollTo({ top: 0, behavior: "auto" });
      setLocationState({ replace: true });
    } catch {
      toast(
        window.location.protocol === "file:"
          ? "Run `npm run dev` to view the demo, or open a file from disk."
          : "Could not load the demo file.",
        "error",
      );
    } finally {
      if (token === state.token) setBusy(false);
    }
  }

  function resetToEmpty() {
    state.token += 1;
    stopPolling();
    state.path = null;
    state.url = null;
    state.dir = null;
    state.baseUrl = null;
    state.name = null;
    state.content = "";
    state.mtime = 0;
    state.headings = [];
    state.activeId = null;

    els.preview.replaceChildren();
    els.toc.replaceChildren();
    els.tocDrawerBody.replaceChildren();
    els.docMeta.textContent = "";
    els.progress.style.width = "0%";
    showLoadError("");
    updateChrome();
  }

  /* ------------------------------------------------------------------ */
  /* Live reload (files opened through the server)                       */
  /* ------------------------------------------------------------------ */

  function stopPolling() {
    if (state.poll) {
      clearInterval(state.poll);
      state.poll = null;
    }
  }

  function startPolling() {
    stopPolling();
    if (!state.path) return;

    state.poll = setInterval(async () => {
      if (!state.path || document.hidden) return;
      const watched = state.path;

      try {
        const response = await fetch(`api/stat?path=${encodeURIComponent(watched)}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = await response.json();
        if (watched !== state.path) return;

        if (Number(data.mtime) !== Number(state.mtime)) {
          const scroll = window.scrollY;
          const result = await loadPath(watched, {
            push: false,
            quiet: true,
            preserveScroll: scroll,
          });
          if (!result.ok) stopPolling();
        }
      } catch {
        /* server went away; try again next tick */
      }
    }, 1500);
  }

  /* ------------------------------------------------------------------ */
  /* Drawer / dialog                                                     */
  /* ------------------------------------------------------------------ */

  function openDrawer() {
    els.tocDrawer.hidden = false;
    document.body.classList.add("overflow-hidden");
    els.btnTocClose.focus();
  }

  function closeDrawer() {
    els.tocDrawer.hidden = true;
    document.body.classList.remove("overflow-hidden");
  }

  function openPathDialog(prefill = "") {
    closeDrawer();
    if (typeof els.pathDialog.showModal !== "function") {
      const answer = window.prompt("Path to a Markdown file", prefill || state.path || "");
      if (answer) loadPath(answer);
      return;
    }
    if (els.pathDialog.open) {
      els.pathInput.focus();
      return;
    }

    els.pathInput.value = prefill || state.path || state.url || "";
    showPathError("");
    els.pathDialog.showModal();
    requestAnimationFrame(() => {
      els.pathInput.focus();
      els.pathInput.select();
    });
  }

  function closePathDialog() {
    if (els.pathDialog.open) els.pathDialog.close();
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    const pickFile = () => els.fileInput.click();

    els.btnOpen.addEventListener("click", pickFile);
    els.btnEmptyChoose.addEventListener("click", pickFile);
    els.fileInput.addEventListener("change", () => {
      const file = els.fileInput.files && els.fileInput.files[0];
      els.fileInput.value = "";
      if (file) loadLocalFile(file);
    });

    els.btnOpenPath.addEventListener("click", () => openPathDialog());
    els.btnEmptyPath.addEventListener("click", () => openPathDialog());
    els.btnEmptyDemo.addEventListener("click", loadDemo);
    els.btnPathClose.addEventListener("click", closePathDialog);

    els.pathDialog.addEventListener("click", (event) => {
      if (event.target === els.pathDialog) closePathDialog();
    });

    els.pathForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const value = els.pathInput.value.trim();
      if (!value) {
        showPathError("Enter a file path first.");
        els.pathInput.focus();
        return;
      }

      showPathError("");
      els.pathInput.disabled = true;
      els.pathSubmit.disabled = true;
      const isUrl = /^https?:\/\//i.test(value);
      const result =
        state.static || isUrl
          ? await loadFromUrl(value, { quiet: true })
          : await loadPath(value, { quiet: true });
      els.pathInput.disabled = false;
      els.pathSubmit.disabled = false;

      if (result.ok) {
        closePathDialog();
      } else {
        showPathError(result.error);
      }
    });

    els.btnTheme.addEventListener("click", toggleTheme);
    els.btnWidth.addEventListener("click", toggleWidth);
    els.btnPrint.addEventListener("click", () => window.print());
    els.btnToc.addEventListener("click", openDrawer);
    els.btnTocClose.addEventListener("click", closeDrawer);
    els.btnTocBackdrop.addEventListener("click", closeDrawer);

    // Recent files + table of contents (delegated because content is rebuilt).
    document.addEventListener("click", (event) => {
      const recent = event.target.closest("[data-recent]");
      if (recent) {
        const value = recent.dataset.recent;
        if (value) {
          closePathDialog();
          if (/^https?:\/\//i.test(value)) loadFromUrl(value);
          else loadPath(value);
        }
        return;
      }

      const tocLink = event.target.closest("[data-toc-id]");
      if (tocLink) {
        event.preventDefault();
        const id = tocLink.dataset.tocId;
        const target = document.getElementById(id);
        if (target) {
          target.scrollIntoView({
            block: "start",
            behavior: prefersReducedMotion() ? "auto" : "smooth",
          });
          history.replaceState(null, "", `#${encodeURIComponent(id)}`);
        }
        closeDrawer();
      }
    });

    els.preview.addEventListener("click", (event) => {
      const fileLink = event.target.closest("a[data-md-path]");
      if (fileLink) {
        event.preventDefault();
        loadPath(fileLink.dataset.mdPath, { hash: fileLink.hash || "" });
        return;
      }

      const urlLink = event.target.closest("a[data-md-url]");
      if (urlLink) {
        event.preventDefault();
        loadFromUrl(urlLink.dataset.mdUrl, { hash: urlLink.hash || "" });
      }
    });

    // Theme changes while the OS preference is in charge.
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (!storedTheme()) syncTheme();
    });

    // Scroll spy + reading progress.
    let scheduled = false;
    const onScroll = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        updateProgress();
        updateActiveHeading();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    window.addEventListener("popstate", () => {
      const params = new URLSearchParams(window.location.search);
      const remote = params.get("url");
      const file = params.get("file");
      if (remote) loadFromUrl(remote, { push: false, hash: window.location.hash });
      else if (file && !state.static) loadPath(file, { push: false, hash: window.location.hash });
      else resetToEmpty();
    });

    window.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.path && !state.poll) startPolling();
    });

    // Keyboard shortcuts.
    document.addEventListener("keydown", (event) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "o") {
        event.preventDefault();
        pickFile();
      } else if (mod && key === "k") {
        event.preventDefault();
        openPathDialog();
      } else if (event.key === "Escape") {
        closeDrawer();
      }
    });

    // Drag and drop.
    let dragDepth = 0;
    const hasFiles = (event) =>
      Boolean(event.dataTransfer) &&
      Array.from(event.dataTransfer.types || []).includes("Files");

    window.addEventListener("dragenter", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      els.dropOverlay.hidden = false;
    });

    window.addEventListener("dragover", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });

    window.addEventListener("dragleave", (event) => {
      if (!hasFiles(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) els.dropOverlay.hidden = true;
    });

    window.addEventListener("drop", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth = 0;
      els.dropOverlay.hidden = true;
      const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
      const file = files.find((item) => MD_FILE.test(item.name)) || files[0];
      if (file) loadLocalFile(file);
      else toast("Drop a Markdown file to render it.", "info");
    });
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */

  /** Decide whether the page is running with the local dev server or on a static host. */
  async function detectMode() {
    if (window.location.protocol === "file:") {
      state.static = true;
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch("api/health", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        state.static = true;
        return;
      }
      const data = await response.json();
      state.static = !(data && data.app === "markdown-render");
    } catch {
      state.static = true;
    } finally {
      clearTimeout(timer);
    }
  }

  function applyModeUi() {
    state.recentKey = state.static ? "mdrender:recent:url" : "mdrender:recent:path";
    renderRecents();

    if (!state.static) {
      els.localTip.hidden = false;
      return;
    }

    els.btnOpenPath.title = "Load Markdown from a URL (Ctrl+K)";
    els.btnOpenPath.setAttribute("aria-label", "Load Markdown from a URL");
    els.btnEmptyPath.textContent = "Load from URL…";
    els.pathDialogTitle.textContent = "Load Markdown from a URL";
    els.pathDialogDesc.textContent =
      "Paste a raw Markdown URL. The file is fetched directly by your browser.";
    els.pathLabel.textContent = "Markdown URL";
    els.pathInput.placeholder = "https://raw.githubusercontent.com/user/repo/main/README.md";
    els.pathSubmit.textContent = "Load";
    els.pathNote.textContent =
      "Cross-origin loading depends on the host's CORS policy; raw GitHub URLs work. Nothing is uploaded.";
    els.recentLabel.textContent = "Recent URLs";
    els.staticNote.hidden = window.location.protocol === "file:";
  }

  async function init() {
    syncTheme();
    syncWidth();
    bindEvents();
    await detectMode();
    applyModeUi();

    if (window.location.protocol === "file:") {
      els.serverNote.hidden = false;
    }

    const params = new URLSearchParams(window.location.search);
    const remote = params.get("url");
    const file = params.get("file");

    if (remote) {
      await loadFromUrl(remote, { push: false, hash: window.location.hash });
    } else if (file) {
      if (state.static) {
        const message =
          "Path loading needs the local server. Open a file from your device, or load a Markdown URL.";
        showLoadError(message);
        toast(message, "error");
        updateChrome();
      } else {
        await loadPath(file, { push: false, hash: window.location.hash });
      }
    } else {
      updateChrome();
      updateProgress();
    }
  }

  if (typeof marked === "undefined" || typeof DOMPurify === "undefined") {
    const message =
      "The Markdown libraries failed to load. Make sure the `vendor/` folder is present, then reload.";
    if (els.loadError && els.loadErrorText) {
      els.loadErrorText.textContent = message;
      els.loadError.hidden = false;
    }
    return;
  }

  init().catch((error) => {
    console.error(error);
    toast("Could not start the app. Check the browser console for details.", "error");
  });
})();

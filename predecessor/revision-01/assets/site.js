(function () {
  "use strict";

  const root = document.documentElement;
  const base = root.dataset.base || ".";

  function getPath(object, path) {
    return path.split(".").reduce((value, key) => value == null ? undefined : value[key], object);
  }

  function writeBindings(state) {
    document.querySelectorAll("[data-bind]").forEach((node) => {
      const value = getPath(state, node.dataset.bind);
      if (value !== undefined && value !== null) node.textContent = String(value);
    });
  }

  function failClosed(message) {
    root.style.setProperty("--aperture", "0%");
    document.querySelectorAll("[data-present-action]").forEach((button) => {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
    });
    const status = document.querySelector("[data-state-message]");
    if (status) status.textContent = message || "State unavailable. Gate remains closed.";
  }

  async function loadFieldState() {
    if (!document.querySelector("[data-field-state]")) return;
    try {
      const response = await fetch(`${base}/data/CURRENT_FIELD_STATE_002.json`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const state = await response.json();
      writeBindings(state);
      const open = state.gate && state.gate.disposition === "OPEN";
      const available = Number(state.capacity && state.capacity.available_for_admission) > 0;
      const endpoint = Boolean(state.interface && state.interface.presentation_endpoint);
      const aperture = open && available ? 42 : 0;
      root.style.setProperty("--aperture", `${aperture}%`);
      document.querySelectorAll("[data-present-action]").forEach((button) => {
        const enabled = open && available && endpoint;
        button.disabled = !enabled;
        button.setAttribute("aria-disabled", String(!enabled));
        if (enabled) button.dataset.endpoint = state.interface.presentation_endpoint;
      });
      const status = document.querySelector("[data-state-message]");
      if (status) status.textContent = open && available ? "Capacity is available; presentation endpoint governs the next motion." : state.gate.reason;
    } catch (error) {
      failClosed("State could not be verified. Gate remains closed.");
    }
  }

  function setupReveal() {
    const nodes = document.querySelectorAll("[data-reveal]");
    if (!nodes.length) return;
    if (!("IntersectionObserver" in window)) {
      nodes.forEach((node) => node.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8%", threshold: .08 });
    nodes.forEach((node) => observer.observe(node));
  }

  function setupCopy() {
    document.querySelectorAll("[data-copy]").forEach((button) => {
      button.addEventListener("click", async () => {
        const selector = button.dataset.copy;
        const target = document.querySelector(selector);
        if (!target) return;
        try {
          await navigator.clipboard.writeText(target.textContent.trim());
          const prior = button.textContent;
          button.textContent = "Copied";
          setTimeout(() => { button.textContent = prior; }, 1200);
        } catch (_) {
          target.scrollIntoView({ block: "center" });
        }
      });
    });
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  function inlineMarkdown(value) {
    let text = escapeHtml(value);
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
    return text;
  }

  function isTableDivider(line) {
    return /^\s*\|?\s*:?-{3,}/.test(line) && line.includes("|");
  }

  function cells(line) {
    return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  }

  function renderMarkdown(markdown) {
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let paragraph = [];
    let list = null;
    let code = null;

    const flushParagraph = () => {
      if (paragraph.length) out.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (list) out.push(`</${list}>`);
      list = null;
    };

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (code !== null) {
        if (/^```/.test(line)) {
          out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
          code = null;
        } else code.push(line);
        continue;
      }
      if (/^```/.test(line)) {
        flushParagraph(); closeList(); code = [];
        continue;
      }
      const heading = line.match(/^(#{2,4})\s+(.+)$/);
      if (heading) {
        flushParagraph(); closeList();
        const level = Math.min(4, heading[1].length);
        const id = heading[2].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        out.push(`<h${level} id="${id}">${inlineMarkdown(heading[2])}</h${level}>`);
        continue;
      }
      if (line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
        flushParagraph(); closeList();
        const headers = cells(line);
        const rows = [];
        index += 2;
        while (index < lines.length && lines[index].includes("|")) {
          rows.push(cells(lines[index]));
          index += 1;
        }
        index -= 1;
        out.push(`<table><thead><tr>${headers.map((item) => `<th>${inlineMarkdown(item)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((item) => `<td>${inlineMarkdown(item)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
        continue;
      }
      const item = line.match(/^\s*(?:([-*])|(\d+)\.)\s+(.+)$/);
      if (item) {
        flushParagraph();
        const nextList = item[2] ? "ol" : "ul";
        if (list !== nextList) { closeList(); list = nextList; out.push(`<${list}>`); }
        out.push(`<li>${inlineMarkdown(item[3])}</li>`);
        continue;
      }
      if (line.startsWith("> ")) {
        flushParagraph(); closeList(); out.push(`<blockquote>${inlineMarkdown(line.slice(2))}</blockquote>`);
        continue;
      }
      if (/^---+$/.test(line.trim())) {
        flushParagraph(); closeList(); out.push("<hr>");
        continue;
      }
      if (!line.trim()) { flushParagraph(); closeList(); continue; }
      paragraph.push(line.trim());
    }
    flushParagraph(); closeList();
    if (code !== null) out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    return out.join("\n");
  }

  async function loadConstitution() {
    const viewer = document.querySelector("[data-constitution-viewer]");
    if (!viewer) return;
    try {
      const response = await fetch(viewer.dataset.constitutionViewer, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const markdown = await response.text();
      viewer.innerHTML = renderMarkdown(markdown);
    } catch (_) {
      viewer.innerHTML = '<p class="notice">The canonical human Form could not be loaded. Use the direct artifact link above.</p>';
    }
  }

  async function sha256(fileOrBuffer) {
    const buffer = fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : await fileOrBuffer.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function setupFileVerifier() {
    const input = document.querySelector("[data-verify-file]");
    const result = document.querySelector("[data-verify-result]");
    if (!input || !result || !window.crypto || !crypto.subtle) return;
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      result.className = "verify-result";
      result.textContent = "Computing SHA-256…";
      const digest = await sha256(file);
      result.textContent = `${file.name}  ${digest}`;
      const expected = input.dataset.expected;
      if (expected) {
        const pass = digest === expected;
        result.classList.add(pass ? "pass" : "fail");
        result.textContent += pass ? "  MATCH" : "  DOES NOT MATCH";
      }
    });
  }

  async function verifySurface() {
    const button = document.querySelector("[data-verify-surface]");
    const result = document.querySelector("[data-surface-result]");
    if (!button || !result || !window.crypto || !crypto.subtle) return;
    button.addEventListener("click", async () => {
      button.disabled = true;
      result.className = "verify-result";
      result.textContent = "Loading public manifest…";
      try {
        const response = await fetch(`${base}/artifacts/surface/SURFACE_MANIFEST_002.json`, { cache: "no-store" });
        if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
        const manifest = await response.json();
        let passed = 0;
        for (const entry of manifest.files) {
          result.textContent = `Verifying ${passed + 1}/${manifest.files.length}: ${entry.path}`;
          const fileResponse = await fetch(`${base}/${entry.path}`, { cache: "no-store" });
          if (!fileResponse.ok) throw new Error(`${entry.path}: HTTP ${fileResponse.status}`);
          const digest = await sha256(await fileResponse.arrayBuffer());
          if (digest !== entry.sha256) throw new Error(`${entry.path}: digest mismatch`);
          passed += 1;
        }
        result.classList.add("pass");
        result.textContent = `PASS — ${passed}/${manifest.files.length} public artifacts match the manifest.`;
      } catch (error) {
        result.classList.add("fail");
        result.textContent = `FAIL — ${error.message}`;
      } finally {
        button.disabled = false;
      }
    });
  }

  document.querySelectorAll("[data-present-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const endpoint = button.dataset.endpoint;
      if (endpoint) window.location.assign(endpoint);
    });
  });

  document.querySelectorAll("[data-utc-now]").forEach((node) => {
    node.textContent = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  });

  loadFieldState();
  setupReveal();
  setupCopy();
  loadConstitution();
  setupFileVerifier();
  verifySurface();
}());

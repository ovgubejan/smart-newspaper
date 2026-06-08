export class Chatbot {
  constructor({ getToken }) {
    this.getToken = getToken;
    this.history = [];
    this.isOpen = false;
    this.isLoading = false;
    this.suggestionsLoaded = false;
    this.buildDOM();
    this.bindEvents();
  }

  buildDOM() {
    this.fab = document.createElement("button");
    this.fab.className = "chatbot-fab";
    this.fab.type = "button";
    this.fab.setAttribute("aria-label", "AI Asistan");
    this.fab.innerHTML = `<i class="fa-solid fa-robot"></i><i class="fa-solid fa-xmark"></i><span class="chatbot-fab-badge"></span>`;

    this.panel = document.createElement("div");
    this.panel.className = "chatbot-panel";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-label", "SmartNewspaper AI Asistan");
    this.panel.innerHTML = `
      <div class="chatbot-header">
        <div class="chatbot-header-avatar"><i class="fa-solid fa-robot"></i></div>
        <div class="chatbot-header-info">
          <strong>SmartNewspaper AI</strong>
          <small>Haber asistanın her zaman hazır</small>
        </div>
        <button class="chatbot-header-close" type="button" aria-label="Sohbeti kapat"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="chatbot-messages" id="chatbot-messages">
        <div class="chatbot-msg chatbot-msg-bot">
          <p>Merhaba! Ben SmartNewspaper AI Asistanıyım.</p>
          <p>Sana haberler, gündem, ekonomi veya platform hakkında yardımcı olabilirim. Aşağıdaki sorulardan birini seçebilir ya da kendi sorunu yazabilirsin.</p>
        </div>
        <div class="chatbot-typing" id="chatbot-typing">
          <span class="chatbot-typing-dot"></span>
          <span class="chatbot-typing-dot"></span>
          <span class="chatbot-typing-dot"></span>
        </div>
      </div>
      <div class="chatbot-suggestions" id="chatbot-suggestions"></div>
      <div class="chatbot-input-area">
        <input class="chatbot-input" id="chatbot-input" type="text" placeholder="Bir soru sor..." autocomplete="off" />
        <button class="chatbot-send-btn" id="chatbot-send" type="button" aria-label="Gönder"><i class="fa-solid fa-paper-plane"></i></button>
      </div>
    `;

    document.body.appendChild(this.panel);
    document.body.appendChild(this.fab);

    this.messagesEl = this.panel.querySelector("#chatbot-messages");
    this.typingEl = this.panel.querySelector("#chatbot-typing");
    this.suggestionsEl = this.panel.querySelector("#chatbot-suggestions");
    this.inputEl = this.panel.querySelector("#chatbot-input");
    this.sendBtn = this.panel.querySelector("#chatbot-send");
  }

  bindEvents() {
    this.fab.addEventListener("click", () => this.toggle());
    this.panel.querySelector(".chatbot-header-close").addEventListener("click", () => this.close());
    this.sendBtn.addEventListener("click", () => this.send());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.close();
    });
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this.isOpen = true;
    this.fab.classList.add("open");
    this.fab.classList.remove("has-unread");
    this.panel.classList.add("open");
    this.inputEl.focus();
    if (!this.suggestionsLoaded) this.loadSuggestions();
  }

  close() {
    this.isOpen = false;
    this.fab.classList.remove("open");
    this.panel.classList.remove("open");
  }

  async loadSuggestions() {
    this.suggestionsLoaded = true;
    try {
      const res = await fetch("/api/chat/suggestions", {
        headers: this.authHeaders()
      });
      const data = await res.json();
      if (Array.isArray(data.suggestions)) {
        this.renderSuggestions(data.suggestions);
      }
    } catch {
      this.renderSuggestions([
        { icon: "fa-newspaper", text: "Bugünün en önemli haberleri neler?" },
        { icon: "fa-chart-line", text: "Ekonomide son durum ne?" },
        { icon: "fa-globe", text: "Dünyada neler oluyor?" },
        { icon: "fa-circle-info", text: "SmartNewspaper nasıl kullanılır?" },
      ]);
    }
  }

  renderSuggestions(suggestions) {
    this.suggestionsEl.innerHTML = "";
    suggestions.forEach((s) => {
      const btn = document.createElement("button");
      btn.className = "chatbot-suggestion-btn";
      btn.type = "button";
      btn.innerHTML = `<i class="fa-solid ${s.icon}"></i><span>${this.escapeHtml(s.text)}</span>`;
      btn.addEventListener("click", () => {
        this.inputEl.value = s.text;
        this.send();
      });
      this.suggestionsEl.appendChild(btn);
    });
  }

  async send() {
    const text = this.inputEl.value.trim();
    if (!text || this.isLoading) return;

    this.inputEl.value = "";
    this.addMessage("user", text);
    this.history.push({ role: "user", content: text });
    this.suggestionsEl.innerHTML = "";
    this.isLoading = true;
    this.sendBtn.disabled = true;
    this.typingEl.classList.add("visible");
    this.scrollToBottom();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders()
        },
        body: JSON.stringify({
          message: text,
          history: this.history.slice(-10)
        })
      });
      const data = await res.json();
      if (data.error) {
        this.addMessage("bot", data.error);
      } else {
        const reply = data.reply || "Yanıt alınamadı.";
        this.addMessage("bot", reply, true);
        this.history.push({ role: "assistant", content: reply });
      }
    } catch (err) {
      this.addMessage("bot", "Bağlantı hatası oluştu. Lütfen tekrar deneyin.");
    } finally {
      this.isLoading = false;
      this.sendBtn.disabled = false;
      this.typingEl.classList.remove("visible");
      this.scrollToBottom();
    }
  }

  addMessage(role, text, parseMarkdown = false) {
    const div = document.createElement("div");
    div.className = `chatbot-msg chatbot-msg-${role === "user" ? "user" : "bot"}`;

    if (role === "bot" && parseMarkdown) {
      div.innerHTML = this.renderMarkdown(text);
    } else {
      div.textContent = text;
    }

    this.messagesEl.insertBefore(div, this.typingEl);
    this.scrollToBottom();
  }

  renderMarkdown(text) {
    let html = this.escapeHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/`(.+?)`/g, "<code>$1</code>");
    html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    const lines = html.split("\n");
    let result = "";
    let inList = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
        if (!inList) { result += "<ul>"; inList = true; }
        result += `<li>${trimmed.slice(2)}</li>`;
      } else if (/^\d+\.\s/.test(trimmed)) {
        if (!inList) { result += "<ol>"; inList = true; }
        result += `<li>${trimmed.replace(/^\d+\.\s/, "")}</li>`;
      } else {
        if (inList) { result += inList ? "</ul>" : "</ol>"; inList = false; }
        if (trimmed) result += `<p>${trimmed}</p>`;
      }
    }
    if (inList) result += "</ul>";
    return result || `<p>${html}</p>`;
  }

  escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  scrollToBottom() {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }

  authHeaders() {
    const token = this.getToken?.();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
}

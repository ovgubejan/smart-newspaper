import { escapeHtml } from "../utils/textUtils.js";
import {
  getCalendarEvents,
  addCalendarEvent,
  removeCalendarEvent,
  setEventReminder,
  isEventInCalendar,
  findCalendarEntryByEventId
} from "../utils/calendarStore.js";
import { computeReminderAt } from "../utils/reminderManager.js";

let _showToast = () => {};

export function initCalendarPanel(showToastFn) {
  _showToast = showToastFn;
}

export async function renderCalendarPage(container) {
  if (!container) return;
  const events = await getCalendarEvents();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayKey = fmtDay(now);

  const eventsByDay = new Map();
  for (const ev of events) {
    const key = fmtDay(new Date(ev.eventDate));
    if (!eventsByDay.has(key)) eventsByDay.set(key, []);
    eventsByDay.get(key).push(ev);
  }

  const monthName = now.toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const dayCells = [];
  for (let i = 0; i < startOffset; i++) dayCells.push(`<span class="cal-day cal-day-empty"></span>`);
  for (let day = 1; day <= daysInMonth; day++) {
    const key = fmtDay(new Date(year, month, day));
    const isToday = key === todayKey;
    const hasEvents = eventsByDay.has(key);
    const evCount = hasEvents ? eventsByDay.get(key).length : 0;
    dayCells.push(`
      <button type="button" class="cal-day ${isToday ? "cal-day-today" : ""} ${hasEvents ? "cal-day-has-event" : ""}" data-cal-day="${key}">
        <span class="cal-day-num">${day}</span>
        ${hasEvents ? `<span class="cal-day-dot" title="${evCount} etkinlik"></span>` : ""}
      </button>
    `);
  }

  const upcoming = events
    .filter(ev => new Date(ev.eventDate) >= new Date(now.toDateString()))
    .sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate))
    .slice(0, 10);

  container.innerHTML = `
    <div class="my-calendar-page">
      <div class="my-calendar-header">
        <h2><i class="fa-regular fa-calendar-days"></i> Benim Takvimim</h2>
        <div class="my-calendar-view-tabs">
          <button class="cal-view-tab active" data-cal-view="month"><i class="fa-solid fa-calendar"></i> Aylık</button>
          <button class="cal-view-tab" data-cal-view="list"><i class="fa-solid fa-list"></i> Liste</button>
          <button class="cal-view-tab" data-cal-view="upcoming"><i class="fa-solid fa-clock"></i> Yaklaşan</button>
        </div>
      </div>

      <div class="my-calendar-body">
        <div class="cal-view-panel cal-month-view" data-cal-panel="month">
          <div class="cal-month-header">
            <h3>${escapeHtml(monthName)}</h3>
          </div>
          <div class="cal-weekday-row">
            ${["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map(d => `<span>${d}</span>`).join("")}
          </div>
          <div class="cal-grid">
            ${dayCells.join("")}
          </div>
          <div class="cal-day-detail" id="cal-day-detail"></div>
        </div>

        <div class="cal-view-panel cal-list-view" data-cal-panel="list" hidden>
          ${events.length ? events.sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate)).map(ev => renderCalEventCard(ev)).join("") : `<div class="cal-empty-state"><i class="fa-regular fa-calendar-xmark"></i><p>Henüz takvimine etkinlik eklemedin.</p></div>`}
        </div>

        <div class="cal-view-panel cal-upcoming-view" data-cal-panel="upcoming" hidden>
          <h3 class="cal-upcoming-title">Yaklaşan Etkinliklerim</h3>
          ${upcoming.length ? upcoming.map(ev => renderCalEventCard(ev)).join("") : `<div class="cal-empty-state"><i class="fa-regular fa-calendar-xmark"></i><p>Yaklaşan etkinlik bulunmuyor.</p></div>`}
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll(".cal-view-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".cal-view-tab").forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.calView;
      container.querySelectorAll(".cal-view-panel").forEach(p => {
        p.hidden = p.dataset.calPanel !== view;
      });
    });
  });

  container.querySelectorAll(".cal-day[data-cal-day]").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".cal-day").forEach(d => d.classList.remove("cal-day-selected"));
      btn.classList.add("cal-day-selected");
      const key = btn.dataset.calDay;
      const dayEvents = eventsByDay.get(key) || [];
      const detail = container.querySelector("#cal-day-detail");
      if (detail) {
        detail.innerHTML = dayEvents.length
          ? `<div class="cal-day-detail-list">${dayEvents.map(ev => renderCalEventCard(ev)).join("")}</div>`
          : `<p class="cal-day-detail-empty">Bu gün için etkinlik yok.</p>`;
      }
    });
  });

  container.querySelectorAll("[data-cal-remove]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.calRemove;
      await removeCalendarEvent(id);
      _showToast("Etkinlik takvimden kaldırıldı.", "info");
      renderCalendarPage(container);
    });
  });
}

function renderCalEventCard(ev) {
  const d = new Date(ev.eventDate);
  const dateStr = isNaN(d.getTime()) ? "" : d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return `
    <div class="cal-event-card">
      <div class="cal-event-card-left">
        ${ev.image ? `<img src="${escapeHtml(ev.image)}" alt="" class="cal-event-thumb">` : `<div class="cal-event-thumb-placeholder"><i class="fa-regular fa-calendar-check"></i></div>`}
      </div>
      <div class="cal-event-card-body">
        <div class="cal-event-card-top">
          <span class="cal-event-category">${escapeHtml(ev.category || "Etkinlik")}</span>
          ${ev.reminderEnabled ? `<span class="cal-event-reminder-badge" title="Hatırlatıcı aktif"><i class="fa-solid fa-bell"></i></span>` : ""}
        </div>
        <h4 class="cal-event-title">${escapeHtml(ev.title)}</h4>
        <div class="cal-event-meta">
          <span><i class="fa-regular fa-calendar"></i> ${escapeHtml(dateStr)}</span>
          ${ev.location ? `<span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(ev.location)}</span>` : ""}
        </div>
        ${ev.userNote ? `<p class="cal-event-note"><i class="fa-regular fa-note-sticky"></i> ${escapeHtml(ev.userNote)}</p>` : ""}
        <div class="cal-event-actions">
          ${ev.url ? `<a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener" class="cal-event-action-btn"><i class="fa-solid fa-arrow-up-right-from-square"></i> Detay</a>` : ""}
          <button type="button" class="cal-event-action-btn cal-event-remove-btn" data-cal-remove="${escapeHtml(ev.id)}"><i class="fa-solid fa-trash-can"></i> Kaldır</button>
        </div>
      </div>
    </div>
  `;
}

function fmtDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function showAddToCalendarModal(eventData, onDone) {
  const existing = document.getElementById("cal-add-modal-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "cal-add-modal-overlay";
  overlay.className = "cal-modal-overlay";
  overlay.innerHTML = `
    <div class="cal-modal">
      <div class="cal-modal-header">
        <h3><i class="fa-regular fa-calendar-plus"></i> Takvime Ekle</h3>
        <button type="button" class="cal-modal-close" aria-label="Kapat"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="cal-modal-body">
        <div class="cal-modal-event-preview">
          <h4>${escapeHtml(eventData.title || "")}</h4>
          <p>${escapeHtml(eventData.displayDate || eventData.date || "")}</p>
          ${eventData.venue ? `<p><i class="fa-solid fa-location-dot"></i> ${escapeHtml(eventData.venue)}${eventData.city ? ", " + escapeHtml(eventData.city) : ""}</p>` : ""}
        </div>
        <div class="cal-modal-field">
          <label for="cal-modal-reminder">Hatırlatıcı</label>
          <select id="cal-modal-reminder" class="cal-modal-select">
            <option value="">Hatırlatıcı yok</option>
            <option value="at_time">Etkinlik anında</option>
            <option value="15min" selected>15 dakika önce</option>
            <option value="1hour">1 saat önce</option>
            <option value="1day">1 gün önce</option>
            <option value="custom">Özel tarih/saat</option>
          </select>
          <input type="datetime-local" id="cal-modal-custom-time" class="cal-modal-input" hidden>
        </div>
        <div class="cal-modal-field">
          <label for="cal-modal-note">Not (isteğe bağlı)</label>
          <input type="text" id="cal-modal-note" class="cal-modal-input" placeholder="Kısa not ekle..." maxlength="200">
        </div>
      </div>
      <div class="cal-modal-footer">
        <button type="button" class="cal-modal-btn cal-modal-btn-cancel">İptal</button>
        <button type="button" class="cal-modal-btn cal-modal-btn-save"><i class="fa-solid fa-check"></i> Kaydet</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const reminderSelect = overlay.querySelector("#cal-modal-reminder");
  const customTimeInput = overlay.querySelector("#cal-modal-custom-time");
  reminderSelect.addEventListener("change", () => {
    customTimeInput.hidden = reminderSelect.value !== "custom";
  });

  const close = () => overlay.remove();
  overlay.querySelector(".cal-modal-close").addEventListener("click", close);
  overlay.querySelector(".cal-modal-btn-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  overlay.querySelector(".cal-modal-btn-save").addEventListener("click", async () => {
    const reminderOption = reminderSelect.value;
    const eventDate = eventData.date || eventData.eventDate || new Date().toISOString();
    let reminderAt = null;
    if (reminderOption === "custom") {
      reminderAt = customTimeInput.value ? new Date(customTimeInput.value).toISOString() : null;
    } else if (reminderOption) {
      reminderAt = computeReminderAt(eventDate, reminderOption);
    }
    const note = overlay.querySelector("#cal-modal-note").value.trim();

    await addCalendarEvent({
      ...eventData,
      eventId: eventData.id,
      userNote: note,
      reminderAt
    });

    close();
    _showToast("Etkinlik takvimine eklendi.", "success");
    if (onDone) onDone();
  });
}

export { isEventInCalendar, findCalendarEntryByEventId };

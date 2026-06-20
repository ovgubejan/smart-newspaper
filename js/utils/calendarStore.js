const STORAGE_KEY = "smartNewspaper_calendarEvents";
const NOTIF_KEY = "smartNewspaper_calendarNotifications";

let _apiFunction = null;
let _usingApi = false;

export function initCalendarStore(apiFn, usingApi) {
  _apiFunction = apiFn;
  _usingApi = usingApi;
}

function readLocal(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); }
  catch { return []; }
}

function writeLocal(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function generateId() {
  return "cal_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function getCalendarEvents() {
  if (_usingApi && _apiFunction) {
    try {
      const res = await _apiFunction("/api/calendar/events");
      return res.events || [];
    } catch { /* fall through to local */ }
  }
  return readLocal(STORAGE_KEY);
}

export async function addCalendarEvent(eventData) {
  const entry = {
    id: generateId(),
    eventId: eventData.eventId || eventData.id,
    title: eventData.title || "",
    description: eventData.description || eventData.summary || "",
    location: eventData.venue ? `${eventData.venue}${eventData.city ? ", " + eventData.city : ""}` : (eventData.location || ""),
    eventDate: eventData.date || eventData.eventDate || new Date().toISOString(),
    eventTime: eventData.eventTime || "",
    source: eventData.sourceProvider || eventData.source || "",
    image: eventData.imageUrl || eventData.image || "",
    category: eventData.category || "",
    url: eventData.ticketUrl || eventData.url || "",
    userNote: eventData.userNote || "",
    reminderAt: eventData.reminderAt || null,
    reminderEnabled: Boolean(eventData.reminderAt),
    reminderSent: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (_usingApi && _apiFunction) {
    try {
      const res = await _apiFunction("/api/calendar/events", {
        method: "POST",
        body: JSON.stringify(entry)
      });
      return res.event || entry;
    } catch { /* fall through */ }
  }

  const events = readLocal(STORAGE_KEY);
  events.push(entry);
  writeLocal(STORAGE_KEY, events);
  return entry;
}

export async function removeCalendarEvent(calendarEventId) {
  if (_usingApi && _apiFunction) {
    try {
      await _apiFunction(`/api/calendar/events/${calendarEventId}`, { method: "DELETE" });
      return true;
    } catch { /* fall through */ }
  }
  const events = readLocal(STORAGE_KEY);
  writeLocal(STORAGE_KEY, events.filter(e => e.id !== calendarEventId));
  return true;
}

export async function updateCalendarEvent(calendarEventId, updates) {
  if (_usingApi && _apiFunction) {
    try {
      const res = await _apiFunction(`/api/calendar/events/${calendarEventId}`, {
        method: "PATCH",
        body: JSON.stringify(updates)
      });
      return res.event || null;
    } catch { /* fall through */ }
  }
  const events = readLocal(STORAGE_KEY);
  const idx = events.findIndex(e => e.id === calendarEventId);
  if (idx === -1) return null;
  events[idx] = { ...events[idx], ...updates, updatedAt: new Date().toISOString() };
  writeLocal(STORAGE_KEY, events);
  return events[idx];
}

export async function setEventReminder(calendarEventId, reminderAt) {
  return updateCalendarEvent(calendarEventId, {
    reminderAt,
    reminderEnabled: Boolean(reminderAt),
    reminderSent: false
  });
}

export async function isEventInCalendar(eventId) {
  const events = await getCalendarEvents();
  return events.some(e => e.eventId === eventId || e.eventId === String(eventId));
}

export async function findCalendarEntryByEventId(eventId) {
  const events = await getCalendarEvents();
  return events.find(e => e.eventId === eventId || e.eventId === String(eventId)) || null;
}

export function getCalendarNotifications() {
  return readLocal(NOTIF_KEY);
}

export function addCalendarNotification(notif) {
  const notifications = readLocal(NOTIF_KEY);
  notifications.unshift({
    id: "notif_" + Date.now().toString(36),
    type: "calendar_reminder",
    title: notif.title || "",
    message: notif.message || "",
    relatedEventId: notif.relatedEventId || "",
    read: false,
    createdAt: new Date().toISOString()
  });
  writeLocal(NOTIF_KEY, notifications.slice(0, 50));
}

export function markCalendarNotificationsRead() {
  const notifications = readLocal(NOTIF_KEY);
  notifications.forEach(n => n.read = true);
  writeLocal(NOTIF_KEY, notifications);
}

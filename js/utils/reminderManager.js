import {
  getCalendarEvents,
  updateCalendarEvent,
  addCalendarNotification
} from "./calendarStore.js";

let _intervalId = null;
let _onReminderDue = null;

export function initReminderManager(onReminderDue) {
  _onReminderDue = onReminderDue;
  if (_intervalId) clearInterval(_intervalId);
  _intervalId = setInterval(checkDueReminders, 60_000);
  checkDueReminders();
}

export function stopReminderManager() {
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
}

export async function checkDueReminders() {
  let events;
  try { events = await getCalendarEvents(); } catch { return; }
  const now = new Date();

  for (const event of events) {
    if (!event.reminderEnabled || event.reminderSent || !event.reminderAt) continue;
    const reminderTime = new Date(event.reminderAt);
    if (isNaN(reminderTime.getTime())) continue;
    if (reminderTime <= now) {
      await updateCalendarEvent(event.id, { reminderSent: true });

      const notif = {
        title: event.title,
        message: `Hatırlatıcı: "${event.title}" etkinliği yaklaşıyor!`,
        relatedEventId: event.id
      };
      addCalendarNotification(notif);
      sendBrowserNotification(notif);
      if (_onReminderDue) _onReminderDue(event, notif);
    }
  }
}

function sendBrowserNotification(notif) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    new Notification(notif.title, { body: notif.message, icon: "/favicon.ico" });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then(perm => {
      if (perm === "granted") {
        new Notification(notif.title, { body: notif.message, icon: "/favicon.ico" });
      }
    });
  }
}

export function computeReminderAt(eventDate, option) {
  const d = new Date(eventDate);
  if (isNaN(d.getTime())) return null;
  switch (option) {
    case "at_time": return d.toISOString();
    case "15min": return new Date(d.getTime() - 15 * 60_000).toISOString();
    case "1hour": return new Date(d.getTime() - 60 * 60_000).toISOString();
    case "1day": return new Date(d.getTime() - 24 * 60 * 60_000).toISOString();
    default:
      if (option && !isNaN(new Date(option).getTime())) return new Date(option).toISOString();
      return null;
  }
}

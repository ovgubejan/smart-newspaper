const WEATHER_ICONS = {
  "Clear": { icon: "fa-sun", label: "Güneşli", bg: "weather-clear" },
  "Clouds": { icon: "fa-cloud", label: "Bulutlu", bg: "weather-clouds" },
  "Rain": { icon: "fa-cloud-rain", label: "Yağmurlu", bg: "weather-rain" },
  "Drizzle": { icon: "fa-cloud-rain", label: "Çisenti", bg: "weather-rain" },
  "Thunderstorm": { icon: "fa-cloud-bolt", label: "Gök Gürültülü", bg: "weather-storm" },
  "Snow": { icon: "fa-snowflake", label: "Karlı", bg: "weather-snow" },
  "Mist": { icon: "fa-smog", label: "Sisli", bg: "weather-mist" },
  "Fog": { icon: "fa-smog", label: "Sisli", bg: "weather-mist" },
  "Haze": { icon: "fa-smog", label: "Puslu", bg: "weather-mist" },
  "Smoke": { icon: "fa-smog", label: "Dumanlı", bg: "weather-mist" },
};

const WEATHER_STORAGE_KEY = "smart_newspaper_weather";
const WEATHER_CITY_KEY = "smart_newspaper_weather_city";
const WEATHER_TTL = 30 * 60 * 1000;

function getWeatherMeta(main) {
  return WEATHER_ICONS[main] || { icon: "fa-cloud-sun", label: main || "Bilinmiyor", bg: "weather-clear" };
}

function escapeW(str) {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

export class WeatherWidget {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.state = "loading";
    this.data = null;
    this.city = localStorage.getItem(WEATHER_CITY_KEY) || null;
    this.apiKey = null;
  }

  setApiKey(key) {
    this.apiKey = key;
  }

  async init() {
    if (!this.container) return;
    this.renderLoading();
    const cached = this.readCache();
    if (cached) {
      this.data = cached;
      this.state = "ready";
      this.render();
      return;
    }
    await this.fetchWeather();
  }

  readCache() {
    try {
      const raw = localStorage.getItem(WEATHER_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts > WEATHER_TTL) return null;
      return parsed;
    } catch { return null; }
  }

  writeCache(data) {
    try {
      localStorage.setItem(WEATHER_STORAGE_KEY, JSON.stringify({ ...data, ts: Date.now() }));
    } catch {}
  }

  async fetchWeather() {
    try {
      let lat, lon, cityName;
      if (this.city) {
        const geo = await this.geocodeCity(this.city);
        if (geo) { lat = geo.lat; lon = geo.lon; cityName = geo.name; }
      }
      if (!lat && navigator.geolocation) {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
        );
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
      }
      if (!lat) {
        lat = 41.0082; lon = 28.9784; cityName = "İstanbul";
      }

      const API_BASE = window.location.protocol === "file:" ? "http://localhost:3000" : "";
      const resp = await fetch(`${API_BASE}/api/weather?lat=${lat}&lon=${lon}`);
      if (!resp.ok) throw new Error("Weather API error");
      const json = await resp.json();
      this.data = {
        city: cityName || json.city || json.name || "Bilinmiyor",
        temp: Math.round(json.temp ?? json.main?.temp ?? 0),
        feelsLike: Math.round(json.feelsLike ?? json.main?.feels_like ?? 0),
        tempMin: Math.round(json.tempMin ?? json.main?.temp_min ?? 0),
        tempMax: Math.round(json.tempMax ?? json.main?.temp_max ?? 0),
        humidity: json.humidity ?? json.main?.humidity ?? 0,
        wind: Math.round(json.wind ?? json.wind?.speed ?? 0),
        main: json.weatherMain ?? json.weather?.[0]?.main ?? "Clear",
        description: json.weatherDesc ?? json.weather?.[0]?.description ?? "",
        forecast: Array.isArray(json.forecast) ? json.forecast.slice(0, 3) : [],
      };
      this.writeCache(this.data);
      this.state = "ready";
      this.render();
    } catch (err) {
      console.warn("Weather fetch failed, using demo data", err);
      this.data = this.getDemoData();
      this.state = "ready";
      this.render();
    }
  }

  async geocodeCity(city) {
    try {
      const API_BASE = window.location.protocol === "file:" ? "http://localhost:3000" : "";
      const resp = await fetch(`${API_BASE}/api/weather/geocode?q=${encodeURIComponent(city)}`);
      if (!resp.ok) return null;
      const json = await resp.json();
      return json;
    } catch { return null; }
  }

  getDemoData() {
    const hour = new Date().getHours();
    return {
      city: this.city || "İstanbul",
      temp: hour < 10 ? 18 : hour < 16 ? 26 : 22,
      feelsLike: hour < 10 ? 17 : hour < 16 ? 28 : 21,
      tempMin: 16,
      tempMax: 28,
      humidity: 58,
      wind: 12,
      main: hour < 7 || hour > 20 ? "Clear" : "Clouds",
      description: hour < 7 || hour > 20 ? "açık gökyüzü" : "parçalı bulutlu",
      forecast: [
        { day: "Yarın", tempMax: 27, tempMin: 17, main: "Clear" },
        { day: "Perşembe", tempMax: 25, tempMin: 16, main: "Clouds" },
        { day: "Cuma", tempMax: 23, tempMin: 15, main: "Rain" },
      ],
    };
  }

  renderLoading() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="weather-widget weather-loading">
        <div class="weather-skeleton-row">
          <div class="weather-skeleton-circle"></div>
          <div class="weather-skeleton-lines">
            <div class="weather-skeleton-line w60"></div>
            <div class="weather-skeleton-line w40"></div>
          </div>
        </div>
      </div>
    `;
  }

  renderError() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="weather-widget weather-error">
        <i class="fa-solid fa-cloud-sun" aria-hidden="true"></i>
        <span>Hava durumu yüklenemedi</span>
        <button type="button" class="weather-retry-btn">Tekrar Dene</button>
      </div>
    `;
    this.container.querySelector(".weather-retry-btn")?.addEventListener("click", () => this.fetchWeather());
  }

  render() {
    if (!this.container) return;
    if (this.state === "error") { this.renderError(); return; }
    if (!this.data) { this.renderLoading(); return; }

    const d = this.data;
    const meta = getWeatherMeta(d.main);
    const forecastHtml = (d.forecast || []).map((f) => {
      const fm = getWeatherMeta(f.main);
      return `
        <div class="weather-forecast-day">
          <span class="weather-forecast-label">${escapeW(f.day)}</span>
          <i class="fa-solid ${fm.icon}" aria-hidden="true"></i>
          <span class="weather-forecast-temps">${f.tempMax}° / ${f.tempMin}°</span>
        </div>
      `;
    }).join("");

    this.container.innerHTML = `
      <div class="weather-widget ${meta.bg}">
        <div class="weather-main-row">
          <div class="weather-icon-block">
            <i class="fa-solid ${meta.icon}" aria-hidden="true"></i>
          </div>
          <div class="weather-info-block">
            <div class="weather-city-row">
              <span class="weather-city">${escapeW(d.city)}</span>
              <span class="weather-condition">${escapeW(meta.label)}</span>
            </div>
            <div class="weather-temp-row">
              <strong class="weather-temp">${d.temp}°</strong>
              <div class="weather-temp-detail">
                <span>Hissedilen ${d.feelsLike}°</span>
                <span>${d.tempMin}° / ${d.tempMax}°</span>
              </div>
            </div>
          </div>
        </div>
        <div class="weather-stats-row">
          <span><i class="fa-solid fa-droplet" aria-hidden="true"></i> %${d.humidity}</span>
          <span><i class="fa-solid fa-wind" aria-hidden="true"></i> ${d.wind} km/s</span>
        </div>
        ${forecastHtml ? `<div class="weather-forecast-row">${forecastHtml}</div>` : ""}
      </div>
    `;
  }

  setCity(city) {
    this.city = city;
    localStorage.setItem(WEATHER_CITY_KEY, city);
    localStorage.removeItem(WEATHER_STORAGE_KEY);
    this.fetchWeather();
  }
}

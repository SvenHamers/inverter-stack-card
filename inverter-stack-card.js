/**
 * inverter-stack-card — inverter / chargers and solar chargers for Home
 * Assistant, drawn as the devices themselves on a wall: a three-phase set side
 * by side, solar chargers next to them, each with a screen and the lights of
 * the real front panel. Every value comes from an entity you pick.
 *
 *   type: custom:inverter-stack-card
 *   name: Inverters
 *   inverters:
 *     - model: multiplus2          # multiplus2 | quattro | multi_rs
 *       phase: L1
 *       power: sensor.l1_ac_out_power
 *       state: sensor.vebus_state  # text, or the VE.Bus state number
 *   chargers:
 *     - model: mppt_small          # mppt_small | mppt_large
 *       power: sensor.pv_power
 *       state: sensor.mppt_state
 *       yield_today: sensor.mppt_yield_today
 *
 * Powers in W or kW. Click a device for its power entity's more-info dialog.
 */

(() => {
const VERSION = "0.1.0";
if (customElements.get("inverter-stack-card")) return;

const DEFAULTS = {
  name: "Inverters",
  size: "compact",          // "compact" or "large"
  entity_loads: "", entity_grid: "", entity_solar: "", entity_battery: "",
  inverters: [],
  chargers: [],
};

// Rough front size in mm, so the devices compare like the real ones.
const MODELS = {
  multiplus2: { label: "MultiPlus-II", w: 275, h: 506, kind: "inv" },
  quattro:    { label: "Quattro",      w: 488, h: 572, kind: "inv" },
  multi_rs:   { label: "Multi RS",     w: 425, h: 440, kind: "inv" },
  mppt_small: { label: "MPPT",         w: 130, h: 186, kind: "mppt" },
  mppt_large: { label: "MPPT",         w: 216, h: 295, kind: "mppt" },
};
const PHASE_CLR = { L1: "#a0612d", L2: "#555", L3: "#9e9e9e" };

// VE.Bus and solar charger state numbers (Victron Modbus / D-Bus).
const STATES = {
  0: "Off", 1: "Low power", 2: "Fault", 3: "Bulk", 4: "Absorption", 5: "Float", 6: "Storage", 7: "Equalize",
  8: "Passthru", 9: "Inverting", 10: "Power assist", 11: "Power supply", 244: "Sustain", 245: "Starting up",
  246: "Repeated absorption", 247: "Auto equalize", 248: "BatterySafe", 250: "Blocked", 252: "External control",
  256: "Discharging", 257: "Sustain", 258: "Recharge", 259: "Scheduled recharge",
};
const category = (t) => {
  const s = String(t || "").toLowerCase();
  if (!s) return "";
  if (/fault|error|overload|alarm|blocked/.test(s)) return "fault";
  if (/^off$|low power|standby/.test(s)) return "off";
  if (/invert|assist|discharg/.test(s)) return "inv";
  if (/pass|power supply/.test(s)) return "pass";
  if (/bulk|absorp|float|storage|equaliz|recharge|sustain|charg|starting|batterysafe/.test(s)) return "chg";
  return "";
};

const esc = (s) => (s === null || s === undefined ? "" : String(s).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c])));
const list = (v) => (Array.isArray(v) ? v : []).map((x) => x || {});
const fmt = (n, d = 0, signed = false) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const s = n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  return signed && n > 0 ? `+${s}` : s;
};
// [number, unit] for a power in W
const fmtW = (w, signed = false) => {
  if (w === null || !Number.isFinite(w)) return ["—", ""];
  return Math.abs(w) >= 10000 ? [fmt(w / 1000, 1, signed), "kW"] : [fmt(Math.round(w), 0, signed), "W"];
};

class InverterStackCard extends HTMLElement {
  static getStubConfig() {
    return {
      name: "Inverters",
      inverters: [{ model: "multiplus2", phase: "L1" }, { model: "multiplus2", phase: "L2" }, { model: "multiplus2", phase: "L3" }],
      chargers: [{ model: "mppt_small" }],
    };
  }
  static getConfigElement() { return document.createElement("inverter-stack-card-editor"); }

  setConfig(config) {
    if (!config) throw new Error("Configuration required");
    this._config = { ...DEFAULTS, ...config, inverters: list(config.inverters), chargers: list(config.chargers) };
    if (!this.shadowRoot) this._setup();
    this._build();
    this._queue();
  }

  set hass(hass) { this._hass = hass; this._queue(); }

  connectedCallback() {
    if (this._wall && !this._ro) { this._ro = new ResizeObserver(() => this._scale()); this._ro.observe(this._wall); }
  }
  disconnectedCallback() { if (this._ro) { this._ro.disconnect(); this._ro = null; } }

  getCardSize() { return this._config && this._config.size === "large" ? 8 : 5; }

  _queue() {
    if (this._raf) return;
    this._raf = true;
    requestAnimationFrame(() => { this._raf = false; this._render(); });
  }

  _setup() {
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${CSS}</style><ha-card><div class="head"></div><div class="flow"></div><div class="wall"></div></ha-card>`;
    this._head = this.shadowRoot.querySelector(".head");
    this._flow = this.shadowRoot.querySelector(".flow");
    this._wall = this.shadowRoot.querySelector(".wall");
    this.shadowRoot.querySelector("ha-card").addEventListener("click", (e) => {
      const t = e.composedPath().find((n) => n.dataset && n.dataset.entity);
      if (!t) return;
      const ev = new Event("hass-more-info", { bubbles: true, composed: true });
      ev.detail = { entityId: t.dataset.entity };
      this.dispatchEvent(ev);
    });
    this.connectedCallback();
  }

  // Devices are created once per config; updates only swap their contents.
  _build() {
    const c = this._config;
    const dev = (d, kind, i) => {
      const m = MODELS[d.model] || MODELS[kind === "inv" ? "multiplus2" : "mppt_small"];
      const key = MODELS[d.model] ? d.model : kind === "inv" ? "multiplus2" : "mppt_small";
      const ent = d.power || d.state;
      return `<div class="dev ${key}" data-kind="${kind}" data-i="${i}" style="--mmw:${m.w};--mmh:${m.h}" ${ent ? `data-entity="${esc(ent)}" role="button"` : ""}></div>`;
    };
    const phases = [...new Set(c.inverters.map((d) => d.phase).filter(Boolean))];
    const caption = c.inverters.length < 2 ? "AC out"
      : phases.length === 3 ? "Three phase · AC out" : phases.length === 2 ? "Split phase · AC out" : "Parallel · AC out";
    this._wall.innerHTML = `<div class="row">
      ${c.inverters.length ? `<div class="group"><div class="units">${c.inverters.map((d, i) => dev(d, "inv", i)).join("")}</div><div class="bus"></div><div class="cap">${caption}</div></div>` : ""}
      ${c.chargers.length ? `<div class="group"><div class="units">${c.chargers.map((d, i) => dev(d, "mppt", i)).join("")}</div><div class="bus dc"></div><div class="cap">Solar · DC</div></div>` : ""}
      ${c.inverters.length || c.chargers.length ? "" : `<div class="empty">No devices yet. Add inverters and solar chargers in the card editor, or under <code>inverters:</code> / <code>chargers:</code> in YAML.</div>`}
    </div>`;
    this._devs = [...this._wall.querySelectorAll(".dev")];
    this._html = new Map();
    this._headHtml = this._flowHtml = null;
    this._scale();
  }

  // One scale (px per mm) for all devices, so their sizes compare. The phase
  // set always stays on one line and shrinks to fit; chargers wrap below it
  // when the row gets too tight.
  _scale() {
    const c = this._config;
    if (!c || !this._wall) return;
    const inner = this._wall.clientWidth - 28;
    if (inner <= 0) return;
    const mm = (d, kind) => (MODELS[d.model] || MODELS[kind === "inv" ? "multiplus2" : "mppt_small"]).w;
    const invMm = c.inverters.reduce((a, d) => a + mm(d, "inv"), 0);
    const chgMm = c.chargers.reduce((a, d) => a + mm(d, "mppt"), 0);
    const gap = 8, groupGap = 16;
    const invGaps = Math.max(0, c.inverters.length - 1) * gap;
    const chgGaps = Math.max(0, c.chargers.length - 1) * gap;
    const kMax = c.size === "large" ? 0.6 : 0.34;
    const together = (inner - invGaps - chgGaps - (invMm && chgMm ? groupGap : 0)) / Math.max(1, invMm + chgMm);
    const alone = Math.min(invMm ? (inner - invGaps) / invMm : Infinity, chgMm ? (inner - chgGaps) / chgMm : Infinity);
    let k = Math.min(kMax, together);
    if (k < 0.24) k = Math.min(kMax, alone);
    k = Math.max(0.12, Math.min(k, alone));
    this._wall.style.setProperty("--k", k.toFixed(4));
  }

  _ent(eid) { return eid && this._hass && this._hass.states[eid]; }
  _watts(eid) {
    const st = this._ent(eid);
    if (!st) return null;
    const v = parseFloat(st.state);
    if (!Number.isFinite(v)) return NaN;
    const u = String((st.attributes || {}).unit_of_measurement || "W").trim();
    return /^kW$/i.test(u) ? v * 1000 : /^MW$/i.test(u) ? v * 1e6 : v;
  }
  _num(eid) { const st = this._ent(eid); if (!st) return null; const v = parseFloat(st.state); return Number.isFinite(v) ? v : NaN; }
  _kwh(eid) {
    const st = this._ent(eid);
    if (!st) return null;
    const v = parseFloat(st.state);
    if (!Number.isFinite(v)) return NaN;
    const u = String((st.attributes || {}).unit_of_measurement || "kWh").trim();
    return /^Wh$/i.test(u) ? v / 1000 : /^MWh$/i.test(u) ? v * 1000 : v;
  }
  _stateText(eid) {
    const st = this._ent(eid);
    if (!st || st.state === "unavailable" || st.state === "unknown") return "";
    const raw = String(st.state).trim();
    return /^\d+$/.test(raw) && STATES[Number(raw)] ? STATES[Number(raw)] : raw.replace(/_/g, " ");
  }
  _alarm(eid) {
    const st = this._ent(eid);
    if (!st) return false;
    const s = String(st.state).trim().toLowerCase();
    if (/^(on|true|problem|alarm|warning)$/.test(s)) return true;
    if (/^(off|false|ok|normal|none|no alarm|0|unavailable|unknown|)$/.test(s)) return false;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n > 0 : true;
  }

  _render() {
    if (!this._config || !this._hass || !this._devs) return;
    const c = this._config;
    const alarms = [];
    for (const el of this._devs) {
      const kind = el.dataset.kind, i = Number(el.dataset.i);
      const d = kind === "inv" ? c.inverters[i] : c.chargers[i];
      const html = kind === "inv" ? this._inverter(d, i, alarms) : this._charger(d, i, alarms);
      if (html !== this._html.get(el)) { this._html.set(el, html); el.innerHTML = html; }
    }

    const head = `<div class="title">${esc(c.name)}</div>${this._devs.length ? `<div class="pill ${alarms.length ? "alert" : ""}"><span class="dot"></span>${alarms.length ? esc(alarms.join(" · ")) : "All units normal"}</div>` : ""}`;
    if (head !== this._headHtml) { this._headHtml = head; this._head.innerHTML = head; }

    const tiles = [["entity_loads", "AC LOADS", false], ["entity_grid", "GRID", true], ["entity_solar", "SOLAR", false], ["entity_battery", "BATTERY", true]]
      .filter(([k]) => c[k] && this._ent(c[k]))
      .map(([k, label, signed]) => {
        const w = this._watts(c[k]);
        const [n, u] = fmtW(w, signed);
        const cls = k === "entity_solar" && w > 0 ? "chg" : k === "entity_battery" && Number.isFinite(w) ? (w > 0 ? "chg" : w < 0 ? "dis" : "") : "";
        return `<div data-entity="${esc(c[k])}" role="button"><div class="k">${label}</div><div class="v ${cls}">${n}<span class="u">${u}</span></div></div>`;
      }).join("");
    if (tiles !== this._flowHtml) { this._flowHtml = tiles; this._flow.innerHTML = tiles; this._flow.hidden = !tiles; }
  }

  _inverter(d, i, alarms) {
    const model = MODELS[d.model] ? d.model : "multiplus2";
    const text = this._stateText(d.state);
    const cat = category(text);
    const p = this._watts(d.power), acin = this._watts(d.ac_in_power);
    const v = this._num(d.voltage), hz = this._num(d.frequency), a = this._num(d.dc_current);
    const s = text.toLowerCase();
    const mains = (Number.isFinite(acin) && acin > 10) || cat === "chg" || cat === "pass";
    const alarm = cat === "fault" || this._alarm(d.alarm);
    const tag = d.name || d.phase || "";
    if (alarm) alarms.push(`${tag || MODELS[model].label}${text ? `: ${text}` : ": alarm"}`);
    const L = (on, color, label) => `<span><i class="${on ? color : ""}"></i><em>${label}</em></span>`;
    const leds = {
      inv: cat === "inv" || (!cat && Number.isFinite(p) && p > 10 && !mains),
      bulk: /bulk/.test(s), abs: /absorp/.test(s), flt: /float|storage/.test(s),
      ovl: /overload/.test(s) || (alarm && !/low batt|temp/.test(s)), low: /low batt/.test(s), temp: /temp/.test(s),
    };
    const [pn, pu] = fmtW(p);
    const line1 = [
      d.ac_in_power ? (Number.isFinite(acin) && acin > 10 ? `in ${fmtW(acin)[0]}<span class="u">${fmtW(acin)[1]}</span>` : "no grid") : "",
      d.dc_current ? `${fmt(a, 1, true)}<span class="u">A</span>` : "",
    ].filter(Boolean).join(" · ");
    const line2 = [
      d.voltage ? `${fmt(v, 0)}<span class="u">V</span>` : "",
      d.frequency ? `${fmt(hz, 1)}<span class="u">Hz</span>` : "",
    ].filter(Boolean).join(" ");
    const screen = `<div class="scr ${alarm ? "alarm" : ""}">
      ${text ? `<span class="st ${cat}">${esc(text)}</span>` : ""}
      <span class="big">${pn}<span class="u">${pu}</span></span>
      ${line1 ? `<span class="ln">${line1}</span>` : ""}
      ${line2 ? `<span class="ln">${line2}</span>` : ""}
    </div>`;
    const tagHtml = tag ? `<span class="phase" style="--pc:${PHASE_CLR[d.phase] || "#4caf50"}">${esc(tag)}</span>` : "";
    const label = esc(d.label || "");
    if (model === "quattro") {
      return `${tagHtml}<div class="panel"></div>${screen}
        <div class="leds">${L(mains, "g", "AC in")}${L(leds.inv, "g", "Inverter on")}${L(leds.bulk, "y", "Bulk")}${L(leds.abs, "y", "Absorption")}${L(leds.flt, "g", "Float")}${L(leds.ovl, "r", "Overload")}${L(leds.low, "r", "Low battery")}${L(leds.temp, "r", "Temperature")}</div>
        <div class="model">${MODELS.quattro.label}</div>${label ? `<div class="sub">${label}</div>` : ""}<div class="slots"></div><div class="glands"><i></i><i></i><i></i><i></i><i></i><i></i></div>`;
    }
    if (model === "multi_rs") {
      return `${tagHtml}${screen}<div class="btns"><i></i><i></i></div>
        <div class="leds">${L(leds.inv, "g", "Inv")}${L(mains || leds.bulk || leds.abs || leds.flt, "y", "Chg")}${L(alarm, "r", "Alarm")}</div>
        <div class="model">${MODELS.multi_rs.label}</div>${label ? `<div class="sub">${label}</div>` : ""}<div class="glands"><i></i><i></i><i></i><i></i><i></i></div>`;
    }
    return `${tagHtml}<div class="panel"></div>${screen}
      <div class="leds">${L(mains, "g", "Mains on")}${L(leds.inv, "g", "Inverter on")}${L(leds.bulk, "y", "Bulk")}${L(leds.abs, "y", "Absorption")}${L(leds.flt, "g", "Float")}${L(leds.ovl, "r", "Overload")}${L(leds.low, "r", "Low batt")}${L(leds.temp, "r", "Temp")}</div>
      <div class="model">${MODELS.multiplus2.label}</div>${label ? `<div class="sub">${label}</div>` : ""}<div class="glands"><i></i><i></i><i></i><i></i></div>`;
  }

  _charger(d, i, alarms) {
    const text = this._stateText(d.state);
    const cat = category(text);
    const s = text.toLowerCase();
    const alarm = cat === "fault" || this._alarm(d.alarm);
    const tag = d.name || "";
    if (alarm) alarms.push(`${tag || `MPPT ${i + 1}`}${text ? `: ${text}` : ": alarm"}`);
    const [pn, pu] = fmtW(this._watts(d.power));
    const y = this._kwh(d.yield_today);
    return `${tag ? `<span class="phase" style="--pc:#e0a000">${esc(tag)}</span>` : ""}
      <div class="model">MPPT${d.label ? ` ${esc(d.label)}` : ""}</div>
      <div class="scr ${alarm ? "alarm" : ""}">
        <span class="big">${pn}<span class="u">${pu}</span></span>
        ${text ? `<span class="st ${cat}">${esc(text)}</span>` : ""}
        ${d.yield_today ? `<span class="ln">${fmt(y, 1)}<span class="u">kWh</span></span>` : ""}
      </div>
      <div class="leds"><span><i class="${/bulk/.test(s) ? "y" : ""}"></i><em>B</em></span><span><i class="${/absorp/.test(s) ? "y" : ""}"></i><em>A</em></span><span><i class="${/float|storage/.test(s) ? "g" : ""}"></i><em>F</em></span></div>`;
  }
}

const CSS = `
  :host {
    display: block;
    --clr-green: #4caf50; --clr-amber: #ffc107; --clr-orange: #ff9800; --clr-red: #ef5350; --clr-blue: #42a5f5; --clr-grey: #9e9e9e;
    --vblue-hi: #3b7fd0; --vblue: #2563ae; --vblue-lo: #1b4c8c;
  }
  ha-card { display: block; padding: 18px 18px 14px; }
  [data-entity] { cursor: pointer; }
  .head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
  .title { font-size: 20px; font-weight: 600; letter-spacing: 0.3px; }
  .pill { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; padding: 4px 12px; border-radius: 14px; color: var(--clr-green); background: rgba(76,175,80,0.13); min-width: 0; }
  .pill.alert { color: var(--clr-red); background: rgba(239,83,80,0.18); }
  .pill .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }
  .empty { font-size: 13px; opacity: 0.7; padding: 8px; color: #ddd; }

  .flow { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 6px; margin-bottom: 12px; }
  .flow[hidden] { display: none; }
  .flow > div { border-radius: 4px; padding: 6px 10px; color: #fff; --tint: rgba(76,175,80,0.14); background: linear-gradient(var(--tint), var(--tint)), #0b0d0b; border: 1.5px solid #050505; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05); font-variant-numeric: tabular-nums; }
  .flow .k { font-size: 9.5px; letter-spacing: 1.3px; opacity: 0.55; }
  .flow .v { font-size: 17px; font-weight: 700; white-space: nowrap; }
  .flow .v .u { font-size: 0.6em; opacity: 0.6; margin-left: 2px; font-weight: 500; }
  .flow .v.dis { color: var(--clr-orange); } .flow .v.chg { color: var(--clr-green); }

  /* The wall the devices hang on, like the battery cabinet */
  .wall { padding: 14px 14px 12px; border-radius: 10px; --k: 0.3;
    background: repeating-linear-gradient(90deg, transparent 0 39px, rgba(255,255,255,0.025) 39px 40px), linear-gradient(#161616, #111);
    border: 1px solid rgba(255,255,255,0.07); box-shadow: inset 0 2px 10px rgba(0,0,0,0.6); }
  .row { display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-end; gap: 14px 16px; }
  .group { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .units { display: flex; align-items: flex-end; gap: 8px; padding-top: 10px; }
  .cap { font-size: 10px; letter-spacing: 1.4px; color: rgba(255,255,255,0.45); text-transform: uppercase; }
  .bus { height: 3px; align-self: stretch; border-radius: 2px; background: linear-gradient(90deg, #8b5a2b, #333 50%, #888); opacity: 0.6; }
  .bus.dc { background: linear-gradient(90deg, #c62828, #222); }

  .dev {
    position: relative; flex: none; width: calc(var(--mmw) * var(--k) * 1px); height: calc(var(--mmh) * var(--k) * 1px);
    container-type: inline-size; color: #fff; border-radius: 6px;
    background: linear-gradient(165deg, var(--vblue-hi) 0%, var(--vblue) 40%, var(--vblue-lo) 100%);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.25), inset -6px 0 0 rgba(0,0,0,0.18), 0 4px 10px rgba(0,0,0,0.55);
  }
  .dev:hover { filter: brightness(1.12); }
  .phase { position: absolute; top: -9px; left: 50%; transform: translateX(-50%); z-index: 2; font-size: 10px; font-weight: 800; letter-spacing: 0.08em; padding: 1px 8px; border-radius: 8px; background: #111; border: 2px solid var(--pc); color: #fff; white-space: nowrap; max-width: 140%; overflow: hidden; text-overflow: ellipsis; }
  .model { position: absolute; left: 7%; right: 7%; font-weight: 800; letter-spacing: 0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: rgba(255,255,255,0.95); }
  .sub { position: absolute; left: 7%; right: 7%; font-size: 5.5cqw; color: rgba(255,255,255,0.65); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .scr {
    position: absolute; border-radius: 3px; box-sizing: border-box; --tint: rgba(76,175,80,0.22);
    background: linear-gradient(var(--tint), var(--tint)), #0b0d0b; border: 1.5px solid #050505;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 8px 14px rgba(255,255,255,0.04);
    display: flex; flex-direction: column; justify-content: space-evenly; text-align: center; font-variant-numeric: tabular-nums; padding: 4% 5%; overflow: hidden;
  }
  .scr.alarm { --tint: rgba(239,60,60,0.38); }
  .scr .big { font-weight: 700; line-height: 1; white-space: nowrap; }
  .scr .big .u { font-size: 0.55em; opacity: 0.7; margin-left: 1px; }
  .scr .st { font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .scr .ln { opacity: 0.85; white-space: nowrap; overflow: hidden; }
  .scr .ln .u { opacity: 0.55; }
  .st.inv { color: var(--clr-blue); } .st.chg { color: var(--clr-green); } .st.pass { color: #ddd; } .st.off { color: var(--clr-grey); } .st.fault { color: #ff8a80; }

  .leds { position: absolute; display: grid; gap: 2.2cqw 3cqw; font-size: 4.2cqw; letter-spacing: 0.03em; color: rgba(255,255,255,0.7); }
  .leds span { display: flex; align-items: center; gap: 2cqw; white-space: nowrap; }
  .leds em { font-style: normal; }
  .leds i { width: 3.4cqw; aspect-ratio: 1; border-radius: 50%; background: rgba(0,0,0,0.45); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.4); flex: none; }
  .leds i.g { background: #5fd35f; box-shadow: 0 0 5px #5fd35f; }
  .leds i.y { background: #ffcf33; box-shadow: 0 0 5px #ffcf33; }
  .leds i.r { background: #ff4d4d; box-shadow: 0 0 6px #ff4d4d; }
  .glands { position: absolute; left: 10%; right: 10%; bottom: 3%; display: flex; justify-content: space-between; }
  .glands i { width: 7cqw; aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle at 40% 35%, #444, #0c0c0c 70%); box-shadow: 0 0 0 1px rgba(0,0,0,0.5); }

  /* MultiPlus-II */
  .multiplus2 .panel { position: absolute; left: 6%; right: 6%; top: 4%; height: 50%; border-radius: 4px; background: linear-gradient(#1c1f24, #121418); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06); }
  .multiplus2 .model { top: 57%; font-size: 9cqw; }
  .multiplus2 .sub { top: 64%; }
  .multiplus2 .scr { left: 11%; right: 11%; top: 8%; height: 25%; }
  .multiplus2 .scr .big { font-size: 15cqw; } .multiplus2 .scr .st { font-size: 5.6cqw; } .multiplus2 .scr .ln { font-size: 6cqw; }
  .multiplus2 .leds { left: 11%; right: 9%; top: 35.5%; grid-template-columns: 1fr 1fr; }
  /* Quattro */
  .quattro .panel { position: absolute; left: 6%; right: 6%; top: 4%; height: 46%; border-radius: 4px; background: linear-gradient(#1c1f24, #121418); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06); }
  .quattro .model { top: 53%; font-size: 7.5cqw; }
  .quattro .sub { top: 59%; font-size: 4.4cqw; }
  .quattro .scr { left: 10%; width: 46%; top: 8%; height: 38%; }
  .quattro .scr .big { font-size: 10cqw; } .quattro .scr .st { font-size: 3.8cqw; } .quattro .scr .ln { font-size: 4.1cqw; }
  .quattro .leds { left: 61%; right: 9%; top: 9%; grid-template-columns: 1fr; font-size: 3.3cqw; gap: 1.6cqw; }
  .quattro .leds i { width: 2.6cqw; }
  .quattro .slots { position: absolute; left: 8%; right: 8%; top: 68%; height: 16%; background: repeating-linear-gradient(90deg, rgba(0,0,0,0.35) 0 2.2cqw, transparent 2.2cqw 4.4cqw); border-radius: 3px; }
  .quattro .glands i { width: 5.5cqw; }
  /* Multi RS */
  .multi_rs { background: linear-gradient(180deg, transparent 72%, #101010 72%, #0a0a0a 100%), linear-gradient(165deg, #3576c4 0%, #22579f 45%, #1a4682 100%); }
  .multi_rs .model { top: 5%; font-size: 6.5cqw; }
  .multi_rs .sub { top: 12%; font-size: 4cqw; }
  .multi_rs .scr { left: 8%; width: 54%; top: 21%; height: 44%; }
  .multi_rs .scr .big { font-size: 10.5cqw; } .multi_rs .scr .st { font-size: 3.8cqw; } .multi_rs .scr .ln { font-size: 4.1cqw; }
  .multi_rs .btns { position: absolute; left: 67%; top: 24%; display: flex; flex-direction: column; gap: 3cqw; }
  .multi_rs .btns i { width: 7cqw; aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle at 40% 35%, #555, #151515); box-shadow: 0 0 0 1px rgba(0,0,0,0.5); }
  .multi_rs .leds { left: 78%; right: 4%; top: 22%; grid-template-columns: 1fr; font-size: 3.4cqw; gap: 2cqw; }
  .multi_rs .leds span { gap: 1.4cqw; }
  .multi_rs .leds i { width: 2.6cqw; }
  /* SmartSolar MPPT */
  .mppt_small, .mppt_large { border-radius: 4px; background:
    repeating-linear-gradient(90deg, #0f0f0f 0 3cqw, #1d1d1d 3cqw 6cqw) top / 100% 15% no-repeat,
    repeating-linear-gradient(90deg, #0f0f0f 0 3cqw, #1d1d1d 3cqw 6cqw) bottom / 100% 15% no-repeat,
    linear-gradient(165deg, var(--vblue-hi), var(--vblue) 45%, var(--vblue-lo)); }
  .mppt_small .model, .mppt_large .model { top: 18%; font-size: 9cqw; }
  .mppt_small .scr, .mppt_large .scr { left: 9%; right: 9%; top: 31%; height: 37%; }
  .mppt_small .scr .big, .mppt_large .scr .big { font-size: 16cqw; }
  .mppt_small .scr .st, .mppt_large .scr .st { font-size: 7cqw; }
  .mppt_small .scr .ln, .mppt_large .scr .ln { font-size: 7.5cqw; }
  .mppt_small .leds, .mppt_large .leds { left: 9%; right: 9%; top: 72%; grid-template-columns: repeat(3, auto); justify-content: space-between; font-size: 5.5cqw; }
  .mppt_small .leds i, .mppt_large .leds i { width: 4.5cqw; }

  /* Small units: drop the light labels and sub line (unreadable), keep the lights */
  @container (max-width: 135px) {
    .leds em { display: none; }
    .dev.multiplus2 .leds, .dev.quattro .leds { grid-template-columns: repeat(4, auto); justify-content: center; gap: 4cqw 7cqw; }
    .dev.multiplus2 .leds { top: 37%; }
    .dev.multiplus2 .leds i, .dev.quattro .leds i { width: 5cqw; }
    .dev.quattro .leds { left: 10%; right: auto; width: 46%; top: 50%; }
    .dev.quattro .scr { height: 34%; }
    .dev.multi_rs .leds { gap: 4cqw; }
    .sub { display: none; }
  }
`;

// ─── Editor ───────────────────────────────────────────────────────────────

const SENSOR = { entity: { domain: "sensor" } };
const ANY = { entity: {} };
const MAIN_SCHEMA = [
  { name: "name", selector: { text: {} } },
  { name: "size", selector: { select: { mode: "dropdown", options: [{ value: "compact", label: "Compact" }, { value: "large", label: "Large" }] } } },
  { type: "grid", name: "", schema: [
    { name: "entity_loads", selector: SENSOR }, { name: "entity_grid", selector: SENSOR },
    { name: "entity_solar", selector: SENSOR }, { name: "entity_battery", selector: SENSOR },
  ] },
];
const INV_SCHEMA = [
  { type: "grid", name: "", schema: [
    { name: "model", selector: { select: { mode: "dropdown", options: [
      { value: "multiplus2", label: "MultiPlus-II" }, { value: "quattro", label: "Quattro" }, { value: "multi_rs", label: "Multi RS" }] } } },
    { name: "phase", selector: { select: { mode: "dropdown", options: [{ value: "", label: "—" }, { value: "L1", label: "L1" }, { value: "L2", label: "L2" }, { value: "L3", label: "L3" }] } } },
    { name: "name", selector: { text: {} } },
    { name: "label", selector: { text: {} } },
  ] },
  { name: "power", selector: SENSOR },
  { name: "state", selector: ANY },
  { type: "grid", name: "", schema: [
    { name: "ac_in_power", selector: SENSOR }, { name: "dc_current", selector: SENSOR },
    { name: "voltage", selector: SENSOR }, { name: "frequency", selector: SENSOR },
  ] },
  { name: "alarm", selector: ANY },
];
const CHG_SCHEMA = [
  { type: "grid", name: "", schema: [
    { name: "model", selector: { select: { mode: "dropdown", options: [{ value: "mppt_small", label: "MPPT, small (e.g. 100/20, 150/35)" }, { value: "mppt_large", label: "MPPT, large (e.g. 250/100)" }] } } },
    { name: "name", selector: { text: {} } },
  ] },
  { name: "label", selector: { text: {} } },
  { name: "power", selector: SENSOR },
  { name: "state", selector: ANY },
  { name: "yield_today", selector: SENSOR },
  { name: "alarm", selector: ANY },
];
const LABELS = {
  name: "Name", size: "Size", entity_loads: "AC loads (total)", entity_grid: "Grid", entity_solar: "Solar", entity_battery: "Battery",
  model: "Model", phase: "Phase", label: "Type (e.g. 48/5000/70-50, or 150/35 for a charger)", power: "Power (AC out, or PV)",
  state: "State (text or VE.Bus / charger state number)", ac_in_power: "AC in power", dc_current: "DC current",
  voltage: "AC out voltage", frequency: "AC out frequency", alarm: "Alarm (on / non-zero = alarm)", yield_today: "Yield today",
};

class InverterStackCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config, inverters: list(config.inverters), chargers: list(config.chargers) };
    this._render();
  }
  set hass(hass) { this._hass = hass; this._render(); }

  _dispatch(config) {
    this._config = config;
    const ev = new Event("config-changed", { bubbles: true, composed: true });
    ev.detail = { config };
    this.dispatchEvent(ev);
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._main) {
      this.innerHTML = `
        <style>
          inverter-stack-card-editor { display: block; }
          .isc-title { font-size: 12px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: var(--secondary-text-color); margin: 20px 0 6px; padding-bottom: 4px; border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.08)); }
          .isc-hint { font-size: 12px; color: var(--secondary-text-color); margin: 4px 0 10px; line-height: 1.4; }
          .isc-item { border: 1px solid var(--divider-color, rgba(0,0,0,0.12)); border-radius: 8px; padding: 8px 10px 10px; margin-bottom: 10px; }
          .isc-item-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-weight: 600; font-size: 14px; }
          .isc-tools { display: flex; gap: 2px; }
          .isc-tools button, .isc-add { font: 500 13px/1 inherit; font-family: inherit; padding: 7px 9px; border-radius: 6px; cursor: pointer; color: var(--primary-text-color); background: none; border: 1px solid var(--divider-color, rgba(0,0,0,0.15)); }
          .isc-tools button:disabled { opacity: 0.35; cursor: default; }
          .isc-add { color: var(--primary-color); }
        </style>
        <div class="main"></div>
        <div class="isc-title">Inverter / chargers</div>
        <div class="isc-hint">One per unit. For a three-phase system add three and give them phase L1, L2 and L3. Every field is optional except the model; the screen shows what you fill in.</div>
        <div class="invs"></div><button type="button" class="isc-add" data-add="inverters">+ Add inverter</button>
        <div class="isc-title">Solar chargers</div>
        <div class="invs-hint isc-hint">Optional. One per MPPT.</div>
        <div class="chgs"></div><button type="button" class="isc-add" data-add="chargers">+ Add solar charger</button>`;
      this._main = this._form(this.querySelector(".main"), (v) => this._dispatch({ ...this._config, ...v }));
      this.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
        const key = b.dataset.add, items = this._config[key];
        const last = items[items.length - 1] || {};
        const next = key === "inverters"
          ? { model: last.model || "multiplus2", phase: ({ L1: "L2", L2: "L3" })[last.phase] || (items.length ? "" : "L1") }
          : { model: last.model || "mppt_small" };
        this._dispatch({ ...this._config, [key]: [...items, next] });
      }));
    }
    this._main.hass = this._hass;
    this._main.schema = MAIN_SCHEMA;
    // Without the device lists: the form hands back everything it was given,
    // and the defaults' empty lists would replace the real ones.
    const { inverters: _i, chargers: _c, ...defaults } = DEFAULTS;
    const { inverters, chargers, ...rest } = this._config;
    this._main.data = { ...defaults, ...rest };
    this._items(this.querySelector(".invs"), "inverters", INV_SCHEMA, (d, i) => `Inverter ${i + 1}${d.phase ? ` · ${d.phase}` : ""}${d.name ? ` · ${d.name}` : ""}`);
    this._items(this.querySelector(".chgs"), "chargers", CHG_SCHEMA, (d, i) => `Solar charger ${i + 1}${d.name ? ` · ${d.name}` : ""}`);
  }

  _form(host, onChange) {
    const f = document.createElement("ha-form");
    f.computeLabel = (s) => LABELS[s.name] || s.name;
    f.addEventListener("value-changed", (e) => { e.stopPropagation(); onChange(e.detail.value); });
    host.appendChild(f);
    return f;
  }

  // One block per device: a heading with move / remove, and its own ha-form.
  _items(host, key, schema, title) {
    const items = this._config[key];
    if (host.children.length !== items.length) {
      host.innerHTML = "";
      items.forEach((_, i) => {
        const box = document.createElement("div");
        box.className = "isc-item";
        box.innerHTML = `<div class="isc-item-head"><span class="t"></span><span class="isc-tools"><button type="button" data-m="-1" title="Move up">▲</button><button type="button" data-m="1" title="Move down">▼</button><button type="button" data-m="x" title="Remove">✕</button></span></div>`;
        box.form = this._form(box, (v) => {
          const next = this._config[key].map((x) => ({ ...x }));
          next[i] = Object.fromEntries(Object.entries({ ...next[i], ...v }).filter(([, val]) => val !== "" && val !== undefined && val !== null));
          if (!next[i].model) next[i].model = key === "inverters" ? "multiplus2" : "mppt_small";
          this._dispatch({ ...this._config, [key]: next });
        });
        box.querySelector(".isc-tools").addEventListener("click", (e) => {
          const m = e.target.closest("button") && e.target.closest("button").dataset.m;
          if (!m) return;
          const next = [...this._config[key]];
          if (m === "x") next.splice(i, 1);
          else { const j = i + Number(m); if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j], next[i]]; }
          this._dispatch({ ...this._config, [key]: next });
        });
        host.appendChild(box);
      });
    }
    [...host.children].forEach((box, i) => {
      box.querySelector(".t").textContent = title(items[i], i);
      box.querySelector('[data-m="-1"]').disabled = i === 0;
      box.querySelector('[data-m="1"]').disabled = i === items.length - 1;
      box.form.hass = this._hass;
      box.form.schema = schema;
      box.form.data = { phase: "", ...items[i] };
    });
  }
}

customElements.define("inverter-stack-card", InverterStackCard);
customElements.define("inverter-stack-card-editor", InverterStackCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "inverter-stack-card",
  name: "Inverter Stack Card",
  description: "Inverter / chargers (MultiPlus-II, Quattro, Multi RS) and solar chargers drawn as the devices, per phase.",
  preview: true,
  documentationURL: "https://github.com/SvenHamers/inverter-stack-card",
});

console.info(
  `%c INVERTER-STACK-CARD %c v${VERSION} `,
  "color:#fff;background:#2563ae;font-weight:700;padding:2px 6px;border-radius:3px 0 0 3px;",
  "color:#fff;background:#555;padding:2px 6px;border-radius:0 3px 3px 0;"
);
})();

import { buildTala, FAMILIES, JAATHIS } from "./talas.js";

const $ = (id) => document.getElementById(id);

/* ---------------- state ---------------- */
let audioCtx = null;
let master = null;
let droneNodes = null;
let playing = false;
let bpm = 80;
let gati = 1; // swaras per akshara (subdivision)
let familyKey = "triputa";
let jaathiKey = "chaturashra";
let tala = null;
let droneOn = false;
let droneMidi = 58; // A#3 — the alto's base

/* scheduler state */
let nextTickTime = 0;
let tickIdx = 0; // absolute subdivision index across cycles
let scheduled = []; // {time, akshara, sub, kind} for the visual loop
let lastAbs = 0; // persists across frames so the highlight never snaps back

/* ---------------- audio ---------------- */
function ensureCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    master = audioCtx.createGain();
    master.gain.value = 0.5;
    master.connect(audioCtx.destination);
  }
  audioCtx.resume();
}

/* a "taku" tap: short noise burst through a bandpass — sounds like a hand slap on the knee */
function tap(time, strong) {
  const dur = strong ? 0.07 : 0.045;
  const bufferSize = Math.floor(audioCtx.sampleRate * dur);
  const noiseBuf = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuf;
  const bp = audioCtx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = strong ? 1900 : 1300;
  bp.Q.value = 1.2;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(strong ? 0.9 : 0.4, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
  src.connect(bp).connect(gain).connect(master);
  src.start(time);
  src.stop(time + dur);
}

/* a soft inner tick (subdivision / finger count) */
function tick(time, pitch) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = pitch;
  gain.gain.setValueAtTime(0.35, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  osc.connect(gain).connect(master);
  osc.start(time);
  osc.stop(time + 0.06);
}

/* ---------------- drone (tanpura-style Sa-Pa) ---------------- */
function startDrone() {
  ensureCtx();
  const f0 = 440 * Math.pow(2, (droneMidi - 69) / 12);
  const out = audioCtx.createGain();
  out.gain.value = 0;
  out.gain.setTargetAtTime(0.16, audioCtx.currentTime, 0.8);
  const lp = audioCtx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 900;
  lp.connect(out).connect(master);
  const nodes = [];
  // Sa (root) + Pa (fifth) — two oscillators each, slightly detuned for a shimmer
  for (const interval of [0, 7]) {
    const f = f0 * Math.pow(2, interval / 12) * 2; // an octave up, like a tanpura
    for (const detune of [-3, 3]) {
      const osc = audioCtx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      osc.detune.value = detune;
      osc.connect(lp);
      osc.start();
      nodes.push(osc);
    }
  }
  out.connect(master);
  droneNodes = { nodes, out };
}

function stopDrone() {
  if (!droneNodes) return;
  droneNodes.out.gain.setTargetAtTime(0, audioCtx.currentTime, 0.3);
  const nodes = droneNodes.nodes;
  setTimeout(() => nodes.forEach((n) => { try { n.stop(); } catch {} }), 800);
  droneNodes = null;
}

/* ---------------- scheduler (lookahead pattern) ---------------- */
function scheduleTick(time, absIdx) {
  const a = tala.aksharas[absIdx % tala.total];
  const cycle = Math.floor(absIdx / tala.total);
  const kind = a.indexInAnga === 0 ? "angaStart" : "inner";
  const cycleStart = absIdx % tala.total === 0;

  if (gati <= 1) {
    // one hit per akshara
    if (a.indexInAnga === 0) tap(time, cycleStart || a.anga !== "L");
    else tick(time, a.anga === "L" ? 880 : 660);
  } else {
    // subdivided: the akshara start gets the anga sound, subdivisions get soft ticks
    if (a.indexInAnga === 0) tap(time, cycleStart || a.anga !== "L");
    else tick(time, a.anga === "L" ? 880 : 660);
    for (let s = 1; s < gati; s++) {
      tick(time + (s * (60 / bpm)) / gati, 520);
    }
  }
  scheduled.push({ time, absIdx, kind, cycle });
}

function schedulerLoop() {
  if (!playing) return;
  const spb = 60 / bpm; // seconds per akshara
  const sub = spb / gati;
  while (nextTickTime < audioCtx.currentTime + 0.15) {
    scheduleTick(nextTickTime, tickIdx);
    nextTickTime += sub;
    tickIdx++;
  }
}



/* ---------------- hand animation ---------------- */
const HAND_SVG = `
<svg viewBox="0 0 120 90" width="120" height="90">
  <g id="handPalm">
    <path d="M45 70 Q40 45 44 30 Q47 22 52 22 Q57 22 57 30 L58 42 Q60 30 64 30 Q69 30 68 40 L67 44
             Q70 34 74 34 Q79 34 78 43 L77 47 Q80 40 84 40 Q88 40 87 48 L84 62 Q80 76 66 78 Q52 80 45 70 Z"
          fill="#F5C99B" stroke="#1a1a1a" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M45 70 Q40 45 44 30" fill="none" stroke="#d99a5b" stroke-width="1.6"/>
  </g>
  <g id="handRipple"></g>
</svg>`;

function buildHandPanel() {
  const host = $("handAnim");
  if (!host || host.dataset.built) return;
  host.innerHTML = HAND_SVG;
  host.dataset.built = "1";
}

let lastGesture = "";
function animateHand(gesture, aksharaIdx) {
  const host = $("handAnim");
  if (!host) return;
  buildHandPanel();
  const palm = document.getElementById("handPalm");
  if (!palm) return;
  if (gesture === lastGesture) return;
  lastGesture = gesture;

  const ripple = document.getElementById("handRipple");
  palm.style.transformOrigin = "50% 80%";

  if (gesture === "clap") {
    palm.style.transition = "transform 0.1s";
    palm.style.transform = "rotate(-25deg) translateX(-8px)";
    setTimeout(() => { palm.style.transform = "rotate(0deg) translateX(0px)"; }, 90);
    ripple.innerHTML = '<circle cx="30" cy="55" r="14" fill="none" stroke="var(--elec)" stroke-width="2.5"><animate attributeName="r" from="6" to="22" dur="0.35s" fill="freeze"/><animate attributeName="opacity" from="0.9" to="0" dur="0.35s" fill="freeze"/></circle>';
  } else if (gesture === "count") {
    palm.style.transition = "transform 0.12s";
    palm.style.transform = "rotate(8deg)";
    setTimeout(() => { palm.style.transform = "rotate(0deg)"; }, 100);
    ripple.innerHTML = "";
  } else if (gesture === "wave") {
    palm.style.transition = "transform 0.14s";
    palm.style.transform = "translateX(14px) rotate(14deg)";
    setTimeout(() => { palm.style.transform = "translateX(2px) rotate(4deg)"; }, 120);
    ripple.innerHTML = '<path d="M20 50 Q30 40 40 50" fill="none" stroke="var(--butter-dark)" stroke-width="3"><animate attributeName="d" from="M20 50 Q30 36 40 50" to="M20 56 Q30 64 40 56" dur="0.4s" repeatCount="1"/></path>';
  } else {
    // tap
    palm.style.transition = "transform 0.09s";
    palm.style.transform = "translateY(-6px)";
    setTimeout(() => { palm.style.transform = "translateY(0px)"; }, 80);
    ripple.innerHTML = '<circle cx="60" cy="80" r="10" fill="none" stroke="var(--sage)" stroke-width="2.5"><animate attributeName="r" from="4" to="16" dur="0.3s" fill="freeze"/><animate attributeName="opacity" from="0.8" to="0" dur="0.3s" fill="freeze"/></circle>';
  }
}

/* ---------------- visualization ---------------- */
function draw() {
  if (!tala) return;
  const ctxRunning = audioCtx && audioCtx.state === "running";
  if (playing && ctxRunning) {
    // audio-clock driven: consume the scheduled queue
    const now = audioCtx.currentTime;
    while (scheduled.length && scheduled[0].time <= now) {
      lastAbs = scheduled.shift().absIdx % tala.total;
    }
  } else if (playing) {
    // suspended (automation / blocked audio): fall back to the performance clock
    const spb = 60 / bpm;
    lastAbs = Math.floor(((performance.now() / 1000 - playStartPerf) / spb) % tala.total);
  }
  renderTala(lastAbs);
}

let drawId = null;
function startDraw() {
  if (drawId) return;
  drawId = setInterval(draw, 40); // interval, not rAF — keeps ticking in background tabs
}

function renderTala(activeIdx) {
  const row = $("angas");
  if (!row || row.dataset.built !== tala.name) {
    row.innerHTML = "";
    for (const block of tala.angaBlocks) {
      const div = document.createElement("div");
      div.className = "anga " + (block.anga === "L" ? "anga-l" : "anga-d");
      const gesture = block.anga === "L" ? "clap" : block.anga === "D" ? "wave" : "tap";
      let inner = `<div class="anga-label">${gesture}</div><div class="dots">`;
      for (let i = 0; i < block.len; i++) {
        inner += `<span class="akshara" data-i="${block.start + i}">${block.anga === "L" ? i + 1 : "&bull;"}</span>`;
      }
      inner += "</div>";
      div.innerHTML = inner;
      row.appendChild(div);
    }
    row.dataset.built = tala.name;
  }
  // highlight
  row.querySelectorAll(".akshara").forEach((el) => {
    const i = +el.dataset.i;
    el.classList.toggle("on", i === activeIdx && playing);
    el.classList.toggle("done", i < activeIdx && playing);
  });
  const cur = tala.aksharas[activeIdx];
  const gesture = cur.indexInAnga === 0
    ? (cur.anga === "L" ? "clap" : cur.anga === "D" ? "wave" : "tap")
    : (cur.anga === "L" ? "count " + (cur.indexInAnga + 1) : "hold");
  $("position").textContent = `akshara ${activeIdx + 1} / ${tala.total} — ${gesture}`;
  animateHand(gesture, activeIdx);
}

/* ---------------- tala selection UI ---------------- */
function rebuildTala() {
  tala = buildTala(familyKey, jaathiKey);
  const row = $("angas");
  row.dataset.built = ""; // force rebuild
  $("talaName").textContent = tala.name + ` — ${tala.total} aksharas`;
  renderTala(0);
}

function populate() {
  $("familySel").innerHTML = FAMILIES.map((f) => `<option value="${f.key}">${f.name} thalam</option>`).join("");
  $("jaathiSel").innerHTML = JAATHIS.map((j) => `<option value="${j.key}">${j.name} jaathi — ${j.count}</option>`).join("");
  $("familySel").value = familyKey;
  $("jaathiSel").value = jaathiKey;
  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  $("droneSel").innerHTML = Array.from({ length: 25 }, (_, k) => {
    const midi = 52 + k; // E3 .. ~
    const n = noteNames[midi % 12], oct = Math.floor(midi / 12) - 1;
    return `<option value="${midi}">${n}${oct}</option>`;
  }).join("");
  $("droneSel").value = String(droneMidi);
}

/* ---------------- wiring ---------------- */
$("familySel").addEventListener("change", (e) => { familyKey = e.target.value; rebuildTala(); });
$("jaathiSel").addEventListener("change", (e) => { jaathiKey = e.target.value; rebuildTala(); });
$("bpm").addEventListener("input", (e) => { bpm = +e.target.value; $("bpmVal").textContent = bpm; });
$("gati").addEventListener("change", (e) => { gati = +e.target.value; });
$("droneToggle").addEventListener("change", (e) => {
  droneOn = e.target.checked;
  if (droneOn) { ensureCtx(); startDrone(); } else stopDrone();
});
$("droneSel").addEventListener("change", (e) => {
  droneMidi = +e.target.value;
  if (droneOn) { stopDrone(); startDrone(); }
});
$("volume").addEventListener("input", (e) => {
  if (master) master.gain.value = e.target.value / 100;
});

let playStartPerf = 0;
let schedulerId = null;
$("playBtn").addEventListener("click", () => {
  ensureCtx();
  if (audioCtx.state === "suspended") { try { audioCtx.resume(); } catch {} }
  if (!playing) {
    playing = true;
    scheduled = [];
    tickIdx = 0;
    playStartPerf = performance.now() / 1000;
    nextTickTime = audioCtx.currentTime + 0.1;
    if (schedulerId) clearInterval(schedulerId);
    schedulerId = setInterval(schedulerLoop, 25);
    schedulerLoop();
    $("playBtn").textContent = "⏸ stop";
    $("playBtn").classList.add("on");
    startDraw();
  } else {
    playing = false;
    if (schedulerId) { clearInterval(schedulerId); schedulerId = null; }
    lastAbs = 0;
    $("playBtn").textContent = "▶ start";
    $("playBtn").classList.remove("on");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target.tagName !== "INPUT" && e.target.tagName !== "SELECT") {
    e.preventDefault();
    $("playBtn").click();
  }
});

/* ---------------- boot ---------------- */
populate();
rebuildTala();

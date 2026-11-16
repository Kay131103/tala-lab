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



/* ---------------- hand animation (the tala, shown the carnatic way) ---------------- */
/* The hand: the palm up, four fingers + thumb. Tala gestures exactly as taught:
   LAGHU  = strike the palm (clap), then tap the fingers one by one
            (little -> ring -> middle -> index, repeating for longer jaathis)
   DRUTHAM = strike, then flip the hand and strike the back (the "wave")
   ANUDHRUTHAM = a single strike                                                        */

const HAND_SVG = `
<svg viewBox="0 0 150 160" width="150" height="160">
  <g id="handAll">
    <g id="handFingers">
      <g class="finger" data-f="1">
        <rect x="14" y="26" width="17" height="52" rx="8.5" fill="#F5C99B" stroke="#1a1a1a" stroke-width="2.4"/>
      </g>
      <g class="finger" data-f="2">
        <rect x="40" y="12" width="19" height="66" rx="9.5" fill="#F5C99B" stroke="#1a1a1a" stroke-width="2.4"/>
      </g>
      <g class="finger" data-f="3">
        <rect x="67" y="6" width="20" height="72" rx="10" fill="#F5C99B" stroke="#1a1a1a" stroke-width="2.4"/>
      </g>
      <g class="finger" data-f="4">
        <rect x="95" y="18" width="18" height="60" rx="9" fill="#F5C99B" stroke="#1a1a1a" stroke-width="2.4"/>
      </g>
    </g>
    <g id="handPalm">
      <path d="M10 58 Q6 96 32 106 L104 106 Q132 100 128 62 L124 46 L96 40 L70 40 L42 46 L16 46 Z"
            fill="#F5C99B" stroke="#1a1a1a" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M104 66 Q126 62 122 80 Q116 94 96 92" fill="none" stroke="#1a1a1a" stroke-width="2.4"/>
    </g>
  </g>
  <g id="handRipple"></g>
</svg>`;

let lastGestureShown = "";

const STAGE_HTML = `
  <div class="hand-stage" id="handStage">
    <div class="hand-palm" id="handBase">🤚</div>
    <div class="hand-striker" id="handStriker">✋</div>
    <div class="hand-count-pop" id="countPop"></div>
  </div>`;

function buildHandPanel() {
  const host = $("handSvgWrap");
  if (host.dataset.built) return;
  host.innerHTML = STAGE_HTML;
  host.dataset.built = "1";
}

function popCount(text) {
  const pop = document.getElementById("countPop");
  if (!pop) return;
  pop.textContent = text;
  pop.classList.remove("show");
  void pop.offsetWidth;
  pop.classList.add("show");
}

function strikeStriker(cls, ms) {
  const striker = document.getElementById("handStriker");
  if (!striker) return;
  striker.classList.remove("strike", "flip", "tap");
  void striker.offsetWidth;
  striker.classList.add(cls);
  setTimeout(() => striker.classList.remove(cls), ms);
}

function animateHand(gesture, aksharaIdx) {
  const host = $("handSvgWrap");
  if (!host) return;
  buildHandPanel();
  if (gesture === lastGestureShown) return;
  lastGestureShown = gesture;

  const countBig = $("countBig");
  const angaBig = $("angaBig");

  if (gesture.startsWith("clap")) {
    angaBig.textContent = "LAGHU";
    $("handDesc").textContent = "strike the palm (thatthu)";
    countBig.textContent = "👏";
    countBig.className = "hand-count clap pop";
    setTimeout(() => countBig.classList.remove("pop"), 150);
    strikeStriker("strike", 260);
    popCount("ta");
  } else if (gesture.startsWith("count")) {
    const num = gesture.split(" ")[1];
    angaBig.textContent = "LAGHU";
    $("handDesc").textContent = "count the fingers on the palm";
    countBig.textContent = num;
    countBig.className = "hand-count pop";
    setTimeout(() => countBig.classList.remove("pop"), 150);
    strikeStriker("tap", 240);
    popCount(num);
  } else if (gesture.startsWith("wave")) {
    angaBig.textContent = "DRUTHAM";
    $("handDesc").textContent = "flip and strike the back (venu)";
    countBig.textContent = "👋";
    countBig.className = "hand-count wave pop";
    setTimeout(() => countBig.classList.remove("pop"), 160);
    strikeStriker("flip", 480);
    popCount("vak");
  } else {
    angaBig.textContent = "ANUDHRUTHAM";
    $("handDesc").textContent = "single tap (venu)";
    countBig.textContent = "👆";
    countBig.className = "hand-count pop";
    setTimeout(() => countBig.classList.remove("pop"), 140);
    strikeStriker("tap", 240);
    popCount("ta");
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
  const gesture = cur.anga === "L"
    ? (cur.indexInAnga === 0 ? "clap" : "count " + (cur.indexInAnga + 1))
    : cur.anga === "D" ? "wave" : "tap";
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

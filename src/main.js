import { buildTala, FAMILIES, JAATHIS } from "./talas.js";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

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

/* ---------------- the hand, in 3D ---------------- */
/* Rigged model: "Rigged Hand" by J-Toastie (poly.pizza), CC-BY.
   The tala is performed on the rig's real bones: the wrist dips for the
   laghu strike, each finger folds onto the palm in counting order
   (little -> ring -> middle -> index), and the palm flips for the drutham. */

const FINGERS = [
  // each finger curls at its real joints (root -> lower -> middle -> tip)
  { chain: ["PinkyRoot", "PinkyF_lower", "PinkyF_middle", "PinkyF_tip"], tip: "PinkyF_tip",  max: 1.5 },
  { chain: ["RingRoot", "RingF_lower", "RingF_middle", "RingF_tip"],    tip: "RingF_tip",   max: 1.45 },
  { chain: ["MiddleRoot", "MiddleF_lower", "MiddleF_middle", "MiddleF_tip"], tip: "MiddleF_tip", max: 1.4 },
  { chain: ["IndexRoot", "IndexF_lower", "IndexF_middle", "IndexF_tip"], tip: "IndexF_tip",  max: 1.35 },
];

const hand3d = {
  ready: false, renderer: null, scene: null, cam: null, clock: null,
  armature: null, fingers: [],
  strike: 0, strikeTarget: 0,
  flip: 0, flipTarget: 0,
};

let lastGestureShown = "";

window.__hand = hand3d; // tuning/debug handle

function buildHandPanel() {
  const host = $("handSvgWrap");
  if (host.dataset.built) return;
  host.dataset.built = "1";
  host.innerHTML = `<canvas id="handGL"></canvas>`;
  initHand3D(host);
}

function initHand3D(host) {
  const canvas = $("handGL");
  const W = () => host.clientWidth || 220;
  const H = () => Math.round(W() * 1.05);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const resize = () => {
    renderer.setSize(W(), H(), false);
    hand3d.cam.aspect = W() / H();
    hand3d.cam.updateProjectionMatrix();
  };

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, W() / H(), 0.1, 50);
  cam.position.set(0, 0.03, 2.75);
  cam.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xfff2e2, 0x2a2a35, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(1.4, 2.2, 2.6); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9db8ff, 1.1); rim.position.set(-2.2, 0.8, -1.6); scene.add(rim);

  hand3d.renderer = renderer; hand3d.scene = scene; hand3d.cam = cam;
  hand3d.clock = new THREE.Clock();
  resize();
  new ResizeObserver(resize).observe(host);

  new GLTFLoader().load(
    "/models/rigged-hand.glb",
    (gltf) => {
      const model = gltf.scene;
      model.updateWorldMatrix(true, true);

      // pose the hand the way the tala is taught: your right palm resting up on
      // the table in front of you, fingers pointing away, seen from above
      const at = (n, v = new THREE.Vector3()) => model.getObjectByName(n).getWorldPosition(v);
      const f = at("IndexF_tip").sub(at("IndexRoot")).normalize();   // along the fingers
      const backN = at("PinkyF_tip").sub(at("HandMain"))
        .cross(at("IndexF_tip").sub(at("HandMain"))).normalize();   // out of the back of the hand
      const s3 = new THREE.Vector3().crossVectors(f, backN).normalize();
      const s2 = backN.clone().sub(s3.clone().multiplyScalar(backN.dot(s3))).normalize();
      const s1 = new THREE.Vector3().crossVectors(s2, s3).normalize();
      const S = new THREE.Matrix4().makeBasis(s1, s2, s3);
      // source (fingers, back-normal, thumb-side) -> target (away, up, right)
      const E = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)
      );
      model.quaternion.setFromRotationMatrix(E.multiply(S.transpose()));
      // palm up: half-turn about the fingers axis
      model.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
      model.updateMatrixWorld(true);

      // center the bone cloud on the origin
      const cloud = ["HandMain", "ThumbTop", "IndexF_tip", "MiddleF_tip", "RingF_tip", "PinkyF_tip"];
      const recenter = () => {
        const pts = cloud.map((n) => at(n));
        const c = pts.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / pts.length);
        model.position.sub(c);
        model.updateMatrixWorld(true);
      };
      recenter();

      // camera: overhead like standing over the table, framed on the bounding sphere
      const fitCamera = () => {
        // frame above the knuckles so the wrist runs off the bottom edge —
        // unmistakably your own arm seen from above, not a floating palm
        const tips = ["IndexF_tip", "MiddleF_tip", "RingF_tip", "PinkyF_tip"]
          .map((n) => at(n));
        const tipMean = tips.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / tips.length);
        const look = tipMean.clone().multiplyScalar(0.35);
        // frame is sized to the fingertips only — the wrist drops off the bottom edge
        const Rtips = Math.max(...tips.map((v) => v.clone().sub(look).length()));
        const dir = new THREE.Vector3(0, 3.0, 0.95).normalize(); // nearly straight down, like looking at your palm on the table
        const dist = Rtips / (0.413 * Math.tan(Math.PI / 12));
        hand3d.cam.position.copy(look.clone().add(dir.clone().multiplyScalar(dist)));
        hand3d.cam.lookAt(look);
        hand3d.cam.updateProjectionMatrix();
      };
      fitCamera();

      // straighten the fan: twist about the vertical until the fingertips sit over the wrist
      const lean = () => {
        const w = at("HandMain").clone().project(hand3d.cam).x;
        const tips = ["IndexF_tip", "MiddleF_tip", "RingF_tip", "PinkyF_tip"]
          .map((n) => at(n).clone().project(hand3d.cam).x);
        return (tips.reduce((a, b) => a + b, 0) / 4 - w) * 100;
      };
      const probe = 0.15;
      const qProbe = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), probe);
      model.quaternion.premultiply(qProbe); model.updateMatrixWorld(true);
      const d1 = lean();
      model.quaternion.premultiply(qProbe.clone().invert()); model.updateMatrixWorld(true);
      const d0 = lean();
      const rate = (d1 - d0) / probe;
      if (Math.abs(rate) > 1e-3) {
        model.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0), -d0 / rate
        ));
      }
      model.updateMatrixWorld(true);
      recenter();
      fitCamera();

      const group = new THREE.Group();
      group.add(model);
      // mirror view — the way your own right hand appears in a mirror (and in
      // selfie-style demo videos): palm up, thumb on the left
      group.scale.set(-1, 1, 1);
      model.traverse((o) => { if (o.isMesh && o.material) o.material.side = THREE.DoubleSide; });
      scene.add(group);
      hand3d.armature = group;

      // figure out every finger's curl axis from the rest pose
      model.updateWorldMatrix(true, true);
      const knuckleNames = ["IndexRoot", "MiddleRoot", "RingRoot", "PinkyRoot"];
      const knuckles = knuckleNames
        .map((n) => model.getObjectByName(n))
        .filter(Boolean)
        .map((b) => b.getWorldPosition(new THREE.Vector3()));
      const palmCenter = knuckles
        .reduce((a, v) => a.add(v), new THREE.Vector3())
        .multiplyScalar(1 / knuckles.length);

      for (const f of FINGERS) {
        const tipBone = model.getObjectByName(f.tip);
        if (!tipBone) continue;
        // every joint of the chain curls around its own knuckle — a real finger curl,
        // not one stiff stick rotating from the base
        const joints = [];
        for (let i = 0; i < f.chain.length; i++) {
          const bone = model.getObjectByName(f.chain[i]);
          if (!bone) continue;
          const childName = f.chain[i + 1] || f.tip + "_end";
          const child = model.getObjectByName(childName) || tipBone;
          bone.updateWorldMatrix(true, false);
          const qRest = bone.quaternion.clone();
          const bp = bone.getWorldPosition(new THREE.Vector3());
          const cp = child.getWorldPosition(new THREE.Vector3());
          const dir = cp.clone().sub(bp).normalize();
          const inward = palmCenter.clone().sub(cp).normalize();
          const axisW = new THREE.Vector3().crossVectors(dir, inward).normalize();
          // sign check: rotating +eps around axisW must pull the child toward the palm
          const eps = new THREE.Quaternion().setFromAxisAngle(axisW, 0.2);
          const moved = dir.clone().applyQuaternion(eps).multiplyScalar(bp.distanceTo(cp)).add(bp);
          if (moved.sub(cp).dot(inward) < 0) axisW.negate();
          const invW = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
          joints.push({ bone, qRest, axisL: axisW.applyQuaternion(invW).normalize(), share: 0 });
        }
        // the base knuckle carries most of the curl, decreasing along the chain
        const shares = [0.45, 0.3, 0.2, 0.05].slice(0, joints.length);
        const sum = shares.reduce((a, b) => a + b, 0);
        joints.forEach((j, i) => (j.share = shares[i] / sum));
        hand3d.fingers.push({ joints, max: f.max, fold: 0, target: 0 });
      }

      // (orientation baked above via the basis quaternion — right-hand palm view)
      hand3d.ready = true;
    },
    undefined,
    (err) => console.error("hand model failed to load", err)
  );

  const loop = () => { requestAnimationFrame(loop); tickHand(); };
  loop();
}

const _q = new THREE.Quaternion();
function tickHand() {
  const h = hand3d;
  if (!h.ready) return;
  const dt = Math.min(h.clock.getDelta(), 0.05);
  h.strike += (h.strikeTarget - h.strike) * Math.min(1, dt * 16);
  h.flip += (h.flipTarget - h.flip) * Math.min(1, dt * 11);
  if (h.armature) {
    h.armature.rotation.x = -0.35 * h.strike;
    h.armature.position.y = -0.18 * h.strike; // press toward the table
    h.armature.rotation.z = Math.PI * 0.95 * h.flip; // turn over for the drutham
    h.armature.rotation.y = 0.3 * h.flip;
  }
  for (const f of h.fingers) {
    f.fold += (f.target - f.fold) * Math.min(1, dt * 13);
    for (const j of f.joints) {
      j.bone.quaternion.copy(j.qRest).premultiply(_q.setFromAxisAngle(j.axisL, f.fold * f.max * j.share));
    }
  }
  h.renderer.render(h.scene, h.cam);
}

function strikeHand3D(power) {
  hand3d.strikeTarget = power;
  setTimeout(() => (hand3d.strikeTarget = 0), 150);
}

function foldAll() { hand3d.fingers.forEach((f) => (f.target = 1)); }

function liftFinger(n) {
  const f = hand3d.fingers[((n - 1) % 4)];
  if (f) f.target = 0;
}

function animateHand(gesture, aksharaIdx) {
  const host = $("handSvgWrap");
  if (!host) return;
  buildHandPanel();
  const key = gesture + ":" + (aksharaIdx % tala.total);
  if (key === lastGestureShown) return;
  lastGestureShown = key;

  const angaBig = $("angaBig");

  if (gesture.startsWith("clap")) {
    angaBig.textContent = "LAGHU";
    $("handDesc").textContent = "strike the palm (thatthu)";
    hand3d.flipTarget = 0; // the palm turns back up for the new laghu
    strikeHand3D(1);
    foldAll(); // the hand closes to a loose fist, ready to count
  } else if (gesture.startsWith("count")) {
    angaBig.textContent = "LAGHU";
    $("handDesc").textContent = "count the fingers on the palm";
    // the count order: the little lifts first, then the ring, then the middle
    const posInAnga = tala.aksharas[aksharaIdx % tala.total].indexInAnga;
    liftFinger(posInAnga);
  } else if (gesture.startsWith("wave")) {
    // drutham is two movements: first a strike (tha), then flip and strike the back (venu)
    const beat = tala.aksharas[aksharaIdx % tala.total].indexInAnga; // 0 or 1
    if (beat === 0) {
      angaBig.textContent = "DRUTHAM";
      $("handDesc").textContent = "strike (tha)";
      // if the palm is still turned over from the previous drutham, bring it back as we strike
      if (hand3d.flipTarget === 1) {
        hand3d.flipTarget = 0;
        setTimeout(() => strikeHand3D(0.8), 180);
      } else {
        strikeHand3D(0.8);
      }
    } else {
      angaBig.textContent = "DRUTHAM";
      $("handDesc").textContent = "flip and strike the back (venu)";
      hand3d.flipTarget = 1; // the palm turns over…
      setTimeout(() => strikeHand3D(0.6), 200); // …and the strike lands as it turns
    }
  } else {
    angaBig.textContent = "ANUDHRUTHAM";
    $("handDesc").textContent = "single tap (venu)";
    strikeHand3D(0.55);
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

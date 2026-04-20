// ---------- WEBGL SHADER BACKGROUND ----------
(function () {
  const canvas = document.getElementById('shader-bg');

  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) return;

  const VS = `
    attribute vec2 a_pos;
    void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
  `;

  const FS = `
    precision mediump float;
    uniform float iTime;
    uniform vec2  iResolution;
    uniform vec2  uOffsets[32];

    void main() {
      vec2 uv = gl_FragCoord.xy / iResolution.xy;
      uv.x *= iResolution.x / iResolution.y;

      vec3 col = vec3(0.0);

      float t = iTime * 0.35;

      for (int i = 0; i < 32; i++) {
        float fi = float(i);

        vec2 p = vec2(
          0.5 + 0.35 * sin(t * (0.25 + 0.02 * fi) + fi * 3.17)
              + 0.08 * cos(t * (0.40 + 0.01 * fi) + fi * 1.91),
          0.5 + 0.35 * cos(t * (0.30 + 0.015 * fi) + fi * 2.41)
              + 0.08 * sin(t * (0.38 + 0.01 * fi) + fi * 4.73)
        );

        p.x *= iResolution.x / iResolution.y;
        p   += uOffsets[i];

        float d = length(uv - p);

        float glow = 0.0001 / (d * d + 0.0001);
        float core = smoothstep(0.006, 0.0, d);

        col += vec3(0.20) * (glow + core * 0.4);
      }

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER,   VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1,-1,  1,-1,  -1,1,
    -1, 1,  1,-1,   1,1,
  ]), gl.STATIC_DRAW);

  const aPos     = gl.getAttribLocation(prog,  'a_pos');
  const uTime    = gl.getUniformLocation(prog, 'iTime');
  const uRes     = gl.getUniformLocation(prog, 'iResolution');
  const uOffsets = gl.getUniformLocation(prog, 'uOffsets[0]');

  // ── Per-dot physics ────────────────────────────────────────────────────────
  const NUM_DOTS   = 32;
  const dotOffsetX = new Float32Array(NUM_DOTS); // accumulated position offset
  const dotOffsetY = new Float32Array(NUM_DOTS);
  const dotVelX    = new Float32Array(NUM_DOTS); // velocity
  const dotVelY    = new Float32Array(NUM_DOTS);
  const offsetBuf  = new Float32Array(NUM_DOTS * 2); // interleaved for uniform2fv

  // Tune these to control the feel:
  const REPULSION = 0.000018; // force magnitude — keep small for subtle push
  const DAMPING   = 0.984;    // per-frame velocity decay (higher = longer glide)
  const MAX_SPEED = 0.002;    // hard cap so dots never fly off wildly
  const WRAP_PAD  = 0.035;    // small overscan so blurred edges wrap cleanly

  // Mouse position in normalised 0-1 coords (y-up to match WebGL)
  let mouseX = 0, mouseY = 0, mouseActive = false;
  window.addEventListener('mousemove', (e) => {
    mouseX      = e.clientX / window.innerWidth;
    mouseY      = 1.0 - e.clientY / window.innerHeight;
    mouseActive = true;
  });

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  const t0 = performance.now();

  let bgFadedIn = false;

  function render() {
    const t      = (performance.now() - t0) / 1000;
    const aspect = canvas.width / canvas.height;
    const shT    = t * 0.35; // matches shader's `float t = iTime * 0.35`

    // ── Physics update ───────────────────────────────────────────────────────
    const mx = mouseX * aspect;
    const my = mouseY;

    for (let i = 0; i < NUM_DOTS; i++) {
      // Replicate shader base position (aspect-corrected, same formulae)
      const fi = i;
      const bx = (0.5 + 0.35 * Math.sin(shT * (0.25 + 0.02*fi) + fi*3.17)
                       + 0.08 * Math.cos(shT * (0.40 + 0.01*fi) + fi*1.91)) * aspect;
      const by =  0.5 + 0.35 * Math.cos(shT * (0.30 + 0.015*fi) + fi*2.41)
                       + 0.08 * Math.sin(shT * (0.38 + 0.01*fi) + fi*4.73);

      if (mouseActive) {
        const dx    = (bx + dotOffsetX[i]) - mx;
        const dy    = (by + dotOffsetY[i]) - my;
        const dist2 = dx*dx + dy*dy;
        // 1/r force; +0.004 floor avoids singularity when cursor is on top of dot
        const force = REPULSION / (dist2 + 0.004);
        dotVelX[i] += dx * force;
        dotVelY[i] += dy * force;
      }

      // Hard speed cap — prevents runaway accumulation
      const speed = Math.sqrt(dotVelX[i]*dotVelX[i] + dotVelY[i]*dotVelY[i]);
      if (speed > MAX_SPEED) {
        const inv   = MAX_SPEED / speed;
        dotVelX[i] *= inv;
        dotVelY[i] *= inv;
      }

      // Integrate
      dotOffsetX[i] += dotVelX[i];
      dotOffsetY[i] += dotVelY[i];

      // Wrap dots to the opposite side once their rendered position exits the
      // viewport so the same number of dots is always present on screen.
      const wrapWidth  = aspect + WRAP_PAD * 2;
      const wrapHeight = 1 + WRAP_PAD * 2;
      let worldX = bx + dotOffsetX[i];
      let worldY = by + dotOffsetY[i];

      while (worldX < -WRAP_PAD) {
        dotOffsetX[i] += wrapWidth;
        worldX += wrapWidth;
      }
      while (worldX > aspect + WRAP_PAD) {
        dotOffsetX[i] -= wrapWidth;
        worldX -= wrapWidth;
      }
      while (worldY < -WRAP_PAD) {
        dotOffsetY[i] += wrapHeight;
        worldY += wrapHeight;
      }
      while (worldY > 1 + WRAP_PAD) {
        dotOffsetY[i] -= wrapHeight;
        worldY -= wrapHeight;
      }

      // Damping — high value = long smooth glide before stopping
      dotVelX[i] *= DAMPING;
      dotVelY[i] *= DAMPING;

      offsetBuf[i*2]   = dotOffsetX[i];
      offsetBuf[i*2+1] = dotOffsetY[i];
    }

    // ── Draw ─────────────────────────────────────────────────────────────────
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uRes,  canvas.width, canvas.height);
    gl.uniform2fv(uOffsets, offsetBuf);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Fade in after the first frame has been drawn
    if (!bgFadedIn) {
      bgFadedIn = true;
      canvas.style.opacity = '1';
    }
    requestAnimationFrame(render);
  }

  render();
})();

// ---------- INTRO ----------
const intro = document.getElementById('intro');
const phone = document.getElementById('phone-container');

const UI_SOUND_CONFIG = {
  delete: { src: 'sounds/delete.wav', volume: 0.75 },
  enter: { src: 'sounds/enter.wav', volume: 0.8 },
  exit: { src: 'sounds/exit.wav', volume: 0.8 },
  leave: { src: 'sounds/leave.wav', volume: 0.54 },
  select: { src: 'sounds/select.wav', volume: 0.8 },
  type: { src: 'sounds/type.wav', volume: 0.75 },
  open: { src: 'sounds/open.wav', volume: 0.85 },
  tick: { src: 'sounds/tick.wav', volume: 0.7 },
};

const uiSoundTemplates = {};
Object.entries(UI_SOUND_CONFIG).forEach(([name, config]) => {
  const audio = new Audio(config.src);
  audio.preload = 'auto';
  audio.volume = config.volume;
  uiSoundTemplates[name] = audio;
});

function playUiSound(name, options = {}) {
  if (soundMuted) return;

  const template = uiSoundTemplates[name];
  if (!template) return;

  const audio = template.cloneNode();
  audio.volume = template.volume;
  if (typeof options.playbackRate === 'number') {
    audio.playbackRate = options.playbackRate;
  }
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {});
  }
}

window._playUiSound = playUiSound;

const AMBIENCE_VOLUME = 0.34;
const ambienceAudio = new Audio('sounds/ambience.wav');
ambienceAudio.preload = 'auto';
ambienceAudio.loop = true;

let soundMuted = false;
let ambienceReady = false;
const ambienceToggle = document.getElementById('ambience-toggle');
const managedAudioBaseVolumes = new Map();

function applyManagedAudioVolume(audio, baseVolume = managedAudioBaseVolumes.get(audio) ?? audio.volume ?? 1) {
  if (!(audio instanceof HTMLMediaElement)) return;
  audio.volume = Math.max(0, Math.min(1, baseVolume * (soundMuted ? 0 : 1)));
}

function registerManagedAudio(audio, baseVolume = audio.volume ?? 1) {
  if (!(audio instanceof HTMLMediaElement)) return audio;
  managedAudioBaseVolumes.set(audio, baseVolume);
  applyManagedAudioVolume(audio, baseVolume);
  return audio;
}

function setManagedAudioBaseVolume(audio, baseVolume) {
  if (!(audio instanceof HTMLMediaElement)) return;
  managedAudioBaseVolumes.set(audio, baseVolume);
  applyManagedAudioVolume(audio, baseVolume);
}

function syncSoundState() {
  managedAudioBaseVolumes.forEach((baseVolume, audio) => {
    applyManagedAudioVolume(audio, baseVolume);
  });
  if (!ambienceToggle) return;
  ambienceToggle.classList.toggle('is-muted', soundMuted);
  ambienceToggle.setAttribute('aria-pressed', String(soundMuted));
  ambienceToggle.setAttribute('aria-label', soundMuted ? 'Unmute sound' : 'Mute sound');
}

function startAmbienceLoop() {
  ambienceReady = true;
  syncSoundState();
  if (!ambienceAudio.paused) return;

  const playPromise = ambienceAudio.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {});
  }
}

ambienceAudio.addEventListener('ended', () => {
  if (!ambienceReady || !ambienceAudio.paused) return;
  ambienceAudio.currentTime = 0;
  const playPromise = ambienceAudio.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {});
  }
});

ambienceToggle?.addEventListener('mousedown', (e) => {
  e.preventDefault();
});

ambienceToggle?.addEventListener('click', () => {
  soundMuted = !soundMuted;
  syncSoundState();
  ambienceToggle.blur();
});

registerManagedAudio(ambienceAudio, AMBIENCE_VOLUME);
syncSoundState();
window._startAmbienceLoop = startAmbienceLoop;
window._isSoundMuted = () => soundMuted;
window._registerManagedAudio = registerManagedAudio;
window._setManagedAudioBaseVolume = setManagedAudioBaseVolume;

// Hide intro immediately — boot sequence runs on the phone screen texture
intro.style.display = 'none';

let phoneReady = false;

function showPhone() {
  intro.style.display = 'none';
  // Schedule class add at the start of the next paint frame so the browser
  // doesn't need to do an emergency layer promotion mid-frame
  requestAnimationFrame(() => {
    phone.classList.add('fade-in');
    phone.addEventListener('transitionend', () => {
      phone.style.opacity = '1'; // lock opacity in case class is removed later
      phoneReady = true;
    }, { once: true });
  });
  // Reveal "click to begin" text together with the phone fade-in
  if (!window._INSPECT_MODE) {
    document.getElementById('click-to-begin')?.classList.add('visible');
  }
  window.dispatchEvent(new CustomEvent('phone-ready'));
}

// Wait for Three.js module to be ready before showing phone
if (window._moduleReady) {
  showPhone();
} else {
  window.addEventListener('module-ready', showPhone, { once: true });
}

// Feed keyboard characters to the password state machine
document.addEventListener('keydown', (e) => {
  if (window._screenState !== 'password') return;
  if (e.key === 'Backspace') {
    window._addPasswordChar('backspace');
  } else if (e.key === 'Enter') {
    window._addPasswordChar('enter');
  } else if (e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
    window._addPasswordChar(e.key.toLowerCase());
  }
});

// ---------- TAB NAVIGATION ----------

const tabs = [
  { name: 'about',    icon: 'assets/about.png',    label: 'about me'  },
  { name: 'projects', icon: 'assets/projects.png', label: 'projects'  },
  { name: 'skills',   icon: 'assets/skills.png',   label: 'skills'    },
  { name: 'contact',  icon: 'assets/contact.png',  label: 'contact'   },
  { name: 'socials',  icon: 'assets/socials.png',  label: 'my socials'},
];

const SLOT_W = 90; // must match CSS .track-slot width

const track  = document.getElementById('icon-track');
const tslots = [0,1,2,3,4].map(i => document.getElementById(`tslot-${i}`));

let activeTab   = 0;
window._activeTab = 0;
let isAnimating = false;

// Populate all 5 slots from current activeTab
function updateAllSlots() {
  const N = tabs.length;
  tslots.forEach((slot, i) => {
    const tabIdx = (activeTab + i - 2 + N) % N;
    const img    = slot.querySelector('img');
    img.src          = tabs[tabIdx].icon;
    img.dataset.tab  = tabs[tabIdx].name;
    slot.dataset.tab = tabs[tabIdx].name;
    slot.querySelector('.slot-label').textContent = tabs[tabIdx].label;
    slot.classList.toggle('active', i === 2);
  });
  window._activeTab = activeTab;
}

function navigate(direction) {
  if (isAnimating || isZoomAnimating) return;
  isAnimating = true;
  playUiSound('tick');

  // Clean up current state before sliding
  if (activeContent) closeContent();
  if (projectsDropdownOpen) closeProjectsDropdown(true);
  if (socialDropdownOpen) closeSocialDropdown(true);

  const N             = tabs.length;
  const newActiveIdx  = direction === 1 ? 3 : 1; // which slot becomes active during slide
  const newActiveTab  = (activeTab + direction + N) % N;
  window._activeTab = newActiveTab;

  // Move active class to the incoming slot NOW — this fires the
  // size/filter CSS transition in sync with the track slide
  tslots.forEach((s, i) => s.classList.toggle('active', i === newActiveIdx));
  tslots[newActiveIdx].querySelector('img').dataset.tab        = tabs[newActiveTab].name;
  tslots[newActiveIdx].dataset.tab                             = tabs[newActiveTab].name;
  tslots[newActiveIdx].querySelector('.slot-label').textContent = tabs[newActiveTab].label;

  // Slide the track
  track.style.transition = 'transform 0.22s ease';
  track.style.transform  = direction === 1
    ? `translateX(${-2 * SLOT_W}px)`
    : `translateX(0px)`;

  setTimeout(() => {
    activeTab = newActiveTab;

    // Freeze all transitions (img + ::before) so snap + reshuffle is invisible
    track.classList.add('snapping');
    track.style.transition = 'none';
    track.style.transform  = `translateX(${-SLOT_W}px)`;

    updateAllSlots();

    // Re-enable transitions after reflow
    void track.offsetWidth;
    track.classList.remove('snapping');

    isAnimating = false;
  }, 230);
}

document.addEventListener('keydown', (e) => {
  if (!window._screenFacingCamera) return;

  // ── Zoom overlay is open (charitystream / trails / about / skills) ────────
  const overlay = document.getElementById('zoom-overlay');
  if (overlay && overlay.style.display === 'block') {
    if (e.key === 'Escape') {
      if (window._isZoomedIn && window._isZoomedIn()) {
        fadeOutOverlay(() => window._startZoomOut());
      } else {
        fadeOutOverlay();
      }
    }
    return;
  }

  if (window._screenState !== 'home') return;

  // ── Coming soon card is open (stays inside sub-nav) ─────────────────────
  if (window._comingSoonOpen) {
    if (e.key === 'Escape' && window._dismissComingSoon) window._dismissComingSoon();
    return;
  }

  // ── Canvas sub-nav is open ───────────────────────────────────────────────
  if (window._subNavOpen) {
    if      (e.key === 'ArrowLeft')  window._shiftSubNav(-1);
    else if (e.key === 'ArrowRight') window._shiftSubNav(1);
    else if (e.key === 'ArrowUp')    window._closeSubNav();
    else if (e.key === 'Enter')      window._selectSubNav();
    else if (e.key === 'Escape')     window._closeSubNav();
    return;
  }

  // ── Zoomed in (about / skills) ───────────────────────────────────────────
  if (window._isZoomedIn && window._isZoomedIn()) {
    if (e.key === 'Escape') window._startZoomOut();
    return;
  }

  if (isAnimating || isZoomAnimating) return;

  // ── Normal nav ────────────────────────────────────────────────────────────
  if      (e.key === 'ArrowLeft')  navigate(-1);
  else if (e.key === 'ArrowRight') navigate(1);
  else if (e.key === 'ArrowDown') {
    const name = tabs[activeTab].name;
    if ((name === 'projects' || name === 'socials') && window._openSubNav) {
      window._playUiSound?.('select');
      window._openSubNav(name);
    }
  }
  else if (e.key === 'Enter')      handleTabEnter();
});

const TRACKPAD_GESTURE_THRESHOLD = 42;
const TRACKPAD_GESTURE_COOLDOWN = 140;
let trackpadGestureAccum = 0;
let trackpadGestureAxis = null;
let trackpadGestureCooldownUntil = 0;
let trackpadGestureResetTimer = null;

function resetTrackpadGesture() {
  trackpadGestureAccum = 0;
  trackpadGestureAxis = null;
  if (trackpadGestureResetTimer) {
    clearTimeout(trackpadGestureResetTimer);
    trackpadGestureResetTimer = null;
  }
}

window.addEventListener('wheel', (e) => {
  if (!window._screenFacingCamera) return;

  const overlay = document.getElementById('zoom-overlay');
  if (overlay && overlay.style.display === 'block') return;
  if (window._screenState !== 'home') return;
  if (window._comingSoonOpen) return;
  if (isAnimating || isZoomAnimating) return;

  const dominantAxis = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? 'x' : 'y';
  const dominantDelta = dominantAxis === 'x' ? e.deltaX : e.deltaY;
  if (Math.abs(dominantDelta) < 4) return;

  const now = performance.now();
  if (now < trackpadGestureCooldownUntil) {
    e.preventDefault();
    return;
  }

  if (trackpadGestureAxis && dominantAxis !== trackpadGestureAxis) {
    resetTrackpadGesture();
  }

  trackpadGestureAxis = dominantAxis;
  trackpadGestureAccum += dominantDelta;

  if (trackpadGestureResetTimer) clearTimeout(trackpadGestureResetTimer);
  trackpadGestureResetTimer = setTimeout(resetTrackpadGesture, 180);

  if (Math.abs(trackpadGestureAccum) < TRACKPAD_GESTURE_THRESHOLD) return;

  e.preventDefault();

  const direction = trackpadGestureAccum > 0 ? 1 : -1;
  resetTrackpadGesture();
  trackpadGestureCooldownUntil = now + TRACKPAD_GESTURE_COOLDOWN;

  if (window._subNavOpen) {
    window._shiftSubNav(direction);
    return;
  }

  navigate(direction);
}, { passive: false });

// ---------- ZOOM ----------

const phoneScreen   = document.getElementById('phone-screen');
const phoneFloatWrap = document.getElementById('phone-float-wrap');

function setFloatAnimation(enabled) {
  const wrap = document.getElementById('phone-float-wrap');
  if (enabled) {
    wrap.classList.remove('float-paused');
    wrap.style.animationPlayState = '';
  } else {
    wrap.classList.add('float-paused');
    wrap.style.animationPlayState = 'paused';
  }
}
window._setFloatAnimation = setFloatAnimation;
const phoneImg    = document.getElementById('phone-img');
const iconWrapper = document.getElementById('icon-track-wrapper');
const zoomLabelEl = document.getElementById('zoom-label');

let isZoomedIn      = false;
let isZoomAnimating = false;
let zoomStartTime   = 0;
const ZOOM_DURATION = 400;
let offsetAtZoomStart = { x: 0, y: 0 };
const centeredOffset  = () => ({
  x: (window.innerWidth  - phoneScreen.offsetWidth)  / 2,
  y: (window.innerHeight - phoneScreen.offsetHeight) / 2,
});

function getZoomTransform() {
  const rect  = phoneScreen.getBoundingClientRect();
  const scale = Math.min(
    window.innerWidth  / rect.width,
    window.innerHeight / rect.height
  );
  const scaledW    = rect.width  * scale;
  const scaledH    = rect.height * scale;
  const targetLeft = (window.innerWidth  - scaledW) / 2;
  const targetTop  = (window.innerHeight - scaledH) / 2;
  return `translate(${targetLeft - rect.left}px, ${targetTop - rect.top}px) scale(${scale})`;
}

function zoomIn() {
  if (!phoneReady || isZoomedIn || isZoomAnimating) return;
  isZoomAnimating = true;

  phoneFloatWrap.classList.add('float-paused');

  const rect = phoneScreen.getBoundingClientRect();
  offsetAtZoomStart = { x: rect.left, y: window.innerHeight - rect.bottom };
  zoomStartTime = performance.now();

  // Fade out nav icons and bezel — only the shader background remains during zoom
  iconWrapper.style.opacity = '0';
  iconWrapper.style.pointerEvents = 'none';
  phoneImg.style.opacity = '0';

  // Zoom and remove edge mask
  phoneScreen.style.transform = getZoomTransform();
  phoneScreen.classList.add('zoomed');

  // Show label after zoom completes
  setTimeout(() => {
    const icon = document.getElementById('zoom-label-icon');
    const text = document.getElementById('zoom-label-text');
    const tabName = tabs[activeTab].name;
    if (tabName === 'about' || tabName === 'skills' || tabName === 'projects') {
      icon.src           = tabs[activeTab].icon;
      icon.style.display = 'block';
    } else {
      icon.style.display = 'none';
    }
    text.textContent = tabs[activeTab].label;
    zoomLabelEl.classList.add('visible');
    isZoomedIn      = true;
    isZoomAnimating = false;
  }, 400);
}

function zoomOut() {
  if (!isZoomedIn || isZoomAnimating) return;
  isZoomAnimating = true;

  // Hide label immediately
  zoomLabelEl.classList.remove('visible');

  // Reverse zoom and restore mask
  phoneScreen.style.transform = '';
  phoneScreen.classList.remove('zoomed');

  // Fade bezel back in during zoom-out
  phoneImg.style.opacity = '1';

  // Fade icons back in near end of zoom-out
  setTimeout(() => {
    iconWrapper.style.opacity = '';
    iconWrapper.style.pointerEvents = '';
    isZoomedIn      = false;
    isZoomAnimating = false;
    phoneFloatWrap.classList.remove('float-paused');
  }, 350);
}

// ── ZOOM CONTENT OVERLAY EVENTS ─────────────────────────────────────────────
window.addEventListener('zoom-content-show', (e) => {
  const tab     = e.detail.tab;
  const overlay = document.getElementById('zoom-overlay');
  overlay.classList.remove('fading-out');
  overlay.style.opacity = '';
  overlay.querySelectorAll('.content-page').forEach(p => p.classList.remove('active'));
  overlay.style.display = 'block';
  const page = document.getElementById('page-' + tab);
  if (page) page.classList.add('active');
});

function fadeOutOverlay(onComplete) {
  const overlay = document.getElementById('zoom-overlay');
  if (!overlay || overlay.style.display === 'none') {
    if (typeof onComplete === 'function') onComplete();
    return;
  }
  overlay.classList.add('fading-out');
  overlay.addEventListener('transitionend', function handler() {
    overlay.removeEventListener('transitionend', handler);
    overlay.classList.remove('fading-out');
    overlay.querySelectorAll('.content-page').forEach(p => p.classList.remove('active'));
    overlay.style.display = 'none';
    overlay.style.opacity = '';
    if (typeof onComplete === 'function') onComplete();
  }, { once: true });
}

window.addEventListener('zoom-content-hide', fadeOutOverlay);
window.addEventListener('show-trails', () => {
  const overlay = document.getElementById('zoom-overlay');
  overlay.querySelectorAll('.content-page').forEach(p => p.classList.remove('active'));
  overlay.style.display = 'block';
  const page = document.getElementById('page-trails');
  if (page) page.classList.add('active');
});
// ── / ZOOM CONTENT OVERLAY EVENTS ───────────────────────────────────────────

// Clicking a side slot navigates to it
tslots[1].addEventListener('click', () => { if (!window._screenFacingCamera) return; navigate(-1); });
tslots[3].addEventListener('click', () => { if (!window._screenFacingCamera) return; navigate(1); });

// Init
updateAllSlots();

// ---------- DROPDOWN + CONTENT ----------

let activeContent = null;

let projectsDropdownOpen = false;
let projectsDropdownIdx  = 0;

let socialDropdownOpen = false;
let socialDropdownIdx  = 0;

const SUB_ITEM_H = 90; // px between sub-slot centers (matches CSS sizing)

// ── Shared sub-menu helpers ──────────────────────────────────────────────────

function positionSubSlots(wrapId, idx) {
  document.querySelectorAll(`#${wrapId} .sub-slot-item`).forEach((s, i) => {
    s.style.transform = `translateX(-50%) translateY(${(i - idx) * SUB_ITEM_H}px)`;
    s.classList.toggle('active', i === idx);
  });
}

function openSubMenu(wrapId, idx) {
  const wrap  = document.getElementById(wrapId);
  const slots = wrap.querySelectorAll('.sub-slot-item');

  // Place all items off-screen below instantly (no transition)
  slots.forEach(s => {
    s.style.transition = 'none';
    s.style.transform  = `translateX(-50%) translateY(400px)`;
    s.classList.remove('active');
  });

  wrap.removeAttribute('hidden');

  // Slide nav bar down
  iconWrapper.classList.add('nav-exited');

  // Two rAFs ensure the off-screen position is painted before we start moving
  requestAnimationFrame(() => requestAnimationFrame(() => {
    slots.forEach(s => { s.style.transition = ''; });
    positionSubSlots(wrapId, idx);
  }));
}

function closeSubMenu(wrapId, instant) {
  const wrap  = document.getElementById(wrapId);
  const slots = wrap.querySelectorAll('.sub-slot-item');

  if (instant) {
    slots.forEach(s => {
      s.style.transition = 'none';
      s.style.transform  = `translateX(-50%) translateY(400px)`;
      s.classList.remove('active');
    });
    wrap.setAttribute('hidden', '');
    iconWrapper.style.transition = 'none';
    iconWrapper.classList.remove('nav-exited');
    void iconWrapper.offsetWidth;
    iconWrapper.style.transition = '';
    return;
  }

  // Slide items off screen downward
  slots.forEach(s => {
    s.style.transform = `translateX(-50%) translateY(400px)`;
    s.classList.remove('active');
  });

  // After items exit, hide wrapper and slide nav back up
  setTimeout(() => {
    wrap.setAttribute('hidden', '');
    iconWrapper.classList.remove('nav-exited');
  }, 310);
}

// ── Projects ────────────────────────────────────────────────────────────────

// Selected item sits above the anchor; spacing large enough that the
// previous icon is fully off-screen when navigating down.
const PROJ_ITEM_H        = 105; // px between item centres (wider than SUB_ITEM_H)
const PROJ_ANCHOR_OFFSET = -52; // px — selected is this far above the anchor

function positionProjectsSubSlots(idx) {
  document.querySelectorAll('#projects-subwrap .sub-slot-item').forEach((s, i) => {
    let y;
    if (i < idx) {
      // Force items above the selection well off the top — label included
      y = -400;
    } else {
      y = (i - idx) * PROJ_ITEM_H + PROJ_ANCHOR_OFFSET;
    }
    s.style.transform = `translateX(-50%) translateY(${y}px)`;
    s.classList.toggle('active', i === idx);
  });
}

function openProjectsDropdown() {
  if (projectsDropdownOpen || isAnimating || isZoomAnimating) return;
  if (tabs[activeTab].name !== 'projects') return;
  if (socialDropdownOpen) closeSocialDropdown(true);

  projectsDropdownOpen = true;
  projectsDropdownIdx  = 0;

  const wrap  = document.getElementById('projects-subwrap');
  const slots = wrap.querySelectorAll('.sub-slot-item');
  const title = document.getElementById('projects-title');

  // Place items off-screen below instantly (no transition)
  slots.forEach(s => {
    s.style.transition = 'none';
    s.style.transform  = `translateX(-50%) translateY(400px)`;
    s.classList.remove('active');
  });
  wrap.removeAttribute('hidden');

  // Nav slides UP
  iconWrapper.classList.add('nav-exited-up');

  // Two rAFs: ensure off-screen position is painted, then start animations
  requestAnimationFrame(() => requestAnimationFrame(() => {
    slots.forEach(s => { s.style.transition = ''; });
    positionProjectsSubSlots(0);
    title.classList.add('title-raised');
  }));
}

function closeProjectsDropdown(instant) {
  if (!projectsDropdownOpen) return;
  projectsDropdownOpen = false;

  const wrap  = document.getElementById('projects-subwrap');
  const slots = wrap.querySelectorAll('.sub-slot-item');
  const title = document.getElementById('projects-title');

  if (instant) {
    slots.forEach(s => {
      s.style.transition = 'none';
      s.style.transform  = `translateX(-50%) translateY(400px)`;
      s.classList.remove('active');
    });
    wrap.setAttribute('hidden', '');
    iconWrapper.style.transition = 'none';
    iconWrapper.classList.remove('nav-exited-up');
    void iconWrapper.offsetWidth;
    iconWrapper.style.transition = '';
    // Reset title without transition
    title.style.transition = 'none';
    title.classList.remove('title-raised');
    void title.offsetWidth;
    title.style.transition = '';
    return;
  }

  window._playUiSound?.('leave');

  // All three animate simultaneously:
  // 1. Sub-icons slide down off screen
  slots.forEach(s => {
    s.style.transform = `translateX(-50%) translateY(400px)`;
    s.classList.remove('active');
  });
  // 2. Title lowers back to nav-label position
  title.classList.remove('title-raised');
  // 3. Nav slides back down from top
  iconWrapper.classList.remove('nav-exited-up');

  // After transitions finish, hide the sub-wrap
  setTimeout(() => { wrap.setAttribute('hidden', ''); }, 320);
}

function shiftProjectsDropdown(dir) {
  if (!projectsDropdownOpen) return;
  const slots = document.querySelectorAll('#projects-subwrap .sub-slot-item');
  const next  = Math.max(0, Math.min(slots.length - 1, projectsDropdownIdx + dir));
  if (next === projectsDropdownIdx) return;
  projectsDropdownIdx = next;
  positionProjectsSubSlots(next);
}

function selectProjectsSub() {
  if (!projectsDropdownOpen) return;
  const slot   = document.querySelectorAll('#projects-subwrap .sub-slot-item')[projectsDropdownIdx];
  const action = slot.dataset.action;
  if (action === 'charitystream') {
    // Fade sub-icons out before/during zoom so they don't show over content
    const wrap = document.getElementById('projects-subwrap');
    wrap.style.transition    = 'opacity 0.25s ease';
    wrap.style.opacity       = '0';
    wrap.style.pointerEvents = 'none';
    const title = document.getElementById('projects-title');
    title.style.transition = 'opacity 0.25s ease';
    title.style.opacity    = '0';
    zoomIn();
    setTimeout(() => openContent('charitystream'), ZOOM_DURATION);
  } else {
    openContent('trails');
  }
}

// ── Socials ──────────────────────────────────────────────────────────────────

function positionSocialsSubSlots(idx) {
  document.querySelectorAll('#social-subwrap .sub-slot-item').forEach((s, i) => {
    let y;
    if (i < idx) {
      y = -400; // force items above selection fully off the top
    } else {
      y = (i - idx) * PROJ_ITEM_H + PROJ_ANCHOR_OFFSET;
    }
    s.style.transform = `translateX(-50%) translateY(${y}px)`;
    s.classList.toggle('active', i === idx);
  });
}

function openSocialDropdown() {
  if (socialDropdownOpen || isAnimating || isZoomAnimating) return;
  if (tabs[activeTab].name !== 'socials') return;
  if (projectsDropdownOpen) closeProjectsDropdown(true);

  socialDropdownOpen = true;
  socialDropdownIdx  = 0;

  const wrap  = document.getElementById('social-subwrap');
  const slots = wrap.querySelectorAll('.sub-slot-item');
  const title = document.getElementById('socials-title');

  slots.forEach(s => {
    s.style.transition = 'none';
    s.style.transform  = `translateX(-50%) translateY(400px)`;
    s.classList.remove('active');
  });
  wrap.removeAttribute('hidden');

  iconWrapper.classList.add('nav-exited-up');

  requestAnimationFrame(() => requestAnimationFrame(() => {
    slots.forEach(s => { s.style.transition = ''; });
    positionSocialsSubSlots(0);
    title.classList.add('title-raised');
  }));
}

function closeSocialDropdown(instant) {
  if (!socialDropdownOpen) return;
  socialDropdownOpen = false;

  const wrap  = document.getElementById('social-subwrap');
  const slots = wrap.querySelectorAll('.sub-slot-item');
  const title = document.getElementById('socials-title');

  if (instant) {
    slots.forEach(s => {
      s.style.transition = 'none';
      s.style.transform  = `translateX(-50%) translateY(400px)`;
      s.classList.remove('active');
    });
    wrap.setAttribute('hidden', '');
    iconWrapper.style.transition = 'none';
    iconWrapper.classList.remove('nav-exited-up');
    void iconWrapper.offsetWidth;
    iconWrapper.style.transition = '';
    title.style.transition = 'none';
    title.classList.remove('title-raised');
    void title.offsetWidth;
    title.style.transition = '';
    return;
  }

  window._playUiSound?.('leave');

  slots.forEach(s => {
    s.style.transform = `translateX(-50%) translateY(400px)`;
    s.classList.remove('active');
  });
  title.classList.remove('title-raised');
  iconWrapper.classList.remove('nav-exited-up');

  setTimeout(() => { wrap.setAttribute('hidden', ''); }, 320);
}

function shiftSocialDropdown(dir) {
  if (!socialDropdownOpen) return;
  const slots = document.querySelectorAll('#social-subwrap .sub-slot-item');
  const next  = Math.max(0, Math.min(slots.length - 1, socialDropdownIdx + dir));
  if (next === socialDropdownIdx) return;
  socialDropdownIdx = next;
  positionSocialsSubSlots(next);
}

function selectSocialSub() {
  if (!socialDropdownOpen) return;
  const slot   = document.querySelectorAll('#social-subwrap .sub-slot-item')[socialDropdownIdx];
  const action = slot.dataset.action;
  const urls = {
    github:   'https://github.com/aikoblisss',
    linkedin: 'https://www.linkedin.com/in/branden-greene'
  };
  if (urls[action]) window.open(urls[action], '_blank');
}

// ---------- TYPEWRITER ----------

const ABOUT_TEXT = "Hi, I'm Branden. Currently a Data Science major at UC Santa Barbara with a strong interest in full-stack web development. I've built production-grade systems end-to-end, including CharityStream, a multi-sided marketplace with Stripe billing, a PostgreSQL backend, automated cron pipelines, and serverless deployment on Vercel. I care about building things that actually work in the real world, not just demos. I'm currently open to opportunities, so if you think I'd be a good fit, let's talk.";
const CHAR_DELAY = 5; // ms per character (~3s for full about text)

let typewriterTimer = null;

function startTypewriter() {
  const textEl  = document.getElementById('about-typed-text');
  const cursor  = document.getElementById('about-cursor');
  textEl.textContent = '';
  cursor.classList.remove('cursor-done');
  cursor.style.opacity = '';

  let i = 0;
  function typeNext() {
    if (i < ABOUT_TEXT.length) {
      textEl.textContent += ABOUT_TEXT[i++];
      typewriterTimer = setTimeout(typeNext, CHAR_DELAY);
    } else {
      cursor.classList.add('cursor-done');
    }
  }
  // Delay start until box is visible (~350ms)
  typewriterTimer = setTimeout(typeNext, 350);
}

function cancelTypewriter() {
  if (typewriterTimer) { clearTimeout(typewriterTimer); typewriterTimer = null; }
}

// ---------- CONTENT ----------

function openContent(name) {
  const page = document.getElementById('page-' + name);
  page.classList.remove('active');
  void page.offsetWidth;
  page.classList.add('active');
  activeContent = name;
}

function closeContent() {
  if (!activeContent) return;
  document.getElementById('page-' + activeContent).classList.remove('active');
  activeContent = null;
}

function handleTabEnter() {
  const name = tabs[activeTab].name;
  if (name === 'contact') {
    window.open('https://mail.google.com/mail/?view=cm&to=brandengreene03@gmail.com', '_blank');
  } else if (name === 'about' || name === 'skills') {
    if (window._startZoomIn) window._startZoomIn(name);
  } else if (name === 'projects') {
    window._playUiSound?.('select');
    if (window._openSubNav) window._openSubNav('projects');
  } else if (name === 'socials') {
    window._playUiSound?.('select');
    if (window._openSubNav) window._openSubNav('socials');
  }
}

// Center slot click
tslots[2].addEventListener('click', () => {
  if (!window._screenFacingCamera) return;
  if (isAnimating || isZoomAnimating) return;
  const name = tabs[activeTab].name;
  if (name === 'contact') {
    window.open('https://mail.google.com/mail/?view=cm&to=brandengreene03@gmail.com', '_blank');
  } else if (name === 'about' || name === 'skills') {
    if (window._startZoomIn) window._startZoomIn(name);
  } else if (name === 'projects') {
    window._playUiSound?.('select');
    if (window._openSubNav) window._openSubNav('projects');
  } else if (name === 'socials') {
    window._playUiSound?.('select');
    if (window._openSubNav) window._openSubNav('socials');
  }
});

// Social sub-icons (GitHub / LinkedIn)
document.querySelectorAll('#social-subwrap .sub-slot-item').forEach(slot => {
  slot.addEventListener('click', () => {
    if (!socialDropdownOpen) return;
    const slots = Array.from(document.querySelectorAll('#social-subwrap .sub-slot-item'));
    const idx   = slots.indexOf(slot);
    if (idx !== socialDropdownIdx) {
      socialDropdownIdx = idx;
      positionSocialsSubSlots(idx);
    } else {
      selectSocialSub();
    }
  });
});

// Projects sub-icons
document.querySelectorAll('#projects-subwrap .sub-slot-item').forEach(slot => {
  slot.addEventListener('click', () => {
    if (!projectsDropdownOpen) return;
    const slots = Array.from(document.querySelectorAll('#projects-subwrap .sub-slot-item'));
    const idx   = slots.indexOf(slot);
    if (idx !== projectsDropdownIdx) {
      projectsDropdownIdx = idx;
      positionProjectsSubSlots(idx);
    } else {
      selectProjectsSub();
    }
  });
});

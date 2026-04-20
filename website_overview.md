Overview
Personal portfolio for Branden Greene. Opens with a welcome.mp4 intro animation, then presents an interactive 3D BlackBerry phone as the central UI. Visitor navigates portfolio content through tabs on the phone screen. Vanilla HTML/CSS/JS only — no frameworks, no backend. Deploy target: Vercel or GitHub Pages.

Tech Stack

HTML / CSS / JavaScript (vanilla)
Three.js (GLTFLoader, OrbitControls, CanvasTexture, raycasting)
WebGL / GLSL (custom shader pipeline)
Canvas 2D API (screen texture compositing)
Blender (mesh separation, UV unwrapping)
Static deployment — Vercel or GitHub Pages


File Structure
portfolio/
├── index.html
├── style.css
├── script.js
├── blackberry.glb         # 3D model with separated mesh components
└── assets/
    ├── welcome.mp4
    ├── ucsb.png
    ├── letters.png
    ├── about.png
    ├── charitystreamicon.png
    ├── charitystream.png
    ├── trails.png
    ├── github.png
    └── linkedin.png

Sequence of Events on Page Load

Intro spin — 3D phone starts tilted/vertical, spinning on camera Z axis. "Click phone to begin" text below. Hover speeds up rotation.
Click — rotation slows and stops with screen facing camera.
welcome.mp4 plays on phone screen (no controls, no pause).
Video ends — phone rotates clockwise (Z axis, portrait → landscape), keyboard slides down.
Password prompt — user enters password via raycasted 3D keyboard.
Home / nav state — normal tab navigation.


3D Model — Mesh Components
Named in Blender, loaded via GLTFLoader:

phone_screen — UV re-unwrapped (Angle Based); receives canvas texture
keyboard1, keyboard2 — grouped into keyboardGroup via attach() for slide animation
buttons1


Screen Texture Pipeline

Offscreen WebGL canvas renders GLSL sine wave shader
Composited onto a second canvas via Canvas 2D API
Fed into THREE.CanvasTexture with flipY = false and rotation = Math.PI / -2

GLSL Shader
Multi-layered sine wave, warm grey tones, Shadertoy-style uniforms:

iTime, iResolution, iOffset
iOffset interpolates during zoom transitions to sample the correct viewport-relative window


Keyboard Slide Animation

keyboardGroup uses attach() (not add()) to preserve world transforms
Triggered via module-ready / phone-ready custom event bridge between ES module script and script.js


Password Boot Sequence
State machine: loading → password → wrong → video → home

3D keyboard raycasting using a calibrated key coordinate lookup table
Float animation pauses during password states, resumes on login


Icon Navigation (Home Screen)

Smooth sliding via float slidePos lerping toward slideTarget
Shortest-path wrapping
Active icon centered; flanking icons smaller and desaturated


Tab Content
TabContentAboutBio — Data Science @ UCSB, full-stack focus, open to opportunitiesProjectsCharityStream (live), Bay Area Trails (coming soon)SkillsJS/Node/Express, PostgreSQL, Stripe, Vercel, Cloudflare R2, FFmpeg, etc.Contactbrandengreene03@gmail.com — opens mailtoSocialsGitHub + LinkedIn, open in new tab
Tabs cycle: About → Projects → Skills → Contact → Socials → (wraps)

Camera & Controls

controls.target stays at origin; camera position adjusted to avoid drift
OrbitControls active for development; may be locked for production


Planned / In Progress

 PS3-style XMB dropdown submenus for Projects and Socials tabs
 Camera zoom transitions when entering content pages
 Zoom-in shader animations for About/Skills pages
 Typewriter or fade-in text animations for content pages
 Decision: canvas-only vs. hybrid DOM overlay for content rendering


Key Implementation Notes

attach() vs add(): always use attach() when grouping already-placed objects
Texture fix: flipY = false + rotation = Math.PI / -2 on CanvasTexture
WebGL canvas sizing: use getBoundingClientRect() for explicit pixel dims — width: 100% CSS does not set the drawing buffer
DOM overlay approach was tried and deliberately reverted — stay canvas-only unless revisiting
Dev server: python3 -m http.server 8080 from desktop directory
Git commits are the primary undo mechanism (Claude Code compacted history is unrecoverable)
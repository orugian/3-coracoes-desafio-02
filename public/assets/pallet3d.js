/* 3C Conecta · single-pallet 3D view (v3 Taste)
   A PBR pallet base 1.20 × 1.00 m with the product's boxes in lastro × camadas, at the real box size.
   Hosts: <div class="pal" data-pal3d="<code>" data-lastro data-alt data-dims="C×L×A mm" data-fam>.
   One renderer for every host (moved to the host in use), pushed to window.__renderers.
   Render on demand only: nothing draws while idle; there is no ambient motion, so reduced motion needs no special case.
   Without WebGL (or before three.js has loaded) the host keeps its 2D drawing. */
(function () {
  const PV = { R: null, scene: null, cam: null, host: null, group: null, sig: "", az: 0.78, pol: 1.08, dist: 6, tgt: null, drag: null, raf: 0, want: null, mats: {}, geo: null, ok: null };
  window.PV = PV;
  const supported = () => {
    if (PV.ok !== null) return PV.ok;
    try { const c = document.createElement("canvas"); PV.ok = !!(window.THREE && (c.getContext("webgl") || c.getContext("experimental-webgl"))); } catch (_) { PV.ok = false; }
    if (!window.THREE) PV.ok = null; // three.js may still arrive (lazy load): ask again later
    return !!PV.ok;
  };
  function init() {
    const T = THREE;
    const R = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    R.shadowMap.enabled = true; R.shadowMap.type = T.PCFSoftShadowMap;
    if ("outputEncoding" in R) R.outputEncoding = T.sRGBEncoding;
    R.physicallyCorrectLights = true;
    const scene = new T.Scene(), cam = new T.PerspectiveCamera(32, 1.4, 0.05, 60);
    scene.add(new T.HemisphereLight(0xfff6ee, 0x8a7466, 1.6));
    const sun = new T.DirectionalLight(0xffffff, 2.4); sun.position.set(3.5, 6.5, 4.5); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera; sc.left = -1.6; sc.right = 1.6; sc.top = 3; sc.bottom = -1; sc.near = 0.5; sc.far = 16; sun.shadow.bias = -0.0008; scene.add(sun);
    const back = new T.DirectionalLight(0xffe7d6, 0.7); back.position.set(-4, 3, -3); scene.add(back);
    const ground = new T.Mesh(new T.PlaneGeometry(12, 12), new T.ShadowMaterial({ opacity: 0.18 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    PV.geo = new T.BoxGeometry(1, 1, 1);
    Object.assign(PV, { R, scene, cam, ground });
    (window.__renderers = window.__renderers || []).push(R);
    const el = R.domElement; el.setAttribute("aria-hidden", "true");
    el.addEventListener("pointerdown", e => { PV.drag = { x: e.clientX, y: e.clientY, az: PV.az, pol: PV.pol }; el.setPointerCapture && el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointermove", e => { const d = PV.drag; if (!d) return; PV.az = d.az + (e.clientX - d.x) * 0.01; PV.pol = Math.min(1.45, Math.max(0.2, d.pol - (e.clientY - d.y) * 0.008)); place(); draw(); });
    const end = () => { PV.drag = null; };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    el.addEventListener("dblclick", () => { PV.az = 0.78; PV.pol = 1.08; place(); draw(); });
    PV.ro = new ResizeObserver(() => size());
  }
  const mat = (k, color, o) => PV.mats[k] || (PV.mats[k] = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.8, metalness: 0 }, o || {})));
  function box(g, m, sx, sy, sz, x, y, z) { const b = new THREE.Mesh(PV.geo, m); b.scale.set(sx, sy, sz); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; g.add(b); return b; }
  /* PBR pallet: 1.20 (x) × 1.00 (z) × 0.144 m, top deck boards, 9 blocks, 3 bottom runners */
  function palletBase(g) {
    const wood = mat("wood", 0xc29a6b, { roughness: 0.86 }), woodD = mat("woodD", 0xa47c51, { roughness: 0.9 });
    const L = 1.2, W = 1.0, deck = 0.022, blk = 0.078, run = 0.022;
    for (let i = 0; i < 7; i++) box(g, i % 3 === 0 ? woodD : wood, L, deck, 0.1, 0, run + blk + deck / 2, -W / 2 + 0.05 + i * (W - 0.1) / 6);
    for (const x of [-L / 2 + 0.07, 0, L / 2 - 0.07]) for (const z of [-W / 2 + 0.07, 0, W / 2 - 0.07]) box(g, woodD, 0.14, blk, 0.14, x, run + blk / 2, z);
    for (const z of [-W / 2 + 0.07, 0, W / 2 - 0.07]) box(g, wood, L, run, 0.14, 0, run / 2, z);
    return run + blk + deck; // 0.122 + boards ≈ 0.144 m with the top boards
  }
  /* the lastro on a 1.20 × 1.00 deck: the grid (and box orientation) that holds `n` boxes with the least overhang */
  function layout(n, c, w) {
    let best = null;
    for (const [bx, bz] of [[c, w], [w, c]]) for (let nx = 1; nx <= n; nx++) {
      const nz = Math.ceil(n / nx), sx = nx * bx, sz = nz * bz, over = Math.max(0, sx - 1.2) + Math.max(0, sz - 1.0), waste = Math.abs(sx - 1.2) + Math.abs(sz - 1.0);
      const score = over * 10 + waste; if (!best || score < best.score) best = { nx, nz, bx, bz, score };
    }
    return best;
  }
  function dims(h) { const d = String(h.dataset.dims || "300×200×150").split(/[×x]/).map(v => parseInt(v, 10) / 1000); return { c: d[0] || 0.3, w: d[1] || 0.2, h: d[2] || 0.15 }; }
  function build(h) {
    const T = THREE, lastro = Math.max(1, Math.round(+h.dataset.lastro || 1)), alt = Math.max(1, Math.round(+h.dataset.alt || 1)), d = dims(h), color = h.dataset.color || "#8a705a";
    const sig = [lastro, alt, d.c, d.w, d.h, color].join("|"); if (sig === PV.sig) return; PV.sig = sig;
    if (PV.group) { PV.scene.remove(PV.group); PV.group.traverse(o => { if (o.isInstancedMesh) o.dispose && o.dispose(); }); }
    const g = new T.Group(), top = palletBase(g), lay = layout(lastro, d.c, d.w), n = lastro * alt;
    const boxM = mat("box" + color, new T.Color(color), { roughness: 0.74 });
    const inst = new T.InstancedMesh(PV.geo, boxM, n); inst.castShadow = true; inst.receiveShadow = true;
    const m4 = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3(lay.bx - 0.006, d.h - 0.006, lay.bz - 0.006);
    const ox = -lay.nx * lay.bx / 2, oz = -lay.nz * lay.bz / 2;
    for (let i = 0; i < n; i++) { const ly = Math.floor(i / lastro), j = i % lastro, ix = j % lay.nx, iz = Math.floor(j / lay.nx); p.set(ox + lay.bx * (ix + 0.5), top + d.h * (ly + 0.5), oz + lay.bz * (iz + 0.5)); m4.compose(p, q, s); inst.setMatrixAt(i, m4); }
    inst.instanceMatrix.needsUpdate = true; g.add(inst);
    PV.group = g; PV.scene.add(g);
    const H = top + alt * d.h, span = Math.max(1.3, lay.nx * lay.bx, lay.nz * lay.bz, H);
    PV.tgt = new T.Vector3(0, H * 0.46, 0); PV.dist = span * 2.35 + 0.6;
    const sc = PV.scene.children.find(o => o.isDirectionalLight && o.castShadow); if (sc) { sc.shadow.camera.top = H + 0.4; sc.shadow.camera.updateProjectionMatrix(); }
    place();
  }
  function place() { const c = PV.cam, t = PV.tgt || new THREE.Vector3(0, 0.8, 0), sp = Math.sin(PV.pol); c.position.set(t.x + PV.dist * sp * Math.cos(PV.az), t.y + PV.dist * Math.cos(PV.pol), t.z + PV.dist * sp * Math.sin(PV.az)); c.lookAt(t); }
  function size() { if (!PV.host || !PV.R) return; const st = PV.host.querySelector(".pal-3d"); if (!st) return; const w = st.clientWidth, h = st.clientHeight; if (!w || !h) return; PV.R.setSize(w, h, false); PV.cam.aspect = w / h; PV.cam.updateProjectionMatrix(); draw(); }
  function draw() { if (!PV.raf) PV.raf = requestAnimationFrame(() => { PV.raf = 0; if (PV.host && PV.host.isConnected && PV.R) PV.R.render(PV.scene, PV.cam); }); }
  /* Called after every render() of the app: attaches the renderer to the host in use, or parks it. */
  PV.mount = function () {
    const hosts = [...document.querySelectorAll("[data-pal3d]")].filter(h => h.offsetParent !== null);
    if (!hosts.length) { if (PV.host && PV.ro) PV.ro.unobserve(PV.host); PV.host = null; return; }
    if (!supported()) { if (PV.ok === null && window.ensureThree) window.ensureThree().then(() => { PV.ok = null; PV.mount(); }); return; }
    const h = hosts.find(x => x.dataset.pal3d === PV.want) || hosts[0];
    if (!PV.R) init();
    const stage = h.querySelector(".pal-3d");
    if (PV.host !== h) {
      if (PV.host && PV.ro) PV.ro.unobserve(PV.host);
      stage.insertBefore(PV.R.domElement, stage.firstChild); PV.host = h; PV.ro.observe(stage); PV.sig = "";
    } else if (PV.R.domElement.parentNode !== stage) stage.insertBefore(PV.R.domElement, stage.firstChild);
    hosts.forEach(x => x.classList.toggle("is3d", x === h));
    PV.host = h; build(h);
    const w = stage.clientWidth, hh = stage.clientHeight;
    if (w && hh) { PV.R.setSize(w, hh, false); PV.cam.aspect = w / hh; PV.cam.updateProjectionMatrix(); }
    PV.ro.unobserve(stage); PV.ro.observe(stage); PV.host = h;
    draw();
  };
  if (document.readyState !== "loading") setTimeout(() => PV.mount(), 0); else addEventListener("DOMContentLoaded", () => PV.mount());
})();

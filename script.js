(() => {
  'use strict';

  /* ------------------------------------------------------------------
     Réglages généraux
  ------------------------------------------------------------------ */
  const KEYS = ['rain', 'wind', 'waves', 'storm', 'fire'];
  const STORE_KEY = 'ambiances:v1';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Puissance relative de chaque canal : à ajuster à l'oreille si besoin.
  const GAIN = { rain: 0.5, wind: 0.6, waves: 1.0, storm: 1.2, fire: 0.7 };

  const DEFAULTS = { rain: 35, wind: 25, waves: 0, storm: 0, fire: 45, master: 70 };

  const PRESETS = {
    storm:   { rain: 70, wind: 40, waves: 0,  storm: 65, fire: 0 },
    beach:   { rain: 0,  wind: 25, waves: 60, storm: 0,  fire: 0 },
    cabin:   { rain: 35, wind: 30, waves: 0,  storm: 0,  fire: 70 },
    forest:  { rain: 20, wind: 45, waves: 0,  storm: 0,  fire: 0 },
    silence: { rain: 0,  wind: 0,  waves: 0,  storm: 0,  fire: 0 },
  };

  const MOODS = {
    silence: ['Silence', 'Montez un curseur ou choisissez une ambiance pour commencer.'],
    'rain+storm': ["Nuit d'orage", 'Une pluie dense et le tonnerre qui roule au loin.'],
    'storm+wind': ['Tempête', 'Des rafales et des grondements sous un ciel très bas.'],
    'storm+waves': ['Tempête en mer', 'Les vagues cognent, le tonnerre répond.'],
    'fire+storm': ["Cabane sous l'orage", 'Un feu, quatre murs et le ciel qui gronde dehors.'],
    'fire+rain': ['Abri sous la pluie', 'Le feu crépite pendant que la pluie tombe dehors.'],
    'fire+wind': ['Feu dans le vent', 'Les flammes s\u2019agitent à chaque rafale.'],
    'fire+waves': ['Feu de plage', 'Des braises, le ressac et la marée qui monte doucement.'],
    'rain+wind': ['Pluie battante', 'La pluie arrive de biais, poussée par le vent.'],
    'rain+waves': ['Pluie sur la mer', "Une averse sur l'eau, le large est tout gris."],
    'waves+wind': ['Bord de mer', 'Un vent salé et des vagues qui se répètent.'],
    fire: ['Coin du feu', 'Le bois craque, la chaleur reste tout près.'],
    rain: ['Pluie fine', 'Des gouttes régulières, sans hâte.'],
    storm: ['Orage lointain', 'Le tonnerre roule de l\u2019autre côté des collines.'],
    waves: ['Ressac', 'Le va-et-vient de la mer sur le sable.'],
    wind: ['Vent dans les arbres', 'Un souffle continu dans les feuillages.'],
  };

  /* ------------------------------------------------------------------
     Utilitaires
  ------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  /* ------------------------------------------------------------------
     État (sauvegardé dans le navigateur)
  ------------------------------------------------------------------ */
  const state = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && typeof saved === 'object') {
      for (const k of [...KEYS, 'master']) {
        if (Number.isFinite(saved[k])) state[k] = clamp(saved[k], 0, 100);
      }
    }
  } catch (e) { /* stockage indisponible : on garde les valeurs par défaut */ }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignoré */ }
  }

  const level = (k) => Math.pow(state[k] / 100, 1.7) * GAIN[k];

  /* ------------------------------------------------------------------
     Moteur audio : tous les sons sont fabriqués avec du bruit filtré
  ------------------------------------------------------------------ */
  function makeNoise(ctx, type) {
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'white') {
        d[i] = w * 0.6;
      } else if (type === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  const Engine = {
    ctx: null,
    master: null,
    out: {},
    rumble: null,
    whiteBuf: null,
    playing: false,
    fade: 0.2,
    suspendTimer: 0,

    init() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const ctx = (this.ctx = new AC());

      this.master = ctx.createGain();
      this.master.gain.value = 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.attack.value = 0.01;
      comp.release.value = 0.25;
      this.master.connect(comp);
      comp.connect(ctx.destination);

      const white = makeNoise(ctx, 'white');
      const pink = makeNoise(ctx, 'pink');
      const brown = makeNoise(ctx, 'brown');
      this.whiteBuf = white;

      const src = (buf) => {
        const s = ctx.createBufferSource();
        s.buffer = buf;
        s.loop = true;
        s.start(0, Math.random() * buf.duration);
        return s;
      };
      const filter = (type, freq, q = 0.7) => {
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        return f;
      };
      const gain = (v = 0) => {
        const g = ctx.createGain();
        g.gain.value = v;
        return g;
      };
      const chain = (source, ...nodes) => {
        let prev = source;
        for (const n of nodes) { prev.connect(n); prev = n; }
        return prev;
      };
      // Oscillateur lent qui fait varier un paramètre (houle, rafales…)
      const lfo = (freq, depth, param) => {
        const o = ctx.createOscillator();
        o.frequency.value = freq;
        const d = gain(depth);
        o.connect(d);
        d.connect(param);
        o.start();
      };

      // Pluie : sifflement aigu + corps médium
      const rain = gain(0);
      rain.connect(this.master);
      chain(src(white), filter('highpass', 1200), filter('lowpass', 9000), gain(0.55)).connect(rain);
      chain(src(pink), filter('bandpass', 2600, 0.5), gain(0.9)).connect(rain);

      // Vent : bruit rose dont la fréquence et le volume oscillent lentement
      const wind = gain(0);
      wind.connect(this.master);
      const windBand = filter('bandpass', 550, 0.8);
      const windSwell = gain(0.6);
      chain(src(pink), windBand, windSwell, gain(3)).connect(wind);
      lfo(0.11, 260, windBand.frequency);
      lfo(0.07, 0.35, windSwell.gain);
      lfo(0.19, 0.15, windSwell.gain);

      // Vagues : grondement grave qui monte et redescend + écume aiguë
      const waves = gain(0);
      waves.connect(this.master);
      const swell = gain(0.6);
      const foam = gain(0.1);
      chain(src(brown), filter('lowpass', 700), swell, gain(1.4)).connect(waves);
      chain(src(white), filter('highpass', 2200), filter('lowpass', 7500), foam).connect(waves);
      lfo(0.09, 0.4, swell.gain);
      lfo(0.061, 0.2, swell.gain);
      lfo(0.09, 0.1, foam.gain);

      // Orage : le tonnerre est déclenché à part (voir thunder)
      const storm = gain(0);
      storm.connect(this.master);
      this.rumble = gain(0);
      chain(src(brown), filter('lowpass', 180), this.rumble, gain(2)).connect(storm);

      // Feu : souffle grave continu ; les craquements sont ajoutés par pop()
      const fire = gain(0);
      fire.connect(this.master);
      chain(src(brown), filter('lowpass', 500), gain(0.9)).connect(fire);

      this.out = { rain, wind, waves, storm, fire };
      return true;
    },

    update() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      for (const k of KEYS) this.out[k].gain.setTargetAtTime(level(k), t, 0.1);
      const target = this.playing ? (state.master / 100) * 0.85 : 0;
      this.master.gain.setTargetAtTime(target, t, this.fade);
    },

    async start() {
      if (!this.ctx && !this.init()) return false;
      clearTimeout(this.suspendTimer);
      await this.ctx.resume();
      this.playing = true;
      this.fade = 0.2;
      this.update();
      return true;
    },

    stop(slow) {
      if (!this.ctx) return;
      this.playing = false;
      this.fade = slow ? 1.5 : 0.12;
      this.update();
      clearTimeout(this.suspendTimer);
      this.suspendTimer = setTimeout(() => {
        if (!this.playing) this.ctx.suspend();
      }, slow ? 8000 : 900);
    },

    // Un craquement de bois
    pop() {
      const ctx = this.ctx;
      if (!ctx || !this.playing) return;
      const dur = 0.012 + Math.random() * 0.05;
      const now = ctx.currentTime;
      const s = ctx.createBufferSource();
      s.buffer = this.whiteBuf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900 + Math.random() * 4200;
      f.Q.value = 0.9;
      const g = ctx.createGain();
      const peak = 0.25 + Math.random() * 0.9;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(peak, now + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      s.connect(f);
      f.connect(g);
      g.connect(this.out.fire);
      s.start(now, Math.random() * (this.whiteBuf.duration - 0.2), dur + 0.01);
    },

    // Un coup de tonnerre, avec un léger rebond au milieu
    thunder(delay) {
      if (!this.ctx || !this.playing) return;
      const t = this.ctx.currentTime + delay;
      const g = this.rumble.gain;
      const peak = 0.5 + Math.random() * 0.5;
      const len = 2.6 + Math.random() * 3;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0.0001, t);
      g.linearRampToValueAtTime(peak, t + 0.35);
      g.linearRampToValueAtTime(peak * 0.45, t + 1.2);
      g.linearRampToValueAtTime(peak * 0.8, t + 1.9);
      g.exponentialRampToValueAtTime(0.0001, t + 0.35 + len);
    },
  };

  /* Planificateurs : craquements du feu et éclairs (les éclairs
     s'affichent même quand le son est en pause) */
  function crackleLoop() {
    if (Engine.playing && state.fire > 1) {
      Engine.pop();
      if (Math.random() < 0.12) setTimeout(() => Engine.pop(), 15);
    }
    const f = state.fire / 100;
    setTimeout(crackleLoop, rand(25, 230) * (1.7 - f * 1.4));
  }

  function stormLoop() {
    const s = state.storm / 100;
    if (s <= 0.03) { setTimeout(stormLoop, 1000); return; }
    setTimeout(() => {
      if (state.storm > 3) {
        Scene.strike();
        if (Engine.playing) Engine.thunder(rand(0.25, 1.8));
      }
      stormLoop();
    }, rand(4000, 15000) * (1.5 - s));
  }

  /* ------------------------------------------------------------------
     Scène animée (canvas)
  ------------------------------------------------------------------ */
  const canvas = $('scene');
  const g = canvas.getContext('2d');
  let W = 0, H = 0;

  const vis = { rain: 0, wind: 0, waves: 0, storm: 0, fire: 0 }; // valeurs lissées
  const drops = [];
  const clouds = [];
  const stars = [];
  const embers = [];
  const phases = [0, 0, 0];
  let flash = 0;
  let bolt = null;
  let emberAcc = 0;

  const CALM_TOP = [31, 54, 80];
  const CALM_BOT = [63, 102, 112];
  const STORM_TOP = [14, 19, 28];
  const STORM_BOT = [44, 53, 66];
  const WARM = [104, 52, 30];
  const SEA = [[38, 86, 104], [26, 66, 86], [16, 44, 62]];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    drops.length = 0;
    for (let i = 0; i < 480; i++) {
      drops.push({ x: rand(0, W), y: rand(0, H), l: rand(10, 22), v: rand(620, 980) });
    }
    clouds.length = 0;
    for (let i = 0; i < 10; i++) {
      const w = rand(240, 480);
      const h = rand(50, 110);
      const puffs = [];
      for (let p = 0; p < 5; p++) {
        puffs.push({ dx: rand(-0.4, 0.4) * w, dy: rand(-0.3, 0.3) * h, r: rand(0.4, 0.7) * w * 0.5 });
      }
      clouds.push({ x: rand(-w, W), y: H * rand(0.04, 0.4), w, v: rand(0.5, 1.4), puffs });
    }
    stars.length = 0;
    for (let i = 0; i < 70; i++) {
      stars.push({ x: rand(0, W), y: rand(0, H * 0.5), r: rand(0.4, 1.4), p: rand(0, 6.28) });
    }
  }

  function makeBolt() {
    let x = rand(W * 0.15, W * 0.85);
    let y = 0;
    const pts = [[x, y]];
    while (y < H * 0.52) {
      y += rand(20, 50);
      x += rand(-40, 40);
      pts.push([x, y]);
    }
    return pts;
  }

  const Scene = {
    strike() {
      if (reduceMotion.matches) return;
      flash = 1;
      bolt = makeBolt();
      if (Math.random() < 0.55) setTimeout(() => { flash = 0.8; }, 130);
    },
  };

  let last = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000 || 0.016, 0.05);
    last = now;
    const motion = reduceMotion.matches ? 0.25 : 1;
    const t = now / 1000;

    for (const k of KEYS) vis[k] += (state[k] - vis[k]) * Math.min(1, dt * 3);
    const rainA = vis.rain / 100;
    const windA = vis.wind / 100;
    const wavesA = vis.waves / 100;
    const stormA = vis.storm / 100;
    const fireA = vis.fire / 100;
    const cover = Math.max(rainA * 0.9, stormA, windA * 0.35);
    const dark = Math.max(stormA * 0.95, rainA * 0.55);

    // Ciel
    const top = mix(CALM_TOP, STORM_TOP, dark);
    const bot = mix(mix(CALM_BOT, STORM_BOT, dark), WARM, fireA * 0.45);
    const sky = g.createLinearGradient(0, 0, 0, H * 0.65);
    sky.addColorStop(0, rgb(top));
    sky.addColorStop(1, rgb(bot));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // Étoiles (visibles seulement quand le ciel est dégagé)
    const starAlpha = (1 - cover) * 0.8;
    if (starAlpha > 0.03) {
      for (const s of stars) {
        const a = starAlpha * (0.7 + Math.sin(t * 1.5 + s.p) * 0.3 * motion);
        g.fillStyle = `rgba(255,255,255,${a})`;
        g.beginPath();
        g.arc(s.x, s.y, s.r, 0, 6.283);
        g.fill();
      }
    }

    // Nuages
    const cloudCol = mix([190, 205, 218], [46, 54, 68], dark);
    const cloudAlpha = 0.05 + cover * 0.42;
    const cloudSpeed = (8 + windA * 90) * motion;
    for (const c of clouds) {
      c.x += cloudSpeed * c.v * dt;
      if (c.x - c.w > W) c.x = -c.w * 1.2;
      for (const p of c.puffs) {
        const px = c.x + p.dx;
        const py = c.y + p.dy;
        const gr = g.createRadialGradient(px, py, 0, px, py, p.r);
        gr.addColorStop(0, rgb(cloudCol, cloudAlpha));
        gr.addColorStop(1, rgb(cloudCol, 0));
        g.fillStyle = gr;
        g.beginPath();
        g.arc(px, py, p.r, 0, 6.283);
        g.fill();
      }
    }

    // Pluie
    const n = Math.round(rainA * drops.length * (W < 700 ? 0.6 : 1));
    if (n > 0) {
      const slant = windA * 0.55 + 0.06;
      g.strokeStyle = `rgba(200,222,235,${0.18 + rainA * 0.3})`;
      g.lineWidth = 1.1;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const d = drops[i];
        d.y += d.v * dt * motion;
        d.x += d.v * slant * dt * motion;
        if (d.y > H) { d.y = -d.l; d.x = rand(-100, W); }
        if (d.x > W + 50) d.x = -50;
        g.moveTo(d.x, d.y);
        g.lineTo(d.x - d.l * slant, d.y - d.l);
      }
      g.stroke();
    }

    // Mer
    for (let i = 0; i < 3; i++) {
      const col = mix(SEA[i], [10, 16, 24], dark * 0.6);
      const amp = (2 + wavesA * 26 + stormA * 6) * (0.6 + i * 0.25);
      const wl = 260 + i * 140;
      const speed = (0.5 + wavesA * 1.6 + windA * 0.3) * (1 + i * 0.25) * motion;
      phases[i] += dt * speed;
      const y0 = H * 0.6 + i * H * 0.045;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 10) {
        const y = y0
          + Math.sin((x / wl) * 6.283 + phases[i] + i * 1.7) * amp
          + Math.sin((x / (wl * 0.43)) * 6.283 - phases[i] * 1.3 + i) * amp * 0.35;
        g.lineTo(x, y);
      }
      g.lineTo(W, H);
      g.closePath();
      g.fillStyle = rgb(col);
      g.fill();
    }

    // Feu : lueur chaude venant du bas + braises
    if (fireA > 0.01) {
      const flick = 0.85 + Math.sin(t * 9.1) * 0.06 + Math.sin(t * 23.7 + 1) * 0.05 + Math.sin(t * 4.3) * 0.04;
      const r = Math.max(W, H) * 0.75;
      const gr = g.createRadialGradient(W * 0.5, H * 1.05, 0, W * 0.5, H * 1.05, r);
      gr.addColorStop(0, `rgba(255,150,60,${0.5 * fireA * flick})`);
      gr.addColorStop(0.5, `rgba(255,110,40,${0.16 * fireA * flick})`);
      gr.addColorStop(1, 'rgba(255,90,30,0)');
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
    }
    if (fireA > 0.02) {
      emberAcc += fireA * 22 * dt * motion;
      while (emberAcc >= 1) {
        emberAcc -= 1;
        if (embers.length < 90) {
          embers.push({
            x: W * 0.5 + rand(-1, 1) * W * 0.16, y: H + 5,
            vx: rand(-12, 12), vy: -rand(40, 110),
            life: 0, max: rand(2.5, 5.5), r: rand(0.8, 2.2),
          });
        }
      }
    }
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i];
      e.life += dt;
      if (e.life >= e.max) { embers.splice(i, 1); continue; }
      e.x += (e.vx + Math.sin(e.life * 3 + e.r * 5) * 14 + windA * 40) * dt * motion;
      e.y += e.vy * dt * motion;
      g.fillStyle = `rgba(255,190,90,${(1 - e.life / e.max) * 0.9})`;
      g.beginPath();
      g.arc(e.x, e.y, e.r, 0, 6.283);
      g.fill();
    }

    // Éclair
    if (flash > 0.01) {
      g.fillStyle = `rgba(220,230,255,${flash * 0.55})`;
      g.fillRect(0, 0, W, H);
      if (bolt) {
        g.strokeStyle = `rgba(255,255,255,${Math.min(1, flash * 1.4)})`;
        g.lineWidth = 2.2;
        g.shadowColor = 'rgba(180,200,255,0.9)';
        g.shadowBlur = 18;
        g.beginPath();
        bolt.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
        g.stroke();
        g.shadowBlur = 0;
      }
      flash *= Math.pow(0.0015, dt);
    } else {
      bolt = null;
    }

    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------
     Interface
  ------------------------------------------------------------------ */
  const inputs = {};
  const outputs = {};
  for (const k of KEYS) {
    inputs[k] = $('ch-' + k);
    outputs[k] = $('out-' + k);
  }
  inputs.master = $('ch-master');

  const moodEl = $('mood');
  const moodText = $('mood-text');
  const playBtn = $('play');
  const playLabel = $('play-label');
  const timerSel = $('timer');
  const timerInfo = $('timer-info');
  const audioError = $('audio-error');

  let currentMood = '';

  function renderMood() {
    const active = KEYS.filter((k) => state[k] >= 20).sort((a, b) => state[b] - state[a]);
    let key = 'silence';
    if (active.length === 1) key = active[0];
    if (active.length >= 2) key = active.slice(0, 2).sort().join('+');
    const [title, text] = MOODS[key] || MOODS[active[0]] || MOODS.silence;
    if (key === currentMood) return;
    currentMood = key;
    moodEl.textContent = title;
    moodText.textContent = text;
    if (!reduceMotion.matches && moodEl.animate) {
      const kf = [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }];
      moodEl.animate(kf, { duration: 300, easing: 'ease-out' });
      moodText.animate(kf, { duration: 300, delay: 60, easing: 'ease-out', fill: 'backwards' });
    }
  }

  function paintSlider(k) {
    const el = inputs[k];
    el.value = state[k];
    el.style.setProperty('--p', state[k] + '%');
    if (outputs[k]) outputs[k].textContent = state[k] + ' %';
  }

  function syncUI() {
    for (const k of [...KEYS, 'master']) paintSlider(k);
    renderMood();
    Engine.update();
    save();
  }

  for (const k of [...KEYS, 'master']) {
    inputs[k].addEventListener('input', () => {
      state[k] = clamp(Number(inputs[k].value), 0, 100);
      paintSlider(k);
      if (k !== 'master') renderMood();
      Engine.update();
      save();
    });
  }

  document.querySelectorAll('.preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      Object.assign(state, PRESETS[btn.dataset.preset]);
      syncUI();
    });
  });

  /* Lecture / pause */
  function setPlayUI(on) {
    playBtn.setAttribute('aria-pressed', String(on));
    playLabel.textContent = on ? 'Mettre en pause' : 'Écouter';
  }

  async function toggle() {
    if (Engine.playing) {
      Engine.stop();
      setPlayUI(false);
      endAt = 0;
      tickTimer();
      return;
    }
    const ok = await Engine.start();
    if (!ok) { audioError.hidden = false; return; }
    audioError.hidden = true;
    setPlayUI(true);
    armTimer();
  }
  playBtn.addEventListener('click', toggle);

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.target.closest('input, select, button, textarea')) {
      e.preventDefault();
      toggle();
    }
  });

  /* Minuteur d'arrêt */
  let endAt = 0;

  function armTimer() {
    const minutes = Number(timerSel.value);
    endAt = Engine.playing && minutes ? Date.now() + minutes * 60000 : 0;
    tickTimer();
  }

  function tickTimer() {
    if (!endAt) { timerInfo.hidden = true; return; }
    const left = endAt - Date.now();
    if (left <= 0) {
      endAt = 0;
      Engine.stop(true); // extinction en douceur
      setPlayUI(false);
      timerInfo.hidden = true;
      return;
    }
    const s = Math.ceil(left / 1000);
    timerInfo.hidden = false;
    timerInfo.textContent = `Le son s'arrête dans ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  timerSel.addEventListener('change', armTimer);
  setInterval(tickTimer, 1000);

  /* ------------------------------------------------------------------
     Démarrage
  ------------------------------------------------------------------ */
  window.addEventListener('resize', resize);
  resize();
  syncUI();
  requestAnimationFrame(frame);
  crackleLoop();
  stormLoop();
})();

(() => {
  "use strict";

  // ---- Tuning ---------------------------------------------------------------
  const tuning = {
    // Printing
    prints: 6, // how many photos the camera prints
    printDuration: 3400, // ms from first peek out of the slot to resting on the table
    printInterval: 3000, // ms between prints starting (less than printDuration = overlap)

    // Landing spots (card widths/heights on the table, relative to pile slots)
    landingMinDistance: 0.4, // nearest a print lands: 0 = back row under the camera, 1 = front row
    landingMaxDistance: 0.6, // farthest a print lands (each print picks a random depth in between)
    landingPull: 0.1, // left/right: 1 = line up with a pile slot, lower = closer to center
    landingJitter: 0.01, // random offset around each landing spot
    landingTurn: 2, // max random extra rotation in degrees
    landingMatchAngle: 0.1, // how much a print copies the rotation of the pile card it lands on (0 = straight)
    landingSideways: 0.4, // scales how far prints drift left/right (0 = straight down from the slot)

    // Pushing: how a landing print shoves the cards already on the table
    pushAt: 0.6, // point in the print's flight (0–1) when it touches down
    pushStrength: 0.05, // distance a card right under the print moves, in card widths
    pushReach: 1.2, // cards farther than this (card widths) are not moved
    pushSpin: 10, // degrees of spin per card width pushed
    pushMaxShift: 0.2, // a card never drifts farther than this from its original spot
    pushMaxTurn: 6, // ...or turns more than this many degrees
    pushDuration: 800, // ms for a pushed card to slide to its new spot

    // Paper effects while a sheet is moving (all fade out before it lands)
    highlight: 1, // specular streaks and gloss sweep; 0 = off
    ripple: 1, // ripple in the lighting and the image; 0 = flat paper

    // Shimmer: the glossy light on a sheet while it moves (all scaled by highlight).
    // Times are fractions of a print's flight: 0 = starts ejecting, ~0.44 = fully
    // out of the camera, 1 = lands.
    shimmerStrength: 0.18, // brightness of the gloss band that sweeps across the sheet
    shimmerWidth: 0.2, // thickness of the band, as a fraction of the sheet
    shimmerAngle: 0, // band direction in degrees: 0 = level, sweeping top to bottom
    shimmerStart: 0.3, // when the band enters the top edge of the sheet
    shimmerEnd: 0.85, // when it has left the bottom edge (keep below 1)
    shimmerSpecular: 0.22, // brightness of the glints (ripple + the flash as it tips back)
    shimmerSharpness: 30, // glint size: lower = broad soft glow, higher = small hot spots
    shimmerLightSide: -1, // light left/right, about -1 to 1: moves where glints appear
    shimmerBow: 0.25, // how much the paper bows across its width, so the sides catch the light
    effectsFadeStart: 0.5, // when glints, lighting and ripple start fading out
    effectsFadeEnd: 0.92, // when they are gone (must be at most 1 for a clean landing)

    // Developing: the photo fades up from dark like real instant film
    develop: true, // false = photos come out fully developed
    developDelay: 1000, // ms after a print starts before the image begins to appear
    developDuration: 1300, // ms to fully develop; can outlast the flight (it keeps developing on the table)
    developEase: 1.6, // 1 = steady fade, higher = stays dark longer then blooms
    developColor: "#1f2427", // shade of the undeveloped film
    developDesaturate: 0.0, // how much color lags behind brightness (0 = none, 1 = starts fully gray)
  };
  // ---------------------------------------------------------------------------

  // How developed a print is (0–1), given ms since it started printing.
  function developAt(ms) {
    if (!tuning.develop) return 1;
    const t = Math.min(
      1,
      Math.max(0, (ms - tuning.developDelay) / tuning.developDuration)
    );
    return Math.pow(t, tuning.developEase);
  }
  const developRGB = [1, 3, 5].map(
    (i) => parseInt(tuning.developColor.slice(i, i + 2), 16) / 255
  );

  const work = document.querySelector(".work");
  const button = document.querySelector(".camera-button");
  const camera = document.querySelector(".camera");
  const card = document.querySelector(".polaroid");
  const canvas = document.querySelector(".print-canvas");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
  });
  let frame = 0;
  let ready = false;
  let lost = false;
  // Prints overlap: the next sheet starts ejecting while the last one settles.
  const duration = tuning.printDuration;
  const interval = tuning.printInterval;
  const total = tuning.prints;
  let nudged = 0;
  const stack = document.querySelector(".photo-stack");
  stack.style.setProperty("--push-duration", `${tuning.pushDuration}ms`);
  let current = 0;
  let running = false;
  let base = 0;
  let pausedAt = null;
  const photo = (src, alt) => {
    const image = new Image();
    image.src = src;
    image.alt = alt;
    return { src, alt, image };
  };
  const snapshots = [
    photo("assets/photo-1.png", "Portrait beside a lily pond"),
    photo("assets/photo-2.png", "Portrait beside a blue door"),
    photo("assets/photo-3.png", "Silhouettes by the sea at sunset"),
  ];
  const workPhotos = [
    photo("assets/work-whatsapp.png", "Vintage green WhatsApp icon"),
    photo("assets/work-2.png", "Oculus logo on a blue background"),
    photo("assets/work-3.png", "Udacity logo"),
    photo("assets/work-4.png", "GoFundMe logo"),
    photo("assets/work-5.png", "WhatsApp logo on a green background"),
    photo("assets/work-6.png", "Meta logo"),
    photo(
      "assets/work-7.png",
      "Clever typography on a blue and pink background"
    ),
  ];
  // Every image can come out of the camera; each has its own paper texture.
  const photos = [...workPhotos, ...snapshots];
  // A low mound of ten photos on the tabletop, back to front. Units are card
  // widths/heights on the unprojected plane; small jitter keeps it organic.
  const pile = [
    [0.51, 0.26, -15],
    [1.83, 1.21, -16],
    [0.98, 0.91, 12],
    [-1.43, 0.98, 22],
    [-0.02, 0.72, 6],
    [-0.11, 0.89, -3],
    [-0.72, 0.28, 10],
    [-0.01, 0.02, 0],
    [-0.63, 1.44, 20],
    [0.58, 1.47, -22],
  ].map(([x, y, angle]) => [
    x + (Math.random() - 0.5) * 0.06,
    y + (Math.random() - 0.5) * 0.05,
    angle + (Math.random() - 0.5) * 4,
  ]);
  const landed = [];

  function makePrint({ src, alt }, category) {
    const print = card.cloneNode(true);
    const image = print.querySelector(".project-image");
    // Photos are preloaded, so decode in the same frame: no pink flash at handoff.
    image.decoding = "sync";
    image.loading = "eager";
    image.src = src;
    image.alt = alt;
    print.classList.add("printed-polaroid", `${category}-photo`);
    print.setAttribute("aria-hidden", "true");
    stack.append(print);
    return print;
  }

  // Every card on the table, with its resting pose, so later prints can shove it.
  const tabled = [];
  function place(item) {
    item.element.style.transform = `translate(${item.x * 100}%, ${
      item.y * 100
    }%) rotate(${item.angle}deg)`;
  }

  // Work artwork fills the visible slots; snapshots sit where they are covered.
  const pileOrder = [7, 2, 5, 1, 8, 6, 0, 9, 3, 4];
  pileOrder.forEach((index, slot) => {
    const [x, y, angle] = pile[slot];
    const item = {
      element: makePrint(photos[index], "work"),
      x,
      y,
      angle,
      home: [x, y, angle],
    };
    place(item);
    tabled.push(item);
  });
  stack.classList.add("has-prints");

  function clearPrints() {
    landed.splice(0).forEach((element) => element.remove());
    tabled.splice(pile.length);
    tabled.forEach((item) => {
      [item.x, item.y, item.angle] = item.home;
      place(item);
    });
  }

  // A landing sheet shoves the cards beneath it outward, with a little spin.
  // The push fades with distance, and each card stays near where it started.
  function nudge(index) {
    const target = destinations[index];
    const aspect = card.offsetHeight / card.offsetWidth;
    tabled.forEach((item) => {
      const dx = item.x - target.x;
      const dy = (item.y - target.y) * aspect;
      const distance = Math.hypot(dx, dy);
      if (distance > tuning.pushReach) return;
      const strength =
        Math.pow(1 - distance / tuning.pushReach, 2) * tuning.pushStrength;
      const direction =
        distance > 0.05 ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2;
      const [homeX, homeY, homeAngle] = item.home;
      const clamp = (value, home, range) =>
        Math.min(home + range, Math.max(home - range, value));
      item.x = clamp(
        item.x + Math.cos(direction) * strength,
        homeX,
        tuning.pushMaxShift
      );
      item.y = clamp(
        item.y + (Math.sin(direction) * strength) / aspect,
        homeY,
        tuning.pushMaxShift
      );
      item.angle = clamp(
        item.angle +
          Math.sign(dx || 1) *
            strength *
            tuning.pushSpin *
            (0.6 + Math.random() * 0.4),
        homeAngle,
        tuning.pushMaxTurn
      );
      place(item);
    });
  }

  // Shuffled passes through every image, never printing the same one twice in a row.
  const sequence = [];
  while (sequence.length < total) {
    const pass = photos.map((_, index) => index);
    for (let i = pass.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pass[i], pass[j]] = [pass[j], pass[i]];
    }
    if (pass[0] === sequence[sequence.length - 1]) pass.push(pass.shift());
    sequence.push(...pass);
  }
  sequence.length = total;

  // Each print takes its own spot on the inner mound. Its depth is a random
  // fraction of the pile's front-to-back extent, so it always travels out onto
  // the pile instead of dropping at the camera.
  const spots = [0, 2, 4, 5, 6, 7].sort(() => Math.random() - 0.5);
  const pileBack = Math.min(...pile.map(([, y]) => y));
  const pileFront = Math.max(...pile.map(([, y]) => y));
  const destinations = Array.from({ length: total }, (_, index) => {
    const [x, , angle] = pile[spots[index % spots.length]];
    const depth =
      tuning.landingMinDistance +
      Math.random() * (tuning.landingMaxDistance - tuning.landingMinDistance);
    return {
      x:
        (x * tuning.landingPull +
          (Math.random() - 0.5) * tuning.landingJitter) *
        tuning.landingSideways,
      y: pileBack + depth * (pileFront - pileBack),
      angle:
        angle * tuning.landingMatchAngle +
        (Math.random() * 2 - 1) * tuning.landingTurn,
    };
  });

  function land(index, developed = false) {
    const { x, y, angle } = destinations[index];
    // The WebGL sheet arrives at this exact pose; the DOM takes over at rest.
    const item = {
      element: makePrint(photos[sequence[index]], "camera"),
      x,
      y,
      angle,
      home: [x, y, angle],
    };
    place(item);
    if (!developed) keepDeveloping(item.element);
    tabled.push(item);
    landed.push(item.element);
    current = index + 1;
    stack.setAttribute(
      "aria-label",
      `10 scattered photos and ${index + 1} of ${total} new Polaroids printed`
    );
  }

  // Picks up development where the WebGL sheet left off, on the same curve:
  // a film-colored veil fades out while the colour saturates.
  function keepDeveloping(print) {
    const start = developAt(duration);
    if (start >= 1) return;
    const image = print.querySelector(".project-image");
    const veil = document.createElement("div");
    veil.style.cssText =
      `position:absolute;left:${image.offsetLeft}px;top:${image.offsetTop}px;` +
      `width:${image.offsetWidth}px;height:${image.offsetHeight}px;background:${tuning.developColor};pointer-events:none`;
    print.append(veil);
    const remaining = tuning.developDelay + tuning.developDuration - duration;
    const steps = 24;
    const samples = Array.from({ length: steps + 1 }, (_, i) =>
      developAt(duration + (remaining * i) / steps)
    );
    const timing = {
      duration: Math.max(remaining, 1),
      easing: "linear",
      fill: "forwards",
    };
    veil
      .animate(
        samples.map((d) => ({ opacity: 1 - d })),
        timing
      )
      .finished.then(() => veil.remove());
    image
      .animate(
        samples.map((d) => ({
          filter: `saturate(${1 - (1 - d) * tuning.developDesaturate})`,
        })),
        timing
      )
      .finished.then(() => {
        image.style.filter = "";
      });
  }

  function staticStack() {
    stop();
    clearPrints();
    for (let i = 0; i < total; i++) land(i, true);
    current = total;
  }

  // Each sheet ejects upright from the slot at motor speed, then tips back onto
  // the tabletop while it slides into place. Position, tilt and turn share one
  // decelerating curve, so there is no stop between ejecting and settling.
  const vertexSource = `
    precision highp float;
    attribute vec2 a_uv;
    uniform vec2 u_view;
    uniform vec4 u_card;
    uniform float u_slot;
    uniform float u_progress;
    uniform vec3 u_pose;
    uniform vec2 u_plane;
    uniform float u_ripple;
    uniform vec3 u_light;
    uniform vec2 u_fade;
    varying vec2 v_uv;
    varying float v_shade;
    varying float v_y;
    varying vec3 v_normal;
    varying float v_fx;
    const float EJECT = 0.44;
    const float RAMP = 0.22;
    void main() {
      float p = u_progress;
      float slot = u_slot - u_card.y;
      float e = clamp(p / EJECT, 0.0, 1.0);
      // Smooth spin-up, then constant speed through the rollers.
      float eject = (e < RAMP ? e * e / (2.0 * RAMP) : e - RAMP * 0.5) / (1.0 - RAMP * 0.5);
      float f = clamp((p - EJECT) / (1.0 - EJECT), 0.0, 1.0);
      // A soft sine ease-out: carries on from the ejection and glides to rest.
      float settle = sin(f * 1.5707963);
      float top = f > 0.0 ? mix(slot, u_pose.y, settle) : slot - u_card.w * (1.0 - eject);
      float tilt = u_plane.x * (1.0 - pow(1.0 - f, 2.0));
      float center = u_card.x + u_card.z * 0.5;
      float drift = u_pose.x * settle;
      float x = center + drift + (a_uv.x - 0.5) * u_card.z;
      float y = top + a_uv.y * u_card.w;
      // The exposed paper curls gently and relaxes flat; arc length is kept.
      float bend = 0.55 * (1.0 - smoothstep(0.0, 0.8, p));
      float anchor = max(slot, top);
      float exposed = max(0.0, top + u_card.w - anchor);
      float radius = max(exposed, u_card.w * 0.2) / max(bend, 0.0001);
      float theta = max(0.0, y - anchor) / radius;
      if (y > anchor) y = anchor + radius * sin(theta) - radius * (1.0 - cos(theta)) * 0.25;
      float angle = u_pose.z * settle;
      vec2 pivot = vec2(center + drift, top + u_card.w * 0.65);
      vec2 local = vec2(x, y) - pivot;
      vec2 turned = vec2(local.x * cos(angle) - local.y * sin(angle),
                         local.x * sin(angle) + local.y * cos(angle)) + pivot;
      // Same projection as the CSS pile, with the tilt growing from upright.
      float scale = u_plane.y / (u_plane.y - turned.y * sin(tilt));
      x = center + (turned.x - center) * scale;
      y = u_card.y + turned.y * cos(tilt) * scale;
      // Slightly brighter while facing the viewer, matching the pile once flat.
      v_shade = (1.0 - 0.10 * sin(theta)) * (1.0 + 0.03 * (1.0 - tilt / max(u_plane.x, 0.001)));
      v_uv = a_uv;
      v_y = y;
      gl_Position = vec4(x / u_view.x * 2.0 - 1.0, 1.0 - y / u_view.y * 2.0, 0.0, 1.0);
      // Fresh paper ripples and catches the light; all of it fades out before
      // landing so the sheet matches the flat HTML card exactly at handoff.
      float fx = 1.0 - smoothstep(u_fade.x, u_fade.y, p);
      float held = smoothstep(0.0, u_card.w * 0.35, max(0.0, top + a_uv.y * u_card.w - anchor));
      float phase = a_uv.y * 9.0 - p * 30.0;
      float wave = held * fx;
      // Surface normal from the curl, the tip-back and the travelling ripple.
      float pitch = theta + tilt + cos(phase) * 0.22 * wave * u_ripple;
      // Mirror-symmetric bow across the width, breathing slightly as it moves.
      float roll = (a_uv.x - 0.5) * u_light.z * (1.0 + 0.4 * sin(p * 11.0)) * wave * u_ripple;
      v_normal = vec3(sin(roll), -sin(pitch), cos(pitch) * cos(roll));
      v_fx = fx;
    }
  `;
  const fragmentSource = `
    precision highp float;
    uniform sampler2D u_texture;
    uniform float u_slot;
    uniform float u_progress;
    uniform vec4 u_inset;
    uniform float u_ripple;
    uniform float u_highlight;
    uniform vec3 u_light;
    uniform vec4 u_shimmer;
    uniform vec2 u_sweep;
    uniform vec2 u_develop;
    uniform vec3 u_film;
    varying vec2 v_uv;
    varying float v_shade;
    varying float v_y;
    varying vec3 v_normal;
    varying float v_fx;
    void main() {
      if (v_y < u_slot) discard;
      float p = u_progress;
      // A faint refraction-like wobble in the emulsion while the paper flexes.
      vec2 warp = vec2(sin(v_uv.y * 19.0 + p * 24.0), sin(v_uv.x * 15.0 - p * 20.0)) * 0.003 * v_fx * u_ripple;
      vec4 paper = texture2D(u_texture, v_uv + warp);
      vec3 n = normalize(v_normal);
      // Side light is scaled to the paper's bow so it moves glints across the sheet.
      vec3 l = normalize(vec3(u_light.x * 0.3, -0.55, 0.76));
      // Relight relative to a flat, front-facing sheet so the rest pose is unchanged.
      float diffuse = 1.0 + 0.45 * (dot(n, l) - l.z) * v_fx;
      float specular = pow(max(dot(n, normalize(l + vec3(0.0, 0.0, 1.0))), 0.0), u_shimmer.w);
      // A soft highlight band glides across the gloss as it ejects.
      vec2 across = vec2(sin(u_shimmer.z), cos(u_shimmer.z));
      float along = dot(v_uv - 0.5, across) + 0.5;
      // Enters the top edge at shimmerStart and has left the bottom by shimmerEnd.
      float travel = (p - u_sweep.x) / max(u_sweep.y - u_sweep.x, 0.001);
      float sweep = mix(-2.0 * u_shimmer.y, 1.0 + 2.0 * u_shimmer.y, travel);
      float band = exp(-pow((along - sweep) / max(u_shimmer.y, 0.001), 2.0))
        * step(0.0, travel) * step(travel, 1.0);
      float photo = step(u_inset.x, v_uv.x) * step(v_uv.x, u_inset.z) * step(u_inset.y, v_uv.y) * step(v_uv.y, u_inset.w);
      float gloss = (specular * u_light.y * v_fx + band * u_shimmer.x) * mix(0.35, 1.0, photo) * u_highlight;
      float slotShadow = 1.0 - 0.18 * exp(-max(0.0, v_y - u_slot) / 10.0);
      // Undeveloped film: dark and desaturated, blooming into the photo.
      vec3 base = paper.rgb;
      float developed = u_develop.x;
      float gray = dot(base, vec3(0.299, 0.587, 0.114));
      vec3 film = mix(base, vec3(gray), (1.0 - developed) * u_develop.y);
      film = mix(u_film, film, developed);
      base = mix(base, film, photo);
      vec3 color = base * slotShadow * v_shade * diffuse + gloss;
      gl_FragColor = vec4(min(color, 1.0), paper.a);
    }
  `;

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    running = false;
    pausedAt = null;
    work.classList.remove("is-printing");
    button.disabled = false;
    button.setAttribute("aria-label", `Replay ${total} Polaroid prints`);
  }

  if (!gl) {
    staticStack();
    button.disabled = true;
    button.setAttribute("aria-label", "Instant camera");
    return;
  }

  function shader(type, source) {
    const result = gl.createShader(type);
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(result));
    return result;
  }

  try {
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);

    const vertices = [];
    const columns = 12;
    const rows = 48;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const left = x / columns,
          right = (x + 1) / columns;
        const top = y / rows,
          bottom = (y + 1) / rows;
        vertices.push(
          left,
          top,
          right,
          top,
          left,
          bottom,
          left,
          bottom,
          right,
          top,
          right,
          bottom
        );
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_uv");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniforms = Object.fromEntries(
      [
        "view",
        "card",
        "slot",
        "progress",
        "pose",
        "plane",
        "inset",
        "ripple",
        "light",
        "shimmer",
        "sweep",
        "fade",
        "develop",
        "film",
        "highlight",
      ].map((name) => [name, gl.getUniformLocation(program, `u_${name}`)])
    );
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA
    );
    const textures = photos.map(() => {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return texture;
    });
    let textureWidth = 0;

    // Paint the paper to match the HTML card: same padding, radius and crop.
    function updateTextures() {
      const width = card.offsetWidth,
        height = card.offsetHeight;
      if (width === textureWidth) return;
      textureWidth = width;
      const style = getComputedStyle(card);
      const [top, right, , left] = ["Top", "Right", "Bottom", "Left"].map(
        (side) => parseFloat(style[`padding${side}`])
      );
      const size = width - left - right;
      gl.uniform4f(
        uniforms.inset,
        left / width,
        top / height,
        (left + size) / width,
        (top + size) / height
      );
      photos.forEach(({ image }, index) => {
        const texture = document.createElement("canvas");
        const scale = 3;
        texture.width = Math.round(width * scale);
        texture.height = Math.round(height * scale);
        const ctx = texture.getContext("2d");
        ctx.scale(scale, scale);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.roundRect(
          0,
          0,
          width,
          height,
          parseFloat(style.borderTopLeftRadius)
        );
        ctx.fill();
        ctx.fillStyle = "#ffb9bd";
        ctx.fillRect(left, top, size, size);
        if (image.complete && image.naturalWidth) {
          const crop = Math.min(image.naturalWidth, image.naturalHeight);
          ctx.drawImage(
            image,
            (image.naturalWidth - crop) / 2,
            (image.naturalHeight - crop) / 2,
            crop,
            crop,
            left,
            top,
            size,
            size
          );
        }
        gl.bindTexture(gl.TEXTURE_2D, textures[index]);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          texture
        );
      });
    }

    function draw(now) {
      const elapsed = window.__t ?? now - base;
      // Hand finished sheets to the DOM, oldest first.
      // Sheets touch down while still gliding, a little before they come to rest.
      while (
        nudged < total &&
        elapsed >= nudged * interval + duration * tuning.pushAt
      )
        nudge(nudged++);
      while (current < total && elapsed >= current * interval + duration)
        land(current);
      if (current >= total) {
        stop();
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      updateTextures();
      const bounds = work.getBoundingClientRect();
      const cameraRect = camera.getBoundingClientRect();
      const ratio = Math.min(devicePixelRatio || 1, 2);
      const width = Math.round(bounds.width * ratio),
        height = Math.round(bounds.height * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const cardWidth = card.offsetWidth,
        cardHeight = card.offsetHeight;
      const plane = getComputedStyle(stack);
      gl.uniform2f(uniforms.view, bounds.width, bounds.height);
      gl.uniform4f(
        uniforms.card,
        stack.offsetLeft,
        stack.offsetTop,
        cardWidth,
        cardHeight
      );
      gl.uniform1f(uniforms.ripple, tuning.ripple);
      gl.uniform1f(uniforms.highlight, tuning.highlight);
      gl.uniform3f(
        uniforms.light,
        tuning.shimmerLightSide,
        tuning.shimmerSpecular,
        tuning.shimmerBow
      );
      gl.uniform4f(
        uniforms.shimmer,
        tuning.shimmerStrength,
        tuning.shimmerWidth,
        (tuning.shimmerAngle * Math.PI) / 180,
        tuning.shimmerSharpness
      );
      gl.uniform2f(uniforms.sweep, tuning.shimmerStart, Math.min(tuning.shimmerEnd, 1));
      gl.uniform2f(uniforms.fade, tuning.effectsFadeStart, Math.min(tuning.effectsFadeEnd, 1));
      gl.uniform3f(uniforms.film, ...developRGB);
      gl.uniform1f(
        uniforms.slot,
        cameraRect.top - bounds.top + cameraRect.height * (734 / 817)
      );
      gl.uniform2f(
        uniforms.plane,
        (parseFloat(plane.getPropertyValue("--pile-tilt")) * Math.PI) / 180,
        parseFloat(plane.getPropertyValue("--pile-depth")) * cameraRect.width
      );
      // Older sheets are lower on the pile, so draw them first.
      for (let index = current; index < total; index++) {
        const p = (elapsed - index * interval) / duration;
        if (p < 0) break;
        const destination = destinations[index];
        gl.bindTexture(gl.TEXTURE_2D, textures[sequence[index]]);
        gl.uniform1f(uniforms.progress, p);
        gl.uniform2f(
          uniforms.develop,
          developAt(elapsed - index * interval),
          tuning.developDesaturate
        );
        gl.uniform3f(
          uniforms.pose,
          destination.x * cardWidth,
          destination.y * cardHeight,
          (destination.angle * Math.PI) / 180
        );
        gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
      }
      const printing = Math.min(total, Math.floor(elapsed / interval) + 1);
      button.setAttribute(
        "aria-label",
        `Printing Polaroid ${printing} of ${total}`
      );
      frame = requestAnimationFrame(draw);
    }

    function print() {
      if (!ready || running || lost) return;
      if (reducedMotion.matches) {
        staticStack();
        return;
      }
      try {
        textureWidth = 0;
        updateTextures();
      } catch (error) {
        console.warn("Keeping the static Polaroid:", error);
        return;
      }
      clearPrints();
      current = 0;
      nudged = 0;
      running = true;
      button.disabled = true;
      button.setAttribute("aria-label", `Printing Polaroid 1 of ${total}`);
      work.classList.add("is-printing");
      base = performance.now();
      frame = requestAnimationFrame(draw);
    }

    button.addEventListener("click", print);
    reducedMotion.addEventListener("change", () => {
      if (reducedMotion.matches) staticStack();
    });
    document.addEventListener("visibilitychange", () => {
      if (!running) return;
      if (document.hidden) {
        pausedAt = performance.now();
        cancelAnimationFrame(frame);
      } else if (pausedAt !== null) {
        base += performance.now() - pausedAt;
        pausedAt = null;
        frame = requestAnimationFrame(draw);
      }
    });
    canvas.addEventListener("webglcontextlost", () => {
      lost = true;
      staticStack();
    });
    Promise.all([
      document.fonts.ready,
      ...photos.map(({ image }) => image.decode()),
      ...Array.from(work.querySelectorAll("img")).map((image) =>
        image.decode().catch(() => {})
      ),
    ])
      .then(() => {
        ready = true;
        const observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              observer.disconnect();
              print();
            }
          },
          { threshold: 0.25 }
        );
        observer.observe(camera);
      })
      .catch((error) => {
        stop();
        console.warn("Could not load print photos:", error);
      });
  } catch (error) {
    stop();
    console.warn("Keeping the static Polaroid:", error);
  }
})();

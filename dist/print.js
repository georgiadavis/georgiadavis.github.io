(() => {
  'use strict';

  const work = document.querySelector('.work');
  const button = document.querySelector('.camera-button');
  const camera = document.querySelector('.camera');
  const card = document.querySelector('.polaroid');
  const canvas = document.querySelector('.print-canvas');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
  let frame = 0;
  let started = 0;
  let ready = false;
  let lost = false;
  const duration = 4200;

  // A real subdivided sheet: the vertex shader bends the paper, while the
  // fragment shader adds subtle curvature lighting and clips at the slot.
  const vertexSource = `
    precision highp float;
    attribute vec2 a_uv;
    uniform vec2 u_view;
    uniform vec4 u_card;
    uniform float u_slot;
    uniform vec3 u_camera;
    uniform float u_progress;
    varying vec2 v_uv;
    varying float v_bend;
    varying float v_y;
    void main() {
      float p = u_progress;
      float feed = smoothstep(0.0, 0.88, p);
      float bend = sin(p * 3.14159265);
      // Keep the entire print narrower than the opening until its trailing
      // edge has cleared the camera. Only then move it forward to the stack.
      // Measured in the actual 797 × 817 asset; leave clearance at both jambs.
      float slotWidth = u_camera.x * (632.0 / 797.0);
      float initialHeight = u_card.w * slotWidth / u_card.z;
      float top = mix(u_slot - initialHeight, u_card.y, feed);
      float released = smoothstep(u_camera.y, u_card.y, top);
      float width = mix(slotWidth, u_card.z, released);
      float height = u_card.w * width / u_card.z;
      float y = top + a_uv.y * height;
      float freePaper = smoothstep(u_slot, u_slot + u_card.w * 0.6, y);
      float curl = sin(a_uv.y * 3.14159265) * freePaper * bend;
      float slotCenter = u_camera.z + u_camera.x * (392.0 / 797.0);
      float center = mix(slotCenter, u_card.x + u_card.z * 0.5, released);
      float x = center + (a_uv.x - 0.5) * width;
      y -= curl * 22.0;
      y += (a_uv.x - 0.5) * (a_uv.x - 0.5) * 25.0 * bend * freePaper;
      // A small damped flex as the last edge releases from the rollers.
      float release = max(0.0, (p - 0.76) / 0.24);
      y += sin(release * 6.2831853) * (1.0 - release) * release * 18.0 * a_uv.y;
      v_uv = a_uv;
      v_bend = curl;
      v_y = y;
      gl_Position = vec4(x / u_view.x * 2.0 - 1.0, 1.0 - y / u_view.y * 2.0, 0.0, 1.0);
    }
  `;
  const fragmentSource = `
    precision highp float;
    uniform sampler2D u_texture;
    uniform float u_slot;
    varying vec2 v_uv;
    varying float v_bend;
    varying float v_y;
    void main() {
      if (v_y < u_slot) discard;
      vec4 paper = texture2D(u_texture, v_uv);
      float slotShadow = 1.0 - 0.18 * exp(-max(0.0, v_y - u_slot) / 10.0);
      float light = 1.0 - v_bend * 0.09;
      gl_FragColor = vec4(paper.rgb * light * slotShadow, paper.a);
    }
  `;

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    work.classList.remove('is-printing');
    button.disabled = false;
    button.setAttribute('aria-label', 'Print another Polaroid');
  }

  if (!gl) {
    button.disabled = true;
    button.setAttribute('aria-label', 'Instant camera');
    return;
  }

  function shader(type, source) {
    const result = gl.createShader(type);
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
    return result;
  }

  try {
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);

    const vertices = [];
    const columns = 24;
    const rows = 48;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const left = x / columns, right = (x + 1) / columns;
        const top = y / rows, bottom = (y + 1) / rows;
        vertices.push(left, top, right, top, left, bottom, left, bottom, right, top, right, bottom);
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_uv');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniforms = Object.fromEntries(['view', 'card', 'slot', 'camera', 'progress'].map(name => [name, gl.getUniformLocation(program, `u_${name}`)]));
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    function updateTexture() {
      const rect = card.getBoundingClientRect();
      const image = card.querySelector('.project-image');
      const imageRect = image.getBoundingClientRect();
      const texture = document.createElement('canvas');
      const scale = 3;
      texture.width = Math.round(rect.width * scale);
      texture.height = Math.round(rect.height * scale);
      const ctx = texture.getContext('2d');
      ctx.scale(scale, scale);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.roundRect(0, 0, rect.width, rect.height, 9);
      ctx.fill();
      const x = imageRect.left - rect.left, y = imageRect.top - rect.top;
      ctx.fillStyle = '#ffb9bd';
      ctx.fillRect(x, y, imageRect.width, imageRect.height);
      if (image instanceof HTMLImageElement && image.complete && image.naturalWidth) {
        const size = Math.min(image.naturalWidth, image.naturalHeight);
        ctx.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, x, y, imageRect.width, imageRect.height);
      }
      for (const label of card.querySelectorAll('figcaption span')) {
        const bounds = label.getBoundingClientRect();
        const style = getComputedStyle(label);
        ctx.fillStyle = style.color;
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = style.letterSpacing;
        ctx.textBaseline = 'middle';
        ctx.fillText(label.textContent, bounds.left - rect.left, bounds.top - rect.top + bounds.height / 2);
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texture);
    }

    function draw(now) {
      const p = Math.min((now - started) / duration, 1);
      const bounds = work.getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      const cameraRect = camera.getBoundingClientRect();
      const ratio = Math.min(devicePixelRatio || 1, 2);
      const width = Math.round(bounds.width * ratio), height = Math.round(bounds.height * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uniforms.view, bounds.width, bounds.height);
      gl.uniform4f(uniforms.card, rect.left - bounds.left, rect.top - bounds.top, rect.width, rect.height);
      gl.uniform1f(uniforms.slot, cameraRect.height * (734 / 817));
      gl.uniform3f(uniforms.camera, cameraRect.width, cameraRect.height, cameraRect.left - bounds.left);
      gl.uniform1f(uniforms.progress, p);
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
      if (p < 1) frame = requestAnimationFrame(draw);
      else stop();
    }

    function print() {
      if (!ready || frame || lost || reducedMotion.matches) return;
      try { updateTexture(); } catch (error) { console.warn('Keeping the static Polaroid:', error); return; }
      button.disabled = true;
      button.setAttribute('aria-label', 'Printing Polaroid');
      work.classList.add('is-printing');
      started = performance.now();
      frame = requestAnimationFrame(draw);
    }

    button.addEventListener('click', print);
    reducedMotion.addEventListener('change', stop);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    canvas.addEventListener('webglcontextlost', () => { lost = true; stop(); });
    Promise.all([
      document.fonts.ready,
      ...Array.from(work.querySelectorAll('img')).map(image => image.decode().catch(() => {})),
    ]).then(() => {
      ready = true;
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); print(); }
      }, { threshold: 0.25 });
      observer.observe(camera);
    });
  } catch (error) {
    stop();
    console.warn('Keeping the static Polaroid:', error);
  }
})();

(function () {
    'use strict';

    var canvas = document.getElementById('bg-canvas');
    if (!canvas) return;

    var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
        var fallback = '#3ea08c';
        var hdr = document.getElementById('header');
        var ftr = document.getElementById('footer');
        if (hdr) hdr.style.backgroundColor = fallback;
        if (ftr) ftr.style.backgroundColor = fallback;
        return;
    }

    var PAD = 6;   // extra grid cells beyond each viewport edge, hides the mesh border (set in resize)

    var NOISE = [
        'precision highp float;',
        'uniform float uTime;',

        'vec2 gh(vec2 p){',
        '  p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));',
        '  return -1.0+2.0*fract(sin(p)*43758.5453);',
        '}',
        'float gn(vec2 p){',
        '  vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);',
        '  return mix(',
        '    mix(dot(gh(i),f),dot(gh(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),',
        '    mix(dot(gh(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),',
        '        dot(gh(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);',
        '}',
        'float fbm(vec2 p){',
        '  float v=0.0,a=0.5;',
        '  mat2 R=mat2(0.80,0.60,-0.60,0.80);',
        '  for(int i=0;i<3;i++){v+=a*gn(p);p=R*p*2.1+vec2(43.7*float(i+1));a*=0.5;}',
        '  return v;',
        '}',

        'vec3 palette(float t){',
        '  vec3 c0=vec3(0.243,0.627,0.549);',
        '  vec3 c1=vec3(0.745,0.824,0.565);',
        '  vec3 c2=vec3(0.851,0.706,0.471);',
        '  vec3 c3=vec3(0.773,0.329,0.235);',
        '  t=clamp(t,0.0,1.0);float s=t*3.0;',
        '  if(s<1.0)return mix(c0,c1,s);',
        '  if(s<2.0)return mix(c1,c2,s-1.0);',
        '  return mix(c2,c3,s-2.0);',
        '}',

        // Shared flow field. The background colours are a noise pattern looked up through
        // this warp, and the mesh dots are displaced by the very same warp, so both move
        // as one. p is in background space: uv*uScale, y pointing up.
        'uniform float uScale;',
        'vec2 drift0(){float t=uTime*0.105;return vec2(gn(vec2(t*0.07,0.13)),gn(vec2(0.27,t*0.05)))*2.5;}',
        'vec2 drift1(){float t=uTime*0.105;return vec2(gn(vec2(t*0.06,0.91)),gn(vec2(0.74,t*0.08)))*2.0;}',
        'vec2 flow(vec2 p){',
        '  return vec2(fbm(p+drift0()),fbm(p+vec2(5.2,1.3)+drift1()));',
        '}'
    ].join('\n');

    // Background: soft, slowly drifting wash of the site palette
    var BG_VS = 'attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.0,1.0);}';

    var BG_FS = [
        NOISE,
        'uniform vec2  uRes;',

        'void main(){',
        '  vec2 uv=gl_FragCoord.xy/uRes;',
        '  vec2 p=uv*uScale;',
        '  vec2 q=flow(p);',
        '  float f=fbm(p*0.7+2.4*q+drift1().yx);',
        '  float val=clamp(0.5+0.90*f,0.0,1.0);',
        '  val=mix(val,1.0-uv.y,0.35);',
        '  gl_FragColor=vec4(palette(val),1.0);',
        '}'
    ].join('\n');

    // Mesh: regular grid whose vertices are carried along by the background's flow field
    var MESH_VS = [
        NOISE,
        'attribute vec2 aGrid;',
        'attribute vec2 aOff;',
        'uniform vec2  uRes;',
        'uniform float uCell;',
        'uniform float uPoint;',
        'uniform float uWarp;',
        'varying vec4  vColor;',

        'void main(){',
        '  vec2 rest=aGrid*uCell;',
        '  vec2 q=flow(vec2(rest.x/uRes.x,1.0-rest.y/uRes.y)*uScale);',
        // the colour pattern is read at p+k*q, so it bunches up where q spreads out;
        // moving each dot by -q (y flipped to screen space) bunches the dots up there too
        '  vec2 px=rest+uWarp*vec2(-q.x,q.y)+aOff;',
        '  vec2 clip=px/uRes*2.0-1.0;',
        '  gl_Position=vec4(clip.x,-clip.y,0.0,1.0);',
        // dots take a darkened palette colour that follows the deformation field,
        // and flare up pale where a ripple is passing through
        '  vec3 col=palette(0.5+1.5*(q.x-q.y))*0.55;',
        '  float glow=smoothstep(0.2,3.0,length(aOff));',
        '  vColor=vec4(mix(col,vec3(1.0,0.97,0.88),0.92*glow),mix(0.55,0.90,glow));',
        '  gl_PointSize=uPoint*(1.0+0.7*glow);',
        '}'
    ].join('\n');

    var MESH_FS = [
        'precision mediump float;',
        'varying vec4 vColor;',
        'void main(){',
        '  float d=length(gl_PointCoord-0.5);',
        '  gl_FragColor=vec4(vColor.rgb,vColor.a*(1.0-smoothstep(0.30,0.50,d)));',
        '}'
    ].join('\n');

    function mkShader(type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error('Shader error:', gl.getShaderInfoLog(s));
            gl.deleteShader(s);
            return null;
        }
        return s;
    }

    function mkProgram(vsSrc, fsSrc) {
        var vs = mkShader(gl.VERTEX_SHADER, vsSrc);
        var fs = mkShader(gl.FRAGMENT_SHADER, fsSrc);
        if (!vs || !fs) return null;
        var p = gl.createProgram();
        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(p));
            return null;
        }
        return p;
    }

    var bgProg   = mkProgram(BG_VS, BG_FS);
    var meshProg = mkProgram(MESH_VS, MESH_FS);
    if (!bgProg || !meshProg) return;

    var quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1,-1,  1,-1, -1, 1,
        -1, 1,  1,-1,  1, 1
    ]), gl.STATIC_DRAW);

    var bgPos   = gl.getAttribLocation(bgProg, 'aPos');
    var bgTime  = gl.getUniformLocation(bgProg, 'uTime');
    var bgScale = gl.getUniformLocation(bgProg, 'uScale');
    var bgRes   = gl.getUniformLocation(bgProg, 'uRes');

    var mGrid  = gl.getAttribLocation(meshProg, 'aGrid');
    var mOff   = gl.getAttribLocation(meshProg, 'aOff');
    var mTime  = gl.getUniformLocation(meshProg, 'uTime');
    var mRes   = gl.getUniformLocation(meshProg, 'uRes');
    var mCell  = gl.getUniformLocation(meshProg, 'uCell');
    var mScale = gl.getUniformLocation(meshProg, 'uScale');
    var mWarp  = gl.getUniformLocation(meshProg, 'uWarp');
    var mPoint = gl.getUniformLocation(meshProg, 'uPoint');

    var gridBuf = gl.createBuffer();
    var offBuf  = gl.createBuffer();
    var cols = 0, rows = 0, nVerts = 0;
    var h = null, hv = null;   // water surface height per grid vertex and its velocity
    var off = null;            // resulting per-vertex dot shift (css px)
    var stirred = false;
    var dpr = 1, cell = 18, cssW = 0, cssH = 0, scale = 1.8, warp = 0;

    function buildGrid() {
        cols = Math.ceil(cssW / cell) + 2 * PAD + 1;
        rows = Math.ceil(cssH / cell) + 2 * PAD + 1;
        var verts = new Float32Array(cols * rows * 2);
        var v = 0, i, j;
        for (j = 0; j < rows; j++) {
            for (i = 0; i < cols; i++) {
                verts[v++] = i - PAD;
                verts[v++] = j - PAD;
            }
        }
        nVerts = cols * rows;
        gl.bindBuffer(gl.ARRAY_BUFFER, gridBuf);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
        off = new Float32Array(nVerts * 2);
        h   = new Float32Array(nVerts);
        hv  = new Float32Array(nVerts);
        stirred = false;
        gl.bindBuffer(gl.ARRAY_BUFFER, offBuf);
        gl.bufferData(gl.ARRAY_BUFFER, off, gl.DYNAMIC_DRAW);
    }

    // Pointer interaction: the grid doubles as a water surface. A press drops a small
    // dent into it, a drag trails dents behind the pointer, and the wave equation
    // carries the ripples outwards. Dots are shifted along the surface slope.
    var WAVE_SPEED = 100;   // css px per second
    var WAVE_DAMP  = 0.3;   // per second
    var DROP_RADIUS = 45;   // css px
    var PUSH = 16;          // css px of dot shift per unit of surface slope

    function drop(x, y, strength) {
        var gx = x / cell + PAD, gy = y / cell + PAD, r = DROP_RADIUS / cell;
        var i0 = Math.max(1, Math.floor(gx - r)), i1 = Math.min(cols - 2, Math.ceil(gx + r));
        var j0 = Math.max(1, Math.floor(gy - r)), j1 = Math.min(rows - 2, Math.ceil(gy + r));
        for (var j = j0; j <= j1; j++) {
            for (var i = i0; i <= i1; i++) {
                var d2 = ((i - gx) * (i - gx) + (j - gy) * (j - gy)) / (r * r);
                if (d2 < 1) hv[j * cols + i] -= strength * (1 - d2) * (1 - d2);
            }
        }
        stirred = true;
    }

    function trail(x0, y0, x1, y1) {
        var dist = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
        var steps = Math.max(1, Math.ceil(dist / cell));
        for (var k = 1; k <= steps; k++) {
            var a = k / steps;
            drop(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, 0.125 * dist / steps);
        }
    }

    function ripple(dt) {
        var c2 = (WAVE_SPEED / cell) * (WAVE_SPEED / cell);
        var decay = Math.exp(-WAVE_DAMP * dt);
        var i, j, n, peak = 0;
        for (j = 1; j < rows - 1; j++) {
            for (i = 1; i < cols - 1; i++) {
                n = j * cols + i;
                // 9-point Laplacian, keeps the rings round on a square grid
                var lap = (4 * (h[n - 1] + h[n + 1] + h[n - cols] + h[n + cols]) +
                           h[n - cols - 1] + h[n - cols + 1] + h[n + cols - 1] + h[n + cols + 1] -
                           20 * h[n]) / 6;
                hv[n] = (hv[n] + c2 * lap * dt) * decay;
            }
        }
        for (n = 0; n < h.length; n++) {
            h[n] += hv[n] * dt;
            var m = Math.abs(h[n]) + Math.abs(hv[n]) * 0.05;
            if (m > peak) peak = m;
        }
        if (peak < 0.004) {
            h.fill(0); hv.fill(0); off.fill(0);
            stirred = false;
            return;
        }
        for (j = 1; j < rows - 1; j++) {
            for (i = 1; i < cols - 1; i++) {
                n = j * cols + i;
                off[2 * n]     = PUSH * (h[n + 1] - h[n - 1]) * 0.5;
                off[2 * n + 1] = PUSH * (h[n + cols] - h[n - cols]) * 0.5;
            }
        }
    }

    var last = null;
    function down(x, y) { last = [x, y]; drop(x, y, 9.5); }
    function move(x, y) {
        if (!last) return;
        trail(last[0], last[1], x, y);
        last = [x, y];
    }
    function up() { last = null; }

    // presses on the avatar and the header emojis belong to their own easter eggs,
    // they leave the water alone
    function onAvatar(e) { return !!(e.target.closest && e.target.closest('.image.avatar, .party-emoji')); }

    // browsers replay a tap as a mouse click right afterwards; that echo must not count twice
    var lastTouch = -1e9;
    function echo() { return Date.now() - lastTouch < 800; }

    window.addEventListener('mousedown', function (e) { if (e.button === 0 && !onAvatar(e) && !echo()) down(e.clientX, e.clientY); });
    window.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', up);
    // passive, so touch drags still scroll the page
    var passive = { passive: true };
    window.addEventListener('touchstart', function (e) {
        lastTouch = Date.now();
        if (!onAvatar(e)) down(e.touches[0].clientX, e.touches[0].clientY);
    }, passive);
    window.addEventListener('touchmove', function (e) { move(e.touches[0].clientX, e.touches[0].clientY); }, passive);
    window.addEventListener('touchend', function () { lastTouch = Date.now(); up(); }, passive);
    window.addEventListener('touchcancel', up, passive);

    // A touch drag that starts on the bare background (header, footer) plays with the
    // mesh instead of scrolling; drags on the page body scroll as usual.
    var onBackground = false;
    window.addEventListener('touchstart', function (e) {
        onBackground = !(e.target.closest && e.target.closest('#main'));
    }, passive);
    window.addEventListener('touchmove', function (e) {
        if (onBackground && e.cancelable) e.preventDefault();
    }, { passive: false });

    function resize() {
        dpr  = Math.min(window.devicePixelRatio || 1, 2);
        cssW = canvas.clientWidth;
        cssH = canvas.clientHeight;
        cell = cssW < 600 ? 14 : 18;
        scale = cssW < 600 ? 1.44 : 1.8;
        // dot displacement in css px per unit of flow, sized to the flow field's features
        warp = 0.8 * Math.min(cssW, cssH) / scale;
        PAD  = Math.ceil(0.7 * warp / cell) + 1;
        canvas.width  = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
        buildGrid();
    }
    window.addEventListener('resize', resize);
    resize();

    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // Random point for a raindrop. Most drops are steered to the part of the viewport
    // that is not covered by the page body, the rest may land anywhere.
    var mainEl = document.getElementById('main');
    function rainSpot() {
        var x = Math.random() * cssW, y = Math.random() * cssH;
        if (!mainEl || Math.random() > 0.85) return [x, y];
        var r = mainEl.getBoundingClientRect();
        for (var k = 0; k < 20; k++) {
            if (x < r.left || x > r.right || y < r.top || y > r.bottom) break;
            x = Math.random() * cssW;
            y = Math.random() * cssH;
        }
        return [x, y];
    }

    var t0 = null, tPrev = 0, nextDrop = 1.0;
    function frame(ts) {
        if (!t0) t0 = ts;
        var t = (ts - t0) / 1000.0;
        var dt = Math.min(t - tPrev, 1 / 30);
        tPrev = t;

        // rain: a drop lands every couple of seconds, mostly where the background shows
        if (t >= nextDrop) {
            var spot = rainSpot();
            drop(spot[0], spot[1], 4 + Math.random() * 5);
            nextDrop = t + 0.8 + Math.random() * 2.8;
        }

        gl.disable(gl.BLEND);
        gl.useProgram(bgProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.enableVertexAttribArray(bgPos);
        gl.vertexAttribPointer(bgPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1f(bgTime,  t);
        gl.uniform1f(bgScale, scale);
        gl.uniform2f(bgRes,   canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.enable(gl.BLEND);
        gl.useProgram(meshProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, gridBuf);
        gl.enableVertexAttribArray(mGrid);
        gl.vertexAttribPointer(mGrid, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, offBuf);
        if (stirred) {
            // two substeps keep the wave update well inside its stability limit
            ripple(dt / 2);
            if (stirred) ripple(dt / 2);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, off);
        }
        gl.enableVertexAttribArray(mOff);
        gl.vertexAttribPointer(mOff, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1f(mTime, t);
        gl.uniform2f(mRes,  cssW, cssH);
        gl.uniform1f(mCell, cell);
        gl.uniform1f(mScale, scale);
        gl.uniform1f(mWarp, warp);

        gl.uniform1f(mPoint, 3.0 * dpr);
        gl.drawArrays(gl.POINTS, 0, nVerts);

        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
})();

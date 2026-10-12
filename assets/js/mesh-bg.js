(function () {
    'use strict';

    var canvas = document.getElementById('bg-canvas');
    if (!canvas) return;

    // Background gradient, top of the page to the bottom. 2 to 8 colours.
    var MAX_STOPS = 8;
    var palette = ['#5d99d5', '#d97db8'];
    // Dots: null takes a darkened shade of the gradient under each dot, a hex code fixes one colour.
    var dotColor = null;
    // Colour the dots flare up in while a ripple (raindrop, click, drag) passes through them.
    var glowColor = '#fff7e0';

    var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
        var fallback = palette[Math.floor(palette.length / 2)];
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

        // piecewise-linear gradient through the uStops colours
        'uniform vec3  uStops[8];',
        'uniform float uStopCount;',
        'vec3 palette(float t){',
        '  float s=clamp(t,0.0,1.0)*(uStopCount-1.0);',
        '  vec3 c=uStops[0];',
        '  for(int i=0;i<7;i++){',
        '    if(float(i)<uStopCount-1.0)c=mix(c,uStops[i+1],clamp(s-float(i),0.0,1.0));',
        '  }',
        '  return c;',
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
        '  float val=clamp(0.5+1.40*f,0.0,1.0);',
        '  val=mix(val,1.0-uv.y,0.35);',
        // the raw values bunch up around the middle; this S-curve spreads them out evenly
        // so every colour of the palette covers a similar share of the screen
        '  float e=exp(-14.0*(val-0.46));',
        '  val=0.5+0.5*(1.0-e)/(1.0+e);',
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
        'uniform vec3  uDot;',
        'uniform float uDotFixed;',
        'uniform vec2  uDotShade;',
        'uniform vec3  uGlow;',
        'uniform vec2  uSpecial;',
        'uniform float uPick;',
        'varying vec4  vColor;',
        'varying float vPick;',

        'void main(){',
        '  vec2 rest=aGrid*uCell;',
        '  vec2 q=flow(vec2(rest.x/uRes.x,1.0-rest.y/uRes.y)*uScale);',
        // the colour pattern is read at p+k*q, so it bunches up where q spreads out;
        // moving each dot by -q (y flipped to screen space) bunches the dots up there too
        // one vertex is special (see the easter egg further down): same motion, a bit bigger
        '  float special=step(distance(aGrid,uSpecial),0.25);',
        '  vec2 px=rest+uWarp*vec2(-q.x,q.y)+aOff;',
        '  vec2 clip=px/uRes*2.0-1.0;',
        '  gl_Position=vec4(clip.x,-clip.y,0.0,1.0);',
        // dots take a darkened palette colour that follows the deformation field,
        // and flare up pale where a ripple is passing through
        '  vec3 col=mix(palette(0.5+1.5*(q.x-q.y))*uDotShade.x+uDotShade.y,uDot,uDotFixed);',
        '  float glow=smoothstep(0.2,3.0,length(aOff));',
        '  vColor=vec4(mix(col,uGlow,0.92*glow),mix(0.55,0.90,glow));',
        '  gl_PointSize=uPoint*(1.0+0.7*glow)*mix(1.0,2.1,special);',
        // hit-test pass: only the special dot is drawn, as a big flat square
        '  vPick=step(0.5,uPick);',
        '  if(uPick>0.5){',
        '    gl_PointSize=uPick;',
        '    if(special<0.5)gl_Position=vec4(2.0,2.0,2.0,1.0);',
        '  }',
        '}'
    ].join('\n');

    var MESH_FS = [
        'precision mediump float;',
        'varying vec4 vColor;',
        'varying float vPick;',
        'void main(){',
        '  if(vPick>0.5){gl_FragColor=vec4(1.0);return;}',
        '  vec2 c=gl_PointCoord-0.5;',
        '  float round=1.0-smoothstep(0.30,0.50,length(c));',
        '  gl_FragColor=vec4(vColor.rgb,vColor.a*round);',
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
    var bgStops = gl.getUniformLocation(bgProg, 'uStops');
    var bgCount = gl.getUniformLocation(bgProg, 'uStopCount');

    var mGrid  = gl.getAttribLocation(meshProg, 'aGrid');
    var mOff   = gl.getAttribLocation(meshProg, 'aOff');
    var mTime  = gl.getUniformLocation(meshProg, 'uTime');
    var mRes   = gl.getUniformLocation(meshProg, 'uRes');
    var mCell  = gl.getUniformLocation(meshProg, 'uCell');
    var mScale = gl.getUniformLocation(meshProg, 'uScale');
    var mWarp  = gl.getUniformLocation(meshProg, 'uWarp');
    var mPoint = gl.getUniformLocation(meshProg, 'uPoint');
    var mStops = gl.getUniformLocation(meshProg, 'uStops');
    var mCount = gl.getUniformLocation(meshProg, 'uStopCount');
    var mDot   = gl.getUniformLocation(meshProg, 'uDot');
    var mDotFixed = gl.getUniformLocation(meshProg, 'uDotFixed');
    var mDotShade = gl.getUniformLocation(meshProg, 'uDotShade');
    var mGlow  = gl.getUniformLocation(meshProg, 'uGlow');
    var mSpecial = gl.getUniformLocation(meshProg, 'uSpecial');
    var mPick  = gl.getUniformLocation(meshProg, 'uPick');

    // colours as shader data; window.meshBackground lets them be swapped at runtime
    function cleanHex(hex) {
        var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
        return m ? '#' + m[1].toLowerCase() : null;
    }
    function rgb(hex) {
        var n = parseInt(hex.slice(1), 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }

    var stopData = new Float32Array(MAX_STOPS * 3), stopCount = 0, dotShade = [0.55, 0.0];
    function setPalette(hexes) {
        var ok = [];
        for (var i = 0; i < hexes.length && ok.length < MAX_STOPS; i++) {
            var h = cleanHex(hexes[i]);
            if (h) ok.push(h);
        }
        if (ok.length < 2) return false;
        palette = ok;
        stopCount = ok.length;
        var light = 0;
        for (var k = 0; k < MAX_STOPS; k++) {
            var c = rgb(ok[Math.min(k, stopCount - 1)]);
            stopData.set(c, k * 3);
            if (k < stopCount) light += (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / stopCount;
        }
        // automatic dots are a darker shade of the gradient, or a lighter one if the gradient is dark
        dotShade = light < 0.42 ? [0.60, 0.40] : [0.55, 0.0];
        return true;
    }
    setPalette(palette);

    var dotRgb = [0, 0, 0], glowRgb = [1, 1, 1];
    function setDotColor(hex) {
        dotColor = hex === null ? null : (cleanHex(hex) || dotColor);
        if (dotColor) dotRgb = rgb(dotColor);
    }
    function setGlowColor(hex) {
        glowColor = cleanHex(hex) || glowColor;
        glowRgb = rgb(glowColor);
    }
    setDotColor(dotColor);
    setGlowColor(glowColor);

    window.meshBackground = {
        setPalette: setPalette,
        getPalette: function () { return palette.slice(); },
        setDotColor: setDotColor,
        getDotColor: function () { return dotColor; },
        setGlowColor: setGlowColor,
        getGlowColor: function () { return glowColor; }
    };

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
        chooseSpecial();
    }

    // Easter egg: one vertex of the mesh is a bit bigger than the rest. Double-clicking or
    // double-tapping it opens the gradient explorer (assets/js/gradient-explorer.js).
    // It is a random vertex near the left or right side of the background that shows when
    // the page is at the top. It moves with the mesh like every other vertex, so it is
    // picked by where it actually is when the page loads, and drifts on from there.
    var special = [-1000, -1000];
    function chooseSpecial() {
        var sx = window.pageXOffset || 0, sy = window.pageYOffset || 0;
        var edge = 0.15 * warp, band = 0.2 * warp, avoid = [];
        function box(el, margin) {
            var r = el.getBoundingClientRect();
            return [r.left + sx - margin, r.top + sy - margin, r.right + sx + margin, r.bottom + sy + margin];
        }
        Array.prototype.forEach.call(document.querySelectorAll('#header .inner > *, #footer .copyright'), function (el) {
            avoid.push(box(el, 16));
        });

        // Stretches of background left visible by the page body: [left, right, bottom].
        // Side by side with the body (wide screens) they run the full height, above the
        // body (single column) they end where it starts.
        var areas = [], body = document.getElementById('main');
        var m = body ? box(body, 0) : null;
        if (!m) areas.push([0, cssW, cssH]);
        else {
            if (m[0] > 2 * edge + band) areas.push([0, m[0], cssH]);
            if (cssW - m[2] > 2 * edge + band) areas.push([m[2], cssW, cssH]);
            if (!areas.length) areas.push([0, cssW, Math.min(cssH, m[1])]);
        }

        function clear(x, y) {
            for (var k = 0; k < avoid.length; k++) {
                if (x > avoid[k][0] && x < avoid[k][2] && y > avoid[k][1] && y < avoid[k][3]) return false;
            }
            return true;
        }
        // home in a strip along the left or right side of such an area, a little in from its edge
        function candidate() {
            for (var tries = 0; tries < 400; tries++) {
                var a = areas[Math.floor(Math.random() * areas.length)];
                var inset = edge + Math.random() * band;
                var x = Math.random() < 0.5 ? a[0] + inset : a[1] - inset;
                var y = edge + Math.random() * Math.max(0, a[2] - 2 * edge);
                var i = Math.round(x / cell) + PAD, j = Math.round(y / cell) + PAD;
                if (i < 0 || i >= cols || j < 0 || j >= rows) continue;
                if (tries < 300 && !clear((i - PAD) * cell, (j - PAD) * cell)) continue;
                special = [i - PAD, j - PAD];
                return a;
            }
            return null;
        }
        // The mesh carries a vertex away from its home, so check where each candidate really
        // is right now and take the first one that sits on visible, unobstructed background.
        var keep = 20;
        for (var attempt = 0; attempt < 12; attempt++) {
            var area = candidate();
            if (!area || !verify) return;
            var at = locateSpecial();
            if (at && at[0] > area[0] + keep && at[0] < area[1] - keep &&
                at[1] > keep && at[1] < area[2] - keep && clear(at[0], at[1])) return;
        }
    }

    // Where the special vertex currently is on screen (css px), or null if it is off screen.
    // Its position only exists on the GPU, so it is drawn alone into a small offscreen
    // image and looked up there.
    var PICK_N = 256, pickFbo = null, pickPixels = new Uint8Array(PICK_N * PICK_N * 4);
    function locateSpecial() {
        if (!pickFbo) {
            var tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, PICK_N, PICK_N, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            pickFbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo);
        gl.viewport(0, 0, PICK_N, PICK_N);
        gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        drawMesh(clock || 0, 3.0);
        gl.readPixels(0, 0, PICK_N, PICK_N, gl.RGBA, gl.UNSIGNED_BYTE, pickPixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        var n = 0, sumX = 0, sumY = 0;
        for (var k = 0; k < PICK_N * PICK_N; k++) {
            if (pickPixels[k * 4] > 128) { n++; sumX += k % PICK_N; sumY += Math.floor(k / PICK_N); }
        }
        if (!n) return null;
        return [(sumX / n + 0.5) / PICK_N * cssW, (1 - (sumY / n + 0.5) / PICK_N) * cssH];
    }

    // while the window is being dragged to a new size only the cheap part runs; the check
    // against the real position follows once the size has settled
    var verify = false, settle = null;
    function chooseVerified() { verify = true; chooseSpecial(); verify = false; }
    window.addEventListener('resize', function () {
        resize();
        clearTimeout(settle);
        settle = setTimeout(chooseVerified, 250);
    });
    window.addEventListener('load', chooseVerified);   // the header only has its final size once the avatar is in
    resize();
    chooseVerified();

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

    // The animation runs on its own clock that only advances while frames are being
    // drawn (at most 1/30 s per frame). A hidden or throttled page therefore pauses
    // instead of piling up rain and jumping ahead when you come back.
    var tsPrev = null, clock = 0, nextDrop = 1.0;
    function frame(ts) {
        var dt = tsPrev === null ? 0 : Math.min(Math.max(ts - tsPrev, 0) / 1000.0, 1 / 30);
        tsPrev = ts;
        clock += dt;
        var t = clock;

        // rain: a drop lands every couple of seconds, mostly where the background shows
        if (t >= nextDrop) {
            var spot = rainSpot();
            drop(spot[0], spot[1], 4 + Math.random() * 5);
            nextDrop = t + 0.8 + Math.random() * 2.8;
        }

        if (stirred) {
            // two substeps keep the wave update well inside its stability limit
            ripple(dt / 2);
            if (stirred) ripple(dt / 2);
            gl.bindBuffer(gl.ARRAY_BUFFER, offBuf);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, off);
        }

        render(t);
        requestAnimationFrame(frame);
    }

    function drawMesh(t, pick) {
        gl.useProgram(meshProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, gridBuf);
        gl.enableVertexAttribArray(mGrid);
        gl.vertexAttribPointer(mGrid, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, offBuf);
        gl.enableVertexAttribArray(mOff);
        gl.vertexAttribPointer(mOff, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1f(mTime, t);
        gl.uniform2f(mRes,  cssW, cssH);
        gl.uniform1f(mCell, cell);
        gl.uniform1f(mScale, scale);
        gl.uniform1f(mWarp, warp);
        gl.uniform3fv(mStops, stopData);
        gl.uniform1f(mCount, stopCount);
        gl.uniform3f(mDot, dotRgb[0], dotRgb[1], dotRgb[2]);
        gl.uniform1f(mDotFixed, dotColor ? 1.0 : 0.0);
        gl.uniform2f(mDotShade, dotShade[0], dotShade[1]);
        gl.uniform3f(mGlow, glowRgb[0], glowRgb[1], glowRgb[2]);
        gl.uniform2f(mSpecial, special[0], special[1]);
        gl.uniform1f(mPick, pick);
        gl.uniform1f(mPoint, 3.0 * dpr);
        gl.drawArrays(gl.POINTS, 0, nVerts);
    }

    function render(t) {
        gl.disable(gl.BLEND);
        gl.useProgram(bgProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.enableVertexAttribArray(bgPos);
        gl.vertexAttribPointer(bgPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1f(bgTime,  t);
        gl.uniform1f(bgScale, scale);
        gl.uniform3fv(bgStops, stopData);
        gl.uniform1f(bgCount, stopCount);
        gl.uniform2f(bgRes,   canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.enable(gl.BLEND);
        drawMesh(t, 0.0);
    }

    // Is the special dot under this point of the viewport? The dot's position only exists
    // on the GPU, so it is drawn alone as a finger-sized square and the pixel is read back;
    // the normal picture is redrawn right away, so this never shows.
    function specialAt(x, y) {
        var px = new Uint8Array(4);
        gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        drawMesh(clock, 44 * dpr);
        gl.readPixels(Math.round(x * dpr), canvas.height - Math.round(y * dpr) - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        render(clock);
        return px[0] > 128;
    }

    var explorerRequested = false;
    function openExplorer() {
        if (window.gradientExplorer) { window.gradientExplorer.open(); return; }
        if (explorerRequested) return;
        explorerRequested = true;
        var script = document.createElement('script');
        script.src = 'assets/js/gradient-explorer.js';
        document.body.appendChild(script);
    }

    var lastClick = { t: -1e9, x: 0, y: 0 };
    window.addEventListener('click', function (e) {
        if (e.button !== 0 || (e.target.closest && e.target.closest('#main, #gradient-explorer'))) return;
        var now = Date.now(), dx = e.clientX - lastClick.x, dy = e.clientY - lastClick.y;
        var second = now - lastClick.t < 450 && dx * dx + dy * dy < 30 * 30;
        lastClick = { t: second ? -1e9 : now, x: e.clientX, y: e.clientY };
        if (second && specialAt(e.clientX, e.clientY)) openExplorer();
    });
    requestAnimationFrame(frame);

    // shortcut to the same easter egg: ?gradient in the URL
    if (/[?&]gradient\b/.test(window.location.search)) openExplorer();
})();

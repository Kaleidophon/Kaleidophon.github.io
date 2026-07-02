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

    var VS = 'attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.0,1.0);}';

    var FS = [
        'precision highp float;',
        'uniform float uTime;',
        'uniform float uScale;',
        'uniform vec2  uRes;',

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

        'void main(){',
        '  vec2 uv=gl_FragCoord.xy/uRes;',
        '  float t=uTime*0.035;',
        '  vec2 p=uv*uScale;',
        '  vec2 d0=vec2(gn(vec2(t*0.07,0.13)),gn(vec2(0.27,t*0.05)))*2.5;',
        '  vec2 d1=vec2(gn(vec2(t*0.06,0.91)),gn(vec2(0.74,t*0.08)))*2.0;',
        '  vec2 d2=vec2(gn(vec2(t*0.09,0.45)),gn(vec2(0.52,t*0.06)))*1.6;',
        '  vec2 q=vec2(',
        '    fbm(p+d0),',
        '    fbm(p+vec2(5.2,1.3)+d1));',
        '  vec2 r=vec2(',
        '    fbm(p+11.0*q+vec2(1.7,9.2)+d2),',
        '    fbm(p+11.0*q+vec2(8.3,2.8)+d2.yx));',
        '  vec2 s=vec2(',
        '    fbm(p+11.0*r+vec2(3.1,5.8)+d0.yx),',
        '    fbm(p+11.0*r+vec2(6.4,1.1)+d1.yx));',
        '  float f=fbm(p+10.0*s);',
        '  float val=clamp(0.5+0.70*f,0.0,1.0);',
        '  val=mix(val,1.0-uv.y,0.35);',
        '  gl_FragColor=vec4(palette(val),1.0);',
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

    var vs = mkShader(gl.VERTEX_SHADER, VS);
    var fs = mkShader(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return;

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(prog));
        return;
    }

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1,-1,  1,-1, -1, 1,
        -1, 1,  1,-1,  1, 1
    ]), gl.STATIC_DRAW);

    var aPos   = gl.getAttribLocation(prog, 'aPos');
    var uTime  = gl.getUniformLocation(prog, 'uTime');
    var uScale = gl.getUniformLocation(prog, 'uScale');
    var uRes   = gl.getUniformLocation(prog, 'uRes');

    function resize() {
        canvas.width  = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
    }
    window.addEventListener('resize', resize);
    resize();

    var t0 = null;
    function frame(ts) {
        if (!t0) t0 = ts;
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1f(uTime,  (ts - t0) / 1000.0);
        gl.uniform1f(uScale, canvas.width < 600 ? 1.44 : 1.8);
        gl.uniform2f(uRes,   canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
})();
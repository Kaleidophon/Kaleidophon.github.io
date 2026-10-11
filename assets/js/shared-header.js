(function () {
    var inner = document.querySelector('#header .inner');
    if (!inner) return;
    inner.innerHTML =
        '<a href="index.html" class="image avatar"><span class="coin">' +
        '<img src="images/avatar.jpg" alt=""/>' +
        '<img class="coin-back" src="easteregg.jpg" alt="" aria-hidden="true"/>' +
        '</span></a>' +
        '<p style="color:white">Dennis Ulmer (they / them)<br>' +
        'Working with <span class="party-emoji">&#x1F916;</span><span class="party-emoji">&#x1F4AD;</span><br>' +
        '</p>';

    // Easter egg: a double click / double tap on the avatar flips it like a coin,
    // shows the other side for a few seconds and flips back on its own.
    var avatar = inner.querySelector('.image.avatar');
    var coin = avatar.querySelector('.coin');
    var DOUBLE_MS = 400, SPIN_MS = 1000, SHOW_MS = 3000;
    var pending = null, busy = false;

    avatar.addEventListener('click', function (e) {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (busy) return;
        if (pending) {
            clearTimeout(pending);
            pending = null;
            busy = true;
            coin.classList.add('flipped');
            setTimeout(function () {
                coin.classList.remove('flipped');
                setTimeout(function () { busy = false; }, SPIN_MS);
            }, SPIN_MS + SHOW_MS);
        } else {
            // a single click still follows the link, once it is clear no second one is coming
            var href = avatar.href;
            pending = setTimeout(function () {
                pending = null;
                window.location.href = href;
            }, DOUBLE_MS);
        }
    });

    // Easter egg: clicking / tapping the two emojis one right after the other turns
    // both into party poppers for a moment and throws confetti from them.
    var emojis = inner.querySelectorAll('.party-emoji');
    var PAIR_MS = 700, PARTY_MS = 2000;
    var lastHit = -1, lastHitAt = 0, partying = false;

    function confetti(x, y) {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        var canvas = document.createElement('canvas');
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var w = window.innerWidth, h = window.innerHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10000;';
        document.body.appendChild(canvas);
        var ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        var colors = ['#ff5e7e', '#ffb02e', '#ffe14d', '#4dd4ac', '#3fa9f5', '#8f6bff', '#ff7ad9', '#ffffff'];
        var bits = [], LIFE = 2.6, STREAM = 0.5, emitted = 0, TOTAL = 260;
        function emit() {
            // mostly upwards, fanned out to both sides
            var angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
            var speed = 220 + Math.random() * 520;
            bits.push({
                x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                w: 5 + Math.random() * 5, h: 8 + Math.random() * 6,
                rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 14,
                flip: Math.random() * Math.PI, flipSpeed: 4 + Math.random() * 8,
                color: colors[Math.floor(Math.random() * colors.length)], age: 0
            });
        }

        var start = null, prev = 0;
        function step(ts) {
            if (start === null) start = ts;
            var t = (ts - start) / 1000, dt = Math.min(t - prev, 1 / 30);
            prev = t;
            // a burst right away, then a short stream so it keeps pouring out of the emojis
            var due = Math.min(TOTAL, Math.floor(TOTAL * (0.5 + 0.5 * Math.min(1, t / STREAM))));
            while (emitted < due) { emit(); emitted++; }

            ctx.clearRect(0, 0, w, h);
            for (var i = 0; i < bits.length; i++) {
                var b = bits[i];
                b.age += dt;
                b.vy += 900 * dt;
                b.vx *= 1 - 1.2 * dt;
                b.vy *= 1 - 1.2 * dt;
                b.x += b.vx * dt;
                b.y += b.vy * dt;
                b.rot += b.spin * dt;
                b.flip += b.flipSpeed * dt;
                ctx.save();
                ctx.globalAlpha = Math.max(0, Math.min(1, (LIFE - b.age) / 0.6));
                ctx.translate(b.x, b.y);
                ctx.rotate(b.rot);
                ctx.fillStyle = b.color;
                ctx.fillRect(-b.w / 2, -b.h / 2 * Math.cos(b.flip), b.w, b.h * Math.cos(b.flip));
                ctx.restore();
            }
            if (t < LIFE + STREAM) requestAnimationFrame(step);
            else canvas.parentNode.removeChild(canvas);
        }
        requestAnimationFrame(step);
    }

    function party() {
        partying = true;
        var originals = [], box = null;
        for (var i = 0; i < emojis.length; i++) {
            originals.push(emojis[i].textContent);
            emojis[i].textContent = '\uD83C\uDF89';
            var r = emojis[i].getBoundingClientRect();
            box = box ? { left: Math.min(box.left, r.left), right: Math.max(box.right, r.right), top: Math.min(box.top, r.top), bottom: Math.max(box.bottom, r.bottom) } : r;
        }
        confetti((box.left + box.right) / 2, (box.top + box.bottom) / 2);
        setTimeout(function () {
            for (var i = 0; i < emojis.length; i++) emojis[i].textContent = originals[i];
            partying = false;
        }, PARTY_MS);
    }

    Array.prototype.forEach.call(emojis, function (el, index) {
        el.addEventListener('click', function () {
            if (partying) return;
            var now = Date.now();
            if (lastHit !== -1 && lastHit !== index && now - lastHitAt < PAIR_MS) {
                lastHit = -1;
                party();
            } else {
                lastHit = index;
                lastHitAt = now;
            }
        });
    });
})();

(function () {
    var inner = document.querySelector('#header .inner');
    if (!inner) return;
    inner.innerHTML =
        '<a href="index.html" class="image avatar"><span class="coin">' +
        '<img src="images/avatar.jpg" alt=""/>' +
        '<img class="coin-back" src="easteregg.jpg" alt="" aria-hidden="true"/>' +
        '</span></a>' +
        '<p style="color:white">Dennis Ulmer (they / them)<br>' +
        'Working with &#x1F916;&#x1F4AD;<br>' +
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
})();

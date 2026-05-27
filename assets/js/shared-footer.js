(function () {
    var inner = document.querySelector('#footer .inner');
    if (!inner) return;
    inner.innerHTML =
        '<ul class="copyright">' +
        '<li>&copy; ' + new Date().getFullYear() + ' Dennis Ulmer</li>' +
        '<li>Design: <a href="http://html5up.net">HTML5 UP</a></li>' +
        '</ul>';
})();
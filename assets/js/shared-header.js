(function () {
    var inner = document.querySelector('#header .inner');
    if (!inner) return;
    inner.innerHTML =
        '<a href="index.html" class="image avatar"><img src="images/avatar.jpg" alt=""/></a>' +
        '<p style="color:white">Dennis Ulmer <small style="font-size:0.6em">(they / them)</small><br>' +
        'Working with &#x1F916;&#x1F4AD;<br>' +
        '</p>';
})();
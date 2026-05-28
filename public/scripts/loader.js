var _loaderOverlay = document.querySelector('#loaderOverlay');
var _loaderCount   = 0;

$(document).ajaxSend(function () {
    if (_loaderCount === 0) _loaderOverlay.classList.add('active');
    _loaderCount++;
});

$(document).ajaxComplete(function () {
    _loaderCount = Math.max(0, _loaderCount - 1);
    if (_loaderCount === 0) _loaderOverlay.classList.remove('active');
});

function showLoader() {
    if (_loaderCount === 0) _loaderOverlay.classList.add('active');
    _loaderCount++;
}

function hideLoader() {
    _loaderCount = Math.max(0, _loaderCount - 1);
    if (_loaderCount === 0) _loaderOverlay.classList.remove('active');
}

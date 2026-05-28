var _loaderOverlay = null;
var _loaderCount   = 0;

function _getLoaderOverlay() {
    if (!_loaderOverlay) _loaderOverlay = document.getElementById('loaderOverlay');
    return _loaderOverlay;
}

$(document).ajaxSend(function () {
    var el = _getLoaderOverlay();
    if (_loaderCount === 0 && el) el.classList.add('active');
    _loaderCount++;
});
$(document).ajaxComplete(function () {
    var el = _getLoaderOverlay();
    _loaderCount = Math.max(0, _loaderCount - 1);
    if (_loaderCount === 0 && el) el.classList.remove('active');
});

function showLoader() {
    var el = _getLoaderOverlay();
    if (_loaderCount === 0 && el) el.classList.add('active');
    _loaderCount++;
}

function hideLoader() {
    var el = _getLoaderOverlay();
    _loaderCount = Math.max(0, _loaderCount - 1);
    if (_loaderCount === 0 && el) el.classList.remove('active');
}

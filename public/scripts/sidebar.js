// Боковая панель табло: только журнал с самодиагностикой и версия программы.
// Настраивают табло из BCS_DrillerMonitorLoader — по TCP/IP или по RS-485.

let sideBar = document.querySelector('#sideBar');
let logo    = document.querySelector('#sideBarLogo');

// ── Автоскрытие ──────────────────────────────────────────────────────────────

var _collapseTimer = null;
var _collapseDelay = 20;

function _restartCollapseTimer() {
    clearTimeout(_collapseTimer);
    if (_collapseDelay > 0 && sideBar.classList.contains('open')) {
        _collapseTimer = setTimeout(function () {
            sideBar.classList.remove('open');
        }, _collapseDelay * 1000);
    }
}

['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(function(evt) {
    document.addEventListener(evt, _restartCollapseTimer, { passive: true });
});

window.setSidebarTimeout = function(sec) {
    _collapseDelay = Math.max(0, parseInt(sec) || 0);
    _restartCollapseTimer();
};

// ── Открытие по логотипу ─────────────────────────────────────────────────────
// Пароль больше не спрашиваем: менять на табло нечего, панель только показывает
// журнал и версию.

logo.addEventListener('click', function() {
    if (sideBar.classList.contains('open')) {
        sideBar.classList.remove('open');
        clearTimeout(_collapseTimer);
        return;
    }
    sideBar.classList.add('open');
    _restartCollapseTimer();
});

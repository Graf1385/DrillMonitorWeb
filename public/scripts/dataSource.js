(function () {
    'use strict';

    var PLAY_ICON = '<polygon points="5,3 19,12 5,21" fill="currentColor" fill-opacity="0.18" stroke="currentColor"/>';
    var STOP_ICON = '<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" fill-opacity="0.18" stroke="currentColor"/>';

    var _applyRunState = window._applyRunState = function (running) {
        /* sidebar button */
        var sbBtn  = document.getElementById('dsRunButton');
        var sbIcon = document.getElementById('dsRunIcon');
        if (sbBtn)  { sbBtn.classList.toggle('ds-sb-running', !!running); sbBtn.title = running ? 'Стоп' : 'Старт'; }
        if (sbIcon) { sbIcon.innerHTML = running ? STOP_ICON : PLAY_ICON; }
    }

    window.dsToggleRun = function () {
        var sbBtn   = document.getElementById('dsRunButton');
        var running = sbBtn && sbBtn.classList.contains('ds-sb-running');
        var url     = running ? '/api/data-source/stop' : '/api/data-source/start';
        $.ajax({ url: url, method: 'POST' })
            .done(function (r) { _applyRunState(r.settings.running); })
            .fail(function (xhr) {
                if (xhr.status === 401) { if (typeof showLoginModal === 'function') showLoginModal(); return; }
                showError((xhr.responseJSON && xhr.responseJSON.error) || 'Ошибка');
            });
    };

    $(document).ready(function () {
        $.getJSON('/api/data-source/settings', function (s) { _applyRunState(s.running); });
    });

})();

(function () {
    'use strict';

    var PLAY_ICON = '<polygon points="5,3 19,12 5,21" fill="currentColor" fill-opacity="0.18" stroke="currentColor"/>';
    var STOP_ICON = '<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" fill-opacity="0.18" stroke="currentColor"/>';

    function _applyRunState(running) {
        /* sidebar button */
        var sbBtn  = document.getElementById('dsRunButton');
        var sbIcon = document.getElementById('dsRunIcon');
        if (sbBtn)  { sbBtn.classList.toggle('ds-sb-running', !!running); sbBtn.title = running ? 'Стоп' : 'Старт'; }
        if (sbIcon) { sbIcon.innerHTML = running ? STOP_ICON : PLAY_ICON; }
    }

    window.showDataSourceSettings = function () {
        var modal = document.getElementById('dataSourceModal');
        if (!modal) return;
        $.getJSON('/api/data-source/settings', function (s) {
            document.getElementById('dsStorePath').value = s.storePath || '';
            _applyRunState(s.running);
        });
        modal.showModal();
    };

    window.dsClose = function () {
        var m = document.getElementById('dataSourceModal');
        if (m) m.close();
    };

    window.dsSave = function () {
        var data = { storePath: document.getElementById('dsStorePath').value.trim() };
        $.ajax({ url: '/api/data-source/settings', method: 'POST',
                 contentType: 'application/json', data: JSON.stringify(data) })
            .done(function () { dsClose(); })
            .fail(function (xhr) { showError((xhr.responseJSON && xhr.responseJSON.error) || 'Ошибка сохранения'); });
    };

    window.dsCheckPath = function () {
        var val = document.getElementById('dsStorePath').value.trim();
        $.ajax({ url: '/api/data-source/check-path', method: 'POST',
                 contentType: 'application/json', data: JSON.stringify({ storePath: val }) })
            .done(function (r) {
                if (r.ok) showSuccess(r.message);
                else      showError(r.message);
            })
            .fail(function () { showError('Ошибка запроса'); });
    };

    window.dsToggleRun = function () {
        var sbBtn   = document.getElementById('dsRunButton');
        var running = sbBtn && sbBtn.classList.contains('ds-sb-running');
        var url     = running ? '/api/data-source/stop' : '/api/data-source/start';
        $.ajax({ url: url, method: 'POST' })
            .done(function (r) { _applyRunState(r.settings.running); })
            .fail(function (xhr) { showError((xhr.responseJSON && xhr.responseJSON.error) || 'Ошибка'); });
    };

    $(document).ready(function () {
        $.getJSON('/api/data-source/settings', function (s) { _applyRunState(s.running); });
    });

})();

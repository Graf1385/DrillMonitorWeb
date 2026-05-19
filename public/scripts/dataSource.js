(function () {
    'use strict';

    window.showDataSourceSettings = function () {
        var modal = document.getElementById('dataSourceModal');
        if (!modal) return;
        document.getElementById('dsCheckResult').textContent = '';
        document.getElementById('dsCheckResult').className = 'ds-check-result';
        $.getJSON('/api/data-source/settings', function (s) {
            document.getElementById('dsStorePath').value = s.storePath || '';
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
            .done(function () {
                dsClose();
            })
            .fail(function (xhr) { showError((xhr.responseJSON && xhr.responseJSON.error) || 'Ошибка сохранения'); });
    };

    window.dsCheckPath = function () {
        var el  = document.getElementById('dsCheckResult');
        var val = document.getElementById('dsStorePath').value.trim();
        el.textContent = 'Проверка...';
        el.className   = 'ds-check-result ds-checking';
        $.ajax({ url: '/api/data-source/check-path', method: 'POST',
                 contentType: 'application/json', data: JSON.stringify({ storePath: val }) })
            .done(function (r) {
                el.textContent = r.message;
                el.className   = 'ds-check-result ' + (r.ok ? 'ds-ok' : 'ds-fail');
            })
            .fail(function () {
                el.textContent = 'Ошибка запроса';
                el.className   = 'ds-check-result ds-fail';
            });
    };

})();

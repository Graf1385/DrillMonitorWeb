function _formatLogTimestamp(iso) {
    var d = new Date(iso);
    var pad = function(n) { return String(n).padStart(2, '0'); };
    var time = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    var date = pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
    return '[' + time + ' ' + date + ']';
}

function _escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ── Состояние подсистем (самодиагностика, GET /api/health) ───────────────────
// К табло на буровой не подойти, поэтому первое, что должен увидеть открывший
// логи, — что именно сейчас неисправно и что система починила сама.

var _DIAG_LEVELS = { ok: 'норма', warn: 'внимание', fail: 'неисправность', off: 'не используется' };

function _diagDuration(sec) {
    if (!sec || sec < 60) return (sec || 0) + ' с';
    if (sec < 3600)       return Math.round(sec / 60) + ' мин';
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h + ' ч' + (m ? ' ' + m + ' мин' : '');
}

function _renderDiag(h) {
    var body = document.querySelector('#diagBody');
    if (!body) return;
    if (!h || !h.checks) { body.innerHTML = ''; return; }

    var rows = h.checks.map(function (c) {
        return '<div class="diagRow">' +
            '<span class="diagDot ' + c.level + '"></span>' +
            '<span class="diagTitle">' + _escapeHtml(c.title) + '</span>' +
            '<span class="diagDetail">' + _escapeHtml(c.detail || _DIAG_LEVELS[c.level] || '') + '</span>' +
            '</div>';
    }).join('');

    var fixed = (h.recoveries || []).slice(0, 3).map(function (r) {
        return '<div class="diagFixed">' + _formatLogTimestamp(r.at) + ' ' + _escapeHtml(r.what) +
               (r.ok ? '' : ' — не удалось') + '</div>';
    }).join('');

    body.innerHTML =
        '<div class="diagHead ' + (h.level || 'ok') + '">Состояние: ' +
            (_DIAG_LEVELS[h.level] || '—') +
            '<span class="diagUptime">в работе ' + _diagDuration(h.uptimeSec) +
            (h.version ? ', версия ' + _escapeHtml(h.version) : '') + '</span>' +
        '</div>' + rows +
        (fixed ? '<div class="diagFixedHead">Исправлено самостоятельно</div>' + fixed : '');
}

function showLogs() {
    $.getJSON('/api/health', _renderDiag).fail(function () { _renderDiag(null); });
    $.getJSON('/api/logs', function (logs) {
        var body = document.querySelector('#logBody');
        if (!logs.length) {
            body.innerHTML = '<p class="alarmOverviewEmpty">Логов нет</p>';
        } else {
            body.innerHTML = logs.map(function (l) {
                return '<div class="logEntry">' +
                    '<span class="logTimestamp">' + _formatLogTimestamp(l.timestamp) + '</span>' +
                    ' — ' +
                    '<span class="logMessage">' + _escapeHtml(l.message) + '</span>' +
                    '</div>';
            }).join('');
        }
        document.querySelector('#logModal').showModal();
    }).fail(function () { showError('Ошибка загрузки логов'); });
}

function clearLogs() {
    $.ajax({
        url: '/api/logs',
        method: 'DELETE',
        success: function () {
            document.querySelector('#logBody').innerHTML =
                '<p class="alarmOverviewEmpty">Логов нет</p>';
        },
        error: function (xhr) {
            if (xhr.status === 401) { if (typeof showLoginModal === 'function') showLoginModal(); return; }
            showError('Ошибка очистки логов');
        }
    });
}

function exportLogs() {
    window.open('/api/logs/export', '_blank');
}

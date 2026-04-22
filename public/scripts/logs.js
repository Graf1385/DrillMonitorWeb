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

function showLogs() {
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
    });
}

function clearLogs() {
    $.ajax({
        url: '/api/logs',
        method: 'DELETE',
        success: function () {
            document.querySelector('#logBody').innerHTML =
                '<p class="alarmOverviewEmpty">Логов нет</p>';
        }
    });
}

function exportLogs() {
    window.open('/api/logs/export', '_blank');
}

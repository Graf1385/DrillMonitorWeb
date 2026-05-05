// Parameters and units management live in parametersManager.js (loaded after).

let sideBar = document.querySelector('#sideBar');
let logo    = document.querySelector('#sideBarLogo');
let rmBtn   = sideBar.querySelector('#removeButton');
let saveBtn = sideBar.querySelector('#saveButton');

function showRemoveBtn() {
    rmBtn.classList.add('visible');
}

function hideRemoveBtn() {
    rmBtn.classList.remove('visible');
}

function showSaveBtn() {
    saveBtn.classList.add('visible');
}

function hideSaveBtn() {
    saveBtn.classList.remove('visible');
}

function showIndicatorList() {
    var indicators = Array.from(document.querySelectorAll('#workSpace .indicator'));
    var body = document.querySelector('#indicatorListBody');
    if (indicators.length === 0) {
        body.innerHTML = '<p class="alarmOverviewEmpty">Нет индикаторов на рабочей области</p>';
        document.querySelector('#indicatorListModal').showModal();
        return;
    }
    (function() {
        var rows = indicators.map(function(ind, i) {
            var d = ind.dataset;
            var paramName = d.paramName || (d.paramId ? '#' + d.paramId : '—');
            var header = d.headerText || '';
            var format = d.format     || '';
            return '<tr>' +
                '<td class="il-id">'    + (d.paramId || '—') + '</td>' +
                '<td class="il-pname">' + paramName           + '</td>' +
                '<td>'                  + header              + '</td>' +
                '<td>'                  + format              + '</td>' +
                '<td class="il-del"><button class="il-delBtn" onclick="deleteIndicatorFromList(' + i + ')">Удалить</button></td>' +
            '</tr>';
        });
        body.innerHTML = '<table class="settingsTable il-table">' +
            '<colgroup><col style="width:50px"><col><col><col style="width:110px"><col style="width:90px"></colgroup>' +
            '<thead><tr><th>ID</th><th>Параметр</th><th>Заголовок</th><th>Формат</th><th></th></tr></thead>' +
            '<tbody>' + rows.join('') + '</tbody></table>';
        var tbody = body.querySelector('tbody');
        tbody.addEventListener('click', function(e) {
            var row = e.target.closest('tr');
            if (!row) return;
            var wasSelected = row.classList.contains('il-selected');
            body.querySelectorAll('tr.il-selected').forEach(function(r) { r.classList.remove('il-selected'); });
            if (!wasSelected) row.classList.add('il-selected');
        });
        tbody.addEventListener('contextmenu', function(e) {
            var row = e.target.closest('tr');
            if (!row) return;
            e.preventDefault();
            var idx = Array.from(tbody.querySelectorAll('tr')).indexOf(row);
            var indicator = indicators[idx];
            if (!indicator || !window.showIndicatorCtxMenu) return;
            row.classList.add('il-selected');
            body.querySelectorAll('tr.il-selected').forEach(function(r) {
                if (r !== row) r.classList.remove('il-selected');
            });
            window.showIndicatorCtxMenu(indicator, e.clientX, e.clientY);
        });
        tbody.addEventListener('dblclick', function(e) {
            var row = e.target.closest('tr');
            if (!row) return;
            var idx = Array.from(tbody.querySelectorAll('tr')).indexOf(row);
            var indicator = indicators[idx];
            if (!indicator || !window.openEditModal) return;
            window.openEditModal(indicator);
        });
        document.querySelector('#indicatorListModal').showModal();
    })();
}

window.deleteIndicatorFromList = function(index) {
    var indicators = Array.from(document.querySelectorAll('#workSpace .indicator'));
    if (indicators[index]) {
        indicators[index].remove();
        showSaveBtn();
        showIndicatorList();
    }
};

// ── Parameters modal ──────────────────────────────────────────────────────────
// Delegates to window.parametersManager (defined in parametersManager.js).

function showParameters() {
    window.parametersManager.show();
}

// ── Alarm overview ────────────────────────────────────────────────────────────

function switchAlarmTab(tab) {
    document.querySelector('#alarmTabBtnActive').classList.toggle('pmTabActive',  tab === 'active');
    document.querySelector('#alarmTabBtnHistory').classList.toggle('pmTabActive', tab === 'history');
    document.querySelector('#alarmPanelActive').style.display  = tab === 'active'  ? '' : 'none';
    document.querySelector('#alarmPanelHistory').style.display = tab === 'history' ? '' : 'none';
}

function showAlarmSettings() {
    var indicators = Array.from(document.querySelectorAll('#workSpace .indicator'))
        .filter(function(ind) { return ind.dataset.alarmEnabled === '1'; });
    var list = document.querySelector('#alarmOverviewList');

    if (indicators.length === 0) {
        list.innerHTML = '<p class="alarmOverviewEmpty">Нет индикаторов с включённой сигнализацией</p>';
    } else {
        var rows = indicators.map(function(ind) {
            var d      = ind.dataset;
            var name   = d.headerText || 'Индикатор';
            var minVal = d.alarmMin !== '' && d.alarmMin !== undefined ? d.alarmMin : '—';
            var maxVal = d.alarmMax !== '' && d.alarmMax !== undefined ? d.alarmMax : '—';
            var color  = d.alarmColor || '#ff0000';
            var status, statusColor;
            if (ind._alarmActive) {
                if (ind._alarmAcked) { status = '⚠ Квитирован'; statusColor = '#d29922'; }
                else                 { status = '⚡ Тревога';    statusColor = '#f85149'; }
            } else {
                status = '✓ Норма'; statusColor = '#3fb950';
            }
            return '<tr>' +
                '<td class="aol-name">'  + name   + '</td>' +
                '<td class="aol-range">' + minVal + '</td>' +
                '<td class="aol-range">' + maxVal + '</td>' +
                '<td class="aol-color"><span class="aol-colorDot" style="background:' + color + '"></span></td>' +
                '<td class="aol-status" style="color:' + statusColor + ';white-space:nowrap">' + status + '</td>' +
            '</tr>';
        });
        list.innerHTML = '<table class="settingsTable aol-table">' +
            '<colgroup><col><col style="width:50px"><col style="width:50px"><col style="width:40px"><col style="width:100px"></colgroup>' +
            '<thead><tr><th>Параметр</th><th>Мин</th><th>Макс</th><th>Цвет</th><th>Статус</th></tr></thead>' +
            '<tbody>' + rows.join('') + '</tbody></table>';
    }

    var logEl = document.querySelector('#alarmLogList');
    var log   = window.getAlarmLog ? window.getAlarmLog() : [];
    if (log.length === 0) {
        logEl.innerHTML = '<p class="alarmOverviewEmpty">История пуста</p>';
    } else {
        var pad = function(n) { return String(n).padStart(2, '0'); };
        logEl.innerHTML = log.map(function(entry) {
            var d  = entry.ts;
            var ts = '[' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' +
                     pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ']';
            var eventStr, eventColor;
            if (entry.event === 'trigger') { eventStr = '⚡ Тревога';  eventColor = '#f85149'; }
            else if (entry.event === 'clear') { eventStr = '✓ Сброс'; eventColor = '#3fb950'; }
            else                           { eventStr = '⚠ Квит.';    eventColor = '#d29922'; }
            var valStr = typeof entry.value === 'number' ? entry.value.toFixed(2) : String(entry.value);
            return '<div class="logEntry">' +
                '<span class="logTimestamp">' + ts + '</span>' +
                ' <span style="color:' + entry.color + '">■</span> ' +
                '<span style="color:' + eventColor + '">' + eventStr + '</span>' +
                ' — <span class="logMessage">' + entry.name + ' = ' + valStr + '</span>' +
                '</div>';
        }).join('');
    }

    switchAlarmTab('active');
    document.querySelector('#alarmOverviewModal').showModal();
}

// ── Authentication ────────────────────────────────────────────────────────────

var _AUTH_KEY = 'drillmonitor_auth';
var _AUTH_TTL = 24 * 60 * 60 * 1000;

function _isAuthenticated() {
    var raw = localStorage.getItem(_AUTH_KEY);
    if (!raw) return false;
    try {
        var ts = JSON.parse(raw).ts;
        return Date.now() - ts < _AUTH_TTL;
    } catch { return false; }
}

function _setAuthenticated() {
    localStorage.setItem(_AUTH_KEY, JSON.stringify({ ts: Date.now() }));
}

function submitLogin() {
    var name     = document.querySelector('#login_name').value.trim();
    var password = document.querySelector('#login_password').value;
    $.ajax({
        url: '/api/auth/login',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ name, password }),
        success: function() {
            _setAuthenticated();
            document.querySelector('#loginModal').close();
            document.querySelector('#login_password').value = '';
            sideBar.classList.add('open');
            _restartCollapseTimer();
        },
        error: function() {
            showError('Неверный логин или пароль');
        }
    });
}

// ── Sidebar auto-collapse ─────────────────────────────────────────────────────

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

// ── Logo click ────────────────────────────────────────────────────────────────

logo.addEventListener('click', function() {
    if (sideBar.classList.contains('open')) {
        sideBar.classList.remove('open');
        clearTimeout(_collapseTimer);
        return;
    }
    if (!_isAuthenticated()) {
        document.querySelector('#login_password').value = '';
        document.querySelector('#loginModal').showModal();
    } else {
        sideBar.classList.add('open');
        _restartCollapseTimer();
    }
});

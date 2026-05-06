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

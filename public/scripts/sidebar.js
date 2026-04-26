var _networkSettings = document.querySelector('#networkSettings');

let sideBar = document.querySelector('#sideBar');
let logo = document.querySelector('#sideBarLogo');
let rmBtn = sideBar.querySelector('#removeButton');
let saveBtn = sideBar.querySelector('#saveButton');

function showNetworkSettings(){    

    _networkSettings.showModal();
}

function showRemoveBtn(){    
    rmBtn.classList.add('visible');
}

function hideRemoveBtn(){
    rmBtn.classList.remove('visible');
}

function showSaveBtn(){    
    saveBtn.classList.add('visible');
}

function hideSaveBtn(){
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
    $.getJSON('/api/parameters', function(params) {
        var paramMap = {};
        params.forEach(function(p) { paramMap[p.id] = p.name; });
        var rows = indicators.map(function(ind, i) {
            var d = ind.dataset;
            var paramName = d.paramId ? (paramMap[d.paramId] || '—') : '—';
            var header = (d.headerText || '').replace(/"/g, '&quot;');
            var format = (d.format     || '').replace(/"/g, '&quot;');
            return '<tr>' +
                '<td class="il-id">'    + (d.paramId || '—') + '</td>' +
                '<td class="il-pname">' + paramName           + '</td>' +
                '<td class="il-input"><input class="settingsInput il-headerInput" value="' + header + '" oninput="updateIndicatorField(' + i + ',\'headerText\',this.value)"></td>' +
                '<td class="il-input"><input class="settingsInput il-formatInput" value="' + format + '" oninput="updateIndicatorField(' + i + ',\'format\',this.value)"></td>' +
                '<td class="il-del"><button class="il-delBtn" onclick="deleteIndicatorFromList(' + i + ')">Удалить</button></td>' +
            '</tr>';
        });
        body.innerHTML = '<table class="settingsTable il-table">' +
            '<colgroup><col style="width:50px"><col><col><col style="width:110px"><col style="width:90px"></colgroup>' +
            '<thead><tr><th>ID</th><th>Параметр</th><th>Заголовок</th><th>Формат</th><th></th></tr></thead>' +
            '<tbody>' + rows.join('') + '</tbody></table>';
        document.querySelector('#indicatorListModal').showModal();
    });
}

window.updateIndicatorField = function(index, field, value) {
    var indicators = Array.from(document.querySelectorAll('#workSpace .indicator'));
    var ind = indicators[index];
    if (!ind) return;
    ind.dataset[field] = value;
    if (field === 'headerText') {
        var headerEl = ind.querySelector('.indicatorHeader');
        if (headerEl) headerEl.textContent = value;
    }
    showSaveBtn();
};

window.deleteIndicatorFromList = function(index) {
    var indicators = Array.from(document.querySelectorAll('#workSpace .indicator'));
    if (indicators[index]) {
        indicators[index].remove();
        showSaveBtn();
        showIndicatorList();
    }
};

var _paramTypes = [];
var _paramUnits = [];

function showParameters() {
    switchParamTab('params');
    $.when(
        $.getJSON('/api/parameters'),
        $.getJSON('/api/data-types'),
        $.getJSON('/api/units')
    ).then(function(paramsResp, typesResp, unitsResp) {
        _paramTypes = typesResp[0];
        _paramUnits = unitsResp[0];
        _renderParametersTable(paramsResp[0]);
        _renderUnitsTable(unitsResp[0]);
        document.querySelector('#parametersModal').showModal();
    });
}

window.switchParamTab = function(tab) {
    var isParams = tab === 'params';
    document.querySelector('#pmTabBtnParams').classList.toggle('pmTabActive', isParams);
    document.querySelector('#pmTabBtnUnits').classList.toggle('pmTabActive', !isParams);
    document.querySelector('#pmPanelParams').style.display = isParams ? '' : 'none';
    document.querySelector('#pmPanelUnits').style.display  = isParams ? 'none' : '';
};

function _isUnitsTabActive() {
    return document.querySelector('#pmTabBtnUnits').classList.contains('pmTabActive');
}

window.pmAddRow = function() {
    if (_isUnitsTabActive()) addUnitRow(); else addParameterRow();
};

window.pmExport = function() {
    if (_isUnitsTabActive()) exportUnits(); else exportParameters();
};

window.pmImport = function() {
    if (_isUnitsTabActive()) document.querySelector('#unitsImportFile').click();
    else document.querySelector('#paramImportFile').click();
};

function _unitsOptions(selectedId) {
    return '<option value="">— нет —</option>' +
        _paramUnits.map(function(u) {
            return '<option value="' + u.id + '"' + (selectedId === u.id ? ' selected' : '') + '>' +
                u.symbol + ' — ' + u.name + '</option>';
        }).join('');
}

function _renderParametersTable(params) {
    var rows = params.map(function(p) {
        var typeOpts = _paramTypes.map(function(t) {
            return '<option value="' + t.id + '"' + (p.type_id === t.id ? ' selected' : '') + '>' + t.name + '</option>';
        }).join('');
        return '<tr data-param-id="' + p.id + '">' +
            '<td class="il-id">' + p.id + '</td>' +
            '<td class="il-input"><input class="settingsInput pm-nameInput" value="' + p.name.replace(/"/g, '&quot;') + '" onchange="updateParam(' + p.id + ')"></td>' +
            '<td class="il-input"><select class="settingsSelect pm-typeSelect" onchange="updateParam(' + p.id + ')">' + typeOpts + '</select></td>' +
            '<td class="il-input"><select class="settingsSelect pm-unitSelect" onchange="updateParam(' + p.id + ')">' + _unitsOptions(p.unit_id) + '</select></td>' +
            '<td class="il-del"><button class="il-delBtn" onclick="deleteParam(' + p.id + ')">Удалить</button></td>' +
        '</tr>';
    });

    document.querySelector('#parametersBody').innerHTML =
        '<table class="settingsTable il-table">' +
        '<colgroup><col style="width:50px"><col><col style="width:110px"><col style="width:140px"><col style="width:90px"></colgroup>' +
        '<thead><tr><th>ID</th><th>Название</th><th>Тип</th><th>Ед. изм.</th><th></th></tr></thead>' +
        '<tbody id="parametersTableBody">' + rows.join('') + '</tbody></table>';
    initCombos(document.querySelector('#parametersTableBody'));
}

window.updateParam = function(id) {
    var row = document.querySelector('[data-param-id="' + id + '"]');
    if (!row) return;
    var name   = row.querySelector('.pm-nameInput').value.trim();
    if (!name) { showError('Название не может быть пустым'); return; }
    var typeId = parseInt(row.querySelector('.pm-typeSelect').value);
    var unitId = row.querySelector('.pm-unitSelect').value || null;
    $.ajax({
        url: '/api/parameters/' + id,
        method: 'PUT',
        contentType: 'application/json',
        data: JSON.stringify({ name: name, typeId: typeId, unitId: unitId }),
        error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка сохранения'); }
    });
};

window.deleteParam = function(id) {
    if (!confirm('Удалить параметр #' + id + '?')) return;
    $.ajax({
        url: '/api/parameters/' + id,
        method: 'DELETE',
        success: function() {
            var row = document.querySelector('[data-param-id="' + id + '"]');
            if (row) row.remove();
        },
        error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка удаления'); }
    });
};

window.addParameterRow = function() {
    var typeOptions = _paramTypes.map(function(t) {
        return '<option value="' + t.id + '">' + t.name + '</option>';
    }).join('');
    var tbody = document.querySelector('#parametersTableBody');
    if (!tbody) return;
    var tr = document.createElement('tr');
    tr.className = 'pm-newRow';
    tr.innerHTML =
        '<td class="il-input"><input type="number" class="settingsInput pm-newId" placeholder="ID" min="0" style="width:54px"></td>' +
        '<td class="il-input"><input class="settingsInput pm-newName" placeholder="Название"></td>' +
        '<td class="il-input"><select class="settingsSelect pm-newType">' + typeOptions + '</select></td>' +
        '<td class="il-input"><select class="settingsSelect pm-newUnit">' + _unitsOptions(null) + '</select></td>' +
        '<td class="il-del"><button class="il-delBtn" onclick="saveNewParam(this)">Сохранить</button></td>';
    tbody.appendChild(tr);
    initCombos(tr);
    tr.querySelector('.pm-newId').focus();
};

window.exportParameters = function() {
    $.getJSON('/api/parameters', function(params) {
        var data = params.map(function(p) {
            return { id: p.id, name: p.name, typeId: p.type_id, unitId: p.unit_id || null, units: p.units || '' };
        });
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'parameters.json';
        a.click();
        URL.revokeObjectURL(url);
    });
};

window.importParametersFile = function(input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var data = JSON.parse(e.target.result);
            if (!Array.isArray(data)) throw new Error('Ожидается массив');
            $.ajax({
                url: '/api/parameters/import',
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ parameters: data }),
                success: function() {
                    $.getJSON('/api/parameters', function(params) { _renderParametersTable(params); });
                },
                error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка импорта'); }
            });
        } catch (err) {
            showError('Неверный формат JSON: ' + err.message);
        }
        input.value = '';
    };
    reader.readAsText(file);
};

window.exportUnits = function() {
    $.getJSON('/api/units', function(units) {
        var blob = new Blob([JSON.stringify(units, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'units.json';
        a.click();
        URL.revokeObjectURL(url);
    });
};

window.importUnitsFile = function(input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var data = JSON.parse(e.target.result);
            if (!Array.isArray(data)) throw new Error('Ожидается массив');
            $.ajax({
                url: '/api/units/import',
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ units: data }),
                success: function() { _reloadUnits(); },
                error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка импорта'); }
            });
        } catch (err) {
            showError('Неверный формат JSON: ' + err.message);
        }
        input.value = '';
    };
    reader.readAsText(file);
};

window.saveNewParam = function(btn) {
    var row    = btn.closest('tr');
    var idVal  = row.querySelector('.pm-newId').value;
    var name   = row.querySelector('.pm-newName').value.trim();
    var typeId = parseInt(row.querySelector('.pm-newType').value);
    var unitId = row.querySelector('.pm-newUnit').value || null;
    if (idVal === '' || isNaN(parseInt(idVal))) { showError('Введите ID параметра'); return; }
    if (!name) { showError('Введите название параметра'); return; }
    $.ajax({
        url: '/api/parameters',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ id: parseInt(idVal), name: name, typeId: typeId, unitId: unitId }),
        success: function() {
            $.getJSON('/api/parameters', function(params) { _renderParametersTable(params); });
        },
        error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка добавления'); }
    });
};

// ── Units management ──────────────────────────────────────────────────────────

window.showUnitsModal = function() {
    switchParamTab('units');
};

function _renderUnitsTable(units) {
    var rows = units.map(function(u) {
        return '<tr data-unit-id="' + u.id + '">' +
            '<td class="il-id">' + u.id + '</td>' +
            '<td class="il-input"><input class="settingsInput um-nameInput" value="' + u.name.replace(/"/g, '&quot;') + '" onchange="updateUnit(' + u.id + ')"></td>' +
            '<td class="il-input"><input class="settingsInput um-symbolInput" value="' + u.symbol.replace(/"/g, '&quot;') + '" onchange="updateUnit(' + u.id + ')" style="width:90px"></td>' +
            '<td class="il-del"><button class="il-delBtn" onclick="deleteUnit(' + u.id + ')">Удалить</button></td>' +
        '</tr>';
    }).join('');
    document.querySelector('#unitsBody').innerHTML =
        '<table class="settingsTable il-table">' +
        '<colgroup><col style="width:40px"><col><col style="width:110px"><col style="width:90px"></colgroup>' +
        '<thead><tr><th>ID</th><th>Название</th><th>Символ</th><th></th></tr></thead>' +
        '<tbody id="unitsTableBody">' + rows + '</tbody></table>';
}

window.updateUnit = function(id) {
    var row = document.querySelector('[data-unit-id="' + id + '"]');
    if (!row) return;
    var name   = row.querySelector('.um-nameInput').value.trim();
    var symbol = row.querySelector('.um-symbolInput').value.trim();
    if (!name)   { showError('Название не может быть пустым'); return; }
    if (!symbol) { showError('Символ не может быть пустым'); return; }
    $.ajax({
        url: '/api/units/' + id,
        method: 'PUT',
        contentType: 'application/json',
        data: JSON.stringify({ name: name, symbol: symbol }),
        error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка сохранения'); }
    });
};

function addUnitRow() {
    var tbody = document.querySelector('#unitsTableBody');
    if (!tbody) return;
    var tr = document.createElement('tr');
    tr.className = 'pm-newRow';
    tr.innerHTML =
        '<td class="il-id">—</td>' +
        '<td class="il-input"><input class="settingsInput um-newName" placeholder="Название"></td>' +
        '<td class="il-input"><input class="settingsInput um-newSymbol" placeholder="Символ" style="width:90px"></td>' +
        '<td class="il-del"><button class="il-delBtn" onclick="saveNewUnit(this)">Сохранить</button></td>';
    tbody.appendChild(tr);
    tr.querySelector('.um-newName').focus();
}

function _reloadUnits(cb) {
    $.getJSON('/api/units', function(units) {
        _paramUnits = units;
        _renderUnitsTable(units);
        if (cb) cb();
    });
}

window.deleteUnit = function(id) {
    if (!confirm('Удалить единицу #' + id + '?')) return;
    $.ajax({
        url: '/api/units/' + id,
        method: 'DELETE',
        success: function() { _reloadUnits(); },
        error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка удаления'); }
    });
};

window.saveNewUnit = function(btn) {
    var row    = btn.closest('tr');
    var name   = row.querySelector('.um-newName').value.trim();
    var symbol = row.querySelector('.um-newSymbol').value.trim();
    if (!name)   { showError('Введите название'); return; }
    if (!symbol) { showError('Введите символ'); return; }
    $.ajax({
        url: '/api/units',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ name: name, symbol: symbol }),
        success: function() { _reloadUnits(); },
        error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка добавления'); }
    });
};

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
            if (entry.event === 'trigger') { eventStr = '⚡ Тревога';    eventColor = '#f85149'; }
            else if (entry.event === 'clear') { eventStr = '✓ Сброс';  eventColor = '#3fb950'; }
            else                           { eventStr = '⚠ Квит.';     eventColor = '#d29922'; }
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
        },
        error: function() {
            showError('Неверный логин или пароль');
        }
    });
}

logo.addEventListener('click', function() {
    if (sideBar.classList.contains('open')) {
        sideBar.classList.remove('open');
        return;
    }
    if (!_isAuthenticated()) {
        document.querySelector('#login_password').value = '';
        document.querySelector('#loginModal').showModal();
    } else {
        sideBar.classList.add('open');
    }
});
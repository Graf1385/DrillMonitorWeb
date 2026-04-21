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

function showAlarmSettings() {
    var indicators = Array.from(document.querySelectorAll('#workSpace .indicator'))
        .filter(function(ind) { return ind.dataset.alarmEnabled === '1'; });
    var list = document.querySelector('#alarmOverviewList');
    if (indicators.length === 0) {
        list.innerHTML = '<p class="alarmOverviewEmpty">Нет индикаторов с включённой сигнализацией</p>';
    } else {
        var rows = indicators.map(function(ind) {
            var d = ind.dataset;
            var name   = d.headerText || 'Индикатор';
            var minVal = d.alarmMin !== '' && d.alarmMin !== undefined ? d.alarmMin : '—';
            var maxVal = d.alarmMax !== '' && d.alarmMax !== undefined ? d.alarmMax : '—';
            var color  = d.alarmColor || '#ff0000';
            return '<tr>' +
                '<td class="aol-name">' + name + '</td>' +
                '<td class="aol-range">' + minVal + '</td>' +
                '<td class="aol-range">' + maxVal + '</td>' +
                '<td class="aol-color"><span class="aol-colorDot" style="background:' + color + '"></span></td>' +
            '</tr>';
        });
        list.innerHTML = '<table class="settingsTable aol-table">' +
            '<colgroup><col><col style="width:50px"><col style="width:50px"><col style="width:50px"></colgroup>' +
            '<thead><tr>' +
            '<th>Параметр</th><th>Мин</th><th>Макс</th><th>Цвет</th>' +
            '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
    }
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
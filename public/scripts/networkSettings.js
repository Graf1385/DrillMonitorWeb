var _netOrigAddress = '';
var _netOrigMode = '';

function showNetworkSettings() {
    fetch('/api/network').then(function(r) {
        if (r.status === 401) { if (typeof showLoginModal === 'function') showLoginModal(); return null; }
        if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || r.status); });
        return r.json();
    }).then(function(d) {
        if (!d) return;

        document.getElementById('netMode').value = d.mode;
        document.getElementById('netAddress').value = d.address;
        var pfxSel = document.getElementById('netPrefix');
        for (var i = 0; i < pfxSel.options.length; i++) {
            if (pfxSel.options[i].value === String(d.prefix)) { pfxSel.selectedIndex = i; break; }
        }
        _netOrigAddress = d.address;
        _netOrigMode = d.mode;

        netModeChanged();
        loadSerialSettings();
        document.getElementById('networkSettingsModal').showModal();
    }).catch(function() {
        showError('Не удалось загрузить настройки');
    });
}

function netModeChanged() {
    var isStatic = document.getElementById('netMode').value === 'static';
    ['address', 'prefix'].forEach(function(f) {
        document.getElementById('netRow_' + f).style.display = isStatic ? '' : 'none';
    });
}

function applyNetworkSettings() {
    var mode    = document.getElementById('netMode').value;
    var address = document.getElementById('netAddress').value.trim();
    var prefix  = document.getElementById('netPrefix').value;

    if ((mode === 'static' && address !== _netOrigAddress) || mode !== _netOrigMode) {
        if (!confirm('Сетевые настройки изменятся, устройство перезагрузится, ' +
                     'текущее соединение будет разорвано. Продолжить?')) return;
    }

    closeNetworkSettings();
    showLoader();

    var body = { mode: mode };
    if (mode === 'static') {
        body.address = address;
        body.prefix  = prefix;
    }
    fetch('/api/network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }).then(function(r) {
        if (r.status === 401) { hideLoader(); if (typeof showLoginModal === 'function') showLoginModal(); return null; }
        if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || r.status); });
        return r.json();
    }).then(function(d) {
        if (!d) return;
        document.querySelector('#loaderOverlay .loader-text').textContent = 'Перезагрузка...';
        showSuccess('Настройки применены. Устройство перезагружается...');
    }).catch(function(e) {
        hideLoader();
        showError('Ошибка: ' + e.message);
    });
}

function closeNetworkSettings() {
    document.getElementById('networkSettingsModal').close();
}

// ── Приём по RS-485 ──────────────────────────────────────────────────────────

function _serialStatusText(s) {
    if (!s.enabled) return 'выключен';
    if (!s.open)    return 'порт не открыт' + (s.error ? ' — ' + s.error : '');
    var t = 'порт открыт, принято кадров: ' + s.framesOk + (s.framesBad ? ', ошибок: ' + s.framesBad : '');
    if (s.lastFrameAt) {
        var ago = Math.round((Date.now() - s.lastFrameAt) / 1000);
        t += ', последний ' + (ago < 60 ? ago + ' с назад' : Math.round(ago / 60) + ' мин назад');
    } else {
        t += ', данных ещё не было';
    }
    return t;
}

function _fillSelect(sel, values, current, labelFn) {
    sel.innerHTML = '';
    var list = values.slice();
    if (current && list.indexOf(current) === -1) list.unshift(current);
    list.forEach(function (v) {
        var o = document.createElement('option');
        o.value = String(v);
        o.textContent = labelFn ? labelFn(v) : String(v);
        sel.appendChild(o);
    });
    if (current != null) sel.value = String(current);
}

function loadSerialSettings() {
    fetch('/api/serial').then(function (r) { return r.ok ? r.json() : null; }).then(function (s) {
        if (!s) return;
        document.getElementById('serEnabled').value = s.enabled ? '1' : '0';
        _fillSelect(document.getElementById('serPort'), s.ports || [], s.port, function (p) {
            return (s.ports || []).indexOf(p) === -1 ? p + ' (не подключён)' : p;
        });
        _fillSelect(document.getElementById('serBaud'), s.bauds || [115200], s.baud);
        document.getElementById('serStatus').textContent = _serialStatusText(s);
    }).catch(function () {
        document.getElementById('serStatus').textContent = 'нет данных о состоянии';
    });
}

function applySerialSettings() {
    var body = {
        enabled: document.getElementById('serEnabled').value === '1',
        port:    document.getElementById('serPort').value,
        baud:    parseInt(document.getElementById('serBaud').value, 10)
    };
    fetch('/api/serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }).then(function (r) {
        if (r.status === 401) { if (typeof showLoginModal === 'function') showLoginModal(); return null; }
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || r.status); });
        return r.json();
    }).then(function (d) {
        if (!d) return;
        showSuccess(body.enabled ? 'Приём по RS-485: ' + body.port + ', ' + body.baud + ' бод' : 'Приём по RS-485 выключен');
        setTimeout(loadSerialSettings, 1200);
    }).catch(function (e) {
        showError('Ошибка RS-485: ' + e.message);
    });
}

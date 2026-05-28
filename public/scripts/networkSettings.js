var _netOrigAddress = '';
var _netOrigMode = '';

function showNetworkSettings() {
    var loadNet = fetch('/api/network').then(function(r) {
        if (r.status === 401) { if (typeof showLoginModal === 'function') showLoginModal(); return null; }
        return r.json();
    });
    var loadDs = fetch('/api/data-source/settings').then(function(r) {
        return r.ok ? r.json() : {};
    }).catch(function() { return {}; });

    var loadPush = fetch('/api/push/settings').then(function(r) {
        return r.ok ? r.json() : {};
    }).catch(function() { return {}; });

    Promise.all([loadNet, loadDs, loadPush]).then(function(results) {
        var d = results[0];
        var s = results[1];
        var p = results[2];
        if (!d) return;

        document.getElementById('pushApiKey').value = (p && p.apiKey) ? p.apiKey : '';

        document.getElementById('netMode').value = d.mode;
        document.getElementById('netAddress').value = d.address;
        var pfxSel = document.getElementById('netPrefix');
        for (var i = 0; i < pfxSel.options.length; i++) {
            if (pfxSel.options[i].value === String(d.prefix)) { pfxSel.selectedIndex = i; break; }
        }
        document.getElementById('netGateway').value = d.gateway;
        document.getElementById('netDns').value = d.dns;
        _netOrigAddress = d.address;
        _netOrigMode = d.mode;

        document.getElementById('dsStorePath').value = s.storePath || '';

        netModeChanged();
        document.getElementById('networkSettingsModal').showModal();
    }).catch(function() {
        showError('Не удалось загрузить настройки');
    });
}

function netModeChanged() {
    var isStatic = document.getElementById('netMode').value === 'static';
    ['address', 'prefix', 'gateway', 'dns'].forEach(function(f) {
        document.getElementById('netRow_' + f).style.display = isStatic ? '' : 'none';
    });
}

function applyNetworkSettings() {
    var mode      = document.getElementById('netMode').value;
    var address   = document.getElementById('netAddress').value.trim();
    var prefix    = document.getElementById('netPrefix').value;
    var gateway   = document.getElementById('netGateway').value.trim();
    var dns       = document.getElementById('netDns').value.trim();
    var storePath = document.getElementById('dsStorePath').value.trim();

    if (mode === 'static' && address !== _netOrigAddress) {
        showError('Внимание: изменение IP-адреса разорвёт текущее соединение');
    }

    closeNetworkSettings();
    showLoader();

    fetch('/api/data-source/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storePath: storePath })
    }).then(function() {
        var body = { mode: mode };
        if (mode === 'static') {
            body.address = address;
            body.prefix  = prefix;
            body.gateway = gateway;
            body.dns     = dns || '8.8.8.8';
        }
        return fetch('/api/network', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
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

function dsCheckPath() {
    var val = document.getElementById('dsStorePath').value.trim();
    fetch('/api/data-source/check-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storePath: val })
    }).then(function(r) { return r.json(); })
    .then(function(r) {
        if (r.ok) {
            showSuccess(r.message || 'Путь найден');
        } else {
            showError(r.message || 'Путь не найден');
        }
    }).catch(function() {
        showError('Ошибка проверки пути');
    });
}

function closeNetworkSettings() {
    document.getElementById('networkSettingsModal').close();
}

function generateApiKey() {
    fetch('/api/push/settings/generate', { method: 'POST' })
        .then(function(r) {
            if (r.status === 401) { if (typeof showLoginModal === 'function') showLoginModal(); return null; }
            if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || r.status); });
            return r.json();
        })
        .then(function(d) {
            if (!d) return;
            document.getElementById('pushApiKey').value = d.apiKey;
            showSuccess('API-ключ сгенерирован');
        })
        .catch(function(e) { showError('Ошибка: ' + e.message); });
}

function copyApiKey() {
    var el  = document.getElementById('pushApiKey');
    var key = el ? el.value : '';
    if (!key) { showError('API-ключ не установлен'); return; }
    if (navigator.clipboard) {
        navigator.clipboard.writeText(key)
            .then(function()  { showSuccess('Ключ скопирован'); })
            .catch(function() { _fallbackCopy(key); });
    } else {
        _fallbackCopy(key);
    }
}

function _fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showSuccess('Ключ скопирован'); }
    catch (e) { showError('Не удалось скопировать'); }
    document.body.removeChild(ta);
}

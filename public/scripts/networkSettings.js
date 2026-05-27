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

    Promise.all([loadNet, loadDs]).then(function(results) {
        var d = results[0];
        var s = results[1];
        if (!d) return;

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

        document.getElementById('netStatus').textContent = '';
        document.getElementById('netWarning').style.display = 'none';
        netModeChanged();
        document.getElementById('networkSettingsModal').showModal();
    }).catch(function() {
        alert('Не удалось загрузить настройки');
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
        document.getElementById('netWarning').style.display = '';
    }

    var statusEl = document.getElementById('netStatus');
    var okBtn    = document.querySelector('#networkSettingsModal .okBtn');
    statusEl.textContent = 'Применяется...';
    okBtn.disabled = true;

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
        if (r.status === 401) { if (typeof showLoginModal === 'function') showLoginModal(); okBtn.disabled = false; return null; }
        if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || r.status); });
        return r.json();
    }).then(function(d) {
        if (!d) return;
        statusEl.textContent = 'Настройки применены';
        okBtn.disabled = false;
        setTimeout(function() { closeNetworkSettings(); }, 1500);
    }).catch(function(e) {
        statusEl.textContent = 'Ошибка: ' + e.message;
        okBtn.disabled = false;
    });
}

function dsCheckPath() {
    var val = document.getElementById('dsStorePath').value.trim();
    var statusEl = document.getElementById('netStatus');
    statusEl.textContent = 'Проверяется...';
    fetch('/api/data-source/check-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storePath: val })
    }).then(function(r) { return r.json(); })
    .then(function(r) {
        statusEl.textContent = r.message || (r.ok ? 'Путь найден' : 'Путь не найден');
    }).catch(function() {
        statusEl.textContent = 'Ошибка проверки пути';
    });
}

function closeNetworkSettings() {
    document.getElementById('networkSettingsModal').close();
}

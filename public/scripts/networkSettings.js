var _netOrigAddress = '';
var _netOrigMode = '';

function showNetworkSettings() {
    fetch('/api/network')
        .then(function(r) {
            if (r.status === 401) { if (typeof showLoginModal === 'function') showLoginModal(); return null; }
            return r.json();
        })
        .then(function(d) {
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
            document.getElementById('netStatus').textContent = '';
            document.getElementById('netWarning').style.display = 'none';
            netModeChanged();
            document.getElementById('networkSettingsModal').showModal();
        })
        .catch(function() {
            alert('Не удалось загрузить сетевые настройки');
        });
}

function netModeChanged() {
    var isStatic = document.getElementById('netMode').value === 'static';
    ['address', 'prefix', 'gateway', 'dns'].forEach(function(f) {
        document.getElementById('netRow_' + f).style.display = isStatic ? '' : 'none';
    });
}

function applyNetworkSettings() {
    var mode    = document.getElementById('netMode').value;
    var address = document.getElementById('netAddress').value.trim();
    var prefix  = document.getElementById('netPrefix').value;
    var gateway = document.getElementById('netGateway').value.trim();
    var dns     = document.getElementById('netDns').value.trim();

    if (mode === 'static' && address !== _netOrigAddress) {
        document.getElementById('netWarning').style.display = '';
    }

    var body = { mode: mode };
    if (mode === 'static') {
        body.address = address;
        body.prefix  = prefix;
        body.gateway = gateway;
        body.dns     = dns || '8.8.8.8';
    }

    var statusEl = document.getElementById('netStatus');
    var okBtn    = document.querySelector('#networkSettingsModal .okBtn');
    statusEl.textContent = 'Применяется...';
    okBtn.disabled = true;

    fetch('/api/network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
    .then(function(r) {
        if (r.status === 401) { if (typeof showLoginModal === 'function') showLoginModal(); okBtn.disabled = false; return null; }
        if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || r.status); });
        return r.json();
    })
    .then(function(d) {
        if (!d) return;
        statusEl.textContent = 'Настройки применены';
        okBtn.disabled = false;
        setTimeout(function() { closeNetworkSettings(); }, 1500);
    })
    .catch(function(e) {
        statusEl.textContent = 'Ошибка: ' + e.message;
        okBtn.disabled = false;
    });
}

function closeNetworkSettings() {
    document.getElementById('networkSettingsModal').close();
}

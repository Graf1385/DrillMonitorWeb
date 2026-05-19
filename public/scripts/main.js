document.addEventListener('contextmenu', function(e) { e.preventDefault(); });

// ── Error Toast ───────────────────────────────────────────────────────────────

(function () {
    var _toast   = document.getElementById('errorToast');
    var _timer   = null;

    function _hide() {
        _toast.classList.remove('visible');
        clearTimeout(_timer);
        document.removeEventListener('mousedown', _hide);
    }

    window.showError = function (msg) {
        if (_toast.parentNode !== document.body) document.body.appendChild(_toast);

        _toast.textContent = msg;
        _toast.classList.add('visible');
        clearTimeout(_timer);
        document.removeEventListener('mousedown', _hide);
        _timer = setTimeout(_hide, 5000);
        setTimeout(function () {
            document.addEventListener('mousedown', _hide);
        }, 0);
    };
})();

// ── Update checker ────────────────────────────────────────────────────────────

(function () {
    var _banner      = document.getElementById('updateBanner');
    var _bannerText  = document.getElementById('updateBannerText');
    var _bannerLink  = document.getElementById('updateBannerLink');
    var _bannerClose = document.getElementById('updateBannerClose');
    var _bannerApply = document.getElementById('updateBannerApply');
    var _badge       = document.getElementById('updateBadge');
    var _btn         = document.getElementById('updateCheckButton');
    var _dialog      = document.getElementById('updateConfirmDialog');
    var _confirmText = document.getElementById('updateConfirmText');
    var _confirmYes  = document.getElementById('updateConfirmYes');
    var _confirmNo   = document.getElementById('updateConfirmNo');
    var _overlay     = document.getElementById('updateProgressOverlay');
    var _overlayText = document.getElementById('updateProgressText');

    var _latestVersion = null;
    window._updateInProgress = false;

    function _showBanner(data) {
        _latestVersion = data.latest;
        _bannerText.textContent = 'Доступна версия ' + data.latest + '  (текущая ' + data.current + ')';
        if (_bannerLink) _bannerLink.href = data.releaseUrl || 'https://github.com/Graf1385/DrillMonitorWeb/releases';
        _banner.classList.add('visible');
    }

    function _pollUntilAlive() {
        _overlayText.textContent = 'Перезапуск сервера…';
        var attempts = 0;
        var timer = setInterval(function () {
            attempts++;
            $.ajax({ url: '/api/health', method: 'GET', timeout: 2000 })
                .done(function () {
                    clearInterval(timer);
                    window._updateInProgress = false;
                    _overlayText.textContent = 'Готово! Перезагрузка…';
                    setTimeout(function () { window.location.reload(); }, 800);
                })
                .fail(function () {
                    if (attempts > 90) {
                        clearInterval(timer);
                        window._updateInProgress = false;
                        _overlay.classList.remove('visible');
                        showError('Сервер не отвечает — обновите страницу вручную');
                    }
                });
        }, 1000);
    }

    function _applyUpdate() {
        _dialog.close();
        _banner.classList.remove('visible');
        window._updateInProgress = true;
        _overlayText.textContent = 'Устанавливается обновление…';
        _overlay.classList.add('visible');

        $.ajax({ url: '/api/update/apply', method: 'POST', timeout: 180000 })
            .done(function () {
                setTimeout(_pollUntilAlive, 2500);
            })
            .fail(function (xhr) {
                window._updateInProgress = false;
                _overlay.classList.remove('visible');
                var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Ошибка обновления';
                showError(msg);
            });
    }

    function _check(manual) {
        if (_btn) _btn.classList.add('checking');
        $.getJSON('/api/update/check')
            .done(function (data) {
                if (data.hasUpdate) {
                    if (_badge) _badge.classList.add('visible');
                    var dismissed = localStorage.getItem('updateDismissed');
                    if (manual || dismissed !== data.latest) _showBanner(data);
                } else {
                    if (_badge) _badge.classList.remove('visible');
                    _banner.classList.remove('visible');
                    if (manual) showError('Версия актуальна: ' + (data.current || '—'));
                }
            })
            .fail(function () {
                if (manual) showError('Не удалось проверить обновления');
            })
            .always(function () { if (_btn) _btn.classList.remove('checking'); });
    }

    if (_bannerApply) _bannerApply.addEventListener('click', function () {
        _confirmText.textContent = 'Обновить до версии ' + (_latestVersion || '?') + '? Сервер перезапустится автоматически.';
        _dialog.showModal();
    });

    if (_confirmYes) _confirmYes.addEventListener('click', _applyUpdate);
    if (_confirmNo)  _confirmNo.addEventListener('click', function () { _dialog.close(); });

    if (_bannerClose) _bannerClose.addEventListener('click', function () {
        if (_latestVersion) localStorage.setItem('updateDismissed', _latestVersion);
        _banner.classList.remove('visible');
    });

    if (_btn) _btn.addEventListener('click', function () { _check(true); });

    _check(false);
})();

function _restoreIndicators(indicators) {
    var ws  = document.querySelector('#wsCanvas');
    var wsW = (_wsWidth  > 0) ? _wsWidth  : ws.clientWidth;
    var wsH = (_wsHeight > 0) ? _wsHeight : ws.clientHeight;
    ws.querySelectorAll('.videoIndicator').forEach(function(el) { _stopVideoStream(el); });
    ws.querySelectorAll('.tickerIndicator').forEach(function(el) {
        if (el._tickerObserver) el._tickerObserver.disconnect();
    });
    ws.querySelectorAll('.indicator').forEach(function(el) { el.remove(); });
    indicators.forEach(function(ind) {
        var left = Math.round((ind.pos_left || 0) * wsW / 100);
        var top  = Math.round((ind.pos_top  || 0) * wsH / 100);
        var el;

        if (ind.type === 'videoIndicator') {
            var extra = {};
            try { extra = JSON.parse(ind.extra_data || '{}'); } catch (e) { console.warn('extra_data parse error', e); }
            el = _buildVideoElement({
                headerText:    ind.header_text  || 'Камера',
                headerColor:   ind.header_color || '#c9d1d9',
                headerBg:      ind.header_bg    || '#161b22',
                streamHost:    extra.streamHost    || '',
                streamPort:    extra.streamPort    || '554',
                streamUser:    extra.streamUser    || '',
                streamPass:    extra.streamPass    || '',
                streamChannel: extra.streamChannel || '1',
                streamSub:     extra.streamSub     || '0',
                width:  ind.width  != null ? Math.round(ind.width  * wsW / 100) : 320,
                height: ind.height != null ? Math.round(ind.height * wsH / 100) : 240
            });
            el.style.left = left + 'px';
            el.style.top  = top  + 'px';
            ws.appendChild(el);
            if (extra.streamHost) _startVideoStream(el);
        } else {
            var ahExtra = {};
            if (ind.type === 'alarmHistoryIndicator') {
                try { ahExtra = JSON.parse(ind.extra_data || '{}'); } catch (e) { console.warn('extra_data parse error', e); }
            }
            var config = {
                paramId:     ind.param_id,
                paramName:   ind.param_name || '',
                width:       ind.width  != null ? Math.round(ind.width  * wsW / 100) : null,
                height:      ind.height != null ? Math.round(ind.height * wsH / 100) : null,
                headerText:  ind.header_text,
                headerColor: ind.header_color,
                headerBg:    ind.header_bg,
                headerFont:  ind.header_font,
                headerSize:  ind.header_size,
                format:      ind.format,
                valueColor:  ind.value_color,
                valueBg:     ind.value_bg,
                valueFont:   ind.value_font,
                valueSize:   ind.value_size,
                rangeMin:    ind.range_min,
                rangeMax:    ind.range_max,
                alarmMin:    ind.alarm_min,
                alarmMax:    ind.alarm_max,
                alarmEnabled: ind.alarm_enabled ? true : false,
                alarmColor:   ind.alarm_color  || '#ff0000',
                units:          ind.units          || '',
                zoneColors:     ind.zone_colors    ? true : false,
                tickerSpeed:    ind.ticker_speed   != null ? ind.ticker_speed   : 12,
                valueBgOpacity: ind.value_bg_opacity != null ? ind.value_bg_opacity : 0,
                showTrigger: ahExtra.showTrigger !== false,
                showClear:   ahExtra.showClear   !== false,
                showAck:     ahExtra.showAck     !== false
            };
            el = _addIndicator(ind.type || 'digitalIndicator', config, left, top);
            ws.appendChild(el);
        }

        // Clamp position to visible canvas area (fixes cross-resolution overflow)
        var scale = window._wsScale  || 1;
        var ox    = window._wsOffsetX || 0;
        var oy    = window._wsOffsetY || 0;
        var iw    = el.offsetWidth;
        var ih    = el.offsetHeight;
        var minX  = Math.max(0, Math.ceil(-ox / scale));
        var minY  = Math.max(0, Math.ceil(-oy / scale));
        var maxX  = Math.min(ws.clientWidth  - iw, Math.floor((window.innerWidth  - ox) / scale) - iw);
        var maxY  = Math.min(ws.clientHeight - ih, Math.floor((window.innerHeight - oy) / scale) - ih);
        el.style.left = Math.min(Math.max(left, minX), maxX) + 'px';
        el.style.top  = Math.min(Math.max(top,  minY), maxY) + 'px';
    });
}

function _loadIndicatorsForProfile(profileId) {
    $.when(
        $.getJSON('/api/profiles/' + profileId + '/indicators'),
        _loadFonts()
    ).then(function(indicatorsResp) {
        _restoreIndicators(indicatorsResp[0]);
    });
}

// Apply active profile from DB on page load
$.getJSON('/api/profiles/active', function (profile) {
    if (!profile) return;
    _activeProfileId     = profile.id;
    _settings.background = profile.background;
    _settings.cellSize   = profile.cell_size;
    applyProfileFromSSE(profile);
    _loadIndicatorsForProfile(profile.id);
});

// Listen for profile activation from other clients
(function () {
    var evtSource = new EventSource('/api/events');

    evtSource.addEventListener('workspace-saved', function (e) {
        var profile = JSON.parse(e.data);
        applyProfileFromSSE(profile);
        _loadIndicatorsForProfile(profile.id);
    });

    evtSource.addEventListener('profile-selected', function (e) {
        var profile = JSON.parse(e.data);
        _settings.background = profile.background;
        _settings.cellSize   = profile.cell_size;
        applyProfileFromSSE(profile);
        _loadIndicatorsForProfile(profile.id);
        if (window.profileSwitcherSetActive) profileSwitcherSetActive(profile.id);
    });

    evtSource.onerror = function () {
        evtSource.close();
        if (!window._updateInProgress) {
            setTimeout(function () { window.location.reload(); }, 3000);
        }
    };
})();

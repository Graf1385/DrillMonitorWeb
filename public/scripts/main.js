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
        var openDialog = Array.from(document.querySelectorAll('dialog')).find(function(d) { return d.open; });
        var parent = openDialog || document.body;
        if (_toast.parentNode !== parent) parent.appendChild(_toast);

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

getSettings();

function _restoreIndicators(indicators) {
    var ws  = document.querySelector('#workSpace');
    var wsW = ws.clientWidth;
    var wsH = ws.clientHeight;
    ws.querySelectorAll('.videoIndicator').forEach(function(el) { _stopVideoStream(el); });
    ws.querySelectorAll('.indicator').forEach(function(el) { el.remove(); });
    indicators.forEach(function(ind) {
        var left = (ind.pos_left || 0) * wsW / 100;
        var top  = (ind.pos_top  || 0) * wsH / 100;

        if (ind.type === 'videoIndicator') {
            var extra = {};
            try { extra = JSON.parse(ind.extra_data || '{}'); } catch {}
            var el = _buildVideoElement({
                headerText:    ind.header_text  || 'Камера',
                headerColor:   ind.header_color || '#c9d1d9',
                headerBg:      ind.header_bg    || '#161b22',
                streamHost:    extra.streamHost    || '',
                streamPort:    extra.streamPort    || '554',
                streamUser:    extra.streamUser    || '',
                streamPass:    extra.streamPass    || '',
                streamChannel: extra.streamChannel || '1',
                streamSub:     extra.streamSub     || '0',
                width:  ind.width  != null ? ind.width  * wsW / 100 : 320,
                height: ind.height != null ? ind.height * wsH / 100 : 240
            });
            el.style.left = left + 'px';
            el.style.top  = top  + 'px';
            ws.appendChild(el);
            if (extra.streamHost) _startVideoStream(el);
            return;
        }

        var config = {
            paramId:     ind.param_id,
            width:       ind.width  != null ? ind.width  * wsW / 100 : null,
            height:      ind.height != null ? ind.height * wsH / 100 : null,
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
            valueBgOpacity: ind.value_bg_opacity != null ? ind.value_bg_opacity : 0
        };
        ws.appendChild(_addIndicator(ind.type || 'digitalIndicator', config, left, top));
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
        _settings.background = profile.background;
        _settings.cellSize   = profile.cell_size;
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
        setTimeout(function () { window.location.reload(); }, 3000);
    };
})();

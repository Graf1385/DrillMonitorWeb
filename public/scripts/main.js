document.addEventListener('contextmenu', function(e) { e.preventDefault(); });

getSettings();

function _restoreIndicators(indicators) {
    var ws = document.querySelector('#workSpace');
    ws.querySelectorAll('.indicator').forEach(function(el) { el.remove(); });
    indicators.forEach(function(ind) {
        var config = {
            paramId:     ind.param_id,
            width:       ind.width,
            height:      ind.height,
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
            alarmColor:  ind.alarm_color  || '#ff0000',
            alarmSound:  ind.alarm_sound  || '',
            alarmVolume: ind.alarm_volume !== null && ind.alarm_volume !== undefined ? ind.alarm_volume : 50,
            alarmDelay:  ind.alarm_delay  !== null && ind.alarm_delay  !== undefined ? ind.alarm_delay  : 2
        };
        var el = ind.type === 'timeIndicator'
            ? _createTimeIndicator(config, ind.pos_left, ind.pos_top)
            : ind.type === 'dateIndicator'
            ? _createDateIndicator(config, ind.pos_left, ind.pos_top)
            : _createDigitalIndicator(config, ind.pos_left, ind.pos_top);
        ws.appendChild(el);
    });
}

function _loadIndicatorsForProfile(profileId) {
    $.getJSON('/api/profiles/' + profileId + '/indicators', function(indicators) {
        _restoreIndicators(indicators);
    });
}

// Apply active profile from DB on page load
$.getJSON('/api/profiles/active', function (profile) {
    if (!profile) return;
    _activeProfileId     = profile.id;
    _settings.background = profile.background;
    _settings.cellSize   = profile.cell_size;
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
    });

    evtSource.onerror = function () {
        evtSource.close();
        setTimeout(function () { window.location.reload(); }, 3000);
    };
})();

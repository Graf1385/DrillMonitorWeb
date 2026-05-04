var _modal              = document.querySelector('#settings');
var _createProfileModal = document.querySelector('#createProfileModal');
var _deleteProfileModal = document.querySelector('#deleteProfileModal');
var _workSpace          = document.querySelector('#workSpace');
var _wsCanvas           = document.querySelector('#wsCanvas');

let _pendingDeleteId    = null;
let _activeProfileId    = null;
let _savedBackground    = null;
let _savedCellSize      = null;
let _alarmSoundId       = '';
let _alarmVolume        = 50;
let _alarmDelay         = 2;
let _wsWidth            = 0;
let _wsHeight           = 0;

let _settings = {
    ip:      '',
    mask:    '',
    gateway: '',
    dhcp:    false,

    get background() { return getComputedStyle(_workSpace).getPropertyValue('--workSpace-color').trim(); },
    set background(value) { _workSpace.style.setProperty('--workSpace-color', value); },

    get gridColor() { return getComputedStyle(_wsCanvas).getPropertyValue('--grid-color').trim(); },
    set gridColor(value) { _wsCanvas.style.setProperty('--grid-color', value); },

    get cellSize() { return parseInt(_wsCanvas.dataset['cellSize']) || 20; },
    set cellSize(value) {
        _wsCanvas.dataset['cellSize'] = value;
        if (_gridActive) {
            _wsCanvas.style.backgroundSize = value + 'px ' + value + 'px';
        }
    }
};

// ── Resolution ───────────────────────────────────────────────────────────────

function _applyResolution(w, h) {
    _wsWidth  = w || 0;
    _wsHeight = h || 0;
    window._wsWidth  = _wsWidth;
    window._wsHeight = _wsHeight;
    if (_wsWidth > 0 && _wsHeight > 0) {
        _wsCanvas.style.width  = _wsWidth  + 'px';
        _wsCanvas.style.height = _wsHeight + 'px';
    } else {
        _wsCanvas.style.width  = '';
        _wsCanvas.style.height = '';
        _wsCanvas.style.transform = '';
        window._wsScale   = 1;
        window._wsOffsetX = 0;
        window._wsOffsetY = 0;
    }
    _updateWsScale();
}

function _updateWsScale() {
    if (!(_wsWidth > 0 && _wsHeight > 0)) {
        window._wsScale   = 1;
        window._wsOffsetX = 0;
        window._wsOffsetY = 0;
        return;
    }
    var vw    = window.innerWidth;
    var vh    = window.innerHeight;
    var scale = Math.max(vw / _wsWidth, vh / _wsHeight);
    scale = Math.round(scale * 10000) / 10000;
    var ox = Math.round((vw - _wsWidth  * scale) / 2);
    var oy = Math.round((vh - _wsHeight * scale) / 2);
    _wsCanvas.style.transform = 'translate(' + ox + 'px,' + oy + 'px) scale(' + scale + ')';
    window._wsScale   = scale;
    window._wsOffsetX = ox;
    window._wsOffsetY = oy;
}

window.updateResolutionHint = function(select) {
    var hint = _modal.querySelector('#wsResolutionHint');
    if (!hint) return;
    var parts = (select.value || '0x0').split('x');
    var w = parseInt(parts[0]) || 0;
    var h = parseInt(parts[1]) || 0;
    if (!w || !h) { hint.textContent = ''; return; }
    var scaleX = Math.round(window.innerWidth  / w * 10) / 10;
    var scaleY = Math.round(window.innerHeight / h * 10) / 10;
    var scale  = Math.round(Math.max(scaleX, scaleY) * 10) / 10;
    hint.textContent = 'масштаб на этом экране: ×' + scale;
    hint.style.color = scale < 1 ? '#f85149' : scale > 1 ? '#3fb950' : '#d29922';
};

window.addEventListener('resize', _updateWsScale);

// ── Profiles ──────────────────────────────────────────────────────────────────

function _loadAlarmSounds(selectedId) {
    var select   = _modal.querySelector('#ws_alarmSound');
    var deferred = $.Deferred();
    $.getJSON('/api/alarm-sounds')
        .then(function (sounds) {
            select.innerHTML = '<option value="">— без звука —</option>';
            sounds.forEach(function (s) {
                var opt = document.createElement('option');
                opt.value       = s.id;
                opt.textContent = s.name;
                select.appendChild(opt);
            });
            select.value = selectedId || '';
            deferred.resolve();
        })
        .fail(function (err) {
            console.error('Ошибка загрузки звуков:', err);
            select.innerHTML = '<option value="">— без звука —</option>';
            deferred.resolve();
        });
    return deferred.promise();
}

function _loadProfiles() {
    var select   = _modal.querySelector('#wsProfile');
    var deferred = $.Deferred();
    $.getJSON('/api/profiles')
        .then(function (profiles) {
            var prevId = _activeProfileId || (select.value || null);
            select.innerHTML = '';
            profiles.forEach(function (p) {
                var opt = document.createElement('option');
                opt.value                = p.id;
                opt.textContent          = p.name;
                opt.dataset.background   = p.background;
                opt.dataset.cellSize     = p.cell_size;
                opt.dataset.isDefault    = p.is_default;
                opt.dataset.alarmSoundId = p.alarm_sound_id || '';
                opt.dataset.alarmVolume  = p.alarm_volume  !== null ? p.alarm_volume  : 50;
                opt.dataset.alarmDelay   = p.alarm_delay   !== null ? p.alarm_delay   : 2;
                opt.dataset.wsWidth      = p.ws_width  || 0;
                opt.dataset.wsHeight     = p.ws_height || 0;
                select.appendChild(opt);
            });
            if (prevId) select.value = prevId;
            _loadAlarmSounds().always(function () {
                try { applyProfile(select, true); } catch (e) { console.error('applyProfile error:', e); }
                deferred.resolve();
            });
        })
        .fail(function (err) {
            console.error('Ошибка загрузки профилей:', err);
            deferred.resolve();
        });
    return deferred.promise();
}

function applyProfile(selectEl, silent) {
    var opt = selectEl.options[selectEl.selectedIndex];
    if (!opt) return;

    _activeProfileId = parseInt(opt.value);
    _savedBackground = opt.dataset.background;
    _savedCellSize   = parseInt(opt.dataset.cellSize);

    _modal.querySelector('#workSpaceColor').value = _savedBackground;
    _modal.querySelector('#cellSize').value        = _savedCellSize;
    _modal.querySelector('#deleteProfileBtn').disabled = opt.dataset.isDefault === '1';

    _alarmSoundId = opt.dataset.alarmSoundId || '';
    _alarmVolume  = opt.dataset.alarmVolume !== undefined ? parseInt(opt.dataset.alarmVolume) : 50;
    _alarmDelay   = parseFloat(opt.dataset.alarmDelay) || 2;

    _modal.querySelector('#ws_alarmSound').value           = _alarmSoundId;
    _modal.querySelector('#ws_alarmVolume').value          = _alarmVolume;
    _modal.querySelector('#ws_alarmVolumeVal').textContent = _alarmVolume;
    _modal.querySelector('#ws_alarmDelay').value           = _alarmDelay;

    var dbW = parseInt(opt.dataset.wsWidth)  || 0;
    var dbH = parseInt(opt.dataset.wsHeight) || 0;
    var resSel = _modal.querySelector('#wsResolution');
    if (resSel) {
        resSel.value = (dbW && dbH) ? (dbW + 'x' + dbH) : '0x0';
        if (window.updateResolutionHint) window.updateResolutionHint(resSel);
    }

    if (!silent) {
        _wsWidth  = dbW;
        _wsHeight = dbH;
        _applyResolution(_wsWidth, _wsHeight);
        $.ajax({ url: '/api/profiles/' + _activeProfileId + '/select', type: 'POST' });
    }
}

function applyProfileFromSSE(profile) {
    _activeProfileId = profile.id;
    _savedBackground = profile.background;
    _savedCellSize   = profile.cell_size;
    _alarmSoundId    = profile.alarm_sound_id || '';
    _alarmVolume     = profile.alarm_volume  != null ? parseInt(profile.alarm_volume)  : 50;
    _alarmDelay      = profile.alarm_delay   != null ? parseFloat(profile.alarm_delay) : 2;
    _applyResolution(profile.ws_width || 0, profile.ws_height || 0);

    var select = _modal.querySelector('#wsProfile');
    if (select) {
        select.value = profile.id;
        var delBtn = _modal.querySelector('#deleteProfileBtn');
        if (delBtn) delBtn.disabled = profile.is_default === 1;
    }

    var colorInput = _modal.querySelector('#workSpaceColor');
    var sizeInput  = _modal.querySelector('#cellSize');
    if (colorInput) colorInput.value = profile.background;
    if (sizeInput)  sizeInput.value  = profile.cell_size;
}

// ── Create profile modal ──────────────────────────────────────────────────────

function showCreateProfileModal() {
    _createProfileModal.querySelector('#newProfileName').value = '';
    _createProfileModal.showModal();
}

function closeCreateProfileModal() {
    _createProfileModal.close();
}

function createProfileConfirm() {
    var name       = _createProfileModal.querySelector('#newProfileName').value.trim();
    var background = _modal.querySelector('#workSpaceColor').value;
    var cellSize   = parseInt(_modal.querySelector('#cellSize').value) || 20;

    if (!name) {
        _createProfileModal.querySelector('#newProfileName').focus();
        return;
    }

    $.ajax({
        url:         '/api/profiles',
        type:        'POST',
        contentType: 'application/x-www-form-urlencoded',
        data:        { name: name, background: background, cellSize: cellSize },
        success: function (res) {
            _activeProfileId = res.id;
            _createProfileModal.close();
            _loadProfiles().then(function () {
                _modal.querySelector('#wsProfile').value = res.id;
                applyProfile(_modal.querySelector('#wsProfile'));
            });
        },
        error: function (xhr) {
            console.error('Ошибка сохранения профиля:', xhr.responseJSON);
        }
    });
}

// ── Delete profile modal ──────────────────────────────────────────────────────

function showDeleteProfileModal() {
    var select = _modal.querySelector('#wsProfile');
    var opt    = select.options[select.selectedIndex];
    if (!opt || opt.dataset.isDefault === '1') return;

    _pendingDeleteId = select.value;
    _deleteProfileModal.querySelector('#deleteProfileMessage').textContent =
        'Вы уверены, что хотите удалить профиль «' + opt.textContent + '»?';
    _deleteProfileModal.showModal();
}

function closeDeleteProfileModal() {
    _pendingDeleteId = null;
    _deleteProfileModal.close();
}

function deleteProfileConfirm() {
    if (!_pendingDeleteId) return;

    $.ajax({
        url:     '/api/profiles/' + _pendingDeleteId,
        type:    'DELETE',
        success: function () {
            _pendingDeleteId = null;
            _activeProfileId = null;
            _deleteProfileModal.close();
            _loadProfiles().then(function () {
                applyProfile(_modal.querySelector('#wsProfile'));
            });
        },
        error: function (xhr) {
            console.error('Ошибка удаления профиля:', xhr.responseJSON);
        }
    });
}

// ── Main settings modal ───────────────────────────────────────────────────────

function showWorkSpaceSettings() {
    var appliedW = _wsWidth;
    var appliedH = _wsHeight;
    initCombo(_modal.querySelector('#wsProfile'));
    initCombo(_modal.querySelector('#ws_alarmSound'));
    _loadProfiles().then(function () {
        if (appliedW || appliedH) {
            var resSel = _modal.querySelector('#wsResolution');
            if (resSel) {
                resSel.value = (appliedW && appliedH) ? (appliedW + 'x' + appliedH) : '0x0';
                window.updateResolutionHint(resSel);
            }
        }
        _modal.showModal();
    });
}

function closeWorkSpaceSettings() {
    _modal.close();
}

function applyWorkSpaceSettings() {
    var cellSize = parseInt(_modal.querySelector('#cellSize').value);
    if (isNaN(cellSize) || cellSize < 10) cellSize = 10;
    if (cellSize > 200)                   cellSize = 200;

    _settings.background = _modal.querySelector('#workSpaceColor').value;
    _settings.cellSize   = cellSize;

    _alarmSoundId = _modal.querySelector('#ws_alarmSound').value;
    _alarmVolume  = parseInt(_modal.querySelector('#ws_alarmVolume').value) || 50;
    _alarmDelay   = parseFloat(_modal.querySelector('#ws_alarmDelay').value) || 2;

    var resParts = (_modal.querySelector('#wsResolution').value || '0x0').split('x');
    _applyResolution(parseInt(resParts[0]) || 0, parseInt(resParts[1]) || 0);

    _modal.close();
    showSaveBtn();
}

// ── Save to DB ────────────────────────────────────────────────────────────────

function saveSettings() {
    if (!_activeProfileId) return;
    if (window.stopAlarmSound) window.stopAlarmSound();

    var data = {
        background:   _settings.background,
        cellSize:     _settings.cellSize,
        alarmSoundId: _alarmSoundId,
        alarmVolume:  _alarmVolume,
        alarmDelay:   _alarmDelay,
        wsWidth:      _wsWidth,
        wsHeight:     _wsHeight
    };

    $.ajax({
        url:         '/api/profiles/' + _activeProfileId,
        type:        'PUT',
        contentType: 'application/x-www-form-urlencoded',
        data:        data,
        success: function () {
            _savedBackground = _settings.background;
            _savedCellSize   = _settings.cellSize;
            $.ajax({
                url:         '/api/profiles/' + _activeProfileId + '/indicators',
                type:        'POST',
                contentType: 'application/json',
                data:        JSON.stringify({ indicators: _collectIndicators() }),
                complete:    function () { hideSaveBtn(); }
            });
        },
        error: function (xhr) {
            console.error('Ошибка сохранения в профиль:', xhr.responseJSON);
        }
    });
}

// ── Profile export / import ───────────────────────────────────────────────────

window.exportProfile = function() {
    if (!_activeProfileId) { showError('Нет активного профиля'); return; }
    $.when(
        $.getJSON('/api/profiles'),
        $.getJSON('/api/profiles/' + _activeProfileId + '/indicators')
    ).then(function(profilesResp, indicatorsResp) {
        var profile = profilesResp[0].find(function(p) { return p.id === _activeProfileId; });
        if (!profile) { showError('Профиль не найден'); return; }
        var json = {
            profile: {
                name:        profile.name,
                background:  profile.background,
                cellSize:    profile.cell_size,
                alarmVolume: profile.alarm_volume,
                alarmDelay:  profile.alarm_delay
            },
            indicators: indicatorsResp[0]
        };
        var blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href     = url;
        a.download = profile.name.replace(/[^\wа-яА-ЯёЁ\- ]/g, '_') + '.json';
        a.click();
        URL.revokeObjectURL(url);
    });
};

window.importProfile = function(input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var data = JSON.parse(e.target.result);
            if (!data.profile || !Array.isArray(data.indicators)) throw new Error('Ожидаются поля profile и indicators');
            var p = data.profile;
            $.ajax({
                url:         '/api/profiles',
                type:        'POST',
                contentType: 'application/x-www-form-urlencoded',
                data:        { name: p.name, background: p.background || '#0d1117', cellSize: p.cellSize || 20 },
                success: function(res) {
                    var newId = res.id;
                    $.ajax({
                        url:         '/api/profiles/' + newId,
                        type:        'PUT',
                        contentType: 'application/x-www-form-urlencoded',
                        data:        {
                            background:  p.background  || '#0d1117',
                            cellSize:    p.cellSize    || 20,
                            alarmVolume: p.alarmVolume || 50,
                            alarmDelay:  p.alarmDelay  || 2
                        },
                        success: function() {
                            $.ajax({
                                url:         '/api/profiles/' + newId + '/indicators',
                                type:        'POST',
                                contentType: 'application/json',
                                data:        JSON.stringify({ indicators: data.indicators }),
                                success: function() {
                                    _activeProfileId = newId;
                                    _loadProfiles().then(function() {
                                        var select = _modal.querySelector('#wsProfile');
                                        select.value = newId;
                                        applyProfile(select);
                                    });
                                },
                                error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка импорта индикаторов'); }
                            });
                        },
                        error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка обновления профиля'); }
                    });
                },
                error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка создания профиля'); }
            });
        } catch(err) {
            showError('Неверный формат JSON: ' + err.message);
        }
        input.value = '';
    };
    reader.readAsText(file);
};

// ── Alarm sound test ─────────────────────────────────────────────────────────

var _testAudio = null;

function testAlarmSound() {
    var soundId = _modal.querySelector('#ws_alarmSound').value;
    if (!soundId) return;

    var volume = (parseInt(_modal.querySelector('#ws_alarmVolume').value) || 50) / 100;
    var btn    = _modal.querySelector('#ws_alarmPlayBtn');

    if (_testAudio && !_testAudio.paused) {
        _testAudio.pause();
        _testAudio.currentTime = 0;
        btn.textContent = '▶';
        return;
    }

    _testAudio = new Audio('/api/alarm-sounds/' + soundId + '/file');
    _testAudio.volume = volume;
    btn.textContent   = '■';
    _testAudio.play();
    _testAudio.addEventListener('ended', function () { btn.textContent = '▶'; });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setSettings(source, target) {
    try {
        for (let key in source) { target[key] = source[key]; }
    } catch (error) { console.error(error); }
}

function getSettings() {
    $.ajax({
        url:      '/getSettings',
        type:     'GET',
        dataType: 'JSON',
        success: function (data) {
            setSettings(data, _settings);
        }
    });
}

window._getAlarmConfig = function() {
    return { soundId: _alarmSoundId, volume: _alarmVolume, delay: _alarmDelay };
};

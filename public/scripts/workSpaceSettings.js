var _modal              = document.querySelector('#settings');
var _createProfileModal = document.querySelector('#createProfileModal');
var _deleteProfileModal = document.querySelector('#deleteProfileModal');
var _workSpace          = document.querySelector('#workSpace');

let _pendingDeleteId  = null;
let _activeProfileId  = null;
let _savedBackground  = null;
let _savedCellSize    = null;

let _settings = {
    ip:      '',
    mask:    '',
    gateway: '',
    dhcp:    false,

    get background() { return getComputedStyle(_workSpace).getPropertyValue('--workSpace-color').trim(); },
    set background(value) { _workSpace.style.setProperty('--workSpace-color', value); },

    get gridColor() { return getComputedStyle(_workSpace).getPropertyValue('--grid-color').trim(); },
    set gridColor(value) { _workSpace.style.setProperty('--grid-color', value); },

    get cellSize() { return parseInt(_workSpace.dataset['cellSize']) || 20; },
    set cellSize(value) {
        _workSpace.dataset['cellSize'] = value;
        if (_gridActive) {
            _workSpace.style.backgroundSize = value + 'px ' + value + 'px';
        }
    }
};

// ── Profiles ──────────────────────────────────────────────────────────────────

function _loadProfiles() {
    var select = _modal.querySelector('#wsProfile');
    return $.getJSON('/api/profiles').then(function (profiles) {
        var prevId = _activeProfileId || (select.value || null);
        select.innerHTML = '';
        profiles.forEach(function (p) {
            var opt = document.createElement('option');
            opt.value              = p.id;
            opt.textContent        = p.name;
            opt.dataset.background = p.background;
            opt.dataset.cellSize   = p.cell_size;
            opt.dataset.isDefault  = p.is_default;
            select.appendChild(opt);
        });
        if (prevId) select.value = prevId;
        applyProfile(select, true);
    });
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

    if (!silent) {
        $.ajax({ url: '/api/profiles/' + _activeProfileId + '/select', type: 'POST' });
    }
}

function applyProfileFromSSE(profile) {
    _activeProfileId = profile.id;
    _savedBackground = profile.background;
    _savedCellSize   = profile.cell_size;

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
    _loadProfiles().then(function () {
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

    var background = _modal.querySelector('#workSpaceColor').value;

    _settings.background = background;
    _settings.cellSize   = cellSize;

    _modal.close();
    saveSettings();
}

// ── Save to DB ────────────────────────────────────────────────────────────────

function saveSettings() {
    if (!_activeProfileId) return;

    $.ajax({
        url:         '/api/profiles/' + _activeProfileId,
        type:        'PUT',
        contentType: 'application/x-www-form-urlencoded',
        data:        { background: _settings.background, cellSize: _settings.cellSize },
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

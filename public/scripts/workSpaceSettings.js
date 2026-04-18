var _modal = document.querySelector('#settings');
var _workSpace = document.querySelector('#workSpace');

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

const _profiles = {
    default: { background: '#000000', cellSize: 20 }
};

function applyProfile(profileKey) {
    var profile = _profiles[profileKey];
    if (!profile) return;
    _modal.querySelector('#workSpaceColor').value = profile.background;
    _modal.querySelector('#cellSize').value = profile.cellSize;
}

function selectCustomProfile() {}

function showWorkSpaceSettings() {
    _modal.querySelector('#workSpaceColor').value = _settings.background || '#000000';
    _modal.querySelector('#cellSize').value        = _settings.cellSize;
    _modal.showModal();
}

function closeWorkSpaceSettings() {
    _modal.close();
}

function applyWorkSpaceSettings() {
    var colorInput = _modal.querySelector('#workSpaceColor');
    var sizeInput  = _modal.querySelector('#cellSize');

    var cellSize = parseInt(sizeInput.value);
    if (isNaN(cellSize) || cellSize < 10) cellSize = 10;
    if (cellSize > 200)                   cellSize = 200;

    _settings.background = colorInput.value;
    _settings.cellSize   = cellSize;

    showSaveBtn();
    _modal.close();
}

function setSettings(source, target) {
    try {
        for (let key in source) {
            target[key] = source[key];
        }
    } catch (error) {
        console.error(error);
    }
}

function saveSettings() {
    try {
        $.ajax({
            url:      '/setSettings',
            type:     'POST',
            async:    true,
            dataType: 'html',
            data:     { settings: JSON.stringify(_settings) },
            success:  hideSaveBtn
        });
    } catch (error) {
        console.log(error);
    }
}

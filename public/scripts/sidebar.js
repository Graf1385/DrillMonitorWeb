var _networkSettings = document.querySelector('#networkSettings');

let sideBar = document.querySelector('#sideBar');
let logo = document.querySelector('#sideBarLogo');
let rmBtn = sideBar.querySelector('#removeButton');
let saveBtn = sideBar.querySelector('#saveButton');

function showNetworkSettings(){    

    _networkSettings.showModal();
}

function showRemoveBtn(){    
    rmBtn.classList.add('visible');
}

function hideRemoveBtn(){
    rmBtn.classList.remove('visible');
}

function showSaveBtn(){    
    saveBtn.classList.add('visible');
}

function hideSaveBtn(){
    saveBtn.classList.remove('visible');
}


function showAlarmSettings() {
    var indicators = document.querySelectorAll('#workSpace .indicator');
    var list = document.querySelector('#alarmOverviewList');
    if (indicators.length === 0) {
        list.innerHTML = '<p class="alarmOverviewEmpty">Нет индикаторов на рабочей области</p>';
    } else {
        var rows = Array.from(indicators).map(function(ind) {
            var d = ind.dataset;
            var header = ind.querySelector('.indicatorHeader');
            var label  = (header ? header.textContent.trim() : '') || ('Индикатор');
            var minVal = d.alarmMin  !== '' && d.alarmMin  !== undefined ? d.alarmMin  : '—';
            var maxVal = d.alarmMax  !== '' && d.alarmMax  !== undefined ? d.alarmMax  : '—';
            var color  = d.alarmColor || '#ff0000';
            return '<tr>' +
                '<td class="aol-name">' + label + '</td>' +
                '<td class="aol-range">' + minVal + ' / ' + maxVal + '</td>' +
                '<td class="aol-color"><span class="aol-colorDot" style="background:' + color + '"></span></td>' +
                '<td><button class="aol-editBtn modalButton okBtn" data-idx="' + ind.dataset.indicatorId + '">Настроить</button></td>' +
            '</tr>';
        });
        list.innerHTML = '<table class="settingsTable"><thead><tr>' +
            '<th>Индикатор</th><th>Мин / Макс</th><th>Цвет</th><th></th>' +
            '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
        var allInds = Array.from(indicators);
        list.querySelectorAll('.aol-editBtn').forEach(function(btn, i) {
            btn.addEventListener('click', function() {
                document.querySelector('#alarmOverviewModal').close();
                _alarmTarget = allInds[i];
                var d = _alarmTarget.dataset;
                document.querySelector('#as_alarmMin').value   = d.alarmMin !== '' && d.alarmMin !== undefined ? d.alarmMin : '';
                document.querySelector('#as_alarmMax').value   = d.alarmMax !== '' && d.alarmMax !== undefined ? d.alarmMax : '';
                document.querySelector('#as_alarmColor').value = d.alarmColor || '#ff0000';
                document.querySelector('#alarmSettingsModal').showModal();
            });
        });
    }
    document.querySelector('#alarmOverviewModal').showModal();
}

logo.addEventListener('click', (event)=>{
    if(sideBar.classList.contains('open')){
        sideBar.classList.remove('open');
    }else{
        sideBar.classList.add('open');
    }
})
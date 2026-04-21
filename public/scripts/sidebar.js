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
    var indicators = Array.from(document.querySelectorAll('#workSpace .indicator'))
        .filter(function(ind) { return ind.dataset.alarmEnabled === '1'; });
    var list = document.querySelector('#alarmOverviewList');
    if (indicators.length === 0) {
        list.innerHTML = '<p class="alarmOverviewEmpty">Нет индикаторов с включённой сигнализацией</p>';
    } else {
        var rows = indicators.map(function(ind) {
            var d = ind.dataset;
            var name   = d.headerText || 'Индикатор';
            var minVal = d.alarmMin !== '' && d.alarmMin !== undefined ? d.alarmMin : '—';
            var maxVal = d.alarmMax !== '' && d.alarmMax !== undefined ? d.alarmMax : '—';
            var color  = d.alarmColor || '#ff0000';
            return '<tr>' +
                '<td class="aol-name">' + name + '</td>' +
                '<td class="aol-range">' + minVal + '</td>' +
                '<td class="aol-range">' + maxVal + '</td>' +
                '<td class="aol-color"><span class="aol-colorDot" style="background:' + color + '"></span></td>' +
            '</tr>';
        });
        list.innerHTML = '<table class="settingsTable aol-table">' +
            '<colgroup><col><col style="width:50px"><col style="width:50px"><col style="width:50px"></colgroup>' +
            '<thead><tr>' +
            '<th>Параметр</th><th>Мин</th><th>Макс</th><th>Цвет</th>' +
            '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
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
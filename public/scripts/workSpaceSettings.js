var _root = document.querySelector(':root');
var _modal = document.querySelector('#settings');
var _workSpace = document.querySelector('#workSpace');

let _defaultSettings;
let _settings = {
    ip : '',
    mask : '',
    gateway : '',
    dhcp : false,
    get background() { return getComputedStyle(_workSpace).getPropertyValue('--workSpace-color'); },
    set background(value) { _workSpace.style.setProperty('--workSpace-color', value); },

    get gridColor() { return getComputedStyle(_workSpace).getPropertyValue('--grid-color'); },
    set gridColor(value) { _workSpace.style.setProperty('--grid-color', value); },

    get cellSize() { return _workSpace.dataset['cellSize']; },
    set cellSize(value) { 
        
        _workSpace.dataset['cellSize'] = value; 

        if(this.gridState == "true"){
            workSpace.style.backgroundSize = value + 'px ' +  value + 'px';
        }
    },

    get gridState() { return _workSpace.dataset['gridState']; },
    set gridState(value) { 

        _workSpace.dataset['gridState'] = !value;

        if(value == false){
            netBtn.classList.add('enable');
            workSpace.style.backgroundSize = this.cellSize + 'px ' +  this.cellSize + 'px';
        }
        else{            
            netBtn.classList.remove('enable');
            workSpace.style.backgroundSize = 0 + 'px ' +  0 + 'px';
        }
    }
}



function numericMask(item, min, max){
    var value = parseInt(item.value);
    
    if(isNaN(value) || value < min){
        item.value = min;
        item.blur();
        return;
    }      
    if( value > max){
        item.value = max;
        item.blur();
        return;
    }
}

function getSettings(){
    $.ajax({
        url: "/getSettings",
        type: "GET",
        dataType: "JSON",
        success: function(settings){
            _defaultSettings = settings;
            console.log(settings);
            setSettings(settings, _settings);       
            console.log(_settings);     
        }
    });  
}

function setSettings(source, target){
    try {
        for (let key in source) {            
            target[key] = source[key];            
        }
    } catch (error) {
        console.error(error);
    }   
}

function showSettings(){    
    _modal.querySelector('#workSpaceColor').value = _settings.background;
    _modal.querySelector('#gridColor').value = _settings.gridColor;
    _modal.querySelector('#cellSize').value = _settings.cellSize;
    _modal.showModal();
}

function closeSettings(){
    setSettings(_defaultSettings, _settings)
    _modal.close();//wfd-id - id0
}

function applySettings(){
    setSettings(_settings, _defaultSettings)
    showSaveBtn();
    _modal.close();
}

function saveSettings(){
    
    try {        
        $.ajax({
            url: "/setSettings",
            type: "POST",
            async: true,
            dataType: "html",
            data: { settings : JSON.stringify(_settings) },
            success: hideSaveBtn()
        });         

    } catch (error) {
        console.log(error);
    }    
    
}
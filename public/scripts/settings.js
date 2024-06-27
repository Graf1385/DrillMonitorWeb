var _root = document.querySelector(':root');
var _modal = document.querySelector('#settings');
var _workSpace = document.querySelector('#workSpace');
var _ip_address = $('#ipAddress');
var net_mask = $('#netMask');

var _settings = {
    ip : "",
    mask : "",
    background : "#000000",
    gridColor : "#FFFFFF",
    cellSize : 20
}

ip_address.inputmask({
    alias: "ip",
    greedy: false
});

net_mask.inputmask({
    alias: "ip",
    greedy: false
});

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
        type: "POST",
        data: `city=JJJ&country=KKKK`,
        success: function(settings){
            setColor(settings.Settings.background, '--workSpace-color')
            
        }
    });  
}

function showSettings(){    
    _modal.querySelector('#workSpaceColor').value = getColor('--workSpace-color');
    _modal.querySelector('#netColor').value = getColor('--net-color');
    _modal.querySelector('#netSize').value = workSpace.dataset.cellSize;

    $.ajax({
        url: "/getSettings",
        type: "POST",
        data: `city=JJJ&country=KKKK`,
        success: function(settings){
            _modal.querySelector('#ipAddress').value = settings.Settings.ip;
            _modal.querySelector('#netMask').value = settings.Settings.mask;
        }
    });  

    _modal.showModal();
}

function getColor(varName){
    return getComputedStyle(_root).getPropertyValue(varName);
}

function setColor(value, varName){
    _root.style.setProperty(varName, value);
}

function closeSettings(){
    _modal.close();//wfd-id - id0
}

function applySettings(){
    showSaveBtn();
    _modal.close();
}

function saveSettings(){
    
    try {

        

        $.ajax({
            url: "/setSettings",
            type: "POST",
            data: ``,
            success: function(settings){
                hideSaveBtn();
            }
        });  

       

    } catch (error) {
        console.log(error);
    }    
    
}


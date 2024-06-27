var root = document.querySelector(':root');
var modal = document.querySelector('#settings');
var workSpace = document.querySelector('#workSpace');
var ip_address = $('#ipAddress');
var net_mask = $('#netMask');

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

async function getSettings(){
    await $.ajax({
        url: "/getSettings",
        type: "POST",
        data: `city=JJJ&country=KKKK`,
        success: function(settings){
           return settings;
        }
    });
}

function showSettings(){    
    modal.querySelector('#workSpaceColor').value = getColor('--workSpace-color');
    modal.querySelector('#netColor').value = getColor('--net-color');
    modal.querySelector('#netSize').value = workSpace.dataset.cellSize;

    var settings = getSettings();

    modal.querySelector('#ipAddress').value = settings.ip;
    modal.querySelector('#netMask').value = settings.mask;

    modal.showModal();
}

function getColor(varName){
    return getComputedStyle(root).getPropertyValue(varName);
}

function setColor(value, varName){
    root.style.setProperty(varName, value);
}

function closeModal(){
    modal.close();//wfd-id - id0
}

function SaveSettings(){

}



function showNewItems(){
	var modal = document.querySelector('#newItemModal');
	modal.showModal();
}

function GetDigitalIndicator(id, Header, defaultValue) {
    return '<div class="indicator digitalIndicator" id="'+ id +'"><h1 class="indicatorHeader">' + Header + '</h1><div class="indicatorValue">' + defaultValue + '</div></div>';
}

function addItem() {
    var item = GetDigitalIndicator(2, "Вес на крюке", "0000.0");
    var workspace = document.querySelector('#workSpace');
    workspace.innerHTML += item;
}

function removeItem() {
    var workspace = document.querySelector('#workSpace');
    var last = workspace.querySelector('.indicator:last-child');
    if (last) last.remove();
}


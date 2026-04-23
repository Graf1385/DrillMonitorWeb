var netBtn = sideBar.querySelector('#gridButton');
var workSpace = document.querySelector('#workSpace');

var _gridActive = false;

function toggleGrid() {
    _gridActive = !_gridActive;

    if (_gridActive) {
        var cellSize = parseInt(_workSpace.dataset.cellSize) || 20;
        netBtn.classList.add('enable');
        _workSpace.style.backgroundSize = cellSize + 'px ' + cellSize + 'px';
    } else {
        netBtn.classList.remove('enable');
        _workSpace.style.backgroundSize = '0px 0px';
    }
}

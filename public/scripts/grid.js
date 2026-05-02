var netBtn = sideBar.querySelector('#gridButton');

var _gridActive = false;

function toggleGrid() {
    _gridActive = !_gridActive;

    if (_gridActive) {
        var cellSize = parseInt(_wsCanvas.dataset.cellSize) || 20;
        netBtn.classList.add('enable');
        _wsCanvas.style.backgroundSize = cellSize + 'px ' + cellSize + 'px';
    } else {
        netBtn.classList.remove('enable');
        _wsCanvas.style.backgroundSize = '0px 0px';
    }
}

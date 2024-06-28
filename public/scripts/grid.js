var netBtn = sideBar.querySelector('#netButton');	
var workSpace = document.querySelector('#workSpace');


function netControl(settings){
	
	console.log(settings);
	var cellSize = 0;
	
	if(settings.grid == 'false'){
		cellSize = getComputedStyle(_workSpace).getPropertyValue('--cellsSize');

		netBtn.classList.add('enable');
		_workSpace.style.setProperty('--gridSate', true);
	}
	else{
		netBtn.classList.remove('enable');
		_workSpace.style.setProperty('--gridSate', false);
	}

	_workSpace.style.setProperty('--cellsSize', cellSize);
}

function setGridSize(value){
	var sate = getComputedStyle(_workSpace).getPropertyValue('--gridSate');

	if(sate == 'true'){
		_workSpace.style.setProperty('--cellsSize', cellSize);
	}	
}
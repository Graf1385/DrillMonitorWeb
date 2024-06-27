var netBtn = sideBar.querySelector('#netButton');	
var workSpace = document.querySelector('#workSpace');


function netControl(){
	
	var cellSize = 0;

	if(workSpace.dataset["gridState"] == "false"){
		cellSize = workSpace.dataset["cellSize"];
		netBtn.classList.add('enable');
		workSpace.dataset["gridState"] = true;
	}
	else{
		netBtn.classList.remove('enable');
		workSpace.dataset["gridState"] = false;
	}

	workSpace.style.backgroundSize = cellSize + 'px ' + cellSize + 'px';
}

function setGridSize(value){
	workSpace.dataset["cellSize"] = value;

	if(workSpace.dataset["gridState"] == "true"){
		workSpace.style.backgroundSize = value + 'px ' + value + 'px';
	}	
}
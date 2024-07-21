const settings = {
    ip : '',
    mask : '',
    gateway : '',
    dhcp : true,
    fistdns : '',
    seconddns : ''
}

const defaultSettings = {
    ip : '',
    mask : '',
    gateway : '',
    dhcp : true,
    fistdns : '',
    seconddns : ''
}

let ipArdessClass = $(".ipAddress");

ipArdessClass.inputmask({
    alias: "ip",
    greedy: false
});

function getSettings() {
    if(settings.dhcp){
        document.querySelector("#dhcpon").setAttribute("checked", "");
        dhcpOn();
    }else{
        document.querySelector("#dhcpoff").setAttribute("checked", "");
        dhcpOff();
    }
}

function dhcpOn(){
    var inputs = document.querySelectorAll(".ipAddress");
    settings.dhcp = true;
    inputs.forEach(item => {
        item.removeAttribute("disabled", "");
    })
}

function dhcpOff(){
    var inputs = document.querySelectorAll(".ipAddress");
    settings.dhcp = false;
    inputs.forEach(item => {
        item.setAttribute("disabled", "");
    })
}

function closeSettings(){
    document.querySelector("#networkSettings").close();
}

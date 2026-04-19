const _express = require("express");
const _app = _express();
const _get_router = require("./routes/get_routers");
const _post_router = require("./routes/post_routers");
const _exphbs = require('express-handlebars');

const _hbs = _exphbs.create({
    defaultLayout: 'main',
    extname: 'hbs'
});

_app.engine('hbs', _hbs.engine);
_app.set('view engine', 'hbs');
_app.set('views', './server/views');

_app.use(_express.json());
_app.use(_express.urlencoded({ extended : false}))
_app.use(_express.static('./public/scripts'));
_app.use(_express.static('./public/styles'));
_app.use(_express.static('./public/image'));


_app.use(_get_router);
_app.use(_post_router);

function Start(port){

    try {
        _app.listen(port, ()=>{
            console.log("The server is already running...");
            console.log("http://localhost:" + port);
        });    
        
    } catch (error) {
        console.log(error);
    }
  
        
}

module.exports = {
    Start : Start
}

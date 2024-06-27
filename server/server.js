const express = require("express");
const app = express();
const router = require("./routes/routers");
const exphbs = require('express-handlebars');

const hbs = exphbs.create({
    defaultLayout: 'main',
    extname: 'hbs'
});

app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', './server/views');

app.use(express.static('./public/scripts'));
app.use(express.static('./public/styles'));
app.use(express.static('./public/image'));

app.use(router);

function Start(port){

    try {
        app.listen(port, ()=>{
            console.log("The server is already running...");
            console.log("http://localhost:"+port);
        });    
        
    } catch (error) {
        console.log(error);
    }
  
        
}

module.exports = {
    Start : Start
}


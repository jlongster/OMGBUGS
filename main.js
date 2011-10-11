var express = require('express');
var socket_io = require('socket.io');
var connect = require('connect');
var bz = require('./bugzilla');
var db = require('./db');
var scrape = require('./scrape');

var app = express.createServer();

app.configure(function() {
    app.use(express.static(__dirname + '/media/'));
    app.use(express.bodyParser());
    app.use(express.cookieParser());

    app.set('views', __dirname + '/views');
    app.set('view options', {layout: false});
    app.set("view engine", "html");
    app.register("html", require("jqtpl/jqtpl.express"));
});

// bz.turn_off_login('jlong@mozilla.com');

app.get('/', function(req, res) {
    var user = bz.get_user(req);
    if(!user) {
        res.redirect('/login/');
    }
    else {
        db.get_user_options(user, function(err, opts) {
            opts = opts || { columns: ['summary'] };
            res.render('index', {page_id: 'index',
                                 options: JSON.stringify(opts)});
        });
    }
});

app.get('/about/', function(res, res) {
    res.render('about', {page_id: 'about'});
});

app.get('/login/', function(req, res) {
    res.render('login', {page_id: 'login'});
});

app.post('/login/', function(req, res) {
    bz.login(req.body.user,
             req.body.pass,
             function(err, user) {
                 if(err) {
                     res.render('login', {page_id: 'login',
                                          error: true});
                     return;
                 }

                 // Pass the auth cookies onto the user
                 res.cookie('Bugzilla_login', user.login,
                            {path: '/',
                             httpOnly: true});
                 res.cookie('Bugzilla_logincookie', 
                            user.logincookie,
                            {path: '/', 
                             httpOnly: true});
                 res.cookie('user', user.name, {path: '/',
                                                 httpOnly: true});
                 res.redirect('/');
             });
});

app.post('/edit/', function(req, res) {
    bz.edit_bug(bz.get_user(req),
                req.body,
                function(err) {
                    if(err) {
                        res.send({desc: 'Error editing bug'}, 500);
                    }
                    else {
                        res.send({});
                    }
                });
});

app.post('/comment/', function(req, res) {
    bz.post_comment(bz.get_user(req),
                    req.body.id,
                    req.body.content,
                    function(err) {
                        if(err) {
                            res.send({desc: 'Error posting comment'}, 500);
                        }
                        else {
                            res.send({})
                        }
                    });
});

app.listen(8000);

var io = socket_io.listen(app);
io.set('log level', 1);

io.set('authorization', function(data, cont) {
    if(data.headers.cookie) {
        var cookies = connect.utils.parseCookie(data.headers.cookie);
        var user = bz.get_user(cookies);

        if(user) {
            data.user = user;
            cont(null, true);
            return;
        }
    }

    cont(null, false);
});

io.sockets.on('connection', function(socket) {    
    var user = socket.handshake.user;

    db.get_searches(user, function(searches) {
        if(searches.length) {
            socket.emit('searches', searches);
        }
        else {
            socket.emit('new-user');

            db.index_searches(user, function(searches) {
                socket.emit('searches', searches);
                socket.emit('new-user-finished');
            });
        }
    });

    db.index_searches(user, function(searches) {
        socket.emit('searches', searches);
    });

    db.get_user_options(user, function(err, opts) {
        socket.emit('settings', opts);
    });

    socket.on('search', function(msg) {
        db.get_bugs(user, msg.term, function(bugs) {
            socket.emit('bugs', {search: msg.term,
                                 bugs: bugs,
                                 key: msg.key});
        });
    });

    socket.on('index-search', function(msg) {
        db.index_bugs(user, msg.term);
    });

    socket.on('settings', function(opts) {
        db.set_user_options(user, opts);
    });

    socket.on('get-comments', function(id) {
        db.get_comments(user, id, function(err, comments) {
            if(!err) {
                socket.emit('comments', comments);
            }
        });
    });

    socket.on('index-comments', function(id) {
        db.index_comments(user, id, function(err, comments) {
            if(!err) {
                socket.emit('comments', comments);
            }
        });
    });
});


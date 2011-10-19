var express = require('express');
var socket_io = require('socket.io');
var connect = require('connect');
var bz = require('./bugzilla');
var db = require('./db');
var scrape = require('./scrape');
var _ = require('./underscore');

var app = express.createServer();

app.configure(function() {
    app.use(express.static(__dirname + '/media/'));
    app.use(express.bodyParser());
    app.use(express.cookieParser());
    app.use(express.session({secret: '2C57FAA2-58D4-4DA3-B7FC-4D3F686E35F9'}));

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

app.get('/favicon.ico', function(req, res) {
    res.sendfile('./media/img/favicon.ico');
});

app.get('/about/', function(req, res) {
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

                 // also store the pass redis so the websocket can access
                 // it.
                 // ** this is temporary ** until the bugzilla guys
                 // let me get private bugs with the above cookies,
                 // I'm forced to do this for now. (see bug 694663)
                 db.temporarily_store_password(user, req.body.pass);

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

app.listen(8001);

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

    // we haven't hooked up pulse.mozilla.org yet, so we need to turn
    // on polling mode
    socket.emit('set-mode', 'poll');

    // bugs
    socket.on('get-bug', function(id) {
        db.get_bug(user, id, function(bug) {
            socket.emit('update-bug', bug);
        });
    });
    
    socket.on('get-bugs', function(term) {
        db.get_bugs(user, term, function(bugs) {
            socket.emit('set-bugs', {search: term,
                                     bugs: bugs});
        });
    });

    // searches
    socket.on('get-searches', function() {
        db.get_searches(user, function(searches) {
            socket.emit('update-searches', searches);
        });

        db.index_searches(user, function(searches) {
            socket.emit('update-searches', searches);
        });
    });

    // comments
    socket.on('get-comments', function(id) {
        db.get_comments(user, id, function(err, comments) {
            if(!err) {
                socket.emit('update-comments', comments);
            }
        });
    });

    // settings
    socket.on('get-settings', function() {
        db.get_user_options(user, function(err, opts) {
            socket.emit('update-settings', opts || {});
        });
    });

    socket.on('set-settings', function(opts) {
        db.set_user_options(user, opts);
    });

    // update (re-index) data for the client who is in polling
    // mode. clients should only be in polling mode if
    // pulse.mozilla.org is turned off, which provides much more
    // friendly push notifications.
    socket.on('update', function(selected_search) {

        function update_search(user, pass, search) {
            var bugs = [];

            db.index_bugs(user, pass, search)
                .on('error', function(err) {
                    console.log(err);
                })
                .on('bugs', function(more_bugs) {
                    bugs = _.union(bugs, more_bugs);
                })
                .on('complete', function() {
                    socket.emit('update-bugs', {search: search,
                                                bugs: bugs});
                });

        }

        // get the saved password for the bug queries (hopefully
        // bugzilla will support cookie-based requests for private
        // bugs soon)
        db.get_temporarily_stored_password(user, function(err, pass) {

            if(selected_search) {
                console.log('updating search "' + selected_search + '"');

                // we're only updating one search
                update_search(user, pass, selected_search);
            }
            else {
                console.log('updating the world...');

                // first, update the saved searches
                db.index_searches(user, function(searches) {
                    // then index all of the bugs for each search,
                    // including the builtin searches
                    _.each(_.union(searches, _.keys(bz.builtin_searches)),
                           function(search) {
                               update_search(user, pass, search);
                           });
                });
            }
        });
    });

    // in poll mode, the client asks to update a bug's comments after
    // the user views the bug for a specified time
    socket.on('update-comments', function(id) {
        db.get_temporarily_stored_password(user, function(err, pass) {
            db.index_comments(user, pass, id, function(err, comments) {
                if(!err) {
                    socket.emit('update-comments', comments);
                }
            });
        });
    });

});

var redis = require('redis');
var bz = require('./bugzilla');
var _ = require('./underscore');

db = redis.createClient(6379);

db.on('error', function(err) {
    console.log(err);
    db.quit();
});

function get_user_options(user, cont) {
    db.get(user.name + '-options', function(err, res) {
        cont(err, res && JSON.parse(res));
    });
}

function set_user_options(user, opts) {
    db.get(user.name + '-options', function(err, res) {
        var _opts = JSON.parse(res);
        db.set(user.name + '-options', 
               JSON.stringify(_.extend(_opts, opts)));
    });
}

function index_searches(user, cont) {
    bz.get_searches(user, function(err, searches) {
        if(!err) {
            var trans = db.multi().del(user.name + '-searches');
            for(var i in searches) {
                trans.sadd(user.name + '-searches', searches[i]);
            }
            trans.exec(function() {
                cont && cont(searches.sort());
            });
        }
        else {
            cont && cont();
        }
    });
}

function get_searches(user, cont) {
    db.smembers(user.name + '-searches', function(err, data) {
        cont(data.sort());
    });
}

function index_bugs(user, search, cont) {
    bz.get_bugs(user, search, function(err, bugs) {
        if(!err) {
            var key = user.name + '-buglist-' + search;
            var trans = db.multi().del(key);

            _.each(bugs, function(bug) {
                trans.sadd(key, JSON.stringify(bug));
            });

            _.each(bugs, function(bug) {
                trans.set('bug-' + bug.id, JSON.stringify(bug));
            });

            trans.exec(function() {
                cont && sort_bugs(bugs, cont);
            });
        }
        else {
            cont && cont();
        }
    })
}

function sort_bugs(bugs, cont) {
    cont(bugs.sort(function(b1, b2) {
        if(b1.summary > b2.summary) {
            return -1;
        }
        return 1;
    }));
}

function get_bugs(user, search, cont) {
    db.smembers(user.name + '-buglist-' + search, function(err, bugs) {
        sort_bugs(_.map(bugs, JSON.parse), cont);
    });
}

function get_bug(user, id, cont) {
    db.get('bug-' + id, function(err, data) {
        cont(err, data && JSON.parse(data));
    });
}

function get_comments(user, id, cont) {
    db.lrange(user.name + '-' + id + '-comments', 0, -1, function(err, data) {
        cont(err, data && _.map(data, JSON.parse));
    });
}

function index_comments(user, id, cont) {
    bz.get_comments(user, id, function(err, comments) {
        if(!err) {
            var key = user.name + '-' + id + '-comments';
            var trans = db.multi().del(key);

            _.each(comments, function(c) {
                trans.rpush(key, JSON.stringify(c));
            });

            trans.exec(function() {
                cont && cont(null, comments);
            });
        }
        else {
            cont && cont(err);
        }
    });
}

module.exports = {
    get_user_options: get_user_options,
    set_user_options: set_user_options,
    index_searches: index_searches,
    get_searches: get_searches,
    index_bugs: index_bugs,
    get_bugs: get_bugs,
    get_bug: get_bug,
    index_comments: index_comments,
    get_comments: get_comments
}
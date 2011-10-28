var connect = require('connect');
var https = require('https');
var qs = require('querystring');
var events = require('events');
var xmlrpc = require('./lib/xmlrpc/xmlrpc');

var scrape = require('./scrape');
var _ = require('./underscore');

var _fake_user;
var builtin_searches = {'Assigned to You': search_assigned,
                        'Reported by You': search_reported};

// if running locally, you have the option to bypass the login
// system if you are offline and need to access bugs
function turn_off_login(user) {
    _fake_user = {name: user,
                  login: '-',
                  logincookie: '-'};
}

function get_user(req_or_cookies) {
    var cookies = req_or_cookies.cookies || req_or_cookies;

    if(_fake_user) {
        return _fake_user;
    }

    if(cookies) {
        var user = {name: cookies.user,
                    login: cookies.bugzilla_login,
                    logincookie: cookies.bugzilla_logincookie}
        if(!user.name || !user.login || !user.logincookie)
            return null;

        return user;
    }

    return null;
}

function rpc(user, method, params, cont) {
    var client = xmlrpc.createSecureClient({
        host: 'bugzilla.mozilla.org',
        path: '/xmlrpc.cgi'
    });

    if(user) {
        client.options.headers['Cookie'] =
            'Bugzilla_login=' + user.login + '; ' +
            'Bugzilla_logincookie=' + user.logincookie;
    }

    client.methodCall(method, params, function(err, res, obj) {
        if(err) {
            console.log('xmlrpc error: ' + err);
            cont(err);
        }
        else {
            cont(null, res, obj);
        }
    });
}

function login(user, pass, cont) {    
    if(_fake_user) {
        cont(null, _fake_user);
        return;
    }

    rpc(null, 'User.login', [{"login": user, "password": pass}], function(err, res) {
        var cookies = {};

        if(err) {
            cont(err);
            return;
        }

        if('set-cookie' in res.headers) {
            var raw = res.headers['set-cookie'];

            for(var i=0; i<raw.length; i++) {
                v = connect.utils.parseCookie(raw[i]);
                for(var key in v) {
                    cookies[key] = v[key];
                }            
            }

            cont(null,
                 {name: user,
                  login: cookies['bugzilla_login'],
                  logincookie: cookies['bugzilla_logincookie']});
        }
        else {
            cont('Authentication error');
        }
    });
}

// Scrape the saved searches page for searches
function get_searches(user, cont) {
    scrape.get_searches(user, function(searches) {
        cont(null, searches);
    });
}

function BugSavedSearch(user, search) {
    var _this = this;
    this.search = search;
    this.user = user;
    
    // first, get the list of all the bugs the search returns and then
    // fetch them
    scrape.get_bugs_for_search(user, search, function(bugs) {
        _this.buglist = bugs;
        _this.fetch();
    });
}

BugSavedSearch.prototype = new events.EventEmitter();

BugSavedSearch.prototype.fetch = function() {
    var _this = this;
    console.log('fetching ' + this.buglist.length + ' bugs...');

    rpc(this.user,
        'Bug.get',
        [{ids: this.buglist}],
        function(err, res, data) {
            _this.emit('bugs', data.bugs);
            _this.emit('complete');
        });
}

// recursively fetch all the bugs in certain intervals. we have to do
// this because we have to to use GET params and if the bug list is
// too long we get an "URI is too long" error
BugSavedSearch.prototype.rfetch = function(i, limit) {
    var _this = this;
    console.log('fetching', i, limit);

    rpc(this.user,
        'Bug.get', 
        [{ids: this.buglist.slice(i, i+limit)}],
        function(err, res, data) {
            console.log('got', i, limit);

            if(err) {
                _this.emit('error', err);
            }
            else if(data.error) {
                _this.emit('error', data.error);
            }
            else {
                _this.emit('bugs', data.bugs);

                if(i+limit < _this.buglist.length) {
                    _this.rfetch(i+limit, limit);
                }
                else {
                    _this.emit('complete');
                }
            }
        });
}

function bug_saved_search(user, search) {
    return new BugSavedSearch(user, search);
}

// Scrape the search page for list of bugs, then call bug_info to get
// the details
function get_bugs(user, search) {
    if(builtin_searches[search]) {
        return builtin_searches[search](user);
    }

    return bug_saved_search(user, search);
}

function edit_bug(user, data, cont) {
    data.ids = [data.id];
    delete data.id;

    rpc(user,
        'Bug.update',
        [data],
        function(err, res, data) {
            if(err) {
                console.log(err);
                cont(err);
            }
            else {
                cont(data && data.error);
            }
        });
}

function get_comments(user, id, cont) {
    rpc(user,
        'Bug.comments',
        [{ids:[id]}],
        function(err, res, data) {
            if(err) {
                console.log(err);
                cont(err);
            }
            else {
                cont(data.error, data.bugs[id].comments);
            }
        });
}

function post_comment(user, id, content, cont) {
    rpc(user,
        'Bug.add_comment', 
        [{id: id,
          comment: content}],
        function(err, res, data) {
            if(err) {
                cont(err);
            }
            else {
                cont(data.error, data);
            }
        });
}

function BugSearch(user, params) {
    var _this = this;

    rpc(user,
        'Bug.search',
        params,
        function(err, res, data) {
            if(err) {
                _this.emit('error', err);
            }
            else if(data.error) {
                _this.emit('error', data.error);
            }
            else {
                _this.emit('bugs', data.bugs);
                _this.emit('complete');
            }
        });    
}

BugSearch.prototype = new events.EventEmitter();

function bug_search(user, params) {
    return new BugSearch(user, params);
}

function search_assigned(user) {
    return bug_search(
        user,
        [{assigned_to: user.name,
          status: ['UNCONFIRIMED', 'NEW', 'ASSIGNED', 'REOPENED']}]
    );
}

function search_reported(user) {
    return bug_search(
        user,
        [{creator: user.name,
          status: ['UNCONFIRIMED', 'NEW', 'ASSIGNED', 'REOPENED']}]
    );
}

function search_cced(user) {
    return bug_search(
        user,
        [{cc: user.name}]
    );
}

// function needs_review() {
//     bug_search(user,
//                [{assigned_to: user.name}],
//                cont);
// }

module.exports = {
    turn_off_login: turn_off_login,
    login: login,
    get_searches: get_searches,
    get_bugs: get_bugs,
    get_user: get_user,
    get_comments: get_comments,
    edit_bug: edit_bug,
    post_comment: post_comment,
    builtin_searches: builtin_searches
}

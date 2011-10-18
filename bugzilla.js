var connect = require('connect');
var https = require('https');
var qs = require('querystring');
var events = require('events');

var scrape = require('./scrape');
var _ = require('./underscore');


var SAVED_SEARCHES_URL = '/userprefs.cgi?tab=saved-searches';
var BUGLIST_URL = '/buglist.cgi?cmdtype=runnamed&namedcmd=';

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

function jsonrpc(user, method, params, http_method, cont) {
    if(_.isFunction(http_method)) {
        cont = http_method;
        http_method = 'GET';
    }

    var request;

    var opts = {
        host: 'bugzilla.mozilla.org',
        path: '/jsonrpc.cgi',
        method: http_method,
    };

    if(user) {
        opts['headers'] = {
            'Cookie': 'Bugzilla_login=' + user.login + '; ' +
                'Bugzilla_logincookie=' + user.logincookie
        }
    }

    var query = {
        method: method,
        params: params
    };

    if(http_method == 'GET') {
        query.params = JSON.stringify(query.params);
        opts.path += '?' + qs.stringify(query);

        // For some reason, I have to use get explicitly. Otherwise I
        // get a socket hangup.
        request = https.get;
    }
    else {
        request = https.request;
    }

    var content = '';

    var req = request(opts, function(res) {
        res.on('data', function(chunk) {
            content += chunk;
        });

        res.on('end', function() {
            try {
                if(content.trim().length > 0) {
                    content = JSON.parse(content);
                }
                cont(null, res, content);
            }
            catch (e) {
                console.log(e.message);
                cont('JSON parse error', res, null);
            }
            
        });

    });

    req.on('error', function(e) {
        cont('Authentication or server error');
    });

    if(http_method == 'POST') {
        req.write(JSON.stringify(query));
        req.end();
    }
}

function login(user, pass, cont) {    
    if(_fake_user) {
        cont(null, _fake_user);
        return;
    }

    jsonrpc(null, 'User.login', [{"login": user, "password": pass}], 'POST', function(err, res) {
        var cookies = {};

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
    scrape.parse_url(user, SAVED_SEARCHES_URL, function(err, window) {
        if(err) {
            cont(err);
            return;
        }

        var form = window.$('form');
        
        if(!form.length) {
            console.log('Warning: form not found ' +
                        'on save searches page');
        }
        
        var searches = [];
        form.find('table:first tr').each(function() {
            var td = window.$(this).find('td:first');
            var search = td.text();
            if(search != '' && search != 'My Bugs' && search != 'Assigned Bugs') {
                searches.push(search);
            }
        });

        cont(null, searches.sort());
    });
}

function BugSavedSearch(user, pass, search) {
    var _this = this;
    this.search = search;
    this.user = user;
    this.pass = pass;
    
    // first, get the list of all the bugs the search returns and then
    // fetch them
    scrape.parse_url(user, BUGLIST_URL + search.replace(/ /g, '+'), function(err, window) {
        if(err) {
            cont(err);
            return;
        }

        try {
        var list = window.$('.bz_buglist');
        var bugs = [];
        list.find('tbody tr').each(function() {
            // We get names that look like b123456, so strip
            // off the leading "b"
            bugs.push(this.id.substring(1));
        });        

        _this.buglist = bugs;
        _this.rfetch(0, 100);
        }
        catch(e) {
            console.log(e.message);
        }
    });
}

BugSavedSearch.prototype = new events.EventEmitter();

// recursively fetch all the bugs in certain intervals. we have to do
// this because we have to to use GET params and if the bug list is
// too long we get an "URI is too long" error
BugSavedSearch.prototype.rfetch = function(i, limit) {
    var _this = this;
    console.log('fetching', i, limit);

    jsonrpc(this.user,
            'Bug.get', 
            [{ids: this.buglist.slice(i, i+limit),
              Bugzilla_login: this.user.name,
              Bugzilla_password: this.pass}],
            function(err, res, data) {
                console.log('got', i, limit);

                if(err) {
                    _this.emit('error', err);
                }
                else if(data.error) {
                    _this.emit('error', data.error);
                }
                else {
                    if(i+limit < _this.buglist.length) {
                        _this.rfetch(i+limit, limit);
                    }
                    else {
                        _this.emit('complete');
                    }

                    _this.emit('bugs', data.result.bugs);
                }
            });
}

function bug_saved_search(user, pass, search) {
    return new BugSavedSearch(user, pass, search);
}

// Scrape the search page for list of bugs, then call bug_info to get
// the details
function get_bugs(user, pass, search) {
    if(builtin_searches[search]) {
        return builtin_searches[search](user, pass);
    }

    return bug_saved_search(user, pass, search);
}

function edit_bug(user, data, cont) {
    data.ids = [data.id];
    delete data.id;

    jsonrpc(user,
            'Bug.update',
            [data],
            'POST',
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

function get_comments(user, pass, id, cont) {
    jsonrpc(user,
            'Bug.comments',
            [{ids:[id],
              Bugzilla_login: user.name,
              Bugzilla_password: pass}],
            function(err, res, data) {
                if(err) {
                    console.log(err);
                    cont(err);
                }
                else {
                    cont(data.error, data.result.bugs[id].comments);
                }
            });
}

function post_comment(user, id, content, cont) {
    jsonrpc(user,
            'Bug.add_comment', 
            [{id: id,
              comment: content}],
            'POST',
            function(err, res, data) {
                if(err) {
                    cont(err);
                }
                else {
                    cont(data.error, data.result);
                }
            });
}

function BugSearch(user, pass, params) {
    var _this = this;

    params.Bugzilla_login = user.name;
    params.Bugzilla_password = pass;

    jsonrpc(user,
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
                    _this.emit('bugs', data.result.bugs);
                }
            });    
}

BugSearch.prototype = new events.EventEmitter();

function bug_search(user, pass, params) {
    return new BugSearch(user, pass, params);
}

function search_assigned(user, pass) {
    return bug_search(
        user,
        pass,
        [{assigned_to: user.name,
          status: ['UNCONFIRIMED', 'NEW', 'ASSIGNED', 'REOPENED']}]
    );
}

function search_reported(user, pass) {
    return bug_search(
        user,
        pass,
        [{creator: user.name,
          status: ['UNCONFIRIMED', 'NEW', 'ASSIGNED', 'REOPENED']}]
    );
}

// function cced() {
//     bug_search(user,
//                [{assigned_to: user.name}],
//                cont);
// }

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

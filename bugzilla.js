var connect = require('connect');
var scrape = require('./scrape');
var https = require('https');
var qs = require('querystring');
var _ = require('./underscore');

var SAVED_SEARCHES_URL = '/userprefs.cgi?tab=saved-searches';
var BUGLIST_URL = '/buglist.cgi?cmdtype=runnamed&namedcmd=';

var _fake_user;
function turn_off_login(user) {
    _fake_user = {name: user,
                  login: '-',
                  logincookie: '-'};
}

function get_user(data) {
    var cookies = data.cookies || data;

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

// Call the JSONRPC method to get bug info
function bug_info(user, bugs, cont) {
    jsonrpc(user,
            'Bug.get', 
            [{ids: bugs}],
            function(err, res, data) {
                if(err) {
                    console.log(err);
                    cont(err);
                }
                else {
                    cont(data.error, data.result.bugs);
                }
            });

    // function fetch(i, threshold) {
    //     jsonrpc(user,
    //             'Bug.get', 
    //             [{ids: bugs.slice(i, threshold)}],
    //             function(err, res, data) {
    //                 // This is quite a hack, but we can only get a few
    //                 // bugs at a time because we have to use GET
    //                 // parameters and the URI can't exceed a certain
    //                 // length
    //                 var next = i + threshold;

    //                 if(next < bugs.length) {
    //                     fetch(next, threshold);
    //                 }
    //                 else {
    //                     if(err) {
    //                         console.log(err);
    //                         cont(err);
    //                     }
    //                     else {
    //                         cont(data.error, data.result.bugs);
    //                     }
    //                 }
    //             });
    // }

    // fetch(0, 100);
}

// Scrape the search page for list of bugs, then call bug_info to get
// the details
function get_bugs(user, search, cont) {
    if(search.toLowerCase() == 'assigned to you') {
        search_assigned(user, cont);
        return;
    }
    else if(search.toLowerCase() == 'reported by you') {
        search_reported(user, cont);
        return;
    }

    scrape.parse_url(user, BUGLIST_URL + search.replace(/ /g, '+'), function(err, window) {
        if(err) {
            cont(err);
            return;
        }

        var list = window.$('.bz_buglist');

        if(!list.length) {
            console.log('Warning: list not found on bug page');
        }

        var bugs = [];
        list.find('tbody tr').each(function() {
            // We get names that look like b123456, so strip
            // off the leading "b"
            bugs.push(this.id.substring(1));
        });

        bug_info(user, bugs, cont);
    });
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

function get_comments(user, id, cont) {
    jsonrpc(user,
            'Bug.comments',
            [{ids:[id]}],
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


function bug_search(user, params, cont) {
    jsonrpc(user,
            'Bug.search',
            params,
            function(err, res, data) {
                if(err) {
                    cont(err);
                }
                else {
                    cont(data.error, data.result.bugs);
                }
            });
}

function search_assigned(user, cont) {
    bug_search(user,
               [{assigned_to: user.name,
                 status: ['UNCONFIRIMED', 'NEW', 'ASSIGNED', 'REOPENED']}],
               cont);
}

function search_reported(user, cont) {
    bug_search(user,
               [{creator: user.name,
                 status: ['UNCONFIRIMED', 'NEW', 'ASSIGNED', 'REOPENED']}],
               cont);

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
    bug_info: bug_info,
    post_comment: post_comment
}

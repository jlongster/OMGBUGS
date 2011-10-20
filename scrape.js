var qs = require('querystring');
var urlparse = require('url');
var sax = require('sax');
var https = require('https');

var host = 'bugzilla.mozilla.org';
var saved_searches_url = '/userprefs.cgi?tab=saved-searches';
var buglist_url = '/buglist.cgi?cmdtype=runnamed&namedcmd=';

function stream_xml(user, url, stream) {
    var content = '';

    var opts = {host: host,
                path: url,
                headers: {
                    'Cookie': 'Bugzilla_login=' + user.login + '; ' +
                              'Bugzilla_logincookie=' + user.logincookie
                }};

    https.get(opts, function(res) {
        if(res.statusCode == 301 || res.statusCode == 302) {
            var parts = urlparse.parse(res.headers['location']);
            parts.search = parts.search || '';
            parts.hash = parts.hash || '';
            stream_xml(user,
                       parts.pathname + parts.search + parts.hash,
                       stream);
        }
        else {
            res.on('data', function(chunk) {
                stream.write(chunk);
            });

            res.on('end', function() {
                stream.end();
            });
        }
    }).on('error', function(e) {
        console.log('https GET error: ' + e);
        stream.end();
    });
}

function get_searches(user, cont) {
    var stream = sax.createStream(false);

    var active = false,
        should_finish = false,
        in_table = false,
        in_td = false,
        searches = [];

    // We look for the first form, get the first table and grab the first
    // table cells in each row

    stream.on('opentag', function(node) {
        if(node.name == 'FORM' && node.attributes.name == 'userprefsform') {
            active = true;
        }

        if(node.name == 'TABLE') {
            in_table = true;
        }

        if(node.name == 'TR') {
            should_read_td = true;
        }

        if(node.name == 'TD') {
            in_td = true;
        }
    })

    stream.on('text', function(t) {
        if(active && in_table && in_td && should_read_td &&
           t != 'My Bugs' && t != 'Assigned Bugs') {

            searches.push(t);
        }
    });

    stream.on('closetag', function(name) {
        if(name == 'TABLE' && active) {
            in_table = false;
            active = false;
        }

        if(name = 'TD') {
            in_td = false;
            should_read_td = false;
        }
    });

    stream.on('end', function() {
        cont(searches.sort());
    });

    stream_xml(user, saved_searches_url, stream)
}

function get_bugs_for_search(user, search, cont) {
    var stream = sax.createStream(false),
        bugs = [];
    
    stream.on('opentag', function(node) {
        if(node.name == 'TR' && node.attributes.id) {
            var match = node.attributes.id.match(/b(\d{6,7})/);
            if(match) {
                bugs.push(match[1]);
            }
        }
    });

    stream.on('end', function() {
        cont(bugs);
    });

    stream_xml(user,
               buglist_url + search.replace(/ /g, '+'),
               stream);
}

module.exports = {
    get_searches: get_searches,
    get_bugs_for_search: get_bugs_for_search
}
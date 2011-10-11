var qs = require('querystring');
var urlparse = require('url');
var jsdom = require('jsdom');
var https = require('https');

var host = 'bugzilla.mozilla.org';

function request(user, url, cont) {
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
            request(user,
                    parts.pathname + parts.search + parts.hash,
                    cont);
        }
        else {
            res.on('data', function(chunk) {
                content += chunk;
            });

            res.on('end', function() {
                cont(null, content);
            });
        }
    }).on('error', function(e) {
        console.log('https GET error: ' + e);
        cont(e);
    });
}

function parse_url(user, url, cont) {
    request(user, url, function(err, content) {
        if(err) {
            cont(err);
            return;
        }

        jsdom.env(
            content, 
            ['/Users/james/projects/sites/omgbugs/media/js/jquery-1.6.4.min.js'],
            function(err, window) {                
                if(err) {
                    console.log('jsdom: ' + err);
                }

                cont(err, window);
            }
        );
    });
}

module.exports = {
    parse_url: parse_url
}
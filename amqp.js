var amqp = require('amqp');

var conn = amqp.createConnection({host: 'pulse.mozilla.org',
                                  login: 'public',
                                  password: 'public'});

conn.on('error', function(e) { 
    console.log('error: ' + e);
});

conn.on('ready', function() {
    var q = conn.queue('jwl-queue');
    var x = conn.exchange('org.mozilla.exchange.bugzilla', {passive: true});
    x.on('open', function() {
        console.log('exchange open');
        q.bind(x, '#');
    });

    q.subscribe(function(msg) {
        console.log(msg);
    });
});

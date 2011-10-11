
function identity(x) { return x; }

$(function() {

    var current_bugs;
    var opts = {
        columns: ['summary']
    };

    $('header select.tab').change(function(e) {
        var term = $(this).find('option:selected').val();
        search(term);
    });

    $('.actions .columns').click(function(e) {
        e.preventDefault();
        
        if(current_bugs) {
            var html = '<ul>';
            var bug = _.values(current_bugs)[0]

            _.each(_.keys(bug).sort(), function(key) {
                if(key.substr(0, 3) != 'cf_')
                    html += '<li>' + key + '</li>';
            });

            html += '</ul>';

            msgbox('<h2>Columns</h2>' +
                   '<div class="columns">' +
                   html +
                   '<textarea>' + opts.columns.join('\n') + '</textarea>' +
                   '</div>' +
                   '<input name="save" type="submit" value="Save" />');

            $('#msgbox input[name=save]').click(function() {
                opts.columns = $('#msgbox textarea').val().split('\n');
                msgbox_close();
                socket.emit('options', opts);b
            });
        }
    });

    function set_options(_opts) {
        opts.columns = _opts.columns || opts.columns;
    }

    var msgs = [];
    function status(msg) {
        msgs.push(msg);
        show_status();
        return msgs.length-1;
    }
    
    _should_show_status = true;
    function show_status() {
        if(_should_show_status) {
            $('.status').html(msgs.filter(identity).join(' ** '))
                .addClass('show');
        }
    }

    function offline_mode() {
        $('.status').html('Bugzilla is offline, showing only cached results')
            .css({color: 'red'})
            .show();

        _should_show_status = false;
    }

    function finished(key) {
        msgs[key] = null;
        if(!msgs.filter(identity).length) {
            msgs = [];
            $('.status').removeClass('show');
        }
        else {
            show_status();
        }
    }

    function msgbox(msg) {
        if(!$('#msgbox').length) {
            $('<div id="msgbox-wrapper"><div id="msgbox"></div></div>').appendTo('body');
            $('#msgbox-wrapper').click(msgbox_close);
            $('#msgbox').click(function(e) { e.stopPropagation(); });
        }

        $('#msgbox').html(msg);
        $('#msgbox-wrapper').show();
    }

    function msgbox_close() {
        $('#msgbox-wrapper').hide();
    }

    function search(name) {
        if(name) {
            var key = status('Searching...');
            socket.emit('search', {term: name,
                                   key: key});

            socket.emit('index-search', {term: name});
        }
    }

    function format_bug(id) {
        if(!current_bugs[id]) {
            return '<p>Bug not found</p>';
        }
        else {
            var bug = current_bugs[id];
            return '<h2>' + bug.summary + '</h2>' +
                '<div>Assignee: ' + bug.assigned_to + '</div>' +
                '<div>Url: ' + bug.url + '</div>' +
                '<div class="comments"></div>';
        }
    }
    

    window.socket = io.connect();

    socket.on('error', function(err) {
        console.log(err);
    });

    socket.on('searches', function(searches) {
        if(searches) {            
            $('header select.tab').html(
                '<option value="">-</option>' +
                searches.map(function(term) {
                    return '<option value="' + term + '">' + term + '</option>';
                }).join('')
            );
        }
        else {
            offline_mode();
        }
    });

    socket.on('bugs', function(msg) {
        var bugs = $('section.bugs');
        var str = '<table class="tablesorter">';

        current_bugs = {};

        str += '<thead><tr>';
        
        _.each(opts.columns, function(c) {
            str += '<th>' + c + '</th>';
        });
        
        str += '</tr></thead><tbody>';

        $.each(msg.bugs, function(i, bug) {
            current_bugs[bug.id] = bug;

            str += '<tr class="' + bug.id + '">';

            _.each(opts.columns, function(c) {
                str += '<td>' + bug[c] + '</td>';
            });

            str += '</tr>';
        });

        str += '</tbody></table>';
        var el = $(str);
        bugs.html(el);

        el.tablesorter();

        var row = el.find('tbody tr');
        row.click(function(e) {
            e.stopPropagation();
            window.location = '/bug/' + this.className;
        });

        finished(msg.key);
    });

    (function() {
        var msg;

        socket.on('begin-indexing-searches', function() {
            msg = status('Updating saved searches...');
        });

        socket.on('done-indexing-searches', function() {
            finished(msg);
        });
    })();

    socket.on('new-user', function() {
        msgbox('<h1>Indexing...</h1>' +
               '<p>We need to get some of your data first!</p>');
    });

    socket.on('new-user-finished', function() {
        msgbox('<h1>Done!</h1>' +
               '<p>Thanks for waiting, we have some data to start with!</p>');
        setTimeout(function() {
            msgbox_close();
        }, 3000);
    });

    socket.on('comments', function(comments) {
        $('div.comments').html(
            '<ul>' +
            _.reduce(comments, function(acc, c) {
                return acc + '<li>' + c.text + '</li>';
            }, '') +
            '</ul>'
        );
    });

    window.app = {
        set_options: set_options,
        socket: socket
    }
});

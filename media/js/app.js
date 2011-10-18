$(function() {

    var builtin_searches = ['Assigned to You', 'Reported by You'];

    function search(term) {
        app.current_search = term;
        views.make_table();

        socket.emit('get-bugs', term);
    }
    
    function set_default_search() {
        app.settings.default_search = app.current_search;

        socket.emit('set-settings', app.settings);
    }

    function set_columns(columns) {
        app.settings.columns = columns;
        views.make_table(true);

        socket.emit('set-settings', app.settings);
    }

    function set_sort(search, sort) {
        if(!app.settings.sorts) {
            app.settings.sorts = {};
        }

        if(app.settings.sorts[search] != sort) {
            app.settings.sorts[search] = sort;
            socket.emit('set-settings', app.settings);
        }
    }

    function get_comments(id) {
        socket.emit('get-comments', id);
    }

    function update_comments(id) {
        socket.emit('update-comments', id);
    }

    // update the world (this is run in polling mode)
    function update() {
        if(app.mode == 'poll') {
            socket.emit('update');
        }
    }

    // messages
    var socket = io.connect();

    socket.on('set-mode', function(mode) {
        app.mode = mode;

        if(app.mode == 'poll') {
            // Update every 5 minutes
            setInterval(update, 1000*60*5);
        }
    });

    socket.on('update-settings', function(opts) {
        if(!_.keys(app.settings).length) {
            // this is the first time we're getting the settings,
            // which means the user just loaded the page. go ahead and
            // kick off an update to all the user's bugs
            update();
        }

        app.settings = opts;

        if(!app.current_search && app.settings.default_search) {
            search(app.settings.default_search);
        }
        else {
            views.make_table(true);
        }
    });

    socket.on('begin-bugs', function(search) {
        if(search == app.current_search) {
            $(interface.s.searchbar).text(app.current_search);
            $(interface.s.actionbar).show();

            // begin a mark and sweep collection by unmarking all the
            // current bugs
            _.each(app.bug_table.collection.models, function(bug) {
                bug.set({marked: false});
            });
        }
    });

    socket.on('add-bugs', function(msg) {
        if(msg.search == app.current_search) {
            var model,
                col = app.bug_table.collection;

            _.each(msg.bugs, function(bug) {
                bug = _.extend(bug, {marked: true});

                if((model = col.get(bug.id))) {
                    model.set(bug);
                }
                else {
                    col.add(new models.Bug(bug));
                }
            });

            // TODO: need to update current bug if one is open
        }
    });

    socket.on('end-bugs', function(search) {
        if(search == app.current_search) {
            var to_remove = [];
            var col = app.bug_table.collection;

            // remove all the bugs that haven't been marked
            _.each(col.models, function(bug) {
                if(!bug.get('marked')) {
                    to_remove.push(bug);
                }
            });

            col.remove(to_remove);
            app.bug_table.finalize();
        }
    });

    socket.on('update-searches', function(searches) {
        app.searches = searches;
    });

    socket.on('update-comments', function(comments) {
        var container = $('.bug ul.comments');
        container.empty();

        _.each(comments, function(comment) {
            if(comment.text.length) {
                new views.CommentView(
                    {parent: container,
                     model: new models.Comment(comment)}
                ).render()
            }
        });

        Layers.adjust();
    });

    socket.emit('get-searches');
    socket.emit('get-settings');

    // exports
    window.app = {
        set_default_search: set_default_search,
        set_columns: set_columns,
        set_sort: set_sort,
        bug_table: null,
        settings: {},
        builtin_searches: builtin_searches,
        search: search,
        get_comments: get_comments,
        update_comments: update_comments
    }
});
$(function() {

    var builtin_searches = ['Assigned to You', 'Reported by You'];

    var MSG_GET_COMMENTS = 1,
        MSG_UPDATE_BUGS = 2,
        MSG_UPDATE_COMMENTS = 3,
        MSG_UPDATE = 4,
        MSG_SEARCH = 5;

    function search(term) {
        app.current_search = term;
        $('.welcome').remove();
        views.make_table();

        socket.emit('get-bugs', term);
        interface.notify('Fetching bugs...', MSG_SEARCH);
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
        interface.notify('Fetching comments...', MSG_GET_COMMENTS);
    }

    function update_bugs(search) {
        // update a specific search when the user has made changes. this
        // is only done in polling mode for immediate feedback.
        if(app.mode == 'poll') {
            socket.emit('update', search);
            interface.notify('Updating ' + search + '...', MSG_UPDATE_BUGS);
        }
    }

    function update_comments(id) {
        socket.emit('update-comments', id);
        interface.notify('Updating comments...', MSG_UPDATE_COMMENTS);
    }

    // update the world (this is run in polling mode)
    function update() {
        if(app.mode == 'poll') {
            socket.emit('update');
            interface.notify('Updating all your bugs...', MSG_UPDATE);
        }
    }

    // messages
    var socket = io.connect();

    socket.on('set-mode', function(mode) {
        app.mode = mode;
        
        if(mode == 'poll') {
            // Update every 10 minutes
            setInterval(update, 1000*60*10);
        }
    });

    socket.on('update-settings', function(opts) {
        var new_user = opts.new_user;
        delete opts.new_user;

        if(!_.keys(app.settings).length) {
            // first update to the page, fire off a quick update to
            // everything instead of waiting the 5-10 min time for
            // regular polling

            if(app.mode == 'poll') {
                if(new_user) {
                    // this is a completely new user, so fire off
                    // update instantly
                    update();
                }
                else {
                    // the user existed before, so wait 1 min
                    setTimeout(update, 1000*60);
                }
            }
        }
        
        app.settings = opts;

        if(!new_user) {
            if(!app.current_search && app.settings.default_search) {
                search(app.settings.default_search);
            }
        }
        else {
            $('section.bugs').html(templates.welcome);
        }
    });

    socket.on('set-bugs', function(msg) {
        if(msg.search == app.current_search) {
            $(interface.s.searchbar).text(app.current_search);
            $(interface.s.actionbar).show();

            app.bug_table.collection.reset(msg.bugs);

            addons.emit('set-bugs');
            interface.notify_close(MSG_UPDATE_BUGS);
            interface.notify_close(MSG_UPDATE);
            interface.notify_close(MSG_SEARCH);
        }

        if(!app.current_search) {
            interface.notify_close(MSG_UPDATE_BUGS);
            interface.notify_close(MSG_UPDATE);
        }
    });

    socket.on('update-bugs', function(msg) {
        if(msg.search == app.current_search) {
            var model,
                col = app.bug_table.collection;

            // begin a mark and sweep collection by unmarking all the
            // current bugs
            _.each(app.bug_table.collection.models, function(bug) {
                bug.set({_state: false});
            });

            _.each(msg.bugs, function(bug) {
                if((model = col.get(bug.id))) {
                    model.set(_.extend(bug, {_state: 'changed'}));
                }
                else {
                    col.add(new models.Bug(_.extend(bug, {_state: 'new'})));
                }
            });

            _.each(col.models, function(bug) {
                var state = bug.get('_state');

                if(!state) {
                    // remove all the bugs that haven't been marked
                    col.remove(bug);
                }
                else if(state == 'new') {
                    // highlight the ones that have been added
                    interface.highlight_bug(bug.get('id'));
                }
            });

            app.bug_table.finalize();

            addons.emit('update-bugs');
            interface.notify_close(MSG_UPDATE_BUGS);
            interface.notify_close(MSG_UPDATE);
            // TODO: need to update current bug if one is open
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

        interface.notify_close(MSG_GET_COMMENTS);
        interface.notify_close(MSG_UPDATE_COMMENTS);
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
        update_comments: update_comments,
        update_bugs: update_bugs
    }

    // purely for debugging
    window.socket = socket;
});